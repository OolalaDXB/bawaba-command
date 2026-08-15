package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/OolalaDXB/bawaba-command/internal/config"
)

// P2 Demo Workspace (demo mandate §6): seeded, ephemeral visitor sessions.
// A workspace clones the demo template agents under a session suffix with
// fresh server-generated credentials (tenant = the session id). The visitor
// edits, breaks, plays — then the janitor revokes credentials and removes
// the agents at expiry (~60 min). The canonical seeded agents are NEVER
// touched, and audit events are NEVER erased: the workspace state vanishes,
// the append-only evidence chain remains.

const workspaceTTL = 60 * time.Minute

// Template agents cloned into each workspace (must exist in the config).
var workspaceTemplates = []string{"payment-assistant", "finance-analyst-eu"}

// POST /api/v1/demo/session — create an ephemeral workspace. Returns the
// session id, per-agent API keys (ONCE) and the expiry.
func (s *Server) handleDemoSessionCreate(w http.ResponseWriter, r *http.Request) {
	if !s.controlPlaneReady(w) {
		return
	}
	raw := make([]byte, 4)
	_, _ = rand.Read(raw)
	sid := "demo-" + hex.EncodeToString(raw)

	type seededAgent struct {
		AgentID  string `json:"agent_id"`
		Template string `json:"template"`
		APIKey   string `json:"api_key"`
	}
	var seeded []seededAgent
	var agentIDs []string

	for _, tpl := range workspaceTemplates {
		base, ok := s.cfg.Agents[tpl]
		if !ok {
			writeError(w, http.StatusInternalServerError, fmt.Sprintf("workspace template %q missing from config", tpl))
			return
		}
		id := tpl + "-" + sid
		clone := config.AgentConfig{
			Auth:             "api_key",
			AllowedTools:     append([]string(nil), base.AllowedTools...),
			DeniedTools:      append([]string(nil), base.DeniedTools...),
			ConditionalRules: append([]config.ConditionalRule(nil), base.ConditionalRules...),
			PIIMode:          base.PIIMode,
			RateLimit:        base.RateLimit,
			MaxResults:       base.MaxResults,
			Jurisdiction:     base.Jurisdiction,
		}

		keyRaw := make([]byte, 18)
		_, _ = rand.Read(keyRaw)
		plainKey := "bwbk_" + hex.EncodeToString(keyRaw)
		hash, err := bcrypt.GenerateFromPassword([]byte(plainKey), bcrypt.DefaultCost)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "key generation failed")
			return
		}

		if err := s.cp.UpsertAgent(id, clone, string(hash)); err != nil {
			writeError(w, http.StatusInternalServerError, "persist failed: "+err.Error())
			return
		}
		s.cfg.Agents[id] = clone
		s.authEng.RegisterAPIKeyHash(id, sid, hash) // tenant = the session id
		agentIDs = append(agentIDs, id)
		seeded = append(seeded, seededAgent{AgentID: id, Template: tpl, APIKey: plainKey})
	}
	s.policies.Reload(s.cfg.Agents)

	session, err := s.cp.CreateDemoSession(sid, agentIDs, workspaceTTL)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "session persist failed: "+err.Error())
		return
	}
	s.auditControlPlane("workspace_create", sid, "demo", "control_plane.workspace_create", agentIDs)

	writeJSON(w, http.StatusCreated, envelope{
		Data: map[string]interface{}{
			"session_id": sid,
			"agents":     seeded,
			"expires_at": session.ExpiresAt.Format(time.RFC3339),
		},
		Meta: map[string]interface{}{
			"note": "Ephemeral workspace: agents and credentials expire in ~60 min and disappear. Audit events are append-only and are never erased.",
		},
	})
}

// GET /api/v1/demo/session/{id} — workspace status (no keys — shown once).
func (s *Server) handleDemoSessionGet(w http.ResponseWriter, r *http.Request) {
	if s.cp == nil {
		writeError(w, http.StatusServiceUnavailable, "control plane not attached")
		return
	}
	ds, err := s.cp.GetDemoSession(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "workspace not found")
		return
	}
	writeJSON(w, http.StatusOK, envelope{Data: ds})
}

// RunWorkspaceJanitor tears down expired workspaces every minute: revoke
// credentials, remove agents from the live engine, soft-delete rows, flag
// the session — and record the teardown as a signed audit event.
func (s *Server) RunWorkspaceJanitor(ctx context.Context) {
	if s.cp == nil || s.policies == nil || s.authEng == nil {
		return
	}
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			due, err := s.cp.DueDemoSessions()
			if err != nil {
				s.logger.Warn("workspace janitor query failed", "error", err)
				continue
			}
			for _, ds := range due {
				for _, id := range ds.AgentIDs {
					s.authEng.Deactivate(id)
					delete(s.cfg.Agents, id)
					_ = s.cp.SoftDeleteAgent(id)
				}
				s.policies.Reload(s.cfg.Agents)
				if err := s.cp.MarkDemoSessionExpired(ds.SessionID); err != nil {
					s.logger.Warn("workspace expiry flag failed", "session", ds.SessionID, "error", err)
					continue
				}
				s.auditControlPlane("workspace_expire", ds.SessionID, "demo", "control_plane.workspace_expire", ds.AgentIDs)
				s.logger.Info("workspace expired", "session", ds.SessionID, "agents", len(ds.AgentIDs))
			}
		}
	}
}
