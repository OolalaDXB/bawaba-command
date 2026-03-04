package siem

// NoopForwarder is a SIEM forwarder that does nothing.
// Used when SIEM forwarding is disabled.
type NoopForwarder struct{}

// Forward is a no-op.
func (n *NoopForwarder) Forward(event AuditEvent) {}

// Health always returns nil (healthy).
func (n *NoopForwarder) Health() error { return nil }

// Close is a no-op.
func (n *NoopForwarder) Close() error { return nil }
