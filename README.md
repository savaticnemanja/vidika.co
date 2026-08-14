# vidika.co

Single-page site for VIDIKA — a creative studio. Three full-viewport panels
(Origin · About · Contact) locked to a native scroll-snap rail.

Built with [Astro](https://astro.build) 7, self-hosted as a Docker container
behind nginx. No UI framework, no animation library — the whole page ships
**~5 KB of JavaScript** and no images (every mark is inline SVG drawn from the
brand vectors).

## Commands

| Command                | Does                                            |
| ---------------------- | ----------------------------------------------- |
| `npm install`          | Install dependencies                            |
| `npm run dev`          | Dev server at `localhost:4321`                  |
| `npm run build`        | Production build into `dist/`                   |
| `npm run preview`      | Serve the built site locally (no API)           |
| `npm run serve`        | Build, then run site **and** API on `:8787`     |
| `npm run check`        | Astro + TypeScript diagnostics                  |
| `npm run smoke`        | Exercise the contact endpoint end to end        |
| `npm run gen:assets`   | Regenerate favicons + OG image from the vectors |
| `npm run docker:up`    | Build the image and start the container         |
| `npm run docker:logs`  | Follow container logs                           |
| `npm run docker:down`  | Stop and remove the container                   |

## Before going live

Everything that needs real data lives in **`src/site.config.ts`** — search it
for `TODO`. Nothing else in the codebase hardcodes these values.

1. **Social URLs** — LinkedIn, IMDb and Instagram currently point at
   placeholder profiles.
2. **MIMOLAND destination** — `ABOUT.cta.href` is `'#'`, which renders the
   button in a dashed "Coming soon" state rather than as a dead link. Set a
   real URL (and `external: true` if it leaves the site) to activate it.
3. **Mail** — the form posts to `/api/contact`, handled by
   [`server/`](server/README.md), which sends through Resend from
   contact@vidika.co. `vidika.co` currently has **no MX records**, so verifying
   the domain with Resend (to send) and setting up an inbox (to receive) are
   the last steps before the form can deliver anything — see
   [server/README.md](server/README.md#setting-up-mail).

## Deploying

One container holds both halves: the built site and the handler that serves it.
nginx runs on the host, terminates TLS, and proxies everything to it. There is
no state — no database, no uploads, nothing written at runtime — so recreating
the container loses nothing and a rollback is just the previous image.

```
Internet ─:443 TLS─▶ nginx (host) ─▶ 127.0.0.1:8080 ─▶ container :8787
                                                        ├─ GET  /*            dist/
                                                        └─ POST /api/contact  Resend
```

| File | Role |
|---|---|
| `Dockerfile` | Two-stage build → the production image |
| `.dockerignore` | Keeps host junk and secrets out of the build context |
| `docker-compose.yml` | Port, env, restart policy, resource limits |
| `deploy/nginx-vidika.co.conf` | The host server block |
| `.github/workflows/publish.yaml` | Optional: build in CI, push to GHCR |

### Every deploy

```bash
cd /srv/vidika.co
git pull
docker compose up -d --build
curl -sf http://127.0.0.1:8080/healthz && echo   # {"ok":true,...}
```

### First time on the box

```bash
# 1. code
sudo mkdir -p /srv/vidika.co && sudo chown "$USER" /srv/vidika.co
git clone <repo> /srv/vidika.co && cd /srv/vidika.co

# 2. secrets — compose reads this file, it never enters the image
cp .env.example .env && chmod 600 .env
nano .env                     # RESEND_API_KEY at minimum

# 3. start
docker compose up -d --build
# Read these. "[mail] Resend ready" is the line you want — a bad key only
# warns and starts anyway, so the site can be up while mail is broken.
docker compose logs -f

# 4. nginx — the rate-limit zone goes in http{} first; the file says where
sudo nano /etc/nginx/nginx.conf
sudo cp deploy/nginx-vidika.co.conf /etc/nginx/sites-available/vidika.co
sudo ln -s /etc/nginx/sites-available/vidika.co /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 5. TLS
sudo certbot --nginx -d vidika.co -d www.vidika.co

# 6. prove it end to end
curl -sfI https://vidika.co | head -1
npm run smoke -- https://vidika.co
```

### Things worth knowing

**The `127.0.0.1:` prefix on the published port is load-bearing.** Docker writes
its own iptables rules below the firewall, so without it the container is
reachable from the internet even when UFW says the port is closed.

**The container listens on `0.0.0.0` and that is correct** — it is inside its
own network namespace, and the loopback that matters is the host's, which is
what the port mapping binds to.

**Compose refuses to start without `RESEND_API_KEY`.** With no key the handler
falls back to printing messages instead of sending them, and a box that
silently swallows enquiries is worse than one that fails loudly.

**One port per site on the box.** This one takes 8080; keep a list somewhere.

`docker compose up -d --build` builds on the server, which needs no registry
and no CI secrets. To build in CI instead, run the *Publish image* workflow and
swap `build: .` in `docker-compose.yml` for the GHCR path — the file says how.

### Locally

```bash
npm run serve     # build + site + API on :8787, exactly what the container runs
npm run smoke     # five submissions, one should be delivered
```

With no `RESEND_API_KEY` the handler prints composed messages instead of
sending them, so the whole path is testable without credentials.

## How it works

### Scroll lock

Native CSS scroll snapping, not wheel hijacking:

```css
.scroller { scroll-snap-type: y mandatory; }
.panel    { scroll-snap-align: start; scroll-snap-stop: always; }
```

Because the browser still owns the scroll, trackpad momentum, keyboard paging,
find-in-page and screen readers all keep working. `<body>` is `overflow: hidden`
and an inner `.scroller` does the scrolling, which also stops mobile browser
chrome from collapsing mid-scroll and resizing every snap point.

The lock relaxes to `proximity` under 620px of viewport height so a landscape
phone can never strand content off-screen.

### Theme

Two colours: the logo gold `#b78937` and the brand navy `#122238`.

The navy anchors a single ink ramp — the page ground `--ink-900` is a deeper
shade of it, `#122238` itself surfaces as the field fill and the drifting
background blobs, and `--ink-600` is the lifted hover tone. Gold is the only
accent, carrying every rule, border, focus ring and active state. Text is a
warm bone, which holds the same warm/cool tension against the navy as the gold.

Changing either colour means editing `--gold` / `--blob` and the `--ink-*`
ramp in `src/styles/tokens.css`, plus `GOLD` / `INK` / `NAVY` in
`scripts/generate-assets.mjs` if you want the icons and OG card to follow.

### Motion

All timing, easing and colour lives in `src/styles/tokens.css`. Animations are
multiplied by a `--motion` token that `prefers-reduced-motion` sets to `0`, so
one media query neutralises the whole system.

Highlights:

- **Intro** — the diamond assembles from its eight brand chevrons, each flying
  in from its own side, then a hairline frame draws itself around it.
- **Wordmark** — letters rise in sequence, then a gold sheen sweeps across them
  on a long loop (clipped to the letterforms, so it reads as light on metal).
- **Reveals** — headings clip upward, body copy uses an animated `mask-image`
  wipe (via a registered `@property`), rules scale out from centre.
- **Pointer** — an ambient spotlight follows the cursor, gated behind
  `(pointer: fine)`. Nothing else moves with the pointer: the hero lockup and
  the MIMOLAND CTA stay pinned by design. The spotlight writes
  `--pointer-x` / `--pointer-y` on `:root` — namespaced deliberately, since
  root-level custom properties inherit into every component.
- **Form** — floating labels, deco corner ticks that snap in on focus, and a
  submit state machine (idle → sending → sent) with a drawn checkmark.

Reveal *hiding* is scoped to `.js`, set by an inline head script. If JavaScript
fails, every element renders in its final visible state instead of staying
invisible forever.

### Contact form

Three layers, each of which works on its own:

```
form.ts  ──fetch JSON──▶  server /api/contact  ──Resend──▶  contact@vidika.co
   │                                                              ▲
   └── no JavaScript: the <form>'s own method/action posts ───────┘
       natively, and the handler answers with a rendered page
       instead of JSON
```

Validation lives in two places on purpose — `src/scripts/form.ts` for the
visitor's benefit, `server/validate.mjs` because that is the copy that can't be
bypassed. They share the same rules and the same wording.

Guards, in the order they fire: nginx `limit_req` → origin allowlist → rate
limit (5 per IP per 10 min, 60 overall) → body size → honeypot → fill-speed →
field rules. The two spam checks answer `200` and drop the message, because
telling a bot why it failed only helps it try again. The full table is in
[server/README.md](server/README.md#guards).

Mail is sent **from** contact@vidika.co with the visitor in `Reply-To`, never
from the visitor's own address: forging their domain into `From` is what fails
DMARC and lands enquiries in spam. Replying still reaches them.

Point `PUBLIC_CONTACT_ENDPOINT` somewhere else to swap in a hosted form
backend, or set it empty to fall back to opening the visitor's mail client.

### Accessibility

- axe-core: **0 violations** across the homepage and 404.
- Contrast measured against real rendered pixels (blobs, vignette and grain
  composited in, sampled at the lightest background pixel behind each element):
  every text element lands between **5.2:1 and 14:1**, all passing WCAG AA.
  The tightest is the gold "Explore our first IP" at 5.2:1.
- Skip link, landmark regions, a focusable scroll container with an accessible
  name, and a single consistent gold focus ring.
- The form links errors with `aria-describedby`/`aria-invalid`, moves focus to
  the first invalid field, and announces status through `role="status"`.
  Untouched fields are never marked red just for being tabbed through.
- No layout shift when validation messages appear — the space is reserved.

### SEO

Canonical URLs, Open Graph + Twitter card metadata, and a JSON-LD `@graph`
(`Organization` + `WebSite`) are generated in `src/components/Seo.astro` from
`site.config.ts`. `sitemap-index.xml` and `robots.txt` are produced at build.

Icons and the 1200×630 OG card are generated by `scripts/generate-assets.mjs`
from the two source vectors in `scripts/brand/`. The output is committed, so
this only needs rerunning when the artwork itself changes.

Those two SVGs are the gold web cuts of the symbol and the full lockup, and
they are all this repo keeps of the brand package — the other colourways and
the AI/PDF/PNG masters live outside it. They are also what `src/mark.ts` was
traced from, so replacing them means re-copying the path data there too.

## Layout

```
src/
  site.config.ts     all copy, links and metadata (start here)
  styles/            tokens.css (design system) + global.css (reset, snap, reveals)
  layouts/Base.astro <head>, fonts, ambient background
  components/        Hero · About · Contact + chrome and brand marks
  scripts/           motion.ts (observers, parallax) · form.ts (validation, submit)
server/              the process the container runs — see server/README.md
  index.mjs          routing: /api/contact, /healthz, everything else static
  static.mjs         dist/ off disk: MIME, caching, 404, traversal guard
  config.mjs         env → frozen config, validated at boot
  validate.mjs       field rules, mirrors src/scripts/form.ts
  ratelimit.mjs      sliding window, per-IP and global
  mail.mjs           composition (text + HTML) and the Resend call
  page.mjs           the reply a no-JavaScript form post gets
Dockerfile           two-stage build → the production image
docker-compose.yml   port, env, restart policy, resource limits
deploy/
  nginx-vidika.co.conf  host server block: TLS, proxy, rate limit
scripts/
  generate-assets.mjs favicon/OG generation from brand/
  smoke-contact.mjs   end-to-end check of the contact endpoint
  brand/              the two source vectors (not shipped)
```
