#!/usr/bin/env bash
# vidika.co — the parts of the setup that need root. Everything else
# (/srv/vidika.co, the clone, the image, .env) is already in place.
#
#   sudo bash /srv/vidika.co/deploy/install-root.sh
#
# Idempotent: safe to re-run. Every file it replaces is backed up next to
# itself with a timestamp, and if `nginx -t` fails the old vhost is restored
# and nginx is never reloaded.
set -euo pipefail

STAMP="$(date +%Y%m%d-%H%M%S)"
SRC=/srv/vidika.co/deploy
say() { printf "\n\033[1m── %s\033[0m\n" "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "must run as root (sudo bash $0)" >&2; exit 1; }

# ── 1. nginx supporting files ─────────────────────────────────────────
say "installing nginx snippets"
mkdir -p /etc/nginx/snippets
install -m 0644 -o root -g root "$SRC/cloudflare-realip.conf" /etc/nginx/snippets/cloudflare-realip.conf
install -m 0644 -o root -g root "$SRC/vidika-ratelimit.conf"  /etc/nginx/conf.d/vidika-ratelimit.conf
echo "  /etc/nginx/snippets/cloudflare-realip.conf"
echo "  /etc/nginx/conf.d/vidika-ratelimit.conf"

# ── 2. the vhost, with rollback ───────────────────────────────────────
say "installing vhost (was: static root /var/www/vidika.co)"
VHOST=/etc/nginx/sites-available/vidika.co
BACKUP="$VHOST.bak-$STAMP"
cp -a "$VHOST" "$BACKUP"
echo "  backup: $BACKUP"
install -m 0644 -o nemanjas -g nemanjas "$SRC/nginx-vidika.co.conf" "$VHOST"

# The symlink already exists from the static setup; recreate only if missing.
[ -L /etc/nginx/sites-enabled/vidika.co ] || ln -s "$VHOST" /etc/nginx/sites-enabled/vidika.co

say "nginx -t"
if nginx -t; then
    systemctl reload nginx
    echo "  reloaded"
else
    echo "  FAILED — restoring previous vhost, nginx NOT reloaded" >&2
    cp -a "$BACKUP" "$VHOST"
    rm -f /etc/nginx/conf.d/vidika-ratelimit.conf
    nginx -t >/dev/null 2>&1 && echo "  rollback verified" >&2
    exit 1
fi

# ── 3. deploy hook script ─────────────────────────────────────────────
say "installing /opt/deploy/vidika.sh"
install -m 0701 -o deploy -g deploy "$SRC/vidika.sh" /opt/deploy/vidika.sh
ls -l /opt/deploy/vidika.sh

# ── 4. hooks.json entry ───────────────────────────────────────────────
say "adding vidika entry to /opt/deploy/hooks.json"
cp -a /opt/deploy/hooks.json "/opt/deploy/hooks.json.bak-$STAMP"
python3 - "$SRC/hook-entry.json" <<'PY'
import json, sys
hooks_path = "/opt/deploy/hooks.json"
with open(hooks_path) as fh:
    hooks = json.load(fh)
with open(sys.argv[1]) as fh:
    entry = json.load(fh)

hooks = [h for h in hooks if h.get("id") != entry["id"]]
hooks.append(entry)

with open(hooks_path, "w") as fh:
    json.dump(hooks, fh, indent=2)
    fh.write("\n")
print("  ids now: " + ", ".join(h["id"] for h in hooks))
PY
chown deploy:deploy /opt/deploy/hooks.json
chmod 0640 /opt/deploy/hooks.json

say "restarting webhook-deploy.service"
systemctl restart webhook-deploy.service
sleep 1
systemctl is-active webhook-deploy.service

say "done"
echo "hook is live at https://nemanjas.dev/hooks/vidika"
