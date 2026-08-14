# Dockerizing a Next.js + Prisma/SQLite app

How Avala Home Concept is containerized, why each piece is the way it is, and what to change to reuse the same setup on another project.

The whole thing is five files:

| File | Role |
|---|---|
| `Dockerfile` | Two-stage build → a runnable production image |
| `.dockerignore` | Keeps host junk out of the build context |
| `docker-entrypoint.sh` | Runs migrations + seed before the server starts |
| `docker-compose.yml` | Ports, env, volumes, restart policy on the server |
| `.github/workflows/deploy.yaml` | Push to `main` → webhook → server redeploys |

Nginx sits in front on the host (not in Docker) and terminates TLS.

---

## 1. The shape of it

```
Internet
   │  :443 TLS
   ▼
Nginx (host)
   ├── /uploads/*  → alias /srv/<site>/public/uploads/   (served from disk, never touches Node)
   └── /*          → proxy_pass http://127.0.0.1:8083
                                      │
                                      ▼
                          Docker container :3000
                          ├── /data              → named volume  (SQLite file)
                          └── /app/public/uploads → bind mount   (same dir Nginx reads)
```

Two decisions drive everything else:

- **The container is stateless.** All mutable state — the SQLite file and uploaded media — lives on volumes. Destroying and recreating the container loses nothing.
- **Uploads are a bind mount, not a named volume**, because Nginx (outside Docker) has to read those exact files off the host filesystem. The DB is the opposite: nothing outside the container needs it, so it gets a named volume.

---

## 2. Dockerfile — two stages

### Build stage

```dockerfile
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# OpenSSL is required by Prisma's query engine.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies (postinstall runs `prisma generate`).
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .
ENV DATABASE_URL="file:/data/app.db"
RUN npm run build
```

Four things worth understanding:

**`bookworm-slim`, not `alpine`.** Prisma's query engine and `sharp` ship prebuilt binaries against glibc. Alpine uses musl, which means either a different engine target or building from source. Debian slim is ~40 MB more and saves hours.

**`openssl` is not optional.** Prisma's query engine dynamically links against it. Without it you get a cryptic `Unable to require libquery_engine` at runtime, not at build.

**`prisma/` is copied *before* `npm ci`.** `package.json` has `"postinstall": "prisma generate"`, which reads `prisma/schema.prisma`. Copy only the manifests and the schema first, and the expensive `npm ci` layer stays cached across every source change. Copy the whole tree first and you reinstall node_modules on every edit.

**`DATABASE_URL` at build time is a placeholder.** No database is reachable during the build, but importing `@prisma/client` throws if the env var is missing. The value is never connected to — it just has to parse.

### Runtime stage

```dockerfile
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_URL="file:/data/app.db"
ENV UPLOAD_DIR="/app/public/uploads"

RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next        ./.next
COPY --from=builder /app/public       ./public
COPY --from=builder /app/prisma       ./prisma
COPY --from=builder /app/src          ./src
COPY --from=builder /app/scripts      ./scripts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.js ./next.config.js
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["npm", "run", "start"]
```

**Why `src/` and `scripts/` are in the runtime image.** Normally you would not ship source into a production Next image. Here the seed script imports the i18n dictionaries from `src/`, and `scripts/` holds `import-houses.mjs` plus its source assets, which is run manually against the live container. If your other app has no runtime scripts, drop both lines.

**`node_modules` is copied whole**, including the Prisma CLI — the entrypoint needs `npx prisma migrate deploy`. See §7 for the `output: 'standalone'` alternative.

**The healthcheck uses `node -e`, not `curl`.** The slim image has no `curl`, and installing one just for a healthcheck adds a layer and an attack surface. `start-period=60s` covers migrations + seed before failures start counting.

**`ENTRYPOINT` + `CMD` split.** The entrypoint always runs and ends with `exec "$@"`, so `CMD` is what it hands off to. This is what lets `docker compose run app <anything>` still get migrations applied first, and lets you override the command without losing the setup.

---

## 3. `.dockerignore`

```
node_modules
.next
out
.git
.claude
*.log
prisma/dev.db
prisma/dev.db-journal
public/uploads
.env
.DS_Store
README.md
lighthouse*.json
lighthouse-report.md
.github
```

Three categories, all of which matter:

- **Correctness** — `node_modules` and `.next` from a macOS host would overwrite the Linux-built ones. `prisma/dev.db` would bake your local dev database into the image. `public/uploads` would bake in local test media *and* collide with the bind mount.
- **Secrets** — `.env` must never enter the image. Env comes from compose at runtime.
- **Speed** — `.git` on a mature repo is often the largest single thing in the context.

---

## 4. `docker-entrypoint.sh`

```sh
#!/bin/sh
set -e

# Ensure persistent dirs exist (mounted as volumes in compose).
mkdir -p /data
mkdir -p "${UPLOAD_DIR:-/app/public/uploads}"

# Apply pending migrations against the SQLite volume.
echo "Running database migrations…"
npx prisma migrate deploy

# Seed once if the database is empty (idempotent — seed self-skips otherwise).
echo "Seeding database (no-op if already populated)…"
npx prisma db seed || echo "Seed skipped/failed (continuing)."

exec "$@"
```

**`migrate deploy`, never `migrate dev`.** `deploy` only applies existing migration files and never prompts, never generates, never resets. `migrate dev` can drop your production data when it detects drift.

**The seed is allowed to fail.** `|| echo` keeps a failed seed from bricking a boot on an already-populated database. The tradeoff: a genuinely broken seed fails silently, so check the logs after first deploy.

**`exec "$@"`** replaces the shell with the Node process, so it becomes PID 1 and receives `SIGTERM` directly. Without `exec`, the shell stays PID 1, swallows the signal, and every `docker stop` takes the full 10-second timeout before a `SIGKILL`.

---

## 5. `docker-compose.yml`

```yaml
services:
  app:
    image: ghcr.io/savaticnemanja/avalahomeconcept-landing:latest
    ports:
      - "127.0.0.1:8083:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=file:/data/app.db
      - UPLOAD_DIR=/app/public/uploads
      - ADMIN_PASSWORD=${ADMIN_PASSWORD:-changeme}
      - SESSION_SECRET=${SESSION_SECRET:?set SESSION_SECRET in .env}
    volumes:
      - db-data:/data
      - /srv/avalahomeconcept.com/public/uploads:/app/public/uploads
    restart: unless-stopped

volumes:
  db-data:
```

**`127.0.0.1:8083:3000` — note the IP prefix.** Without it Docker publishes on `0.0.0.0` and, because it writes its own iptables rules, the port is reachable from the internet *even if UFW says otherwise*. Binding to loopback means only Nginx can reach the app. This is the single most commonly missed line in a Docker deploy.

**`${SESSION_SECRET:?...}` fails the deploy loudly** if the var is missing, instead of silently starting with an empty signing key. Use `:?` for anything security-critical and `:-default` only for genuinely optional values. `ADMIN_PASSWORD` having a `changeme` default is a compromise worth reconsidering.

**Both env vars come from a `.env` file sitting next to `docker-compose.yml` on the server** — that file is never committed and never enters the image.

**`restart: unless-stopped`** survives reboots and daemon restarts, but respects a deliberate `docker compose stop`. `always` would fight you during maintenance.

---

## 6. Nginx and the deploy loop

Nginx config at `/etc/nginx/sites-available/avalahomeconcept.com`:

- `location /uploads/` → `alias /srv/avalahomeconcept.com/public/uploads/;`
- everything else → `proxy_pass http://127.0.0.1:8083;`

User-uploaded media is served straight off disk by Nginx. It never enters the Node process, which means no event-loop time spent streaming images and correct `Range`/caching behaviour for free.

Deploy is push-triggered. `.github/workflows/deploy.yaml` on push to `main` computes an HMAC-SHA256 of the payload with `WEBHOOK_SECRET` and POSTs it to a webhook listener on the server, which pulls and recreates. The signature is what keeps the endpoint from being a public "restart my server" button.

Manual deploy on the box:

```bash
cd /srv/avalahomeconcept.com
git pull
docker compose pull          # see the note in §8 about `build` vs `pull`
docker compose up -d --force-recreate
curl -sf http://localhost:8083 | head -c 80
```

Running a one-off script against the live container:

```bash
docker exec -it avalahomeconcept-app-1 node scripts/import-houses.mjs
```

---

## 7. Porting this to another app

Work through these in order.

**Always change:**

1. **`image:` name** in compose → your GHCR path, or replace it with `build: .` (see §8).
2. **Host port** — `127.0.0.1:<PORT>:3000`. One port per site on the box; keep a list somewhere.
3. **Bind-mount path** — `/srv/<your-domain>/public/uploads`. Create it and `chown` it before first boot.
4. **Volume name** — `db-data` is scoped by compose project name (the directory), so two projects in differently-named directories won't collide. Verify with `docker volume ls`.
5. **Env vars** — regenerate every secret. `openssl rand -base64 32`. Never carry a `SESSION_SECRET` between projects.
6. **Nginx server block + certbot** for the new domain.
7. **`WEBHOOK_SECRET`** repo secret and a new webhook endpoint path.

**Change if the stack differs:**

- **No Prisma?** Drop `openssl` from both stages, drop `COPY prisma`, and strip the migrate/seed lines from the entrypoint. If the entrypoint ends up doing nothing but `exec "$@"`, delete it and use `CMD` alone.
- **Postgres instead of SQLite?** Drop the `db-data` volume, add a `db:` service with its own volume, add `depends_on`, and point `DATABASE_URL` at the service hostname. The entrypoint should then retry `migrate deploy` — Postgres accepts connections a few seconds after the container starts.
- **No file uploads?** Drop the bind mount, the `UPLOAD_DIR` env, and the Nginx `alias` block.
- **No runtime scripts?** Drop `COPY --from=builder /app/src` and `/app/scripts`.
- **Different Node version?** Match your local one. Pin the minor if the app is sensitive to it.

**Worth adopting wholesale, whatever the stack:** the manifest-before-source copy order, the `.dockerignore` list, `exec "$@"`, the loopback port binding, the `:?` on required secrets, and the `node -e` healthcheck.

### The `output: 'standalone'` option

This image copies all of `node_modules` — several hundred MB. Next's `output: 'standalone'` traces only the modules actually imported and emits a self-contained `server.js`, typically cutting the image by 60–80%.

It is not enabled here, and the reason is the entrypoint: standalone does **not** include the Prisma CLI, so `npx prisma migrate deploy` breaks. To switch, you would copy `.next/standalone`, `.next/static` and `public` as usual, then additionally copy `node_modules/prisma`, `node_modules/@prisma` and `node_modules/.bin/prisma`, and change `CMD` to `["node", "server.js"]`. Worth it for a big app; not worth the fragility for a small one.

---

## 8. Known rough edges in this repo

Fix these when you copy the setup — don't inherit them.

**`docker compose build` doesn't work here.** `README.md` and `CLAUDE.md` both document it, but `docker-compose.yml` declares only `image:` with no `build:` key, so there is nothing to build — the image is expected to come from GHCR via `docker compose pull`. Pick one:

```yaml
# Option A — build on the server (simple, needs build deps + RAM on the box)
build: .
image: avalahomeconcept-landing:latest

# Option B — build in CI, push to GHCR, pull on the server (current intent)
image: ghcr.io/savaticnemanja/avalahomeconcept-landing:latest
```

Option B is the better default, but it needs a CI job that actually builds and pushes; today the workflow only fires the webhook.

**`CLAUDE.md` says the DB is at `/data/prod.db`.** It is `/data/app.db` — that's what both the Dockerfile and compose set.

**No `USER` directive** — the container runs as root. The `node` image ships a `node` user; adding `USER node` before `EXPOSE` (and `chown`ing `/data` and the upload dir to it) is a cheap hardening win. Do it from day one on a new project; retrofitting means fixing volume ownership on existing data.

**No resource limits.** A `deploy.resources.limits` block (or `mem_limit` on non-swarm compose) stops one runaway container from taking down every other site on the box.

**Cross-architecture builds.** `sharp` arrives as an optional dependency of `next` and resolves its prebuilt binary at install time, then gets copied from the builder stage. That works because both stages are the same platform. If you ever build on Apple Silicon and deploy to an x86 server, pass `--platform linux/amd64` or you will ship arm64 binaries that fail at runtime.

**`.env` on the server is the single source of production secrets.** It exists only on the box. Back it up somewhere you'll actually find it, or a server rebuild means regenerating `SESSION_SECRET` and logging every admin out.
