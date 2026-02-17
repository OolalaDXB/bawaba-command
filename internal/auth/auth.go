package auth

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

var (
	ErrUnauthorized   = errors.New("auth: unauthorized")
	ErrUnknownAgent   = errors.New("auth: unknown agent")
	ErrExpiredKey      = errors.New("auth: api key expired")
	ErrInvalidMethod   = errors.New("auth: invalid auth method")
)

// AgentIdentity represents an authenticated agent.
type AgentIdentity struct {
	AgentID    string
	TenantID   string
	AuthMethod string
	Metadata   map[string]string
}

// Engine handles authentication for all supported methods.
type Engine struct {
	mu       sync.RWMutex
	apiKeys  map[string]*APIKeyRecord // hashed_key -> record
	agents   map[string]*AgentRecord  // agent_id -> record
}

type AgentRecord struct {
	AgentID    string
	TenantID   string
	AuthMethod string
	Active     bool
	CreatedAt  time.Time
}

type APIKeyRecord struct {
	AgentID   string
	TenantID  string
	KeyHash   []byte
	PlainKey  string // only used during creation; cleared after
	CreatedAt time.Time
	ExpiresAt *time.Time
	Active    bool
}

// NewEngine creates a new auth engine.
func NewEngine() *Engine {
	return &Engine{
		apiKeys: make(map[string]*APIKeyRecord),
		agents:  make(map[string]*AgentRecord),
	}
}

// RegisterAgent registers an agent in the auth engine.
func (e *Engine) RegisterAgent(agentID, tenantID, authMethod string) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	e.agents[agentID] = &AgentRecord{
		AgentID:    agentID,
		TenantID:   tenantID,
		AuthMethod: authMethod,
		Active:     true,
		CreatedAt:  time.Now(),
	}
	return nil
}

// RegisterAPIKey registers a pre-hashed API key for an agent.
func (e *Engine) RegisterAPIKey(agentID, tenantID, plainKey string, expiresAt *time.Time) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(plainKey), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("auth: hash key: %w", err)
	}

	e.mu.Lock()
	defer e.mu.Unlock()

	e.apiKeys[agentID] = &APIKeyRecord{
		AgentID:   agentID,
		TenantID:  tenantID,
		KeyHash:   hash,
		CreatedAt: time.Now(),
		ExpiresAt: expiresAt,
		Active:    true,
	}
	return nil
}

// Authenticate authenticates an incoming HTTP request and returns the agent identity.
func (e *Engine) Authenticate(_ context.Context, r *http.Request) (*AgentIdentity, error) {
	// Try API key first (X-Bawaba-Key header)
	if key := r.Header.Get("X-Bawaba-Key"); key != "" {
		return e.authenticateAPIKey(key)
	}

	// Try Bearer token (OAuth2)
	if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
		token := strings.TrimPrefix(auth, "Bearer ")
		return e.authenticateBearerToken(token)
	}

	// Try mTLS (client certificate)
	if r.TLS != nil && len(r.TLS.PeerCertificates) > 0 {
		return e.authenticateMTLS(r)
	}

	return nil, ErrUnauthorized
}

func (e *Engine) authenticateAPIKey(key string) (*AgentIdentity, error) {
	e.mu.RLock()
	defer e.mu.RUnlock()

	for _, record := range e.apiKeys {
		if !record.Active {
			continue
		}
		if err := bcrypt.CompareHashAndPassword(record.KeyHash, []byte(key)); err == nil {
			// Key matches
			if record.ExpiresAt != nil && time.Now().After(*record.ExpiresAt) {
				return nil, ErrExpiredKey
			}
			return &AgentIdentity{
				AgentID:    record.AgentID,
				TenantID:   record.TenantID,
				AuthMethod: "api_key",
				Metadata:   map[string]string{},
			}, nil
		}
	}

	return nil, ErrUnauthorized
}

func (e *Engine) authenticateBearerToken(token string) (*AgentIdentity, error) {
	// P1: Simple token validation — matches against registered agent tokens
	// Full OAuth 2.1 + PKCE validation is implemented separately
	e.mu.RLock()
	defer e.mu.RUnlock()

	for agentID, agent := range e.agents {
		if agent.AuthMethod == "oauth2" && agent.Active {
			// For P1, accept bearer token if it matches a registered token
			// In production, this validates JWT signature, exp, iss, aud
			if apiKey, ok := e.apiKeys[agentID]; ok {
				if subtle.ConstantTimeCompare([]byte(token), []byte(apiKey.PlainKey)) == 1 {
					return &AgentIdentity{
						AgentID:    agentID,
						TenantID:   agent.TenantID,
						AuthMethod: "oauth2",
						Metadata:   map[string]string{},
					}, nil
				}
			}
		}
	}

	return nil, ErrUnauthorized
}

func (e *Engine) authenticateMTLS(r *http.Request) (*AgentIdentity, error) {
	cert := r.TLS.PeerCertificates[0]
	cn := cert.Subject.CommonName

	e.mu.RLock()
	defer e.mu.RUnlock()

	agent, ok := e.agents[cn]
	if !ok || !agent.Active {
		return nil, ErrUnknownAgent
	}

	if agent.AuthMethod != "mtls" {
		return nil, ErrInvalidMethod
	}

	return &AgentIdentity{
		AgentID:    agent.AgentID,
		TenantID:   agent.TenantID,
		AuthMethod: "mtls",
		Metadata: map[string]string{
			"cert_cn":     cn,
			"cert_serial": cert.SerialNumber.String(),
		},
	}, nil
}

// GetAgent returns the agent record for the given agent ID.
func (e *Engine) GetAgent(agentID string) (*AgentRecord, bool) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	rec, ok := e.agents[agentID]
	return rec, ok
}
