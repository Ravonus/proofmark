#!/bin/bash
# Validate that the OSS snapshot builds, lints, and type-checks.
#
# Usage:   ./scripts/validate-oss.sh
#
# Copies the current working tree (including uncommitted changes), applies the
# same transform that push-oss.sh uses, then runs the full validation suite.
# Your working tree is not affected.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"

TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

echo "──────────────────────────────────────────────"
echo "  OSS Snapshot Validation"
echo "──────────────────────────────────────────────"

# ── 1. Copy working tree into temp dir ───────────────────────────────────────
echo "[1/5] Copying working tree..."
rsync -a --exclude='node_modules' --exclude='.next' --exclude='.git' \
  --exclude='**/target' --exclude='.open-next' \
  "$REPO_ROOT/" "$TMPDIR/oss/"
cd "$TMPDIR/oss"

# ── 2. Remove premium-only files (same as push-oss.sh) ──────────────────────
echo "[2/5] Stripping premium files..."
rm -rf \
  premium \
  src/components/ai \
  src/components/collab \
  src/components/escrow \
  src/components/gaze-gate.tsx \
  src/components/gaze-gate-mobile.tsx \
  src/stores/ai-chat.ts \
  src/lib/gaze-loader.ts \
  src/lib/forensic/gaze-analysis.ts \
  src/lib/forensic/gaze-liveness.ts \
  src/generated \
  2>/dev/null || true

# ── 3. Materialize OSS stubs ────────────────────────────────────────────────
echo "[3/5] Materializing OSS premium surface..."
node scripts/materialize-premium.mjs --force-stubs

# ── 4. Strip premium deps and install ───────────────────────────────────────
echo "[4/5] Installing OSS dependencies..."
python3 -c "
import json
pkg = json.load(open('package.json'))
for d in ['@mediapipe/face_mesh','@tensorflow-models/face-landmarks-detection',
          '@tensorflow/tfjs-backend-webgl','@tensorflow/tfjs-core',
          'lib0','webgazer','ws','y-protocols','yjs']:
    pkg.get('dependencies',{}).pop(d, None)
pkg.get('devDependencies',{}).pop('@types/ws', None)
with open('package.json','w') as f:
    json.dump(pkg, f, indent=2)
    f.write('\n')
"

npm install --legacy-peer-deps --ignore-scripts --no-audit --no-fund --quiet 2>/dev/null || true

# ── 5. Run validation suite ─────────────────────────────────────────────────
echo "[5/5] Running checks..."
echo ""

FAIL=0

echo "  → format:check"
npx prettier --check "src/**/*.{ts,tsx,css,json}" 2>&1 || FAIL=1

echo "  → lint"
npx next lint --no-cache 2>&1 || FAIL=1

echo "  → type-check"
npx tsc --noEmit 2>&1 || FAIL=1

echo "  → test"
npx vitest run 2>&1 || FAIL=1

echo ""
if [ $FAIL -eq 0 ]; then
  echo "✓ OSS snapshot passed all checks."
else
  echo "✗ OSS snapshot failed one or more checks."
  exit 1
fi
