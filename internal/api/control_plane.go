package api

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/OolalaDXB/bawaba-command/internal/audit"
	"github.com/OolalaDXB/bawaba-command/internal/config"
)

// P1 control-plane CRUD (demo mandate §6/§9): agents and their policies are
// first-class persisted state — created, edited and deleted through the
// BAWABA API only, every mutation recorded as a REAL signed audit event and
// an append-only policy version row. YAML stays the seed; the DB overlays it.

var agentIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,62}$`)

type agentBody struct {
	AgentID          string                   `json:"agent_id"`
	AllowedTools     []string                 `json:"allowed_tools"`
	DeniedTools      []string                 `json:"denied_tools"`
	ConditionalRules []config.ConditionalRule `json:"conditional_rules"`
	PIIMode          string                   `json:"pii_mode"`
	RateLimit        string                   `json:"rate_limit"`
	Jurisdiction     string                   `json:"jurisdiction"`
}

func (s *Server) controlPlaneReady(w http.ResponseWriter) bool {
	if s.cp == nil || s.policies == nil || s.authEng == nil {
		writeError(w, http.StatusServiceUnavailable, "control plane not attached")
		return false
	}
	return true
}

func validateToolLists(allowed, denied []string) string {
	seen := map[string]bool{}
	for _, t := range append(append([]string{}, allowed...), denied...) {
		if strings.TrimSpace(t) == "" {
			return "tool names must be non-empty"
		}
	}
	for _, t := range allowed {
		seen[t] = true
	}
	for _, t := range denied {
		if seen[t] {
			return fmt.Sprintf("tool %q cannot be both allowed and denied", t)
		}
	}
	return ""
}

func validateConditionalRules(rules []config.ConditionalRule) string {
	for _, r := range rules {
		if strings.TrimSpace(r.Tool) == "" {
			return "conditional rule: tool is required"
		}
		if r.Effect != "" && r.Effect != "allow" && r.Effect != "deny" {
			return fmt.Sprintf("conditional rule %q: effect must be allow or deny", r.Tool)
		}
		if r.AmountLTE == nil && len(r.Currencies) == 0 && len(r.Jurisdictions) == 0 {
			return fmt.Sprintf("conditional rule %q: at least one condition required", r.Tool)
		}
	}
	return ""
}

func (s *Server) auditControlPlane(eventType, agentID, jurisdiction, rule string, payload interface{}) {
	body, _ := json.Marshal(payload)
	sum := sha256.Sum256(body)
	if _, err := s.trail.Append(audit.Event{
		EventType:    eventType,
		AgentID:      agentID,
		TenantID:     "demo",
		Jurisdiction: jurisdiction,
		Tool:         "control_plane",
		ParamsHash:   hex.EncodeToString(sum[:]),
		PolicyResult: "allow",
		MatchedRule:  rule,
		PIIMode:      "none",
	}); err != nil {
		s.logger.Error("control-plane audit append failed", "type", eventType, "error", err)
	}
}

// POST /api/v1/agents — create an agent with its policy. Returns the
// generated API key ONCE (only the bcrypt hash is stored).
func (s *Server) handleAgentCreate(w http.ResponseWriter, r *http.Request) {
	if !s.controlPlaneReady(w) {
		return
	}
	var body agentBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	id := strings.TrimSpace(body.AgentID)
	if !agentIDPattern.MatchString(id) {
		writeError(w, http.StatusBadRequest, "agent_id must be lowercase kebab-case (2-63 chars)")
		return
	}
	if _, exists := s.cfg.Agents[id]; exists {
		writeError(w, http.StatusConflict, fmt.Sprintf("agent %q already exists", id))
		return
	}
	if msg := validateToolLists(body.AllowedTools, body.DeniedTools); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	if msg := validateConditionalRules(body.ConditionalRules); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}

	cfgAgent := config.AgentConfig{
		Auth:             "api_key",
		AllowedTools:     orEmpty(body.AllowedTools),
		DeniedTools:      orEmpty(body.DeniedTools),
		ConditionalRules: body.ConditionalRules,
		PIIMode:          defaultStr(body.PIIMode, "none"),
		RateLimit:        defaultStr(body.RateLimit, "1000/hour"),
		MaxResults:       50,
		Jurisdiction:     defaultStr(body.Jurisdiction, "eu"),
	}

	// Generate the API key; store only its hash.
	raw := make([]byte, 18)
	_, _ = rand.Read(raw)
	plainKey := "bwbk_" + hex.EncodeToString(raw)
	hash, err := bcrypt.GenerateFromPassword([]byte(plainKey), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "key generation failed")
		return
	}

	if err := s.cp.UpsertAgent(id, cfgAgent, string(hash)); err != nil {
		writeError(w, http.StatusInternalServerError, "persist failed: "+err.Error())
		return
	}
	// Live wiring: config map (GET endpoints), policy engine, auth engine.
	s.cfg.Agents[id] = cfgAgent
	s.policies.Reload(s.cfg.Agents)
	s.authEng.RegisterAPIKeyHash(id, "demo", hash)

	_, _, version, _ := s.policies.ToolLists(id)
	_ = s.cp.AppendPolicyVersion(id, version, cfgAgent, actorOf(r))
	s.auditControlPlane("agent_create", id, cfgAgent.Jurisdiction, "control_plane.agent_create", body)

	writeJSON(w, http.StatusCreated, envelope{
		Data: map[string]interface{}{
			"agent_id":       id,
			"api_key":        plainKey,
			"policy_version": version,
			"config":         cfgAgent,
		},
		Meta: map[string]interface{}{
			"note":      "Store this API key now — only its bcrypt hash is kept.",
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		},
	})
}

// PATCH /api/v1/agents/{id} — update an existing agent's config/policy.
func (s *Server) handleAgentPatch(w http.ResponseWriter, r *http.Request) {
	if !s.controlPlaneReady(w) {
		return
	}
	id := r.PathValue("id")
	current, ok := s.cfg.Agents[id]
	if !ok {
		writeError(w, http.StatusNotFound, fmt.Sprintf("agent %q not found", id))
		return
	}
	var body agentBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if body.AllowedTools != nil || body.DeniedTools != nil {
		if msg := validateToolLists(orEmpty(body.AllowedTools), orEmpty(body.DeniedTools)); msg != "" {
			writeError(w, http.StatusBadRequest, msg)
			return
		}
		current.AllowedTools = orEmpty(body.AllowedTools)
		current.DeniedTools = orEmpty(body.DeniedTools)
	}
	if body.ConditionalRules != nil {
		if msg := validateConditionalRules(body.ConditionalRules); msg != "" {
			writeError(w, http.StatusBadRequest, msg)
			return
		}
		current.ConditionalRules = body.ConditionalRules
	}
	if body.PIIMode != "" {
		current.PIIMode = body.PIIMode
	}
	if body.RateLimit != "" {
		current.RateLimit = body.RateLimit
	}
	if body.Jurisdiction != "" {
		current.Jurisdiction = body.Jurisdiction
	}

	if err := s.cp.UpsertAgent(id, current, ""); err != nil {
		writeError(w, http.StatusInternalServerError, "persist failed: "+err.Error())
		return
	}
	s.cfg.Agents[id] = current
	s.policies.Reload(s.cfg.Agents)
	_, _, version, _ := s.policies.ToolLists(id)
	_ = s.cp.AppendPolicyVersion(id, version, current, actorOf(r))
	s.auditControlPlane("agent_update", id, current.Jurisdiction, "control_plane.agent_update", body)

	writeJSON(w, http.StatusOK, envelope{Data: map[string]interface{}{
		"agent_id": id, "policy_version": version, "config": current,
	}})
}

// DELETE /api/v1/agents/{id} — soft delete: credentials revoked, decisions
// fail closed, history preserved.
func (s *Server) handleAgentDelete(w http.ResponseWriter, r *http.Request) {
	if !s.controlPlaneReady(w) {
		return
	}
	id := r.PathValue("id")
	agentCfg, ok := s.cfg.Agents[id]
	if !ok {
		writeError(w, http.StatusNotFound, fmt.Sprintf("agent %q not found", id))
		return
	}
	// Persist tombstone first (upsert so YAML-seeded agents get one too).
	if err := s.cp.UpsertAgent(id, agentCfg, ""); err != nil {
		writeError(w, http.StatusInternalServerError, "persist failed: "+err.Error())
		return
	}
	if err := s.cp.SoftDeleteAgent(id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	delete(s.cfg.Agents, id)
	s.policies.Reload(s.cfg.Agents)
	s.authEng.Deactivate(id)
	s.auditControlPlane("agent_delete", id, agentCfg.Jurisdiction, "control_plane.agent_delete", map[string]string{"agent_id": id})

	writeJSON(w, http.StatusOK, envelope{Data: map[string]interface{}{"agent_id": id, "deleted": true}})
}

// GET /api/v1/policies/{id}/versions — append-only history, newest first.
func (s *Server) handlePolicyVersions(w http.ResponseWriter, r *http.Request) {
	if s.cp == nil {
		writeError(w, http.StatusServiceUnavailable, "control plane not attached")
		return
	}
	id := r.PathValue("id")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	versions, err := s.cp.ListPolicyVersions(id, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	writeJSON(w, http.StatusOK, envelope{Data: versions, Meta: map[string]interface{}{"count": len(versions)}})
}

func orEmpty(xs []string) []string {
	if xs == nil {
		return []string{}
	}
	return xs
}

func defaultStr(v, dflt string) string {
	if strings.TrimSpace(v) == "" {
		return dflt
	}
	return v
}

func actorOf(r *http.Request) string {
	if a := r.Header.Get("X-Demo-Actor"); a != "" {
		return a
	}
	return "operator"
}

// POST /api/v1/jurisdictions — add/replace a routing rule at runtime (P1).
// In-memory (durable routing rules = P2, stated in meta); the addition is a
// signed audit event like every control-plane mutation.
func (s *Server) handleJurisdictionAdd(w http.ResponseWriter, r *http.Request) {
	if s.router == nil {
		writeError(w, http.StatusServiceUnavailable, "router engine not attached")
		return
	}
	var body struct {
		Jurisdiction string   `json:"jurisdiction"`
		Backend      string   `json:"backend"`
		Compliance   []string `json:"compliance"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	code := strings.ToLower(strings.TrimSpace(body.Jurisdiction))
	if !regexp.MustCompile(`^[a-z]{2}$`).MatchString(code) {
		writeError(w, http.StatusBadRequest, "jurisdiction must be a 2-letter code (e.g. qa, sg)")
		return
	}
	if strings.TrimSpace(body.Backend) == "" {
		writeError(w, http.StatusBadRequest, "backend is required (the sovereign data plane label)")
		return
	}

	rule := config.RoutingRule{Jurisdiction: code, Backend: strings.TrimSpace(body.Backend), Compliance: body.Compliance}
	s.router.AddRule(rule)
	replaced := false
	for i, existing := range s.cfg.Routing.Rules {
		if existing.Jurisdiction == code {
			s.cfg.Routing.Rules[i] = rule
			replaced = true
			break
		}
	}
	if !replaced {
		s.cfg.Routing.Rules = append(s.cfg.Routing.Rules, rule)
	}

	s.auditControlPlane("jurisdiction_add", "control-plane", code, "control_plane.jurisdiction_add", rule)
	writeJSON(w, http.StatusCreated, envelope{
		Data: rule,
		Meta: map[string]interface{}{
			"persistence": "in-memory — a gateway restart reloads the YAML routing rules (durable routing is P2)",
			"timestamp":   time.Now().UTC().Format(time.RFC3339),
		},
	})
}
