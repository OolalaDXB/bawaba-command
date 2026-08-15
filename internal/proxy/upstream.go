package proxy

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

	"github.com/OolalaDXB/bawaba-command/internal/config"
)

// UpstreamResolver forwards allowed tool calls to REAL backend MCP servers.
// This replaces the P1 simulated responses: a tool served by no upstream is
// refused with an explicit error — the gateway never fabricates a backend
// answer. Enforcement means the gateway sits on the ONLY path to the
// backend: allow forwards, deny means the backend never hears about it.
type UpstreamResolver struct {
	byTool map[string]config.UpstreamConfig
	client *http.Client
}

// NewUpstreamResolver indexes upstreams by tool. URLs can be overridden per
// upstream with BAWABA_UPSTREAM_<NAME>_URL (name uppercased, '-' → '_') so
// compose and laptops can point at different hosts without editing YAML.
func NewUpstreamResolver(ups []config.UpstreamConfig) *UpstreamResolver {
	byTool := map[string]config.UpstreamConfig{}
	for _, u := range ups {
		envKey := "BAWABA_UPSTREAM_" + strings.ToUpper(strings.ReplaceAll(u.Name, "-", "_")) + "_URL"
		if override := os.Getenv(envKey); override != "" {
			u.URL = override
		}
		for _, t := range u.Tools {
			byTool[t] = u
		}
	}
	return &UpstreamResolver{
		byTool: byTool,
		client: &http.Client{Timeout: 10 * time.Second},
	}
}

// Serves reports whether any upstream serves the tool.
func (r *UpstreamResolver) Serves(tool string) bool {
	if r == nil {
		return false
	}
	_, ok := r.byTool[tool]
	return ok
}

// Forward posts a JSON-RPC tools/call to the upstream serving the tool and
// returns the raw result JSON plus the upstream's name. Errors surface —
// an unreachable backend is an unreachable backend, not a canned success.
func (r *UpstreamResolver) Forward(ctx context.Context, tool, argsJSON string) (result string, upstream string, err error) {
	u, ok := r.byTool[tool]
	if !ok {
		return "", "", fmt.Errorf("no upstream serves tool %q", tool)
	}
	if !json.Valid([]byte(argsJSON)) || strings.TrimSpace(argsJSON) == "" {
		argsJSON = "{}"
	}
	body, _ := json.Marshal(map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      fmt.Sprintf("gw-%d", time.Now().UnixNano()),
		"method":  "tools/call",
		"params": map[string]interface{}{
			"name":      tool,
			"arguments": json.RawMessage(argsJSON),
		},
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.URL+"/mcp", bytes.NewReader(body))
	if err != nil {
		return "", u.Name, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := r.client.Do(req)
	if err != nil {
		return "", u.Name, fmt.Errorf("upstream %s unreachable: %w", u.Name, err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))

	var rpc struct {
		Result json.RawMessage `json:"result"`
		Error  *struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(raw, &rpc); err != nil {
		return "", u.Name, fmt.Errorf("upstream %s: invalid JSON-RPC response: %w", u.Name, err)
	}
	if rpc.Error != nil {
		return "", u.Name, fmt.Errorf("upstream %s error %d: %s", u.Name, rpc.Error.Code, rpc.Error.Message)
	}
	if len(rpc.Result) == 0 {
		return "", u.Name, fmt.Errorf("upstream %s returned no result", u.Name)
	}
	return string(rpc.Result), u.Name, nil
}
