package api

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/OolalaDXB/bawaba-command/internal/audit"
)

// SSEHub manages SSE client connections and polls for newly persisted audit events.
// The event payload uses the same audit.Event JSON shape as GET /api/v1/events,
// so the dashboard never has to guess or remap a reduced mock schema.
type SSEHub struct {
	db      *sql.DB
	logger  *slog.Logger
	mu      sync.Mutex
	clients map[chan audit.Event]struct{}
	stop    chan struct{}
}

// NewSSEHub creates a new SSE hub.
func NewSSEHub(db *sql.DB, logger *slog.Logger) *SSEHub {
	return &SSEHub{
		db:      db,
		logger:  logger,
		clients: make(map[chan audit.Event]struct{}),
		stop:    make(chan struct{}),
	}
}

// Start begins the background polling goroutine.
func (h *SSEHub) Start() { go h.poll() }

// Stop signals the polling goroutine to exit.
func (h *SSEHub) Stop() { close(h.stop) }

func (h *SSEHub) addClient(ch chan audit.Event) {
	h.mu.Lock()
	h.clients[ch] = struct{}{}
	h.mu.Unlock()
}

func (h *SSEHub) removeClient(ch chan audit.Event) {
	h.mu.Lock()
	delete(h.clients, ch)
	close(ch)
	h.mu.Unlock()
}

func (h *SSEHub) broadcast(evt audit.Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.clients {
		select {
		case ch <- evt:
		default:
			// Client too slow; the initial REST fetch will reconcile on reload.
		}
	}
}

func (h *SSEHub) poll() {
	// Only events created after the hub starts are streamed. Existing events are
	// loaded through GET /api/v1/events when the page mounts.
	lastSeen := time.Now().UTC()
	ticker := time.NewTicker(350 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-h.stop:
			return
		case <-ticker.C:
			h.mu.Lock()
			clientCount := len(h.clients)
			h.mu.Unlock()
			if clientCount == 0 {
				continue
			}

			rows, err := h.db.Query(`
				SELECT event_id, timestamp, event_type, agent_id, tenant_id, jurisdiction,
					mcp_server, tool, params_hash, resource_path,
					policy_result, policy_version, matched_rule,
					pii_mode, entities_detected, tokens_generated,
					response_status, result_count, latency_ms, overhead_ms,
					routing_proof, event_hash, prev_hash, merkle_root, signature
				FROM audit_events
				WHERE timestamp > $1
				ORDER BY timestamp ASC
				LIMIT 100`, lastSeen)
			if err != nil {
				h.logger.Error("sse poll error", "error", err)
				continue
			}

			var newest time.Time
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
					h.logger.Warn("sse scan error", "error", err)
					continue
				}
				if evt.Timestamp.After(newest) {
					newest = evt.Timestamp
				}
				h.broadcast(evt)
			}
			rows.Close()

			if !newest.IsZero() {
				lastSeen = newest
			}
		}
	}
}

// ServeHTTP handles an SSE client connection.
func (h *SSEHub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	if origin := r.Header.Get("Origin"); origin != "" {
		w.Header().Set("Access-Control-Allow-Origin", origin)
	}
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	ch := make(chan audit.Event, 64)
	h.addClient(ch)
	ctx := r.Context()

	for {
		select {
		case <-ctx.Done():
			h.removeClient(ch)
			return
		case evt, ok := <-ch:
			if !ok {
				return
			}
			data, _ := json.Marshal(evt)
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		}
	}
}
