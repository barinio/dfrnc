# Lottie, Gallery, and Mobile Playback Polish

**Date:** 2026-08-07

## Goal

Apply the six approved corrections without introducing viewport-specific visual
timelines or reintroducing iOS URL-bar resize jumps:

1. use the supplied `titles_2.0.json` gallery-title export;
2. keep the next intro rows completely outside the composition until their
   entrance begins on every viewport;
3. let the `AUSGEZEICHNETES` overshoot settle before any 3D figure appears, and
   do not resume the Lottie until the final figure has left;
4. remove the darker strip below the final CTA on mobile;
5. reduce cold-start decode/render contention on phones without making the
   loader wait for all 295 video frames;
6. cap forward FPV progress at the source video's native 1x rate, allow slower
   movement or an immediate stop, and prevent the same fling from spilling into
   the following image slides.

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
- `FrameSequenceLoader` starts all 295 mobile images immediately with eight
  concurrent `<img>` requests and retains every element. Production already
  gives the encoded WebPs a one-year immutable cache, but a reload still has to
  recreate image decode state and WebGL uploads. Explicitly decoding every
  1280x720 frame would expose roughly 1 GiB of raw image data and is unsafe on
  iOS.
- The current render regressor calls `performance.regress()`, but no
  `AdaptiveDpr` consumer applies `performance.current` to the Canvas DPR. Weak
  phones therefore remain at the expensive upper DPR after slow frames.
- The caption dwell changes only the spatial mapping from scroll pixels to
  clip time. It is not a temporal speed limit: a fast scenic sweep was measured
  at roughly 2.26x native video speed, and raw `scrollY` independently advances
  gallery progress. One fling can therefore outrun the clip and enter later
  slides.
- The 295-frame sequence represents approximately 12.52 fps. Inside the caption
  dwells, one authored frame can remain visible for roughly 43--53 px on common
  phone heights, which can read as stepping even while renderer frame delivery
  is stable. The slow mapping reduces, rather than increases, texture uploads.

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

### Staged frame readiness and adaptive rendering

Do not gate the intro on, or explicitly decode, all 295 frames. Replace the
single eager bulk phase with a responsive two-stage loader:

- first request the first nine coarse-to-fine anchors (frame 0 plus eight
  anchors spread across the clip), using a lower mobile concurrency budget;
- consider startup coverage ready when frame 0 has completed `decode()` and the
  anchor requests have settled, with the existing timeout still preventing a
  deadlock;
- reserve capacity for the currently requested frame and a small directional
  neighbor window;
- fill the remaining encoded frames opportunistically at low concurrency,
  yielding between batches; Safari uses a timer fallback when no idle callback
  exists;
- retain nearest-loaded fallback behavior so the canvas never goes blank.

Desktop uses the same scheduling model with a slightly larger concurrency
budget. This addresses the shared architectural pressure while keeping mobile
more conservative. Encoded assets continue to use the existing immutable Vercel
cache.

Mount `AdaptiveDpr` inside the Canvas so the existing sustained-slow-frame
regressor actually lowers render resolution and later restores it. Cap/hide the
intro Lottie from its unsmoothed target once `LOTTIE_END` has been crossed so its
30 Hz canvas uploads cannot trail into the first video-caption window.

Do not add all-frame `decode()`, double the source-frame assets, or introduce a
second blended video texture in this pass. Those approaches add memory, transfer,
or GPU cost before the staged loader and 1x governor have been measured on the
real device.

### Native-speed scroll governor

Replace the two independent raw-scroll hooks with one gesture-aware controller
that owns a shared virtual scroll cursor and returns both animation progress
(`sp`) and gallery progress (`gp`). It keeps the existing cached-height rule, so
mobile URL-bar height changes cannot separate the `sp` and `gp` seam.

The governor is active from `VIDEO_START` through the end of the FPV card at
`gp = VID_FLY_END`:

- existing scroll deltas still express the user's desired movement, including
  both authored caption dwells;
- forward clip-time movement is clamped to
  `activeInputSeconds / 23.56 seconds`, so it can never exceed native 1x;
- a smaller delta is preserved exactly, and zero new input produces zero clip
  movement--there is no rAF catch-up or stored time credit;
- reverse movement stays immediate and uncapped, matching the approved
  responsive rewind behavior;
- excess forward delta is discarded, never queued;
- a touch/wheel gesture that began while the FPV was active may reach
  `gp = VID_FLY_END` but cannot spend its remaining momentum in the image
  gallery. A new gesture may then advance the gallery with its current cadence.

Native scrolling remains enabled while the finger is down. The fixed canvas
uses the governed virtual cursor while raw `scrollY` is only the input signal.
On gesture end, the controller re-anchors the real scroll position to the
virtual cursor and suppresses residual positive momentum until the scroll stream
is quiet. Re-anchoring happens after lift, avoiding a fight with Safari's
compositor during the drag, and is visually hidden by the fixed scene.

Touch gestures are grouped by `touchstart`/`touchend`; trackpad/wheel input uses
a short quiet window. Keyboard and generic scroll events use the same forward
cap where they can be attributed to an active input burst. Programmatic jumps
without a user-input burst remain available to the verification harness.
Reduced-motion mode bypasses the governor.

## Data flow and boundaries

- A shared scroll-timeline controller produces stable `sp` and `gp` refs from
  one virtual cursor; pure helpers own rate limiting and the monotonic
  clip-time-to-scroll inverse.
- `lottieTimeFor` maps that progress to the corrected hold/resume anchors.
- `figureStateFor` uses the revised figure phase start while keeping each
  figure's local window unchanged.
- `VideoPlane`, `CardStack`, `GalleryTitles`, and the CTA consume the same
  governed refs, so raw fling momentum cannot advance one phase independently.
- `FrameSequenceLoader` separates startup anchors, current-target priority, and
  low-priority fill while preserving its nearest-loaded API.
- Lottie source data owns glyph containment; React and CSS do not mask letters.
- `CardStack` continues to write `ctaClipRef`; `GalleryCTA` applies the clip, and
  CSS supplies the final black coverage.

## Failure handling

The animation exports are static build assets. Automated checks will fail if a
future export removes the expected named layers, changes the settling frame, or
places the pre-entry glyph bounds back inside the composition. Existing asset
loading timeouts remain unchanged.

A failed anchor does not deadlock readiness: settled anchor requests count
toward startup coverage, frame 0 retains the existing timeout escape, and the
nearest-loaded fallback continues to render available content. Unsupported idle
scheduling falls back to bounded timer batches.

The governor resets its input budget on gesture start/end, direction change,
tab visibility changes, and long input gaps. Its own scroll re-anchor is guarded
so it cannot recursively consume the programmatic scroll event.

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
  taller than the `100svh` canvas;
- startup readiness requires decoded frame 0 plus settled coarse anchors, while
  the rest of the sequence remains background work;
- target-priority loading is not starved by background fill and nearest-loaded
  fallback remains bounded;
- a 10,000 px/16 ms forward input cannot advance clip time by more than
  `16 ms / 23.56 s`, while a smaller input remains unchanged;
- idle time cannot be banked into a later burst, stopping input stops the
  virtual timeline, and excess delta never catches up;
- the gesture that reaches video end cannot produce `gp > VID_FLY_END`, while a
  fresh gesture can enter the image gallery;
- the `sp`/`gp` seam stays continuous through height-only URL-bar changes;
- a mobile active-scroll probe records clip speed at or below 1.05x, no carried
  gallery progress, bounded desired/resolved frame gap, and improved cold-load
  long-task pressure;
- existing playback assertions, render-profile assertions, typecheck, build,
  mobile/desktop screenshots, seam verification, and frame-lag verification
  pass.

## Non-goals

- Redesigning the authored typography or 3D paths.
- Changing video-caption dwell knots, fresh-gesture gallery cadence, or CTA
  motion.
- Introducing a mobile-only animation timeline.
- Replacing `100svh` with a dynamically resizing WebGL canvas.
- Autoplaying a queued video catch-up after the user stops.
- Limiting a new gesture that starts inside the image gallery to one card; only
  spillover from the still-active FPV gesture is blocked.
