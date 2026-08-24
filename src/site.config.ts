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
  email: 'studio@vidika.co',
} as const;

/**
 * Company identification and the privacy notice's own metadata.
 *
 * The three registry fields are what the Serbian e-commerce act (Zakon o
 * elektronskoj trgovini, čl. 6) requires a service provider to display, and
 * what a data subject needs in order to exercise their rights against a named
 * controller. Each renders only once filled in — an empty string is skipped
 * rather than printed, so a half-finished record never ships as a stub.
 */
export const LEGAL = {
  // TODO: registered address, as it appears in the APR record
  address: '',
  /** Matični broj. */
  // TODO
  registrationNumber: '',
  /** PIB. */
  // TODO
  taxId: '',
  /** Shown as "Last updated". Bump whenever the notice changes materially. */
  privacyUpdated: '2026-08-12',
  /**
   * How long correspondence is kept after the last exchange. Stated in the
   * notice as a promise, so it has to match what actually happens to the
   * studio@vidika.co mailbox.
   */
  enquiryRetention: '24 months',
} as const;

export const SOCIALS = [
  {
    label: 'LinkedIn',
    // TODO: replace with the real company page URL
    href: 'https://www.linkedin.com/company/vidika-co/',
    icon: 'linkedin',
  },
  {
    label: 'IMDb',
    href: 'https://www.imdb.com/title/tt44123873/',
    icon: 'imdb',
  },
  {
    label: 'Instagram',
    // TODO: replace with the real Instagram handle URL
    href: 'https://www.instagram.com/vidika.co',
    icon: 'instagram',
  },
] as const;

export const SECTIONS = [
  { id: 'origin', index: '01', label: 'Origin' },
  { id: 'about', index: '02', label: 'About' },
  { id: 'contact', index: '03', label: 'Contact' },
] as const;

export const ABOUT = {
  /**
   * Never drawn: the section opens on the description itself. It stays here
   * because a landmark still needs a name — it labels the section for screen
   * readers and gives the page a heading between the hero and Contact.
   */
  heading: 'About',
  body: 'VIDIKA is a creative studio where original IPs evolve into imaginative universes across media, technology, education, culture, and live experiences.',
  ctaLead: 'Explore our first IP',
  cta: {
    /**
     * Never drawn: the button carries the Mimoland lockup instead. This is the
     * name behind it — what a screen reader announces, and what the button
     * falls back to if the mark is ever taken out.
     */
    label: 'Mimoland',
    // Leave as '#' to render the button in a disabled "coming soon" state.
    href: 'https://welcometomimoland.com',
    /** Set true once the destination is an external site. */
    external: true,
  },
} as const;

export const CONTACT = {
  heading: 'Contact',
  /**
   * Where the contact form POSTs.
   *
   * Defaults to the site's own handler in `server/` — a Node service behind
   * nginx that emails the submission from studio@vidika.co. See server/README.md
   * for the deployment, and set PUBLIC_CONTACT_ENDPOINT to point somewhere else
   * (a hosted form backend, a staging box) without touching the components.
   *
   * Set it to an empty string and the form degrades gracefully: submitting
   * opens the visitor's mail client addressed to SITE.email with the message
   * pre-filled, so the page is never a dead end.
   */
  endpoint: import.meta.env.PUBLIC_CONTACT_ENDPOINT ?? '/api/contact',
  fields: {
    name: { label: 'Name', max: 80 },
    email: { label: 'Email', max: 120 },
    message: { label: 'Message', max: 1200 },
  },
} as const;

/**
 * The footer's build credit. Two fields because the line names the work and
 * then names who did it — only the second half is the link, so only the second
 * half carries a destination.
 */
export const CREDIT = {
  label: 'Web Development',
  name: 'nemanjas.dev',
  href: 'https://nemanjas.dev',
} as const;

/** "2026" or "2026–2028" once time has passed. */
export function copyrightYears(now = new Date()): string {
  const year = now.getFullYear();
  return year > SITE.founded ? `${SITE.founded}–${year}` : `${SITE.founded}`;
}
