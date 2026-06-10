# Wave 2: Multi-Figure Flights, Video Tail, Bouncing-Ball Loader — Design

**Date:** 2026-06-09
**Status:** Approved
**Reference material:** `/Users/ivan/Downloads/Нова папка з елементами 5/`

## Context

DFRNC is a scroll-driven landing page: React + @react-three/fiber WebGL scene with a
glass GLB figure flying a Bézier dome over a scroll-scrubbed Lottie typography plane.
The timeline is derived from a scroll-progress ref read inside `useFrame`; pure
functions in `src/playback.ts` are the single source of truth. There is no test
runner — verification is visual (headless system Chrome + SwiftShader WebGL) plus
`npm run typecheck` and `npm run build`.

This wave covers five items:

1. Fix the figure's orientation so it reads **frontal at the arc apex** (regressed
   in `5b54bc1`, which moved the spin's face-on point from the apex to the end).
2. Soften the aliased ("chopped") edges on the Lottie letters and the glass figure.
3. Add three more figures (Tokyo TDC, GBA v-shape, Awwwards) flying their own domes
   in overlapping waves from alternating sides — all scroll-driven, frontal at apex.
4. Add a scroll-scrubbed FPV background video after the Lottie typography finishes.
   It **replaces** the Lorem placeholder section. Mobile crops it vertically with a
   phase-dependent horizontal pan so the baked-in taglines stay centered.
5. Replace the CSS-spinner preloader with the bouncing-balls loader
   (`load_loop.html` → `load_final.html` settle), followed by an auto-played
   "DEFT drop" intro from the new Lottie, then hand off to the scroll experience.

### Decisions made during brainstorming

- **Asset gap:** no Blender / After Effects in this environment, and the reference
  folder contains only sources (`vectors.blend`, `typo_1.1.aep`), no exports. The
  user exports `.glb` figures and the new Lottie `.json`; we build all wiring now,
  verifying against the current glass `&` model as a stand-in for every arc.
- **Choreography:** overlapping waves with alternating entry sides — each figure has
  its own dome, height, spin; ~1–2 airborne at once. Not all-four-at-once, not
  strictly sequential.
- **Video tail:** the FPV clip's taglines are already baked into the footage, so the
  video carries the message itself; `LoremSection` is removed entirely. The page
  ends holding the video's final frame.
- **Architecture:** extend the existing pure-function timeline (`playback.ts`)
  rather than adopting a timeline library. The loader is the one time-based (not
  scroll-based) piece and lives in its own self-contained component.

## Unified scroll timeline

Post-loader scroll progress `sp ∈ [0, 1]`. Current partition (`constants.ts`):
`[0–0.225]` Lottie reveal · `[0.225–0.6]` arc · `[0.6–1]` Lottie finish.

New partition — all breakpoints are named constants in `constants.ts`, exact values
tuned visually during implementation:

| Range | Phase |
|---|---|
| `[0, REVEAL_END]` | Lottie typography reveal (resumes where the loader's DEFT drop ended) |
| `[REVEAL_END, FIGURES_END]` | Four figures fly overlapping domes |
| `[FIGURES_END, LOTTIE_END]` | Lottie scrubs to the typography end |
| `[LOTTIE_END, 1]` | Lottie → FPV video crossfade; video scrubs to its last frame |

`SCROLL_TRACK_VH` grows from 600 to ≈800 to give the video phase room.
`LoremSection.tsx` and its GSAP ScrollTrigger pin are deleted (gsap may leave the
dependency tree entirely if nothing else uses it).

## Item 1 — Frontal at the apex

`ArcModel.tsx` currently computes `spinY = (1 - t) * spinTurns * 2π` (face-on at
`t = 1`). Restore apex-centred phasing: `spinY = (0.5 - t) * spinTurns * 2π`, so
every figure is edge-on entering, **frontal at `t = 0.5`** (the dome apex), and
edge-on leaving. `rollPeak` (the "С"-like tilt, peaking at the apex) stays as is.
The Leva `Spin/Turns` control keeps working; the change applies to all four figures.

## Item 2 — Edge smoothing

Root cause: `EffectComposer multisampling={0}` disables MSAA whenever the post
pipeline is active, so both the glass silhouette and the Lottie plane's
`alphaTest` cutout render unantialiased.

- Add an **SMAA pass** to the `EffectComposer` (from `@react-three/postprocessing`,
  already a dependency). It antialiases the alpha-test cutout and the mesh
  silhouettes in screen space.
- **Supersample the Lottie canvas:** render the offscreen lottie-web canvas at
  ~1.5–2× the display resolution (capped to keep mobile texture sizes sane) so the
  letter edges resolve crisply after texture filtering; enable anisotropy on the
  `CanvasTexture`.
- The Lottie material stays **opaque with `alphaTest`** — switching to alpha blend
  would remove it from the transmission buffer and break the glass refraction.

Acceptance: letter edges and figure silhouettes show no visible stair-stepping at
DPR 1 on a desktop viewport; mobile frame rate does not regress noticeably.

## Item 3 — Four figures, overlapping waves

### Arc system (`arc.ts`)

`ArcConfig` gains:

- `side: 1 | -1` — entry side; `-1` mirrors the dome left↔right.
- `spinTurns: number` — per-figure spin amount and direction.
- `window: [start, end]` — the figure's sub-window of the figures phase, expressed
  in normalized phase units `[0, 1]`; windows overlap so ~1–2 figures are airborne
  at any moment.

Four configs: `AND_ARC` (the existing figure, current shape values), `TOKYO_ARC`,
`GBA_ARC`, `AWWWARDS_ARC` — each with distinct peak height, leg spread, side, and
spin so the waves read dynamic rather than cloned. Entry sides alternate.

### Playback (`playback.ts`)

`modelStateFor` generalizes to `figureStateFor(sp, window, phase)`: maps the
figure's window within `[REVEAL_END, FIGURES_END]` to a local `t ∈ [0, 1]`, with
the same symmetric `FADE_RANGE` fade at both ends of *that figure's* window.
Outside its window a figure is invisible and unmounted (Scene-level discrete
visibility, same pattern as today's `modelVisibleFor`).

### Components

`ArcModel` is generalized to accept `{ url, config }` props instead of hardcoding
`model.glb` + `BLUE_ARC`. Each instance:

- loads its own GLB (`useGLTF`), applies the shared glass material;
- computes its own mirrored curve and local `t`;
- keeps the existing centering logic (bounding-box center compensation on Y/Z
  only — the X gotcha from the current model may differ per GLB, so the
  compensation is computed per-model from its own bounding box, preserving the
  "curve drives the visual center horizontally" behaviour);
- spin, roll, swing, and mouse parallax all work per-figure;
- Leva controls move to a per-figure folder so each arc remains live-tunable.

Glass material: one shared `MeshPhysicalMaterial` instance for all figures
(same look, fewer shader programs). Per-figure opacity is needed concurrently, so
opacity moves from the shared material to per-mesh handling (clone the material
per figure but share the configuration through the existing Leva effect, or use
per-instance material clones updated from the same control values — implementation
detail, but the constraint is: two overlapping figures must fade independently).

### Asset contract (user-provided exports)

```
public/figures/and.glb        ← current model.glb, moved
public/figures/tokyo.glb      ← Tokyo TDC export from vectors.blend
public/figures/gba.glb        ← GBA v-shape export
public/figures/awwwards.glb   ← Awwwards export
```

Until the real exports land, all four entries point at the current `&` GLB so the
choreography is built and verified now; swapping a file in `public/figures/`
requires no code change. Export guidance: GLB, single mesh or small hierarchy,
no materials needed (glass is applied at runtime), roughly unit scale.

## Item 4 — FPV video tail

### Behaviour

- New `VideoSection` DOM component (not in-canvas): a fixed, full-viewport
  `<video>` layered **above** `.canvas-layer` (the in-canvas gradient background
  is opaque, so the video can't show through from behind), `pointer-events: none`,
  `muted playsinline preload="auto"`, never autoplaying — `currentTime` is driven
  from scroll and the crossfade is the video element's own opacity.
- During `[LOTTIE_END, 1]`: the Lottie plane fades out (in-scene opacity) while
  the video fades in (DOM opacity) — crossfade matching
  `video integration sample.mov` — and `sp` maps linearly to
  `video.currentTime ∈ [0, duration]`.
- Scrubbing is decoupled from React: a `useFrame`-equivalent rAF loop reads
  `scrollRef` and sets `currentTime` only when the target changes by more than a
  frame (~1/30 s). Seeks are precise `currentTime` assignments, not `fastSeek`
  — fastSeek snaps to keyframes, which reads as visible jumps when scrubbing.
- The page ends holding the video's final frame. `LoremSection` is removed.

### Mobile

`object-fit: cover` crops the 16:9 frame in portrait. Because the baked taglines
sit off-center during parts of the clip, `object-position-x` is driven by a small
keyframe table `(videoTime → panX)` tuned visually, so the text stays centered
within the portrait crop. Desktop uses centered cover with no pan.

### Asset & performance

- Drop-in: `public/fpv.mp4` (the provided `260203_fpv_graphics.mp4`, 1920×1080,
  14.24 s, H.264).
- **Risk:** scroll-scrubbing a 46 MB clip with sparse keyframes can stutter, since
  every seek decodes from the previous keyframe. Build with the provided file
  first; if seeking is janky, request a scrub-optimized re-encode from the user
  (short GOP ≈ every 0.25–0.5 s, `+faststart`, possibly 720p for mobile) — no
  ffmpeg in this environment. A poster frame (first video frame) shows until the
  video has buffered enough to scrub.

## Item 5 — Loader sequence

A self-contained `Loader` component (DOM canvas over the dark page background)
replaces the CSS `dfrnc-spinner`. Time-based state machine:

```
bounce-loop ──(assets ready AND ≥1 full cycle done)──▶ settle ──▶ deft-drop ──▶ release
```

1. **bounce-loop** — port of `load_loop.html`: four white balls traverse
   left→right with physically-decaying bounces (the reference scripts are ported
   as-is: same constants, squash/stretch, motion blur). Loops with its
   2.5 s travel + 1.5 s pause cycle. Runs while GLTF/Draco/Lottie load
   (`useProgress` + Lottie `DOMLoaded`, as today). **Minimum one full cycle** even
   if assets load instantly.
2. **settle** — port of `load_final.html`: at the next cycle boundary, balls switch
   to the momentum-loss physics — bounces decay, balls roll along the floor and
   off the right edge.
3. **deft-drop** — the canvas hands off to the Lottie plane, which **auto-plays**
   the first ~2 s of the new animation (DEFT falling top→bottom). This is the one
   scroll-independent segment of the Lottie. Scroll stays locked.
4. **release** — scroll unlocks; the scroll timeline takes over exactly at
   `DEFT_DROP_S`, i.e. `lottieTimeFor` maps `[0, REVEAL_END]` to
   `[DEFT_DROP_S, LOTTIE_INTRO_S]`. Scrolling back up never re-enters the loader
   or the drop (floor the Lottie time at `DEFT_DROP_S`).

Scroll-lock: `body.scroll-locked` (already in `index.css`) for the duration of
loader + drop; `prefers-reduced-motion` users skip the entire sequence and land on
the final-frame state, as today.

### Asset contract / assumption

`typo_1.1.aep` exports to a new `src/assets/animation.json` that **replaces** the
current one: its first ~2 s are the DEFT drop, and the existing
reveal→DESIGN sequence follows. Constants `LOTTIE_INTRO_S` / `LOTTIE_TOTAL_S` /
`DEFT_DROP_S` are re-measured from the new export. **Fallback if the export turns
out to be a separate standalone clip:** wire it as its own short Lottie layer that
plays during deft-drop and swaps to the main animation at release — small,
contained change to `LottiePlane`.

Until the export lands, the loader's deft-drop phase plays the first 2 s of the
*current* animation as a stand-in, behind a named constant.

## Component / file changes

| File | Change |
|---|---|
| `src/constants.ts` | New breakpoints (`REVEAL_END`, `FIGURES_END`, `LOTTIE_END`, `DEFT_DROP_S`), `SCROLL_TRACK_VH` ≈ 800 |
| `src/playback.ts` | `figureStateFor(sp, window, phase)`, `videoStateFor(sp, phase)`, updated `lottieTimeFor` (drop offset + new partition) |
| `src/arc.ts` | `ArcConfig` + `side`/`spinTurns`/`window`; four configs; mirroring in `makeArc` |
| `src/components/ArcModel.tsx` | Parameterized `{ url, config }`; apex-centred spin; per-figure opacity |
| `src/components/Scene.tsx` | Render 4 `ArcModel`s with discrete per-figure visibility; SMAA pass; `Loader` replaces `Preloader`; `VideoSection` replaces `LoremSection` |
| `src/components/Loader.tsx` | New — bounce-loop/settle canvas + state machine |
| `src/components/LottiePlane.tsx` | Supersampled canvas + anisotropy; deft-drop autoplay window; time floor at `DEFT_DROP_S` |
| `src/components/VideoSection.tsx` | New — scroll-scrubbed video, crossfade, mobile pan table |
| `src/components/LoremSection.tsx` | Deleted |
| `public/figures/*.glb`, `public/fpv.mp4` | New assets (stand-ins until exports land) |

## Error handling

- **Missing/failed GLB:** `useGLTF` suspends per figure inside the existing
  `<Suspense>`; a figure that fails to load must not block the others or the
  loader release (per-figure `<Suspense>`/error boundary so one bad export
  degrades to "that figure absent").
- **Video can't seek/play** (e.g. data-saver, decode failure): the video phase
  degrades to the poster frame; the scroll timeline is unaffected.
- **Reduced motion:** loader sequence and figure flights skipped entirely; Lottie
  jumps to final frame; video shows its final frame (or poster) statically.

## Verification

Headless system Chrome + Puppeteer (`puppeteer-core --no-save`, SwiftShader WebGL),
per the established workflow:

- Loader: screenshot bounce-loop, settle, deft-drop stages (time-driven, so
  screenshots at fixed delays).
- Figures: for each figure, screenshot at its window's apex `sp` and verify
  frontal orientation (compare silhouette width/height ratio against the known
  frontal pose) and that overlapping windows show 2 figures concurrently.
- Edges: zoomed crops of letter edges before/after SMAA at DPR 1.
- Video: screenshots across `[LOTTIE_END, 1]` confirming crossfade and scrub
  motion; mobile-viewport screenshots confirming the centered-text crop.
- `npm run typecheck` && `npm run build`.

Raw pixel diffs are unusable (animated noise + `uTime` gradient) — compare
structure, not pixels.

## As built — authorized drift (2026-06-10)

Implementation deviations approved during execution review; intent unchanged:

- **The video is IN-SCENE, behind the typography (revised 2026-06-10 on user
  request).** Not a DOM layer: an R3F `VideoPlane` (VideoTexture) sits at
  z = −1.5 between the opaque alphaTest Lottie plane (z = −1) and the gradient
  (z = −2). From `VIDEO_START = 0.66` (Lottie ≈ 5.7 s — KONZEPTE settled, zoom
  beginning) the video fades in BEHIND the white letters, visible through the
  letter gaps, and owns the frame once the zoom passes through. Cover-crop +
  portrait pan are texture-transform equivalents of the old object-fit/position
  (pan strictly portrait-only). The scene's film grain now covers the video
  too. Failure mode: a video error latches the plane invisible (dark gradient
  stays); the poster file was removed with the DOM layer.
- **`DEFT_DROP_S` = 0.4 s stand-in** (current animation) rather than "~2 s" —
  chosen so the post-drop hold shows ONLY the DEFT word (MACHT enters at
  ≈0.5 s). Re-measure when the real Lottie export lands.
- **Lottie supersampling is 1.25× desktop / 1.0× phone-class** (short axis
  ≤ 480 px), not 1.5–2× — tuned down after the FPS check (texture-upload cost).
- **Figure centering compensates all three axes**: the curve point drives the
  figure's visual center on X, Y and Z (the GLB pivots sit far from the
  geometry; the spec's Y/Z-only rule was an artifact of the original model).
  `peakHeight` therefore reads directly as the apex height of the visual center.
- **Loader settle trigger** is "assets ready AND ≥ 1 full travel pass AND
  screen momentarily empty" — the empty window begins exactly at the travel
  end, so this equals the spec's "next cycle boundary" in practice.
- **Reduced motion holds the readable intro frame** (`LOTTIE_INTRO_S`) until
  `FIGURES_END`, then swaps discretely to the final frame (covered by the
  video tail). The spec's "jump straight to the final frame" left the page
  blank for ~78 % of the track because the final frame is empty.
- **Figure GLBs are the real user exports** (tokyo/gba/awwwards delivered
  2026-06-10); `public/figures/*` remains drop-in.

## Out of scope

- Producing the GLB / Lottie / re-encoded video exports themselves (user-provided).
- Real copy to replace the deleted Lorem section (the video tail carries the page).
- Any autoplay behaviour beyond the loader's deft-drop segment.
