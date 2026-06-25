import {
  SCROLL_TRACK_VH,
  GALLERY_TRACK_VH,
  VID_MORPH_END,
  VID_HOLD_END,
  VID_FLY_END,
  IMAGE_GALLERY_START,
} from "./constants";

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
function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

// ── Card images (drop-in) ────────────────────────────────────────────────────
// `null` ⇒ render a procedural gray placeholder (see GalleryCard). To ship real
// imagery: drop files in public/gallery/ and replace the nulls with their URLs
// (relative to BASE_URL), e.g. "gallery/photo-1.jpg". Any length ≥ 3 works; more
// images keep the 3-card stack full for longer before it empties into the CTA.
// 8 image cards (slides 2..9) — slide #1 is the morphing video (VideoPlane), so
// the gallery is 9 cards total. `null` ⇒ procedural gray placeholder.
export const GALLERY_IMAGES: (string | null)[] = [
  null, null, null, null, null, null, null, null,
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
// The last card flies UP opaque (no opacity fade to hide behind), so the CTA must
// already be coming up as the card clears the centre — not pop in once it's fully
// gone. cardExit equals the leaving card's rise progress, and the card has cleared
// screen-centre (where the wordmark sits) by ≈0.5, so revealing from 0.6 starts the
// fade just as the centre opens up: no black gap, no late pop, and the wordmark
// never bleeds over the still-present card.
export const CTA_REVEAL_FROM = 0.6;

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

// Width (raw gp) of the gallery black fade. Kept tiny so the flat black sits
// BEHIND the full-bleed video and is already opaque before the morph reveals
// anything around the shrinking card.
const GALLERY_BLACK_FADE = 0.02;

// Black background opacity for the gallery. It now lives BEHIND the video
// (GalleryBackdrop z = −3.6): the video morphs/shrinks into slide #1 and the
// vacated area reveals this black; the image cards later sit on it. Opaque for
// essentially the whole gallery. (Window tightened from BACKDROP_FADE_END; the
// 0 / 1 / 1 anchors the assertions check are unchanged.)
export function galleryBackdropFor(gp: number): number {
  return smoothstep(clamp01(gp / GALLERY_BLACK_FADE));
}

// ── Video-card phase (slide #1 is the morphing FPV video) ────────────────────
// Progress through the IMAGE gallery (slides 2..N + titles + CTA), which begins
// only AFTER the video card has flown away. The existing card/title pure
// functions are fed THIS (not raw gp) at their call sites, so they — and their
// assertions — are unchanged; their input is simply the image-gallery sub-range.
export function imageGalleryProgress(gp: number): number {
  return clamp01((gp - IMAGE_GALLERY_START) / (1 - IMAGE_GALLERY_START));
}

export interface ScreenRect {
  // Screen fractions, x: 0 = left … 1 = right, y: 0 = bottom … 1 = top.
  l: number;
  r: number;
  b: number;
  t: number;
}

// The on-screen rectangle (screen fractions) of a gallery card at rest, derived
// from the SAME layout constants CardStack uses, so the video morph lands exactly
// on an image card. Card band is centred at `bandCenterFromTop` = 0.46 down.
export function cardScreenRect(aspect: number): ScreenRect {
  const cyTop = 2 * GUTTER + TOP_TITLE_VH + CARDS_VH / 2; // 0.46 from top
  const cy = 1 - cyTop; // from bottom
  const halfH = CARDS_VH / 2;
  // Card screen-width fraction: landscape keeps 3:2 (world cardH·ASPECT ÷ vw),
  // portrait uses the fixed 86vw band.
  const wFrac = aspect >= 1 ? (CARDS_VH * CARD_ASPECT) / aspect : CARDS_WIDTH_VW_PORTRAIT;
  const halfW = wFrac / 2;
  return { l: 0.5 - halfW, r: 0.5 + halfW, b: cy - halfH, t: cy + halfH };
}

export interface VideoCardMorph {
  // Texture sub-window (screen fractions of the full-bleed cover image) the card
  // shows — collapses full → card over the morph, then frozen.
  crop: ScreenRect;
  // Upward placement offset (screen-height fraction) during the fly-out.
  rise: number;
  // Plane opacity — always 1 here: the card flies up OPAQUE (no dissolve). Kept
  // in the shape so the reveal-fade can still multiply it at the call site.
  opacity: number;
  // 0 → square corners (full-bleed), 1 → fully rounded card corners.
  radius: number;
  visible: boolean;
}

// Sub-stage windows (gp) inside the morph. The TOP edge leads the bottom so the
// crop reads "from the top first"; the horizontal squeeze starts mid-vertical.
const V_TOP_END = 0.07; // top edge reaches card top
const V_BOT_END = 0.1; // bottom edge reaches card bottom (trails the top)
const H_START = 0.08; // sides begin pulling in
// How far the card rises during the fly-out (screen-height fraction). Matches
// CardStack's RISE_OFF (≈1.9 card-heights): the card flies straight UP off the
// top FULLY OPAQUE (no opacity fade — "слайди без опасіті улітають"), far enough
// to clear the frame. card.b ≈ 0.22 + this ≫ 1, so the bottom edge exits the top.
const RISE_VID = 1.9 * CARDS_VH;

// Full-bleed FPV video → gallery slide #1: crop the top first, then the sides,
// down to an image-card rect; hold; then fly straight UP off the top — OPAQUE,
// no dissolve (matches the image cards) — while the scrub continues.
export function videoCardMorphFor(gp: number, aspect: number): VideoCardMorph {
  const card = cardScreenRect(aspect);
  const full: ScreenRect = { l: 0, r: 1, b: 0, t: 1 };
  if (gp <= 0) return { crop: full, rise: 0, opacity: 1, radius: 0, visible: true };
  // Off the top and gone: keep opacity 1 (no fade); VideoPlane hides the plane
  // off `visible` (flown), not off opacity.
  if (gp >= VID_FLY_END)
    return { crop: card, rise: RISE_VID, opacity: 1, radius: 1, visible: false };

  // Vertical crop (top leads), then horizontal crop. The radius grows over the
  // horizontal-crop stage so the card lands fully rounded at card format.
  const aTop = smoothstep(clamp01(gp / V_TOP_END));
  const aBot = smoothstep(clamp01(gp / V_BOT_END));
  const h = smoothstep(clamp01((gp - H_START) / (VID_MORPH_END - H_START)));
  const crop: ScreenRect = {
    t: lerp(full.t, card.t, aTop),
    b: lerp(full.b, card.b, aBot),
    l: lerp(full.l, card.l, h),
    r: lerp(full.r, card.r, h),
  };

  // Fly-out after the hold: the texture window stays frozen at the card crop
  // while the placement rises straight up — staying FULLY OPAQUE (no dissolve),
  // matching the image cards. The scrub keeps playing inside the window.
  const fly = smoothstep(clamp01((gp - VID_HOLD_END) / (VID_FLY_END - VID_HOLD_END)));
  return { crop, rise: fly * RISE_VID, opacity: 1, radius: h, visible: true };
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

// ── Unified card progress (titles sequence by which card is showing) ─────────
// The gallery is 9 cards: card 1 = the morphing video (slide #1), cards 2..9 =
// the GALLERY_IMAGES.length image cards. `cp ∈ [0,9]` is a single continuous
// progress: card 1 spans [0,1] (its full-bleed → card morph + fly-out, keyed to
// raw gp / VID_FLY_END), cards 2..9 span [1,9] (the image conveyor, keyed to the
// remapped image-gallery progress). Continuous at gp = VID_FLY_END (cp = 1):
// there the first branch hits 1 and `cardFlyProgressFor(imageGalleryProgress)`
// is still 0 (the image cards have not begun flying), so both branches give 1.
export function galleryCardProgressFor(gp: number): number {
  if (gp < VID_FLY_END) return clamp01(gp / VID_FLY_END);
  return 1 + cardFlyProgressFor(imageGalleryProgress(gp)) * GALLERY_IMAGES.length;
}

// Title-frame fraction (0..1 → titles.json frame range) as a function of the
// unified card progress `cp`. Each title text squishes in while ITS card is the
// one showing, then HOLDS on the comp's SETTLED frame (one text per band) while
// the next cards pass (monotonic non-decreasing):
//   cp [0,1]  card 1 / video morph → 0 .. 0.455 (WIR LIEFERN + STRATEGISCHE in)
//   cp [1,3]  cards 2,3            → hold 0.455 (clean STRATEGISCHE — frame 45)
//   cp [3,4]  card 4              → 0.455 .. 0.727 (DESIGN NACH MASS slides in)
//   cp [4,6]  cards 5,6            → hold 0.727 (clean DESIGN NACH MASS — frame 72)
//   cp [6,7]  card 7              → 0.727 .. 0.99 (UND DIE + GANZ GROSSEN BILDER)
//   cp [7,9]  cards 8,9            → hold 0.99 (clean — frame 98)
// The holds land on the comp's CLEAN frames (verified render: 45 / 72 / 98), so
// the strategische↔design↔ganz-grossen overlaps only flash by DURING each
// trigger card's slide-in (cp 3→4, 6→7) — never held static across 3 cards.
const TITLE_F_STRAT = 0.455; // frame 45 — WIR LIEFERN / STRATEGISCHE KOMMUNIKATION
const TITLE_F_DESIGN = 0.727; // frame 72 — WIR LIEFERN / DESIGN NACH MASS
const TITLE_F_GROSS = 0.99; // frame 98 — UND DIE / GANZ GROSSEN BILDER
export function galleryTitleFrameFracForCard(cp: number): number {
  const c = Math.min(Math.max(cp, 0), 9);
  if (c <= 1) return lerp(0, TITLE_F_STRAT, c);
  if (c <= 3) return TITLE_F_STRAT;
  if (c <= 4) return lerp(TITLE_F_STRAT, TITLE_F_DESIGN, c - 3);
  if (c <= 6) return TITLE_F_DESIGN;
  if (c <= 7) return lerp(TITLE_F_DESIGN, TITLE_F_GROSS, c - 6);
  return TITLE_F_GROSS;
}
