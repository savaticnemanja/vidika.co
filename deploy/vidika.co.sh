#!/usr/bin/env bash
# Deploy hook for vidika.co — invoked by /opt/deploy/hooks.json (webhook svc,
# runs as user `deploy`). Pulls main, rebuilds the image, restarts the stack.
# Install to /opt/deploy/vidika.co.sh (owner deploy, mode 0701).
set -euo pipefail

ROOT="/srv/vidika.co"
SRC="$ROOT/src"
BRANCH="main"

cd "$SRC"
git fetch --prune origin "$BRANCH"
git reset --hard "origin/$BRANCH"

cd "$ROOT"
docker compose build app
docker compose up -d --remove-orphans

# Drop the previous image layers so the disk does not creep.
docker image prune -f

echo "deployed vidika.co @ $(git -C "$SRC" rev-parse --short HEAD)"
