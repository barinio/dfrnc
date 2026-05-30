// Boundary frame (in seconds) of the Lottie timeline that separates the intro
// typography reveal from the rest of the animation. The 3D arc plays while
// Lottie is held on this frame.
export const LOTTIE_INTRO_S = 3;
export const LOTTIE_TOTAL_S = 8.6;

// Scroll-progress breakpoints (0..1). The whole experience is scroll-driven —
// nothing autoplays:
//   [0, LOTTIE_INTRO_END]                Lottie reveals the intro (0 → LOTTIE_INTRO_S)
//   [LOTTIE_INTRO_END, MODEL_PHASE_END]  3D arc plays; Lottie held on its intro frame
//   [MODEL_PHASE_END, …]                 arc fades out, then Lottie plays to the end
// Scroll fraction spent on the Lottie intro reveal (0 → LOTTIE_INTRO_S). Wider
// range = slower reveal per unit scroll. 0.225 ≈ 0.8× the previous 0.18 speed.
export const LOTTIE_INTRO_END = 0.225;
export const MODEL_PHASE_END = 0.6;
export const SCROLL_TRACK_VH = 600;

// Length of the 3D arc playback (seconds); matches the Lottie total.
export const DURATION = 8.6;
// Width (in scroll-progress units) of the model fade in/out — symmetric so the
// transition is reversible on reverse scroll.
export const FADE_RANGE = 0.05;
