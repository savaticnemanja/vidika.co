/**
 * Message composition and delivery.
 *
 * The From address is always the site's own mailbox — contact@vidika.co —
 * never the visitor's. Forging the visitor into From is what breaks SPF and
 * DMARC and lands enquiries in spam; their address goes in Reply-To instead,
 * so hitting reply in any mail client still answers them directly.
 */

import { CONFIG } from './config.mjs';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

function formatDuration(ms) {
  if (ms === null) return 'unknown';
  if (ms < 1000) return `${ms} ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** The enquiry itself, as it lands in the studio inbox. */
function composeEnquiry(submission, meta) {
  const { name, email, message, elapsedMs } = submission;

  const footer = [
    `Received: ${meta.receivedAt}`,
    `Time to complete: ${formatDuration(elapsedMs)}`,
    `IP: ${meta.ip}`,
    `User agent: ${meta.userAgent}`,
  ];

  const text = [
    `From: ${name} <${email}>`,
    '',
    message,
    '',
    '—',
    ...footer,
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#0f1a29;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <div style="max-width:36rem;margin:0 auto;background:#122238;border:1px solid rgba(183,137,55,.28);border-radius:4px;overflow:hidden;">
      <div style="padding:20px 24px;border-bottom:1px solid rgba(183,137,55,.35);">
        <div style="font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#b78937;">Website enquiry</div>
        <div style="margin-top:6px;font-size:18px;color:#efe7d9;">${escapeHtml(name)}</div>
        <a href="mailto:${escapeHtml(email)}" style="font-size:14px;color:#d6a44f;text-decoration:none;">${escapeHtml(email)}</a>
      </div>
      <div style="padding:24px;font-size:15px;line-height:1.65;color:#efe7d9;white-space:pre-wrap;">${escapeHtml(message)}</div>
      <div style="padding:16px 24px;border-top:1px solid rgba(255,255,255,.08);font-size:12px;line-height:1.7;color:#9aa7b6;">
        ${footer.map((line) => escapeHtml(line)).join('<br />')}
      </div>
    </div>
  </body>
</html>`;

  return {
    from: CONFIG.mail.from,
    to: CONFIG.mail.to,
    replyTo: { name, address: email },
    subject: `${CONFIG.mail.subjectPrefix} — ${name}`,
    text,
    html,
    headers: { 'X-Vidika-Form': 'contact' },
  };
}

/** Optional courtesy note back to the visitor (MAIL_ACK=true). */
function composeAck(submission) {
  const { name, message } = submission;

  const text = [
    `Dear ${name},`,
    '',
    'Thank you for reaching out to VIDIKA. Your message has arrived and we will',
    'reply personally as soon as we can.',
    '',
    'For reference, this is what you sent us:',
    '',
    message.replace(/^/gm, '> '),
    '',
    '—',
    'VIDIKA · Creative Origins',
    'contact@vidika.co · https://vidika.co',
  ].join('\n');

  return {
    from: CONFIG.mail.from,
    to: { name, address: submission.email },
    replyTo: CONFIG.mail.to,
    subject: 'Thank you for contacting VIDIKA',
    text,
    headers: {
      'X-Vidika-Form': 'contact-ack',
      // Keeps out-of-office replies and mailing lists from answering back.
      'Auto-Submitted': 'auto-replied',
      Precedence: 'bulk',
    },
  };
}

/** `{ name, address }` → the single string an API expects in a header. */
function address(value) {
  if (typeof value === 'string') return value;
  return value.name ? `${value.name} <${value.address}>` : value.address;
}

function describe(message) {
  return `to=${address(message.to)} subject=${JSON.stringify(message.subject)}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resend's HTTP API.
 *
 * Chosen over their SMTP bridge because it needs nothing but outbound 443 —
 * plenty of hosts block 587 and 25 on principle — and no dependency: fetch
 * has been in Node since 18.
 */
function createResendTransport(log) {
  const base = CONFIG.resend.apiUrl.replace(/\/$/, '');
  const headers = {
    Authorization: `Bearer ${CONFIG.resend.apiKey}`,
    'Content-Type': 'application/json',
  };

  async function post(message, attempt = 1) {
    let response;
    try {
      response = await fetch(`${base}/emails`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          from: address(message.from),
          to: [address(message.to)],
          reply_to: address(message.replyTo),
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
          headers: message.headers,
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      // Network trouble or timeout — worth exactly one more try.
      if (attempt === 1) {
        log.warn(`[mail] Resend unreachable (${error.message}) — retrying`);
        await sleep(750);
        return post(message, 2);
      }
      throw error;
    }

    if (response.ok) {
      const { id } = await response.json().catch(() => ({}));
      return id ?? null;
    }

    const detail = await response.text().catch(() => '');

    // Throttling and their own 5xx are transient; a 4xx about the message
    // itself will fail identically no matter how often it's repeated.
    if ((response.status === 429 || response.status >= 500) && attempt === 1) {
      log.warn(`[mail] Resend ${response.status} — retrying`);
      await sleep(750);
      return post(message, 2);
    }

    throw new Error(`Resend ${response.status}: ${detail.slice(0, 400)}`);
  }

  return {
    /**
     * Checks the key at boot, and that the From domain is actually verified —
     * an unverified domain is the single most common reason a first Resend
     * send fails, and finding out here beats finding out from a lost enquiry.
     *
     * Only a bad key is fatal. A sending-only key can't list domains, and a
     * network blip at boot shouldn't keep the form down.
     */
    async verify() {
      const domain = address(CONFIG.mail.from).split('@').pop()?.replace('>', '');

      let response;
      try {
        response = await fetch(`${base}/domains`, {
          headers,
          signal: AbortSignal.timeout(10_000),
        });
      } catch (error) {
        log.warn(`[mail] could not reach Resend at boot (${error.message})`);
        return;
      }

      if (response.status === 401 || response.status === 403) {
        const body = await response.json().catch(() => ({}));
        if (body.name === 'restricted_api_key') {
          log.info('[mail] Resend ready — sending-only key, domain check skipped');
          return;
        }
        throw new Error(`Resend rejected the API key: ${body.message ?? response.status}`);
      }

      if (!response.ok) {
        log.warn(`[mail] Resend domain check returned ${response.status}`);
        return;
      }

      const { data = [] } = await response.json().catch(() => ({ data: [] }));
      const match = data.find((entry) => entry.name === domain);

      if (!match) {
        log.warn(
          `[mail] ${domain} is not on this Resend account — sends from ` +
            `${address(CONFIG.mail.from)} will be rejected until it is added and verified`,
        );
      } else if (match.status !== 'verified') {
        log.warn(`[mail] ${domain} is "${match.status}" on Resend, not verified — sends will fail`);
      } else {
        log.info(`[mail] Resend ready — ${domain} verified`);
      }
    },

    send: post,
  };
}

/** Any SMTP provider, via nodemailer. */
async function createSmtpTransport(log) {
  let nodemailer;
  try {
    ({ default: nodemailer } = await import('nodemailer'));
  } catch {
    throw new Error(
      'MAIL_TRANSPORT=smtp needs nodemailer — run `npm install nodemailer` in server/, ' +
        'or use MAIL_TRANSPORT=resend, which needs no dependency',
    );
  }

  const transporter = nodemailer.createTransport({
    host: CONFIG.smtp.host,
    port: CONFIG.smtp.port,
    secure: CONFIG.smtp.secure,
    auth: { user: CONFIG.smtp.user, pass: CONFIG.smtp.pass },
    // One connection, reused across submissions; a contact form never needs
    // more, and a persistent pool keeps handshake latency out of the request.
    pool: true,
    maxConnections: 1,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  return {
    /** Proves host, port and credentials at boot instead of at 3am. */
    async verify() {
      await transporter.verify();
      log.info(`[mail] SMTP ready — ${CONFIG.smtp.host}:${CONFIG.smtp.port}`);
    },

    async send(message) {
      const receipt = await transporter.sendMail(message);
      return receipt.messageId ?? null;
    },
  };
}

/** Prints what would have been sent. The default until credentials exist. */
function createConsoleTransport(log) {
  log.warn('[mail] MAIL_TRANSPORT=console — messages are printed, not sent');

  return {
    async verify() {},
    async send(message) {
      log.info(`[mail] would send ${describe(message)}\n${message.text}\n`);
      return null;
    },
  };
}

export async function createMailer(log = console) {
  const transport =
    CONFIG.transport === 'resend'
      ? createResendTransport(log)
      : CONFIG.transport === 'smtp'
        ? await createSmtpTransport(log)
        : createConsoleTransport(log);

  return {
    verify: () => transport.verify(),

    async send(submission, meta) {
      const enquiry = composeEnquiry(submission, meta);
      const id = await transport.send(enquiry);
      log.info(`[mail] sent ${describe(enquiry)}${id ? ` id=${id}` : ''}`);

      if (!CONFIG.mail.ack) return;

      // The visitor's copy is a nicety. If it fails, the studio still has the
      // enquiry — so this one is logged and swallowed, never surfaced.
      try {
        const ack = composeAck(submission);
        await transport.send(ack);
        log.info(`[mail] sent ${describe(ack)}`);
      } catch (error) {
        log.warn(`[mail] acknowledgement failed: ${error.message}`);
      }
    },
  };
}
