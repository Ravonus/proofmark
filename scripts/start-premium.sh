#!/usr/bin/env bash
# Start the PREMIUM version of proofmark.
# Premium modules live in proofmark/premium/ (gitignored).
# Includes Rust engine for high-performance PDF/crypto/verification.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

export PROOFMARK_DEPLOYMENT_MODE="${PROOFMARK_DEPLOYMENT_MODE:-premium}"
export PDF_UPLOAD_MAX_MB="${PDF_UPLOAD_MAX_MB:-100}"

if [ ! -d "premium" ]; then
  echo "ERROR: Premium modules not found at premium/"
  echo "Copy or clone premium modules into services/proofmark/premium/"
  exit 1
fi

# ── Build Rust engine if binary is missing or stale ──────────────────────────
if [ -d "rust-service" ]; then
  BINARY="rust-service/target/release/proofmark-engine"
  if [ ! -f "$BINARY" ] || [ "$(find rust-service/src -newer "$BINARY" -name '*.rs' 2>/dev/null | head -1)" ]; then
    echo "Building Rust engine..."
    (cd rust-service && cargo build --release 2>&1)
  fi

  # Start engine in background
  export RUST_LOG="${RUST_LOG:-proofmark_engine=info}"
  export BIND_ADDR="${BIND_ADDR:-127.0.0.1:9090}"
  export RUST_ENGINE_URL="http://127.0.0.1:9090"
  "$BINARY" &
  RUST_PID=$!
  echo "Rust engine started (PID $RUST_PID) on $BIND_ADDR"

  trap "kill $RUST_PID 2>/dev/null || true" EXIT
else
  echo "No rust-service/ directory — running without Rust engine"
fi

echo "Starting proofmark (premium) on port 3100..."
echo "  → Next.js on :3100, Collab WS on :${COLLAB_WS_PORT:-3101}, Rust engine on :9090"
echo "  → PDF upload limit: ${PDF_UPLOAD_MAX_MB}MB"
exec npx concurrently "npx next dev --port 3100" "npx tsx premium/collaboration/ws-entry.ts"
