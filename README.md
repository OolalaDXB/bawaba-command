# Bawaba بوابة — Sovereign AI Control Plane

**The security and compliance layer between AI agents and enterprise tools.**

Bawaba is an MCP (Model Context Protocol) reverse proxy that enforces authentication, authorization, PII tokenization, sovereign data routing, and cryptographic audit trails — designed for regulated financial institutions in MENA and EU.

---

## Architecture

```
┌─────────────┐     ┌──────────────────────────────────────────────┐     ┌───────────┐
│  AI Agent   │────▶│              BAWABA GATEWAY                  │────▶│ MCP Server│
│ (Claude,    │     │                                              │     │ (Tools)   │
│  Cursor,    │     │  ┌──────┐ ┌──────┐ ┌─────┐ ┌──────┐ ┌────┐ │     └───────────┘
│  GPT, etc.) │     │  │ Auth │→│Policy│→│ PII │→│Router│→│Exec│ │
│             │◀────│  │Engine│ │Engine│ │Token│ │Proof │ │    │ │
└─────────────┘     │  └──────┘ └──────┘ └─────┘ └──────┘ └────┘ │
                    │       │       │       │       │       │      │
                    │       ▼       ▼       ▼       ▼       ▼      │
                    │  ┌──────────────────────────────────────────┐ │
                    │  │     Sealed Audit Trail (PostgreSQL)      │ │
                    │  │   SHA-256 hash chain · Ed25519 signed    │ │
                    │  │   Immutable (UPDATE/DELETE = EXCEPTION)  │ │
                    │  └──────────────────────────────────────────┘ │
                    └──────────────────────────────────────────────┘
```

Every request passes through **8 sequential stages**: Parse JSON-RPC → Authenticate → Rate Limit → Policy Evaluate → PII Tokenize → Sovereign Route → Execute → Audit Log.

**Fail-closed by design**: if any stage fails, the request is denied. No data leaves the perimeter.

---

## What's in this repo

This is a **monorepo** containing the full Bawaba stack:

### Backend (Go + Rust)

| Component | Path | LOC | Description |
|---|---|---|---|
| **MCP Gateway** | `cmd/gateway/main.go` | 201 | HTTP server, graceful shutdown, component wiring |
| **MCP Reverse Proxy** | `internal/proxy/proxy.go` | 539 | JSON-RPC 2.0 handler, full pipeline orchestration, SSE support |
| **Auth Engine** | `internal/auth/auth.go` | 205 | API key (bcrypt), Bearer token, mTLS client certificate |
| **Policy Engine** | `internal/policy/policy.go` | 124 | RBAC with allow/deny lists, wildcard matching, default-deny |
| **Audit Trail** | `internal/audit/audit.go` | 243 | SHA-256 hash chain, Ed25519 signatures, chain verification |
| **Rate Limiter** | `internal/ratelimit/ratelimit.go` | 166 | Per-agent sliding window, anomaly detection (bulk read) |
| **Sovereign Router** | `internal/router/router.go` | 110 | Jurisdiction-based routing with Ed25519 signed proofs |
| **Go↔Rust FFI** | `internal/tokenizer/tokenizer.go` | 73 | CGO bridge to Rust PII tokenizer |
| **Config** | `internal/config/config.go` | 141 | YAML parser with validation and defaults |
| **CLI** | `cmd/cli/main.go` | 134 | Config validation, agent listing, health check |
| **PII Tokenizer** | `rust/tokenizer/src/` | 355 | Rust library: 7 MENA PII regex patterns, Luhn validation, scoped token vault with TTL |

**Total backend: ~2,650 LOC Go + 355 LOC Rust**

### Frontend (React + TypeScript)

| Page | Path | Description |
|---|---|---|
| Dashboard | `src/pages/Index.tsx` | Real-time metrics, sparklines, jurisdiction stats, live event feed |
| Agents | `src/pages/Agents.tsx` | Agent registry with detail panels |
| Policy | `src/pages/Policy.tsx` | Policy viewer with YAML display |
| Audit Trail | `src/pages/AuditTrail.tsx` | Hash chain visualization, Merkle verification, charts |
| PII Tokenizer | `src/pages/PiiTokenizer.tsx` | Tokenization stats, entity type breakdown |
| Sovereign Routing | `src/pages/SovereignRouting.tsx` | SVG data plane map (MENA + EU nodes) |

**Total frontend: ~2,282 LOC TypeScript** (excluding shadcn/ui components)

### Infrastructure

| File | Description |
|---|---|
| `Dockerfile` | Multi-stage build: Rust → Go → Debian slim runtime |
| `docker-compose.yml` | PostgreSQL 16 + Gateway, health checks, volume persistence |
| `migrations/001_audit_schema.sql` | Audit events table, indexes, immutability trigger, agents table |
| `configs/bawaba.yaml` | Agent definitions, routing rules (MA/SA/AE/EU), rate limits |
| `Makefile` | Build, test, Docker, keygen targets |

### Tests (614 LOC)

```
internal/proxy/proxy_test.go      — 8 tests: health, unauth, initialize, tools/call
                                     allow/deny/unlisted, tools/list, fail-closed
internal/auth/auth_test.go        — 4 tests: valid key, invalid key, no creds, deny default
internal/policy/policy_test.go    — 6 tests: allow, deny, default-deny, unknown agent,
                                     deny precedence, wildcard
internal/audit/audit_test.go      — 3 tests: in-memory, hash chain, tamper detection
internal/ratelimit/ratelimit_test.go — 4 tests: parse, sliding window, limiter, anomaly
internal/config/config_test.go    — 4 tests: load, invalid auth, missing DB, defaults
```

---

## PII Patterns (Rust tokenizer)

The tokenizer detects and replaces PII with ephemeral UUID tokens before data reaches any LLM:

| Pattern | Example | Regex |
|---|---|---|
| IBAN | `MA64 0111 1111 1111 1111 1111 11` | `[A-Z]{2}\d{2}[A-Z0-9]{4,30}` |
| Phone | `+212 6 12 34 56 78` | `\+\d{1,3}[\s-]?\d{1,4}[\s-]?\d{3,4}[\s-]?\d{3,4}` |
| Email | `name@bank.ma` | Standard email regex |
| Morocco CIN | `BK123456` | `[A-Z]{1,2}\d{5,7}` |
| KSA NID/Iqama | `1234567890` | `[12]\d{9}` |
| UAE Emirates ID | `784-1990-1234567-1` | `784[-]?\d{4}[-]?\d{7}[-]?\d` |
| Credit Card | `4111 1111 1111 1111` | 13-19 digits + Luhn validation |

Tokens are scoped per `tenant:session`, stored in memory with configurable TTL, and automatically purged.

---

## Quick Start

### Prerequisites

- Docker & Docker Compose
- (Optional) Go 1.24+, Rust 1.85+, Node.js 20+ for local development

### Run with Docker (recommended)

```bash
# Clone and start
git clone https://github.com/OolalaDXB/bawaba-command.git
cd bawaba-command

# Start PostgreSQL + Gateway
docker compose up --build -d

# Verify
curl http://localhost:8080/healthz
# → {"status":"healthy","version":"0.1.0","time":"..."}
```

### Send MCP requests

```bash
# Authenticate and call a tool (allowed)
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -H "X-Bawaba-Key: test-key-12345" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"echo","arguments":{"text":"hello"}}}'

# Call a denied tool (→ 403)
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -H "X-Bawaba-Key: test-key-12345" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"database-write","arguments":{}}}'

# No auth (→ 401)
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/list"}'
```

### Run tests

```bash
# Go tests (no Rust dependency)
make test-go-nocgo

# Full test suite (requires Rust toolchain)
make test
```

### Build locally

```bash
# Build Rust tokenizer
make build-rust

# Build Go binaries
make build-go

# Binaries in bin/
./bin/bawaba-gateway
./bin/bawaba-cli config validate ./configs/bawaba.yaml
```

---

## Configuration

Agent policies are defined in `configs/bawaba.yaml`:

```yaml
agents:
  claude-code:
    auth: api_key
    allowed_tools:
      - database-query
      - git-read
      - jira-read
    denied_tools:
      - database-write
      - git-push
    pii_mode: tokenize      # tokenize | mask | none
    rate_limit: 1000/hour
    max_results: 50

routing:
  rules:
    - jurisdiction: ma
      backend: inwi-dc-casa
      compliance: [loi-09-08, cndp]
    - jurisdiction: sa
      backend: stc-cloud-riyadh
      compliance: [pdpl, sama-scf]
    - jurisdiction: ae
      backend: g42-abu-dhabi
      compliance: [fpdl, difc, adgm]
    - jurisdiction: eu
      backend: hetzner-frankfurt
      compliance: [gdpr, dora]
```

---

## Audit Trail

Every event is hash-chained and signed:

```
Event N:
  event_hash = SHA-256(event_data + prev_hash)
  signature  = Ed25519.Sign(private_key, event_hash)
  prev_hash  = Event N-1 event_hash

PostgreSQL trigger: UPDATE or DELETE → EXCEPTION('Audit events are immutable')
```

Verify chain integrity programmatically:

```go
err := audit.VerifyChain(events, publicKey)
// Returns nil if chain is intact
// Returns error with exact tampered event index if modified
```

---

## Sovereign Routing

Each routing decision includes a cryptographic proof:

```json
{
  "backend": "inwi-dc-casa",
  "jurisdiction": "ma",
  "compliance": ["loi-09-08", "cndp"],
  "proof": "ed25519:a1b2c3...",    // Signed routing attestation
  "timestamp": "2026-02-17T14:30:00Z"
}
```

Data never leaves the configured jurisdiction. Routing proofs are stored in the audit trail.

---

## Project Status

**Phase 1 (current)**: Core control plane operational. Full pipeline: auth → policy → PII → routing → audit. Docker deployment. 26 tests passing. CISO dashboard with live data.

**Phase 2 (planned)**: SSO/SAML, JWT OAuth2 validation, TEE activation (AMD SEV-SNP), NER-based PII detection, multi-region deployment, Prometheus metrics, SDK.

**Phase 3 (planned)**: Proof Pack J90 export (signed JSON + PDF), SLM-based anomaly detection, MCP server registry, compliance automation.

---

## License

Proprietary. All rights reserved. © 2026 Oolala Holding.
