/**
 * Environment → frozen config, resolved once at boot.
 *
 * Anything missing or malformed fails here rather than on the first visitor's
 * submission: a handler that starts cleanly and then drops mail is worse than
 * one that refuses to start.
 */

/** Field limits, kept in lockstep with CONTACT.fields in src/site.config.ts. */
export const LIMITS = Object.freeze({
  name: 80,
  email: 120,
  message: 1200,
});

function str(key, fallback) {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
}

function int(key, fallback) {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) throw new Error(`${key} must be an integer, got "${raw}"`);
  return value;
}

function bool(key, fallback) {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  return /^(1|true|yes|on)$/i.test(raw);
}

function list(key, fallback) {
  return str(key, fallback)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const resendKey = str('RESEND_API_KEY', '');
const smtpHost = str('SMTP_HOST', '');

/**
 * How mail leaves the box.
 *
 *   resend   Resend's HTTP API — no dependency, and it needs only outbound
 *            443, which VPS providers don't block the way they block 587/25.
 *   smtp     Any SMTP provider, via nodemailer (an optional dependency).
 *   console  Prints the composed message and reports success.
 *
 * Console is the default only when nothing is configured, so a production box
 * that loses its credentials fails loudly rather than quietly swallowing
 * enquiries.
 */
const TRANSPORTS = ['resend', 'smtp', 'console'];

const transport = str(
  'MAIL_TRANSPORT',
  resendKey ? 'resend' : smtpHost ? 'smtp' : 'console',
);

if (!TRANSPORTS.includes(transport)) {
  throw new Error(
    `MAIL_TRANSPORT must be one of ${TRANSPORTS.join(', ')} — got "${transport}"`,
  );
}

const smtpPort = int('SMTP_PORT', 587);

export const CONFIG = Object.freeze({
  port: int('PORT', 8787),
  /**
   * Loopback by default — nothing but the proxy should reach this.
   *
   * In a container that has to be 0.0.0.0, because the port is published from
   * outside the network namespace and loopback inside it is not the same
   * interface. That is safe only because compose publishes the port as
   * `127.0.0.1:8080:8787`; see the note in docker-compose.yml, and never drop
   * that prefix, since Docker writes its own iptables rules and would expose
   * the port to the internet regardless of what the firewall says.
   */
  host: str('HOST', '127.0.0.1'),
  /** Path the form POSTs to. */
  path: str('CONTACT_PATH', '/api/contact'),

  /**
   * The built site, served by this process alongside the API so the container
   * is the whole deployment. Empty disables it and leaves a bare API, which is
   * what you want when `astro dev` is serving the front end instead.
   *
   * Relative to server/, `../dist` is the build output in both the repo and
   * the image, so neither needs to set this.
   */
  staticRoot: str('STATIC_ROOT', new URL('../dist', import.meta.url).pathname),

  transport,

  resend: Object.freeze({
    apiKey: resendKey,
    /** Overridable so the test harness can point at a local stub. */
    apiUrl: str('RESEND_API_URL', 'https://api.resend.com'),
  }),

  smtp: Object.freeze({
    host: smtpHost,
    port: smtpPort,
    // Implicit TLS on 465; STARTTLS everywhere else.
    secure: bool('SMTP_SECURE', smtpPort === 465),
    user: str('SMTP_USER', ''),
    pass: str('SMTP_PASS', ''),
  }),

  mail: Object.freeze({
    /**
     * Envelope + header sender. Its domain must be verified with the sending
     * provider — Resend rejects anything else outright.
     */
    from: str('MAIL_FROM', 'VIDIKA <contact@vidika.co>'),
    /** Where enquiries land. */
    to: str('MAIL_TO', 'contact@vidika.co'),
    subjectPrefix: str('MAIL_SUBJECT_PREFIX', 'VIDIKA enquiry'),
    /** Opt-in courtesy auto-reply to the visitor. Off by default. */
    ack: bool('MAIL_ACK', false),
  }),

  /**
   * Same-origin guard. A browser attaches Origin to every fetch POST, so a
   * mismatch is a cross-site attempt; a missing Origin is a non-browser client
   * (curl, uptime check) and is judged on the rate limit alone.
   */
  allowedOrigins: Object.freeze(
    list('ALLOWED_ORIGINS', 'https://vidika.co,https://www.vidika.co'),
  ),

  rate: Object.freeze({
    /** Submissions per IP per window. */
    max: int('RATE_MAX', 5),
    windowMs: int('RATE_WINDOW_MS', 10 * 60 * 1000),
    /** Cap across all IPs in the same window, so one botnet can't drain SMTP. */
    maxGlobal: int('RATE_MAX_GLOBAL', 60),
  }),

  /** Nobody reads three fields and submits in under three seconds. */
  minElapsedMs: int('MIN_ELAPSED_MS', 3000),

  /** Hard ceiling on the request body, well above a full-length submission. */
  maxBodyBytes: int('MAX_BODY_BYTES', 32 * 1024),
});

if (CONFIG.transport === 'resend' && !CONFIG.resend.apiKey) {
  throw new Error('MAIL_TRANSPORT=resend needs RESEND_API_KEY — see .env.example');
}

if (CONFIG.transport === 'smtp') {
  const missing = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'].filter(
    (key) => !process.env[key],
  );
  if (missing.length) {
    throw new Error(
      `MAIL_TRANSPORT=smtp needs ${missing.join(', ')} — see .env.example`,
    );
  }
}
