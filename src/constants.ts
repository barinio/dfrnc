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
//   [LOTTIE_SCRUB_START, VIDEO_START]  the words finish assembling/settling at
//                                      their reading pace (→ LOTTIE_ZOOM_S, where
//                                      KONZEPTE has just settled); the LAST
//                                      figures finish their exits inside here
//   VIDEO_START                        video fades in BEHIND the typography; the
//                                      white letters occlude it; alphaTest gaps reveal it
//   [VIDEO_START, LOTTIE_END]          the SHORT zoom-through: letters accelerate
//                                      past the camera and clear by LOTTIE_END —
//                                      kept tight so the typography is gone BEFORE
//                                      the video's baked caption appears (else the
//                                      giant letters block it, unreadable)
//   [LOTTIE_END, 1]                    Lottie fully done — pure video owns the frame
export const REVEAL_END = 0.17;
// Start of the figures phase. Sits INSIDE the Lottie reveal: AUSGEZEICHNETES
// (the last word to appear) animates in at sp ≈ 0.147–0.158 (measured), and the
// first figure must already be flying before it settles. With FIGURE_FADE 0.18
// of a 0.34-wide window, the first figure is fully opaque by sp ≈ 0.153.
export const FIGURES_START = 0.125;
// Lottie hold ends and the typography starts appearing again. Decoupled from
// FIGURES_END so the tail of the figure sequence exits WHILE the text animates.
// Pulled in from 0.5 → 0.41 when gba's flight was sped up (its window narrowed
// 0.55 → 0.36, so it lands ~0.09 sp earlier): the scrub now resumes right as gba
// touches down (sp ≈0.425), keeping the background continuation tight with no
// dead-air hold. The readable-words assembly [LOTTIE_SCRUB_START, VIDEO_START] is
// correspondingly a touch slower; its endpoints (LOTTIE_INTRO_S → LOTTIE_ZOOM_S
// at VIDEO_START) are unchanged, so the zoom-through / caption timing is intact.
export const LOTTIE_SCRUB_START = 0.41;
// End of the figures phase. Must stay below VIDEO_START so the last figure's
// exit completes before the video shows up behind the typography.
export const FIGURES_END = 0.58;
// The Lottie reaches its final (empty) frame here — the zoom-through has fully
// passed the camera and the typography is gone. Pulled in from 0.78 so the
// letters clear BEFORE the video's baked caption ("WIR SIND EIN KLEINES…",
// on-screen at video-time ≈2.8–7.5s ⇒ sp ≈ 0.682–0.77): with the old 0.78 the
// caption played its whole life behind the still-zooming giant letters and was
// unreadable. Must stay ≤ ~0.682 (caption onset) so the frame is clean when it
// appears. The zoom-through window is [VIDEO_START, LOTTIE_END] (see
// lottieTimeFor) — keep it short for a snappy fly-past, not a lingering zoom.
export const LOTTIE_END = 0.68;

// Lottie time (s) reached at VIDEO_START — the seam between the readable-words
// assembly and the zoom-through. KONZEPTE has just settled and the zoom is about
// to begin (~6.1s). Kept at the value the old single linear scrub produced at
// VIDEO_START so segment 1 ([LOTTIE_SCRUB_START, VIDEO_START]) preserves the
// original reading pace exactly; only the zoom-through after it was tightened.
export const LOTTIE_ZOOM_S = 5.72;

// Scroll progress where the video starts fading in BEHIND the typography —
// anchored to the moment KONZEPTE has settled (Lottie t ≈ LOTTIE_ZOOM_S, sp ≈
// 0.6312) just before the zoom-in begins (~6.1s). The letters occlude the video;
// it shows through the alphaTest gaps, then the (now short) zoom-through clears
// them. Measured from real export (Animation - 1781083424055.json).
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
//
// The gallery is mapped scrollY → gp PIECEWISE across two sub-tracks (see
// galleryProgressFrom) so each phase gets its OWN scroll budget:
//   • VIDEO_CARD_TRACK_VH drives gp ∈ [0, VID_FLY_END] (the FPV morphing into
//     slide #1, holding, flying away). Given a SHORT track so the morph feels
//     responsive: the old single 700vh track linear-mapped the morph onto
//     ~112vh (≈2 screens) and the scroll felt like it stuck. 140vh ⇒ morph
//     ≈56vh.
//   • IMAGE_GALLERY_TRACK_VH drives gp ∈ [VID_FLY_END, 1] (8 image cards +
//     titles + CTA). Kept at the old 0.6 × 700 = 420vh so the image-card cadence
//     is UNCHANGED — only the video-card phase was compressed.
export const VIDEO_CARD_TRACK_VH = 140;
export const IMAGE_GALLERY_TRACK_VH = 420;
// Total appended gallery track. The App.tsx scroll-track spacer and the gp
// denominator in check-playback both use this sum.
export const GALLERY_TRACK_VH = VIDEO_CARD_TRACK_VH + IMAGE_GALLERY_TRACK_VH;

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
