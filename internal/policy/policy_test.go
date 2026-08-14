package policy

import (
	"context"
	"testing"

	"github.com/OolalaDXB/bawaba-command/internal/config"
)

func TestAllowedTool(t *testing.T) {
	agents := map[string]config.AgentConfig{
		"test-agent": {
			Auth:         "api_key",
			AllowedTools: []string{"echo", "time"},
			DeniedTools:  []string{},
		},
	}

	engine := NewEngine(agents)

	d := engine.Evaluate(nil, "test-agent", "echo")
	if !d.Allow {
		t.Errorf("expected allow for echo, got deny: %s", d.Reason)
	}

	d = engine.Evaluate(nil, "test-agent", "time")
	if !d.Allow {
		t.Errorf("expected allow for time, got deny: %s", d.Reason)
	}
}

func TestDeniedTool(t *testing.T) {
	agents := map[string]config.AgentConfig{
		"test-agent": {
			Auth:         "api_key",
			AllowedTools: []string{"echo"},
			DeniedTools:  []string{"database-write"},
		},
	}

	engine := NewEngine(agents)

	d := engine.Evaluate(nil, "test-agent", "database-write")
	if d.Allow {
		t.Error("expected deny for database-write")
	}
}

func TestDefaultDeny(t *testing.T) {
	agents := map[string]config.AgentConfig{
		"test-agent": {
			Auth:         "api_key",
			AllowedTools: []string{"echo"},
		},
	}

	engine := NewEngine(agents)

	// Tool not in allowed list
	d := engine.Evaluate(nil, "test-agent", "secret-tool")
	if d.Allow {
		t.Error("expected deny for unlisted tool")
	}
}

func TestUnknownAgent(t *testing.T) {
	agents := map[string]config.AgentConfig{}
	engine := NewEngine(agents)

	d := engine.Evaluate(nil, "unknown-agent", "echo")
	if d.Allow {
		t.Error("expected deny for unknown agent")
	}
}

func TestDenyTakesPrecedence(t *testing.T) {
	agents := map[string]config.AgentConfig{
		"test-agent": {
			Auth:         "api_key",
			AllowedTools: []string{"git-read", "git-write"},
			DeniedTools:  []string{"git-write"},
		},
	}

	engine := NewEngine(agents)

	d := engine.Evaluate(nil, "test-agent", "git-write")
	if d.Allow {
		t.Error("expected deny when tool is in both allowed and denied lists")
	}

	d = engine.Evaluate(nil, "test-agent", "git-read")
	if !d.Allow {
		t.Error("expected allow for git-read")
	}
}

func TestWildcardMatch(t *testing.T) {
	agents := map[string]config.AgentConfig{
		"admin": {
			Auth:         "api_key",
			AllowedTools: []string{"*"},
		},
	}

	engine := NewEngine(agents)

	d := engine.Evaluate(nil, "admin", "anything")
	if !d.Allow {
		t.Error("expected allow with wildcard")
	}
}

func TestUpdateToolListsMutatesDecisions(t *testing.T) {
	agents := map[string]config.AgentConfig{
		"payment-assistant": {AllowedTools: []string{"read_invoice"}, DeniedTools: []string{"execute_payment"}},
	}
	e := NewEngine(agents)

	before := e.Evaluate(context.Background(), "payment-assistant", "execute_payment")
	if before.Allow {
		t.Fatal("expected DENY before the edit")
	}
	if before.MatchedRule != "denied_tools.execute_payment" {
		t.Fatalf("unexpected matched_rule: %s", before.MatchedRule)
	}

	v0 := before.PolicyVersion
	v1, err := e.UpdateToolLists("payment-assistant", []string{"read_invoice", "execute_payment"}, []string{})
	if err != nil {
		t.Fatal(err)
	}
	if v1 == v0 {
		t.Fatal("policy version must bump on edit")
	}

	after := e.Evaluate(context.Background(), "payment-assistant", "execute_payment")
	if !after.Allow {
		t.Fatal("expected ALLOW after the edit")
	}
	if after.MatchedRule != "allowed_tools.execute_payment" {
		t.Fatalf("unexpected matched_rule: %s", after.MatchedRule)
	}
	if after.PolicyVersion != v1 {
		t.Fatalf("decision must carry the new version %s, got %s", v1, after.PolicyVersion)
	}
}

func TestUpdateToolListsUnknownAgent(t *testing.T) {
	e := NewEngine(map[string]config.AgentConfig{})
	if _, err := e.UpdateToolLists("ghost", []string{"x"}, nil); err == nil {
		t.Fatal("expected error for unknown agent (P0 edits existing policies only)")
	}
}

func TestConditionalEnvelope(t *testing.T) {
	limit := 10000.0
	agents := map[string]config.AgentConfig{
		"finance-analyst-eu": {
			AllowedTools: []string{"read_invoice"},
			ConditionalRules: []config.ConditionalRule{{
				Tool: "execute_payment", Effect: "allow",
				AmountLTE: &limit, Currencies: []string{"EUR"}, Jurisdictions: []string{"eu"},
			}},
		},
	}
	e := NewEngine(agents)
	ctx := context.Background()

	over := e.EvaluateCall(ctx, "finance-analyst-eu", "execute_payment",
		map[string]interface{}{"amount": 25000.0, "currency": "EUR"}, "eu")
	if over.Allow {
		t.Fatal("25000 EUR must be DENIED (limit 10000)")
	}
	if want := "conditional.execute_payment.outside[amount 25000 > limit 10000]"; over.MatchedRule != want {
		t.Fatalf("matched_rule = %s, want %s", over.MatchedRule, want)
	}

	within := e.EvaluateCall(ctx, "finance-analyst-eu", "execute_payment",
		map[string]interface{}{"amount": 9000.0, "currency": "EUR"}, "eu")
	if !within.Allow {
		t.Fatalf("9000 EUR in envelope must be ALLOWED, got %s", within.MatchedRule)
	}

	badCurrency := e.EvaluateCall(ctx, "finance-analyst-eu", "execute_payment",
		map[string]interface{}{"amount": 9000.0, "currency": "USD"}, "eu")
	if badCurrency.Allow {
		t.Fatal("USD must be DENIED (envelope is EUR)")
	}

	badJur := e.EvaluateCall(ctx, "finance-analyst-eu", "execute_payment",
		map[string]interface{}{"amount": 9000.0, "currency": "EUR"}, "ae")
	if badJur.Allow {
		t.Fatal("jurisdiction ae must be DENIED (envelope is eu)")
	}

	missing := e.EvaluateCall(ctx, "finance-analyst-eu", "execute_payment", nil, "eu")
	if missing.Allow {
		t.Fatal("missing amount must be DENIED (fail-closed)")
	}

	// Tools without a conditional rule fall back to the lists.
	fallback := e.EvaluateCall(ctx, "finance-analyst-eu", "read_invoice", nil, "eu")
	if !fallback.Allow {
		t.Fatal("read_invoice must still be allowed via allowed_tools")
	}
}
