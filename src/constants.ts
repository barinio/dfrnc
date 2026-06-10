// ── Lottie timeline (seconds) ────────────────────────────────────────────────
// The loader auto-plays [0, DEFT_DROP_S] (the "DEFT drop"); scroll then drives
// [DEFT_DROP_S, LOTTIE_TOTAL_S]. STAND-IN: the real Lottie export isn't in yet,
// so the first ~0.4 s of the current animation plays the drop's role. Chosen so
// the post-drop hold shows ONLY the DEFT word — MACHT is not yet visible at this
// frame (it first appears at ~0.5 s). Re-measure when the real export lands.
export const DEFT_DROP_S = 0.4;
// End of the intro typography reveal — the frame the Lottie holds while the
// figures fly.
export const LOTTIE_INTRO_S = 3;
export const LOTTIE_TOTAL_S = 8.6;

// ── Scroll-progress partition (0..1) ─────────────────────────────────────────
// Nothing autoplays after the loader releases:
//   [0, REVEAL_END]                    Lottie reveal (DEFT_DROP_S → LOTTIE_INTRO_S)
//   [REVEAL_END, LOTTIE_SCRUB_START]   figures fly sequential domes; Lottie held
//   [LOTTIE_SCRUB_START, LOTTIE_END]   Lottie scrubs to the end; the LAST figures
//                                      finish their exits inside this window —
//                                      every flight ends at FIGURES_END, before
//                                      the video fades in at VIDEO_START
//   VIDEO_START (< LOTTIE_END)         video fades in BEHIND the typography; the
//                                      white letters occlude it; alphaTest gaps reveal it
//   [LOTTIE_END, 1]                    Lottie fully done — pure video owns the frame
export const REVEAL_END = 0.17;
// Lottie hold ends and the typography starts appearing again. Decoupled from
// FIGURES_END so the tail of the figure sequence exits WHILE the text animates.
export const LOTTIE_SCRUB_START = 0.5;
// End of the figures phase. Must stay below VIDEO_START so the last figure's
// exit completes before the video shows up behind the typography.
export const FIGURES_END = 0.62;
export const LOTTIE_END = 0.78;

// Scroll progress where the video starts fading in BEHIND the typography —
// the moment KONZEPTE has settled and the zoom-in begins (Lottie time ≈ 5.7s;
// the zoom segment starts at ~5.9s). With the scrub on [0.5, 0.78] that Lottie
// moment lands at sp ≈ 0.5 + (2.7/5.6)·0.28 ≈ 0.64. The letters occlude the
// video; it shows through the alphaTest gaps, and owns the frame once the zoom
// passes through.
export const VIDEO_START = 0.64;

// Scroll-progress width of the video fade after VIDEO_START — fully in at
// VIDEO_START + VIDEO_FADE = 0.69 ≈ Lottie 6.8s, well before the zoom ends
// at ~8.5s.
export const VIDEO_FADE = 0.05;

// Fraction of a figure's own flight window spent fading in (and, mirrored,
// fading out). Windows are sequential (no overlap), so the fade only has to
// stay inside the figure's own window — 0.18 keeps entries/exits soft without
// eating the readable middle of the flight.
export const FIGURE_FADE = 0.18;

// Total scrollable track height (vh). 800 gives the video phase ~154vh.
export const SCROLL_TRACK_VH = 800;
