# Video → gallery slide-1 morph (replace the opacity fade)

**Date:** 2026-06-25
**Status:** approved (approach A, recommended defaults) — visual-first, tune pointwise after.

## Problem

Today the FPV video reaches its last frame at `sp = 1`, and entering the gallery a
black `GalleryBackdrop` plane **fades in over the video** (`gp ∈ [0, BACKDROP_FADE_END]`)
to cover it. The video dies as an opacity fade and its frame is frozen.

The supervisor wants the video to instead **shrink into gallery slide #1**: cropped
from the **top first, then horizontally**, down to the gallery card's size/position —
and to **keep scrubbing (never freeze)** until that slide flies away like the other cards.

A new video + a more detailed slide instruction arrive tonight; this builds the LOGIC
now (parametric, tunable), verifiable on the current `fpv.mp4`.

## Decisions (locked)

- **Slide #1 = the video**, an EXTRA pre-roll slide. The image-card conveyor (slides
  2..N) starts only AFTER the video card has flown away.
- **Scrub by scroll** (not real-time autoplay): video time is a function of scroll,
  continuing past `sp = 1` into the gallery. Fully reversible.
- **No titles** on the video-card phase (full-bleed → card → fly). The titled image
  gallery begins after.
- **Reduced motion:** the morph is scroll-coupled (deterministic), so it stays; only
  the scrub is frozen (static last frame). Consistent with the existing reduced-motion
  card conveyor, which already moves with scroll.

## Approach A — VideoPlane owns the gallery morph

Keep the single `VideoPlane` at `z = -3.5`. Add `gp`-driven morph (crop-rect) + hold +
fly. The black gallery background moves BEHIND the video. `CardStack`/`GalleryTitles`
are fed a remapped *image-gallery progress*. Chosen over (B) feeding the video texture
into the card conveyor and (C) a separate `z=0` video card: A keeps the video element /
texture / pan / scrub in ONE component and expresses the morph as a localized texture +
placement interpolation.

## Timeline

### Video scrub extension (`playback.ts: videoMasterTimeFor(sp, gp, phase)`)
Monotonic across the `sp → gp` boundary (`gp > 0 ⟺ sp = 1`):
- anim track `sp ∈ [VIDEO_START, 1]` → `t ∈ [0, VIDEO_SPLIT]`
- gallery `gp ∈ [0, VID_FLY_END]` → `t ∈ [VIDEO_SPLIT, 1]`

Clip's last frame is reached exactly as the video card flies out. `videoStateFor` stays
for the sp-based reveal opacity + grain mix (unchanged). `done` ⇒ `t = 1` (frozen).

### gp partition (gallery)
- `[0, VID_MORPH_END]` — full-bleed → card (crop top, then horizontal); black opaque behind
- `[VID_MORPH_END, VID_HOLD_END]` — video card holds as slide #1 (still scrubbing)
- `[VID_HOLD_END, VID_FLY_END]` — video card rises + fades; clip reaches its end
- `[VID_FLY_END, 1]` — image conveyor + titles + CTA (existing logic, in remapped space)

`imageGalleryProgress(gp) = clamp01((gp - VID_FLY_END) / (1 - VID_FLY_END))` is passed to
`cardConveyorFor` / `cardFlyProgressFor` / `galleryTitleFracFor` at the call sites, so
those pure functions and their existing assertions are UNCHANGED (their input is now the
image-gallery sub-progress).

## Morph math (`gallery.ts: videoCardMorphFor(gp, aspect)`, `cardScreenRect(aspect)`)

A "view rect" in screen fractions `[l, r, b, t]` interpolates full `[0,1,0,1]` → card rect:
- **Stage A (vertical):** top edge leads down, bottom follows → full-width card-height band.
- **Stage B (horizontal):** sides pull in to the card width.

`cardScreenRect` is derived from the SAME layout constants `CardStack` uses
(`CARDS_VH`, `CARD_ASPECT`, `CARDS_WIDTH_VW_PORTRAIT`, `GUTTER`, `TOP_TITLE_VH`) so the
landing rect matches an image card exactly.

**Crop = mask, not squash.** The full-screen cover mapping (existing `repeat/offset`) is
computed first; the rect selects a texture SUB-window of it
(`repeat *= (r-l, t-b)`, `offset += repeat_full * (l, b)`). The mesh is scaled/positioned
to the rect in world units at `z = -3.5`. Content stays 1:1 — you watch it being cropped.

**Fly:** after `VID_HOLD_END`, the texture window stays frozen at the card crop while the
PLACEMENT translates up (`rise`) and `opacity → 0`. The scrub keeps advancing, so the
frozen-crop card keeps playing as it leaves. Optional rounded corners track Stage B.

## Layering

`GalleryBackdrop` black plane moves from `z = -2.9` (in front of the video) to
`z = -3.6` (behind the video, in front of the gradient `-4`) and is opaque for the whole
gallery — the shrinking video reveals black; image cards (`z = 0`) later sit on it. The
Lottie final frame (`z = -3`) is transparent, so it doesn't occlude the video card.
`galleryBackdropFor`'s fade window tightens to `GALLERY_BLACK_FADE` (raw gp) so black is
opaque before the morph reveals anything; existing assertions still hold.

`GalleryTitles` gains a visibility gate (`imageGalleryProgress(gp) > 0`) so no titles
show during the video-card phase.

## Constants (`constants.ts`)

- `GALLERY_TRACK_VH` 400 → **700** (so the image gallery keeps ≈400vh after the
  ≈0.4 video-card phase).
- `VIDEO_SPLIT = 0.7`, `VID_MORPH_END = 0.16`, `VID_HOLD_END = 0.26`, `VID_FLY_END = 0.40`.

All numbers are tuning dials, judged in-browser.

## Verification

- `npm run typecheck`, `npm run build`.
- `npx tsx scripts/check-playback.ts` with new assertions: `videoMasterTimeFor`
  monotonic + continuous across the boundary (`t(sp=1,gp=0) == VIDEO_SPLIT`,
  `t(·, VID_FLY_END) == 1`); `videoCardMorphFor` endpoints (full at `gp≤0`, card rect at
  `gp ∈ [VID_MORPH_END, VID_HOLD_END]`, opacity→0 at `VID_FLY_END`); `imageGalleryProgress`
  is 0 until `VID_FLY_END`.
- Headless screenshots at `gp` 0.0 / 0.08 / 0.16 / 0.26 / 0.40 (per
  [[visual-verification]]): full-bleed → letterbox band → card → held → flown, with the
  conveyor entering after.

## Out of scope (tonight / later)

- The new video file (drop-in replace `public/fpv.mp4`) and detailed slide content.
- Final corner-radius polish; exact crop anchors/easing; pan behavior during the card phase.
