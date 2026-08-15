# Stage 1: Build Rust tokenizer
FROM rust:1.85-bookworm AS rust-builder
WORKDIR /build/rust/tokenizer
COPY rust/tokenizer/ .
RUN cargo build --release

# Stage 2: Build Go gateway
FROM golang:1.24-bookworm AS go-builder
WORKDIR /build

# Install Rust library from previous stage
COPY --from=rust-builder /build/rust/tokenizer/target/release/libbawaba_tokenizer.a /usr/local/lib/
COPY --from=rust-builder /build/rust/tokenizer/target/release/libbawaba_tokenizer.so /usr/local/lib/

# Copy Go source
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# Copy Rust lib into expected location for CGO
RUN mkdir -p rust/tokenizer/target/release && \
    cp /usr/local/lib/libbawaba_tokenizer.a rust/tokenizer/target/release/ && \
    cp /usr/local/lib/libbawaba_tokenizer.so rust/tokenizer/target/release/

# Build gateway
RUN CGO_ENABLED=1 go build -o /build/bin/bawaba-gateway ./cmd/gateway/

# Build CLI
RUN CGO_ENABLED=0 go build -o /build/bin/bawaba-cli ./cmd/cli/
RUN CGO_ENABLED=0 go build -o /build/bin/bawaba-demo-backend ./cmd/demo-backend/

# Stage 3: Runtime
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=go-builder /build/bin/bawaba-gateway /app/bawaba-gateway
COPY --from=go-builder /build/bin/bawaba-cli /app/bawaba-cli
COPY --from=go-builder /build/bin/bawaba-demo-backend /app/bawaba-demo-backend
COPY --from=rust-builder /build/rust/tokenizer/target/release/libbawaba_tokenizer.so /usr/local/lib/

# Ensure shared lib is found
RUN ldconfig

COPY configs/ /app/configs/
COPY migrations/ /app/migrations/

RUN mkdir -p /app/keys

EXPOSE 8080 8081 9090

ENTRYPOINT ["/app/bawaba-gateway"]
