package audit

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"os"
	"sync"
	"time"
)

// Event represents a single audit event.
type Event struct {
	EventID          string    `json:"event_id"`
	Timestamp        time.Time `json:"timestamp"`
	EventType        string    `json:"event_type"`
	AgentID          string    `json:"agent_id"`
	TenantID         string    `json:"tenant_id"`
	Jurisdiction     string    `json:"jurisdiction"`
	MCPServer        string    `json:"mcp_server"`
	Tool             string    `json:"tool"`
	ParamsHash       string    `json:"params_hash"`
	ResourcePath     string    `json:"resource_path"`
	PolicyResult     string    `json:"policy_result"`
	PolicyVersion    string    `json:"policy_version"`
	MatchedRule      string    `json:"matched_rule"`
	PIIMode          string    `json:"pii_mode"`
	EntitiesDetected int       `json:"entities_detected"`
	TokensGenerated  int       `json:"tokens_generated"`
	ResponseStatus   string    `json:"response_status"`
	ResultCount      int       `json:"result_count"`
	LatencyMS        float64   `json:"latency_ms"`
	OverheadMS       float64   `json:"overhead_ms"`
	EventHash        string    `json:"event_hash"`
	PrevHash         string    `json:"prev_hash"`
	MerkleRoot       string    `json:"merkle_root"`
	Signature        string    `json:"signature"`
}

// SIEMForwarder is the interface for optional SIEM event forwarding.
type SIEMForwarder interface {
	Forward(event SIEMEvent)
}

// SIEMEvent is a lightweight event representation for SIEM forwarding.
type SIEMEvent struct {
	EventID      string  `json:"event_id"`
	Timestamp    string  `json:"timestamp"`
	EventType    string  `json:"event_type"`
	AgentID      string  `json:"agent_id"`
	TenantID     string  `json:"tenant_id"`
	Jurisdiction string  `json:"jurisdiction"`
	Tool         string  `json:"tool"`
	PolicyResult string  `json:"policy_result"`
	PIIMode      string  `json:"pii_mode"`
	LatencyMS    float64 `json:"latency_ms"`
}

// Trail manages the append-only audit log with hash chaining.
type Trail struct {
	mu         sync.Mutex
	db         *sql.DB
	privateKey ed25519.PrivateKey
	publicKey  ed25519.PublicKey
	prevHash   string
	events     []Event // in-memory buffer for testing without DB
	noDB       bool
	forwarder  SIEMForwarder
}

// NewTrail creates a new audit trail. If db is nil, operates in memory-only mode.
func NewTrail(db *sql.DB, keyPath string) (*Trail, error) {
	privKey, pubKey, err := loadOrGenerateKey(keyPath)
	if err != nil {
		return nil, fmt.Errorf("audit: key setup: %w", err)
	}

	t := &Trail{
		privateKey: privKey,
		publicKey:  pubKey,
		db:         db,
		prevHash:   "genesis",
		noDB:       db == nil,
	}

	if db != nil {
		// Load the latest prev_hash from the database
		var lastHash sql.NullString
		err := db.QueryRow("SELECT event_hash FROM audit_events ORDER BY timestamp DESC LIMIT 1").Scan(&lastHash)
		if err == nil && lastHash.Valid {
			t.prevHash = lastHash.String
		}
	}

	return t, nil
}

// SetForwarder attaches an optional SIEM forwarder to the trail.
// Events will be forwarded in a non-blocking goroutine after DB insertion.
func (t *Trail) SetForwarder(f SIEMForwarder) {
	t.forwarder = f
}

// Log records an audit event.
func (t *Trail) Log(evt Event) error {
	t.mu.Lock()
	defer t.mu.Unlock()

	// Generate event ID
	now := time.Now().UTC()
	randBytes := make([]byte, 8)
	_, _ = rand.Read(randBytes)
	evt.EventID = fmt.Sprintf("evt_%s_%s", now.Format("20060102150405"), hex.EncodeToString(randBytes))
	evt.Timestamp = now

	// Set prev hash
	evt.PrevHash = t.prevHash

	// Compute event hash
	evt.EventHash = computeEventHash(evt)

	// Sign
	sig := ed25519.Sign(t.privateKey, []byte(evt.EventHash))
	evt.Signature = hex.EncodeToString(sig)

	// Update prev hash for next event
	t.prevHash = evt.EventHash

	if t.noDB {
		t.events = append(t.events, evt)
		t.forwardToSIEM(evt)
		return nil
	}

	if err := t.insertEvent(evt); err != nil {
		return err
	}

	t.forwardToSIEM(evt)
	return nil
}

// forwardToSIEM sends the event to the SIEM forwarder if one is configured.
// The forwarder's Forward method must be non-blocking (fire-and-forget).
func (t *Trail) forwardToSIEM(evt Event) {
	if t.forwarder == nil {
		return
	}
	t.forwarder.Forward(SIEMEvent{
		EventID:      evt.EventID,
		Timestamp:    evt.Timestamp.Format("2006-01-02T15:04:05Z07:00"),
		EventType:    evt.EventType,
		AgentID:      evt.AgentID,
		TenantID:     evt.TenantID,
		Jurisdiction: evt.Jurisdiction,
		Tool:         evt.Tool,
		PolicyResult: evt.PolicyResult,
		PIIMode:      evt.PIIMode,
		LatencyMS:    evt.LatencyMS,
	})
}

func (t *Trail) insertEvent(evt Event) error {
	_, err := t.db.Exec(`
		INSERT INTO audit_events (
			event_id, timestamp, event_type, agent_id, tenant_id, jurisdiction,
			mcp_server, tool, params_hash, resource_path,
			policy_result, policy_version, matched_rule,
			pii_mode, entities_detected, tokens_generated,
			response_status, result_count, latency_ms, overhead_ms,
			event_hash, prev_hash, merkle_root, signature
		) VALUES (
			$1, $2, $3, $4, $5, $6,
			$7, $8, $9, $10,
			$11, $12, $13,
			$14, $15, $16,
			$17, $18, $19, $20,
			$21, $22, $23, $24
		)`,
		evt.EventID, evt.Timestamp, evt.EventType, evt.AgentID, evt.TenantID, evt.Jurisdiction,
		evt.MCPServer, evt.Tool, evt.ParamsHash, evt.ResourcePath,
		evt.PolicyResult, evt.PolicyVersion, evt.MatchedRule,
		evt.PIIMode, evt.EntitiesDetected, evt.TokensGenerated,
		evt.ResponseStatus, evt.ResultCount, evt.LatencyMS, evt.OverheadMS,
		evt.EventHash, evt.PrevHash, evt.MerkleRoot, evt.Signature,
	)
	return err
}

// GetEvents returns recent audit events (for testing / CLI).
func (t *Trail) GetEvents(limit int) []Event {
	if t.noDB {
		t.mu.Lock()
		defer t.mu.Unlock()
		if limit <= 0 || limit > len(t.events) {
			limit = len(t.events)
		}
		start := len(t.events) - limit
		result := make([]Event, limit)
		copy(result, t.events[start:])
		return result
	}
	return nil
}

// PublicKey returns the Ed25519 public key for signature verification.
func (t *Trail) PublicKey() ed25519.PublicKey {
	return t.publicKey
}

// PrivateKey returns the Ed25519 private key (used by router for proof signing).
func (t *Trail) PrivateKey() ed25519.PrivateKey {
	return t.privateKey
}

func computeEventHash(evt Event) string {
	data := fmt.Sprintf("%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%d|%d|%f",
		evt.EventID, evt.EventType, evt.AgentID, evt.TenantID,
		evt.Jurisdiction, evt.Tool, evt.ParamsHash,
		evt.PolicyResult, evt.PIIMode, evt.ResponseStatus,
		evt.PrevHash, evt.EntitiesDetected, evt.TokensGenerated,
		evt.LatencyMS,
	)
	h := sha256.Sum256([]byte(data))
	return hex.EncodeToString(h[:])
}

func loadOrGenerateKey(keyPath string) (ed25519.PrivateKey, ed25519.PublicKey, error) {
	if keyPath == "" {
		// Generate ephemeral key
		pub, priv, err := ed25519.GenerateKey(rand.Reader)
		return priv, pub, err
	}

	data, err := os.ReadFile(keyPath)
	if err != nil {
		if os.IsNotExist(err) {
			// Generate and save
			pub, priv, genErr := ed25519.GenerateKey(rand.Reader)
			if genErr != nil {
				return nil, nil, genErr
			}
			if writeErr := os.MkdirAll("keys", 0700); writeErr != nil {
				return nil, nil, writeErr
			}
			if writeErr := os.WriteFile(keyPath, priv.Seed(), 0600); writeErr != nil {
				return nil, nil, writeErr
			}
			return priv, pub, nil
		}
		return nil, nil, err
	}

	if len(data) == ed25519.SeedSize {
		priv := ed25519.NewKeyFromSeed(data)
		pub := priv.Public().(ed25519.PublicKey)
		return priv, pub, nil
	}
	if len(data) == ed25519.PrivateKeySize {
		priv := ed25519.PrivateKey(data)
		pub := priv.Public().(ed25519.PublicKey)
		return priv, pub, nil
	}

	return nil, nil, fmt.Errorf("audit: invalid key file size %d", len(data))
}

// VerifyChain verifies the hash chain integrity of a sequence of events.
func VerifyChain(events []Event, pubKey ed25519.PublicKey) error {
	for i, evt := range events {
		// Verify hash
		expected := computeEventHash(evt)
		if evt.EventHash != expected {
			return fmt.Errorf("audit: event %s hash mismatch at index %d", evt.EventID, i)
		}

		// Verify chain
		if i > 0 && evt.PrevHash != events[i-1].EventHash {
			return fmt.Errorf("audit: chain broken at event %s (index %d)", evt.EventID, i)
		}

		// Verify signature
		sigBytes, err := hex.DecodeString(evt.Signature)
		if err != nil {
			return fmt.Errorf("audit: invalid signature encoding for event %s", evt.EventID)
		}
		if !ed25519.Verify(pubKey, []byte(evt.EventHash), sigBytes) {
			return fmt.Errorf("audit: signature verification failed for event %s", evt.EventID)
		}
	}
	return nil
}
