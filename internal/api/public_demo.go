package api

import (
	"net/http"
	"os"
	"strings"
)

// P3 shareable-link posture (closes the P2→P3 security debt recorded in
// docs/DEPLOY_MANAGED.md): when BAWABA_PUBLIC_DEMO=true the control-plane
// mutation endpoints only accept WORKSPACE-SCOPED agents — the ephemeral
// `…-demo-xxxx` clones a visitor got from POST /api/v1/demo/session. The
// canonical seeded agents and global state (routing rules) become read-only.
// On a laptop (flag unset) nothing changes.

func publicDemoEnabled() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("BAWABA_PUBLIC_DEMO")))
	return v == "1" || v == "true" || v == "yes"
}

// workspaceScoped reports whether the agent id belongs to an ephemeral demo
// workspace clone (created with the `-demo-` suffix by the workspace API).
func workspaceScoped(agentID string) bool {
	return strings.Contains(agentID, "-demo-")
}

// guardPublicMutation blocks mutations on non-workspace agents in public
// demo mode. Returns true when the mutation may proceed.
func (s *Server) guardPublicMutation(w http.ResponseWriter, agentID string) bool {
	if !s.publicDemo || workspaceScoped(agentID) {
		return true
	}
	writeError(w, http.StatusForbidden,
		"public demo: mutations are limited to your private workspace clones (start one via POST /api/v1/demo/session; ids carry a -demo- suffix)")
	return false
}

// guardPublicGlobal blocks global-state mutations entirely in public mode.
func (s *Server) guardPublicGlobal(w http.ResponseWriter) bool {
	if !s.publicDemo {
		return true
	}
	writeError(w, http.StatusForbidden,
		"public demo: global state (routing rules) is read-only — run the stack locally to modify it")
	return false
}
