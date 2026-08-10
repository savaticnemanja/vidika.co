/**
 * All page motion that CSS can't express on its own:
 * section tracking, scroll progress, pointer parallax and magnetic buttons.
 *
 * Everything degrades cleanly — if this never runs, the page is still fully
 * readable and navigable (reveal states are scoped to .js in global.css).
 */

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = window.matchMedia('(pointer: fine)');

/** Runs `fn` at most once per frame. */
function onFrame<T extends unknown[]>(fn: (...args: T) => void) {
  let frame = 0;
  let latest: T;
  return (...args: T) => {
    latest = args;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      fn(...latest);
    });
  };
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/* ── Section tracking ─────────────────────────────────────────────── */

function initSections(scroller: HTMLElement) {
  const panels = Array.from(scroller.querySelectorAll<HTMLElement>('[data-panel]'));
  if (!panels.length) return;

  const railLinks = new Map<string, HTMLAnchorElement>();
  document.querySelectorAll<HTMLAnchorElement>('[data-rail-link]').forEach((link) => {
    railLinks.set(link.dataset.railLink ?? '', link);
  });

  // Reveals latch on: snapping back and forth shouldn't replay them.
  const reveal = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-inview');
        reveal.unobserve(entry.target);
      }
    },
    { root: scroller, threshold: 0.2 },
  );

  const active = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const id = (entry.target as HTMLElement).dataset.panel;
        if (!id) continue;

        document.body.dataset.section = id;

        for (const [key, link] of railLinks) {
          if (key === id) link.setAttribute('aria-current', 'true');
          else link.removeAttribute('aria-current');
        }
      }
    },
    { root: scroller, threshold: 0.5 },
  );

  for (const panel of panels) {
    reveal.observe(panel);
    active.observe(panel);
  }
}

/* ── Scroll progress ──────────────────────────────────────────────── */

function initProgress(scroller: HTMLElement) {
  const rail = document.querySelector<HTMLElement>('.rail__progress');
  if (!rail) return;

  const update = onFrame(() => {
    const travel = scroller.scrollHeight - scroller.clientHeight;
    const ratio = travel > 0 ? scroller.scrollTop / travel : 0;
    rail.style.setProperty('--progress', clamp(ratio, 0, 1).toFixed(4));
  });

  scroller.addEventListener('scroll', update, { passive: true });
  update();
}

/* ── Pointer atmosphere ───────────────────────────────────────────── */

/**
 * Only the ambient spotlight tracks the cursor — no element is ever moved by
 * pointer position. The names are deliberately namespaced: these inherit down
 * the whole tree, so a generic `--mx` here would silently feed any component
 * that happened to use the same name.
 */
function initPointer() {
  if (reduceMotion.matches || !finePointer.matches) return;

  document.documentElement.classList.add('has-pointer');
  const root = document.documentElement;

  const update = onFrame((event: PointerEvent) => {
    const { innerWidth: w, innerHeight: h } = window;
    root.style.setProperty('--pointer-x', ((event.clientX / w) * 100).toFixed(2));
    root.style.setProperty('--pointer-y', ((event.clientY / h) * 100).toFixed(2));
  });

  window.addEventListener('pointermove', update, { passive: true });
}

/* ── Boot ─────────────────────────────────────────────────────────── */

export function initMotion() {
  const scroller = document.querySelector<HTMLElement>('.scroller');
  if (!scroller) return;

  document.body.dataset.section = 'origin';

  initSections(scroller);
  initProgress(scroller);
  initPointer();
}
