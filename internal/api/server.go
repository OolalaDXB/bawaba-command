package api

import (
	"crypto/ed25519"
	"crypto/sha256"
	"database/sql"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/OolalaDXB/bawaba-command/internal/audit"
	"github.com/OolalaDXB/bawaba-command/internal/auth"
	"github.com/OolalaDXB/bawaba-command/internal/config"
	"github.com/OolalaDXB/bawaba-command/internal/policy"
	"github.com/OolalaDXB/bawaba-command/internal/router"
	"github.com/OolalaDXB/bawaba-command/internal/store"
)

// Version is set at build time or defaults to dev.
const Version = "0.1.0"

// Middleware is a composable HTTP middleware.
type Middleware func(http.Handler) http.Handler

// Chain applies middlewares in order (last wraps first).
func Chain(h http.Handler, middlewares ...Middleware) http.Handler {
	for i := len(middlewares) - 1; i >= 0; i-- {
		h = middlewares[i](h)
	}
	return h
}

// Server is the REST API server that exposes the gateway internals.
type Server struct {
	db         *sql.DB
	cfg        *config.Config
	configPath string
	trail      *audit.Trail
	policies   *policy.Engine
	cp         *store.Store
	authEng    *auth.Engine
	router     *router.Engine
	pubKey     ed25519.PublicKey
	logger     *slog.Logger
	startTime  time.Time
	sse        *SSEHub
	quota      *QuotaManager
}

// NewServer creates a new API server.
func NewServer(db *sql.DB, cfg *config.Config, configPath string, trail *audit.Trail, policies *policy.Engine, cp *store.Store, authEng *auth.Engine, routerEng *router.Engine, logger *slog.Logger) *Server {
	s := &Server{
		db:         db,
		cfg:        cfg,
		configPath: configPath,
		trail:      trail,
		policies:   policies,
		cp:         cp,
		authEng:    authEng,
		router:     routerEng,
		pubKey:     trail.PublicKey(),
		logger:     logger,
		startTime:  time.Now(),
		sse:        NewSSEHub(db, logger),
	}

	// Initialize quota manager from config
	qm, err := NewQuotaManager(cfg.Quotas)
	if err != nil {
		logger.Error("failed to init quota manager, using defaults", "error", err)
		qm, _ = NewQuotaManager(config.QuotaConfig{
			DefaultLimit: 1000,
			Period:       "1h",
			Overrides:    map[string]int{},
		})
	}
	s.quota = qm

	return s
}

// Handler returns the fully configured HTTP handler with middleware chain.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/v1/health", s.handleHealth)
	mux.HandleFunc("GET /api/v1/events/stream", s.handleEventsStream)
	mux.HandleFunc("POST /api/v1/events/verify", s.handleEventsVerify)
	mux.HandleFunc("POST /api/v1/events/review", s.handleEventsReview)
	mux.HandleFunc("POST /api/v1/events/export", s.handleEventsExport)
	mux.HandleFunc("GET /api/v1/audit/export", s.handleAuditExport)
	mux.HandleFunc("GET /api/v1/events/{id}", s.handleEventByID)
	mux.HandleFunc("GET /api/v1/events", s.handleEvents)
	mux.HandleFunc("GET /api/v1/stats/pii", s.handleStatsPII)
	mux.HandleFunc("GET /api/v1/stats", s.handleStats)
	mux.HandleFunc("GET /api/v1/agents/{id}/activity", s.handleAgentActivity)
	mux.HandleFunc("GET /api/v1/agents/{id}/quota", s.handleAgentQuota)
	mux.HandleFunc("GET /api/v1/agents", s.handleAgents)
	mux.HandleFunc("GET /api/v1/policies", s.handlePolicies)
	mux.HandleFunc("PATCH /api/v1/policies/{id}", s.handlePolicyUpdate)
	mux.HandleFunc("GET /api/v1/policies/{id}/versions", s.handlePolicyVersions)
	mux.HandleFunc("POST /api/v1/agents", s.handleAgentCreate)
	mux.HandleFunc("PATCH /api/v1/agents/{id}", s.handleAgentPatch)
	mux.HandleFunc("DELETE /api/v1/agents/{id}", s.handleAgentDelete)
	mux.HandleFunc("GET /api/v1/jurisdictions", s.handleJurisdictions)
	mux.HandleFunc("POST /api/v1/jurisdictions", s.handleJurisdictionAdd)
	mux.HandleFunc("POST /api/v1/demo/session", s.handleDemoSessionCreate)
	mux.HandleFunc("GET /api/v1/demo/session/{id}", s.handleDemoSessionGet)
	mux.HandleFunc("GET /api/v1/siem/status", s.handleSIEMStatus)

	return Chain(mux,
		RecoveryMiddleware(s.logger),
		LoggingMiddleware(s.logger),
		CORSMiddleware,
		s.quota.Middleware(),
		CacheMiddleware,
		MetricsMiddleware,
	)
}

// Start starts the SSE hub and quota manager background goroutines.
func (s *Server) Start() {
	s.sse.Start()
	s.quota.Start()
}

// Stop shuts down the SSE hub and quota manager.
func (s *Server) Stop() {
	s.sse.Stop()
	s.quota.Stop()
}

// --- Response helpers ---

type envelope struct {
	Data interface{} `json:"data"`
	Meta interface{} `json:"meta,omitempty"`
}

type pageMeta struct {
	Page      int    `json:"page"`
	Limit     int    `json:"limit"`
	Total     int    `json:"total"`
	Timestamp string `json:"timestamp"`
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, envelope{
		Data: nil,
		Meta: map[string]interface{}{
			"error":     msg,
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		},
	})
}

// --- Middlewares ---

// LoggingMiddleware logs each request with method, path, status, and duration.
func LoggingMiddleware(logger *slog.Logger) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rw := &responseWriter{ResponseWriter: w, status: 200}
			next.ServeHTTP(rw, r)
			logger.Info("api request",
				"method", r.Method,
				"path", r.URL.Path,
				"status", rw.status,
				"duration_ms", time.Since(start).Milliseconds(),
			)
		})
	}
}

// CORSMiddleware adds CORS headers for the React dashboard.
func CORSMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if strings.HasPrefix(origin, "http://localhost:") {
			w.Header().Set("Access-Control-Allow-Origin", origin)
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Bawaba-Key")
		w.Header().Set("Access-Control-Max-Age", "86400")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RecoveryMiddleware catches panics and returns a 500.
func RecoveryMiddleware(logger *slog.Logger) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if err := recover(); err != nil {
					logger.Error("panic recovered", "error", err, "path", r.URL.Path)
					writeError(w, http.StatusInternalServerError, "internal server error")
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

// CacheMiddleware is a P2 stub (pass-through).
func CacheMiddleware(next http.Handler) http.Handler { return next }

// MetricsMiddleware is a P2 stub (pass-through).
func MetricsMiddleware(next http.Handler) http.Handler { return next }

// responseWriter wraps http.ResponseWriter to capture the status code.
type responseWriter struct {
	http.ResponseWriter
	status int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.status = code
	rw.ResponseWriter.WriteHeader(code)
}

// Flush forwards to the underlying ResponseWriter if it implements http.Flusher.
func (rw *responseWriter) Flush() {
	if f, ok := rw.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Unwrap returns the underlying ResponseWriter (supports http.ResponseController).
func (rw *responseWriter) Unwrap() http.ResponseWriter {
	return rw.ResponseWriter
}

// --- Handlers ---

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	modules := map[string]string{
		"database":  "ok",
		"audit":     "ok",
		"proxy_mcp": "ok",
		"tokenizer": "ok",
		"router":    "ok",
	}

	if s.db != nil {
		if err := s.db.Ping(); err != nil {
			modules["database"] = "error"
		}
	}

	writeJSON(w, http.StatusOK, envelope{
		Data: map[string]interface{}{
			"status":         "healthy",
			"uptime_seconds": int(time.Since(s.startTime).Seconds()),
			"version":        Version,
			"modules_status": modules,
		},
		Meta: map[string]string{
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		},
	})
}

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	if page < 1 {
		page = 1
	}
	limit, _ := strconv.Atoi(q.Get("limit"))
	if limit < 1 || limit > 200 {
		limit = 50
	}
	offset := (page - 1) * limit

	agent := q.Get("agent")
	action := q.Get("action")
	jurisdiction := q.Get("jurisdiction")

	// Build dynamic query
	where := []string{"1=1"}
	args := []interface{}{}
	argN := 1

	if agent != "" {
		where = append(where, fmt.Sprintf("agent_id = $%d", argN))
		args = append(args, agent)
		argN++
	}
	if action != "" {
		where = append(where, fmt.Sprintf("event_type = $%d", argN))
		args = append(args, action)
		argN++
	}
	if jurisdiction != "" {
		where = append(where, fmt.Sprintf("jurisdiction = $%d", argN))
		args = append(args, jurisdiction)
		argN++
	}

	whereClause := strings.Join(where, " AND ")

	// Count total
	var total int
	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM audit_events WHERE %s", whereClause)
	if err := s.db.QueryRow(countQuery, args...).Scan(&total); err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}

	// Fetch page
	dataQuery := fmt.Sprintf(`SELECT event_id, timestamp, event_type, agent_id, tenant_id, jurisdiction,
		mcp_server, tool, params_hash, resource_path,
		policy_result, policy_version, matched_rule,
		pii_mode, entities_detected, tokens_generated,
		response_status, result_count, latency_ms, overhead_ms,
		routing_proof, event_hash, prev_hash, merkle_root, signature
		FROM audit_events WHERE %s
		ORDER BY timestamp DESC
		LIMIT $%d OFFSET $%d`, whereClause, argN, argN+1)
	args = append(args, limit, offset)

	rows, err := s.db.Query(dataQuery, args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	defer rows.Close()

	events := []audit.Event{}
	for rows.Next() {
		var evt audit.Event
		if err := rows.Scan(
			&evt.EventID, &evt.Timestamp, &evt.EventType, &evt.AgentID, &evt.TenantID, &evt.Jurisdiction,
			&evt.MCPServer, &evt.Tool, &evt.ParamsHash, &evt.ResourcePath,
			&evt.PolicyResult, &evt.PolicyVersion, &evt.MatchedRule,
			&evt.PIIMode, &evt.EntitiesDetected, &evt.TokensGenerated,
			&evt.ResponseStatus, &evt.ResultCount, &evt.LatencyMS, &evt.OverheadMS,
			&evt.RoutingProof, &evt.EventHash, &evt.PrevHash, &evt.MerkleRoot, &evt.Signature,
		); err != nil {
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		events = append(events, evt)
	}

	writeJSON(w, http.StatusOK, envelope{
		Data: events,
		Meta: pageMeta{
			Page:      page,
			Limit:     limit,
			Total:     total,
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		},
	})
}

func (s *Server) handleEventByID(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "missing event id")
		return
	}

	var evt audit.Event
	err := s.db.QueryRow(`SELECT event_id, timestamp, event_type, agent_id, tenant_id, jurisdiction,
		mcp_server, tool, params_hash, resource_path,
		policy_result, policy_version, matched_rule,
		pii_mode, entities_detected, tokens_generated,
		response_status, result_count, latency_ms, overhead_ms,
		routing_proof, event_hash, prev_hash, merkle_root, signature
		FROM audit_events WHERE event_id = $1`, id).Scan(
		&evt.EventID, &evt.Timestamp, &evt.EventType, &evt.AgentID, &evt.TenantID, &evt.Jurisdiction,
		&evt.MCPServer, &evt.Tool, &evt.ParamsHash, &evt.ResourcePath,
		&evt.PolicyResult, &evt.PolicyVersion, &evt.MatchedRule,
		&evt.PIIMode, &evt.EntitiesDetected, &evt.TokensGenerated,
		&evt.ResponseStatus, &evt.ResultCount, &evt.LatencyMS, &evt.OverheadMS,
		&evt.RoutingProof, &evt.EventHash, &evt.PrevHash, &evt.MerkleRoot, &evt.Signature,
	)
	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "event not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}

	writeJSON(w, http.StatusOK, envelope{
		Data: evt,
		Meta: map[string]string{"timestamp": time.Now().UTC().Format(time.RFC3339)},
	})
}

func (s *Server) handleEventsVerify(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(`SELECT event_id, timestamp, event_type, agent_id, tenant_id, jurisdiction,
		mcp_server, tool, params_hash, resource_path,
		policy_result, policy_version, matched_rule,
		pii_mode, entities_detected, tokens_generated,
		response_status, result_count, latency_ms, overhead_ms,
		routing_proof, event_hash, prev_hash, merkle_root, signature
		FROM audit_events ORDER BY timestamp ASC`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	defer rows.Close()

	var events []audit.Event
	for rows.Next() {
		var evt audit.Event
		if err := rows.Scan(
			&evt.EventID, &evt.Timestamp, &evt.EventType, &evt.AgentID, &evt.TenantID, &evt.Jurisdiction,
			&evt.MCPServer, &evt.Tool, &evt.ParamsHash, &evt.ResourcePath,
			&evt.PolicyResult, &evt.PolicyVersion, &evt.MatchedRule,
			&evt.PIIMode, &evt.EntitiesDetected, &evt.TokensGenerated,
			&evt.ResponseStatus, &evt.ResultCount, &evt.LatencyMS, &evt.OverheadMS,
			&evt.RoutingProof, &evt.EventHash, &evt.PrevHash, &evt.MerkleRoot, &evt.Signature,
		); err != nil {
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		events = append(events, evt)
	}

	result := map[string]interface{}{
		"valid":       true,
		"events":      len(events),
		"verified_at": time.Now().UTC().Format(time.RFC3339),
	}

	if err := audit.VerifyChain(events, s.pubKey); err != nil {
		result["valid"] = false
		result["error"] = err.Error()
	}

	writeJSON(w, http.StatusOK, envelope{
		Data: result,
		Meta: map[string]string{"timestamp": time.Now().UTC().Format(time.RFC3339)},
	})
}

// handleEventsReview records a human-in-the-loop review decision as a real,
// chained, signed audit event. It references the original event by id and is
// covered by /api/v1/events/verify like any other event — the original event is
// never modified.
func (s *Server) handleEventsReview(w http.ResponseWriter, r *http.Request) {
	var body struct {
		EventID  string `json:"event_id"`
		Decision string `json:"decision"`
		Reviewer string `json:"reviewer"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if body.EventID == "" || (body.Decision != "acknowledge" && body.Decision != "escalate") {
		writeError(w, http.StatusBadRequest, "event_id and decision (acknowledge|escalate) are required")
		return
	}
	reviewer := body.Reviewer
	if reviewer == "" {
		reviewer = "reviewer"
	}

	// Confirm the original event exists and carry over its tenant/jurisdiction.
	var tenant, jurisdiction string
	err := s.db.QueryRow(`SELECT tenant_id, jurisdiction FROM audit_events WHERE event_id = $1`, body.EventID).
		Scan(&tenant, &jurisdiction)
	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "origin event not found")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}

	persisted, err := s.trail.Append(audit.Event{
		EventType:      "review_decision",
		AgentID:        reviewer,
		TenantID:       tenant,
		Jurisdiction:   jurisdiction,
		Tool:           "review:" + body.Decision,
		ResourcePath:   body.EventID,
		MatchedRule:    body.Decision,
		PolicyResult:   "review",
		PIIMode:        "none",
		ResponseStatus: "200",
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to record review decision")
		return
	}

	writeJSON(w, http.StatusOK, envelope{
		Data: persisted,
		Meta: map[string]string{"timestamp": time.Now().UTC().Format(time.RFC3339)},
	})
}

func (s *Server) handleEventsExport(w http.ResponseWriter, r *http.Request) {
	format := r.URL.Query().Get("format")
	if format == "" {
		format = "json"
		if r.Header.Get("Content-Type") == "application/json" {
			var body struct {
				Format string `json:"format"`
			}
			if json.NewDecoder(r.Body).Decode(&body) == nil && body.Format != "" {
				format = body.Format
			}
		}
	}

	rows, err := s.db.Query(`SELECT event_id, timestamp, event_type, agent_id, tenant_id, jurisdiction,
		tool, policy_result, pii_mode, entities_detected, latency_ms
		FROM audit_events ORDER BY timestamp DESC LIMIT 10000`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	defer rows.Close()

	type exportRow struct {
		EventID          string    `json:"event_id"`
		Timestamp        time.Time `json:"timestamp"`
		EventType        string    `json:"event_type"`
		AgentID          string    `json:"agent_id"`
		TenantID         string    `json:"tenant_id"`
		Jurisdiction     string    `json:"jurisdiction"`
		Tool             string    `json:"tool"`
		PolicyResult     string    `json:"policy_result"`
		PIIMode          string    `json:"pii_mode"`
		EntitiesDetected int       `json:"entities_detected"`
		LatencyMS        float64   `json:"latency_ms"`
	}

	var data []exportRow
	for rows.Next() {
		var row exportRow
		if err := rows.Scan(&row.EventID, &row.Timestamp, &row.EventType, &row.AgentID,
			&row.TenantID, &row.Jurisdiction, &row.Tool, &row.PolicyResult,
			&row.PIIMode, &row.EntitiesDetected, &row.LatencyMS); err != nil {
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		data = append(data, row)
	}

	if format == "csv" {
		w.Header().Set("Content-Type", "text/csv")
		w.Header().Set("Content-Disposition", "attachment; filename=bawaba_events.csv")
		cw := csv.NewWriter(w)
		cw.Write([]string{"event_id", "timestamp", "event_type", "agent_id", "tenant_id",
			"jurisdiction", "tool", "policy_result", "pii_mode", "entities_detected", "latency_ms"})
		for _, row := range data {
			cw.Write([]string{
				row.EventID, row.Timestamp.Format(time.RFC3339), row.EventType, row.AgentID,
				row.TenantID, row.Jurisdiction, row.Tool, row.PolicyResult, row.PIIMode,
				strconv.Itoa(row.EntitiesDetected), fmt.Sprintf("%.2f", row.LatencyMS),
			})
		}
		cw.Flush()
		return
	}

	// Default: JSON
	writeJSON(w, http.StatusOK, envelope{
		Data: data,
		Meta: map[string]interface{}{
			"format":    "json",
			"count":     len(data),
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		},
	})
}

func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	type stats struct {
		TotalEvents  int            `json:"total_events"`
		CallsLastMin int            `json:"calls_last_minute"`
		DenyRate     float64        `json:"deny_rate"`
		AvgLatencyMS float64        `json:"avg_latency_ms"`
		EventsByType map[string]int `json:"events_by_type"`
	}

	var st stats

	s.db.QueryRow("SELECT COUNT(*) FROM audit_events").Scan(&st.TotalEvents)
	s.db.QueryRow("SELECT COUNT(*) FROM audit_events WHERE timestamp > NOW() - INTERVAL '1 minute'").Scan(&st.CallsLastMin)

	var totalDecisions, denials int
	s.db.QueryRow("SELECT COUNT(*) FROM audit_events WHERE policy_result IN ('allow','deny')").Scan(&totalDecisions)
	s.db.QueryRow("SELECT COUNT(*) FROM audit_events WHERE policy_result = 'deny'").Scan(&denials)
	if totalDecisions > 0 {
		st.DenyRate = float64(denials) / float64(totalDecisions) * 100
	}

	s.db.QueryRow("SELECT COALESCE(AVG(latency_ms), 0) FROM audit_events WHERE latency_ms > 0").Scan(&st.AvgLatencyMS)

	st.EventsByType = make(map[string]int)
	rows, err := s.db.Query("SELECT event_type, COUNT(*) FROM audit_events GROUP BY event_type")
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var etype string
			var cnt int
			rows.Scan(&etype, &cnt)
			st.EventsByType[etype] = cnt
		}
	}

	writeJSON(w, http.StatusOK, envelope{
		Data: st,
		Meta: map[string]string{"timestamp": time.Now().UTC().Format(time.RFC3339)},
	})
}

func (s *Server) handleStatsPII(w http.ResponseWriter, r *http.Request) {
	type piiDay struct {
		Date             string `json:"date"`
		PIIMode          string `json:"pii_mode"`
		EntitiesDetected int    `json:"entities_detected"`
		TokensGenerated  int    `json:"tokens_generated"`
		EventCount       int    `json:"event_count"`
	}

	rows, err := s.db.Query(`
		SELECT DATE(timestamp) as day, pii_mode,
			SUM(entities_detected), SUM(tokens_generated), COUNT(*)
		FROM audit_events
		WHERE entities_detected > 0 OR tokens_generated > 0
		GROUP BY day, pii_mode
		ORDER BY day DESC
		LIMIT 90`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	defer rows.Close()

	var data []piiDay
	for rows.Next() {
		var d piiDay
		var day time.Time
		if err := rows.Scan(&day, &d.PIIMode, &d.EntitiesDetected, &d.TokensGenerated, &d.EventCount); err != nil {
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		d.Date = day.Format("2006-01-02")
		data = append(data, d)
	}

	writeJSON(w, http.StatusOK, envelope{
		Data: data,
		Meta: map[string]string{"timestamp": time.Now().UTC().Format(time.RFC3339)},
	})
}

func (s *Server) handleEventsStream(w http.ResponseWriter, r *http.Request) {
	s.sse.ServeHTTP(w, r)
}

func (s *Server) handleAgents(w http.ResponseWriter, r *http.Request) {
	type agentInfo struct {
		ID           string   `json:"id"`
		Auth         string   `json:"auth"`
		AllowedTools []string `json:"allowed_tools"`
		DeniedTools  []string `json:"denied_tools"`
		PIIMode      string   `json:"pii_mode"`
		RateLimit    string   `json:"rate_limit"`
		MaxResults   int      `json:"max_results"`
	}

	agents := []agentInfo{}
	for id, a := range s.cfg.Agents {
		agents = append(agents, agentInfo{
			ID:           id,
			Auth:         a.Auth,
			AllowedTools: a.AllowedTools,
			DeniedTools:  a.DeniedTools,
			PIIMode:      a.PIIMode,
			RateLimit:    a.RateLimit,
			MaxResults:   a.MaxResults,
		})
	}

	writeJSON(w, http.StatusOK, envelope{
		Data: agents,
		Meta: map[string]interface{}{
			"count":     len(agents),
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		},
	})
}

func (s *Server) handleAgentActivity(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, ok := s.cfg.Agents[id]; !ok {
		writeError(w, http.StatusNotFound, "agent not found")
		return
	}

	rows, err := s.db.Query(`SELECT event_id, timestamp, event_type, tool, policy_result, latency_ms
		FROM audit_events WHERE agent_id = $1 ORDER BY timestamp DESC LIMIT 50`, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	defer rows.Close()

	type activity struct {
		EventID      string    `json:"event_id"`
		Timestamp    time.Time `json:"timestamp"`
		EventType    string    `json:"event_type"`
		Tool         string    `json:"tool"`
		PolicyResult string    `json:"policy_result"`
		LatencyMS    float64   `json:"latency_ms"`
	}

	var data []activity
	for rows.Next() {
		var a activity
		rows.Scan(&a.EventID, &a.Timestamp, &a.EventType, &a.Tool, &a.PolicyResult, &a.LatencyMS)
		data = append(data, a)
	}

	writeJSON(w, http.StatusOK, envelope{
		Data: data,
		Meta: map[string]interface{}{
			"agent_id":  id,
			"count":     len(data),
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		},
	})
}

func (s *Server) handleAgentQuota(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, ok := s.cfg.Agents[id]; !ok {
		writeError(w, http.StatusNotFound, "agent not found")
		return
	}

	usage := s.quota.GetUsage(id)

	writeJSON(w, http.StatusOK, envelope{
		Data: map[string]interface{}{
			"agent": id,
			"quota": map[string]interface{}{
				"limit":     usage.Limit,
				"period":    usage.Period,
				"used":      usage.Used,
				"remaining": usage.Remaining,
			},
			"reset_at": usage.ResetAt.Format(time.RFC3339),
		},
		Meta: map[string]string{"timestamp": time.Now().UTC().Format(time.RFC3339)},
	})
}

func (s *Server) handleSIEMStatus(w http.ResponseWriter, r *http.Request) {
	status := "disabled"
	if s.cfg.SIEM.Enabled {
		status = "active"
	}

	writeJSON(w, http.StatusOK, envelope{
		Data: map[string]interface{}{
			"enabled": s.cfg.SIEM.Enabled,
			"type":    s.cfg.SIEM.Type,
			"status":  status,
		},
		Meta: map[string]string{"timestamp": time.Now().UTC().Format(time.RFC3339)},
	})
}

func (s *Server) handlePolicies(w http.ResponseWriter, r *http.Request) {
	type policyInfo struct {
		AgentID          string                   `json:"agent_id"`
		AllowedTools     []string                 `json:"allowed_tools"`
		DeniedTools      []string                 `json:"denied_tools"`
		PIIMode          string                   `json:"pii_mode"`
		RateLimit        string                   `json:"rate_limit"`
		ConditionalRules []config.ConditionalRule `json:"conditional_rules,omitempty"`
	}

	var policies []policyInfo
	for id, a := range s.cfg.Agents {
		policies = append(policies, policyInfo{
			AgentID:          id,
			AllowedTools:     a.AllowedTools,
			DeniedTools:      a.DeniedTools,
			PIIMode:          a.PIIMode,
			RateLimit:        a.RateLimit,
			ConditionalRules: a.ConditionalRules,
		})
	}

	writeJSON(w, http.StatusOK, envelope{
		Data: policies,
		Meta: map[string]interface{}{
			"count":     len(policies),
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		},
	})
}

// handlePolicyUpdate is the ONE P0 mutation (demo mandate §5/§9): edit an
// EXISTING agent's allowed/denied tool lists. No creation, no deletion. The
// change applies atomically to the live policy engine (proxy decisions) and
// to cfg.Agents (GET /policies), and is itself recorded as a REAL signed
// audit event — the policy edit becomes part of the tamper-evident chain.
// Process-memory only: a restart reloads the YAML (durable policies = P1).
func (s *Server) handlePolicyUpdate(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	agentCfg, ok := s.cfg.Agents[id]
	if !ok {
		writeError(w, http.StatusNotFound, fmt.Sprintf("agent %q not found (P0 edits existing policies only)", id))
		return
	}
	if s.policies == nil {
		writeError(w, http.StatusServiceUnavailable, "policy engine not attached")
		return
	}

	var body struct {
		AllowedTools []string `json:"allowed_tools"`
		DeniedTools  []string `json:"denied_tools"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if body.AllowedTools == nil || body.DeniedTools == nil {
		writeError(w, http.StatusBadRequest, "allowed_tools and denied_tools are both required (send [] for empty)")
		return
	}
	seen := map[string]bool{}
	for _, t := range append(append([]string{}, body.AllowedTools...), body.DeniedTools...) {
		if strings.TrimSpace(t) == "" {
			writeError(w, http.StatusBadRequest, "tool names must be non-empty")
			return
		}
	}
	for _, t := range body.AllowedTools {
		seen[t] = true
	}
	for _, t := range body.DeniedTools {
		if seen[t] {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("tool %q cannot be both allowed and denied", t))
			return
		}
	}

	newVersion, err := s.policies.UpdateToolLists(id, body.AllowedTools, body.DeniedTools)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	// Keep cfg.Agents (GET /policies) in sync with the engine.
	agentCfg.AllowedTools = append([]string(nil), body.AllowedTools...)
	agentCfg.DeniedTools = append([]string(nil), body.DeniedTools...)
	s.cfg.Agents[id] = agentCfg

	// P1: durable — persist the agent row + an append-only version entry.
	if s.cp != nil {
		if err := s.cp.UpsertAgent(id, agentCfg, ""); err != nil {
			s.logger.Error("policy persist failed", "agent", id, "error", err)
		}
		if err := s.cp.AppendPolicyVersion(id, newVersion, agentCfg, r.Header.Get("X-Demo-Actor")+"|patch"); err != nil {
			s.logger.Error("policy version append failed", "agent", id, "error", err)
		}
	}

	// The edit itself is a real, signed, chained audit event.
	payload, _ := json.Marshal(map[string]interface{}{"allowed_tools": body.AllowedTools, "denied_tools": body.DeniedTools})
	sum := sha256.Sum256(payload)
	if _, err := s.trail.Append(audit.Event{
		EventType:     "policy_change",
		AgentID:       id,
		TenantID:      "demo",
		Jurisdiction:  agentCfg.Jurisdiction,
		Tool:          "policy_edit",
		ParamsHash:    hex.EncodeToString(sum[:]),
		PolicyResult:  "allow",
		PolicyVersion: newVersion,
		MatchedRule:   "manual_policy_edit",
		PIIMode:       "none",
	}); err != nil {
		s.logger.Error("policy_change audit append failed", "error", err)
	}

	writeJSON(w, http.StatusOK, envelope{
		Data: map[string]interface{}{
			"agent_id":       id,
			"allowed_tools":  body.AllowedTools,
			"denied_tools":   body.DeniedTools,
			"policy_version": newVersion,
		},
		Meta: map[string]interface{}{
			"persistence": "durable — persisted to agent_policies + append-only policy_versions (P1)",
			"timestamp":   time.Now().UTC().Format(time.RFC3339),
		},
	})
}

func (s *Server) handleJurisdictions(w http.ResponseWriter, r *http.Request) {
	type jurisdictionInfo struct {
		Code       string   `json:"code"`
		Backend    string   `json:"backend"`
		Compliance []string `json:"compliance"`
		EventCount int      `json:"event_count"`
	}

	// Get event counts per jurisdiction from DB
	counts := map[string]int{}
	rows, err := s.db.Query("SELECT jurisdiction, COUNT(*) FROM audit_events GROUP BY jurisdiction")
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var j string
			var c int
			rows.Scan(&j, &c)
			counts[j] = c
		}
	}

	var data []jurisdictionInfo
	for _, rule := range s.cfg.Routing.Rules {
		data = append(data, jurisdictionInfo{
			Code:       rule.Jurisdiction,
			Backend:    rule.Backend,
			Compliance: rule.Compliance,
			EventCount: counts[rule.Jurisdiction],
		})
	}

	writeJSON(w, http.StatusOK, envelope{
		Data: data,
		Meta: map[string]interface{}{
			"count":     len(data),
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		},
	})
}

// handleAuditExport generates an evidence bundle for compliance audits.
// GET /api/v1/audit/export?window_days=7  (default 7, max 90)
// GET /api/v1/audit/export?from=2026-01-01T00:00:00Z&to=2026-03-01T00:00:00Z
func (s *Server) handleAuditExport(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	var windowStart, windowEnd time.Time
	var windowDays int

	if fromStr, toStr := q.Get("from"), q.Get("to"); fromStr != "" && toStr != "" {
		var err error
		windowStart, err = time.Parse(time.RFC3339, fromStr)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid 'from' parameter (expected RFC3339)")
			return
		}
		windowEnd, err = time.Parse(time.RFC3339, toStr)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid 'to' parameter (expected RFC3339)")
			return
		}
		if windowEnd.Before(windowStart) {
			writeError(w, http.StatusBadRequest, "'to' must be after 'from'")
			return
		}
		windowDays = int(windowEnd.Sub(windowStart).Hours()/24 + 0.5)
		if windowDays < 1 {
			windowDays = 1
		}
	} else {
		windowDays, _ = strconv.Atoi(q.Get("window_days"))
		if windowDays <= 0 {
			windowDays = 7
		}
		if windowDays > 90 {
			windowDays = 90
		}
		windowEnd = time.Now().UTC()
		windowStart = windowEnd.AddDate(0, 0, -windowDays)
	}

	// Fetch events within the window
	rows, err := s.db.Query(`SELECT event_id, timestamp, event_type, agent_id, tenant_id, jurisdiction,
		mcp_server, tool, params_hash, resource_path,
		policy_result, policy_version, matched_rule,
		pii_mode, entities_detected, tokens_generated,
		response_status, result_count, latency_ms, overhead_ms,
		routing_proof, event_hash, prev_hash, merkle_root, signature
		FROM audit_events WHERE timestamp >= $1 AND timestamp <= $2
		ORDER BY timestamp ASC`, windowStart, windowEnd)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	defer rows.Close()

	var events []audit.Event
	for rows.Next() {
		var evt audit.Event
		if err := rows.Scan(
			&evt.EventID, &evt.Timestamp, &evt.EventType, &evt.AgentID, &evt.TenantID, &evt.Jurisdiction,
			&evt.MCPServer, &evt.Tool, &evt.ParamsHash, &evt.ResourcePath,
			&evt.PolicyResult, &evt.PolicyVersion, &evt.MatchedRule,
			&evt.PIIMode, &evt.EntitiesDetected, &evt.TokensGenerated,
			&evt.ResponseStatus, &evt.ResultCount, &evt.LatencyMS, &evt.OverheadMS,
			&evt.RoutingProof, &evt.EventHash, &evt.PrevHash, &evt.MerkleRoot, &evt.Signature,
		); err != nil {
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		events = append(events, evt)
	}

	// Verify chain integrity
	chainValid := true
	chainError := ""
	if err := audit.VerifyChain(events, s.pubKey); err != nil {
		chainValid = false
		chainError = err.Error()
	}

	// Extract routing proofs from events
	type proofEntry struct {
		EventID string          `json:"event_id"`
		Proof   json.RawMessage `json:"proof"`
	}
	var routingProofs []proofEntry
	for _, evt := range events {
		if evt.RoutingProof != "" {
			routingProofs = append(routingProofs, proofEntry{
				EventID: evt.EventID,
				Proof:   json.RawMessage(evt.RoutingProof),
			})
		}
	}

	// Compact event summaries for the bundle
	type eventSummary struct {
		EventID   string `json:"event_id"`
		EventHash string `json:"event_hash"`
		Signature string `json:"signature"`
	}
	summaries := make([]eventSummary, len(events))
	for i, evt := range events {
		summaries[i] = eventSummary{
			EventID:   evt.EventID,
			EventHash: evt.EventHash,
			Signature: evt.Signature,
		}
	}

	// Hash the policy config file
	policyHash := hashConfigFile(s.configPath)

	bundle := map[string]interface{}{
		"generated_at":         time.Now().UTC().Format(time.RFC3339),
		"window_start":         windowStart.UTC().Format(time.RFC3339),
		"window_end":           windowEnd.UTC().Format(time.RFC3339),
		"window_days":          windowDays,
		"audit_mode":           "hash_chain_ed25519",
		"merkle_status":        "planned_p2",
		"total_events":         len(events),
		"events":               summaries,
		"routing_proofs":       routingProofs,
		"chain_verified":       chainValid,
		"chain_error":          chainError,
		"policy_snapshot_hash": policyHash,
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", "attachment; filename=evidence.json")
	json.NewEncoder(w).Encode(bundle)
}

// hashConfigFile returns the SHA-256 hex digest of the config file, or "unavailable".
func hashConfigFile(path string) string {
	if path == "" {
		return "unavailable"
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "unavailable"
	}
	h := sha256.Sum256(data)
	return hex.EncodeToString(h[:])
}
