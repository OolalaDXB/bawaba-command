.PHONY: all build build-rust build-go build-docker test test-go-nocgo \
       up down logs demo verify bench keygen backup clean config-validate

RUST_DIR    := rust/tokenizer
GO_GATEWAY  := cmd/gateway
GO_CLI      := cmd/cli
BIN_DIR     := bin
BACKUP_DIR  := backups
COMPOSE     := docker compose
GATEWAY_URL := http://localhost:8080
API_URL     := http://localhost:8081

all: build

# ──────────────────────────────────────────────
# Build
# ──────────────────────────────────────────────

## Build everything (Rust + Go + Docker image)
build: build-rust build-go build-docker

## Build Rust tokenizer
build-rust:
	cd $(RUST_DIR) && cargo build --release

## Build Go binaries
build-go:
	CGO_ENABLED=1 go build -o $(BIN_DIR)/bawaba-gateway ./$(GO_GATEWAY)/
	CGO_ENABLED=0 go build -o $(BIN_DIR)/bawaba-cli ./$(GO_CLI)/

## Build Docker image
build-docker:
	$(COMPOSE) build gateway

# ──────────────────────────────────────────────
# Test
# ──────────────────────────────────────────────

## Run all tests (Go + Rust)
test: build-rust
	CGO_ENABLED=1 go test ./... -v -count=1
	cd $(RUST_DIR) && cargo test

## Run Go tests only (no CGO/Rust dependency)
test-go-nocgo:
	CGO_ENABLED=0 go test ./internal/config/... ./internal/auth/... ./internal/policy/... ./internal/ratelimit/... ./internal/audit/... ./internal/router/... -v -count=1

# ──────────────────────────────────────────────
# Docker Compose
# ──────────────────────────────────────────────

## Start all services
up:
	$(COMPOSE) up --build -d

## Stop all services
down:
	$(COMPOSE) down

## Follow gateway logs
logs:
	$(COMPOSE) logs -f gateway

## Run demo scenario
demo:
	@chmod +x scripts/demo.sh
	./scripts/demo.sh

# ──────────────────────────────────────────────
# Operations
# ──────────────────────────────────────────────

## Verify audit hash chain integrity
verify:
	@echo "==> Verifying audit hash chain..."
	@curl -sS -X POST $(API_URL)/api/v1/events/verify | python3 -m json.tool 2>/dev/null || \
		curl -sS -X POST $(API_URL)/api/v1/events/verify

## Benchmark: 100 requests, show P50/P95/P99 latency
bench:
	@echo "==> Benchmarking $(GATEWAY_URL)/healthz (100 requests)..."
	@scripts/bench.sh

## Generate Ed25519 signing key pair
keygen:
	@mkdir -p keys
	@openssl genpkey -algorithm Ed25519 -out keys/ed25519.key 2>/dev/null && \
		openssl pkey -in keys/ed25519.key -pubout -out keys/ed25519.pub 2>/dev/null && \
		echo "Keys generated: keys/ed25519.key + keys/ed25519.pub" || \
		echo "Error: openssl with Ed25519 support required"

## Backup audit database
backup:
	@mkdir -p $(BACKUP_DIR)
	@STAMP=$$(date +%Y%m%d_%H%M%S); \
	$(COMPOSE) exec -T postgres pg_dump -U bawaba -d bawaba \
		--table=audit_events --table=agents \
		> $(BACKUP_DIR)/bawaba_$$STAMP.sql && \
	echo "Backup saved: $(BACKUP_DIR)/bawaba_$$STAMP.sql"

## Remove containers, images, and volumes
clean:
	$(COMPOSE) down -v --rmi local --remove-orphans 2>/dev/null || true
	rm -rf $(BIN_DIR)
	cd $(RUST_DIR) && cargo clean 2>/dev/null || true

# ──────────────────────────────────────────────
# Utilities
# ──────────────────────────────────────────────

## Validate YAML config
config-validate:
	$(BIN_DIR)/bawaba-cli config validate ./configs/bawaba.yaml
