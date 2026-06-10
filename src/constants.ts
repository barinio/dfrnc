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
//   [LOTTIE_END, 1]              video crossfades in and scrubs to its last frame
export const REVEAL_END = 0.17;
export const FIGURES_END = 0.55;
export const LOTTIE_END = 0.78;

// Scroll-progress width of the video crossfade after LOTTIE_END.
export const VIDEO_FADE = 0.05;

// Fraction of a figure's own flight window spent fading in (and, mirrored,
// fading out) — windows overlap by 0.2, so 0.18 keeps any two concurrent
// figures from both being mid-fade at once.
export const FIGURE_FADE = 0.18;

// Total scrollable track height (vh). 800 gives the video phase ~175vh.
export const SCROLL_TRACK_VH = 800;
