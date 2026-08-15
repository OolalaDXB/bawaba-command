# Managed / shareable demo deployment (P2)

Goal: a link-shareable hosted demo (e.g. `demo.bawaba.systems`) with managed
persistence — **through the persistence abstraction, never directly**. The
guard-rail (mandate §6) holds everywhere:

```
Browser → BAWABA REST API (:8081) / gateway (:8080) → PostgreSQL (local OR managed)
```

The browser NEVER talks to the database. The abstraction is `database/sql` +
`BAWABA_DB_URL`: pointing it at a managed Postgres (e.g. Supabase's Postgres,
via its **connection pooler**) is a config change, not a code change.

## 1. Managed database (Supabase Postgres — as a database, not a client SDK)

1. In the Supabase project: Settings → Database → Connection string
   (Transaction pooler, port 6543) — take the `postgres://…` URI.
2. Apply migrations 001 → 004 once against it (order matters):
   ```bash
   for f in migrations/001_audit_schema.sql migrations/002_demo_evidence.sql \
            migrations/003_control_plane.sql migrations/004_demo_sessions.sql \
            migrations/999_demo_seed.sql; do
     psql "$SUPABASE_DB_URL" -f "$f"
   done
   ```
   (999 is optional — pre-populated dashboards; fictional tenants only.)
3. The `src/integrations/supabase/` client-SDK path in the console is legacy
   Lovable scaffolding and must NOT be used for control-plane data — the
   managed database is reached exclusively by the gateway.

## 2. Gateway on a VPS (existing script)

```bash
BAWABA_DB_URL="postgres://…pooler…:6543/postgres?sslmode=require" \
  ./scripts/deploy-ovh.sh <VPS_IP> demo.bawaba.systems
```

Set the same `BAWABA_DB_URL` in the compose environment on the VPS (it
overrides the local Postgres service; you can drop the `postgres` service
entirely in the managed variant). Keep `BAWABA_AGENT_KEY_*` env values
secret — or rely only on workspace-created agents for the public demo.

## 3. Console

`npm run build` with:
```
VITE_API_URL=https://demo.bawaba.systems:8443   # or a reverse-proxied path
VITE_GATEWAY_URL=https://demo.bawaba.systems:8444
```
and serve `dist/` from any static host. Put both API ports behind TLS
(Caddy/nginx on the VPS — the Go listener itself is plain HTTP today; that
limitation is known and recorded).

## 4. Public-exposure posture (honesty + safety)

- The public entry is the **Private Workspace** (ephemeral `demo-xxxx`
  session, ~60 min TTL, janitor teardown): visitors edit THEIR clones; the
  canonical seeded agents stay clean; audit events remain append-only.
- **P2→P3 security debt: CLOSED (P3).** Set `BAWABA_PUBLIC_DEMO=true` on a
  public host: the gateway then rejects control-plane mutations
  (POST/PATCH/DELETE /agents, PATCH /policies) on anything that is not a
  workspace clone (`…-demo-…` ids), and makes routing rules read-only. The
  canonical seeded agents cannot be touched from the public link. On a
  laptop (flag unset) nothing changes.
- The "Demonstration environment" banner stays on every page.

## 5. P3 — shareable workspace URL + Souffleur

- **Share link**: an active Private Workspace exposes "Copy shareable link"
  on the entrance page. The link is `…/join#<payload>`; the payload (session
  id + clone API keys) travels in the URL *fragment*, which never leaves the
  browser — no server or access log sees the keys. `/join` validates the
  session against the gateway (expired/torn-down → honest message, nothing
  recreated silently) before adopting it.
- **Souffleur** (translation-only, mandate §7; from the French for a theater prompter — it whispers what the script says, it never acts): set on the gateway host —
  ```bash
  BAWABA_SOUFFLEUR_PROVIDER=anthropic   # or: mistral | openai | openai-compatible
  BAWABA_SOUFFLEUR_API_KEY=…            # provider credential
  BAWABA_SOUFFLEUR_MODEL=…              # default: claude-opus-5 / mistral-large-latest
  BAWABA_SOUFFLEUR_BASE_URL=…           # self-hosted vLLM/Ollama (openai-compatible)
  ```
  `POST /api/v1/souffleur/explain {event_id}` loads the REAL audit event and
  returns a plain-language translation of its decision fields plus the exact
  source fields used. Unset → 503 ("the Souffleur never invents"). The
  sovereign option is `openai-compatible` + a self-hosted endpoint.
