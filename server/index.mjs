/**
 * vidika.co contact endpoint.
 *
 * A single Node process on loopback, fronted by nginx, that turns the form's
 * JSON POST into an email from contact@vidika.co. No framework: one route, one
 * verb, one job.
 *
 *   POST /api/contact   { name, email, message, elapsedMs, company? }
 *   GET  /healthz       liveness for the reverse proxy / uptime checks
 *
 * It answers in whichever shape it was asked in: JSON to the form's fetch,
 * a rendered page to a browser that submitted the form without JavaScript.
 */

import { createServer } from 'node:http';
import { CONFIG } from './config.mjs';
import { validate } from './validate.mjs';
import { RateLimiter } from './ratelimit.mjs';
import { createMailer } from './mail.mjs';
import { successPage, errorPage } from './page.mjs';
import { createStaticHandler } from './static.mjs';

const limiter = new RateLimiter(CONFIG.rate);
const mailer = await createMailer();

/** null when there is no build to serve — see static.mjs. */
const serveStatic = CONFIG.staticRoot
  ? await createStaticHandler(CONFIG.staticRoot)
  : null;

function write(res, status, type, payload, headers = {}) {
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    // Nothing here is meant to be embedded or sniffed.
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(payload);
}

function send(res, status, body, headers = {}) {
  write(res, status, 'application/json; charset=utf-8', JSON.stringify(body), headers);
}

/**
 * How the client asked, and therefore how it should be answered. form.ts
 * sends JSON and reads JSON; a browser with no JavaScript submits the form
 * natively — urlencoded, expecting a document back.
 */
function negotiate(req) {
  const type = String(req.headers['content-type'] ?? '');
  const form = type.includes('application/x-www-form-urlencoded');
  return {
    json: type.includes('application/json'),
    form,
    html: form && String(req.headers.accept ?? '').includes('text/html'),
  };
}

/** One reply, rendered as JSON or as a page depending on who asked. */
function reply(res, view, status, body, headers = {}) {
  if (!view.html) {
    send(res, status, body, headers);
    return;
  }
  const page = body.ok ? successPage() : errorPage(body.error);
  write(res, status, 'text/html; charset=utf-8', page, headers);
}

/**
 * Real client address. Cloudflare sits in front of the origin, so its header
 * is the most trustworthy hop; nginx's X-Real-IP is the fallback for direct
 * origin traffic. Both are only believable because nothing but the proxy can
 * reach this port.
 */
function clientIp(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf) return cf.trim();

  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real) return real.trim();

  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) {
    return forwarded.split(',')[0].trim();
  }

  return req.socket.remoteAddress ?? 'unknown';
}

function originAllowed(req) {
  const origin = req.headers.origin;
  // Absent Origin means a non-browser client; the rate limit is its only gate.
  if (typeof origin !== 'string' || !origin) return true;
  return CONFIG.allowedOrigins.includes(origin);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    /** @type {Buffer[]} */
    const chunks = [];

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > CONFIG.maxBodyBytes) {
        // Stop reading, but leave the socket alive long enough to answer —
        // destroying it here would leave the client with no status at all.
        req.pause();
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleContact(req, res) {
  const view = negotiate(req);

  if (!originAllowed(req)) {
    reply(res, view, 403, { ok: false, error: 'Submission blocked.' });
    return;
  }

  const ip = clientIp(req);
  const { allowed, retryAfterSec } = limiter.take(ip);
  if (!allowed) {
    console.warn(`[rate] ${ip} throttled`);
    reply(
      res,
      view,
      429,
      { ok: false, error: 'That’s a few messages in quick succession — please try again shortly.' },
      { 'Retry-After': String(retryAfterSec) },
    );
    return;
  }

  if (!view.json && !view.form) {
    reply(res, view, 415, { ok: false, error: 'Malformed submission.' });
    return;
  }

  let payload;
  try {
    const raw = await readBody(req);
    payload = view.form ? Object.fromEntries(new URLSearchParams(raw)) : JSON.parse(raw);
  } catch (error) {
    if (error.status === 413) {
      // The rest of the body is still in flight and we're not going to read
      // it, so close the connection once the refusal is on the wire.
      reply(
        res,
        view,
        413,
        { ok: false, error: 'That message is longer than we can accept.' },
        { Connection: 'close' },
      );
      res.on('finish', () => req.destroy());
      return;
    }
    reply(res, view, 400, { ok: false, error: 'Malformed submission.' });
    return;
  }

  const result = validate(payload);
  if (!result.ok) {
    // A silent rejection (honeypot, impossible fill speed) looks exactly like
    // success from the outside.
    if (result.silent) {
      console.info(`[spam] discarded submission from ${ip}`);
      reply(res, view, 200, { ok: true });
      return;
    }
    reply(res, view, result.status, { ok: false, error: result.error });
    return;
  }

  try {
    await mailer.send(result.data, {
      ip,
      userAgent: String(req.headers['user-agent'] ?? 'unknown').slice(0, 200),
      receivedAt: new Date().toISOString(),
    });
    reply(res, view, 200, { ok: true });
  } catch (error) {
    // The visitor should never see an SMTP error; the journal gets all of it.
    console.error(`[mail] delivery failed for ${ip}:`, error);
    reply(res, view, 502, {
      ok: false,
      error: `We couldn’t send that just now. Please email us at ${CONFIG.mail.to}.`,
    });
  }
}

function unhandled(res) {
  return (error) => {
    console.error('[http] unhandled:', error);
    if (!res.headersSent) send(res, 500, { ok: false, error: 'Something went wrong.' });
  };
}

const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];

  // Never the site's 404: this is what the container healthcheck and any
  // uptime probe read, so it answers in JSON whatever else is mounted.
  if (req.method === 'GET' && path === '/healthz') {
    send(res, 200, { ok: true, transport: CONFIG.transport });
    return;
  }

  if (path === CONFIG.path) {
    if (req.method !== 'POST') {
      send(res, 405, { ok: false, error: 'Method not allowed.' }, { Allow: 'POST' });
      return;
    }

    handleContact(req, res).catch(unhandled(res));
    return;
  }

  // Everything that isn't the API is the site. Checked in this order on
  // purpose — the contact path wins even if a page ever takes the same name.
  if (serveStatic) {
    serveStatic(req, res, path).catch(unhandled(res));
    return;
  }

  send(res, 404, { ok: false, error: 'Not found.' });
});

// Slow-loris guard: a request that hasn't finished arriving in 15s never will.
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;

try {
  await mailer.verify();
} catch (error) {
  console.error(
    `[mail] ${CONFIG.transport} verification failed — refusing to start:`,
    error.message,
  );
  process.exit(1);
}

server.listen(CONFIG.port, CONFIG.host, () => {
  console.info(
    `[http] contact handler on http://${CONFIG.host}:${CONFIG.port}${CONFIG.path} ` +
      `→ ${CONFIG.mail.to} (${CONFIG.transport})`,
  );
  console.info(
    serveStatic
      ? `[http] serving the site from ${CONFIG.staticRoot}`
      : '[http] no build to serve — API only',
  );
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.info(`[http] ${signal} — draining`);
    server.close(() => process.exit(0));
    // Don't let a hung keep-alive socket block a restart.
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
