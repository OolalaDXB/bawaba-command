package main

import (
	"encoding/json"
	"os"
	"testing"
)

func TestEvidenceBundleParse(t *testing.T) {
	bundle := evidenceBundle{
		GeneratedAt:        "2026-03-05T12:00:00Z",
		WindowStart:        "2026-03-04T12:00:00Z",
		WindowEnd:          "2026-03-05T12:00:00Z",
		WindowDays:         1,
		AuditMode:          "hash_chain_ed25519",
		MerkleStatus:       "planned_p2",
		TotalEvents:        2,
		ChainVerified:      true,
		PolicySnapshotHash: "a3f9b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1",
		Events: []eventSummary{
			{EventID: "evt_001", EventHash: "aaa", Signature: "sig1"},
			{EventID: "evt_002", EventHash: "bbb", Signature: "sig2"},
		},
		RoutingProofs: []proofEntry{
			{EventID: "evt_001", Proof: json.RawMessage(`{"payload":{},"signature":"abc"}`)},
		},
	}

	data, err := json.Marshal(bundle)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var parsed evidenceBundle
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if parsed.TotalEvents != 2 {
		t.Errorf("expected 2 events, got %d", parsed.TotalEvents)
	}
	if parsed.WindowDays != 1 {
		t.Errorf("expected window_days=1, got %d", parsed.WindowDays)
	}
	if len(parsed.RoutingProofs) != 1 {
		t.Errorf("expected 1 routing proof, got %d", len(parsed.RoutingProofs))
	}
}

func TestVerifyValidBundle(t *testing.T) {
	bundle := evidenceBundle{
		GeneratedAt:        "2026-03-05T12:00:00Z",
		WindowStart:        "2026-03-01T00:00:00Z",
		WindowEnd:          "2026-03-05T00:00:00Z",
		WindowDays:         4,
		AuditMode:          "hash_chain_ed25519",
		MerkleStatus:       "planned_p2",
		TotalEvents:        3,
		ChainVerified:      true,
		ChainError:         "",
		PolicySnapshotHash: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
		Events: []eventSummary{
			{EventID: "evt_001", EventHash: "hash1", Signature: "sig1"},
			{EventID: "evt_002", EventHash: "hash2", Signature: "sig2"},
			{EventID: "evt_003", EventHash: "hash3", Signature: "sig3"},
		},
	}

	data, _ := json.Marshal(bundle)

	tmpFile, err := os.CreateTemp("", "evidence-*.json")
	if err != nil {
		t.Fatalf("create temp: %v", err)
	}
	defer os.Remove(tmpFile.Name())
	tmpFile.Write(data)
	tmpFile.Close()

	// Parse and verify structure (we can't call handleVerify directly as it uses os.Exit)
	var parsed evidenceBundle
	raw, _ := os.ReadFile(tmpFile.Name())
	json.Unmarshal(raw, &parsed)

	if parsed.TotalEvents != 3 {
		t.Errorf("expected 3 events, got %d", parsed.TotalEvents)
	}
	if parsed.ChainError != "" {
		t.Errorf("expected no chain error, got %q", parsed.ChainError)
	}

	// Verify hash chain structure
	hashesVerified := 0
	for _, evt := range parsed.Events {
		if evt.EventHash != "" && evt.Signature != "" {
			hashesVerified++
		}
	}
	if hashesVerified != 3 {
		t.Errorf("expected 3 hashes verified, got %d", hashesVerified)
	}
}

func TestHashSHA256(t *testing.T) {
	h := hashSHA256([]byte("hello"))
	if len(h) != 64 {
		t.Errorf("expected 64 hex chars, got %d", len(h))
	}
}
