package souffleur

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func sampleRecord() DecisionRecord {
	return DecisionRecord{
		EventID:       "evt-123",
		Timestamp:     "2026-08-15T10:00:00Z",
		EventType:     "policy_deny",
		AgentID:       "finance-analyst-eu",
		Tool:          "execute_payment",
		PolicyResult:  "deny",
		PolicyVersion: "v4",
		MatchedRule:   "conditional.execute_payment.outside[amount 25000 > limit 10000]",
		Jurisdiction:  "eu",
		PIIMode:       "none",
	}
}

func TestBuildUserPromptContainsRealFieldsVerbatim(t *testing.T) {
	rec := sampleRecord()
	prompt := BuildUserPrompt(rec, "pourquoi ce refus ?")

	for _, must := range []string{
		rec.MatchedRule, // the exact failed condition, never paraphrased away
		rec.PolicyVersion,
		rec.AgentID,
		rec.Tool,
		"policy_result: deny",
		"Reviewer's question: pourquoi ce refus ?",
	} {
		if !strings.Contains(prompt, must) {
			t.Errorf("prompt missing verbatim field %q\nprompt:\n%s", must, prompt)
		}
	}
}

func TestBuildUserPromptMarksEmptyFields(t *testing.T) {
	prompt := BuildUserPrompt(DecisionRecord{EventID: "evt-1"}, "")
	if !strings.Contains(prompt, "matched_rule: (empty)") {
		t.Errorf("empty matched_rule must be marked (empty), got:\n%s", prompt)
	}
	if strings.Contains(prompt, "Reviewer's question") {
		t.Error("no question given — the prompt must not fabricate one")
	}
}

func TestSystemPromptStatesTheInvariant(t *testing.T) {
	for _, must := range []string{"DETERMINISTIC", "Never speculate", "translate"} {
		if !strings.Contains(SystemPrompt, must) {
			t.Errorf("system prompt missing invariant marker %q", must)
		}
	}
}

func TestExplainWithoutProviderRefusesHonestly(t *testing.T) {
	_, err := Explain(context.Background(), nil, sampleRecord(), "")
	if err == nil || !strings.Contains(err.Error(), "never invents") {
		t.Fatalf("nil provider must refuse explicitly, got err=%v", err)
	}
}

func setEnv(t *testing.T, kv map[string]string) {
	t.Helper()
	for _, k := range []string{"BAWABA_SOUFFLEUR_PROVIDER", "BAWABA_SOUFFLEUR_API_KEY", "BAWABA_SOUFFLEUR_MODEL", "BAWABA_SOUFFLEUR_BASE_URL"} {
		t.Setenv(k, "")
		os.Unsetenv(k)
	}
	for k, v := range kv {
		t.Setenv(k, v)
	}
}

func TestFromEnvSelection(t *testing.T) {
	setEnv(t, nil)
	p, err := FromEnv()
	if p != nil || err != nil {
		t.Fatalf("unset env must yield (nil, nil), got (%v, %v)", p, err)
	}

	setEnv(t, map[string]string{"BAWABA_SOUFFLEUR_PROVIDER": "anthropic", "BAWABA_SOUFFLEUR_API_KEY": "sk-test"})
	p, err = FromEnv()
	if err != nil || p == nil || p.Name() != "anthropic" || p.Model() != "claude-opus-5" {
		t.Fatalf("anthropic selection failed: p=%v err=%v", p, err)
	}

	setEnv(t, map[string]string{"BAWABA_SOUFFLEUR_PROVIDER": "anthropic"})
	if _, err = FromEnv(); err == nil {
		t.Fatal("anthropic without API key must error")
	}

	setEnv(t, map[string]string{"BAWABA_SOUFFLEUR_PROVIDER": "mistral", "BAWABA_SOUFFLEUR_API_KEY": "mk-test"})
	p, err = FromEnv()
	if err != nil || p == nil || p.Name() != "mistral" || p.Model() != "mistral-large-latest" {
		t.Fatalf("mistral selection failed: p=%v err=%v", p, err)
	}

	setEnv(t, map[string]string{"BAWABA_SOUFFLEUR_PROVIDER": "openai-compatible", "BAWABA_SOUFFLEUR_MODEL": "qwen3", "BAWABA_SOUFFLEUR_BASE_URL": "http://vllm.local/v1"})
	p, err = FromEnv()
	if err != nil || p == nil || p.Name() != "openai-compatible" {
		t.Fatalf("self-hosted selection failed: p=%v err=%v", p, err)
	}

	setEnv(t, map[string]string{"BAWABA_SOUFFLEUR_PROVIDER": "openai-compatible", "BAWABA_SOUFFLEUR_MODEL": "qwen3"})
	if _, err = FromEnv(); err == nil {
		t.Fatal("openai-compatible without base URL must error")
	}

	setEnv(t, map[string]string{"BAWABA_SOUFFLEUR_PROVIDER": "bard"})
	if _, err = FromEnv(); err == nil {
		t.Fatal("unknown provider must error")
	}
}

func TestAnthropicProviderWireFormat(t *testing.T) {
	var got map[string]interface{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" {
			t.Errorf("path = %s, want /v1/messages", r.URL.Path)
		}
		if r.Header.Get("x-api-key") != "sk-test" || r.Header.Get("anthropic-version") == "" {
			t.Error("missing anthropic auth headers")
		}
		_ = json.NewDecoder(r.Body).Decode(&got)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"content": []map[string]string{
				{"type": "thinking", "text": "…"},
				{"type": "text", "text": "The deterministic engine denied execute_payment: amount 25000 exceeds the 10000 limit in policy v4."},
			},
		})
	}))
	defer srv.Close()

	p := &anthropicProvider{apiKey: "sk-test", model: "claude-opus-5", baseURL: srv.URL, client: srv.Client()}
	text, err := Explain(context.Background(), p, sampleRecord(), "")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text, "policy v4") {
		t.Errorf("unexpected text %q", text)
	}
	if got["model"] != "claude-opus-5" || got["system"] != SystemPrompt {
		t.Error("request body must carry the model and the translation-only system prompt")
	}
	user := got["messages"].([]interface{})[0].(map[string]interface{})["content"].(string)
	if !strings.Contains(user, sampleRecord().MatchedRule) {
		t.Error("user message must contain matched_rule verbatim")
	}
}

func TestOpenAICompatProviderWireFormat(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Errorf("path = %s, want /v1/chat/completions", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer mk-test" {
			t.Error("missing bearer auth")
		}
		var body struct {
			Messages []struct{ Role, Content string } `json:"messages"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if len(body.Messages) != 2 || body.Messages[0].Role != "system" {
			t.Error("expected system+user messages")
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"choices": []map[string]interface{}{
				{"message": map[string]string{"role": "assistant", "content": "Denied by the conditional rule."}},
			},
		})
	}))
	defer srv.Close()

	p := &openAICompatProvider{name: "mistral", apiKey: "mk-test", model: "mistral-large-latest", baseURL: srv.URL + "/v1", client: srv.Client()}
	text, err := p.Complete(context.Background(), SystemPrompt, BuildUserPrompt(sampleRecord(), ""))
	if err != nil {
		t.Fatal(err)
	}
	if text != "Denied by the conditional rule." {
		t.Errorf("unexpected text %q", text)
	}
}

func TestProviderErrorSurfacesNotInvents(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"error": map[string]string{"message": "rate limited"}})
	}))
	defer srv.Close()

	p := &anthropicProvider{apiKey: "sk", model: "claude-opus-5", baseURL: srv.URL, client: srv.Client()}
	_, err := p.Complete(context.Background(), "s", "u")
	if err == nil || !strings.Contains(err.Error(), "rate limited") {
		t.Fatalf("provider failure must surface, got %v", err)
	}
}
