package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoad(t *testing.T) {
	yaml := `
server:
  port: 9999
  log_level: debug
database:
  url: postgres://test:test@localhost:5432/test?sslmode=disable
agents:
  test-agent:
    auth: api_key
    allowed_tools: [echo, time]
    pii_mode: tokenize
    rate_limit: 100/hour
routing:
  default_backend: localhost
  rules:
    - jurisdiction: ma
      backend: casa-dc
      compliance: [loi-09-08]
`
	dir := t.TempDir()
	path := filepath.Join(dir, "bawaba.yaml")
	if err := os.WriteFile(path, []byte(yaml), 0644); err != nil {
		t.Fatal(err)
	}

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	if cfg.Server.Port != 9999 {
		t.Errorf("expected port 9999, got %d", cfg.Server.Port)
	}
	if cfg.Server.LogLevel != "debug" {
		t.Errorf("expected log level debug, got %s", cfg.Server.LogLevel)
	}
	if len(cfg.Agents) != 1 {
		t.Errorf("expected 1 agent, got %d", len(cfg.Agents))
	}
	agent := cfg.Agents["test-agent"]
	if agent.Auth != "api_key" {
		t.Errorf("expected auth api_key, got %s", agent.Auth)
	}
	if len(agent.AllowedTools) != 2 {
		t.Errorf("expected 2 allowed tools, got %d", len(agent.AllowedTools))
	}
	if agent.MaxResults != 50 {
		t.Errorf("expected default max_results 50, got %d", agent.MaxResults)
	}
	if len(cfg.Routing.Rules) != 1 {
		t.Errorf("expected 1 routing rule, got %d", len(cfg.Routing.Rules))
	}
}

func TestLoadInvalidAuth(t *testing.T) {
	yaml := `
database:
  url: postgres://test:test@localhost:5432/test
agents:
  bad-agent:
    auth: invalid
    allowed_tools: [foo]
`
	dir := t.TempDir()
	path := filepath.Join(dir, "bawaba.yaml")
	os.WriteFile(path, []byte(yaml), 0644)

	_, err := Load(path)
	if err == nil {
		t.Fatal("expected error for invalid auth method")
	}
}

func TestLoadMissingDB(t *testing.T) {
	yaml := `
agents:
  test:
    auth: api_key
    allowed_tools: [foo]
`
	dir := t.TempDir()
	path := filepath.Join(dir, "bawaba.yaml")
	os.WriteFile(path, []byte(yaml), 0644)

	_, err := Load(path)
	if err == nil {
		t.Fatal("expected error for missing database.url")
	}
}

func TestDefaults(t *testing.T) {
	yaml := `
database:
  url: postgres://test:test@localhost:5432/test
agents:
  test:
    auth: api_key
    allowed_tools: [foo]
`
	dir := t.TempDir()
	path := filepath.Join(dir, "bawaba.yaml")
	os.WriteFile(path, []byte(yaml), 0644)

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	if cfg.Server.Port != 8080 {
		t.Errorf("expected default port 8080, got %d", cfg.Server.Port)
	}
	if cfg.Server.MetricsPort != 9090 {
		t.Errorf("expected default metrics port 9090, got %d", cfg.Server.MetricsPort)
	}
	if cfg.Audit.MerkleWindowHours != 24 {
		t.Errorf("expected default merkle window 24h, got %d", cfg.Audit.MerkleWindowHours)
	}
}
