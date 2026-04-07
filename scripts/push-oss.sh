#!/bin/bash
# Push current state to the OSS repo, filtering out premium-only files.
#
# Usage:   ./scripts/push-oss.sh
#
# Creates a temp clone, removes premium files + deps, materializes OSS stubs,
# commits, and pushes to the 'oss' remote. Your working tree is unchanged.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
OSS_URL="$(git remote get-url oss)"

TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

echo "Preparing OSS snapshot..."

git clone --shared --quiet "$REPO_ROOT" "$TMPDIR/oss"
cd "$TMPDIR/oss"

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

npm install --legacy-peer-deps --ignore-scripts --no-audit --no-fund --quiet 2>/dev/null || true

# ── 4. Commit and push ──────────────────────────────────────────────────────
git add -A
git commit --quiet --allow-empty --no-verify -m "OSS sync: $(git log -1 --format=%s)"

echo "Pushing to OSS remote..."
git push "$OSS_URL" HEAD:main --force

echo "Done. OSS repo updated."
