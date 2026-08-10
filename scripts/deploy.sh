#!/usr/bin/env bash
#
# Ship dist/ to the host.
#
# Two passes, and the order matters. rsync walks plain files before it
# descends into directories, so a single pass puts index.html on the server
# ahead of _astro/ and fonts/ — a window where the live page references a
# bundle that isn't on disk yet. nginx answers a missing file from the site
# fallback, so that request comes back as HTML with a 200, the browser's
# module loader refuses to execute it, and the page renders with every
# [data-reveal] element stuck at opacity 0. Assets first closes the window.
set -euo pipefail

HOST="${DEPLOY_HOST:-nemanjas@nemanjas.dev}"
REMOTE="${DEPLOY_PATH:-/var/www/vidika.co/}"
LOCAL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/dist/"

if [ ! -f "${LOCAL}index.html" ]; then
  echo "no build at ${LOCAL} — run 'npm run build' first" >&2
  exit 1
fi

echo "→ assets"
rsync -az --exclude='*.html' "$LOCAL" "$HOST:$REMOTE"

echo "→ html"
rsync -az --include='*/' --include='*.html' --exclude='*' "$LOCAL" "$HOST:$REMOTE"

echo "✓ deployed to $HOST:$REMOTE"
