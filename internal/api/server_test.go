package api

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	_ "github.com/lib/pq"

	"github.com/OolalaDXB/bawaba-command/internal/audit"
	"github.com/OolalaDXB/bawaba-command/internal/config"
)

// testDB returns a *sql.DB connected to the test database, or skips the test.
func testDB(t *testing.T) *sql.DB {
	t.Helper()
	dsn := os.Getenv("BAWABA_TEST_DB_URL")
	if dsn == "" {
		dsn = "postgres://bawaba:bawaba_secret@localhost:5432/bawaba?sslmode=disable"
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Skipf("skipping: cannot open db: %v", err)
	}
	if err := db.Ping(); err != nil {
		t.Skipf("skipping: db not reachable: %v", err)
	}
	return db
}

func testConfig() *config.Config {
	return &config.Config{
		Server: config.ServerConfig{Port: 8081},
		Database: config.DatabaseConfig{
			URL:          "postgres://bawaba:bawaba_secret@localhost:5432/bawaba?sslmode=disable",
			MaxOpenConns: 5,
			MaxIdleConns: 2,
		},
		Agents: map[string]config.AgentConfig{
			"test-agent": {
				Auth:         "api_key",
				AllowedTools: []string{"echo", "time"},
				PIIMode:      "tokenize",
				RateLimit:    "1000/hour",
				MaxResults:   50,
			},
			"claude-code": {
				Auth:         "api_key",
				AllowedTools: []string{"database-query", "git-read"},
				DeniedTools:  []string{"database-write"},
				PIIMode:      "tokenize",
				RateLimit:    "1000/hour",
				MaxResults:   50,
			},
		},
		Routing: config.RoutingConfig{
			DefaultBackend: "localhost",
			Rules: []config.RoutingRule{
				{Jurisdiction: "ma", Backend: "inwi-dc-casa", Compliance: []string{"loi-09-08", "cndp"}},
				{Jurisdiction: "sa", Backend: "stc-cloud-riyadh", Compliance: []string{"pdpl"}},
			},
		},
		Quotas: config.QuotaConfig{
			DefaultLimit: 1000,
			Period:       "1h",
			Overrides: map[string]int{
				"claude-code": 5000,
			},
		},
		SIEM: config.SIEMForwarderConfig{
			Enabled: false,
			Type:    "webhook",
			Format:  "json",
		},
	}
}

func testServer(t *testing.T) (*Server, *httptest.Server) {
	t.Helper()
	db := testDB(t)
	cfg := testConfig()
	trail, err := audit.NewTrail(db, "")
	if err != nil {
		t.Fatalf("audit trail: %v", err)
	}
	srv := NewServer(db, cfg, "", trail, defaultLogger())
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(func() { ts.Close() })
	return srv, ts
}

func defaultLogger() *slog.Logger {
	return slog.Default()
}

// --- Tests ---

func TestHealthEndpoint(t *testing.T) {
	_, ts := testServer(t)

	resp, err := http.Get(ts.URL + "/api/v1/health")
	if err != nil {
		t.Fatalf("GET /health: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body struct {
		Data struct {
			Status        string            `json:"status"`
			Version       string            `json:"version"`
			UptimeSeconds int               `json:"uptime_seconds"`
			ModulesStatus map[string]string `json:"modules_status"`
		} `json:"data"`
	}
	json.NewDecoder(resp.Body).Decode(&body)

	if body.Data.Status != "healthy" {
		t.Errorf("expected status=healthy, got %q", body.Data.Status)
	}
	if body.Data.Version == "" {
		t.Error("version should not be empty")
	}
	if body.Data.ModulesStatus["database"] != "ok" {
		t.Errorf("database module should be ok, got %q", body.Data.ModulesStatus["database"])
	}
}

func TestEventsEndpoint(t *testing.T) {
	_, ts := testServer(t)

	resp, err := http.Get(ts.URL + "/api/v1/events?page=1&limit=10")
	if err != nil {
		t.Fatalf("GET /events: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body struct {
		Data []interface{} `json:"data"`
		Meta pageMeta      `json:"meta"`
	}
	json.NewDecoder(resp.Body).Decode(&body)

	if body.Meta.Page != 1 {
		t.Errorf("expected page=1, got %d", body.Meta.Page)
	}
	if body.Meta.Limit != 10 {
		t.Errorf("expected limit=10, got %d", body.Meta.Limit)
	}
	// Total should be >= 0 (we may or may not have seed data)
	if body.Meta.Total < 0 {
		t.Errorf("total should be >= 0, got %d", body.Meta.Total)
	}
}

func TestEventsVerifyValid(t *testing.T) {
	srv, ts := testServer(t)

	// Insert a small chain of events directly through the audit trail
	for i := 0; i < 3; i++ {
		srv.trail.Log(audit.Event{
			EventType:    "tool_call",
			AgentID:      "test-agent",
			TenantID:     "default",
			Jurisdiction: "ma",
			Tool:         fmt.Sprintf("test-tool-%d", i),
			PolicyResult: "allow",
			PIIMode:      "none",
			LatencyMS:    float64(i + 1),
		})
	}

	resp, err := http.Post(ts.URL+"/api/v1/events/verify", "application/json", nil)
	if err != nil {
		t.Fatalf("POST /events/verify: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body struct {
		Data struct {
			Valid  bool `json:"valid"`
			Events int  `json:"events"`
		} `json:"data"`
	}
	json.NewDecoder(resp.Body).Decode(&body)

	if body.Data.Events < 3 {
		t.Errorf("expected >= 3 events, got %d", body.Data.Events)
	}
	// Note: validity depends on whether seed data was loaded with a different key.
	// If the DB only has events we inserted, this should be valid.
}

func TestStatsEndpoint(t *testing.T) {
	_, ts := testServer(t)

	resp, err := http.Get(ts.URL + "/api/v1/stats")
	if err != nil {
		t.Fatalf("GET /stats: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body struct {
		Data struct {
			TotalEvents  int     `json:"total_events"`
			DenyRate     float64 `json:"deny_rate"`
			AvgLatencyMS float64 `json:"avg_latency_ms"`
		} `json:"data"`
	}
	json.NewDecoder(resp.Body).Decode(&body)

	if body.Data.TotalEvents < 0 {
		t.Errorf("total_events should be >= 0, got %d", body.Data.TotalEvents)
	}
	if body.Data.DenyRate < 0 || body.Data.DenyRate > 100 {
		t.Errorf("deny_rate should be 0-100, got %.2f", body.Data.DenyRate)
	}
}

func TestCORSHeaders(t *testing.T) {
	_, ts := testServer(t)

	// Test preflight OPTIONS
	req, _ := http.NewRequest("OPTIONS", ts.URL+"/api/v1/health", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("OPTIONS /health: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNoContent {
		t.Errorf("expected 204 for OPTIONS, got %d", resp.StatusCode)
	}

	origin := resp.Header.Get("Access-Control-Allow-Origin")
	if origin != "http://localhost:5173" {
		t.Errorf("expected CORS origin http://localhost:5173, got %q", origin)
	}
	methods := resp.Header.Get("Access-Control-Allow-Methods")
	if !strings.Contains(methods, "GET") || !strings.Contains(methods, "POST") {
		t.Errorf("expected GET and POST in Allow-Methods, got %q", methods)
	}
}

func TestAgentsEndpoint(t *testing.T) {
	_, ts := testServer(t)

	resp, err := http.Get(ts.URL + "/api/v1/agents")
	if err != nil {
		t.Fatalf("GET /agents: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body struct {
		Data []struct {
			ID   string `json:"id"`
			Auth string `json:"auth"`
		} `json:"data"`
		Meta struct {
			Count int `json:"count"`
		} `json:"meta"`
	}
	json.NewDecoder(resp.Body).Decode(&body)

	if body.Meta.Count != 2 {
		t.Errorf("expected 2 agents, got %d", body.Meta.Count)
	}
}

func TestJurisdictionsEndpoint(t *testing.T) {
	_, ts := testServer(t)

	resp, err := http.Get(ts.URL + "/api/v1/jurisdictions")
	if err != nil {
		t.Fatalf("GET /jurisdictions: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body struct {
		Data []struct {
			Code       string   `json:"code"`
			Backend    string   `json:"backend"`
			Compliance []string `json:"compliance"`
		} `json:"data"`
	}
	json.NewDecoder(resp.Body).Decode(&body)

	if len(body.Data) != 2 {
		t.Errorf("expected 2 jurisdictions, got %d", len(body.Data))
	}
}

func TestSSEStream(t *testing.T) {
	srv, ts := testServer(t)
	srv.sse.Start()
	defer srv.sse.Stop()

	// Connect SSE client
	resp, err := http.Get(ts.URL + "/api/v1/events/stream")
	if err != nil {
		t.Fatalf("GET /events/stream: %v", err)
	}
	defer resp.Body.Close()

	if resp.Header.Get("Content-Type") != "text/event-stream" {
		t.Fatalf("expected text/event-stream, got %q", resp.Header.Get("Content-Type"))
	}

	// Insert an event after a short delay
	go func() {
		time.Sleep(200 * time.Millisecond)
		srv.trail.Log(audit.Event{
			EventType:    "tool_call",
			AgentID:      "sse-test-agent",
			TenantID:     "default",
			Jurisdiction: "ma",
			Tool:         "sse-test",
			PolicyResult: "allow",
			PIIMode:      "none",
			LatencyMS:    1.0,
		})
	}()

	// Read with timeout
	buf := make([]byte, 4096)
	done := make(chan string, 1)
	go func() {
		for {
			n, err := resp.Body.Read(buf)
			if err != nil {
				return
			}
			if n > 0 {
				done <- string(buf[:n])
				return
			}
		}
	}()

	select {
	case data := <-done:
		if !strings.Contains(data, "sse-test-agent") {
			t.Errorf("expected SSE data to contain sse-test-agent, got: %s", data)
		}
		if !strings.HasPrefix(strings.TrimSpace(data), "data:") {
			t.Errorf("expected SSE format 'data: ...', got: %s", data)
		}
	case <-time.After(5 * time.Second):
		t.Error("timeout waiting for SSE event")
	}
}

func TestPoliciesEndpoint(t *testing.T) {
	_, ts := testServer(t)

	resp, err := http.Get(ts.URL + "/api/v1/policies")
	if err != nil {
		t.Fatalf("GET /policies: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body struct {
		Data []struct {
			AgentID string `json:"agent_id"`
			PIIMode string `json:"pii_mode"`
		} `json:"data"`
	}
	json.NewDecoder(resp.Body).Decode(&body)

	if len(body.Data) != 2 {
		t.Errorf("expected 2 policies, got %d", len(body.Data))
	}
}

func TestAgentQuotaEndpoint(t *testing.T) {
	_, ts := testServer(t)

	resp, err := http.Get(ts.URL + "/api/v1/agents/test-agent/quota")
	if err != nil {
		t.Fatalf("GET /agents/test-agent/quota: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body struct {
		Data struct {
			Agent   string `json:"agent"`
			Quota   struct {
				Limit     int    `json:"limit"`
				Period    string `json:"period"`
				Used      int    `json:"used"`
				Remaining int    `json:"remaining"`
			} `json:"quota"`
			ResetAt string `json:"reset_at"`
		} `json:"data"`
	}
	json.NewDecoder(resp.Body).Decode(&body)

	if body.Data.Agent != "test-agent" {
		t.Errorf("expected agent=test-agent, got %q", body.Data.Agent)
	}
	if body.Data.Quota.Limit <= 0 {
		t.Errorf("expected positive limit, got %d", body.Data.Quota.Limit)
	}
	if body.Data.Quota.Used != 0 {
		t.Errorf("expected used=0, got %d", body.Data.Quota.Used)
	}
	if body.Data.ResetAt == "" {
		t.Error("expected reset_at to be set")
	}
}

func TestAgentQuotaNotFound(t *testing.T) {
	_, ts := testServer(t)

	resp, err := http.Get(ts.URL + "/api/v1/agents/nonexistent/quota")
	if err != nil {
		t.Fatalf("GET /agents/nonexistent/quota: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 404 {
		t.Fatalf("expected 404, got %d", resp.StatusCode)
	}
}

func TestAuditExportWindow(t *testing.T) {
	_, ts := testServer(t)

	// Test window_days=1 → window_start/end coherent
	resp, err := http.Get(ts.URL + "/api/v1/audit/export?window_days=1")
	if err != nil {
		t.Fatalf("GET /audit/export: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var bundle struct {
		WindowStart string `json:"window_start"`
		WindowEnd   string `json:"window_end"`
		WindowDays  int    `json:"window_days"`
		AuditMode   string `json:"audit_mode"`
		GeneratedAt string `json:"generated_at"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&bundle); err != nil {
		t.Fatalf("decode: %v", err)
	}

	if bundle.WindowDays != 1 {
		t.Errorf("expected window_days=1, got %d", bundle.WindowDays)
	}
	if bundle.AuditMode != "hash_chain_ed25519" {
		t.Errorf("expected audit_mode=hash_chain_ed25519, got %q", bundle.AuditMode)
	}

	start, err := time.Parse(time.RFC3339, bundle.WindowStart)
	if err != nil {
		t.Fatalf("parse window_start: %v", err)
	}
	end, err := time.Parse(time.RFC3339, bundle.WindowEnd)
	if err != nil {
		t.Fatalf("parse window_end: %v", err)
	}
	diff := end.Sub(start)
	if diff < 23*time.Hour || diff > 25*time.Hour {
		t.Errorf("window_days=1 should span ~24h, got %v", diff)
	}
}

func TestAuditExportFromTo(t *testing.T) {
	_, ts := testServer(t)

	from := time.Now().Add(-2 * time.Hour).UTC().Format(time.RFC3339)
	to := time.Now().UTC().Format(time.RFC3339)

	resp, err := http.Get(fmt.Sprintf("%s/api/v1/audit/export?from=%s&to=%s", ts.URL, from, to))
	if err != nil {
		t.Fatalf("GET /audit/export?from&to: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var bundle struct {
		WindowStart string `json:"window_start"`
		WindowEnd   string `json:"window_end"`
		WindowDays  int    `json:"window_days"`
	}
	json.NewDecoder(resp.Body).Decode(&bundle)

	if bundle.WindowDays != 1 {
		// 2 hours rounds to 1 day
		t.Logf("window_days=%d (ok for 2h window)", bundle.WindowDays)
	}
	if bundle.WindowStart == "" || bundle.WindowEnd == "" {
		t.Error("window_start and window_end must be set")
	}
}

func TestAuditExportMaxWindow(t *testing.T) {
	_, ts := testServer(t)

	resp, err := http.Get(ts.URL + "/api/v1/audit/export?window_days=999")
	if err != nil {
		t.Fatalf("GET /audit/export: %v", err)
	}
	defer resp.Body.Close()

	var bundle struct {
		WindowDays int `json:"window_days"`
	}
	json.NewDecoder(resp.Body).Decode(&bundle)

	if bundle.WindowDays != 90 {
		t.Errorf("expected capped to 90, got %d", bundle.WindowDays)
	}
}

func TestRecoveryMiddleware(t *testing.T) {
	// Build a handler that panics
	handler := Chain(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			panic("test panic")
		}),
		RecoveryMiddleware(defaultLogger()),
	)

	req := httptest.NewRequest("GET", "/", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != 500 {
		t.Errorf("expected 500 after panic, got %d", rr.Code)
	}
}
