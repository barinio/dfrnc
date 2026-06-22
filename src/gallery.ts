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
// [CTA_START, 1]           CTA fades in (titles + cards gone)
export const BACKDROP_FADE_END = 0.06;
export const TITLES_END = 0.72;
export const CTA_START = 0.82;
export const CTA_FADE = 0.1;

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

// CTA overlay opacity: 0 until CTA_START, smooth to 1 over CTA_FADE.
export function galleryCtaFor(gp: number): number {
  return smoothstep(clamp01((gp - CTA_START) / CTA_FADE));
}
