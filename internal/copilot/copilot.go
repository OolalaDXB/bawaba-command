// Package copilot implements the P3 Copilot (demo mandate §7/§9): a strict
// TRANSLATION layer over decision records produced by the deterministic
// policy engine. The invariant is non-negotiable:
//
//	BAWABA decision record (reason_code, matched_rule, policy_version, …)
//	    ↓ Copilot
//	natural-language explanation
//
// The Copilot never decides, never guesses why an event happened, and never
// invents a field. If no LLM provider is configured it says so (HTTP 503 at
// the API layer) instead of fabricating an answer.
//
// Provider-agnostic from the start (mandate §7): Anthropic (Claude) via the
// Messages API, and any OpenAI-compatible endpoint (Mistral La Plateforme,
// self-hosted vLLM/Ollama — the sovereign option) via /chat/completions.
// Both are reached over plain HTTP with zero vendor SDK dependencies, on
// purpose: the gateway is built for sovereign deployments and keeps its
// dependency tree minimal.
package copilot

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// DecisionRecord is the subset of a real audit event the Copilot is allowed
// to talk about. Everything the explanation says must be traceable to one of
// these fields — nothing else exists as far as the Copilot is concerned.
type DecisionRecord struct {
	EventID          string `json:"event_id"`
	Timestamp        string `json:"timestamp"`
	EventType        string `json:"event_type"`
	AgentID          string `json:"agent_id"`
	Tool             string `json:"tool"`
	PolicyResult     string `json:"policy_result"`
	PolicyVersion    string `json:"policy_version"`
	MatchedRule      string `json:"matched_rule"`
	Jurisdiction     string `json:"jurisdiction"`
	PIIMode          string `json:"pii_mode"`
	EntitiesDetected int    `json:"entities_detected"`
	ResponseStatus   string `json:"response_status"`
}

// Provider is one LLM backend. Complete sends a system + user prompt and
// returns the model's text. Implementations must not retry silently or
// substitute content on failure — errors surface to the caller.
type Provider interface {
	Name() string
	Model() string
	Complete(ctx context.Context, system, user string) (string, error)
}

// SystemPrompt is the translation-only contract sent to every provider.
const SystemPrompt = `You are the BAWABA Copilot. BAWABA is an AI-agent control plane whose decisions are made by a DETERMINISTIC policy engine — never by you.

Your only job is to translate the decision record below into plain language for a human reviewer.

Hard rules:
- Explain ONLY what the provided fields say. matched_rule names the exact rule or failed condition; policy_version is the exact policy version that applied.
- Never speculate about causes, intents, or fields that are not present. If a field is empty, say it is empty rather than guessing.
- Never suggest the decision was wrong or right — you do not decide, you translate.
- Answer in 2 to 4 sentences of plain prose, in the language of the reviewer's question if one is given, otherwise in English.`

// BuildUserPrompt renders the decision record verbatim, field by field.
// Empty fields are marked as such so the model cannot fill the gap.
func BuildUserPrompt(rec DecisionRecord, question string) string {
	var b strings.Builder
	b.WriteString("Decision record (verbatim, from the append-only audit trail):\n")
	field := func(name, value string) {
		if strings.TrimSpace(value) == "" {
			value = "(empty)"
		}
		fmt.Fprintf(&b, "- %s: %s\n", name, value)
	}
	field("event_id", rec.EventID)
	field("timestamp", rec.Timestamp)
	field("event_type", rec.EventType)
	field("agent_id", rec.AgentID)
	field("tool", rec.Tool)
	field("policy_result", rec.PolicyResult)
	field("policy_version", rec.PolicyVersion)
	field("matched_rule", rec.MatchedRule)
	field("jurisdiction", rec.Jurisdiction)
	field("pii_mode", rec.PIIMode)
	fmt.Fprintf(&b, "- entities_detected: %d\n", rec.EntitiesDetected)
	field("response_status", rec.ResponseStatus)
	if strings.TrimSpace(question) != "" {
		fmt.Fprintf(&b, "\nReviewer's question: %s\n", question)
	}
	b.WriteString("\nTranslate this record into plain language.")
	return b.String()
}

// Explain runs the full translation: prompt built from the record, one
// provider call, the text back. No post-processing, no fallback content.
func Explain(ctx context.Context, p Provider, rec DecisionRecord, question string) (string, error) {
	if p == nil {
		return "", fmt.Errorf("no LLM provider configured — the Copilot never invents an explanation")
	}
	return p.Complete(ctx, SystemPrompt, BuildUserPrompt(rec, question))
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// FromEnv builds the provider selected by the environment:
//
//	BAWABA_COPILOT_PROVIDER  anthropic | openai | mistral | openai-compatible | "" (off)
//	BAWABA_COPILOT_API_KEY   credential for the chosen provider
//	BAWABA_COPILOT_MODEL     model id (defaults per provider)
//	BAWABA_COPILOT_BASE_URL  override endpoint (self-hosted vLLM/Ollama, proxies)
//
// Returns (nil, nil) when no provider is configured — the API layer turns
// that into an honest 503, never a canned answer.
func FromEnv() (Provider, error) {
	name := strings.ToLower(strings.TrimSpace(os.Getenv("BAWABA_COPILOT_PROVIDER")))
	if name == "" || name == "none" {
		return nil, nil
	}
	key := os.Getenv("BAWABA_COPILOT_API_KEY")
	model := strings.TrimSpace(os.Getenv("BAWABA_COPILOT_MODEL"))
	base := strings.TrimRight(strings.TrimSpace(os.Getenv("BAWABA_COPILOT_BASE_URL")), "/")

	switch name {
	case "anthropic", "claude":
		if key == "" {
			return nil, fmt.Errorf("BAWABA_COPILOT_PROVIDER=anthropic requires BAWABA_COPILOT_API_KEY")
		}
		if model == "" {
			model = "claude-opus-5"
		}
		if base == "" {
			base = "https://api.anthropic.com"
		}
		return &anthropicProvider{apiKey: key, model: model, baseURL: base, client: httpClient()}, nil
	case "openai", "mistral", "openai-compatible":
		if base == "" {
			switch name {
			case "mistral":
				base = "https://api.mistral.ai/v1"
			case "openai":
				base = "https://api.openai.com/v1"
			default:
				return nil, fmt.Errorf("BAWABA_COPILOT_PROVIDER=openai-compatible requires BAWABA_COPILOT_BASE_URL (e.g. a self-hosted vLLM endpoint)")
			}
		}
		if key == "" && name != "openai-compatible" {
			return nil, fmt.Errorf("BAWABA_COPILOT_PROVIDER=%s requires BAWABA_COPILOT_API_KEY", name)
		}
		if model == "" {
			if name == "mistral" {
				model = "mistral-large-latest"
			} else {
				return nil, fmt.Errorf("BAWABA_COPILOT_PROVIDER=%s requires BAWABA_COPILOT_MODEL", name)
			}
		}
		return &openAICompatProvider{name: name, apiKey: key, model: model, baseURL: base, client: httpClient()}, nil
	default:
		return nil, fmt.Errorf("unknown BAWABA_COPILOT_PROVIDER %q (anthropic | openai | mistral | openai-compatible)", name)
	}
}

func httpClient() *http.Client {
	return &http.Client{Timeout: 45 * time.Second}
}

// ---------------------------------------------------------------------------
// Anthropic (Claude) — Messages API over raw HTTP
// ---------------------------------------------------------------------------

type anthropicProvider struct {
	apiKey  string
	model   string
	baseURL string
	client  *http.Client
}

func (a *anthropicProvider) Name() string  { return "anthropic" }
func (a *anthropicProvider) Model() string { return a.model }

func (a *anthropicProvider) Complete(ctx context.Context, system, user string) (string, error) {
	body, _ := json.Marshal(map[string]interface{}{
		"model":      a.model,
		"max_tokens": 512,
		"system":     system,
		"messages": []map[string]string{
			{"role": "user", "content": user},
		},
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.baseURL+"/v1/messages", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", a.apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	resp, err := a.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("anthropic request failed: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("anthropic API %d: %s", resp.StatusCode, apiErrMessage(raw))
	}
	var out struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", fmt.Errorf("anthropic response parse: %w", err)
	}
	var text strings.Builder
	for _, block := range out.Content {
		if block.Type == "text" {
			text.WriteString(block.Text)
		}
	}
	if text.Len() == 0 {
		return "", fmt.Errorf("anthropic response contained no text block")
	}
	return strings.TrimSpace(text.String()), nil
}

// ---------------------------------------------------------------------------
// OpenAI-compatible — covers OpenAI, Mistral, self-hosted vLLM/Ollama
// ---------------------------------------------------------------------------

type openAICompatProvider struct {
	name    string
	apiKey  string
	model   string
	baseURL string
	client  *http.Client
}

func (o *openAICompatProvider) Name() string  { return o.name }
func (o *openAICompatProvider) Model() string { return o.model }

func (o *openAICompatProvider) Complete(ctx context.Context, system, user string) (string, error) {
	body, _ := json.Marshal(map[string]interface{}{
		"model":      o.model,
		"max_tokens": 512,
		"messages": []map[string]string{
			{"role": "system", "content": system},
			{"role": "user", "content": user},
		},
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, o.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	if o.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+o.apiKey)
	}

	resp, err := o.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("%s request failed: %w", o.name, err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("%s API %d: %s", o.name, resp.StatusCode, apiErrMessage(raw))
	}
	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", fmt.Errorf("%s response parse: %w", o.name, err)
	}
	if len(out.Choices) == 0 || strings.TrimSpace(out.Choices[0].Message.Content) == "" {
		return "", fmt.Errorf("%s response contained no message content", o.name)
	}
	return strings.TrimSpace(out.Choices[0].Message.Content), nil
}

func apiErrMessage(raw []byte) string {
	var e struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(raw, &e) == nil && e.Error.Message != "" {
		return e.Error.Message
	}
	s := strings.TrimSpace(string(raw))
	if len(s) > 300 {
		s = s[:300] + "…"
	}
	return s
}
