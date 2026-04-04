#!/bin/bash
# Push current state to the OSS repo, filtering out premium-only files.
#
# Usage:   ./scripts/push-oss.sh
#
# Creates a temp clone, removes premium files, commits, pushes to 'oss' remote.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
OSS_URL="$(git remote get-url oss)"

PREMIUM_PATHS=(
  src/components/ai
  src/components/collab
  src/components/escrow
  src/components/gaze-gate.tsx
  src/components/gaze-gate-mobile.tsx
  src/app/escrow
  src/stores/ai-chat.ts
  src/lib/gaze-loader.ts
  src/lib/forensic/gaze-analysis.ts
  src/lib/forensic/gaze-liveness.ts
  src/server/api/routers/ai.ts
  src/server/api/routers/collab.ts
  src/server/api/routers/escrow.ts
  src/server/api/routers/runtime.ts
)

TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

echo "Preparing OSS snapshot..."

git clone --shared --quiet "$REPO_ROOT" "$TMPDIR/oss"
cd "$TMPDIR/oss"

for p in "${PREMIUM_PATHS[@]}"; do
  rm -rf "$p" 2>/dev/null
done

git add -A
git commit --quiet --allow-empty --no-verify -m "OSS sync: $(git log -1 --format=%s)"

echo "Pushing to OSS remote..."
git push "$OSS_URL" HEAD:main --force

echo "Done. OSS repo updated."
