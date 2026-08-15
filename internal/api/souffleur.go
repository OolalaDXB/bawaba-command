package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"github.com/OolalaDXB/bawaba-command/internal/souffleur"
)

// P3 Souffleur endpoint (demo mandate §7): the ONLY thing this does is load a
// REAL audit event from the append-only trail and ask the configured LLM
// provider to translate its decision fields into plain language. The
// deterministic engine decided; the Souffleur explains. No provider configured
// → honest 503, never a canned or invented answer.

// AttachSouffleur wires the provider selected at startup (nil = not configured).
func (s *Server) AttachSouffleur(p souffleur.Provider) { s.souffleur = p }

// GET /api/v1/souffleur/status — is a provider configured, and which one.
func (s *Server) handleSouffleurStatus(w http.ResponseWriter, r *http.Request) {
	if s.souffleur == nil {
		writeJSON(w, http.StatusOK, envelope{Data: map[string]interface{}{
			"configured": false,
			"note":       "Set BAWABA_SOUFFLEUR_PROVIDER (+ key/model/base URL) to enable the Souffleur. It only translates real decision records — it never decides.",
		}})
		return
	}
	writeJSON(w, http.StatusOK, envelope{Data: map[string]interface{}{
		"configured": true,
		"provider":   s.souffleur.Name(),
		"model":      s.souffleur.Model(),
	}})
}

// POST /api/v1/souffleur/explain {event_id, question?}
func (s *Server) handleSouffleurExplain(w http.ResponseWriter, r *http.Request) {
	if s.souffleur == nil {
		writeError(w, http.StatusServiceUnavailable,
			"no LLM provider configured — the Souffleur never invents an explanation (set BAWABA_SOUFFLEUR_PROVIDER)")
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
	// an event, the server decides what the Souffleur is allowed to see.
	var rec souffleur.DecisionRecord
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

	explanation, err := souffleur.Explain(r.Context(), s.souffleur, rec, body.Question)
	if err != nil {
		writeError(w, http.StatusBadGateway, "souffleur provider error: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, envelope{
		Data: map[string]interface{}{
			"event_id":    rec.EventID,
			"explanation": explanation,
			"source":      rec, // the exact fields that were translated — nothing else
			"provider":    s.souffleur.Name(),
			"model":       s.souffleur.Model(),
		},
		Meta: map[string]interface{}{
			"invariant": "the deterministic policy engine decided; the Souffleur only translated the fields shown in source",
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		},
	})
}
