// ── Lottie timeline (seconds) ────────────────────────────────────────────────
// Real export: Animation - 1781083424055.json, 30 fps / 266 frames.
// The loader auto-plays [0, DEFT_DROP_S] (the "DEFT drop"); scroll then drives
// [DEFT_DROP_S, LOTTIE_TOTAL_S].
// DEFT_DROP_S = 1.0s — DEFT has landed and settled at its final position;
// MACHT is not yet visible (first appears at ~1.2s). Confirmed by probe.
export const DEFT_DROP_S = 1.0;
// LOTTIE_INTRO_S = frame 103 — the full 4-word block
// (DEFT/MACHT/AUSGEZEICHNETES/DESIGN) has completed its authored settle. This
// exact frame is held through the 3D sequence so AUSGEZEICHNETES cannot finish
// moving after the figures have disappeared.
export const LOTTIE_INTRO_S = 103 / 30;
export const LOTTIE_TOTAL_S = 266 / 30; // 8.8667s — 30 fps, 266 frames

// Total scrollable track height (vh). Raised 800 → 1000 ("прям дуже повільно"
// round), then rebuilt 2026-07-29 (client: the caption slowdown still "не
// видно"): the caption dwells in VIDEO_TIME_KNOTS now cover ONLY the readable
// text windows at slope 0.5 clip-frac per 1000vh (was ≈1; the first cut at 0.3
// stepped ≈11vh per source frame and read as jerky — supervisor: "дьорганим",
// → 0.5 ≈ 6.8vh/frame) and ALL the extra vh land there. The pre-video phases
// keep their exact vh budgets: every sp constant below is expressed as
// vh / track, so growing the track never retimes them.
export const SCROLL_TRACK_VH = 1240;

// ── Scroll-progress partition (0..1) ─────────────────────────────────────────
// Nothing autoplays after the loader releases:
//   [0, REVEAL_END]                    Lottie reveal to the completed frame-103
//                                      settle (DEFT_DROP_S → LOTTIE_INTRO_S)
//   (REVEAL_END, FIGURES_START)        8vh clean beat on the settled title
//   [FIGURES_START, FIGURES_END]       figures fly overlapping domes; Lottie
//                                      remains held through the last landing
//   [LOTTIE_SCRUB_START, VIDEO_START]  the words finish assembling/settling at
//                                      their reading pace (→ LOTTIE_ZOOM_S, where
//                                      KONZEPTE has just settled); this resumes
//                                      immediately after GBA has fully exited
//   VIDEO_START                        video fades in BEHIND the typography; the
//                                      white letters occlude it; alphaTest gaps reveal it
//   [VIDEO_START, LOTTIE_END]          the SHORT zoom-through: letters accelerate
//                                      past the camera and clear by LOTTIE_END —
//                                      kept tight so the typography is gone BEFORE
//                                      the video's baked caption appears (else the
//                                      giant letters block it, unreadable)
//   [LOTTIE_END, 1]                    Lottie fully done — pure video owns the frame
// Each constant is the phase boundary's PHYSICAL scroll position in vh (on the
// 800vh track these were 0.17·800 = 136vh etc.); dividing by SCROLL_TRACK_VH
// keeps the budgets byte-identical across track growth.
export const REVEAL_END = 136 / SCROLL_TRACK_VH;
// Start of the figures phase, after an 8vh clean beat on the fully settled
// frame-103 title.
export const FIGURES_START = 144 / SCROLL_TRACK_VH;
// Lottie hold ends immediately after the final GBA window lands at 355.2vh.
// The 0.8vh separation guarantees the 3D exit is complete before the background
// typography continues, without introducing a perceptible dead-air pause.
export const LOTTIE_SCRUB_START = 356 / SCROLL_TRACK_VH;
// End of the figures phase. Must stay below VIDEO_START so the last figure's
// exit completes before the video shows up behind the typography.
export const FIGURES_END = 464 / SCROLL_TRACK_VH;
// The Lottie reaches its final (empty) frame here — the zoom-through has fully
// passed the camera and the typography is gone. Pulled in from 0.78 so the
// letters clear BEFORE the video's baked caption ("WIR SIND EIN KLEINES…",
// on-screen at video-time ≈2.8–7.5s ⇒ sp ≈ 0.682–0.77): with the old 0.78 the
// caption played its whole life behind the still-zooming giant letters and was
// unreadable. Must stay ≤ the caption-1 onset knot (545.6vh — see
// VIDEO_TIME_KNOTS) so the frame is clean when it appears. The zoom-through
// window is [VIDEO_START, LOTTIE_END] (see lottieTimeFor) — keep it short for a
// snappy fly-past, not a lingering zoom.
export const LOTTIE_END = 544 / SCROLL_TRACK_VH;

// Lottie time (s) reached at VIDEO_START — the seam between the readable-words
// assembly and the zoom-through. KONZEPTE has just settled and the zoom is about
// to begin (~6.1s). Kept at the value the old single linear scrub produced at
// VIDEO_START so segment 1 ([LOTTIE_SCRUB_START, VIDEO_START]) preserves the
// original reading pace exactly; only the zoom-through after it was tightened.
export const LOTTIE_ZOOM_S = 5.72;

// Scroll progress where the video starts fading in BEHIND the typography —
// anchored to the moment KONZEPTE has settled (Lottie t ≈ LOTTIE_ZOOM_S) just
// before the zoom-in begins (~6.1s). The letters occlude the video; it shows
// through the alphaTest gaps, then the (now short) zoom-through clears them.
// Measured from real export (Animation - 1781083424055.json).
export const VIDEO_START = 504 / SCROLL_TRACK_VH;

// Scroll-progress width of the video fade after VIDEO_START. Tuned so the video
// reaches 100% opacity at VIDEO time ≈ 1.4s (direction): the fade completes just
// over halfway to the caption-1 onset knot (clip frac 0.11).
export const VIDEO_FADE = 22.4 / SCROLL_TRACK_VH;

// Fraction of a figure's own flight window spent fading opacity in/out.
// ZERO by design: per supervisor direction the figures must NOT change opacity —
// they simply fly in from below the frame and back out (the arc roots sit fully
// off-screen, see ArcConfig.rootDepth ≥ ~1.4), so entry/exit reads as motion,
// not a dissolve. Because there is no fade-out to mask overlaps, two glass
// figures can be fully opaque at once during a cascade overlap; that is
// acceptable (they are transmissive, and the tokyo×gba crossing already showed
// two at once). figureStateFor returns a binary 0/1 opacity when this is 0.
export const FIGURE_FADE = 0;

// The video card remains native-scroll-driven through its morph, hold and exit.
export const VIDEO_CARD_TRACK_VH = 140;

// Small real document span used only to enter/leave the pinned photo gallery.
// Photo cards themselves advance by semantic gestures and consume no scroll
// distance, so the scrollbar never runs ahead of the visible gallery.
export const GALLERY_PIN_TRACK_PX = 300;

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

// Authored duration of the FPV source clip. The scroll governor uses this to
// cap forward playback at native 1x without coupling the mapping to frame count.
export const VIDEO_DURATION_S = 23.56;
