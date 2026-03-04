package siem

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/OolalaDXB/bawaba-command/internal/config"
)

func sampleEvent() AuditEvent {
	return AuditEvent{
		EventID:      "evt_test_001",
		Timestamp:    "2026-03-04T12:00:00Z",
		EventType:    "tool_call",
		AgentID:      "test-agent",
		TenantID:     "default",
		Jurisdiction: "ma",
		Tool:         "echo",
		PolicyResult: "allow",
		PIIMode:      "none",
		LatencyMS:    1.5,
	}
}

func TestNoopForwarderDoesNotCrash(t *testing.T) {
	noop := &NoopForwarder{}

	// Should not panic
	noop.Forward(sampleEvent())
	noop.Forward(AuditEvent{})

	if err := noop.Health(); err != nil {
		t.Errorf("noop health should be nil, got %v", err)
	}

	if err := noop.Close(); err != nil {
		t.Errorf("noop close should be nil, got %v", err)
	}
}

func TestNewForwarderDisabled(t *testing.T) {
	fwd, err := NewForwarder(config.SIEMForwarderConfig{
		Enabled: false,
		Type:    "webhook",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Should return a NoopForwarder
	if _, ok := fwd.(*NoopForwarder); !ok {
		t.Errorf("expected NoopForwarder when disabled, got %T", fwd)
	}
}

func TestNewForwarderWebhookNoEndpoint(t *testing.T) {
	_, err := NewForwarder(config.SIEMForwarderConfig{
		Enabled:  true,
		Type:     "webhook",
		Endpoint: "",
	})
	if err == nil {
		t.Fatal("expected error when webhook enabled with empty endpoint")
	}
}

func TestWebhookForwarderSendsPOST(t *testing.T) {
	var received atomic.Int32
	var lastBody AuditEvent

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received.Add(1)

		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("expected Content-Type application/json, got %s", r.Header.Get("Content-Type"))
		}
		if r.Header.Get("Authorization") != "Bearer test-token" {
			t.Errorf("expected Authorization Bearer test-token, got %s", r.Header.Get("Authorization"))
		}

		json.NewDecoder(r.Body).Decode(&lastBody)
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()

	wf := NewWebhookForwarder(ts.URL, "test-token")
	evt := sampleEvent()

	wf.Forward(evt)

	// Wait for the goroutine to complete
	time.Sleep(200 * time.Millisecond)

	if received.Load() != 1 {
		t.Fatalf("expected 1 request, got %d", received.Load())
	}

	if lastBody.EventID != evt.EventID {
		t.Errorf("expected event_id=%s, got %s", evt.EventID, lastBody.EventID)
	}

	if err := wf.Health(); err != nil {
		t.Errorf("expected healthy after successful send, got %v", err)
	}
}

func TestWebhookForwarderRetryOn500(t *testing.T) {
	var attempts atomic.Int32

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := attempts.Add(1)
		if n <= 2 {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()

	wf := NewWebhookForwarder(ts.URL, "")
	wf.Forward(sampleEvent())

	// Wait for retries (1s + 2s + buffer)
	time.Sleep(5 * time.Second)

	if attempts.Load() != 3 {
		t.Errorf("expected 3 attempts (2 retries + 1 success), got %d", attempts.Load())
	}

	if err := wf.Health(); err != nil {
		t.Errorf("expected healthy after retry success, got %v", err)
	}
}

func TestWebhookForwarderNonBlocking(t *testing.T) {
	// Create a server that is slow
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(2 * time.Second)
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()

	wf := NewWebhookForwarder(ts.URL, "")

	start := time.Now()
	wf.Forward(sampleEvent())
	elapsed := time.Since(start)

	// Forward should return immediately (non-blocking)
	if elapsed > 100*time.Millisecond {
		t.Errorf("Forward took %v, expected to be non-blocking (<100ms)", elapsed)
	}
}

func TestWebhookForwarderNoRetryOn4xx(t *testing.T) {
	var attempts atomic.Int32

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts.Add(1)
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer ts.Close()

	wf := NewWebhookForwarder(ts.URL, "")
	wf.Forward(sampleEvent())

	// Wait a bit for the goroutine
	time.Sleep(500 * time.Millisecond)

	if attempts.Load() != 1 {
		t.Errorf("expected 1 attempt (no retry on 4xx), got %d", attempts.Load())
	}

	if err := wf.Health(); err == nil {
		t.Error("expected unhealthy after 4xx error")
	}
}
