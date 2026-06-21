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

// Scroll-progress width of the video fade after VIDEO_START — fully in at
// VIDEO_START + VIDEO_FADE = 0.69 ≈ Lottie 6.8s, well before the zoom ends
// at ~8.5s.
export const VIDEO_FADE = 0.05;

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
