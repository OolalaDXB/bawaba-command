package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"github.com/OolalaDXB/bawaba-command/internal/copilot"
)

// P3 Copilot endpoint (demo mandate §7): the ONLY thing this does is load a
// REAL audit event from the append-only trail and ask the configured LLM
// provider to translate its decision fields into plain language. The
// deterministic engine decided; the Copilot explains. No provider configured
// → honest 503, never a canned or invented answer.

// AttachCopilot wires the provider selected at startup (nil = not configured).
func (s *Server) AttachCopilot(p copilot.Provider) { s.copilot = p }

// GET /api/v1/copilot/status — is a provider configured, and which one.
func (s *Server) handleCopilotStatus(w http.ResponseWriter, r *http.Request) {
	if s.copilot == nil {
		writeJSON(w, http.StatusOK, envelope{Data: map[string]interface{}{
			"configured": false,
			"note":       "Set BAWABA_COPILOT_PROVIDER (+ key/model/base URL) to enable the Copilot. It only translates real decision records — it never decides.",
		}})
		return
	}
	writeJSON(w, http.StatusOK, envelope{Data: map[string]interface{}{
		"configured": true,
		"provider":   s.copilot.Name(),
		"model":      s.copilot.Model(),
	}})
}

// POST /api/v1/copilot/explain {event_id, question?}
func (s *Server) handleCopilotExplain(w http.ResponseWriter, r *http.Request) {
	if s.copilot == nil {
		writeError(w, http.StatusServiceUnavailable,
			"no LLM provider configured — the Copilot never invents an explanation (set BAWABA_COPILOT_PROVIDER)")
		return
	}
	var body struct {
		EventID  string `json:"event_id"`
		Question string `json:"question"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.EventID == "" {
		writeError(w, http.StatusBadRequest, "event_id is required")
		return
	}

	// The record comes from the trail, not from the client: the client names
	// an event, the server decides what the Copilot is allowed to see.
	var rec copilot.DecisionRecord
	var ts time.Time
	err := s.db.QueryRow(`SELECT event_id, timestamp, event_type, agent_id, tool,
		policy_result, policy_version, matched_rule, jurisdiction,
		pii_mode, entities_detected, response_status
		FROM audit_events WHERE event_id = $1`, body.EventID).Scan(
		&rec.EventID, &ts, &rec.EventType, &rec.AgentID, &rec.Tool,
		&rec.PolicyResult, &rec.PolicyVersion, &rec.MatchedRule, &rec.Jurisdiction,
		&rec.PIIMode, &rec.EntitiesDetected, &rec.ResponseStatus,
	)
	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "event not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	rec.Timestamp = ts.UTC().Format(time.RFC3339)

	explanation, err := copilot.Explain(r.Context(), s.copilot, rec, body.Question)
	if err != nil {
		writeError(w, http.StatusBadGateway, "copilot provider error: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, envelope{
		Data: map[string]interface{}{
			"event_id":    rec.EventID,
			"explanation": explanation,
			"source":      rec, // the exact fields that were translated — nothing else
			"provider":    s.copilot.Name(),
			"model":       s.copilot.Model(),
		},
		Meta: map[string]interface{}{
			"invariant": "the deterministic policy engine decided; the Copilot only translated the fields shown in source",
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		},
	})
}
