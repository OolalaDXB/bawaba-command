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

// EvaluateCall is the P1 attribute-aware evaluation: conditional rules are
// checked FIRST on the real call arguments; tool allow/deny lists remain the
// fallback. Deterministic, no LLM. args may be nil (list-only evaluation).
func (e *Engine) EvaluateCall(ctx context.Context, agentID, tool string, args map[string]interface{}, jurisdiction string) *Decision {
	e.mu.RLock()
	agentCfg, ok := e.agents[agentID]
	version := e.policyVersion
	e.mu.RUnlock()
	if ok {
		for _, rule := range agentCfg.ConditionalRules {
			if !matchTool(rule.Tool, tool) {
				continue
			}
			if failed := failedCondition(rule, args, jurisdiction); failed != "" {
				return &Decision{
					Allow:         false,
					Reason:        fmt.Sprintf("%s.%s: outside conditional envelope: %s", agentID, tool, failed),
					PolicyVersion: version,
					MatchedRule:   fmt.Sprintf("conditional.%s.outside[%s]", rule.Tool, failed),
				}
			}
			return &Decision{
				Allow:         rule.Effect != "deny",
				Reason:        fmt.Sprintf("%s.%s: within conditional envelope", agentID, tool),
				PolicyVersion: version,
				MatchedRule:   fmt.Sprintf("conditional.%s[%s]", rule.Tool, envelopeDesc(rule)),
			}
		}
	}
	return e.Evaluate(ctx, agentID, tool)
}

// failedCondition returns "" when every present condition holds, else a
// human-readable description of the FIRST failed condition (it becomes part
// of matched_rule — real reasons, never paraphrased downstream).
func failedCondition(rule config.ConditionalRule, args map[string]interface{}, jurisdiction string) string {
	if rule.AmountLTE != nil {
		amount, ok := numericArg(args, "amount")
		if !ok {
			return "amount missing"
		}
		if amount > *rule.AmountLTE {
			return fmt.Sprintf("amount %.0f > limit %.0f", amount, *rule.AmountLTE)
		}
	}
	if len(rule.Currencies) > 0 {
		cur, _ := args["currency"].(string)
		if !containsFold(rule.Currencies, cur) {
			return fmt.Sprintf("currency %q not in %v", cur, rule.Currencies)
		}
	}
	if len(rule.Jurisdictions) > 0 {
		if !containsFold(rule.Jurisdictions, jurisdiction) {
			return fmt.Sprintf("jurisdiction %q not in %v", jurisdiction, rule.Jurisdictions)
		}
	}
	return ""
}

func envelopeDesc(rule config.ConditionalRule) string {
	parts := []string{}
	if rule.AmountLTE != nil {
		parts = append(parts, fmt.Sprintf("amount<=%.0f", *rule.AmountLTE))
	}
	if len(rule.Currencies) > 0 {
		parts = append(parts, fmt.Sprintf("currency in %v", rule.Currencies))
	}
	if len(rule.Jurisdictions) > 0 {
		parts = append(parts, fmt.Sprintf("jurisdiction in %v", rule.Jurisdictions))
	}
	return strings.Join(parts, " ")
}

func numericArg(args map[string]interface{}, key string) (float64, bool) {
	if args == nil {
		return 0, false
	}
	switch v := args[key].(type) {
	case float64:
		return v, true
	case int:
		return float64(v), true
	case string:
		var f float64
		if _, err := fmt.Sscanf(v, "%f", &f); err == nil {
			return f, true
		}
	}
	return 0, false
}

func containsFold(xs []string, s string) bool {
	for _, x := range xs {
		if strings.EqualFold(x, s) {
			return true
		}
	}
	return false
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
