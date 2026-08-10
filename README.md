# vidika.co

Single-page site for VIDIKA — a creative studio. Three full-viewport panels
(Origin · About · Contact) locked to a native scroll-snap rail.

Built with [Astro](https://astro.build) 7. No UI framework, no animation
library — the whole page ships **~5 KB of JavaScript** and no images
(every mark is inline SVG drawn from the brand vectors).

## Commands

| Command              | Does                                              |
| -------------------- | ------------------------------------------------- |
| `npm install`        | Install dependencies                              |
| `npm run dev`        | Dev server at `localhost:4321`                    |
| `npm run build`      | Production build into `dist/`                     |
| `npm run preview`    | Serve the built site locally                      |
| `npm run check`      | Astro + TypeScript diagnostics                    |
| `npm run gen:assets` | Regenerate favicons + OG image from `assets/`     |

## Before going live

Everything that needs real data lives in **`src/site.config.ts`** — search it
for `TODO`. Nothing else in the codebase hardcodes these values.

1. **Social URLs** — LinkedIn, IMDb and Instagram currently point at
   placeholder profiles.
2. **MIMOLAND destination** — `ABOUT.cta.href` is `'#'`, which renders the
   button in a dashed "Coming soon" state rather than as a dead link. Set a
   real URL (and `external: true` if it leaves the site) to activate it.
3. **Contact endpoint** — copy `.env.example` to `.env` and set
   `PUBLIC_CONTACT_ENDPOINT`. Until you do, the form falls back to opening the
   visitor's mail client. See `.env.example` for the payload shape.

## How it works

### Scroll lock

Native CSS scroll snapping, not wheel hijacking:

```css
.scroller { scroll-snap-type: y mandatory; }
.panel    { scroll-snap-align: start; scroll-snap-stop: always; }
```

Because the browser still owns the scroll, trackpad momentum, keyboard paging,
find-in-page and screen readers all keep working. `<body>` is `overflow: hidden`
and an inner `.scroller` does the scrolling, which also stops mobile browser
chrome from collapsing mid-scroll and resizing every snap point.

The lock relaxes to `proximity` under 620px of viewport height so a landscape
phone can never strand content off-screen.

### Theme

Two colours: the logo gold `#b78937` and the brand navy `#122238`.

The navy anchors a single ink ramp — the page ground `--ink-900` is a deeper
shade of it, `#122238` itself surfaces as the field fill and the drifting
background blobs, and `--ink-600` is the lifted hover tone. Gold is the only
accent, carrying every rule, border, focus ring and active state. Text is a
warm bone, which holds the same warm/cool tension against the navy as the gold.

Changing either colour means editing `--gold` / `--blob` and the `--ink-*`
ramp in `src/styles/tokens.css`, plus `GOLD` / `INK` / `NAVY` in
`scripts/generate-assets.mjs` if you want the icons and OG card to follow.

### Motion

All timing, easing and colour lives in `src/styles/tokens.css`. Animations are
multiplied by a `--motion` token that `prefers-reduced-motion` sets to `0`, so
one media query neutralises the whole system.

Highlights:

- **Intro** — the diamond assembles from its eight brand chevrons, each flying
  in from its own side, then a hairline frame draws itself around it.
- **Wordmark** — letters rise in sequence, then a gold sheen sweeps across them
  on a long loop (clipped to the letterforms, so it reads as light on metal).
- **Reveals** — headings clip upward, body copy uses an animated `mask-image`
  wipe (via a registered `@property`), rules scale out from centre.
- **Pointer** — an ambient spotlight follows the cursor, gated behind
  `(pointer: fine)`. Nothing else moves with the pointer: the hero lockup and
  the MIMOLAND CTA stay pinned by design. The spotlight writes
  `--pointer-x` / `--pointer-y` on `:root` — namespaced deliberately, since
  root-level custom properties inherit into every component.
- **Form** — floating labels, deco corner ticks that snap in on focus, and a
  submit state machine (idle → sending → sent) with a drawn checkmark.

Reveal *hiding* is scoped to `.js`, set by an inline head script. If JavaScript
fails, every element renders in its final visible state instead of staying
invisible forever.

### Accessibility

- axe-core: **0 violations** across the homepage and 404.
- Contrast measured against real rendered pixels (blobs, vignette and grain
  composited in, sampled at the lightest background pixel behind each element):
  every text element lands between **5.2:1 and 14:1**, all passing WCAG AA.
  The tightest is the gold "Explore our first IP" at 5.2:1.
- Skip link, landmark regions, a focusable scroll container with an accessible
  name, and a single consistent gold focus ring.
- The form links errors with `aria-describedby`/`aria-invalid`, moves focus to
  the first invalid field, and announces status through `role="status"`.
  Untouched fields are never marked red just for being tabbed through.
- No layout shift when validation messages appear — the space is reserved.

### SEO

Canonical URLs, Open Graph + Twitter card metadata, and a JSON-LD `@graph`
(`Organization` + `WebSite`) are generated in `src/components/Seo.astro` from
`site.config.ts`. `sitemap-index.xml` and `robots.txt` are produced at build.

Icons and the 1200×630 OG card are generated from the brand vectors by
`scripts/generate-assets.mjs` — rerun it if the artwork in `assets/` changes.

## Layout

```
src/
  site.config.ts     all copy, links and metadata (start here)
  styles/            tokens.css (design system) + global.css (reset, snap, reveals)
  layouts/Base.astro <head>, fonts, ambient background
  components/        Hero · About · Contact + chrome and brand marks
  scripts/           motion.ts (observers, parallax) · form.ts (validation, submit)
scripts/
  generate-assets.mjs favicon/OG generation from assets/
assets/               source brand vectors (not shipped)
```
