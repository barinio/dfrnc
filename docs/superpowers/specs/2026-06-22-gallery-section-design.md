# Gallery section — design

Date: 2026-06-22

A new scroll section appended **after the FPV video** reaches its last frame.
It presents the studio's offer as a sequence of title frames over a stacked,
cursor-reactive image gallery, ending on a small call-to-action. Source of
truth for the visual spec: `~/Downloads/gallery web (1).pdf` (annotated
mockups) and `~/Downloads/titles.json` (the supplied title Lottie).

## Goal

After the video's held last frame, the experience continues "top/bottom again"
(titles grow in from the top and bottom edges, as in the intro). The centre of
the frame holds a stack of images that reacts to the cursor like the glass
figures do (https://radiance.family/ feel) and, on scroll, the front card
**flies up** and out while the next cycles in. A final frame shows a centered
call-to-action linking to `mailto:hi@deft.ch`.

## Scope (this spec)

In:
- A new gallery phase, pinned and scrubbed by scroll, appended after the
  existing animation track. The existing intro/figures/video timeline is
  **unchanged**.
- Title lines driven by `titles.json` (3 title frames), stretched full width.
- A 3-visible-card stack with cursor tilt + idle drift and scroll-driven
  fly-up cycling. Card images are **placeholders, drop-in later** (data-driven
  array under `public/gallery/`, mirroring how figure GLBs are drop-in).
- A final CTA frame (DOM overlay, `mailto:hi@deft.ch`).
- The gallery uses a **3% vmin** gutter. The existing intro Lottie/video inset
  stays at **2%** (unchanged) — the brief's "3% not 2%" refers to *this* new
  section, not the intro.

Out (later / not now):
- Real gallery imagery and final CTA wording/typeface (explicitly "yet to be
  worded" in the spec).
- Any change to the intro/figures/video animation content.

## Scroll model — additive, existing timeline untouched

`useScrollProgress` already documents that "content placed after the track
doesn't dilute progress": it divides `scrollY` by the **animation** track height
and clamps to 1. The gallery is therefore purely additive.

- Append a `GALLERY_TRACK_VH` spacer (~600vh, tunable) after the existing
  `SCROLL_TRACK_VH` (800vh) spacer. The canvas stays `position: fixed`.
- Extend the scroll hook to expose a **second progress `gp` ∈ [0,1]** measuring
  scroll *beyond* the animation track:
  `gp = clamp((scrollY − animTrackMax) / galleryMax, 0, 1)`, where
  `galleryMax = GALLERY_TRACK_VH/100 × innerHeight`. Computed in the same
  passive scroll listener that produces `sp`; both returned as refs.
- `sp` stays clamped at 1 throughout the gallery (video held on last frame).
  Every existing component reads `sp` exactly as today; only the new gallery
  components read `gp`.

### `gp` partition

- `[0, FADE]` (FADE ≈ 0.06): the held video last frame fades to flat black (the
  `GalleryBackdrop`), so the gallery sits on the PDF's black background.
- `[FADE, CTA_START]`: titles scrub `titles.json` 0→100 **and** the card
  conveyor cycles, locked to finish together (cadence tuned visually). At the
  start the first title frame grows in from the top/bottom edges and the first
  cards enter from below.
- `[CTA_START, 1]`: titles + cards gone (last card has flown up); the CTA frame
  fades in.

All `gp` mapping lives in pure functions in `src/gallery.ts` so it is unit
-assertable from `scripts/check-playback.ts`.

## Layout (the PDF's 100vh vertical partition)

Landscape (aspect ≥ 1:1), summing to 100vh:

```
3vh  gutter
8vh  top title line       (top-oriented)
3vh  gutter
64vh card stack           (3:2 → 96vh wide)
3vh  gutter
16vh bottom title         (two lines)
3vh  gutter
```

- Gutter = **3% vmin** around typography and images and between them.
- Card stack: 3:2, occupies 64vh tall / 96vh wide at aspect ≥ 1:1. At aspect
  < 1:1 it stays 64vh tall but its width tracks the viewport at **86vw**
  (squeezing the 3:2). Corner radius **2.5% vh**.
- Cap horizontal aspect at **16:9**; beyond that, empty space left/right
  (letterbox the section).
- The intro Lottie keeps its existing **2% vmin** inset (`PADDING_RATIO`,
  unchanged); only the gallery uses the **3% vmin** gutter.

`titles.json` (1000×1000, 50fps, 100 frames) already encodes the three frames
at the correct positions — top line in the top ~8%, bottom line(s) in the
bottom ~16% — so a full-frame stretched render (`preserveAspectRatio:"none"`),
inset by the 3% gutter, reproduces the layout. Scrub timeline (verified from the
file):

- frames 0–25: top line **WIR LIEFERN** grows in
- 25–50: bottom **STRATEGISCHE KOMMUNIKATION** grows in → *frame 1 complete*
- 50–75: bottom swaps to **DESIGN NACH MASS** (top holds) → *frame 2*
- 75–100: top swaps **WIR LIEFERN→UND DIE**, bottom **→GANZ GROSSEN BILDER**
  → *frame 3*

The CTA frame ("«small call to action, yet to be worded.»") is **not** in the
Lottie — it is a separate element (below).

## Components (new, focused files)

- **`src/gallery.ts`** — pure data + functions: the placeholder image array,
  the `gp` partition (`galleryBackdropFor`, `galleryTitleTimeFor`,
  `cardConveyorFor`, `galleryCtaFor`), and layout constants (gutter 3%, top 8vh,
  cards 64vh, bottom 16vh, radius 2.5vh, max aspect 16:9). Mirrors the
  `arc.ts` + `playback.ts` pattern; no React, no Three.
- **`GalleryBackdrop`** — full-bleed black plane in front of the held video
  (z just greater than −3.5), opacity driven by `galleryBackdropFor(gp)` over
  `[0, FADE]`. The video scrubs to its last frame, then this fades it to flat
  black for the gallery; `VideoPlane` needs no change (it is simply covered).
  Post-process grain is already 0 (`sp` pinned at 1 → `videoIn = 1`).
- **`GalleryTitles`** — renders `titles.json` to a `CanvasTexture` on a plane
  sized to fill the frustum at its depth minus the 3% gutter,
  `preserveAspectRatio:"none"`, scrubbed by `galleryTitleTimeFor(gp)` with the
  same smoothing/dedup approach as `LottiePlane`. **Titles never tilt** (the
  cursor effect is "without texts"). A shared Lottie-texture helper may be
  extracted from `LottiePlane`; kept as its own component because its sizing and
  scrub source differ.
- **`GalleryCard`** — one image plane, 3:2, `cover`-fit, **rounded corners**
  (2.5vh radius) via an SDF rounded-rect in a small material (alphaTest/feather
  at the edge), with a subtle drop shadow. Image is a placeholder texture until
  real assets are dropped in.
- **`CardStack`** — positions the 3 visible cards (offset + slight rotation,
  back cards peeking top-right per the photo), advances the conveyor from
  `cardConveyorFor(gp)` so the front card flies up & out while the next advances
  and a new one enters behind (distribution repeats every 3). Applies the
  **cursor tilt + idle drift** to the whole group.
- **`GalleryCTA`** — a **DOM overlay** (not in the canvas): centered, 50vmin
  wide, `<a href="mailto:hi@deft.ch">` with placeholder text, fading in on the
  CTA frame, tilted toward the cursor via a CSS transform (same reactiveness).
  DOM because the text is an explicit placeholder and a real anchor is the
  robust, accessible way to ship the mailto. Swappable later.

## Cursor reaction

Extract the figures' mouse-parallax (currently inline in `ArcModel`: lerp
`rotX/rotY` toward `pointer × MOUSE_MAX`, framerate-independent) into a small
shared helper. `CardStack` and the CTA use it, **plus** a low-amplitude
always-on idle oscillation so the stack drifts when the cursor is still or
absent (mobile) — the radiance.family idle. Pointer reaction dominates when the
cursor moves.

## Background / handoff

The video reaches and holds its last frame at `sp = 1` (visible). As `gp` ramps
from 0, the `GalleryBackdrop` black plane fades in over the top of it (over
`[0, FADE]`), so the gallery sits on flat black, matching the PDF mockups. This
honors the brief's "…the last frame of the video, and then we continue…": the
film finishes on its last frame, then the black gallery begins. The video
element is simply occluded (still holding its last frame, no extra seeking).
Card/title contrast on black is the design intent (gray placeholders + white
type read cleanly), which over the bright FPV footage they would not.

## Reduced motion

Reduced-motion users keep `phase = "done"` and `sp` logic as today. The gallery
is scroll content they must still reach: titles/cards still **scrub with scroll**
(user-driven, not auto-motion), but the **idle drift and pointer tilt are
disabled** and per-frame smoothing is skipped. The CTA is reachable at the
bottom. Nothing auto-animates.

## Error handling

- Missing/failed card image: the `GalleryCard` falls back to a flat placeholder
  fill (the stack never shows a broken texture).
- `titles.json` load failure: `GalleryTitles` renders nothing (the section
  degrades to the card stack + CTA), mirroring the figure `ErrorBoundary`
  approach.

## Verification

- `npm run typecheck`, `npm run build`.
- `npx tsx scripts/check-playback.ts` — add assertions for the `gp` partition
  (monotonic, ordered, sums/bounds) alongside the existing timeline checks.
- Screenshot harness (`scripts/verify/shot.mjs`) extended to reach gallery
  scroll positions beyond the 800vh track (e.g. a raw-scroll or `--gp` option),
  capturing the three title frames, a mid fly-up, and the CTA.

## Out-of-scope improvements noted

If `LottiePlane` and `GalleryTitles` end up sharing meaningful Lottie→texture
setup, extract a `useLottieTexture` hook as part of this work (focused, serves
both); do not refactor unrelated intro code.
