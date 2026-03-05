package api

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"
)

// SSEEvent is a lightweight audit event pushed to SSE clients.
type SSEEvent struct {
	EventID      string  `json:"id"`
	Timestamp    string  `json:"timestamp"`
	EventType    string  `json:"event_type"`
	AgentID      string  `json:"agent"`
	Tool         string  `json:"tool"`
	PolicyResult string  `json:"policy_result"`
	Jurisdiction string  `json:"jurisdiction"`
	LatencyMS    float64 `json:"latency_ms"`
}

// SSEHub manages SSE client connections and polls for new audit events.
type SSEHub struct {
	db      *sql.DB
	logger  *slog.Logger
	mu      sync.Mutex
	clients map[chan SSEEvent]struct{}
	stop    chan struct{}
}

// NewSSEHub creates a new SSE hub.
func NewSSEHub(db *sql.DB, logger *slog.Logger) *SSEHub {
	return &SSEHub{
		db:      db,
		logger:  logger,
		clients: make(map[chan SSEEvent]struct{}),
		stop:    make(chan struct{}),
	}
}

// Start begins the background polling goroutine.
func (h *SSEHub) Start() {
	go h.poll()
}

// Stop signals the polling goroutine to exit.
func (h *SSEHub) Stop() {
	close(h.stop)
}

func (h *SSEHub) addClient(ch chan SSEEvent) {
	h.mu.Lock()
	h.clients[ch] = struct{}{}
	h.mu.Unlock()
}

func (h *SSEHub) removeClient(ch chan SSEEvent) {
	h.mu.Lock()
	delete(h.clients, ch)
	close(ch)
	h.mu.Unlock()
}

func (h *SSEHub) broadcast(evt SSEEvent) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.clients {
		select {
		case ch <- evt:
		default:
			// Client too slow, drop event
		}
	}
}

func (h *SSEHub) poll() {
	// Track the last seen event timestamp to only fetch new events
	lastSeen := time.Now().UTC()

	ticker := time.NewTicker(500 * time.Millisecond)
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
				SELECT event_id, timestamp, event_type, agent_id, tool,
					policy_result, jurisdiction, latency_ms
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
				var evt SSEEvent
				var ts time.Time
				if err := rows.Scan(&evt.EventID, &ts, &evt.EventType, &evt.AgentID,
					&evt.Tool, &evt.PolicyResult, &evt.Jurisdiction, &evt.LatencyMS); err != nil {
					continue
				}
				evt.Timestamp = ts.Format(time.RFC3339)
				if ts.After(newest) {
					newest = ts
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
	// Flush headers immediately so the client receives the response.
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	ch := make(chan SSEEvent, 64)
	h.addClient(ch)

	// Remove client on disconnect
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
