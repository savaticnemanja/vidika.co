# The server

One Node process that serves the built site and takes the contact form. No
framework and no dependencies — `node:http` and `fetch` are enough — which is
why the runtime image carries no `node_modules` at all.

```
browser ──▶ nginx (host, TLS) ──▶ 127.0.0.1:8080 ──▶ container :8787
                                                          │
                                        GET  /*           ├─▶ dist/ off disk
                                        POST /api/contact ├─▶ Resend ──▶ contact@vidika.co
                                        GET  /healthz     └─▶ liveness
```

Deployment lives in the root [README](../README.md#deploying). This file is
about the handler itself.

## Two halves

**The site** (`static.mjs`) is `dist/`, served straight off disk. It resolves
Astro's directory-index layout (`/privacy-notice` → `privacy-notice/index.html`),
redirects the trailing-slash form since `astro.config.mjs` sets
`trailingSlash: 'never'`, renders `404.html` for anything unresolved, and sets
cache headers by type: a year and `immutable` for the fingerprinted files under
`_astro/`, a month for fonts, always-revalidate for HTML. ETags make the
revalidation a 304 rather than a resend.

It switches itself off when there is no `dist/` to serve, so the same process
runs as a bare API against `astro dev`.

**The form** (`index.mjs`) validates a submission and sends it through
**Resend** as an email **from contact@vidika.co**, with the visitor in
`Reply-To`. It answers in whichever shape it was asked in — JSON to the form's
`fetch`, a rendered page to a browser that posted without JavaScript.

Resend's HTTP API rather than its SMTP bridge: it needs only outbound 443,
which no host blocks, while 587 and 25 are routinely firewalled on VPS
providers. `MAIL_TRANSPORT=smtp` is still there as an escape hatch — it imports
nodemailer dynamically, so it needs a line added to the Dockerfile (there is a
commented one in place).

## Why not send from the visitor's address

Putting the visitor in `From` is the obvious-looking move and it is what gets
enquiries filed as spam — vidika.co's SPF and DKIM records don't authorise
gmail.com to send as one of its users, so the message fails DMARC at the
receiving end. So `From` is always contact@vidika.co, and the visitor's address
goes in `Reply-To`. Hitting reply in any client still answers them.

## Setting up mail

Sending and receiving are two separate jobs, and Resend only does the first —
it delivers mail, it does not host an inbox. Both halves are needed before an
enquiry reaches a human.

### 1. Sending — Resend

Add **vidika.co** under [Domains](https://resend.com/domains). Resend prints
three records to add at the DNS host:

| Type | Name | Purpose |
| --- | --- | --- |
| TXT | `resend._domainkey` | DKIM — signs every message |
| TXT | `send` | SPF for the bounce subdomain |
| MX | `send` | bounce and complaint handling |

They live on the `send.vidika.co` subdomain, so they **don't collide** with the
root-domain MX records that receiving needs. Wait for the domain to read
*Verified* — until it does, every send is rejected outright.

Then create a key at [API keys](https://resend.com/api-keys) with **Sending
access** only, and put it in the `.env` next to `docker-compose.yml` as
`RESEND_API_KEY`.

The handler checks the key at boot, but only a key Resend actively rejects
(401/403) is fatal. A malformed one comes back 400, and an unreachable Resend
comes back not at all — both log a warning and start anyway, deliberately, so a
blip at boot can't keep the site down. **So read the first lines of
`docker compose logs` after a deploy**: `[mail] Resend ready` is the one you
want, and anything mentioning a status code means mail will fail on the first
real submission even though the site is up.

The free tier is 3,000 messages a month and 100 a day — orders of magnitude
more than a studio contact form needs, unless `MAIL_ACK=true` doubles it and
something starts hammering the endpoint. The guards below are the backstop.

### 2. Receiving — contact@vidika.co

The enquiry is addressed to contact@vidika.co, so that address needs to
actually accept mail. **Cloudflare Email Routing** is free and takes a minute:
enable it for the zone, add `contact@vidika.co` as a destination forwarding to
a personal inbox, and let it add the root MX records. Replies then arrive
wherever you already read mail, and hitting reply answers the visitor directly
because their address is in `Reply-To`.

Any real mailbox provider works too. `MAIL_TO` doesn't have to be
contact@vidika.co — point it at an inbox that already exists and skip this step.

### 3. DMARC

Once mail flows both ways, publish a policy so the domain can't be spoofed:

```
_dmarc.vidika.co  TXT  "v=DMARC1; p=quarantine; rua=mailto:contact@vidika.co"
```

## Running it locally

The whole thing, exactly as deployed but without Docker:

```bash
npm run serve      # build, then site + API on :8787
```

That reads the repo-root `.env` if there is one — the same file compose reads
on the server, so there is one place to look either way. With no
`RESEND_API_KEY` the handler prints composed messages instead of sending them,
so the full path is testable without credentials.

To work on the front end with live reload instead, run `astro dev` on :4321 and
point the form at a separately-running handler — see `PUBLIC_CONTACT_ENDPOINT`
in `.env.example`. Astro's dev server does not proxy `/api/contact`.

Either way, exercise the endpoint with:

```bash
npm run smoke                                    # against :8787
npm run smoke -- http://127.0.0.1:8099           # or anywhere else
```

It sends one valid submission and four that should be refused — honeypot,
impossible fill speed, bad email, short message — and prints a pass/fail line
for each.

## Guards

| Guard | Where | Behaviour |
| --- | --- | --- |
| Honeypot (`company`) | `validate.mjs` | Silent 200 — the bot thinks it won |
| Fill faster than 3s | `validate.mjs` | Silent 200 |
| 5 submissions / IP / 10 min | `ratelimit.mjs` | 429 with `Retry-After` |
| 60 submissions / 10 min, all IPs | `ratelimit.mjs` | 429 — one botnet can't drain the quota |
| 10 req/min/IP | nginx `limit_req` | 429 before Node parses a body |
| Origin not vidika.co | `index.mjs` | 403 |
| Body over 32 KB | `index.mjs` | 413, connection destroyed |
| Body over 64 KB | nginx `client_max_body_size` | 413 one hop earlier |
| CR/LF in name or email | `validate.mjs` | Collapsed — no header injection |
| Path traversal | `static.mjs` | 404 after normalising, not before |

Tune the numbers with the env vars in `.env.example`; the defaults suit a
studio site that expects a handful of enquiries a week.

If spam ever gets past this, the next step is a challenge on the form —
Turnstile or hCaptcha — which is a script tag and one token check here.

## Files

```
index.mjs        http server, routing, abuse guards
static.mjs       dist/ off disk: MIME, caching, 404, traversal guard
config.mjs       env → frozen config, validated at boot
validate.mjs     field rules, mirrors src/scripts/form.ts
ratelimit.mjs    sliding window, per-IP and global
mail.mjs         composition (text + HTML), Resend / SMTP / console
page.mjs         the reply a no-JavaScript form post gets
```

`package.json` here declares one optional dependency and nothing else — the
Resend path installs nothing, which is why the runtime image has no
`node_modules`. Every script lives in the root `package.json`, and every
environment variable in the root `.env.example`.
