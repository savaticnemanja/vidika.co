/**
 * Message composition and delivery.
 *
 * The From address is always the site's own mailbox — studio@vidika.co —
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

/**
 * The courtesy note back to the visitor (MAIL_ACK).
 *
 * This is the only piece of VIDIKA most enquirers will see before a person
 * writes back, so it is built to the site's own design rather than to the
 * generic auto-reply it replaced — the navy ground, the gold rules, the mark,
 * the wordmark tracked wide over the tagline, the message set in a serif.
 *
 * Three things about mail make that a different job from building the page:
 *
 *   Tables, not boxes. Outlook on Windows lays HTML out with Word's engine,
 *   which has no flexbox, no grid and no reliable div widths. Nested tables
 *   with explicit widths are the one construction every client agrees on.
 *
 *   Opaque colour only. The site's palette is half translucent — --line is
 *   gold at 22%, --bone-soft is bone at 78% — and Word drops rgba() outright,
 *   which would leave hairlines black and body copy invisible. Every value
 *   below is one of those tokens already composited against the ground it
 *   sits on, so the mail matches the page without ever asking for alpha.
 *
 *   No web fonts. Jost and Cormorant Garamond will not load, so each is
 *   listed first and followed by the nearest thing a mail client is likely to
 *   have — a geometric sans, and a Garamond-cut serif — before the generic.
 *
 * The mark is the one image, and it is allowed to fail: clients that block
 * images are left with the wordmark, which is live text, and the note reads
 * exactly the same without it.
 */
function composeAck(submission) {
  const { name, email } = submission;

  const text = [
    'VIDIKA',
    'CREATIVE ORIGINS',
    '',
    'Thank you for reaching out.',
    '',
    'Your message has reached VIDIKA.',
    "Every connection can open new possibilities — we'll be in touch soon.",
    '',
    '—',
    'studio@vidika.co · https://vidika.co',
  ].join('\n');

  /* The site's tokens, flattened onto the ground each one sits on. */
  const INK = '#0a131f'; // --ink-900, the page ground
  const CARD = '#122238'; // --ink-700, the field fill
  const GOLD = '#b78937'; // --gold
  const BONE = '#ede7db'; // --bone
  const EDGE = '#4c4028'; // --line-strong, on the ground
  const RULE = '#444138'; // --line, on the card
  const SOFT = '#bdbcb7'; // --bone-soft, on the card
  const DIM = '#777d83'; // the footer's quiet bone, on the card

  const SANS = "'Jost','Century Gothic','Futura','Trebuchet MS',Helvetica,Arial,sans-serif";
  const SERIF = "'Cormorant Garamond','Garamond',Georgia,'Times New Roman',serif";

  /* A centred line that is letter-spaced carries that spacing after its last
     letter too, so the glyphs sit half a track left of where they look centred.
     Half the track back as an indent puts them where the eye expects. */
  const tracked = (size, track, color, { caps = true, weight = '400' } = {}) =>
    `font-family:${SANS};font-size:${size}px;font-weight:${weight};` +
    `letter-spacing:${track}em;text-indent:${track / 2}em;color:${color};` +
    (caps ? 'text-transform:uppercase;' : '');

  const rule = `<tr><td style="padding:0;"><div style="height:1px;line-height:1px;font-size:0;background-color:${RULE};">&nbsp;</div></td></tr>`;

  /* Vertical rhythm taken off the brand lockup rather than chosen here. On its
     artboard the diamond stands 443 units, the gap under it is 119.75 and the
     gap under the name is 53.25 — so at a 68px mark those are 18 and 8, and the
     header stacks in the brand's own proportions instead of ones invented for
     an email. Spacer rows rather than margins: Word ignores margin on a div. */
  const MARK = 68;
  const gap = (h) => `<div style="height:${h}px;line-height:${h}px;font-size:0;">&nbsp;</div>`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="dark" />
<meta name="supported-color-schemes" content="dark" />
<title>Thank you for reaching out</title>
</head>
<body style="margin:0;padding:0;width:100%;background-color:${INK};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${INK};mso-hide:all;">Your message has reached VIDIKA. Every connection can open new possibilities — we&#39;ll be in touch soon.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${INK}" style="background-color:${INK};border-collapse:collapse;">
<tr>
<td align="center" style="padding:40px 16px;">
<!--[if mso]>
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td>
<![endif]-->
<!-- Fluid, capped at 600. A fixed width here is what clips the card on a
     phone, and phones are where most of this mail is opened; max-width alone
     is not enough, because the width attribute would still pin it. Word is the
     one engine that honours neither, so it gets the fixed 600 above and never
     sees this table's own width. -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;margin:0 auto;border-collapse:collapse;background-color:${CARD};border:1px solid ${EDGE};">
<tr>
<td style="padding:44px 32px 36px;" align="center">

<img src="https://vidika.co/email-mark.png" width="${MARK}" height="${MARK}" alt="" style="display:block;width:${MARK}px;height:${MARK}px;border:0;outline:none;text-decoration:none;" />

${gap(18)}

<div style="${tracked(24, 0.42, GOLD, { weight: '300' })}line-height:1.2;">VIDIKA</div>

${gap(8)}

<div style="${tracked(10, 0.3, GOLD)}line-height:1.4;">Creative Origins</div>

</td>
</tr>
${rule}
<tr>
<td style="padding:38px 32px 40px;" align="center">

<div style="font-family:${SERIF};font-size:24px;line-height:1.35;color:${BONE};">Thank you for reaching out.</div>

${gap(20)}

<!-- Broken by hand, at the em dash where the sentence turns anyway. Left to
     wrap, the last line landed wherever the client's serif happened to run
     out — after "we'll" in one, orphaning "soon." in another — and there is no
     font to measure against here, because whichever serif answers the stack is
     the reader's and not ours. Authored breaks are the only ones that hold in
     every client, and they cost nothing: on a phone the lines simply wrap
     again underneath them. Nothing constrains this to a measure, because a
     fixed inner width is a floor the card cannot shrink past. -->
<div style="font-family:${SERIF};font-size:17px;line-height:1.7;color:${SOFT};">Your message has reached VIDIKA.<br />Every connection can open new possibilities —<br />we&#39;ll be in touch soon.</div>

</td>
</tr>
${rule}
<tr>
<td style="padding:22px 32px 24px;" align="center">
<div style="${tracked(12, 0.04, DIM, { caps: false })}line-height:1.6;"><a href="mailto:studio@vidika.co" style="color:${DIM};text-decoration:none;">studio@vidika.co</a> &middot; <a href="https://vidika.co" style="color:${DIM};text-decoration:none;">vidika.co</a></div>
</td>
</tr>
</table>
<!--[if mso]>
</td></tr></table>
<![endif]-->
</td>
</tr>
</table>
</body>
</html>`;

  return {
    from: CONFIG.mail.from,
    to: { name, address: email },
    /* Answers come back to the studio mailbox, not to a no-reply nobody
       reads — a visitor who replies to this is still talking to VIDIKA. */
    replyTo: CONFIG.mail.to,
    subject: 'Thank you for reaching out',
    text,
    html,
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
