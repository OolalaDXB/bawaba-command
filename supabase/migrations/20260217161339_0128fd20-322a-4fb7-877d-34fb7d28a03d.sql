
CREATE TABLE IF NOT EXISTS audit_events (
    event_id TEXT PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event_type TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    jurisdiction TEXT NOT NULL DEFAULT 'unknown',
    mcp_server TEXT DEFAULT '',
    tool TEXT DEFAULT '',
    params_hash TEXT DEFAULT '',
    resource_path TEXT DEFAULT '',
    policy_result TEXT DEFAULT '',
    policy_version TEXT DEFAULT '',
    matched_rule TEXT DEFAULT '',
    pii_mode TEXT DEFAULT 'none',
    entities_detected INT DEFAULT 0,
    tokens_generated INT DEFAULT 0,
    response_status TEXT DEFAULT '',
    result_count INT DEFAULT 0,
    latency_ms REAL DEFAULT 0,
    overhead_ms REAL DEFAULT 0,
    event_hash TEXT NOT NULL,
    prev_hash TEXT NOT NULL,
    merkle_root TEXT DEFAULT '',
    signature TEXT NOT NULL
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_audit_events_timestamp ON audit_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_events_agent_id ON audit_events(agent_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_id ON audit_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_event_type ON audit_events(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_events_tool ON audit_events(tool);

-- Append-only: no UPDATE or DELETE allowed
CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Audit events are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS no_update_audit ON audit_events;
CREATE TRIGGER no_update_audit
    BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();

-- Agents table
CREATE TABLE IF NOT EXISTS agents (
    agent_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    auth_method TEXT NOT NULL,
    api_key_hash TEXT DEFAULT '',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;

-- Public read access (no auth required for this dashboard)
CREATE POLICY "Allow public read audit_events" ON audit_events FOR SELECT USING (true);
CREATE POLICY "Allow public insert audit_events" ON audit_events FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public read agents" ON agents FOR SELECT USING (true);
CREATE POLICY "Allow public insert agents" ON agents FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update agents" ON agents FOR UPDATE USING (true);
