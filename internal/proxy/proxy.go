package proxy

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/OolalaDXB/bawaba-command/internal/audit"
	"github.com/OolalaDXB/bawaba-command/internal/auth"
	"github.com/OolalaDXB/bawaba-command/internal/config"
	"github.com/OolalaDXB/bawaba-command/internal/policy"
	"github.com/OolalaDXB/bawaba-command/internal/ratelimit"
	"github.com/OolalaDXB/bawaba-command/internal/router"
	"github.com/OolalaDXB/bawaba-command/internal/tokenizer"
)

// JSONRPCRequest represents a JSON-RPC 2.0 request.
type JSONRPCRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      interface{}     `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

// JSONRPCResponse represents a JSON-RPC 2.0 response.
type JSONRPCResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      interface{}     `json:"id,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *JSONRPCError   `json:"error,omitempty"`
}

// JSONRPCError represents a JSON-RPC 2.0 error.
type JSONRPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// ToolCallParams represents the params for a tools/call MCP method.
type ToolCallParams struct {
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments,omitempty"`
}

// Gateway is the main MCP reverse proxy.
type Gateway struct {
	authEngine    *auth.Engine
	policyEngine  *policy.Engine
	rateLimiter   *ratelimit.Limiter
	anomaly       *ratelimit.AnomalyDetector
	auditTrail    *audit.Trail
	routerEngine  *router.Engine
	agentConfigs  map[string]config.AgentConfig
	logger        *slog.Logger
	piiEnabled    bool
}

// NewGateway creates a new MCP gateway proxy.
func NewGateway(
	authEngine *auth.Engine,
	policyEngine *policy.Engine,
	rateLimiter *ratelimit.Limiter,
	anomaly *ratelimit.AnomalyDetector,
	auditTrail *audit.Trail,
	routerEngine *router.Engine,
	agentConfigs map[string]config.AgentConfig,
	logger *slog.Logger,
	piiEnabled bool,
) *Gateway {
	return &Gateway{
		authEngine:   authEngine,
		policyEngine: policyEngine,
		rateLimiter:  rateLimiter,
		anomaly:      anomaly,
		auditTrail:   auditTrail,
		routerEngine: routerEngine,
		agentConfigs: agentConfigs,
		logger:       logger,
		piiEnabled:   piiEnabled,
	}
}

// ServeHTTP handles all incoming MCP requests.
func (g *Gateway) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	start := time.Now()

	// Health check bypass
	if r.URL.Path == "/healthz" {
		g.handleHealth(w)
		return
	}

	// Only accept POST for JSON-RPC
	if r.Method != http.MethodPost {
		g.writeError(w, nil, -32600, "Method not allowed")
		return
	}

	// Read body
	body, err := io.ReadAll(r.Body)
	if err != nil {
		g.writeError(w, nil, -32700, "Parse error")
		return
	}
	defer r.Body.Close()

	// Parse JSON-RPC
	var req JSONRPCRequest
	if err := json.Unmarshal(body, &req); err != nil {
		g.writeError(w, nil, -32700, "Parse error: invalid JSON")
		return
	}

	// Step 1: Authenticate
	identity, err := g.authEngine.Authenticate(r.Context(), r)
	if err != nil {
		g.logger.Warn("auth failed", "error", err, "method", req.Method)
		g.logAuditEvent(audit.Event{
			EventType:    "auth",
			AgentID:      "unknown",
			TenantID:     "unknown",
			Jurisdiction: "unknown",
			Tool:         req.Method,
			PolicyResult: "deny",
			MatchedRule:  "auth_failure",
			LatencyMS:    float64(time.Since(start).Milliseconds()),
		})
		g.writeError(w, req.ID, -32001, "Unauthorized")
		return
	}

	// Step 2: Rate limit
	if !g.rateLimiter.Allow(identity.AgentID) {
		g.logger.Warn("rate limit exceeded", "agent", identity.AgentID)
		g.logAuditEvent(audit.Event{
			EventType:      "rate_limit",
			AgentID:        identity.AgentID,
			TenantID:       identity.TenantID,
			Jurisdiction:   "unknown",
			Tool:           req.Method,
			PolicyResult:   "deny",
			MatchedRule:    "rate_limit_exceeded",
			ResponseStatus: "429",
			LatencyMS:      float64(time.Since(start).Milliseconds()),
		})
		g.writeError(w, req.ID, -32002, "Rate limit exceeded")
		return
	}

	// Route based on method
	switch req.Method {
	case "initialize":
		g.handleInitialize(w, r, &req, identity, start)
	case "tools/list":
		g.handleToolsList(w, r, &req, identity, start)
	case "tools/call":
		g.handleToolsCall(w, r, &req, identity, body, start)
	case "resources/list", "resources/read":
		g.handleResourceAccess(w, r, &req, identity, start)
	case "prompts/list", "prompts/get":
		g.handlePrompts(w, r, &req, identity, start)
	default:
		g.writeError(w, req.ID, -32601, fmt.Sprintf("Method not found: %s", req.Method))
	}
}

func (g *Gateway) handleHealth(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	resp := map[string]interface{}{
		"status":  "healthy",
		"version": "0.1.0",
		"time":    time.Now().UTC().Format(time.RFC3339),
	}
	json.NewEncoder(w).Encode(resp)
}

func (g *Gateway) handleInitialize(w http.ResponseWriter, _ *http.Request, req *JSONRPCRequest, identity *auth.AgentIdentity, start time.Time) {
	g.logger.Info("agent initialized", "agent", identity.AgentID)

	g.logAuditEvent(audit.Event{
		EventType:      "initialize",
		AgentID:        identity.AgentID,
		TenantID:       identity.TenantID,
		Jurisdiction:   "default",
		Tool:           "initialize",
		PolicyResult:   "allow",
		MatchedRule:    "initialize",
		ResponseStatus: "200",
		LatencyMS:      float64(time.Since(start).Milliseconds()),
	})

	result := map[string]interface{}{
		"protocolVersion": "2024-11-05",
		"capabilities": map[string]interface{}{
			"tools":     map[string]bool{"listChanged": true},
			"resources": map[string]bool{"subscribe": false, "listChanged": true},
		},
		"serverInfo": map[string]string{
			"name":    "bawaba-gateway",
			"version": "0.1.0",
		},
	}

	g.writeResult(w, req.ID, result)
}

func (g *Gateway) handleToolsList(w http.ResponseWriter, _ *http.Request, req *JSONRPCRequest, identity *auth.AgentIdentity, start time.Time) {
	agentCfg, ok := g.agentConfigs[identity.AgentID]
	if !ok {
		g.writeError(w, req.ID, -32001, "Unknown agent")
		return
	}

	// Build filtered tool list based on agent's allowed tools
	tools := make([]map[string]interface{}, 0)
	for _, toolName := range agentCfg.AllowedTools {
		tools = append(tools, map[string]interface{}{
			"name":        toolName,
			"description": fmt.Sprintf("Tool: %s (via Bawaba gateway)", toolName),
			"inputSchema": map[string]interface{}{
				"type":       "object",
				"properties": map[string]interface{}{},
			},
		})
	}

	g.logAuditEvent(audit.Event{
		EventType:      "tools_list",
		AgentID:        identity.AgentID,
		TenantID:       identity.TenantID,
		Jurisdiction:   "default",
		Tool:           "tools/list",
		PolicyResult:   "allow",
		MatchedRule:    "tools_list",
		ResponseStatus: "200",
		ResultCount:    len(tools),
		LatencyMS:      float64(time.Since(start).Milliseconds()),
	})

	g.writeResult(w, req.ID, map[string]interface{}{"tools": tools})
}

func (g *Gateway) handleToolsCall(w http.ResponseWriter, _ *http.Request, req *JSONRPCRequest, identity *auth.AgentIdentity, body []byte, start time.Time) {
	// Parse tool call params
	var params ToolCallParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		g.writeError(w, req.ID, -32602, "Invalid params")
		return
	}

	agentCfg := g.agentConfigs[identity.AgentID]
	scope := fmt.Sprintf("%s:%s", identity.TenantID, identity.AgentID)

	// Step 3: Policy evaluation
	decision := g.policyEngine.Evaluate(context.Background(), identity.AgentID, params.Name)
	if !decision.Allow {
		g.logger.Warn("policy denied", "agent", identity.AgentID, "tool", params.Name, "reason", decision.Reason)
		g.logAuditEvent(audit.Event{
			EventType:      "policy_deny",
			AgentID:        identity.AgentID,
			TenantID:       identity.TenantID,
			Jurisdiction:   "default",
			Tool:           params.Name,
			ParamsHash:     hashParams(body),
			PolicyResult:   "deny",
			PolicyVersion:  decision.PolicyVersion,
			MatchedRule:    decision.MatchedRule,
			ResponseStatus: "403",
			LatencyMS:      float64(time.Since(start).Milliseconds()),
		})
		g.writeError(w, req.ID, -32003, fmt.Sprintf("Policy denied: %s", decision.Reason))
		return
	}

	// Step 4: PII tokenization
	var piiMode string
	var entitiesDetected, tokensGenerated int
	var tokenizedArgs string

	if g.piiEnabled && agentCfg.PIIMode == "tokenize" {
		piiMode = "tokenize"
		argsStr := string(params.Arguments)
		result := tokenizer.Tokenize(argsStr, scope)
		tokenizedArgs = result.Output
		entitiesDetected = result.EntitiesCount
		tokensGenerated = result.TokensGenerated
	} else {
		piiMode = agentCfg.PIIMode
		tokenizedArgs = string(params.Arguments)
	}

	// Step 5: Sovereign routing
	routingDecision, err := g.routerEngine.Route(identity.TenantID, "default")
	if err != nil {
		g.writeError(w, req.ID, -32004, "Routing error")
		return
	}

	// Step 6: Execute the tool (for P1, return a simulated response)
	// In production, this forwards to the actual backend MCP server
	toolResult := g.executeToolCall(params.Name, tokenizedArgs)

	// Step 7: De-tokenize response if needed
	var responseStr string
	if g.piiEnabled && agentCfg.PIIMode == "tokenize" {
		responseStr = tokenizer.Detokenize(toolResult, scope)
	} else {
		responseStr = toolResult
	}

	overhead := time.Since(start)

	// Step 8: Audit
	g.logAuditEvent(audit.Event{
		EventType:        "tool_call",
		AgentID:          identity.AgentID,
		TenantID:         identity.TenantID,
		Jurisdiction:     routingDecision.Jurisdiction,
		MCPServer:        routingDecision.Backend,
		Tool:             params.Name,
		ParamsHash:       hashParams(body),
		PolicyResult:     "allow",
		PolicyVersion:    decision.PolicyVersion,
		MatchedRule:      decision.MatchedRule,
		PIIMode:          piiMode,
		EntitiesDetected: entitiesDetected,
		TokensGenerated:  tokensGenerated,
		ResponseStatus:   "200",
		LatencyMS:        float64(overhead.Milliseconds()),
		OverheadMS:       float64(overhead.Milliseconds()),
	})

	// Anomaly detection
	if g.anomaly.RecordRead(identity.AgentID, params.Name, "") {
		g.logger.Warn("anomaly detected: sequential bulk reads", "agent", identity.AgentID, "tool", params.Name)
		g.logAuditEvent(audit.Event{
			EventType:    "anomaly",
			AgentID:      identity.AgentID,
			TenantID:     identity.TenantID,
			Jurisdiction: routingDecision.Jurisdiction,
			Tool:         params.Name,
			PolicyResult: "alert",
			MatchedRule:  "sequential_bulk_read",
		})
	}

	// Return result
	resultJSON := json.RawMessage(responseStr)
	g.writeResult(w, req.ID, map[string]interface{}{
		"content": []map[string]interface{}{
			{
				"type": "text",
				"text": string(resultJSON),
			},
		},
	})
}

func (g *Gateway) handleResourceAccess(w http.ResponseWriter, _ *http.Request, req *JSONRPCRequest, identity *auth.AgentIdentity, start time.Time) {
	g.logAuditEvent(audit.Event{
		EventType:      "resource_access",
		AgentID:        identity.AgentID,
		TenantID:       identity.TenantID,
		Jurisdiction:   "default",
		Tool:           req.Method,
		PolicyResult:   "allow",
		ResponseStatus: "200",
		LatencyMS:      float64(time.Since(start).Milliseconds()),
	})

	g.writeResult(w, req.ID, map[string]interface{}{
		"resources": []interface{}{},
	})
}

func (g *Gateway) handlePrompts(w http.ResponseWriter, _ *http.Request, req *JSONRPCRequest, identity *auth.AgentIdentity, start time.Time) {
	g.logAuditEvent(audit.Event{
		EventType:      "prompt_access",
		AgentID:        identity.AgentID,
		TenantID:       identity.TenantID,
		Jurisdiction:   "default",
		Tool:           req.Method,
		PolicyResult:   "allow",
		ResponseStatus: "200",
		LatencyMS:      float64(time.Since(start).Milliseconds()),
	})

	g.writeResult(w, req.ID, map[string]interface{}{
		"prompts": []interface{}{},
	})
}

func (g *Gateway) executeToolCall(tool, args string) string {
	// P1: Built-in test tools
	switch tool {
	case "echo":
		return args
	case "time":
		return fmt.Sprintf(`{"time": "%s"}`, time.Now().UTC().Format(time.RFC3339))
	default:
		return fmt.Sprintf(`{"tool": "%s", "status": "executed", "args": %s}`, tool, args)
	}
}

func (g *Gateway) writeResult(w http.ResponseWriter, id interface{}, result interface{}) {
	resultJSON, _ := json.Marshal(result)
	resp := JSONRPCResponse{
		JSONRPC: "2.0",
		ID:      id,
		Result:  json.RawMessage(resultJSON),
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (g *Gateway) writeError(w http.ResponseWriter, id interface{}, code int, message string) {
	resp := JSONRPCResponse{
		JSONRPC: "2.0",
		ID:      id,
		Error: &JSONRPCError{
			Code:    code,
			Message: message,
		},
	}
	w.Header().Set("Content-Type", "application/json")
	if code == -32001 {
		w.WriteHeader(http.StatusUnauthorized)
	} else if code == -32002 {
		w.WriteHeader(http.StatusTooManyRequests)
	} else if code == -32003 {
		w.WriteHeader(http.StatusForbidden)
	} else {
		w.WriteHeader(http.StatusBadRequest)
	}
	json.NewEncoder(w).Encode(resp)
}

func (g *Gateway) logAuditEvent(evt audit.Event) {
	if g.auditTrail == nil {
		return
	}
	if err := g.auditTrail.Log(evt); err != nil {
		g.logger.Error("audit log failed", "error", err)
	}
}

func hashParams(data []byte) string {
	// Remove whitespace for consistent hashing
	var buf bytes.Buffer
	json.Compact(&buf, data)
	h := sha256.Sum256(buf.Bytes())
	return hex.EncodeToString(h[:])
}

// SSE support: handle Server-Sent Events for streaming MCP
func (g *Gateway) HandleSSE(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming not supported", http.StatusInternalServerError)
		return
	}

	// Authenticate
	identity, err := g.authEngine.Authenticate(r.Context(), r)
	if err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Bawaba-Agent", identity.AgentID)

	// Send initial SSE message
	fmt.Fprintf(w, "event: endpoint\ndata: /mcp\n\n")
	flusher.Flush()

	// Keep connection open
	<-r.Context().Done()
}

// NewHTTPHandler returns the http.Handler for the gateway, including SSE.
func (g *Gateway) NewHTTPHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		g.handleHealth(w)
	})
	mux.HandleFunc("/sse", g.HandleSSE)
	mux.HandleFunc("/mcp", g.ServeHTTP)
	mux.HandleFunc("/", g.ServeHTTP)

	return withLogging(g.logger, mux)
}

func withLogging(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w}
		next.ServeHTTP(sw, r)
		logger.Info("request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", sw.status,
			"duration_ms", time.Since(start).Milliseconds(),
			"remote", r.RemoteAddr,
		)
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (sw *statusWriter) WriteHeader(code int) {
	sw.status = code
	sw.ResponseWriter.WriteHeader(code)
}

func (sw *statusWriter) Write(b []byte) (int, error) {
	if sw.status == 0 {
		sw.status = http.StatusOK
	}
	return sw.ResponseWriter.Write(b)
}

// StreamSSEField is used for SSE streaming responses.
// We keep it unused for now as SSE content is generated inline.
var _ = strings.NewReader
