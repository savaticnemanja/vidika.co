/**
 * Generates every raster brand asset from the source vectors.
 *
 *   node scripts/generate-assets.mjs
 *
 * Outputs into public/: favicon.svg, favicon.ico, apple-touch-icon.png,
 * icon-192.png, icon-512.png, icon-maskable-512.png, og.png.
 *
 * Re-run this whenever the brand vectors in assets/ change.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');

/* The two theme colours: the logo gold and the brand navy ground. */
const GOLD = '#b78937';
const INK = '#0a131f';
const NAVY = '#122238';

const SRC = {
  symbol: join(root, 'assets/VIDIKA_SYMBOL/SVG/VIDIKA_SYMBOL_GOLD_RGB_WEB.svg'),
  fullLogo: join(root, 'assets/VIDIKA_FULL_LOGO/SVG/VIDIKA_FULL_LOGO_GOLD_RGB_WEB.svg'),
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

/** Square icon: gold symbol on ink, optionally rounded. */
async function iconSvg({ size, inset, radius }) {
  const shapes = await shapesOf(SRC.symbol);
  const transform = fitTransform(BOUNDS.symbol, size, size, inset);
  const rect =
    radius > 0
      ? `<rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="${INK}"/>`
      : `<rect width="${size}" height="${size}" fill="${INK}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <style>.cls-1{fill:${GOLD}}</style>
  ${rect}
  <g transform="${transform}">${shapes}</g>
</svg>`;
}

/** Open Graph / Twitter card: 1200×630, full lockup inside a deco double rule. */
async function ogSvg() {
  const W = 1200;
  const H = 630;
  const shapes = await shapesOf(SRC.fullLogo);
  const transform = fitTransform(BOUNDS.fullLogo, W, H, 0.14);
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
  <rect x="28" y="28" width="${W - 56}" height="${H - 56}" fill="none" stroke="${GOLD}" stroke-opacity="0.5" stroke-width="1.5"/>
  <rect x="36" y="36" width="${W - 72}" height="${H - 72}" fill="none" stroke="${GOLD}" stroke-opacity="0.22" stroke-width="1"/>
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

  // Scalable favicon — rounded so it reads as a mark in the tab strip.
  const faviconSvg = await iconSvg({ size: 512, inset: 0.14, radius: 96 });
  await writeFile(join(pub, 'favicon.svg'), faviconSvg);

  // Legacy .ico for bookmarks and older clients.
  const icoSource = await iconSvg({ size: 256, inset: 0.1, radius: 0 });
  const icoSizes = [16, 32, 48];
  const icoPngs = await Promise.all(
    icoSizes.map(async (size) => ({ size, data: await png(icoSource, size) })),
  );
  await writeFile(join(pub, 'favicon.ico'), buildIco(icoPngs));

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

  // Social card.
  await sharp(Buffer.from(await ogSvg()))
    .png({ compressionLevel: 9 })
    .toFile(join(pub, 'og.png'));

  console.log('Generated icons + og.png into public/');
}

await main();
