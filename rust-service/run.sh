#!/usr/bin/env bash
# Start the Proofmark Rust engine in development mode.
set -euo pipefail

cd "$(dirname "$0")"

export RUST_LOG="${RUST_LOG:-proofmark_engine=debug,actix_web=info}"
export BIND_ADDR="${BIND_ADDR:-127.0.0.1:9090}"

echo "🔧 Building proofmark-engine..."
cargo build --release 2>&1

echo "🚀 Starting on $BIND_ADDR"
exec ./target/release/proofmark-engine
