package router

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/OolalaDXB/bawaba-command/internal/config"
)

// RoutingDecision contains the routing result and cryptographic proof.
type RoutingDecision struct {
	Backend      string   `json:"backend"`
	Jurisdiction string   `json:"jurisdiction"`
	Compliance   []string `json:"compliance"`
	Proof        string   `json:"proof"` // Ed25519 signed JSON
	Timestamp    string   `json:"timestamp"`
}

// Engine routes requests based on jurisdiction and policy.
type Engine struct {
	mu         sync.RWMutex
	rules      []config.RoutingRule
	defaultBE  string
	privateKey ed25519.PrivateKey
}

// NewEngine creates a new routing engine.
func NewEngine(cfg config.RoutingConfig, privKey ed25519.PrivateKey) *Engine {
	defaultBE := cfg.DefaultBackend
	if defaultBE == "" {
		defaultBE = "localhost"
	}
	return &Engine{
		rules:      cfg.Rules,
		defaultBE:  defaultBE,
		privateKey: privKey,
	}
}

// Route determines the backend for a request based on tenant jurisdiction.
func (e *Engine) Route(tenantID, jurisdiction string) (*RoutingDecision, error) {
	e.mu.RLock()
	defer e.mu.RUnlock()

	for _, rule := range e.rules {
		if rule.Jurisdiction == jurisdiction {
			decision := &RoutingDecision{
				Backend:      rule.Backend,
				Jurisdiction: jurisdiction,
				Compliance:   rule.Compliance,
				Timestamp:    time.Now().UTC().Format(time.RFC3339),
			}

			// Generate cryptographic proof
			proof, err := e.generateProof(tenantID, decision)
			if err != nil {
				return nil, fmt.Errorf("router: proof generation: %w", err)
			}
			decision.Proof = proof

			return decision, nil
		}
	}

	// Default routing
	decision := &RoutingDecision{
		Backend:      e.defaultBE,
		Jurisdiction: jurisdiction,
		Compliance:   []string{},
		Timestamp:    time.Now().UTC().Format(time.RFC3339),
	}

	proof, err := e.generateProof(tenantID, decision)
	if err != nil {
		return nil, fmt.Errorf("router: proof generation: %w", err)
	}
	decision.Proof = proof

	return decision, nil
}

func (e *Engine) generateProof(tenantID string, decision *RoutingDecision) (string, error) {
	proofData := map[string]interface{}{
		"tenant_id":    tenantID,
		"backend":      decision.Backend,
		"jurisdiction": decision.Jurisdiction,
		"compliance":   decision.Compliance,
		"timestamp":    decision.Timestamp,
		"nonce":        generateNonce(),
	}

	data, err := json.Marshal(proofData)
	if err != nil {
		return "", err
	}

	sig := ed25519.Sign(e.privateKey, data)
	return hex.EncodeToString(sig), nil
}

func generateNonce() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
