/**
 * The built site, served off disk.
 *
 * `dist/` is a folder of static files, and in the container it sits next to
 * this process rather than behind a second web server: one image, one port,
 * one thing for nginx to proxy. Everything mutable about a request — caching,
 * compression, TLS — is either decided here by content type or left to the
 * proxy in front, which is better at it.
 *
 * Disabled by returning null when there is no `dist/` to serve, so the handler
 * still runs on its own as a bare API during development.
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, normalize, resolve, sep, extname } from 'node:path';

/**
 * Content types for everything an Astro build emits. Anything not listed is
 * sent as a download rather than guessed at — a wrong type is worse than no
 * type, since `nosniff` means the browser will not second-guess it.
 */
const TYPES = new Map(
  Object.entries({
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
  }),
);

/**
 * How long each kind of file may be held.
 *
 * Astro fingerprints everything under `_astro/`, so those names change
 * whenever their contents do and can be cached permanently. Nothing else is
 * fingerprinted: the fonts and icons are stable but not immune to being
 * replaced under the same name, so they get a month rather than a year and
 * `immutable` is withheld — an immutable response cannot be revalidated, only
 * waited out. HTML is always revalidated, which is what makes a deploy visible
 * without a hard refresh.
 */
function cacheControl(urlPath, ext) {
  if (urlPath.startsWith('/_astro/')) return 'public, max-age=31536000, immutable';
  if (ext === '.html') return 'public, max-age=0, must-revalidate';
  if (ext === '.woff2' || ext === '.woff') return 'public, max-age=2592000';
  return 'public, max-age=3600';
}

/** Cheap, stable, and changes whenever the file does. */
function etagFor(stats) {
  return `W/"${stats.size.toString(16)}-${stats.mtimeMs.toString(16)}"`;
}

/**
 * URL path → absolute file path, or null if the request has no business
 * reaching the filesystem.
 *
 * The guard is the last line here: `normalize` collapses any `..` the request
 * managed to smuggle through decoding, and the prefix test then proves the
 * result is still inside the root. Checking the decoded string for '..'
 * instead would be the usual mistake — it misses encodings that only become
 * traversal after normalisation.
 */
function toFilePath(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }

  // A NUL can truncate the path inside a syscall, so it never gets that far.
  if (decoded.includes('\0')) return null;

  const candidate = resolve(join(root, normalize(decoded)));
  if (candidate !== root && !candidate.startsWith(root + sep)) return null;
  return candidate;
}

/** The file a URL actually means, following Astro's directory-index layout. */
async function resolveFile(root, urlPath) {
  const base = toFilePath(root, urlPath);
  if (!base) return null;

  // A file, exactly as asked for: /favicon.ico, /_astro/index.abc123.css
  try {
    const stats = await stat(base);
    if (stats.isFile()) return { path: base, stats };

    // A directory: the page is the index.html inside it. This is what makes
    // /privacy-notice resolve, since Astro writes it as a directory.
    if (stats.isDirectory()) {
      const index = join(base, 'index.html');
      const indexStats = await stat(index);
      if (indexStats.isFile()) return { path: index, stats: indexStats };
    }
  } catch {
    /* falls through to the 404 the caller renders */
  }

  return null;
}

function sendFile(req, res, file, urlPath, status = 200) {
  const ext = extname(file.path).toLowerCase();
  const type = TYPES.get(ext) ?? 'application/octet-stream';
  const etag = etagFor(file.stats);

  const headers = {
    'Content-Type': type,
    'Content-Length': file.stats.size,
    'Cache-Control': cacheControl(urlPath, ext),
    'Last-Modified': file.stats.mtime.toUTCString(),
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
  };

  // Revalidation. The proxy and the browser both send this back once they have
  // a copy; answering 304 saves re-sending a font on every page view.
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, 'Cache-Control': headers['Cache-Control'] });
    res.end();
    return;
  }

  res.writeHead(status, headers);

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  const stream = createReadStream(file.path);
  stream.on('error', () => res.destroy());
  // A visitor who navigates away mid-download leaves a stream with nowhere to
  // go; without this the file handle stays open until GC gets to it.
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

/**
 * Builds the handler, or returns null if `root` is not a directory — which is
 * the normal case when running the API alone against `astro dev`.
 *
 * The returned function answers true if it dealt with the request.
 */
export async function createStaticHandler(root) {
  const dir = resolve(root);

  try {
    if (!(await stat(dir)).isDirectory()) return null;
  } catch {
    return null;
  }

  // Rendered for anything that doesn't resolve, so a mistyped URL gets the
  // site's own 404 rather than a bare string.
  const notFoundPath = join(dir, '404.html');

  return async function serveStatic(req, res, urlPath) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Length': 0 });
      res.end();
      return true;
    }

    // astro.config sets trailingSlash: 'never', so the slashed form is a
    // different URL for the same page. Redirect rather than serve both, or
    // every page has two addresses competing in search results.
    if (urlPath.length > 1 && urlPath.endsWith('/')) {
      const target = urlPath.replace(/\/+$/, '') || '/';
      res.writeHead(308, { Location: target, 'Content-Length': 0 });
      res.end();
      return true;
    }

    const file = await resolveFile(dir, urlPath === '/' ? '/index.html' : urlPath);

    if (file) {
      sendFile(req, res, file, urlPath);
      return true;
    }

    try {
      const stats = await stat(notFoundPath);
      sendFile(req, res, { path: notFoundPath, stats }, '/404.html', 404);
    } catch {
      const body = 'Not found.';
      res.writeHead(404, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      });
      res.end(body);
    }

    return true;
  };
}
