package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/OolalaDXB/bawaba-command/internal/config"
)

func newTestQuotaManager(defaultLimit int, period string, overrides map[string]int) *QuotaManager {
	if overrides == nil {
		overrides = map[string]int{}
	}
	qm, err := NewQuotaManager(config.QuotaConfig{
		DefaultLimit: defaultLimit,
		Period:       period,
		Overrides:    overrides,
	})
	if err != nil {
		panic(err)
	}
	return qm
}

func TestQuotaAllowUnderLimit(t *testing.T) {
	qm := newTestQuotaManager(5, "1h", nil)

	for i := 0; i < 5; i++ {
		if !qm.Allow("agent-a") {
			t.Fatalf("expected Allow to return true on call %d", i+1)
		}
	}

	usage := qm.GetUsage("agent-a")
	if usage.Used != 5 {
		t.Errorf("expected used=5, got %d", usage.Used)
	}
	if usage.Remaining != 0 {
		t.Errorf("expected remaining=0, got %d", usage.Remaining)
	}
}

func TestQuotaDenyOverLimit(t *testing.T) {
	qm := newTestQuotaManager(3, "1h", nil)

	for i := 0; i < 3; i++ {
		qm.Allow("agent-b")
	}

	// 4th call should be denied
	if qm.Allow("agent-b") {
		t.Fatal("expected Allow to return false when quota exceeded")
	}

	usage := qm.GetUsage("agent-b")
	if usage.Used != 3 {
		t.Errorf("expected used=3, got %d", usage.Used)
	}
}

func TestQuotaResetAfterPeriod(t *testing.T) {
	qm := newTestQuotaManager(2, "100ms", nil)

	// Exhaust quota
	qm.Allow("agent-c")
	qm.Allow("agent-c")
	if qm.Allow("agent-c") {
		t.Fatal("should be denied before reset")
	}

	// Start the reset loop and wait for the period to elapse
	qm.Start()
	defer qm.Stop()

	time.Sleep(250 * time.Millisecond)

	// After reset, should be allowed again
	if !qm.Allow("agent-c") {
		t.Fatal("expected Allow to return true after reset")
	}
}

func TestQuotaOverridePerAgent(t *testing.T) {
	qm := newTestQuotaManager(2, "1h", map[string]int{
		"vip-agent": 100,
	})

	// Default agent limited to 2
	qm.Allow("normal")
	qm.Allow("normal")
	if qm.Allow("normal") {
		t.Fatal("normal agent should be denied at limit 2")
	}

	// VIP agent has override of 100
	for i := 0; i < 100; i++ {
		if !qm.Allow("vip-agent") {
			t.Fatalf("vip-agent should be allowed on call %d", i+1)
		}
	}
	if qm.Allow("vip-agent") {
		t.Fatal("vip-agent should be denied at limit 100")
	}

	usage := qm.GetUsage("vip-agent")
	if usage.Limit != 100 {
		t.Errorf("expected vip limit=100, got %d", usage.Limit)
	}
}

func TestQuotaMiddleware429(t *testing.T) {
	qm := newTestQuotaManager(1, "1h", nil)

	handler := qm.Middleware()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// First request: allowed
	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("X-Bawaba-Agent", "test-mw")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 on first request, got %d", rr.Code)
	}

	// Second request: denied
	rr2 := httptest.NewRecorder()
	req2 := httptest.NewRequest("GET", "/test", nil)
	req2.Header.Set("X-Bawaba-Agent", "test-mw")
	handler.ServeHTTP(rr2, req2)

	if rr2.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 on second request, got %d", rr2.Code)
	}

	retryAfter := rr2.Header().Get("Retry-After")
	if retryAfter == "" {
		t.Error("expected Retry-After header on 429 response")
	}

	// Verify error body
	var body struct {
		Meta struct {
			Error string `json:"error"`
		} `json:"meta"`
	}
	json.NewDecoder(rr2.Body).Decode(&body)
	if body.Meta.Error != "quota exceeded" {
		t.Errorf("expected error='quota exceeded', got %q", body.Meta.Error)
	}
}

func TestQuotaMiddlewareNoHeader(t *testing.T) {
	qm := newTestQuotaManager(1, "1h", nil)

	handler := qm.Middleware()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// Request without X-Bawaba-Agent should pass through
	req := httptest.NewRequest("GET", "/test", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 for request without agent header, got %d", rr.Code)
	}
}

func TestQuotaGetUsageUnknownAgent(t *testing.T) {
	qm := newTestQuotaManager(1000, "1h", nil)

	usage := qm.GetUsage("unknown-agent")
	if usage.Limit != 1000 {
		t.Errorf("expected default limit=1000, got %d", usage.Limit)
	}
	if usage.Used != 0 {
		t.Errorf("expected used=0, got %d", usage.Used)
	}
	if usage.Remaining != 1000 {
		t.Errorf("expected remaining=1000, got %d", usage.Remaining)
	}
}
