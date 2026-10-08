# Deploying vidika.co

The site runs on the `nemanjas.dev` VPS as a Docker container behind the host
nginx, in the same shape as the other apps on that box.

```
/srv/vidika.co/
├── docker-compose.yml     ← deploy/docker-compose.server.yml
├── .env                   ← secrets; never committed, mode 0640 nemanjas:developers
├── deploy/                ← copies of this directory
└── src/                   ← this repo, cloned, owned by `deploy`
```

The container publishes on `127.0.0.1:8087`. The loopback prefix is what keeps
it off the internet — Docker writes its own iptables rules below UFW, so a
port published on `0.0.0.0` is reachable even when the firewall says closed.

## Why two compose files

`docker-compose.yml` at the repo root builds from `.` and is for running the
whole site off a laptop. `deploy/docker-compose.server.yml` is the one that
lives on the box: it builds from `./src`, pins the compose project to
`vidika`, uses the `vidika-app:local` / `vidika-app` naming the other apps on
that host use, and reads `.env` from `/srv/vidika.co/`. They are deliberately
separate; neither is generated from the other.

Naming on the box: Docker names (compose project, container, image) are the
domain minus its TLD; everything on disk (`/srv/vidika.co`, the vhost, the
certificate, `/opt/deploy/vidika.co.sh`) is the full domain. The webhook id
stays `vidika` — it is part of the URL the workflow calls.

## Automatic deploys

Push to `main` → `.github/workflows/deploy.yaml` POSTs an HMAC-signed payload
to `https://nemanjas.dev/hooks/vidika` → the webhook service runs
`/opt/deploy/vidika.co.sh` as the unprivileged `deploy` user, which pulls,
rebuilds and recreates the container.

The workflow holds no SSH key and no registry credentials; the HMAC signature
is the entire authentication. `WEBHOOK_SECRET` in the repo secrets must equal
the `secret` field of the `vidika` entry in `/opt/deploy/hooks.json`.

The box pulls with a **read-only** deploy key (`~deploy/.ssh/id_ed25519_vidika`,
registered on this repo as "VPS"). It can fetch and nothing else, which is why
commits are pushed from a developer machine rather than from the server.

## Manual deploy

```sh
ssh deploy-nemanjas
cd /srv/vidika.co
git -C src pull
docker compose build app && docker compose up -d
```

## First-time / root-level setup

`deploy/install-root.sh` does the parts needing root — the vhost, the
`limit_req_zone`, the Cloudflare real-IP snippet, `/opt/deploy/vidika.co.sh` and
the `hooks.json` entry. It is idempotent, backs up everything it replaces, and
rolls the vhost back if `nginx -t` fails.

```sh
sudo bash /srv/vidika.co/deploy/install-root.sh
```

## Cloudflare

`vidika.co` is proxied by Cloudflare, so the origin sees Cloudflare IPs.
`cloudflare-realip.conf` restores the visitor address from `CF-Connecting-IP`;
without it the `limit_req` on `/api/contact` would bucket every visitor on
earth into ~15 keys and one busy user would rate-limit the whole site. The
Node handler already prefers `CF-Connecting-IP` on its own (`server/index.mjs`).

`www.vidika.co` has no DNS record and the origin certificate does not cover it,
so no `www` vhost is configured. Adding one means a DNS record and reissuing
the cert, which is shared with `welcometomimoland.com`.
