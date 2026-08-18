/**
 * Content-stamped URLs for the social card.
 *
 * Facebook, LinkedIn, Slack and the rest fetch an og:image once and then keep
 * it, keyed on the URL and nothing else. Ship a new card at the same path and a
 * link that has ever been shared goes on showing the old one — for weeks, and
 * on some platforms until somebody logs into a debugger and forces a re-scrape.
 * Sites usually answer that with a version number somebody has to remember to
 * bump, which fails the first time somebody forgets.
 *
 * So the version is the file. Eight hex digits of the card's own bytes, added
 * as a query, which is a different URL to every cache the moment the artwork
 * changes and the same URL for as long as it doesn't. Nothing to remember, and
 * no way for the stamp and the file to disagree.
 *
 * This is build-time work: the site is statically rendered, so the hash is
 * computed while the pages are being written and what ships is a plain string.
 * The server strips the query before it looks for the file (server/index.mjs),
 * and so does every static host, so the asset still resolves.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The project root, and not a path derived from this module's own location:
 * Vite bundles this file before it runs, so `import.meta.url` here points at a
 * build chunk rather than at src/, and public/ is nowhere near it. Both `astro
 * dev` and `astro build` are run from the project root — that is where the
 * config is looked up — so the working directory is the one thing that means
 * the same in the source tree and in the bundle.
 */
const PUBLIC_DIR = join(process.cwd(), 'public');

/** One read per asset per build, however many pages ask for it. */
const stamped = new Map<string, string>();

/**
 * `/og.png` → `/og.png?v=1a2b3c4d`.
 *
 * Anything that isn't a plain site-absolute path is handed back untouched. So
 * is a path with no file behind it — but loudly, because an unstamped card is
 * indistinguishable from a stamped one in the markup, and the whole point of
 * this is to be working without anyone checking. A warning is the right weight:
 * the page is still correct, so failing the build would be out of proportion,
 * and staying silent is how this ships broken.
 */
export function contentStamped(path: string): string {
  if (!path.startsWith('/') || path.includes('?')) return path;

  const cached = stamped.get(path);
  if (cached) return cached;

  let result = path;
  try {
    const bytes = readFileSync(join(PUBLIC_DIR, path));
    result = `${path}?v=${createHash('sha256').update(bytes).digest('hex').slice(0, 8)}`;
  } catch (error) {
    console.warn(
      `[og] could not stamp ${path} — social caches will keep serving whatever ` +
        `they fetched first. Looked in ${PUBLIC_DIR}. ${(error as Error).message}`,
    );
  }

  stamped.set(path, result);
  return result;
}
