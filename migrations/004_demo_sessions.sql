-- P2 Demo Workspace: seeded, ephemeral visitor sessions (~60 min). The
-- visitor's agents/credentials expire and disappear; audit events are NEVER
-- erased (append-only chain) — the workspace state vanishes, the evidence
-- trail remains, honestly labelled.
CREATE TABLE IF NOT EXISTS demo_sessions (
    session_id TEXT PRIMARY KEY,
    agent_ids  JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    expired    BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_demo_sessions_expiry ON demo_sessions (expired, expires_at);
