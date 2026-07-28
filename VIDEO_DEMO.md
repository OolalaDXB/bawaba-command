# BAWABA deterministic product-video runbook

This runbook produces a short, technically defensible BAWABA product demo.
The console is real, the policy decision is real, PII processing is real, the
routing proof is signed by the running gateway, and the audit verification is
performed by the live server. Tenant names, request contents and volumes are
simulated demonstration data.

## What the patch fixes

- The React client now reads the real REST envelope used by the Go API.
- The Policy screen now reflects the active YAML-backed in-memory engine; it no longer presents a fictional compiled Rego policy.
- SSE streams the complete persisted audit event instead of an incompatible
  reduced payload.
- A reachable but empty API no longer silently falls back to random events.
- Routing rows come from persisted signed routing proofs, not `Math.random()`.
- The PII page displays only fields actually persisted by the API; it no longer
  invents an entity category or a token UUID.
- `routing_proof` is persisted in PostgreSQL and returned by REST/SSE/export.
- The UI carries a permanent demonstration-data disclosure.

## Local setup

Run from the repository root:

```bash
docker compose up -d --build
make video-prepare
```

In a second Terminal:

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5173`.

## Database schema

Migration `001_audit_schema.sql` is never modified. The `routing_proof` column
is added by the additive, idempotent migration `002_demo_evidence.sql`
(`ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS routing_proof TEXT DEFAULT ''`),
mounted after `001` and before the demo seed `999`.

`docker compose down -v` is **destructive**: it deletes the Postgres volume. It
is required **only** when you want to rebuild the local demonstration database
from the Docker init scripts (`001` → `002` → `999`). An already-provisioned
database picks up the column by running `002` once; it does not need `down -v`.

## Deterministic scenes

Do not run `make video-demo` while recording. Generate each event only when the
corresponding page is visible.

### Scene 1 — Policy denial

1. Open **Policy**.
2. Keep the policy evaluation log visible.
3. In the Terminal run `make video-policy`.
4. Wait for the new `claude-code / git-push / deny` row.

### Scene 2 — PII tokenization

1. Open **PII**.
2. Keep the live tokenization feed visible.
3. Run `make video-pii`.
4. Wait for the new `test-agent` row showing persisted `tokenize` mode and the
   entity count. The actual sensitive value is not written to the audit log.

### Scene 3 — Signed jurisdiction routing

1. Open **Sovereign Routing**.
2. Keep the routing-proofs table visible.
3. Run `make video-routing`.
4. Wait for the new `cursor-ide / git-read -> Abu Dhabi` row.
5. Click that row to open the persisted canonical payload and Ed25519 signature.

### Scene 4 — Audit-chain verification

1. Open **Audit Trail**.
2. Keep the hash-chain blocks and **Verify integrity** button visible.
3. Click **Verify integrity** and wait for the successful result.
4. For the matching terminal output, run `make video-verify` after the click.

## Disclosure

The UI must show:

> Demonstration environment · simulated tenants, events and volumes · no customer data

For a deck or video caption use:

> BAWABA demonstration console. All tenants, events, volumes and policy decisions shown are simulated.
