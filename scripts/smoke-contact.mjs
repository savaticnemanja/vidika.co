/**
 * End-to-end check of the contact endpoint, wherever it is running.
 *
 *   node scripts/smoke-contact.mjs                            # npm run serve
 *   node scripts/smoke-contact.mjs https://vidika.co          # live
 *   node scripts/smoke-contact.mjs http://127.0.0.1:8080      # the container
 *   node scripts/smoke-contact.mjs http://127.0.0.1:8787 \
 *     --origin http://localhost:4321                          # against astro dev
 *
 * Sends one real submission, then confirms the guards bite. The two spam cases
 * answer 200 by design — a bot is told nothing — so their real proof is in the
 * logs: exactly one of these five requests should produce an email.
 *
 * The handler allows five submissions per IP per ten minutes, so a third run
 * in quick succession will start coming back 429. That is the limiter working,
 * not a failure.
 */

const args = process.argv.slice(2);
const base = (args.find((arg) => !arg.startsWith('--')) ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const originFlag = args.indexOf('--origin');
const origin = originFlag !== -1 ? args[originFlag + 1] : 'https://vidika.co';

const url = `${base}/api/contact`;

const valid = {
  name: 'Smoke Test',
  email: 'smoke@example.com',
  message: 'This is a smoke test of the vidika.co contact endpoint. Please ignore.',
  elapsedMs: 12_000,
};

let passed = 0;
let failed = 0;
let skipped = 0;

async function post(label, body, expected) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(body),
  });

  const text = await response.text();

  if (response.status === 429 && expected !== 429) {
    skipped += 1;
    console.log(`~ ${label} — 429, rate-limited before it could be checked`);
    return;
  }

  if (response.status === expected) {
    passed += 1;
    console.log(`✓ ${label} — ${response.status} ${text}`);
  } else {
    failed += 1;
    console.log(`✗ ${label} — ${response.status} (expected ${expected}) ${text}`);
  }
}

console.log(`→ ${url}  (Origin: ${origin})\n`);

await post('valid submission → delivered', valid, 200);
await post('honeypot filled → silently discarded', { ...valid, company: 'Acme' }, 200);
await post('filled too fast → silently discarded', { ...valid, elapsedMs: 400 }, 200);
await post('bad email → refused', { ...valid, email: 'nope' }, 422);
await post('short message → refused', { ...valid, message: 'hi' }, 422);

console.log(
  `\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} rate-limited` : ''}`,
);
process.exit(failed ? 1 : 0);
