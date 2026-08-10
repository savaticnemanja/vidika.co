/**
 * Single source of truth for site copy, links and metadata.
 *
 * ── VALUES THAT STILL NEED REAL DATA ──────────────────────────────────
 * Anything marked TODO is a placeholder. Search this file for "TODO"
 * before going live — nothing else in the codebase hardcodes these.
 * ─────────────────────────────────────────────────────────────────────
 */

export const SITE = {
  name: 'VIDIKA',
  legalName: 'Jasna Dragojević PR VIDIKA',
  tagline: 'Creative Origins',
  url: 'https://vidika.co',
  locale: 'en',
  localeOg: 'en_US',
  themeColor: '#0a131f',
  /** Used verbatim in <title>, and as the OG title. */
  title: 'VIDIKA — Creative Origins',
  /** 150–160 chars is the sweet spot for search snippets. */
  description:
    'VIDIKA is a creative studio where original IPs evolve into imaginative universes across media, technology, education, culture, and live experiences.',
  /** Founding year, used for the copyright range. */
  founded: 2026,
  email: 'contact@vidika.co',
} as const;

export const SOCIALS = [
  {
    label: 'LinkedIn',
    // TODO: replace with the real company page URL
    href: 'https://www.linkedin.com/company/vidika',
    icon: 'linkedin',
  },
  {
    label: 'IMDb',
    // TODO: replace with the real IMDb company/name page URL
    href: 'https://www.imdb.com/',
    icon: 'imdb',
  },
  {
    label: 'Instagram',
    // TODO: replace with the real Instagram handle URL
    href: 'https://www.instagram.com/vidika',
    icon: 'instagram',
  },
] as const;

export const SECTIONS = [
  { id: 'origin', index: '01', label: 'Origin' },
  { id: 'about', index: '02', label: 'About' },
  { id: 'contact', index: '03', label: 'Contact' },
] as const;

export const ABOUT = {
  eyebrow: 'Learn about us',
  body: 'VIDIKA is a creative studio where original IPs evolve into imaginative universes across media, technology, education, culture, and live experiences.',
  ctaLead: 'Explore our first IP',
  cta: {
    label: 'MIMOLAND',
    // TODO: replace with the real Mimoland destination.
    // Leave as '#' to render the button in a disabled "coming soon" state.
    href: '#',
    /** Set true once the destination is an external site. */
    external: false,
  },
} as const;

export const CONTACT = {
  heading: 'Contact',
  /**
   * Where the contact form POSTs.
   *
   * TODO: set PUBLIC_CONTACT_ENDPOINT in your .env / host env vars to a form
   * backend that accepts a JSON or multipart POST — e.g. Formspree, Web3Forms,
   * Basin, or your own handler.
   *
   * When it is empty (the default), the form degrades gracefully: submitting
   * opens the visitor's mail client addressed to SITE.email with the message
   * pre-filled, so the page is never a dead end.
   */
  endpoint: import.meta.env.PUBLIC_CONTACT_ENDPOINT ?? '',
  fields: {
    name: { label: 'Name', max: 80 },
    email: { label: 'Email', max: 120 },
    message: { label: 'Text', max: 1200 },
  },
} as const;

/** "2026" or "2026–2028" once time has passed. */
export function copyrightYears(now = new Date()): string {
  const year = now.getFullYear();
  return year > SITE.founded ? `${SITE.founded}–${year}` : `${SITE.founded}`;
}
