package proxy

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/OolalaDXB/bawaba-command/internal/audit"
	"github.com/OolalaDXB/bawaba-command/internal/auth"
	"github.com/OolalaDXB/bawaba-command/internal/config"
	"github.com/OolalaDXB/bawaba-command/internal/policy"
	"github.com/OolalaDXB/bawaba-command/internal/ratelimit"
	"github.com/OolalaDXB/bawaba-command/internal/router"
)

func newTestGateway(t *testing.T) (*Gateway, *auth.Engine) {
	t.Helper()

	logger := slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))

	authEngine := auth.NewEngine()
	authEngine.RegisterAgent("test-agent", "default", "api_key")
	authEngine.RegisterAPIKey("test-agent", "default", "test-key-123", nil)

	agentConfigs := map[string]config.AgentConfig{
		"test-agent": {
			Auth:         "api_key",
			AllowedTools: []string{"echo", "time"},
			DeniedTools:  []string{"database-write"},
			PIIMode:      "none",
			RateLimit:    "1000/hour",
			MaxResults:   50,
		},
	}

	policyEngine := policy.NewEngine(agentConfigs)

	limiter := ratelimit.NewLimiter()
	limiter.Configure("test-agent", 1000, time.Hour)

	anomaly := ratelimit.NewAnomalyDetector(20, 5*time.Minute)

	trail, _ := audit.NewTrail(nil, "")

	routingCfg := config.RoutingConfig{
		DefaultBackend: "localhost",
		Rules: []config.RoutingRule{
			{Jurisdiction: "ma", Backend: "inwi-dc-casa", Compliance: []string{"loi-09-08"}},
		},
	}
	routerEngine := router.NewEngine(routingCfg, trail.PrivateKey())

	gw := NewGateway(
		authEngine,
		policyEngine,
		limiter,
		anomaly,
		trail,
		routerEngine,
		agentConfigs,
		logger,
		false, // PII disabled for tests
		false, // header jurisdiction disabled for tests
		routingCfg.Rules,
	)

	return gw, authEngine
}

func TestHealthEndpoint(t *testing.T) {
	gw, _ := newTestGateway(t)

	req := httptest.NewRequest("GET", "/healthz", nil)
	w := httptest.NewRecorder()
	gw.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["status"] != "healthy" {
		t.Errorf("expected healthy, got %v", resp["status"])
	}
}

func TestUnauthenticatedRequest(t *testing.T) {
	gw, _ := newTestGateway(t)

	body := `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`
	req := httptest.NewRequest("POST", "/mcp", bytes.NewReader([]byte(body)))
	w := httptest.NewRecorder()
	gw.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", w.Code)
	}
}

func TestInitialize(t *testing.T) {
	gw, _ := newTestGateway(t)

	body := `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}`
	req := httptest.NewRequest("POST", "/mcp", bytes.NewReader([]byte(body)))
	req.Header.Set("X-Bawaba-Key", "test-key-123")
	w := httptest.NewRecorder()
	gw.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	var resp JSONRPCResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Error != nil {
		t.Errorf("expected no error, got: %s", resp.Error.Message)
	}
}

func TestToolsCallAllowed(t *testing.T) {
	gw, _ := newTestGateway(t)

	body := `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"echo","arguments":{"text":"hello"}}}`
	req := httptest.NewRequest("POST", "/mcp", bytes.NewReader([]byte(body)))
	req.Header.Set("X-Bawaba-Key", "test-key-123")
	w := httptest.NewRecorder()
	gw.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

func TestToolsCallDenied(t *testing.T) {
	gw, _ := newTestGateway(t)

	body := `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"database-write","arguments":{}}}`
	req := httptest.NewRequest("POST", "/mcp", bytes.NewReader([]byte(body)))
	req.Header.Set("X-Bawaba-Key", "test-key-123")
	w := httptest.NewRecorder()
	gw.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", w.Code)
	}
}

func TestToolsCallUnlisted(t *testing.T) {
	gw, _ := newTestGateway(t)

	body := `{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"secret-tool","arguments":{}}}`
	req := httptest.NewRequest("POST", "/mcp", bytes.NewReader([]byte(body)))
	req.Header.Set("X-Bawaba-Key", "test-key-123")
	w := httptest.NewRecorder()
	gw.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", w.Code)
	}
}

func TestToolsList(t *testing.T) {
	gw, _ := newTestGateway(t)

	body := `{"jsonrpc":"2.0","id":5,"method":"tools/list"}`
	req := httptest.NewRequest("POST", "/mcp", bytes.NewReader([]byte(body)))
	req.Header.Set("X-Bawaba-Key", "test-key-123")
	w := httptest.NewRecorder()
	gw.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	var resp JSONRPCResponse
	json.Unmarshal(w.Body.Bytes(), &resp)

	var result map[string]interface{}
	json.Unmarshal(resp.Result, &result)

	tools, ok := result["tools"].([]interface{})
	if !ok {
		t.Fatal("expected tools array in response")
	}
	if len(tools) != 2 {
		t.Errorf("expected 2 tools, got %d", len(tools))
	}
}

func TestFailClosedNoAuth(t *testing.T) {
	// Fail-closed: any request without auth is rejected
	gw, _ := newTestGateway(t)

	methods := []string{"initialize", "tools/list", "tools/call", "resources/list", "prompts/list"}
	for _, method := range methods {
		body := `{"jsonrpc":"2.0","id":1,"method":"` + method + `"}`
		req := httptest.NewRequest("POST", "/mcp", bytes.NewReader([]byte(body)))
		w := httptest.NewRecorder()
		gw.ServeHTTP(w, req)

		if w.Code != http.StatusUnauthorized {
			t.Errorf("method %s: expected 401, got %d", method, w.Code)
		}
	}
}
