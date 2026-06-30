import {
  SCROLL_TRACK_VH,
  VIDEO_CARD_TRACK_VH,
  IMAGE_GALLERY_TRACK_VH,
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
// Image card URLs, relative to BASE_URL. Slide #1 is the morphing video
// (VideoPlane), so these image cards fill the remaining gallery slides.
export const GALLERY_IMAGES: (string | null)[] = [
  "gallery/kommmunikation_1_rs.jpeg",
  "gallery/kommunikation_2_rs.jpeg",
  "gallery/design_1_rs.jpeg",
  "gallery/design_2_rs.jpeg",
  "gallery/bilder_1_rs.jpeg",
  "gallery/bilder_2_rs.jpeg",
  "gallery/bilder_3_rs.jpeg",
];

export interface GalleryImageFocus {
  x: number;
  y: number;
}

const DEFAULT_IMAGE_FOCUS: GalleryImageFocus = { x: 0.5, y: 0.5 };

// Per-image focal points for narrow portrait crops. Desktop/landscape cards keep
// the normal centered cover unless an axis is actually being cropped.
const GALLERY_IMAGE_FOCUS: Record<string, GalleryImageFocus> = {
  "gallery/bilder_1_rs.jpeg": { x: 0.74, y: 0.5 },
  "gallery/bilder_2_rs.jpeg": { x: 0.58, y: 0.56 },
  "gallery/bilder_3_rs.jpeg": { x: 0.52, y: 0.58 },
};

export function galleryImageFocusFor(src: string | null): GalleryImageFocus {
  if (!src) return DEFAULT_IMAGE_FOCUS;
  return GALLERY_IMAGE_FOCUS[src] ?? DEFAULT_IMAGE_FOCUS;
}

export interface CoverCropWindow {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

export function coverCropWindowFor(
  cardAspect: number,
  texAspect: number,
  focus: GalleryImageFocus = DEFAULT_IMAGE_FOCUS,
): CoverCropWindow {
  let su = 1;
  let sv = 1;
  if (texAspect > cardAspect) su = cardAspect / texAspect;
  else sv = texAspect / cardAspect;

  const cx = Math.min(Math.max(clamp01(focus.x), su / 2), 1 - su / 2);
  const cy = Math.min(Math.max(clamp01(focus.y), sv / 2), 1 - sv / 2);

  return {
    u0: cx - su / 2,
    u1: cx + su / 2,
    v0: cy - sv / 2,
    v1: cy + sv / 2,
  };
}

// ── Layout (fractions of viewport; vmin where noted) ─────────────────────────
export const GUTTER = 0.03; // 3% vmin gutter around/between typo and cards
export const TOP_TITLE_VH = 0.08; // top title line height
// Outer gallery frame from the PDF: 64vh tall, 96vh wide in landscape (3:2).
// The visible cards sit INSIDE this frame; they no longer define the frame.
export const CARDS_VH = 0.64;
// Visible card size inside the outer frame. 0.94 keeps the card large while
// leaving enough top/side reveal for all three visible slots to read clearly.
export const CARD_FILL = 0.94;
export const BOTTOM_TITLE_VH = 0.16; // bottom title block (two lines)
export const CARD_RADIUS_VH = 0.025; // 2.5% vh corner radius
export const CARD_ASPECT = 3 / 2; // card width:height
export const CARDS_WIDTH_VW_PORTRAIT = 0.86; // portrait outer-frame width as vw
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
// text display. The last card flies up while the title fades out in lockstep (the
// fade is driven by the last card's exit progress in CardStack/GalleryTitles, not
// a gp window, so they are exactly synchronized). Tuning dials — feel is judged
// in-browser.
//
// CARDS_FLY_START is in IMAGE-gallery-progress (igp) units. The video card clears
// the frame at gp = VID_FLY_END (0.4) ⇒ igp ≈ 0.09; the first image card must
// start leaving right after, not ~60vh later, so the linger was pulled in from
// 0.22 → 0.11 (first card flies at gp ≈ 0.41, "almost immediately" after the
// video card). CARDS_FLY_END keeps the same overall image-gallery window; the
// per-card span is derived from the current GALLERY_IMAGES length.
export const CARDS_FLY_START = 0.11; // first image card starts leaving as the video card clears
export const CARDS_FLY_END = 0.71;

// scrollY → gp, mapped PIECEWISE across two sub-tracks so each gallery phase gets
// its own scroll budget. The video-card phase gp ∈ [0, VID_FLY_END] rides the
// short VIDEO_CARD_TRACK_VH (so the morph is responsive, not sluggish); the image
// gallery gp ∈ [VID_FLY_END, 1] rides IMAGE_GALLERY_TRACK_VH at its own (slower)
// cadence. The slope changes at the seam but gp is continuous there (= VID_FLY_END
// at the boundary), so scroll never jumps. The animation track owns scroll up to
// its end (sp = 1 there). innerHeight makes the vh-based heights concrete; mirrors
// useScrollProgress' anim mapping.
export function galleryProgressFrom(scrollY: number, innerHeight: number): number {
  const animY = ((SCROLL_TRACK_VH - 100) / 100) * innerHeight;
  const s = scrollY - animY;
  if (s <= 0) return 0;
  const videoCardPx = (VIDEO_CARD_TRACK_VH / 100) * innerHeight;
  const imagePx = (IMAGE_GALLERY_TRACK_VH / 100) * innerHeight;
  if (s <= videoCardPx)
    return videoCardPx > 0 ? (s / videoCardPx) * VID_FLY_END : 0;
  const r = imagePx > 0 ? (s - videoCardPx) / imagePx : 1;
  return clamp01(VID_FLY_END + r * (1 - VID_FLY_END));
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

const IMAGE_STACK_REVEAL_START = 0.1;

// Image cards stay hidden during the vertical video crop, then slide out from
// the centre while the video is nearly card-shaped.
export function imageStackRevealFor(gp: number, safeVideoHandoff = false): number {
  const start = safeVideoHandoff ? GALLERY_BLACK_FADE : IMAGE_STACK_REVEAL_START;
  const end = safeVideoHandoff ? 0.08 : VID_MORPH_END;
  return smoothstep(clamp01((gp - start) / (end - start)));
}

// Binary visibility only: the reveal movement handles the entrance, not opacity.
export function imageStackVisibleFor(gp: number, safeVideoHandoff = false): number {
  return imageStackRevealFor(gp, safeVideoHandoff) > 0 ? 1 : 0;
}

// ── Card-stack distribution inside the PDF's 96vh × 64vh frame ───────────────
// The frame is larger than one visible card by a clear inset step:
//   frame 96×64, card 90.24×60.16 (CARD_FILL = 0.94).
// That gives three fully-contained visible slots:
//   d0 front/green  — lower/bottom, centered so d1/d2 reveal symmetrically
//   d1 back/blue    — upper-left, flush with the frame's left/top edges
//   d2 back/yellow  — right side, slightly above the d0/d1 midpoint
// The video card uses d0 as its morph target, then image card 0 takes d0 as the
// video flies away. The conveyor mechanic stays depth-based.
//
// Placement is a function of CONTINUOUS depth d = cardIndex − displayed (0 = the
// front card, growing = further back), interpolated around the 3-spot cycle. As
// the conveyor advances each card's d decreases, so cards slide between the slots
// (centred → upper-left → lower-right) and the front flies straight up.
// Offsets are fractions of card W/H; z is in world units.
export const CARD_SLOT_EDGE_OFFSET = (1 - CARD_FILL) / (2 * CARD_FILL);
const CARD_FRONT_X = 0;
const STACK_POS = [
  { x: CARD_FRONT_X, y: -CARD_SLOT_EDGE_OFFSET }, // d0 — lower, blue/yellow visible at both sides
  { x: -CARD_SLOT_EDGE_OFFSET, y: CARD_SLOT_EDGE_OFFSET }, // d1 — back/upper-left
  { x: CARD_SLOT_EDGE_OFFSET, y: CARD_SLOT_EDGE_OFFSET / 2 }, // d2 — right side, slightly above midpoint
];
export const STACK_FAN_Z = 0.2; // world-z recede per depth
export const STACK_FAN_SCALE = 0; // keep all three visible cards the same size
export const STACK_VISIBLE = 2; // peeked neighbours behind the front (→ 3 visible)

export interface CardPlacement {
  x: number; // fraction of card width (centre = 0)
  y: number; // fraction of card height (centre = 0)
  z: number; // world units (front = 0, behind < 0)
  scale: number;
}

// Resting placement for a card at continuous stack depth d (≥ 0 = at/behind the
// front). Front (d = 0) sits in the lower slot at full scale; deeper cards cycle
// through the 3 PDF spots and recede in z. Negative d (the leaving front card)
// clamps to the front placement here; CardStack adds its upward rise on top.
export function cardStackPlacementFor(d: number): CardPlacement {
  const dd = Math.max(d, 0);
  const i = Math.floor(dd) % 3;
  const j = (i + 1) % 3;
  const f = dd - Math.floor(dd);
  return {
    x: lerp(STACK_POS[i].x, STACK_POS[j].x, f),
    y: lerp(STACK_POS[i].y, STACK_POS[j].y, f),
    z: -STACK_FAN_Z * dd,
    scale: 1 - STACK_FAN_SCALE * dd,
  };
}

// Exit progress for the video-as-card phase. Image cards are staged behind it
// while this runs; their own conveyor starts after the video has cleared.
export function videoCardExitProgressFor(gp: number): number {
  return smoothstep(clamp01((gp - VID_HOLD_END) / (VID_FLY_END - VID_HOLD_END)));
}

export interface ScreenRect {
  // Screen fractions, x: 0 = left … 1 = right, y: 0 = bottom … 1 = top.
  l: number;
  r: number;
  b: number;
  t: number;
}

// The on-screen rectangle (screen fractions) of the FRONT gallery card at rest,
// derived from the SAME outer-frame + slot constants CardStack uses. This makes
// the video morph land exactly on slide slot d0 before it flies away.
export function cardScreenRect(aspect: number): ScreenRect {
  const frameCenterFromTop = 2 * GUTTER + TOP_TITLE_VH + CARDS_VH / 2; // 0.46 from top
  const frameCy = 1 - frameCenterFromTop; // from bottom
  const cardHFrac = CARDS_VH * CARD_FILL;
  const halfH = cardHFrac / 2;
  // Outer frame width: landscape keeps 3:2 (96vh); portrait uses the fixed 86vw
  // frame. The visible card then fills 23/24 of whichever frame width is active.
  const frameWFrac =
    aspect >= 1
      ? (CARDS_VH * CARD_ASPECT) / aspect
      : CARDS_WIDTH_VW_PORTRAIT;
  const wFrac = frameWFrac * CARD_FILL;
  const halfW = wFrac / 2;
  const slot = cardStackPlacementFor(0);
  const cx = 0.5 + slot.x * wFrac;
  const cy = frameCy + slot.y * cardHFrac;
  return { l: cx - halfW, r: cx + halfW, b: cy - halfH, t: cy + halfH };
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

// Stepped morph (supervisor brief + "timing new drone flight" reference): the
// video card forms in THREE discrete steps, each paired with its own title reveal:
//   • Step 1  gp ∈ [0, MORPH_TOP_END]            crop from the TOP only (bottom +
//                                                 sides full) while "WIR LIEFERN"
//                                                 animates in at the top.
//   • Step 2  gp ∈ [MORPH_TOP_END, MORPH_BOT_END] crop the BOTTOM in (still FULL
//                                                 WIDTH — a letterbox band) while
//                                                 "STRATEGISCHE KOMMUNIKATION"
//                                                 animates in at the bottom.
//   • Step 3  gp ∈ [MORPH_BOT_END, VID_MORPH_END] crop the SIDES in + round the
//                                                 corners → card format. No title
//                                                 change here.
// Then it holds, then flies — never a crop change AND a text change at once.
const MORPH_TOP_END = 0.07; // step 1 ends: top edge at card top; bottom + sides still full
const MORPH_BOT_END = 0.13; // step 2 ends: bottom at card bottom; sides STILL full (band)
// How far the card rises during the fly-out (screen-height fraction). Matches
// CardStack's RISE_OFF (≈1.9 card-heights): the card flies straight UP off the
// top FULLY OPAQUE (no opacity fade — "слайди без опасіті улітають"), far enough
// to clear the frame. card.b ≈ 0.22 + this ≫ 1, so the bottom edge exits the top.
const RISE_VID = 1.9 * CARDS_VH * CARD_FILL;

export function videoUsesScreenClipFor(
  gp: number,
  conservativeBrowser = false,
): boolean {
  return !conservativeBrowser && gp > 0 && gp < VID_FLY_END;
}

export function videoHiddenForSafeHandoff(
  gp: number,
  safeVideoHandoff = false,
): boolean {
  return safeVideoHandoff && gp >= GALLERY_BLACK_FADE;
}

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

  // Step 1: TOP edge crops down. Step 2: BOTTOM edge crops up (width still full).
  // Step 3: both SIDES crop in + radius grows so the card lands fully rounded.
  const aTop = smoothstep(clamp01(gp / MORPH_TOP_END));
  const aBot = smoothstep(clamp01((gp - MORPH_TOP_END) / (MORPH_BOT_END - MORPH_TOP_END)));
  const h = smoothstep(clamp01((gp - MORPH_BOT_END) / (VID_MORPH_END - MORPH_BOT_END)));
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
// The gallery is one morphing video card followed by the GALLERY_IMAGES.length
// image cards. Card 1 spans [0,1]; the image conveyor starts after that.
//
// Card 1's cp is keyed to gp / **VID_MORPH_END** (NOT VID_FLY_END), so the two
// opening titles finish settling exactly as the card finishes FORMING (gp =
// VID_MORPH_END), then HOLD (cp clamped at 1) through the card's hold + fly-away.
// This is what makes the opening read as discrete steps: WIR LIEFERN settles
// during the top crop (cp 0→0.5), STRATEGISCHE during the bottom/side crop
// (cp 0.5→1), and NO text changes while the card holds or flies. Continuous at
// gp = VID_FLY_END (cp = 1): the video branch is clamped at 1 and
// cardFlyProgressFor(imageGalleryProgress) is still 0 there, so both give 1.
export function galleryCardProgressFor(gp: number): number {
  if (gp < VID_FLY_END) return clamp01(gp / VID_MORPH_END);
  return 1 + cardFlyProgressFor(imageGalleryProgress(gp)) * GALLERY_IMAGES.length;
}

const TITLE_LAST_FRAME = 99;
function titleFrameFrac(frame: number): number {
  return frame / TITLE_LAST_FRAME;
}

// Title-frame fraction (0..1 → titles.json frame range) as a function of the
// unified card progress `cp`. Each title text squishes in while ITS card is the
// one showing, then HOLDS on the comp's SETTLED frame (one text per band) while
// the next cards pass (monotonic non-decreasing):
//   cp [0,1]  card 1 / video morph → 0 .. 50/99 (WIR LIEFERN + STRATEGISCHE in)
//   cp [1,3]  cards 2,3            → hold frame 50 (clean STRATEGISCHE)
//   cp [3,4]  card 4              → frame 50 .. 75 (DESIGN NACH MASS slides in)
//   cp [4,6]  cards 5,6            → hold frame 75 (clean DESIGN NACH MASS)
//   cp [6,7]  card 7              → frame 75 .. 99 (UND DIE + GANZ GROSSEN BILDER)
//   cp [7,9]  cards 8,9            → hold frame 99 (clean final title)
// The holds land on the comp's CLEAN integer frames (verified render: 50/75/99), so
// the strategische↔design↔ganz-grossen overlaps only flash by DURING each
// trigger card's slide-in (cp 3→4, 6→7) — never held static across 3 cards.
const TITLE_F_STRAT = titleFrameFrac(50); // WIR LIEFERN / STRATEGISCHE KOMMUNIKATION
const TITLE_F_DESIGN = titleFrameFrac(75); // WIR LIEFERN / DESIGN NACH MASS
const TITLE_F_GROSS = titleFrameFrac(99); // UND DIE / GANZ GROSSEN BILDER
export function isGalleryTitleHoldFrame(frac: number): boolean {
  return (
    Math.abs(frac - TITLE_F_STRAT) < 1e-9 ||
    Math.abs(frac - TITLE_F_DESIGN) < 1e-9 ||
    Math.abs(frac - TITLE_F_GROSS) < 1e-9
  );
}
export function galleryTitleFrameFracForCard(cp: number): number {
  const c = Math.min(Math.max(cp, 0), 9);
  if (c <= 1) return lerp(0, TITLE_F_STRAT, c);
  if (c <= 3) return TITLE_F_STRAT;
  if (c <= 4) return lerp(TITLE_F_STRAT, TITLE_F_DESIGN, c - 3);
  if (c <= 6) return TITLE_F_DESIGN;
  if (c <= 7) return lerp(TITLE_F_DESIGN, TITLE_F_GROSS, c - 6);
  return TITLE_F_GROSS;
}

// ── Stepped image-card conveyor + hold-aligned titles ────────────────────────
// "following steps as described earlier — never a text change and card flip at
// once." The image cards advance in DISCRETE steps: each card SETTLES (holds) for
// STEP_HOLD_FRAC of its beat, then FLIES away over the rest. The bottom title is
// changed ONLY inside a hold window (when the front card is settled — nothing
// flying), so a text change and a fly-away can never coincide.
export const STEP_HOLD_FRAC = 0.5; // fraction of each card's beat spent settled before it flies

// Continuous conveyor position `displayed` ∈ [0, N]: held at integer k while card
// k is settled, then ramped k→k+1 as it flies. `lin` is the underlying linear
// card progress (cardFlyProgressFor over the image gallery). CardStack reads this
// for the fan depth d = i − displayed.
export function cardConveyorDisplayedFor(igp: number): number {
  const n = GALLERY_IMAGES.length;
  const lin = cardFlyProgressFor(igp) * n;
  const k = Math.floor(lin);
  if (k >= n) return n;
  const f = lin - k;
  const flip = smoothstep(clamp01((f - STEP_HOLD_FRAC) / (1 - STEP_HOLD_FRAC)));
  return k + flip;
}

// Continuous front-card stack position across the WHOLE gallery, counting the
// video card as virtual card 0. While the video holds at the front (d0) this is
// −1 so image card 0 sits one slot back at d1 (the upper-left "position #2") —
// NOT directly behind the video. As the video flies up (videoCardExitProgressFor
// 0→1) it ramps −1→0, sliding image card 0 forward into the front slot exactly
// like the normal card hand-off. Once the video has cleared (gp ≥ VID_FLY_END,
// exit = 1) it equals the image conveyor's own displayed position. Continuous at
// the seam (both give 0 at gp = VID_FLY_END). CardStack reads this for d = i − displayed.
export function galleryStackDisplayedFor(gp: number, safeVideoHandoff = false): number {
  const base = cardConveyorDisplayedFor(imageGalleryProgress(gp));
  if (safeVideoHandoff) return base;
  return base - (1 - videoCardExitProgressFor(gp));
}

// Title-frame fraction for the WHOLE gallery (0..1 → titles.json frame range).
//   • Video card (gp < VID_FLY_END): WIR LIEFERN settles during step 1 (top crop)
//     and STRATEGISCHE during step 2 (bottom/side crop) — keyed to gp/VID_MORPH_END
//     so both are settled as the card finishes forming, then HELD through the hold
//     and the fly (no text change while it flies).
//   • Image cards: the three-card title groups change ONLY while the FIRST card of
//     the new group is settled in its hold window — DESIGN as image card 2 holds,
//     GANZ as image card 5 holds — never during a fly-away.
// Frame frac where "WIR LIEFERN" (top, layer 01) has settled and "STRATEGISCHE"
// (bottom, layer 02) is about to start animating in — layer 02's start time is
// frame 22.5 of the 100-frame comp (≈22.5/99 of the scrub range).
const TITLE_F_WIR = 0.227;
export function galleryTitleFrameFor(gp: number): number {
  if (gp < VID_FLY_END) {
    // Step 1 (top crop) → WIR LIEFERN in; step 2 (bottom crop) → STRATEGISCHE in;
    // held through step 3 (sides), the hold and the fly (no text change there).
    if (gp < MORPH_TOP_END) return smoothstep(gp / MORPH_TOP_END) * TITLE_F_WIR;
    if (gp < MORPH_BOT_END)
      return lerp(TITLE_F_WIR, TITLE_F_STRAT, smoothstep((gp - MORPH_TOP_END) / (MORPH_BOT_END - MORPH_TOP_END)));
    return TITLE_F_STRAT;
  }
  const lin = cardFlyProgressFor(imageGalleryProgress(gp)) * GALLERY_IMAGES.length;
  if (lin < 2) return TITLE_F_STRAT;
  if (lin < 2 + STEP_HOLD_FRAC)
    return lerp(TITLE_F_STRAT, TITLE_F_DESIGN, smoothstep((lin - 2) / STEP_HOLD_FRAC));
  if (lin < 5) return TITLE_F_DESIGN;
  if (lin < 5 + STEP_HOLD_FRAC)
    return lerp(TITLE_F_DESIGN, TITLE_F_GROSS, smoothstep((lin - 5) / STEP_HOLD_FRAC));
  return TITLE_F_GROSS;
}
