import { SCROLL_TRACK_VH, GALLERY_TRACK_VH } from "./constants";

// Pure data + scroll→state functions for the gallery section (the scroll
// section appended AFTER the video). Mirrors playback.ts/arc.ts: no React, no
// Three — every per-frame value is a pure function of gallery progress `gp`,
// read inside useFrame so the section never needs a React re-render to advance.

function clamp01(x: number): number {
  return Math.min(Math.max(x, 0), 1);
}
function smoothstep(x: number): number {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
}

// ── Card images (drop-in) ────────────────────────────────────────────────────
// `null` ⇒ render a procedural gray placeholder (see GalleryCard). To ship real
// imagery: drop files in public/gallery/ and replace the nulls with their URLs
// (relative to BASE_URL), e.g. "gallery/photo-1.jpg". Any length ≥ 3 works; more
// images keep the 3-card stack full for longer before it empties into the CTA.
export const GALLERY_IMAGES: (string | null)[] = [
  null, null, null, null, null, null,
];

// ── Layout (fractions of viewport; vmin where noted) ─────────────────────────
export const GUTTER = 0.03; // 3% vmin gutter around/between typo and cards
export const TOP_TITLE_VH = 0.08; // top title line height
export const CARDS_VH = 0.64; // card-stack height (landscape & portrait)
export const BOTTOM_TITLE_VH = 0.16; // bottom title block (two lines)
export const CARD_RADIUS_VH = 0.025; // 2.5% vh corner radius
export const CARD_ASPECT = 3 / 2; // card width:height
export const CARDS_WIDTH_VW_PORTRAIT = 0.86; // portrait card width as vw
export const MAX_ASPECT = 16 / 9; // cap; letterbox beyond

// ── gp partition ─────────────────────────────────────────────────────────────
// [0, BACKDROP_FADE_END]   held video last frame fades to black
// [BACKDROP_FADE_END, TITLES_END]  titles scrub 0→1 (the 3 title frames)
// [TITLES_END, CTA_START]  titles hold on frame 3 while the last card flies out
// CTA_START marks the END of the card phase (last card gone by here). The CTA
// reveal itself is no longer gp-gated — it tracks the last card's exit (see
// galleryCtaFromExit) so it appears right as the card + title finish leaving.
export const BACKDROP_FADE_END = 0.06;
export const TITLES_END = 0.72;
export const CTA_START = 0.82;
// CTA reveals over the TAIL of the last card's exit: cardExit ∈ [CTA_REVEAL_FROM, 1].
export const CTA_REVEAL_FROM = 0.8;

// ── Round 3 retiming ─────────────────────────────────────────────────────────
// The card conveyor TRAILS the title scrub so a card leaves at the END of each
// text display. The first card lingers through the title grow-in; the last card
// flies up while the title fades out in lockstep (the fade is driven by the last
// card's exit progress in CardStack/GalleryTitles, not a gp window, so they are
// exactly synchronized). Tuning dials — feel is judged in-browser.
export const CARDS_FLY_START = 0.22; // first card holds until here (title still growing in)
export const CARDS_FLY_END = CTA_START; // last card gone by the CTA

// scrollY → gp. The animation track owns scroll up to its end (sp = 1 there);
// the gallery owns the GALLERY_TRACK_VH appended beyond it. innerHeight makes
// the vh-based track heights concrete. Mirrors useScrollProgress' anim mapping.
export function galleryProgressFrom(scrollY: number, innerHeight: number): number {
  const animY = ((SCROLL_TRACK_VH - 100) / 100) * innerHeight;
  const galleryPx = (GALLERY_TRACK_VH / 100) * innerHeight;
  return galleryPx > 0 ? clamp01((scrollY - animY) / galleryPx) : 0;
}

// Black backdrop opacity: the held video fades to flat black for the gallery.
export function galleryBackdropFor(gp: number): number {
  return smoothstep(clamp01(gp / BACKDROP_FADE_END));
}

// Normalized title scrub fraction (0→1) → maps to the titles.json frame range.
// Holds at 1 from TITLES_END so frame 3 is readable before the CTA takes over.
export function galleryTitleFracFor(gp: number): number {
  return clamp01((gp - BACKDROP_FADE_END) / (TITLES_END - BACKDROP_FADE_END));
}

export interface ConveyorState {
  // Index of the front card currently flying up (integer); ≥ length ⇒ empty.
  lead: number;
  // Fly-up progress of the front card, 0..1.
  local: number;
  // Raw 0..1 progress across the card phase (for callers that want it).
  span: number;
}

// Card conveyor: as `span` runs 0→1 over [BACKDROP_FADE_END, CTA_START], the
// front card flies up & out, the stack advances, and a new card enters behind.
// Visible cards are indices [lead, lead+1, lead+2] that are < GALLERY_IMAGES
// .length; near the end the stack naturally empties (so the frame is clear for
// the CTA). The 3-slot stacking offsets repeat every 3 (see CardStack).
export function cardConveyorFor(gp: number): ConveyorState {
  const span = clamp01((gp - BACKDROP_FADE_END) / (CTA_START - BACKDROP_FADE_END));
  const total = span * GALLERY_IMAGES.length;
  return { lead: Math.floor(total), local: total - Math.floor(total), span };
}

// Retimed fly progress for the discrete-step swiper (round 3). 0 through the
// first-card linger window, 1 by CARDS_FLY_END — so the swiper's rounded target
// (= round(this · N)) advances later than the continuous title scrub.
export function cardFlyProgressFor(gp: number): number {
  return clamp01((gp - CARDS_FLY_START) / (CARDS_FLY_END - CARDS_FLY_START));
}

// CTA overlay opacity, driven by the last card's exit progress (cardExit, 0→1
// as the last card flies up — see CardStack). The CTA fades in over the TAIL of
// that exit ([CTA_REVEAL_FROM, 1]) so it appears immediately as the card + title
// finish leaving, with no black gap. Coupled to the (eased) exit, not gp, so it
// tracks the fly-out at any scroll speed. 0 the whole time until the LAST card
// starts leaving (cardExit is 0 for every earlier card).
export function galleryCtaFromExit(cardExit: number): number {
  return smoothstep(clamp01((cardExit - CTA_REVEAL_FROM) / (1 - CTA_REVEAL_FROM)));
}
