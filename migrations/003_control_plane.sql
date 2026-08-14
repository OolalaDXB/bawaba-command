-- P1 control plane: durable agents/policies + append-only policy versioning.
-- YAML config remains the seed; DB rows overlay it at startup (DB wins).

CREATE TABLE IF NOT EXISTS agent_policies (
    agent_id      TEXT PRIMARY KEY,
    auth          TEXT NOT NULL DEFAULT 'api_key',
    allowed_tools JSONB NOT NULL DEFAULT '[]',
    denied_tools  JSONB NOT NULL DEFAULT '[]',
    conditional_rules JSONB NOT NULL DEFAULT '[]',
    pii_mode      TEXT NOT NULL DEFAULT 'none',
    rate_limit    TEXT NOT NULL DEFAULT '1000/hour',
    max_results   INT  NOT NULL DEFAULT 50,
    jurisdiction  TEXT NOT NULL DEFAULT 'eu',
    api_key_hash  TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ
);

-- Append-only version history: every policy edit adds a row, none is ever
-- updated or deleted (mirrors the audit-chain philosophy).
CREATE TABLE IF NOT EXISTS policy_versions (
    id            BIGSERIAL PRIMARY KEY,
    agent_id      TEXT NOT NULL,
    version       TEXT NOT NULL,
    allowed_tools JSONB NOT NULL,
    denied_tools  JSONB NOT NULL,
    conditional_rules JSONB NOT NULL DEFAULT '[]',
    actor         TEXT NOT NULL DEFAULT 'operator',
    changed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_policy_versions_agent ON policy_versions (agent_id, changed_at DESC);

CREATE OR REPLACE FUNCTION prevent_policy_version_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'policy_versions is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS policy_versions_immutable ON policy_versions;
CREATE TRIGGER policy_versions_immutable
    BEFORE UPDATE OR DELETE ON policy_versions
    FOR EACH ROW EXECUTE FUNCTION prevent_policy_version_modification();
