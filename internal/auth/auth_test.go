package auth

import (
	"net/http"
	"testing"
)

func TestAPIKeyAuth(t *testing.T) {
	engine := NewEngine()

	engine.RegisterAgent("test-agent", "default", "api_key")
	engine.RegisterAPIKey("test-agent", "default", "secret-key-123", nil)

	// Valid key
	r, _ := http.NewRequest("POST", "/mcp", nil)
	r.Header.Set("X-Bawaba-Key", "secret-key-123")

	identity, err := engine.Authenticate(r.Context(), r)
	if err != nil {
		t.Fatalf("expected auth success, got: %v", err)
	}
	if identity.AgentID != "test-agent" {
		t.Errorf("expected agent test-agent, got %s", identity.AgentID)
	}
	if identity.AuthMethod != "api_key" {
		t.Errorf("expected auth method api_key, got %s", identity.AuthMethod)
	}
}

func TestAPIKeyAuthInvalid(t *testing.T) {
	engine := NewEngine()
	engine.RegisterAgent("test-agent", "default", "api_key")
	engine.RegisterAPIKey("test-agent", "default", "secret-key-123", nil)

	r, _ := http.NewRequest("POST", "/mcp", nil)
	r.Header.Set("X-Bawaba-Key", "wrong-key")

	_, err := engine.Authenticate(r.Context(), r)
	if err == nil {
		t.Fatal("expected auth failure for wrong key")
	}
}

func TestNoCredentials(t *testing.T) {
	engine := NewEngine()

	r, _ := http.NewRequest("POST", "/mcp", nil)

	_, err := engine.Authenticate(r.Context(), r)
	if err != ErrUnauthorized {
		t.Errorf("expected ErrUnauthorized, got: %v", err)
	}
}

func TestDenyByDefault(t *testing.T) {
	engine := NewEngine()
	// Don't register any agents

	r, _ := http.NewRequest("POST", "/mcp", nil)
	r.Header.Set("X-Bawaba-Key", "some-key")

	_, err := engine.Authenticate(r.Context(), r)
	if err == nil {
		t.Fatal("expected auth failure for unregistered agent")
	}
}
