package siem

import (
	"fmt"

	"github.com/OolalaDXB/bawaba-command/internal/config"
)

// AuditEvent is a lightweight representation of an audit event for SIEM forwarding.
type AuditEvent struct {
	EventID      string  `json:"event_id"`
	Timestamp    string  `json:"timestamp"`
	EventType    string  `json:"event_type"`
	AgentID      string  `json:"agent_id"`
	TenantID     string  `json:"tenant_id"`
	Jurisdiction string  `json:"jurisdiction"`
	Tool         string  `json:"tool"`
	PolicyResult string  `json:"policy_result"`
	PIIMode      string  `json:"pii_mode"`
	LatencyMS    float64 `json:"latency_ms"`
}

// Forwarder sends audit events to an external SIEM system.
type Forwarder interface {
	// Forward sends an event to the SIEM endpoint. It must be non-blocking.
	Forward(event AuditEvent)

	// Health returns nil if the forwarder is healthy, or an error describing the issue.
	Health() error

	// Close releases any resources held by the forwarder.
	Close() error
}

// NewForwarder creates a Forwarder based on the configuration.
// Returns a NoopForwarder if SIEM is disabled, otherwise returns the configured type.
func NewForwarder(cfg config.SIEMForwarderConfig) (Forwarder, error) {
	if !cfg.Enabled {
		return &NoopForwarder{}, nil
	}

	switch cfg.Type {
	case "webhook":
		if cfg.Endpoint == "" {
			return nil, fmt.Errorf("siem: webhook endpoint is required when enabled")
		}
		return NewWebhookForwarder(cfg.Endpoint, cfg.Token), nil
	default:
		return &NoopForwarder{}, nil
	}
}
