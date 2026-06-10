// ── Lottie timeline (seconds) ────────────────────────────────────────────────
// The loader auto-plays [0, DEFT_DROP_S] (the "DEFT drop"); scroll then drives
// [DEFT_DROP_S, LOTTIE_TOTAL_S]. STAND-IN: the real Lottie export isn't in yet,
// so the first 1.0s of the current animation plays the drop's role. Re-measure
// (with LOTTIE_INTRO_S / LOTTIE_TOTAL_S) when the export lands.
export const DEFT_DROP_S = 1.0;
// End of the intro typography reveal — the frame the Lottie holds while the
// figures fly.
export const LOTTIE_INTRO_S = 3;
export const LOTTIE_TOTAL_S = 8.6;

// ── Scroll-progress partition (0..1) ─────────────────────────────────────────
// Nothing autoplays after the loader releases:
//   [0, REVEAL_END]              Lottie reveal (DEFT_DROP_S → LOTTIE_INTRO_S)
//   [REVEAL_END, FIGURES_END]    4 figures fly overlapping domes; Lottie held
//   [FIGURES_END, LOTTIE_END]    Lottie scrubs to the end
//   VIDEO_START (< LOTTIE_END)   video fades in BEHIND the typography; the
//                                white letters occlude it; alphaTest gaps reveal it
//   [LOTTIE_END, 1]              Lottie fully done — pure video owns the frame
export const REVEAL_END = 0.17;
export const FIGURES_END = 0.55;
export const LOTTIE_END = 0.78;

// Scroll progress where the video starts fading in BEHIND the typography —
// the moment KONZEPTE has settled and the zoom-in begins (Lottie time ≈ 5.7s;
// the zoom segment starts at ~5.9s). The letters occlude the video; it shows
// through the alphaTest gaps, and owns the frame once the zoom passes through.
export const VIDEO_START = 0.66;

// Scroll-progress width of the video fade after VIDEO_START — fully in at
// VIDEO_START + VIDEO_FADE = 0.71 ≈ Lottie 6.9s, well before the zoom ends
// at ~8.5s.
export const VIDEO_FADE = 0.05;

// Fraction of a figure's own flight window spent fading in (and, mirrored,
// fading out) — windows overlap by 0.2, so 0.18 keeps any two concurrent
// figures from both being mid-fade at once.
export const FIGURE_FADE = 0.18;

// Total scrollable track height (vh). 800 gives the video phase ~154vh.
export const SCROLL_TRACK_VH = 800;
