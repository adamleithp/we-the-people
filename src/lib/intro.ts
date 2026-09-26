/**
 * The glass intro's motion, shared by the site (`GlassIntro.astro`) and the video
 * studio (`/studio`, `glass-renderer.ts`) so a rendered video is the same
 * shatter the site plays.
 */

/** the site's shatter — the studio's "shuffle" just picks another seed */
export const INTRO_SEED = 20260728;

export const INTRO = {
  // homepage: first-impression piece, cinematic
  hero: { cols: 7, rows: 3, flight: 2.4, staggerScale: 1 },
  // section pages: seen again and again, so fewer, larger pieces at ~2× speed
  page: { cols: 5, rows: 2, flight: 1.1, staggerScale: 0.5 },
} as const;

export type IntroVariant = keyof typeof INTRO;

/** `shard-assemble`'s easing — keep in step with the keyframes in GlassIntro.astro */
export const INTRO_EASE = [0.16, 1, 0.3, 1] as const;
