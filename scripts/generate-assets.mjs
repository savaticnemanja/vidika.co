/**
 * Generates every raster brand asset from the source vectors.
 *
 *   node scripts/generate-assets.mjs
 *
 * Outputs into public/: favicon.svg, favicon-96.png, favicon.ico,
 * apple-touch-icon.png, icon-192.png, icon-512.png, icon-maskable-512.png,
 * og.png, email-mark.png — all committed, so this only runs when the artwork
 * changes.
 *
 * The two source vectors live in brand/ beside this script, under the names
 * they carry in the brand package. They are the gold-on-transparent web cuts
 * of the symbol and the full lockup; the rest of that package — the other
 * colourways, and the AI/PDF/PNG masters — is not kept in this repo.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const pub = join(root, 'public');

/* The two theme colours: the logo gold and the brand navy ground. */
const GOLD = '#b78937';
const INK = '#0a131f';
const NAVY = '#122238';

const SRC = {
  symbol: join(here, 'brand/VIDIKA_SYMBOL_GOLD_RGB_WEB.svg'),
  fullLogo: join(here, 'brand/VIDIKA_FULL_LOGO_GOLD_RGB_WEB.svg'),
};

/** Tight content bounds measured from the source vectors (viewBox 0 0 1300 1300). */
const BOUNDS = {
  symbol: { x: 243.68, y: 248.92, w: 801.97, h: 802.31 },
  fullLogo: { x: 225.9, y: 274.8, w: 860, h: 755 },
};

/** Strips the wrapper <svg> and <defs> so the shapes can be re-composed. */
async function shapesOf(path) {
  const raw = await readFile(path, 'utf8');
  const withoutHead = raw.replace(/^[\s\S]*?<\/defs>/, '');
  return withoutHead.replace(/<\/svg>\s*$/, '').trim();
}

/**
 * Fits a source bounding box into a target box and returns the SVG transform.
 * `inset` is the fraction of the target box left empty around the content.
 */
function fitTransform(bounds, boxW, boxH, inset = 0) {
  const availW = boxW * (1 - inset * 2);
  const availH = boxH * (1 - inset * 2);
  const scale = Math.min(availW / bounds.w, availH / bounds.h);
  const drawW = bounds.w * scale;
  const drawH = bounds.h * scale;
  const tx = (boxW - drawW) / 2 - bounds.x * scale;
  const ty = (boxH - drawH) / 2 - bounds.y * scale;
  return `translate(${tx.toFixed(3)} ${ty.toFixed(3)}) scale(${scale.toFixed(6)})`;
}

/**
 * Square icon: the gold symbol, on ink or on nothing.
 *
 * `ground: false` leaves the background transparent, so the mark sits on
 * whatever the client paints behind it — a browser tab strip, light or dark.
 */
async function iconSvg({ size, inset, radius, ground = true }) {
  const shapes = await shapesOf(SRC.symbol);
  const transform = fitTransform(BOUNDS.symbol, size, size, inset);
  const rect = !ground
    ? ''
    : radius > 0
      ? `<rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="${INK}"/>`
      : `<rect width="${size}" height="${size}" fill="${INK}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <style>.cls-1{fill:${GOLD}}</style>
  ${rect}
  <g transform="${transform}">${shapes}</g>
</svg>`;
}

/**
 * Open Graph / Twitter card: 1200×630, the full lockup inside a deco frame.
 *
 * Everything that carries meaning is stacked down the middle. That is not a
 * taste: a shared link is re-cropped by whoever renders it — 2:1 on Twitter,
 * a centre square in a chat preview, a small tile in a search result — and a
 * centred lockup is the only composition that survives all of them. The frame
 * is what is allowed to be cut.
 *
 * The four corners carry the brand's own shape rather than an ornament. The
 * VIDIKA symbol is eight chevrons holding the corners of a diamond they never
 * close, and the section rail on the site marks its stops with that diamond
 * filled in; the card is pinned at its corners with the same mark. It also
 * solves a thumbnail problem — a pair of hairlines alone all but disappears
 * once a card is rendered 500px wide, and four points of solid gold do not.
 */
async function ogSvg() {
  const W = 1200;
  const H = 630;

  /* The frame. Two rules 9 apart, far enough in that a 2:1 crop — 15 off the
     top and bottom — still leaves both of them whole. */
  const F = 30;
  const F2 = F + 9;
  /* Point-to-point radius of the corner diamonds, on the outer rule. */
  const R = 7;

  const shapes = await shapesOf(SRC.fullLogo);
  const transform = fitTransform(BOUNDS.fullLogo, W, H, 0.135);

  /** The mark's diamond, as a solid, centred on a corner of the outer rule. */
  const diamond = (x, y) => `<path d="M${x},${y - R} L${x + R},${y} L${x},${y + R} L${x - R},${y} Z" />`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <style>.cls-1{fill:${GOLD}}</style>
  <defs>
    <radialGradient id="halo" cx="50%" cy="42%" r="62%">
      <stop offset="0%" stop-color="${NAVY}"/>
      <stop offset="100%" stop-color="${INK}"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="${INK}"/>
  <rect width="${W}" height="${H}" fill="url(#halo)"/>
  <rect x="${F}" y="${F}" width="${W - F * 2}" height="${H - F * 2}" fill="none" stroke="${GOLD}" stroke-opacity="0.45" stroke-width="1.5"/>
  <rect x="${F2}" y="${F2}" width="${W - F2 * 2}" height="${H - F2 * 2}" fill="none" stroke="${GOLD}" stroke-opacity="0.2" stroke-width="1"/>
  <g fill="${GOLD}" fill-opacity="0.9">
    ${diamond(F, F)}
    ${diamond(W - F, F)}
    ${diamond(F, H - F)}
    ${diamond(W - F, H - F)}
  </g>
  <g transform="${transform}">${shapes}</g>
</svg>`;
}

/** Packs PNG buffers into an .ico container (PNG-in-ICO, universally supported). */
function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);

  let offset = 6 + pngs.length * 16;
  const entries = [];
  for (const { size, data } of pngs) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += data.length;
  }

  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

async function png(svg, size) {
  return sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
}

async function main() {
  await mkdir(pub, { recursive: true });

  /* Browser favicons carry no ground of their own: the bare symbol, sized to
     fill the tab, so it reads as the mark rather than as a navy tile. Every
     format below is the same artwork, so the tab looks identical whichever
     one a given browser reaches for. */

  // Scalable favicon — what every current browser actually uses.
  const faviconSvg = await iconSvg({ size: 512, inset: 0.02, radius: 0, ground: false });
  await writeFile(join(pub, 'favicon.svg'), faviconSvg);

  // Raster favicon for clients that don't take SVG.
  await writeFile(join(pub, 'favicon-96.png'), await png(faviconSvg, 96));

  // Legacy .ico for bookmarks and older clients.
  const icoSizes = [16, 32, 48];
  const icoPngs = await Promise.all(
    icoSizes.map(async (size) => ({ size, data: await png(faviconSvg, size) })),
  );
  await writeFile(join(pub, 'favicon.ico'), buildIco(icoPngs));

  /* Installed-app icons keep the ink ground: iOS composites a transparent
     home-screen icon onto black, and a maskable icon must fill its whole
     safe zone — neither survives being cut out. */

  // iOS home screen — opaque, no rounding (iOS masks it itself).
  const touchSvg = await iconSvg({ size: 512, inset: 0.16, radius: 0 });
  await writeFile(join(pub, 'apple-touch-icon.png'), await png(touchSvg, 180));

  // PWA icons.
  const pwaSvg = await iconSvg({ size: 512, inset: 0.14, radius: 0 });
  await writeFile(join(pub, 'icon-192.png'), await png(pwaSvg, 192));
  await writeFile(join(pub, 'icon-512.png'), await png(pwaSvg, 512));

  // Maskable needs its content inside the central 80% safe zone.
  const maskableSvg = await iconSvg({ size: 512, inset: 0.26, radius: 0 });
  await writeFile(join(pub, 'icon-maskable-512.png'), await png(maskableSvg, 512));

  /* The mark for the contact auto-reply. No mail client renders SVG, so the
     one vector the rest of the site uses has to become a raster here — the
     same cut as the favicon, transparent, at four times the 60px it is placed
     at so it stays sharp on a retina screen. Transparent rather than on ink
     because a few clients paint their own ground behind an image, and gold
     holds up on either. */
  await writeFile(join(pub, 'email-mark.png'), await png(faviconSvg, 240));

  // Social card.
  await sharp(Buffer.from(await ogSvg()))
    .png({ compressionLevel: 9 })
    .toFile(join(pub, 'og.png'));

  console.log('Generated icons + og.png into public/');
}

await main();
