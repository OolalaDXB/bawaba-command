#!/usr/bin/env bash
# Deterministic BAWABA product-demo scenario.
# Generates only real backend events, real Ed25519 routing proofs and a real
# server-side audit-chain verification. All business names and values are simulated.
set -euo pipefail

GW_URL="${BAWABA_GATEWAY_URL:-http://localhost:8080}"
API_URL="${BAWABA_API_URL:-http://localhost:8081}"
MCP_URL="${GW_URL}/mcp"

KEY_TEST="${BAWABA_DEMO_KEY_TEST:-test-key-12345}"
KEY_CLAUDE="${BAWABA_DEMO_KEY_CLAUDE:-claude-key-67890}"
KEY_CURSOR="${BAWABA_DEMO_KEY_CURSOR:-cursor-key-11111}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE=(docker compose)

bold='\033[1m'
green='\033[0;32m'
amber='\033[0;33m'
red='\033[0;31m'
reset='\033[0m'

usage() {
  cat <<'USAGE'
Usage: ./scripts/video-demo.sh <command>

Commands:
  prepare   Apply the evidence migration, clear demo audit events, restart gateway
  policy    Generate one explicit policy denial: claude-code -> git-push
  pii       Generate one tokenized request with simulated Moroccan PII
  routing   Generate one UAE-routed event with a real Ed25519 routing proof
  verify    Verify the persisted audit hash chain through the live API
  all       Run prepare, policy, pii, routing and verify in sequence
  status    Show API health and the latest persisted event
USAGE
}

wait_for_api() {
  local attempts=60
  printf '%bWaiting for BAWABA API%b' "$amber" "$reset"
  for _ in $(seq 1 "$attempts"); do
    if curl -fsS "${API_URL}/api/v1/health" >/dev/null 2>&1; then
      printf ' %bready%b\n' "$green" "$reset"
      return 0
    fi
    printf '.'
    sleep 1
  done
  printf ' %bnot reachable%b\n' "$red" "$reset"
  return 1
}

pretty_json() {
  python3 -m json.tool 2>/dev/null || cat
}

latest_event() {
  curl -fsS "${API_URL}/api/v1/events?page=1&limit=1" | python3 -c '
import json, sys
payload = json.load(sys.stdin)
events = payload.get("data") or []
if not events:
    print("No persisted events")
    raise SystemExit(0)
e = events[0]
proof = e.get("routing_proof") or ""
print(json.dumps({
  "event_id": e.get("event_id"),
  "agent_id": e.get("agent_id"),
  "tool": e.get("tool"),
  "policy_result": e.get("policy_result"),
  "pii_mode": e.get("pii_mode"),
  "entities_detected": e.get("entities_detected"),
  "jurisdiction": e.get("jurisdiction"),
  "mcp_server": e.get("mcp_server"),
  "routing_proof_persisted": bool(proof),
  "event_hash": e.get("event_hash"),
}, indent=2))
'
}

send_rpc() {
  local key="$1"
  local payload="$2"
  curl -sS -X POST "${MCP_URL}" \
    -H 'Content-Type: application/json' \
    -H "X-Bawaba-Key: ${key}" \
    --data "${payload}" || true
}

prepare() {
  cd "$ROOT_DIR"
  printf '%bPreparing deterministic demonstration environment%b\n' "$bold" "$reset"

  "${COMPOSE[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U bawaba -d bawaba \
    < migrations/002_demo_evidence.sql >/dev/null

  mkdir -p backups
  local stamp
  stamp="$(date +%Y%m%d_%H%M%S)"
  "${COMPOSE[@]}" exec -T postgres pg_dump -U bawaba -d bawaba \
    --data-only --table=audit_events > "backups/video-demo-before-${stamp}.sql"
  printf 'Audit backup: backups/video-demo-before-%s.sql\n' "$stamp"

  # TRUNCATE is intentionally used for the local demonstration reset. The
  # append-only trigger still blocks UPDATE and DELETE in normal operation.
  "${COMPOSE[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U bawaba -d bawaba \
    -c 'TRUNCATE TABLE audit_events;' >/dev/null

  # Trail.prevHash is loaded at process startup; restart after clearing the DB
  # so the next real event starts from the genesis hash.
  "${COMPOSE[@]}" restart gateway >/dev/null
  wait_for_api

  printf '%bReady:%b empty real audit chain, no seeded events.\n' "$green" "$reset"
  curl -fsS "${API_URL}/api/v1/events?page=1&limit=1" | python3 -c '
import json,sys
p=json.load(sys.stdin)
assert (p.get("meta") or {}).get("total", 0) == 0, p
print("Persisted events: 0")
'
}

policy() {
  printf '%bScenario 1 — policy denial%b\n' "$bold" "$reset"
  local response
  response=$(send_rpc "$KEY_CLAUDE" '{"jsonrpc":"2.0","id":101,"method":"tools/call","params":{"name":"git-push","arguments":{"repository":"bawaba-demo","branch":"main","force":true}}}')
  printf '%s\n' "$response" | pretty_json
  sleep 0.7
  latest_event
}

pii() {
  printf '%bScenario 2 — PII tokenization%b\n' "$bold" "$reset"
  local response
  response=$(send_rpc "$KEY_TEST" '{"jsonrpc":"2.0","id":102,"method":"tools/call","params":{"name":"echo","arguments":{"message":"Demo account MA76123456789012345678901234; contact +212661234567"}}}')
  printf '%s\n' "$response" | pretty_json
  sleep 0.7
  latest_event
}

routing() {
  printf '%bScenario 3 — sovereign routing proof (Morocco -> Casablanca)%b\n' "$bold" "$reset"
  local response
  # claude-code is a Moroccan-jurisdiction agent allowed to call git-read, so the
  # request routes to the Casablanca data plane and produces a real signed proof.
  response=$(send_rpc "$KEY_CLAUDE" '{"jsonrpc":"2.0","id":103,"method":"tools/call","params":{"name":"git-read","arguments":{"repository":"bawaba-demo","ref":"main","path":"README.md"}}}')
  printf '%s\n' "$response" | pretty_json
  sleep 0.7
  latest_event
}

verify() {
  printf '%bScenario 4 — server-side chain verification%b\n' "$bold" "$reset"
  echo '==> Verifying audit hash chain...'
  curl -fsS -X POST "${API_URL}/api/v1/events/verify" | pretty_json
}

status() {
  printf '%bAPI health%b\n' "$bold" "$reset"
  curl -fsS "${API_URL}/api/v1/health" | pretty_json
  printf '\n%bLatest event%b\n' "$bold" "$reset"
  latest_event
}

case "${1:-}" in
  prepare) prepare ;;
  policy) policy ;;
  pii) pii ;;
  routing) routing ;;
  verify) verify ;;
  status) status ;;
  all)
    prepare
    policy
    pii
    routing
    verify
    ;;
  *) usage; exit 2 ;;
esac
