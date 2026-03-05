# BAWABA بوابة

**Sovereign AI Control Plane for Regulated Industries**

Bawaba is a security gateway that sits between AI agents (Claude, ChatGPT, Copilot, Gemini) and enterprise systems. Every MCP (Model Context Protocol) call passes through a 6-stage fail-closed pipeline — authentication, policy enforcement, PII tokenization, sovereign routing, rate limiting, and tamper-evident audit — before reaching any backend.

No data passes in cleartext. No agent operates without identity. No action escapes the audit trail.

---

## Architecture

```
AI Agents                          Enterprise Systems
(Claude, Cursor,                   (Core Banking, CRM,
 ChatGPT, Gemini)                   Databases, APIs)
       │                                  ▲
       ▼                                  │
┌──────────────────────────────────────────┐
│             BAWABA GATEWAY               │
│                                          │
│  Auth → Policy → PII → Route → Audit    │
│   │       │       │      │       │       │
│  mTLS   RBAC    Rust   Geo    SHA-256    │
│  Bearer YAML    FFI    YAML   Ed25519    │
│  (P1*)         7 MENA  proof  append     │
│  bcrypt        patterns       only       │
└──────────────────────────────────────────┘
         :8080 (MCP proxy)
         :8081 (REST API + SSE)
         :5173 (CISO Dashboard)
```

## What's Inside

```
bawaba-command/
├── cmd/
│   ├── gateway/main.go            # Gateway entrypoint (Go)
│   └── cli/main.go                # CLI tool (Go)
├── internal/
│   ├── proxy/proxy.go             # MCP reverse proxy — JSON-RPC 2.0 interception
│   ├── auth/auth.go               # Auth engine — Bearer (shared secret, pilot), bcrypt, mTLS
│   ├── policy/policy.go           # Policy engine — RBAC from YAML
│   ├── audit/audit.go             # Hash chain — SHA-256 + Ed25519 signatures
│   ├── ratelimit/ratelimit.go     # Sliding window + anomaly detection
│   ├── router/router.go           # Sovereign routing + cryptographic proof
│   ├── tokenizer/tokenizer.go     # Go↔Rust FFI bridge
│   ├── api/server.go              # REST API — 15 endpoints + SSE
│   ├── api/middleware.go          # Middleware chain (Kong-inspired)
│   ├── api/quota.go               # Per-agent quota enforcement
│   ├── siem/siem.go               # SIEM forwarder (webhook, Splunk stub)
│   └── config/config.go           # YAML config parser
├── rust/tokenizer/
│   ├── src/lib.rs                 # PII tokenizer — FFI export
│   ├── src/regex.rs               # 7 MENA patterns + Luhn validation
│   └── src/vault.rs               # Token vault with TTL
├── src/                           # CISO Dashboard (React + TypeScript + Vite)
│   ├── pages/Index.tsx            # Home — metrics, live feed, compliance
│   ├── pages/AuditTrail.tsx       # Hash chain visualization + verify
│   ├── pages/Agents.tsx           # Agent registry + quotas
│   ├── pages/Policy.tsx           # Policy rules viewer
│   ├── pages/PiiTokenizer.tsx     # PII stats + vault status
│   ├── pages/SovereignRouting.tsx # SVG map + routing proofs
│   └── pages/Settings.tsx         # Gateway config (read-only)
├── migrations/
│   └── 001_audit_schema.sql       # PostgreSQL — append-only + immutability trigger
├── scripts/
│   ├── demo.sh                    # Generate 58 demo events (9 scenarios)
│   ├── deploy-ovh.sh              # Deploy to OVHcloud VPS (European, non-US jurisdiction)
│   └── bench.sh                   # Latency benchmark (P50/P95/P99)
├── configs/bawaba.yaml            # Agent keys, policies, routing rules, quotas
├── .github/workflows/ci.yml       # CI: Go test + vet + Docker build
├── Dockerfile                     # Multi-stage: Rust → Go → Debian
├── docker-compose.yml             # PostgreSQL + Gateway
└── Makefile                       # 12 targets (build, test, demo, verify, bench...)
```

## Quickstart

```bash
# Prerequisites: Docker, Docker Compose, Make

# Clone
git clone https://github.com/OolalaDXB/bawaba-command.git
cd bawaba-command

# Start gateway + PostgreSQL
make up

# Verify health
curl http://localhost:8081/api/v1/health

# Run the demo — 58 events across 9 scenarios:
# authorized calls, blocked agents, PII tokenization,
# sovereign routing, chain verification
make demo

# Open the CISO dashboard
open http://localhost:5173

# Verify audit chain integrity (SHA-256 + Ed25519)
make verify

# Run latency benchmark
make bench

# Stop everything
make down
```

## The 6-Stage Pipeline

Every MCP request passes through all 6 stages. If any stage fails, the request is **blocked** (fail-closed).

| Stage | Module | What it does |
|-------|--------|-------------|
| **1. Auth** | `internal/auth` | Identifies the AI agent. Unknown agent → blocked immediately. Bearer token (shared secret, pilot mode — OIDC/JWT planned P2), bcrypt, mTLS. |
| **2. Policy** | `internal/policy` | Checks if this agent is allowed to call this tool. YAML-defined RBAC. Unauthorized tool → blocked. |
| **3. PII** | `rust/tokenizer` | Scans request payload for sensitive data. 7 MENA patterns (IBAN MA/FR, CIN, Iqama, Emirates ID, phone, email, credit card with Luhn). Detected PII → replaced with UUID tokens. Rust for memory safety. |
| **4. Route** | `internal/router` | Routes data to the correct sovereign data plane based on jurisdiction. Moroccan data → European hosting (non-US). Cryptographic routing proof generated. |
| **5. Rate** | `internal/ratelimit` | Sliding window rate limiter + behavioral anomaly detection. Abnormal patterns → throttled or blocked. |
| **6. Audit** | `internal/audit` | Every event appended to a SHA-256 hash chain signed with Ed25519. Each event contains the hash of the previous one. Tamper one event → the chain breaks. PostgreSQL append-only with immutability trigger. |

## PII Patterns Detected

The Rust tokenizer detects and replaces these patterns before data leaves the perimeter:

| Pattern | Example | Jurisdiction |
|---------|---------|-------------|
| IBAN Morocco | `MA76 1234 5678 9012 3456 7890 1234` | Loi 09-08 |
| IBAN France | `FR76 1234 5678 9012 3456 7890 123` | RGPD |
| CIN Morocco | `AB123456` | Loi 09-08 |
| Iqama (KSA) | `2012345678` | PDPL/SAMA |
| Emirates ID | `784-1990-1234567-1` | UAE PDPL |
| Phone (intl) | `+212 6XX XXX XXX` | Multiple |
| Credit Card | Luhn-validated 16-digit | PCI-DSS |

## Audit Trail

The audit system provides **mathematical proof** that no event has been altered:

```
Event #1          Event #2          Event #3
┌──────────┐     ┌──────────┐     ┌──────────┐
│ data     │     │ data     │     │ data     │
│ hash: a3f│────▶│ prev: a3f│────▶│ prev: 7b2│
│ sig: Ed  │     │ hash: 7b2│     │ hash: e91│
└──────────┘     │ sig: Ed  │     │ sig: Ed  │
                 └──────────┘     └──────────┘
```

- **SHA-256** hash chain: each event includes the hash of the previous event
- **Ed25519** signature: each event is cryptographically signed
- **Append-only PostgreSQL**: immutability trigger prevents UPDATE/DELETE
- **One-click verification**: `make verify` checks the entire chain in seconds

## Configuration

All configuration lives in `configs/bawaba.yaml`:

```yaml
gateway:
  proxy_port: 8080
  api_port: 8081

agents:
  - name: claude-code
    key_hash: "$2a$10$..."    # bcrypt hash
    allowed_tools: [database-query, git-read, jira-read]
    jurisdiction: ma

  - name: cursor-ide
    key_hash: "$2a$10$..."
    allowed_tools: [git-read, git-write]
    jurisdiction: eu

routing:
  jurisdictions:
    ma:
      name: Morocco
      data_plane: eu-west       # European hosting, non-US
      law: "Loi 09-08"
    sa:
      name: Saudi Arabia
      data_plane: eu-west
      law: "PDPL / SAMA"
    ae:
      name: UAE
      data_plane: eu-west
      law: "UAE PDPL / DIFC"

quotas:
  default_limit: 1000
  period: 1h
  overrides:
    claude-code: 5000
```

## Tech Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| Gateway proxy | **Go** | Native concurrency, sub-5ms latency, no runtime |
| PII tokenizer | **Rust** (FFI → Go) | Memory safety for sensitive data processing. No buffer overflow possible. |
| Audit storage | **PostgreSQL** | Append-only with immutability trigger. Proven, auditable. |
| Dashboard | **React + TypeScript + Vite** | CISO console. Cormorant Garamond + DM Sans + JetBrains Mono. |
| Signatures | **Ed25519** | Fast, compact, quantum-resistant-ready |
| Deployment | **Docker Compose** | Single `make up`. No Kubernetes needed for first clients. |
| CI | **GitHub Actions** | Automated Go test + vet + Docker build on every push |

## Deployment

Bawaba deploys inside the client's perimeter (VPC or on-premises). It is **not** a SaaS — data never leaves the institution's infrastructure.

```bash
# Deploy to OVHcloud VPS (European, non-US jurisdiction)
./scripts/deploy-ovh.sh <VPS_IP>

# Deploy with HTTPS (Let's Encrypt)
./scripts/deploy-ovh.sh <VPS_IP> demo.bawaba.io
```

Production deployment: Docker Compose on a single server. No external dependencies. No phone-home. Air-gapped mode planned for P3.

## API

REST API on `:8081` with 15 endpoints:

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/health` | Gateway status, uptime, module health |
| `GET /api/v1/events` | Paginated audit events (filter by agent, action, jurisdiction) |
| `GET /api/v1/events/stream` | SSE — real-time event stream |
| `GET /api/v1/events/:id` | Single event detail |
| `POST /api/v1/events/verify` | Verify hash chain integrity |
| `POST /api/v1/events/export` | Export filtered events (CSV/JSON) |
| `GET /api/v1/stats` | Aggregated metrics (calls/min, deny rate, latency) |
| `GET /api/v1/stats/pii` | PII stats by type and day |
| `GET /api/v1/agents` | Registered agents from config |
| `GET /api/v1/agents/:id/activity` | Recent activity per agent |
| `GET /api/v1/agents/:id/quota` | Quota usage and remaining |
| `GET /api/v1/policies` | Active policy rules |
| `GET /api/v1/jurisdictions` | Configured jurisdictions + routing stats |
| `GET /api/v1/siem/status` | SIEM forwarder status |

## Compliance Coverage

Bawaba is designed for regulated financial institutions in MENA and EU:

| Regulation | Jurisdiction | Coverage |
|-----------|-------------|----------|
| **Loi 09-08** | Morocco | PII protection, CNDP notification, transfer controls |
| **PDPL + SAMA** | Saudi Arabia | Data classification, consent, cross-border transfer |
| **UAE PDPL + DIFC** | UAE | Data processing, sovereign routing, audit trail |
| **RGPD + DORA** | EU | Data protection, operational resilience |

## Security Posture

- **Fail-closed**: if any module is unavailable, all requests are blocked
- **No cleartext default**: PII is tokenized before transmission
- **No secrets in code**: agent keys are bcrypt hashes, Ed25519 keys generated at deploy time
- **Append-only audit**: PostgreSQL trigger prevents UPDATE/DELETE on audit table
- **Memory-safe PII processing**: Rust tokenizer — no buffer overflow possible
- **Non-US hosting**: deployment scripts target European infrastructure (OVHcloud)

## Roadmap

| Phase | Timeline | Features |
|-------|----------|----------|
| **P1** ✅ | Jan–Mar 2026 | Gateway, API, Dashboard, Audit, PII, Routing, DevOps |
| **P2** | T3–T4 2026 | OIDC/JWT Bearer auth, Advanced quotas, SIEM native, cache, analytics, SSO, NER, Compliance-as-Code |
| **P3** | T1–T2 2027 | TEE (AMD SEV), MCP Server Registry, WASM plugins, mobile app, air-gapped deploy |

## License

Proprietary — Oolala Next FZ-LLC. All rights reserved.

## Contact

**Oolala Next FZ-LLC** — Dubai, UAE
contact@bawaba.io
