package policy

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"github.com/OolalaDXB/bawaba-command/internal/config"
)

// Decision represents a policy evaluation result.
type Decision struct {
	Allow         bool   `json:"allow"`
	Reason        string `json:"reason"`
	PolicyVersion string `json:"policy_version"`
	MatchedRule   string `json:"matched_rule"`
}

// Engine evaluates policies. For P1, this uses the YAML config directly
// with in-memory evaluation (OPA integration is optional for MVP).
type Engine struct {
	mu            sync.RWMutex
	agents        map[string]config.AgentConfig
	policyVersion string
}

// NewEngine creates a new policy engine from config.
func NewEngine(agents map[string]config.AgentConfig) *Engine {
	return &Engine{
		agents:        agents,
		policyVersion: "v1.0.0",
	}
}

// Evaluate checks whether the given agent is allowed to call the specified tool.
func (e *Engine) Evaluate(_ context.Context, agentID, tool string) *Decision {
	e.mu.RLock()
	defer e.mu.RUnlock()

	agentCfg, ok := e.agents[agentID]
	if !ok {
		return &Decision{
			Allow:         false,
			Reason:        fmt.Sprintf("agent %q not found in policy", agentID),
			PolicyVersion: e.policyVersion,
			MatchedRule:   "default_deny",
		}
	}

	// Check denied tools first (deny takes precedence)
	for _, denied := range agentCfg.DeniedTools {
		if matchTool(denied, tool) {
			return &Decision{
				Allow:         false,
				Reason:        fmt.Sprintf("%s.%s.deny", agentID, tool),
				PolicyVersion: e.policyVersion,
				MatchedRule:   fmt.Sprintf("denied_tools.%s", denied),
			}
		}
	}

	// Check allowed tools
	if len(agentCfg.AllowedTools) == 0 {
		// No allowed_tools means deny all
		return &Decision{
			Allow:         false,
			Reason:        fmt.Sprintf("%s: no allowed_tools configured", agentID),
			PolicyVersion: e.policyVersion,
			MatchedRule:   "no_allowed_tools",
		}
	}

	for _, allowed := range agentCfg.AllowedTools {
		if matchTool(allowed, tool) {
			return &Decision{
				Allow:         true,
				Reason:        fmt.Sprintf("%s.%s.allow", agentID, tool),
				PolicyVersion: e.policyVersion,
				MatchedRule:   fmt.Sprintf("allowed_tools.%s", allowed),
			}
		}
	}

	// Default deny
	return &Decision{
		Allow:         false,
		Reason:        fmt.Sprintf("%s.%s: not in allowed_tools", agentID, tool),
		PolicyVersion: e.policyVersion,
		MatchedRule:   "default_deny",
	}
}

// ToolLists returns a copy of an agent's current allow/deny lists and the
// engine's policy version. ok is false when the agent is unknown.
func (e *Engine) ToolLists(agentID string) (allowed, denied []string, version string, ok bool) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	agentCfg, found := e.agents[agentID]
	if !found {
		return nil, nil, e.policyVersion, false
	}
	return append([]string(nil), agentCfg.AllowedTools...),
		append([]string(nil), agentCfg.DeniedTools...),
		e.policyVersion, true
}

// UpdateToolLists replaces an EXISTING agent's allow/deny lists (the P0 demo
// mutation — no agent creation here) and bumps the policy version. The
// change is process-memory only: a restart reloads the YAML config (durable
// policies are P1).
func (e *Engine) UpdateToolLists(agentID string, allowed, denied []string) (string, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	agentCfg, ok := e.agents[agentID]
	if !ok {
		return e.policyVersion, fmt.Errorf("policy: agent %q not found", agentID)
	}
	agentCfg.AllowedTools = append([]string(nil), allowed...)
	agentCfg.DeniedTools = append([]string(nil), denied...)
	e.agents[agentID] = agentCfg
	parts := strings.Split(e.policyVersion, ".")
	if len(parts) == 3 {
		e.policyVersion = fmt.Sprintf("%s.%s.%d", parts[0], parts[1], mustAtoi(parts[2])+1)
	}
	return e.policyVersion, nil
}

// Reload updates the policy engine with new agent configs.
func (e *Engine) Reload(agents map[string]config.AgentConfig) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.agents = agents
	// Increment version
	parts := strings.Split(e.policyVersion, ".")
	if len(parts) == 3 {
		e.policyVersion = fmt.Sprintf("%s.%s.%d", parts[0], parts[1], mustAtoi(parts[2])+1)
	}
}

func matchTool(pattern, tool string) bool {
	if pattern == "*" {
		return true
	}
	if strings.HasSuffix(pattern, "*") {
		return strings.HasPrefix(tool, strings.TrimSuffix(pattern, "*"))
	}
	return pattern == tool
}

func mustAtoi(s string) int {
	n := 0
	for _, c := range s {
		if c >= '0' && c <= '9' {
			n = n*10 + int(c-'0')
		}
	}
	return n
}
