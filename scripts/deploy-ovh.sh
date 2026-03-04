#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# Bawaba Gateway — Deploy to OVHcloud VPS
#
# Usage:
#   ./scripts/deploy-ovh.sh <vps-ip> [domain]
#
# Examples:
#   ./scripts/deploy-ovh.sh 51.210.1.2
#   ./scripts/deploy-ovh.sh 51.210.1.2 bawaba.example.com
#
# Prerequisites on VPS:
#   - Ubuntu 22.04+ or Debian 12+
#   - SSH access with key auth
#   - Ports 80, 443, 8080, 8081 open in firewall
# ──────────────────────────────────────────────────────────────────────
set -euo pipefail

# ─── Config ───────────────────────────────────────────────
VPS_IP="${1:?Usage: deploy-ovh.sh <vps-ip> [domain]}"
DOMAIN="${2:-}"
SSH_USER="${SSH_USER:-root}"
REPO_URL="${REPO_URL:-https://github.com/OolalaDXB/bawaba-command.git}"
DEPLOY_DIR="/opt/bawaba"
BRANCH="${BRANCH:-main}"

# Colors
G='\033[0;32m'; R='\033[0;31m'; Y='\033[0;33m'; C='\033[0;36m'; NC='\033[0m'

log()  { echo -e "${G}[deploy]${NC} $*"; }
warn() { echo -e "${Y}[deploy]${NC} $*"; }
err()  { echo -e "${R}[deploy]${NC} $*"; exit 1; }

SSH="ssh -o StrictHostKeyChecking=accept-new ${SSH_USER}@${VPS_IP}"
SCP="scp -o StrictHostKeyChecking=accept-new"

# ─── Step 1: Install Docker if needed ────────────────────
log "Step 1/6: Ensuring Docker is installed on ${VPS_IP}..."

$SSH bash -s <<'REMOTE_DOCKER'
set -euo pipefail
if command -v docker &>/dev/null && docker compose version &>/dev/null; then
    echo "Docker already installed: $(docker --version)"
    exit 0
fi

echo "Installing Docker..."
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > \
/etc/apt/sources.list.d/docker.list

apt-get update -qq
apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
systemctl enable docker
systemctl start docker
echo "Docker installed: $(docker --version)"
REMOTE_DOCKER

# ─── Step 2: Clone or pull repo ──────────────────────────
log "Step 2/6: Syncing repository..."

$SSH bash -s <<REMOTE_REPO
set -euo pipefail
if [ -d "$DEPLOY_DIR/.git" ]; then
    cd "$DEPLOY_DIR"
    git fetch origin
    git checkout "$BRANCH"
    git reset --hard "origin/$BRANCH"
    echo "Repository updated"
else
    git clone --branch "$BRANCH" "$REPO_URL" "$DEPLOY_DIR"
    echo "Repository cloned"
fi
REMOTE_REPO

# ─── Step 3: Generate keys & env ─────────────────────────
log "Step 3/6: Configuring environment..."

$SSH bash -s <<'REMOTE_ENV'
set -euo pipefail
cd /opt/bawaba

# Generate Ed25519 key if missing
mkdir -p keys
if [ ! -f keys/ed25519.key ]; then
    openssl genpkey -algorithm Ed25519 -out keys/ed25519.key 2>/dev/null
    openssl pkey -in keys/ed25519.key -pubout -out keys/ed25519.pub 2>/dev/null
    echo "Ed25519 key pair generated"
fi

# Create .env if missing
if [ ! -f .env ]; then
    DB_PASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
    cat > .env <<EOF
BAWABA_DB_PASSWORD=${DB_PASS}
BAWABA_AGENT_KEY_test_agent=$(openssl rand -hex 16)
BAWABA_AGENT_KEY_claude_code=$(openssl rand -hex 16)
BAWABA_AGENT_KEY_cursor_ide=$(openssl rand -hex 16)
GRAFANA_PASSWORD=$(openssl rand -hex 12)
EOF
    chmod 600 .env
    echo ".env created with random secrets"
else
    echo ".env already exists, keeping current secrets"
fi
REMOTE_ENV

# ─── Step 4: Build & start ───────────────────────────────
log "Step 4/6: Building and starting services..."

$SSH bash -s <<'REMOTE_START'
set -euo pipefail
cd /opt/bawaba

# Use production compose only (no override)
docker compose -f docker-compose.yml up --build -d

# Wait for gateway health
echo "Waiting for gateway to be healthy..."
for i in $(seq 1 30); do
    if curl -sS -o /dev/null -w '%{http_code}' http://localhost:8081/api/v1/health 2>/dev/null | grep -q "200"; then
        echo "Gateway is healthy!"
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo "WARNING: Gateway health check timed out after 30s"
        docker compose logs --tail=20 gateway
        exit 1
    fi
    sleep 1
done

# Load demo seed data if this is first deploy
docker compose exec -T postgres psql -U bawaba -d bawaba -c "SELECT COUNT(*) FROM audit_events" 2>/dev/null | grep -q "0" && {
    echo "Loading demo seed data..."
    docker compose exec -T postgres psql -U bawaba -d bawaba < migrations/999_demo_seed.sql
    echo "Demo data loaded"
} || echo "Audit events already present, skipping seed"
REMOTE_START

# ─── Step 5: Let's Encrypt (if domain provided) ─────────
if [ -n "$DOMAIN" ]; then
    log "Step 5/6: Setting up Let's Encrypt for ${DOMAIN}..."

    $SSH bash -s <<REMOTE_TLS
set -euo pipefail

# Install certbot + nginx
apt-get update -qq
apt-get install -y -qq certbot nginx

# Create nginx config
cat > /etc/nginx/sites-available/bawaba <<NGINX
server {
    listen 80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://\\\$host\\\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # MCP Gateway
    location /mcp {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
    }

    # SSE (MCP)
    location /sse {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host \\\$host;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
    }

    # REST API
    location /api/ {
        proxy_pass http://127.0.0.1:8081;
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
    }

    # SSE (API)
    location /api/v1/events/stream {
        proxy_pass http://127.0.0.1:8081;
        proxy_set_header Host \\\$host;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_read_timeout 86400s;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/bawaba /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Get certificate
mkdir -p /var/www/certbot
nginx -t && systemctl restart nginx

certbot certonly --webroot -w /var/www/certbot \
    -d ${DOMAIN} \
    --non-interactive --agree-tos \
    --email admin@${DOMAIN} || {
    echo "WARNING: certbot failed. Check DNS for ${DOMAIN} -> ${VPS_IP}"
    echo "You can retry: certbot certonly --webroot -w /var/www/certbot -d ${DOMAIN}"
}

# Reload nginx with SSL
nginx -t && systemctl reload nginx

# Auto-renew cron
echo "0 3 * * * certbot renew --quiet --post-hook 'systemctl reload nginx'" | crontab -

echo "TLS configured for ${DOMAIN}"
REMOTE_TLS

else
    warn "Step 5/6: No domain provided, skipping TLS setup"
    warn "  To add TLS later: ./scripts/deploy-ovh.sh ${VPS_IP} your-domain.com"
fi

# ─── Step 6: Summary ─────────────────────────────────────
log "Step 6/6: Deployment complete!"
echo ""
echo -e "${C}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${C}║          BAWABA GATEWAY — DEPLOYED                  ║${NC}"
echo -e "${C}╠══════════════════════════════════════════════════════╣${NC}"
echo -e "${C}║${NC}  VPS:          ${VPS_IP}                          ${C}║${NC}"

if [ -n "$DOMAIN" ]; then
echo -e "${C}║${NC}  Domain:        ${DOMAIN}                         ${C}║${NC}"
echo -e "${C}║${NC}                                                      ${C}║${NC}"
echo -e "${C}║${NC}  MCP Gateway:   https://${DOMAIN}/mcp              ${C}║${NC}"
echo -e "${C}║${NC}  REST API:      https://${DOMAIN}/api/v1/health    ${C}║${NC}"
echo -e "${C}║${NC}  Health:        https://${DOMAIN}/api/v1/health    ${C}║${NC}"
else
echo -e "${C}║${NC}                                                      ${C}║${NC}"
echo -e "${C}║${NC}  MCP Gateway:   http://${VPS_IP}:8080/mcp           ${C}║${NC}"
echo -e "${C}║${NC}  REST API:      http://${VPS_IP}:8081/api/v1/health ${C}║${NC}"
echo -e "${C}║${NC}  Health:        http://${VPS_IP}:8081/api/v1/health ${C}║${NC}"
fi

echo -e "${C}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Next steps:"
echo -e "    make demo        # Run demo scenario"
echo -e "    make verify      # Check audit chain integrity"
echo -e "    make logs        # Follow gateway logs"
echo ""
