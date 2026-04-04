#!/bin/bash
# Push current state to the OSS repo, filtering out premium-only files.
#
# Usage:   ./scripts/push-oss.sh
#
# Creates a temp clone, removes premium files + deps, regenerates lock file,
# commits, and pushes to the 'oss' remote. Your working tree is unchanged.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
OSS_URL="$(git remote get-url oss)"

TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

echo "Preparing OSS snapshot..."

git clone --shared --quiet "$REPO_ROOT" "$TMPDIR/oss"
cd "$TMPDIR/oss"

# Remove premium source files
rm -rf \
  src/components/ai \
  src/components/collab \
  src/components/escrow \
  src/components/gaze-gate.tsx \
  src/components/gaze-gate-mobile.tsx \
  src/app/escrow \
  src/stores/ai-chat.ts \
  src/lib/gaze-loader.ts \
  src/lib/forensic/gaze-analysis.ts \
  src/lib/forensic/gaze-liveness.ts \
  src/server/api/routers/ai.ts \
  src/server/api/routers/collab.ts \
  src/server/api/routers/escrow.ts \
  src/server/api/routers/runtime.ts \
  2>/dev/null || true

# Strip premium routers from root.ts
sed -i '' '/aiRouter/d; /collabRouter/d; /escrowRouter/d; /runtimeRouter/d' src/server/api/root.ts 2>/dev/null || \
sed -i '/aiRouter/d; /collabRouter/d; /escrowRouter/d; /runtimeRouter/d' src/server/api/root.ts 2>/dev/null || true

# Strip premium deps from package.json and regenerate lock file
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

git add -A
git commit --quiet --allow-empty --no-verify -m "OSS sync: $(git log -1 --format=%s)"

echo "Pushing to OSS remote..."
git push "$OSS_URL" HEAD:main --force

echo "Done. OSS repo updated."
