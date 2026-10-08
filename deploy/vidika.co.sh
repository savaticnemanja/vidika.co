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
# rollback: keep the running build as :previous
for img in $(docker compose config --images | grep ':local$'); do
  if docker image inspect "$img" >/dev/null 2>&1; then
    docker tag "$img" "${img%:local}:previous"
  fi
done
docker compose build app
if ! docker compose up -d --remove-orphans --wait --wait-timeout 120; then
  echo "!! stack not healthy after deploy — rolling back to :previous" >&2
  for img in $(docker compose config --images | grep ':local$'); do
    if docker image inspect "${img%:local}:previous" >/dev/null 2>&1; then
      docker tag "${img%:local}:previous" "$img"
    fi
  done
  docker compose up -d --remove-orphans --wait --wait-timeout 120 || true
  exit 1
fi

# Drop the previous image layers so the disk does not creep.
docker image prune -f

echo "deployed vidika.co @ $(git -C "$SRC" rev-parse --short HEAD)"
