/**
 * The no-JavaScript reply.
 *
 * The form carries a real method and action, so if form.ts never loads the
 * browser submits it natively — as urlencoded fields, expecting a document
 * back, not JSON. This is that document: the site's two colours, a line of
 * copy, and a way back to the page.
 */

import { CONFIG } from './config.mjs';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

/** Where "back to the site" points — the first allowed origin is the canonical one. */
const site = CONFIG.allowedOrigins[0] ?? 'https://vidika.co';

export function renderPage({ ok, heading, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${escapeHtml(heading)} — VIDIKA</title>
<style>
  :root { color-scheme: dark; }
  body {
    display: grid;
    place-content: center;
    min-height: 100dvh;
    margin: 0;
    padding: 2rem;
    background: #0f1a29;
    color: #efe7d9;
    font-family: system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
    text-align: center;
  }
  main { max-width: 30rem; }
  h1 {
    margin: 0 0 .35rem;
    font-size: 1.05rem;
    font-weight: 300;
    letter-spacing: .22em;
    text-transform: uppercase;
    color: ${ok ? '#d6a44f' : '#e2917f'};
  }
  hr {
    width: 4.5rem;
    height: 1px;
    margin: 1.25rem auto;
    border: 0;
    background: linear-gradient(to right, transparent, #b78937, transparent);
  }
  p { margin: 0; font-size: 1rem; line-height: 1.7; color: #cfc4b2; }
  a { color: #d6a44f; }
  a.back {
    display: inline-block;
    margin-top: 1.75rem;
    padding: .7rem 1.6rem;
    font-size: .8rem;
    letter-spacing: .18em;
    text-transform: uppercase;
    text-decoration: none;
    border: 1px solid rgba(183,137,55,.5);
    border-radius: 2px;
  }
  a.back:hover, a.back:focus-visible { background: #b78937; color: #0a131f; }
</style>
</head>
<body>
  <main>
    <h1>${escapeHtml(heading)}</h1>
    <hr />
    <p>${body}</p>
    <a class="back" href="${escapeHtml(site)}/#contact">Back to VIDIKA</a>
  </main>
</body>
</html>`;
}

export function successPage() {
  return renderPage({
    ok: true,
    heading: 'Message sent',
    body: 'Thank you — your message is on its way. We will reply to the address you gave us.',
  });
}

export function errorPage(message) {
  const to = escapeHtml(CONFIG.mail.to);
  return renderPage({
    ok: false,
    heading: 'Not sent',
    body: `${escapeHtml(message)} You can also email us directly at <a href="mailto:${to}">${to}</a>.`,
  });
}
