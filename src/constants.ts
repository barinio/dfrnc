// ── Lottie timeline (seconds) ────────────────────────────────────────────────
// Real export: Animation - 1781083424055.json, 30 fps / 266 frames.
// The loader auto-plays [0, DEFT_DROP_S] (the "DEFT drop"); scroll then drives
// [DEFT_DROP_S, LOTTIE_TOTAL_S].
// DEFT_DROP_S = 1.0s — DEFT has landed and settled at its final position;
// MACHT is not yet visible (first appears at ~1.2s). Confirmed by probe.
export const DEFT_DROP_S = 1.0;
// LOTTIE_INTRO_S = 3.0s — full 4-word block (DEFT/MACHT/AUSGEZEICHNETES/DESIGN)
// fully assembled and settled. The frame held while the figures fly (sp 0.17–0.5).
export const LOTTIE_INTRO_S = 3.0;
export const LOTTIE_TOTAL_S = 266 / 30; // 8.8667s — 30 fps, 266 frames

// ── Scroll-progress partition (0..1) ─────────────────────────────────────────
// Nothing autoplays after the loader releases:
//   [0, REVEAL_END]                    Lottie reveal (DEFT_DROP_S → LOTTIE_INTRO_S)
//   FIGURES_START (< REVEAL_END)       the FIRST figure launches inside the
//                                      reveal — airborne before AUSGEZEICHNETES
//                                      finishes animating in
//   [FIGURES_START, FIGURES_END]       figures fly overlapping domes; Lottie
//                                      held after the reveal completes
//   [LOTTIE_SCRUB_START, LOTTIE_END]   Lottie scrubs to the end; the LAST figures
//                                      finish their exits inside this window —
//                                      every flight ends at FIGURES_END, before
//                                      the video fades in at VIDEO_START
//   VIDEO_START (< LOTTIE_END)         video fades in BEHIND the typography; the
//                                      white letters occlude it; alphaTest gaps reveal it
//   [LOTTIE_END, 1]                    Lottie fully done — pure video owns the frame
export const REVEAL_END = 0.17;
// Start of the figures phase. Sits INSIDE the Lottie reveal: AUSGEZEICHNETES
// (the last word to appear) animates in at sp ≈ 0.147–0.158 (measured), and the
// first figure must already be flying before it settles. With FIGURE_FADE 0.18
// of a 0.34-wide window, the first figure is fully opaque by sp ≈ 0.153.
export const FIGURES_START = 0.125;
// Lottie hold ends and the typography starts appearing again. Decoupled from
// FIGURES_END so the tail of the figure sequence exits WHILE the text animates.
export const LOTTIE_SCRUB_START = 0.5;
// End of the figures phase. Must stay below VIDEO_START so the last figure's
// exit completes before the video shows up behind the typography.
export const FIGURES_END = 0.58;
export const LOTTIE_END = 0.78;

// Scroll progress where the video starts fading in BEHIND the typography —
// anchored to the moment KONZEPTE has settled (Lottie t ≈ 5.75s, sp ≈ 0.6312)
// just before the zoom-in begins (~6.1s). The letters occlude the video; it
// shows through the alphaTest gaps, and owns the frame once the zoom passes
// through. Measured from real export (Animation - 1781083424055.json).
export const VIDEO_START = 0.63;

// Scroll-progress width of the video fade after VIDEO_START. Tuned so the video
// reaches 100% opacity at VIDEO time ≈ 1.5s (direction): with VIDEO_SPLIT below,
// 1.5s ≈ clip-fraction 0.064, reached at sp = VIDEO_START + VIDEO_FADE.
export const VIDEO_FADE = 0.028;

// Fraction of a figure's own flight window spent fading opacity in/out.
// ZERO by design: per supervisor direction the figures must NOT change opacity —
// they simply fly in from below the frame and back out (the arc roots sit fully
// off-screen, see ArcConfig.rootDepth ≥ ~1.4), so entry/exit reads as motion,
// not a dissolve. Because there is no fade-out to mask overlaps, two glass
// figures can be fully opaque at once during a cascade overlap; that is
// acceptable (they are transmissive, and the tokyo×gba crossing already showed
// two at once). figureStateFor returns a binary 0/1 opacity when this is 0.
export const FIGURE_FADE = 0;

// Total scrollable track height (vh). 800 gives the video phase ~154vh.
export const SCROLL_TRACK_VH = 800;

// Additional scrollable track (vh) appended AFTER the animation track for the
// gallery section. The animation timeline (sp) is unchanged — it stays clamped
// at 1 through the whole gallery; only `gp` (gallery progress) advances here.
// Raised from 400 → 700 so the image gallery still gets ≈400vh AFTER the
// ≈0.4-of-gp video-card phase (see the video-card constants below).
export const GALLERY_TRACK_VH = 700;

// ── Video-card phase (gp units) ──────────────────────────────────────────────
// The FPV video does NOT fade out into the gallery — it shrinks into gallery
// slide #1 (cropped top-first, then horizontally), holds as the front card, and
// flies away, scrubbing the whole time (see 2026-06-25-video-card-morph-design.md).
//   [0, VID_MORPH_END]        full-bleed → card-shaped (crop top, then horizontal)
//   [VID_MORPH_END, VID_HOLD_END]  holds as slide #1 (still scrubbing)
//   [VID_HOLD_END, VID_FLY_END]    rises + fades; the clip reaches its last frame
//   [VID_FLY_END, 1]          image conveyor + titles + CTA (remapped image-gallery)
export const VID_MORPH_END = 0.16;
export const VID_HOLD_END = 0.26;
export const VID_FLY_END = 0.4;
// The image gallery (slides 2..N) begins its progress slightly BEFORE the video
// card has fully flown, so slide #2 rises in over the tail of the video slide's
// exit — no black gap at the handoff (supervisor: "no black gap"). Sits between
// VID_HOLD_END and VID_FLY_END.
export const IMAGE_GALLERY_START = 0.34;
// Fraction of the clip reached at the end of the anim track (sp = 1) = the video
// time at which the morph begins. Tuned to land JUST AFTER the "zuhause im herzen
// der schweiz" sign (read ≈18–18.5s, drone passes it by ≈20s; clip ≈23.56s) →
// 20s / 23.56s ≈ 0.84. The tail [VIDEO_SPLIT, 1] scrubs across the video-card
// phase, so the frame never freezes. Re-tune if the clip is swapped.
export const VIDEO_SPLIT = 0.84;
