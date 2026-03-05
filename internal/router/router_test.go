package router

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"testing"

	"github.com/OolalaDXB/bawaba-command/internal/config"
)

func TestCanonicalJSONDeterministic(t *testing.T) {
	// Same payload serialized twice must produce identical bytes
	payload := RoutingProofPayload{
		Jurisdiction: "ma",
		NodeID:       "inwi-dc-casa",
		Nonce:        "abc123",
		RequestID:    "req-001",
		Timestamp:    "2026-01-15T10:00:00Z",
	}

	bytes1, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal 1: %v", err)
	}
	bytes2, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal 2: %v", err)
	}

	if string(bytes1) != string(bytes2) {
		t.Fatalf("serialization not deterministic:\n  %s\n  %s", bytes1, bytes2)
	}

	// Verify alphabetical order of JSON keys
	var m map[string]interface{}
	json.Unmarshal(bytes1, &m)

	raw := string(bytes1)
	// Keys must appear in this order: jurisdiction, node_id, nonce, request_id, timestamp
	keys := []string{"jurisdiction", "node_id", "nonce", "request_id", "timestamp"}
	lastIdx := -1
	for _, k := range keys {
		idx := len(raw) // default: not found
		for i := 0; i < len(raw)-len(k); i++ {
			if raw[i:i+len(k)] == k {
				idx = i
				break
			}
		}
		if idx <= lastIdx {
			t.Errorf("key %q is not in alphabetical order in JSON output: %s", k, raw)
		}
		lastIdx = idx
	}
}

func TestRoutingProofVerifiable(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)

	engine := NewEngine(config.RoutingConfig{
		DefaultBackend: "localhost",
		Rules: []config.RoutingRule{
			{Jurisdiction: "ma", Backend: "inwi-dc-casa", Compliance: []string{"loi-09-08"}},
		},
	}, priv)

	// Route twice with the same requestID → same nonce → same payload → same signature
	d1, err := engine.Route("tenant1", "ma", "req-42")
	if err != nil {
		t.Fatalf("route 1: %v", err)
	}
	d2, err := engine.Route("tenant1", "ma", "req-42")
	if err != nil {
		t.Fatalf("route 2: %v", err)
	}

	// Parse proofs
	var p1, p2 RoutingProof
	json.Unmarshal([]byte(d1.Proof), &p1)
	json.Unmarshal([]byte(d2.Proof), &p2)

	// Nonce must be deterministic (derived from requestID)
	if p1.Payload.Nonce != p2.Payload.Nonce {
		t.Errorf("nonce not deterministic: %s vs %s", p1.Payload.Nonce, p2.Payload.Nonce)
	}

	// Verify the signature is valid
	payloadBytes, _ := json.Marshal(p1.Payload)
	sigBytes, _ := hex.DecodeString(p1.Signature)
	if !ed25519.Verify(pub, payloadBytes, sigBytes) {
		t.Fatal("signature verification failed")
	}
}

func TestRouteDefaultBackend(t *testing.T) {
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	engine := NewEngine(config.RoutingConfig{
		DefaultBackend: "fallback-node",
		Rules:          []config.RoutingRule{},
	}, priv)

	d, err := engine.Route("t1", "unknown", "req-1")
	if err != nil {
		t.Fatalf("route: %v", err)
	}
	if d.Backend != "fallback-node" {
		t.Errorf("expected fallback-node, got %s", d.Backend)
	}
}
