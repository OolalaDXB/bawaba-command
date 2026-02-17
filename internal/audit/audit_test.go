package audit

import (
	"testing"
)

func TestAuditTrailInMemory(t *testing.T) {
	trail, err := NewTrail(nil, "")
	if err != nil {
		t.Fatalf("NewTrail() error: %v", err)
	}

	// Log an event
	err = trail.Log(Event{
		EventType:    "tool_call",
		AgentID:      "test-agent",
		TenantID:     "default",
		Jurisdiction: "eu",
		Tool:         "echo",
		PolicyResult: "allow",
	})
	if err != nil {
		t.Fatalf("Log() error: %v", err)
	}

	events := trail.GetEvents(10)
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}

	evt := events[0]
	if evt.AgentID != "test-agent" {
		t.Errorf("expected agent test-agent, got %s", evt.AgentID)
	}
	if evt.EventHash == "" {
		t.Error("expected non-empty event hash")
	}
	if evt.Signature == "" {
		t.Error("expected non-empty signature")
	}
	if evt.PrevHash != "genesis" {
		t.Errorf("expected prev_hash genesis, got %s", evt.PrevHash)
	}
}

func TestHashChain(t *testing.T) {
	trail, err := NewTrail(nil, "")
	if err != nil {
		t.Fatalf("NewTrail() error: %v", err)
	}

	// Log multiple events
	for i := 0; i < 5; i++ {
		err := trail.Log(Event{
			EventType:    "tool_call",
			AgentID:      "test-agent",
			TenantID:     "default",
			Jurisdiction: "eu",
			Tool:         "echo",
			PolicyResult: "allow",
		})
		if err != nil {
			t.Fatalf("Log() error at event %d: %v", i, err)
		}
	}

	events := trail.GetEvents(10)
	if len(events) != 5 {
		t.Fatalf("expected 5 events, got %d", len(events))
	}

	// Verify chain
	err = VerifyChain(events, trail.PublicKey())
	if err != nil {
		t.Fatalf("VerifyChain() error: %v", err)
	}
}

func TestChainTampering(t *testing.T) {
	trail, err := NewTrail(nil, "")
	if err != nil {
		t.Fatalf("NewTrail() error: %v", err)
	}

	for i := 0; i < 3; i++ {
		trail.Log(Event{
			EventType:    "tool_call",
			AgentID:      "test-agent",
			TenantID:     "default",
			Jurisdiction: "eu",
			Tool:         "echo",
			PolicyResult: "allow",
		})
	}

	events := trail.GetEvents(10)

	// Tamper with event hash
	events[1].EventHash = "tampered"

	err = VerifyChain(events, trail.PublicKey())
	if err == nil {
		t.Fatal("expected VerifyChain to detect tampering")
	}
}
