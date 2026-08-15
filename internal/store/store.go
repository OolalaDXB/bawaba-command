// Package store is the P1 control-plane persistence layer: durable
// agents/policies and append-only policy versioning. The YAML config remains
// the seed; DB rows overlay it at startup (DB wins). Every consumer goes
// Browser → BAWABA API → here — never a parallel data path.
package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/OolalaDXB/bawaba-command/internal/config"
)

type Store struct {
	db *sql.DB
}

func New(db *sql.DB) *Store { return &Store{db: db} }

// AgentRow is the persisted control-plane view of an agent + its policy.
type AgentRow struct {
	AgentID    string
	Config     config.AgentConfig
	APIKeyHash string
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

func marshal(v interface{}) []byte {
	b, _ := json.Marshal(v)
	if b == nil {
		return []byte("[]")
	}
	return b
}

// LoadAgents returns all non-deleted persisted agents (overlay for cfg.Agents).
func (s *Store) LoadAgents() (map[string]config.AgentConfig, map[string]string, error) {
	rows, err := s.db.Query(`SELECT agent_id, auth, allowed_tools, denied_tools, conditional_rules,
		pii_mode, rate_limit, max_results, jurisdiction, COALESCE(api_key_hash,'')
		FROM agent_policies WHERE deleted_at IS NULL`)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	agents := map[string]config.AgentConfig{}
	keyHashes := map[string]string{}
	for rows.Next() {
		var id, auth, pii, rate, jur, keyHash string
		var allowed, denied, conditional []byte
		var maxResults int
		if err := rows.Scan(&id, &auth, &allowed, &denied, &conditional, &pii, &rate, &maxResults, &jur, &keyHash); err != nil {
			return nil, nil, err
		}
		cfg := config.AgentConfig{Auth: auth, PIIMode: pii, RateLimit: rate, MaxResults: maxResults, Jurisdiction: jur}
		_ = json.Unmarshal(allowed, &cfg.AllowedTools)
		_ = json.Unmarshal(denied, &cfg.DeniedTools)
		_ = json.Unmarshal(conditional, &cfg.ConditionalRules)
		agents[id] = cfg
		if keyHash != "" {
			keyHashes[id] = keyHash
		}
	}
	return agents, keyHashes, rows.Err()
}

// UpsertAgent persists an agent's full control-plane state.
func (s *Store) UpsertAgent(agentID string, cfg config.AgentConfig, apiKeyHash string) error {
	_, err := s.db.Exec(`INSERT INTO agent_policies
		(agent_id, auth, allowed_tools, denied_tools, conditional_rules, pii_mode, rate_limit, max_results, jurisdiction, api_key_hash, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULLIF($10,''),now())
		ON CONFLICT (agent_id) DO UPDATE SET
		  auth=EXCLUDED.auth, allowed_tools=EXCLUDED.allowed_tools, denied_tools=EXCLUDED.denied_tools,
		  conditional_rules=EXCLUDED.conditional_rules, pii_mode=EXCLUDED.pii_mode, rate_limit=EXCLUDED.rate_limit,
		  max_results=EXCLUDED.max_results, jurisdiction=EXCLUDED.jurisdiction,
		  api_key_hash=COALESCE(NULLIF(EXCLUDED.api_key_hash,''), agent_policies.api_key_hash),
		  deleted_at=NULL, updated_at=now()`,
		agentID, cfg.Auth, marshal(cfg.AllowedTools), marshal(cfg.DeniedTools), marshal(cfg.ConditionalRules),
		cfg.PIIMode, cfg.RateLimit, cfg.MaxResults, cfg.Jurisdiction, apiKeyHash)
	return err
}

// SoftDeleteAgent marks an agent deleted (history stays; nothing is erased).
func (s *Store) SoftDeleteAgent(agentID string) error {
	res, err := s.db.Exec(`UPDATE agent_policies SET deleted_at=now() WHERE agent_id=$1 AND deleted_at IS NULL`, agentID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("store: agent %q not persisted", agentID)
	}
	return nil
}

// AppendPolicyVersion records one immutable version-history row.
func (s *Store) AppendPolicyVersion(agentID, version string, cfg config.AgentConfig, actor string) error {
	_, err := s.db.Exec(`INSERT INTO policy_versions (agent_id, version, allowed_tools, denied_tools, conditional_rules, actor)
		VALUES ($1,$2,$3,$4,$5,$6)`,
		agentID, version, marshal(cfg.AllowedTools), marshal(cfg.DeniedTools), marshal(cfg.ConditionalRules), actor)
	return err
}

// PolicyVersion is one row of the append-only history.
type PolicyVersion struct {
	Version          string          `json:"version"`
	AllowedTools     []string        `json:"allowed_tools"`
	DeniedTools      []string        `json:"denied_tools"`
	ConditionalRules json.RawMessage `json:"conditional_rules"`
	Actor            string          `json:"actor"`
	ChangedAt        time.Time       `json:"changed_at"`
}

// ListPolicyVersions returns an agent's history, newest first.
func (s *Store) ListPolicyVersions(agentID string, limit int) ([]PolicyVersion, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := s.db.Query(`SELECT version, allowed_tools, denied_tools, conditional_rules, actor, changed_at
		FROM policy_versions WHERE agent_id=$1 ORDER BY changed_at DESC, id DESC LIMIT $2`, agentID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []PolicyVersion{}
	for rows.Next() {
		var v PolicyVersion
		var allowed, denied []byte
		if err := rows.Scan(&v.Version, &allowed, &denied, &v.ConditionalRules, &v.Actor, &v.ChangedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(allowed, &v.AllowedTools)
		_ = json.Unmarshal(denied, &v.DeniedTools)
		out = append(out, v)
	}
	return out, rows.Err()
}

// ── P2 Demo Workspace sessions ──────────────────────────────────────────────

// DemoSession is one ephemeral visitor workspace.
type DemoSession struct {
	SessionID string    `json:"session_id"`
	AgentIDs  []string  `json:"agent_ids"`
	CreatedAt time.Time `json:"created_at"`
	ExpiresAt time.Time `json:"expires_at"`
	Expired   bool      `json:"expired"`
}

// CreateDemoSession persists a new workspace row.
func (s *Store) CreateDemoSession(sessionID string, agentIDs []string, ttl time.Duration) (DemoSession, error) {
	now := time.Now().UTC()
	ds := DemoSession{SessionID: sessionID, AgentIDs: agentIDs, CreatedAt: now, ExpiresAt: now.Add(ttl)}
	_, err := s.db.Exec(`INSERT INTO demo_sessions (session_id, agent_ids, created_at, expires_at) VALUES ($1,$2,$3,$4)`,
		sessionID, marshal(agentIDs), ds.CreatedAt, ds.ExpiresAt)
	return ds, err
}

// GetDemoSession returns a workspace row.
func (s *Store) GetDemoSession(sessionID string) (DemoSession, error) {
	var ds DemoSession
	var agents []byte
	err := s.db.QueryRow(`SELECT session_id, agent_ids, created_at, expires_at, expired FROM demo_sessions WHERE session_id=$1`, sessionID).
		Scan(&ds.SessionID, &agents, &ds.CreatedAt, &ds.ExpiresAt, &ds.Expired)
	if err != nil {
		return ds, err
	}
	_ = json.Unmarshal(agents, &ds.AgentIDs)
	return ds, nil
}

// DueDemoSessions returns not-yet-expired-flagged sessions past their expiry.
func (s *Store) DueDemoSessions() ([]DemoSession, error) {
	rows, err := s.db.Query(`SELECT session_id, agent_ids, created_at, expires_at, expired FROM demo_sessions
		WHERE expired = false AND expires_at < now()`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DemoSession
	for rows.Next() {
		var ds DemoSession
		var agents []byte
		if err := rows.Scan(&ds.SessionID, &agents, &ds.CreatedAt, &ds.ExpiresAt, &ds.Expired); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(agents, &ds.AgentIDs)
		out = append(out, ds)
	}
	return out, rows.Err()
}

// MarkDemoSessionExpired flags a workspace as torn down.
func (s *Store) MarkDemoSessionExpired(sessionID string) error {
	_, err := s.db.Exec(`UPDATE demo_sessions SET expired = true WHERE session_id=$1`, sessionID)
	return err
}
