package proxy

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/OolalaDXB/bawaba-command/internal/config"
)

func TestForwardReachesRealUpstream(t *testing.T) {
	var gotTool string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/mcp" {
			t.Errorf("path = %s, want /mcp", r.URL.Path)
		}
		var req struct {
			Params struct {
				Name      string          `json:"name"`
				Arguments json.RawMessage `json:"arguments"`
			} `json:"params"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		gotTool = req.Params.Name
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{"payment":{"payment_id":"PAY-42"}}}`))
	}))
	defer srv.Close()

	r := NewUpstreamResolver([]config.UpstreamConfig{{Name: "demo-ledger", URL: srv.URL, Tools: []string{"execute_payment"}}})
	result, name, err := r.Forward(context.Background(), "execute_payment", `{"amount":9000,"currency":"EUR"}`)
	if err != nil {
		t.Fatal(err)
	}
	if name != "demo-ledger" || gotTool != "execute_payment" || !strings.Contains(result, "PAY-42") {
		t.Errorf("forward mismatch: name=%s tool=%s result=%s", name, gotTool, result)
	}
}

func TestNoUpstreamFailsClosedNotSimulated(t *testing.T) {
	r := NewUpstreamResolver(nil)
	if r.Serves("execute_payment") {
		t.Fatal("empty resolver must serve nothing")
	}
	g := &Gateway{}
	_, _, err := g.executeToolCall(context.Background(), "execute_payment", `{}`)
	if err == nil || !strings.Contains(err.Error(), "fails closed") {
		t.Fatalf("unserved tool must be refused explicitly, got err=%v", err)
	}
	// Built-ins remain honest gateway diagnostics.
	out, name, err := g.executeToolCall(context.Background(), "echo", `{"m":"x"}`)
	if err != nil || name != "gateway-builtin" || out != `{"m":"x"}` {
		t.Fatalf("echo builtin broken: %v %s %s", err, name, out)
	}
}

func TestUpstreamErrorSurfaces(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"invoice not found"}}`))
	}))
	defer srv.Close()
	r := NewUpstreamResolver([]config.UpstreamConfig{{Name: "demo-ledger", URL: srv.URL, Tools: []string{"read_invoice"}}})
	_, _, err := r.Forward(context.Background(), "read_invoice", `{"invoice_id":"NOPE"}`)
	if err == nil || !strings.Contains(err.Error(), "invoice not found") {
		t.Fatalf("upstream error must surface verbatim, got %v", err)
	}
}

func TestUpstreamURLEnvOverride(t *testing.T) {
	t.Setenv("BAWABA_UPSTREAM_DEMO_LEDGER_URL", "http://from-env:9090")
	r := NewUpstreamResolver([]config.UpstreamConfig{{Name: "demo-ledger", URL: "http://yaml:9090", Tools: []string{"read_invoice"}}})
	if r.byTool["read_invoice"].URL != "http://from-env:9090" {
		t.Fatalf("env override not applied: %s", r.byTool["read_invoice"].URL)
	}
}
