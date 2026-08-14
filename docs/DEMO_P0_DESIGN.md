# Guided Demo + Control Room — P0 design (mandate v2, §11)

Scope: P0 ONLY — guided tool-allow/deny scenario + ONE minimal mutation
(edit an existing policy's tool lists). No full CRUD, no policy-as-first-class
refactor, no conditional/numeric engine (those are P1/P1.5 and are built for
real or not at all — never simulated).

## 1. Persistence abstraction (guard-rail §6)

One path, always: **Browser → BAWABA REST API (:8081) → engine/PostgreSQL**.
The frontend never talks to storage directly (the Supabase client remains
quarantined to the legacy hooks; the Guided Demo uses `services/api.ts` +
the gateway `/mcp` endpoint only). The P0 mutation goes through a new BAWABA
API endpoint; BAWABA validates, decides, writes the audit event. Managed
persistence (Supabase) arrives only in P2 behind this same API — never from
the browser.

## 2. P0 mutation API — edit an existing policy's tool lists

`PATCH /api/v1/policies/{agentId}`
Body: `{"allowed_tools": ["read_invoice","execute_payment"], "denied_tools": []}`

- 404 if the agent does not exist (no creation in P0).
- Validates shape (arrays of non-empty strings, no overlap allowed∩denied).
- Applies atomically to BOTH consumers of policy truth: the in-memory
  `policy.Engine` (which the proxy consults on every `tools/call`) and
  `cfg.Agents` (which `GET /api/v1/policies` reads) — same underlying data,
  no drift. Bumps `policy_version`.
- Appends a REAL signed audit event (`event_type: policy_change`,
  `matched_rule: manual_policy_edit`, params_hash = hash of the new lists) —
  the change itself becomes part of the tamper-evident chain and shows up in
  the live feed / verify.
- Honest limitation (documented in the response meta): the mutation lives in
  process memory; a gateway restart reloads the YAML config. Durable
  policies = P1 ("agents/policies persistants").

## 3. Guided Demo — the 11 steps (real engine, tool allow/deny)

Route `/demo`. Seeded agent in `configs/bawaba.yaml`:

```yaml
payment-assistant:
  auth: api_key
  allowed_tools: [read_invoice]
  denied_tools: [execute_payment]
  pii_mode: none
  jurisdiction: eu
```

| # | Step | Mechanics (all real) |
|---|---|---|
| 1 | Meet the agent | copy: "Payment Assistant handles supplier invoices." `GET /agents` |
| 2 | See its real policy | `GET /policies` → allowed `read_invoice`, denied `execute_payment` |
| 3 | Run a denied tool | `POST :8080/mcp tools/call execute_payment` (X-Bawaba-Key) |
| 4 | BAWABA decides: DENY | poll `GET /events?agent=payment-assistant` for the NEW event |
| 5 | The real why | render `matched_rule` + `policy_result` + `reason` VERBATIM from the event record — never paraphrased |
| 6 | Edit the REAL policy | `PATCH /policies/payment-assistant` (move execute_payment denied→allowed) — the policy_change event appears in the feed |
| 7 | Run again | same `POST /mcp` |
| 8 | BAWABA decides: ALLOW | same polling — new event |
| 9 | Side by side | both REAL event records (hashes, matched_rule, policy_version before/after) |
| 10 | Verify the evidence | `POST /events/verify` — server-side chain verification incl. both decisions |
| 11 | Human review | `POST /events/review` acknowledge/escalate on the ALLOW event |

Honesty rules in the UI: the demo REQUIRES the live gateway — if `:8080` /
`:8081` are unreachable it shows "Start the stack (docker compose up)" and
STOPS. No mock fallback, no injected events, ever, in the guided path. The
existing "Demonstration environment · simulated tenants" banner stays.

## 4. Entry chooser & Control Room

`/` becomes the chooser ("How would you like to explore BAWABA?" → Guided
Demo | Control Room). The dashboard moves to `/dashboard`; every other page
is unchanged — the Control Room IS the current console. Current visual
identity kept; zero restyle.

## 5. Already-read vs new writes

Read (existing, reused): health, agents, policies, events (+by id, stream),
stats, quotas, jurisdictions, verify, export. Writes existing: `/mcp`
tools/call, events/review, events/export. **New in P0: exactly one write —
`PATCH /api/v1/policies/{agentId}`** (+ its audit event). Nothing else.

## 6. Risks

- In-memory mutation lost on restart → stated in UI + API meta (P1 fixes).
- The proxy's terminal execution is the P1 stub (`executeToolCall`) — fine
  for P0: the DECISION, events, signatures and verify are real; the demo
  never claims a real payment ran. Copy says "the gateway records and signs
  the decision" — not "the payment executed".
- Concurrent demo users mutate the same policy (single shared state) —
  acceptable for a local demo; the ephemeral Demo Workspace is P2.
- CORS: `/mcp` is on :8080 (gateway handles it today for the simulate
  panel); PATCH goes to :8081 which has CORS middleware already.
