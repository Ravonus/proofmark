# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM rust:1.82-slim-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Cache dependency compilation
COPY Cargo.toml Cargo.lock* ./
RUN mkdir src && echo 'fn main(){}' > src/main.rs && \
    cargo build --release 2>/dev/null || true && \
    rm -rf src

# Build the actual binary
COPY src ./src
RUN cargo build --release --jobs $(nproc)

# ── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    groupadd -r proofmark && \
    useradd -r -g proofmark proofmark

COPY --from=builder /app/target/release/proofmark-engine /usr/local/bin/

USER proofmark

ENV BIND_ADDR=0.0.0.0:9090
ENV RUST_LOG=proofmark_engine=info

EXPOSE 9090

HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
    CMD curl -sf http://localhost:9090/api/v1/health || exit 1

ENTRYPOINT ["proofmark-engine"]
