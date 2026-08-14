# vidika.co — the built site and the contact handler as one image.
#
# The site is static and the handler has no dependencies, which makes this
# smaller than the usual Node image: the runtime stage carries no node_modules
# at all. Astro and its toolchain exist only in the build stage; what ships is
# `dist/` (a folder of files) and `server/` (seven .mjs files that import
# nothing outside node:*).
#
# The two stages run on different bases, for reasons that only apply to one of
# them. The build installs `sharp`, which ships prebuilt binaries against
# glibc, so it gets Debian slim — musl there means a different target or a
# build from source. The runtime installs nothing at all, which leaves no
# native binary to care about, so it gets Alpine and the image ends up less
# than half the size.

# ── Build ─────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Manifests before source. This is the expensive layer, and copying only the
# two files that decide it means it stays cached across every edit to src/.
# Copy the tree first instead and every change reinstalls node_modules.
COPY package.json package-lock.json ./
RUN npm ci

# Everything `astro build` reads, and nothing else — server/ deliberately does
# not enter this stage, so a change to the handler cannot invalidate the build.
COPY astro.config.mjs tsconfig.json ./
COPY src ./src
COPY public ./public
RUN npm run build

# ── Runtime ───────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8787
# 0.0.0.0, not loopback: the port is published from outside this network
# namespace, and a process bound to the container's own loopback is not
# reachable from it. What keeps this off the internet is the 127.0.0.1 prefix
# on the published port in docker-compose.yml — see the note there.
ENV HOST=0.0.0.0
ENV STATIC_ROOT=/app/dist

COPY --from=builder /app/dist ./dist
# Only the source files. server/.env is excluded by .dockerignore as well, but
# naming the extension here means a stray file in that directory can never be
# baked in by accident.
COPY server/*.mjs ./server/

# The image ships the Resend transport, which needs only fetch. MAIL_TRANSPORT=smtp
# imports nodemailer dynamically and would need it installed here:
#   COPY server/package.json server/package-lock.json ./server/
#   RUN cd server && npm ci --omit=dev

# The node image ships a `node` user. Nothing here is written to at runtime, so
# there is no ownership to fix — the process only ever reads.
USER node

EXPOSE 8787

# `node -e`, not curl: the slim image has no curl, and adding one for a
# healthcheck is a layer and an attack surface for nothing. -e runs as
# CommonJS, so require() is available regardless of the app being ESM.
# The start period covers the boot-time check that the mail credentials work.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:8787/healthz', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# No entrypoint script: there are no migrations to run and no directories to
# create, so it would be a shell that does nothing but `exec "$@"`.
CMD ["node", "server/index.mjs"]
