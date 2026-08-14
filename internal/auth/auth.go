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
	ErrUnauthorized  = errors.New("auth: unauthorized")
	ErrUnknownAgent  = errors.New("auth: unknown agent")
	ErrExpiredKey    = errors.New("auth: api key expired")
	ErrInvalidMethod = errors.New("auth: invalid auth method")
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
	mu      sync.RWMutex
	apiKeys map[string]*APIKeyRecord // hashed_key -> record
	agents  map[string]*AgentRecord  // agent_id -> record
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
		PlainKey:  plainKey,
		CreatedAt: time.Now(),
		ExpiresAt: expiresAt,
		Active:    true,
	}
	return nil
}

// RegisterAPIKeyHash registers an agent whose bcrypt key hash was persisted
// (P1 control plane: created agents survive restarts via the store).
func (e *Engine) RegisterAPIKeyHash(agentID, tenantID string, keyHash []byte) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.apiKeys[agentID] = &APIKeyRecord{
		AgentID:   agentID,
		TenantID:  tenantID,
		KeyHash:   keyHash,
		CreatedAt: time.Now(),
		Active:    true,
	}
}

// Deactivate removes an agent's credentials (P1 delete — fail closed).
func (e *Engine) Deactivate(agentID string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	delete(e.apiKeys, agentID)
	delete(e.agents, agentID)
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
	// Bearer token (shared secret, pilot mode)
	// Matches against a pre-shared token registered per agent.
	// OIDC/JWT validation: planned P2 (see roadmap)
	e.mu.RLock()
	defer e.mu.RUnlock()

	for agentID, agent := range e.agents {
		if agent.AuthMethod == "oauth2" && agent.Active {
			// Shared-secret comparison (constant-time)
			// P2: replace with JWT signature + exp + iss + aud validation
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

// --- Production auth path — P2 ---
// ValidateJWT validates a JWT bearer token against a JWKS endpoint.
// Activated when BAWABA_AUTH_MODE=jwt (default: "shared_secret").
// This is a stub adapter for the upcoming OIDC/JWT auth path.
// It is NOT wired into any existing agent flow — see roadmap for P2 integration.
func ValidateJWT(token, jwksURL, expectedIss, expectedAud string) (*AgentIdentity, error) {
	if token == "" {
		return nil, fmt.Errorf("auth/jwt: empty token")
	}
	if jwksURL == "" {
		return nil, fmt.Errorf("auth/jwt: jwksURL is required")
	}

	// Step 1: Fetch JWKS from the identity provider
	resp, err := http.Get(jwksURL) //nolint:noctx // stub — context will be added in P2
	if err != nil {
		return nil, fmt.Errorf("auth/jwt: fetch JWKS: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("auth/jwt: JWKS endpoint returned %d", resp.StatusCode)
	}

	// Step 2: Parse JWKS response (stub — full jose library integration in P2)
	// In production this will use a proper JOSE library (e.g. go-jose/v4)
	// to parse the key set and verify the JWT signature.
	_ = resp.Body // JWKS body read — actual key parsing is P2

	// Step 3: Decode JWT claims (stub)
	// Production: decode header → find kid → match key → verify sig → decode claims
	parts := strings.SplitN(token, ".", 3)
	if len(parts) != 3 {
		return nil, fmt.Errorf("auth/jwt: malformed token (expected 3 parts, got %d)", len(parts))
	}

	// Step 4: Validate standard claims (stub)
	// Production: validate exp, iss, aud, nbf, iat
	_ = expectedIss
	_ = expectedAud

	// P2: Return identity extracted from validated JWT claims
	// For now, return a placeholder to prove the adapter compiles and is callable.
	return nil, fmt.Errorf("auth/jwt: not yet implemented — enable in P2 (OIDC/JWT validation)")
}
