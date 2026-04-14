#!/bin/bash
# Push current state to the OSS repo, filtering out premium-only files.
#
# Usage:   ./scripts/push-oss.sh
#
# Creates a temp clone, removes premium files + deps, materializes OSS stubs,
# then publishes a fresh orphan snapshot to the 'oss' remote so premium history
# never bleeds into the public mirror. Your working tree is unchanged.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
OSS_URL="$(git remote get-url oss)"
HEAD_SUBJECT="$(git log -1 --format=%s)"

TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

echo "Preparing OSS snapshot..."

git clone --shared --quiet "$REPO_ROOT" "$TMPDIR/work"
cd "$TMPDIR/work"

# ── 1. Remove premium-only source files ──────────────────────────────────────
# These are files that live in src/ for premium-build convenience but are
# NOT referenced by any shared code. The router stubs (ai.ts, collab.ts,
# escrow.ts, runtime.ts, connector.ts) are intentionally KEPT — they
# provide OSS-safe stub routers that root.ts already imports.
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
  2>/dev/null || true

# ── 2. Materialize premium surface as OSS stubs ─────────────────────────────
node scripts/materialize-premium.mjs --force-stubs

# ── 3. Strip premium-only deps from package.json ────────────────────────────
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

npm install --package-lock-only --legacy-peer-deps --ignore-scripts --no-audit --no-fund --quiet 2>/dev/null || true

# ── 4. Publish as a clean orphan snapshot ───────────────────────────────────
mkdir -p "$TMPDIR/publish"
rsync -a --delete \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='.open-next' \
  --exclude='tsconfig.tsbuildinfo' \
  --exclude='tmp' \
  ./ "$TMPDIR/publish/"

cd "$TMPDIR/publish"
git init --quiet
git checkout --quiet -b main
git remote add origin "$OSS_URL"
git add -A
git commit --quiet --allow-empty --no-verify -m "OSS sync: $HEAD_SUBJECT"

echo "Pushing to OSS remote..."
git push origin HEAD:main --force

echo "Done. OSS repo updated."
