#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# Bawaba Gateway — Live Demo Script
# Generates ~70 MCP events: authorized, denied, PII, unknown agents, etc.
# Usage: ./scripts/demo.sh [gateway_url]
# ──────────────────────────────────────────────────────────────────────
set -euo pipefail

GW="${1:-http://localhost:8080}"
MCP="$GW/mcp"

# Counters
ALLOW=0; DENY=0; AUTH_FAIL=0; PII=0; TOTAL=0

# Colors
G='\033[0;32m'; R='\033[0;31m'; Y='\033[0;33m'; C='\033[0;36m'; NC='\033[0m'

banner() {
    echo ""
    echo -e "${C}╔══════════════════════════════════════════════════════╗${NC}"
    echo -e "${C}║          BAWABA GATEWAY — LIVE DEMO                 ║${NC}"
    echo -e "${C}║   Multi-jurisdiction MCP security gateway           ║${NC}"
    echo -e "${C}╚══════════════════════════════════════════════════════╝${NC}"
    echo ""
}

# Send a JSON-RPC request and display result
send() {
    local label="$1" key="$2" method="$3" params="$4"
    TOTAL=$((TOTAL + 1))

    local response status
    response=$(curl -sS -w '\n%{http_code}' -X POST "$MCP" \
        -H "Content-Type: application/json" \
        -H "X-Bawaba-Key: $key" \
        -d "{\"jsonrpc\":\"2.0\",\"id\":$TOTAL,\"method\":\"$method\",\"params\":$params}" 2>/dev/null) || true

    status=$(echo "$response" | tail -1)
    local body
    body=$(echo "$response" | sed '$d')

    if echo "$body" | grep -q '"error"'; then
        local err_msg
        err_msg=$(echo "$body" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error',{}).get('message','?'))" 2>/dev/null || echo "error")
        if echo "$err_msg" | grep -qi "unauthorized\|auth"; then
            AUTH_FAIL=$((AUTH_FAIL + 1))
            printf "  ${R}[DENY-AUTH]${NC}  %-50s → %s\n" "$label" "$err_msg"
        elif echo "$err_msg" | grep -qi "denied\|not allowed\|policy\|rate"; then
            DENY=$((DENY + 1))
            printf "  ${Y}[DENY]${NC}      %-50s → %s\n" "$label" "$err_msg"
        else
            DENY=$((DENY + 1))
            printf "  ${Y}[ERROR]${NC}     %-50s → %s\n" "$label" "$err_msg"
        fi
    else
        ALLOW=$((ALLOW + 1))
        # Check if PII tokenization occurred (look for tok_ or [REDACTED] in response)
        if echo "$body" | grep -qE 'tok_|REDACTED|\*\*\*'; then
            PII=$((PII + 1))
            printf "  ${G}[ALLOW+PII]${NC} %-50s → tokenized\n" "$label"
        else
            printf "  ${G}[ALLOW]${NC}     %-50s → ok\n" "$label"
        fi
    fi
}

delay() {
    sleep "$(awk "BEGIN{print 0.5 + rand() * 1.5}")"
}

# ─── Keys ─────────────────────────────────────────────────
KEY_TEST="test-key-12345"
KEY_CLAUDE="claude-key-67890"
KEY_CURSOR="cursor-key-11111"
KEY_BAD="invalid-key-xxxxx"

# ─── Start ────────────────────────────────────────────────
banner

echo -e "${C}[Phase 1] Health & Initialization${NC}"
echo "─────────────────────────────────────────────"

# Health check
echo -n "  Gateway health: "
curl -sS "$GW/healthz" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','?'))" 2>/dev/null || echo "unreachable"
echo ""

# Initialize sessions
send "test-agent: initialize session" "$KEY_TEST" "initialize" '{"capabilities":{}}'
delay
send "claude-code: initialize session" "$KEY_CLAUDE" "initialize" '{"capabilities":{}}'
delay
send "cursor-ide: initialize session" "$KEY_CURSOR" "initialize" '{"capabilities":{}}'
delay

echo ""
echo -e "${C}[Phase 2] Normal Tool Operations${NC}"
echo "─────────────────────────────────────────────"

# test-agent: allowed tools (echo, time)
send "test-agent: echo hello" "$KEY_TEST" "tools/call" '{"name":"echo","arguments":{"message":"Hello Bawaba"}}'
delay
send "test-agent: get time" "$KEY_TEST" "tools/call" '{"name":"time","arguments":{}}'
delay
send "test-agent: echo again" "$KEY_TEST" "tools/call" '{"name":"echo","arguments":{"message":"System check OK"}}'
delay

# claude-code: allowed tools (database-query, git-read, jira-read)
send "claude-code: database query" "$KEY_CLAUDE" "tools/call" '{"name":"database-query","arguments":{"sql":"SELECT count(*) FROM users"}}'
delay
send "claude-code: git read" "$KEY_CLAUDE" "tools/call" '{"name":"git-read","arguments":{"repo":"bawaba","ref":"main"}}'
delay
send "claude-code: jira read" "$KEY_CLAUDE" "tools/call" '{"name":"jira-read","arguments":{"ticket":"BAW-42"}}'
delay

# cursor-ide: allowed tools (git-read, git-write)
send "cursor-ide: git read main" "$KEY_CURSOR" "tools/call" '{"name":"git-read","arguments":{"repo":"bawaba","ref":"main"}}'
delay
send "cursor-ide: git write feature" "$KEY_CURSOR" "tools/call" '{"name":"git-write","arguments":{"repo":"bawaba","branch":"feature/demo"}}'
delay

echo ""
echo -e "${C}[Phase 3] Policy Denials (forbidden tools)${NC}"
echo "─────────────────────────────────────────────"

# test-agent tries tools it doesn't have
send "test-agent: database-query (denied)" "$KEY_TEST" "tools/call" '{"name":"database-query","arguments":{"sql":"SELECT * FROM secrets"}}'
delay
send "test-agent: git-push (denied)" "$KEY_TEST" "tools/call" '{"name":"git-push","arguments":{"repo":"bawaba","branch":"main"}}'
delay

# claude-code tries denied tools
send "claude-code: database-write (explicit deny)" "$KEY_CLAUDE" "tools/call" '{"name":"database-write","arguments":{"sql":"DROP TABLE users"}}'
delay
send "claude-code: git-push (explicit deny)" "$KEY_CLAUDE" "tools/call" '{"name":"git-push","arguments":{"repo":"bawaba","branch":"main","force":true}}'
delay

# cursor-ide tries tools outside its scope
send "cursor-ide: database-query (denied)" "$KEY_CURSOR" "tools/call" '{"name":"database-query","arguments":{"sql":"SELECT * FROM audit_events"}}'
delay
send "cursor-ide: jira-read (denied)" "$KEY_CURSOR" "tools/call" '{"name":"jira-read","arguments":{"ticket":"BAW-1"}}'
delay

echo ""
echo -e "${C}[Phase 4] Authentication Failures${NC}"
echo "─────────────────────────────────────────────"

# Unknown agent with bad key
send "unknown-agent: bad key" "$KEY_BAD" "tools/call" '{"name":"echo","arguments":{}}'
delay
send "unknown-agent: empty key" "" "tools/call" '{"name":"echo","arguments":{}}'
delay
send "hacker-bot: injection attempt" "$KEY_BAD" "tools/call" '{"name":"database-query","arguments":{"sql":"1; DROP TABLE audit_events;--"}}'
delay

echo ""
echo -e "${C}[Phase 5] PII Detection & Tokenization${NC}"
echo "─────────────────────────────────────────────"

# Moroccan PII
send "claude-code: query with IBAN MA" "$KEY_CLAUDE" "tools/call" '{"name":"database-query","arguments":{"sql":"SELECT * FROM accounts WHERE iban = '\''MA76 1234 5678 9012 3456 7890 1234'\''"}}'
delay
send "claude-code: query with CIN" "$KEY_CLAUDE" "tools/call" '{"name":"database-query","arguments":{"sql":"SELECT * FROM users WHERE cin = '\''AB123456'\''"}}'
delay

# Saudi PII
send "claude-code: query with Saudi NID" "$KEY_CLAUDE" "tools/call" '{"name":"database-query","arguments":{"sql":"SELECT * FROM users WHERE national_id = '\''1012345678'\''"}}'
delay

# UAE PII
send "claude-code: query with Emirates ID" "$KEY_CLAUDE" "tools/call" '{"name":"database-query","arguments":{"sql":"SELECT * FROM users WHERE emirates_id = '\''784-1990-1234567-1'\''"}}'
delay

# French/EU PII
send "claude-code: query with French IBAN" "$KEY_CLAUDE" "tools/call" '{"name":"database-query","arguments":{"sql":"SELECT * FROM accounts WHERE iban = '\''FR76 3000 6000 0112 3456 7890 189'\''"}}'
delay

# Email + phone
send "claude-code: query with email" "$KEY_CLAUDE" "tools/call" '{"name":"database-query","arguments":{"sql":"SELECT * FROM users WHERE email = '\''ahmed.benali@attijari.ma'\''"}}'
delay
send "claude-code: query with phone" "$KEY_CLAUDE" "tools/call" '{"name":"database-query","arguments":{"sql":"SELECT * FROM users WHERE phone = '\''+212 661 234567'\''"}}'
delay

echo ""
echo -e "${C}[Phase 6] Resource & Prompt Operations${NC}"
echo "─────────────────────────────────────────────"

send "claude-code: list resources" "$KEY_CLAUDE" "resources/list" '{}'
delay
send "claude-code: read resource" "$KEY_CLAUDE" "resources/read" '{"uri":"file:///config/bawaba.yaml"}'
delay
send "cursor-ide: list prompts" "$KEY_CURSOR" "prompts/list" '{}'
delay
send "cursor-ide: get prompt" "$KEY_CURSOR" "prompts/get" '{"name":"code-review"}'
delay

echo ""
echo -e "${C}[Phase 7] Bulk Operations (anomaly detection)${NC}"
echo "─────────────────────────────────────────────"

echo "  Sending 15 rapid requests from test-agent..."
for i in $(seq 1 15); do
    send "test-agent: rapid echo #$i" "$KEY_TEST" "tools/call" "{\"name\":\"echo\",\"arguments\":{\"seq\":$i}}"
    sleep 0.3
done

echo ""
echo -e "${C}[Phase 8] Tool List Discovery${NC}"
echo "─────────────────────────────────────────────"

send "test-agent: list tools" "$KEY_TEST" "tools/list" '{}'
delay
send "claude-code: list tools" "$KEY_CLAUDE" "tools/list" '{}'
delay
send "cursor-ide: list tools" "$KEY_CURSOR" "tools/list" '{}'
delay

echo ""
echo -e "${C}[Phase 9] Mixed Realistic Workload${NC}"
echo "─────────────────────────────────────────────"

send "claude-code: git read package.json" "$KEY_CLAUDE" "tools/call" '{"name":"git-read","arguments":{"repo":"bawaba","path":"package.json"}}'
delay
send "cursor-ide: git write hotfix" "$KEY_CURSOR" "tools/call" '{"name":"git-write","arguments":{"repo":"bawaba","branch":"hotfix/auth-fix","message":"fix auth edge case"}}'
delay
send "claude-code: jira read sprint" "$KEY_CLAUDE" "tools/call" '{"name":"jira-read","arguments":{"ticket":"BAW-99","fields":["summary","status"]}}'
delay
send "test-agent: echo with PII" "$KEY_TEST" "tools/call" '{"name":"echo","arguments":{"message":"Contact ahmed@bank.ma or call +212661234567 for IBAN MA76123456789012345678901234"}}'
delay
send "claude-code: complex query" "$KEY_CLAUDE" "tools/call" '{"name":"database-query","arguments":{"sql":"SELECT a.agent_id, COUNT(*) as calls FROM audit_events a GROUP BY a.agent_id ORDER BY calls DESC LIMIT 10"}}'
delay

# A few more auth failures
send "rogue-bot: steal data" "$KEY_BAD" "tools/call" '{"name":"database-query","arguments":{"sql":"SELECT * FROM agents WHERE api_key_hash IS NOT NULL"}}'
delay
send "pentest-agent: scan ports" "$KEY_BAD" "tools/call" '{"name":"shell-exec","arguments":{"cmd":"nmap -sS localhost"}}'
delay

# Final allowed requests
send "test-agent: final echo" "$KEY_TEST" "tools/call" '{"name":"echo","arguments":{"message":"Demo complete"}}'
delay
send "claude-code: final git read" "$KEY_CLAUDE" "tools/call" '{"name":"git-read","arguments":{"repo":"bawaba","ref":"HEAD"}}'

# ─── Summary ──────────────────────────────────────────────
echo ""
echo ""
echo -e "${C}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${C}║                    DEMO SUMMARY                     ║${NC}"
echo -e "${C}╠══════════════════════════════════════════════════════╣${NC}"
printf "${C}║${NC}  Total requests:    %-33d${C}║${NC}\n" "$TOTAL"
printf "${C}║${NC}  ${G}Allowed:${NC}           %-33d${C}║${NC}\n" "$ALLOW"
printf "${C}║${NC}  ${Y}Policy denied:${NC}     %-33d${C}║${NC}\n" "$DENY"
printf "${C}║${NC}  ${R}Auth failures:${NC}     %-33d${C}║${NC}\n" "$AUTH_FAIL"
printf "${C}║${NC}  PII tokenized:    %-33d${C}║${NC}\n" "$PII"
echo -e "${C}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  View live events:  ${C}curl $GW/../api/v1/events?limit=10${NC} (on :8081)"
echo -e "  Verify chain:      ${C}curl -X POST http://localhost:8081/api/v1/events/verify${NC}"
echo ""
