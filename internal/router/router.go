package router

import (
	"crypto/ed25519"
	"crypto/sha256"
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
// requestID is used to derive a deterministic nonce for verifiable proofs.
func (e *Engine) Route(tenantID, jurisdiction, requestID string) (*RoutingDecision, error) {
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
			proof, err := e.generateProof(tenantID, decision, requestID)
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

	proof, err := e.generateProof(tenantID, decision, requestID)
	if err != nil {
		return nil, fmt.Errorf("router: proof generation: %w", err)
	}
	decision.Proof = proof

	return decision, nil
}

// RoutingProof is the verifiable proof structure stored in audit events.
type RoutingProof struct {
	Payload   RoutingProofPayload `json:"payload"`
	Signature string              `json:"signature"`
}

// RoutingProofPayload contains the signed data for a routing decision.
// Fields are ordered alphabetically by JSON key for canonical serialization.
type RoutingProofPayload struct {
	Jurisdiction string `json:"jurisdiction"`
	NodeID       string `json:"node_id"`
	Nonce        string `json:"nonce"`
	RequestID    string `json:"request_id"`
	Timestamp    string `json:"timestamp"`
}

func (e *Engine) generateProof(tenantID string, decision *RoutingDecision, requestID string) (string, error) {
	payload := RoutingProofPayload{
		RequestID:    requestID,
		Jurisdiction: decision.Jurisdiction,
		NodeID:       decision.Backend,
		Timestamp:    decision.Timestamp,
		Nonce:        deriveNonce(requestID),
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}

	sig := ed25519.Sign(e.privateKey, payloadBytes)

	proof := RoutingProof{
		Payload:   payload,
		Signature: hex.EncodeToString(sig),
	}

	proofJSON, err := json.Marshal(proof)
	if err != nil {
		return "", err
	}
	return string(proofJSON), nil
}

// deriveNonce produces a deterministic nonce from the request ID,
// allowing third-party verification of the routing proof.
func deriveNonce(requestID string) string {
	h := sha256.Sum256([]byte("bawaba-nonce:" + requestID))
	return hex.EncodeToString(h[:16])
}
