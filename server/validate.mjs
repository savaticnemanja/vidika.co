/**
 * Server-side validation.
 *
 * Deliberately mirrors the rules in src/scripts/form.ts — the client copy is
 * there for the visitor's benefit, this one is the only copy that counts. The
 * messages match too, so a hand-crafted POST gets the same wording the form
 * would have shown.
 */

import { CONFIG, LIMITS } from './config.mjs';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Collapses whitespace, so a name can never smuggle CR/LF into a header. */
function oneLine(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function asString(value) {
  return typeof value === 'string' ? value : '';
}

/**
 * @returns {{ ok: true, data: object } | { ok: false, status: number, error: string, silent?: boolean }}
 */
export function validate(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, status: 400, error: 'Malformed submission.' };
  }

  // Honeypot. A bot that filled the invisible field gets a cheerful 200 —
  // telling it why it failed only helps it try again.
  if (asString(payload.company).trim()) {
    return { ok: false, status: 200, error: '', silent: true };
  }

  const name = oneLine(asString(payload.name));
  const email = oneLine(asString(payload.email)).toLowerCase();
  const message = asString(payload.message).trim();

  if (!name) return { ok: false, status: 422, error: 'Please tell us your name.' };
  if (name.length < 2) {
    return { ok: false, status: 422, error: 'That name looks a little short.' };
  }
  if (name.length > LIMITS.name) {
    return { ok: false, status: 422, error: 'That name is longer than we can accept.' };
  }

  if (!email) {
    return { ok: false, status: 422, error: 'We need an email address to reply to.' };
  }
  if (!EMAIL.test(email) || email.length > LIMITS.email) {
    return { ok: false, status: 422, error: 'That email address doesn’t look right.' };
  }

  if (!message) return { ok: false, status: 422, error: 'Please write us a message.' };
  if (message.length < 10) {
    return { ok: false, status: 422, error: 'A few more words would help.' };
  }
  if (message.length > LIMITS.message) {
    return {
      ok: false,
      status: 422,
      error: `Please keep the message under ${LIMITS.message} characters.`,
    };
  }

  // How long the form was open. The browser sends it as a string; accept a
  // number too, so a hand-rolled client isn't quietly exempted from the
  // speed check. Absent or unparseable is treated as fine — only an
  // implausibly fast fill is held against the sender, and that one also gets
  // a silent 200 rather than a hint.
  const raw = payload.elapsedMs;
  const parsed =
    typeof raw === 'number' && Number.isFinite(raw)
      ? Math.trunc(raw)
      : Number.parseInt(asString(raw), 10);
  const elapsed = Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  if (elapsed !== null && elapsed < CONFIG.minElapsedMs) {
    return { ok: false, status: 200, error: '', silent: true };
  }

  return { ok: true, data: { name, email, message, elapsedMs: elapsed } };
}
