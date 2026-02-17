.PHONY: all build build-rust build-go test clean docker-up docker-down lint

RUST_DIR := rust/tokenizer
GO_GATEWAY := cmd/gateway
GO_CLI := cmd/cli
BIN_DIR := bin

all: build

## Build everything
build: build-rust build-go

## Build Rust tokenizer
build-rust:
	cd $(RUST_DIR) && cargo build --release

## Build Go binaries
build-go:
	CGO_ENABLED=1 go build -o $(BIN_DIR)/bawaba-gateway ./$(GO_GATEWAY)/
	CGO_ENABLED=0 go build -o $(BIN_DIR)/bawaba-cli ./$(GO_CLI)/

## Run all tests
test: build-rust
	CGO_ENABLED=1 go test ./... -v -count=1
	cd $(RUST_DIR) && cargo test

## Run Go tests only (no CGO/Rust dependency)
test-go-nocgo:
	CGO_ENABLED=0 go test ./internal/config/... ./internal/auth/... ./internal/policy/... ./internal/ratelimit/... ./internal/audit/... ./internal/router/... -v -count=1

## Docker Compose up
docker-up:
	docker compose up --build -d

## Docker Compose down
docker-down:
	docker compose down -v

## Clean build artifacts
clean:
	rm -rf $(BIN_DIR)
	cd $(RUST_DIR) && cargo clean

## Validate config
config-validate:
	$(BIN_DIR)/bawaba-cli config validate ./configs/bawaba.yaml

## Generate Ed25519 signing key
keygen:
	mkdir -p keys
	openssl genpkey -algorithm Ed25519 -out keys/ed25519.key 2>/dev/null || \
		echo "Key generation requires openssl with Ed25519 support"
