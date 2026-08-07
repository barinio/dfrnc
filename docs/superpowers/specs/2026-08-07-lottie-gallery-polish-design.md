# Lottie and Mobile Finale Polish

**Date:** 2026-08-07

## Goal

Apply the four approved visual corrections without introducing viewport-specific
timelines or reintroducing iOS URL-bar resize jumps:

1. use the supplied `titles_2.0.json` gallery-title export;
2. keep the next intro rows completely outside the composition until their
   entrance begins on every viewport;
3. let the `AUSGEZEICHNETES` overshoot settle before any 3D figure appears, and
   do not resume the Lottie until the final figure has left;
4. remove the darker strip below the final CTA on mobile.

## Root causes

- `src/assets/titles.json` is the previous export. The supplied replacement has
  corrected position and scale keyframes for the final gallery title.
- In `src/assets/animation.json`, the initial positions of `5_UND Outlines` and
  `6_ENTWICKELT Outlines` sit too close to the left and right composition edges.
  Antialiased edge pixels therefore enter the frame before the intended motion,
  especially on portrait screens.
- `LOTTIE_INTRO_S` currently stops at main frame 90. The
  `AUSGEZEICHNETES Outlines` scale animation overshoots through frame 93 and only
  settles at frame 103. The first figure also starts before the reveal ends, and
  the Lottie resumes while the last figure is still completing its exit.
- `.canvas-layer` deliberately uses `100svh` to avoid mobile toolbar resize
  jumps. When the toolbar collapses, the canvas no longer covers the enlarged
  visual viewport; the page's `#0a0a0a` background is then visible beneath the
  gallery's black finale.

## Design

### Gallery title asset

Replace `src/assets/titles.json` byte-for-byte with the supplied
`/Users/ivan/Downloads/titles_2.0.json`. `GalleryTitles` keeps its existing
rendering and frame mapping; only the authored animation data changes.

### Intro edge containment

Correct the two authored pre-entry positions globally rather than adding a
mobile mask:

- move the initial X position of `5_UND Outlines` from `-248` to `-260`;
- move the initial X position of `6_ENTWICKELT Outlines` from `1709` to `1745`.

Their destination positions, keyframe times, easing, scale, and all other intro
layers remain unchanged. These offsets put the complete glyph bounds beyond the
1000 px composition with an antialiasing guard, so desktop and mobile share the
same corrected source animation.

### Intro and 3D choreography

Use authored frames as timeline anchors:

- set the intro hold to frame 103 (`LOTTIE_INTRO_S = 103 / 30`);
- retain the reveal end at physical scroll position 136vh;
- move `FIGURES_START` from 100vh to 144vh, after the completed intro plus an
  8vh clean beat;
- retain `FIGURES_END` at 464vh;
- move `LOTTIE_SCRUB_START` from 328vh to 356vh. With the final figure window
  ending at phase fraction `0.66`, its exit completes at 355.2vh, immediately
  before the Lottie resumes.

`VIDEO_START`, `LOTTIE_ZOOM_S`, `LOTTIE_END`, the video caption knots, and the
gallery timeline remain unchanged. The frame-103-to-zoom segment keeps nearly
the same physical scroll pace as the existing post-settle animation.

### Mobile finale coverage

Keep `.canvas-layer` at `100svh`. Give the fixed, viewport-sized `.gallery-cta`
a black background. Its existing `clip-path` follows the last card's bottom
edge, so both the background and wordmark are revealed only below the rising
card. Once the card has left, the CTA covers the full current visual viewport,
including the area below the shorter canvas, with the same black as the gallery
backdrop.

This avoids `100dvh`, preserves the stable WebGL render size, and does not place
an opaque sheet over the card because the CTA remains clipped to the uncovered
region.

## Data flow and boundaries

- `useScrollProgressRef` continues to produce stable scroll progress.
- `lottieTimeFor` maps that progress to the corrected hold/resume anchors.
- `figureStateFor` uses the revised figure phase start while keeping each
  figure's local window unchanged.
- Lottie source data owns glyph containment; React and CSS do not mask letters.
- `CardStack` continues to write `ctaClipRef`; `GalleryCTA` applies the clip, and
  CSS supplies the final black coverage.

No new runtime state, media-query branch, or viewport-resize listener is added.

## Failure handling

The animation exports are static build assets. Automated checks will fail if a
future export removes the expected named layers, changes the settling frame, or
places the pre-entry glyph bounds back inside the composition. Existing asset
loading fallbacks remain unchanged.

## Verification

Add regression assertions before changing production behavior, then verify:

- the gallery-title asset contains the corrected final-layer position and
  keyframes from `titles_2.0.json`;
- the intro hold is frame 103 and is at or after the last
  `AUSGEZEICHNETES` settling keyframe;
- `FIGURES_START > REVEAL_END`;
- the final figure is complete before `LOTTIE_SCRUB_START`;
- both next-row pre-entry glyph bounds have a transparent guard outside the
  composition;
- existing playback assertions, typecheck, and production build pass;
- screenshots at 390x690 portrait and 1280x740 landscape show no early edge
  pixels and no post-3D `AUSGEZEICHNETES` jerk;
- the final mobile CTA remains uniformly black when the visible viewport is
  taller than the `100svh` canvas.

## Non-goals

- Redesigning the authored typography or 3D paths.
- Changing video-caption dwell timing, gallery card cadence, or CTA motion.
- Introducing a mobile-only animation timeline.
- Replacing `100svh` with a dynamically resizing WebGL canvas.
