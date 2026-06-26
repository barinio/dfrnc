# Gallery choreography — video slide #1, title sequence, fly-up cards, CTA

**Date:** 2026-06-26
**Status:** card mechanic + sizing DONE (commit 606e007). This spec covers the remaining
three pieces, each assigned to an isolated agent.

## Context (already implemented, do NOT redo)
- Cards fly straight UP off the top, OPAQUE (no opacity fade) — `CardStack.tsx`.
- 3 fixed positions cycling every 3 (centre / upper-left / right), z + scale by stack age
  (front = nearest, new cards enter at the back). `POSITIONS` / `DEPTH` in `CardStack.tsx`.
- 8 image cards (`GALLERY_IMAGES`, slides 2..9). Slide #1 is the morphing video.
- Video morphs full-bleed → card (crop top, then sides) in `VideoPlane.tsx` driven by
  `videoCardMorphFor(gp, aspect)` in `gallery.ts`. gp partition constants in `constants.ts`:
  `VID_MORPH_END=0.16`, `VID_HOLD_END=0.26`, `VID_FLY_END=0.40`, `IMAGE_GALLERY_START=0.34`.
- `imageGalleryProgress(gp)`, `cardFlyProgressFor(igp)`, `galleryTitleFracFor(igp)` exist.
- `cardExitRef` (set by CardStack: `clamp(displayed-(n-1),0,1)`) = last image card's exit.

## Unified card progress (shared mental model)
The gallery is 9 cards: **card 1 = video**, cards 2..9 = the 8 image cards. A unified
progress `cp ∈ [0,9]` (card 1 spans [0,1], cards 2..9 span [1,9]):
```
galleryCardProgressFor(gp):
  if gp < VID_FLY_END: return clamp01(gp / VID_FLY_END)            // card 1 (video): 0→1
  return 1 + cardFlyProgressFor(imageGalleryProgress(gp)) * GALLERY_IMAGES.length  // 1→9
```
(Continuous at gp=VID_FLY_END → cp=1.)

## Piece A — Video as slide #1 (VideoPlane.tsx + videoCardMorphFor in gallery.ts)
1. **Fly up, no opacity.** After the hold, the video card must fly straight UP off the top
   OPAQUE — matching the image cards (no opacity fade). Today `videoCardMorphFor` rises +
   fades (`opacity = 1 - fly`). Change to: keep opacity 1; raise the card far enough to clear
   the top of the frame over [VID_HOLD_END, VID_FLY_END] (rise in card-heights, like
   CardStack's `RISE_OFF≈1.9`). The plane already hides itself once `opacity*reveal < 0.001`
   — instead hide it once it's off-screen / gp ≥ VID_FLY_END.
2. **Rounded corners.** The video card should have rounded corners matching the image cards
   (`CARD_RADIUS_VH / CARDS_VH` of the card height). The radius grows over stage B (the
   horizontal crop) so the card lands fully rounded. meshBasicMaterial has no radius — add a
   rounded-rect alpha mask in the fragment (onBeforeCompile / small custom shader) keyed by a
   `uRadius` uniform + the crop rect, OR clip via a rounded-rect. Square at full-bleed → rounded
   at card format.
3. **Morph↔squish sync** is automatic: keep the crop-top stage over gp [0, ~0.09] and the
   crop-sides+radius stage over gp [~0.08, VID_MORPH_END] — the titles (piece B) drive the SAME
   gp window for the top/bottom squish, so they line up. Don't change the gp window numbers.
Verify: typecheck, build, check-playback; the video must end its scrub at the clip's last frame
as it flies (videoMasterTimeFor already does this).

## Piece B — Title sequence by card + exit (GalleryTitles.tsx + gallery.ts)
The 5 title texts live as 5 layers in `titles.json` (op=100, 50fps), scrubbed by frame:
- 01 WIR LIEFERN (top) + 02 STRATEGISCHE KOMMUNIKATION (bottom): frames 0→~49 (squish in)
- 03 DESIGN NACH MASS: appears ~frame 50
- 04 UND DIE (top) + 05 GANZ GROSSEN BILDER (bottom): appear ~frame 75→100
Drive the title FRAME by the unified card progress `cp` (add `galleryCardProgressFor` +
`galleryTitleFrameFracForCard(cp)` to gallery.ts):
- cp ∈ [0,1] (card 1 / video morph): frac 0→0.49 (wir liefern + strategische squish in,
  synced to the video crop-top then crop-sides)
- cp ∈ [1,3] (cards 2,3): hold 0.49
- cp ∈ [3,4] (card 4 stays): frac 0.49→~0.60 (design nach mass in)
- cp ∈ [4,6] (cards 5,6): hold
- cp ∈ [6,7] (card 7 stays): frac →1.0 (und die + ganz grossen bilder in)
- cp ∈ [7,9] (cards 8,9): hold 1.0
GalleryTitles currently reads `galleryTitleFracFor(imageGalleryProgress(gp))` — switch to the
new `cp`-based frac so titles run across BOTH the video card and the image cards. Keep the
existing reduced-motion (discrete) + smoothing paths.
**Exit at card 9:** as the 9th (last) card flies up (cp → 9, == cardExitRef → 1), the TOP title
slides UP out of frame and the BOTTOM title slides DOWN out of frame. GalleryTitles renders ONE
plane for the whole comp (top+middle+bottom) — to split top-up / bottom-down you'll need to
render the title as two halves (top band vs bottom band) OR add a vertical split in the shader;
simplest: two title planes (top half of the comp, bottom half) that translate opposite ways on
exit. Use `cardExitRef` (or cp≥8) for the exit progress.

## Piece C — CTA behind card 9 (GalleryCTA.tsx)
The CTA wordmark (already rendered from cta.svg, cursor-responsive) must reveal BEHIND the 9th
card — i.e. as the last image card flies up, the CTA is revealed underneath. It already reveals
via `galleryCtaFromExit(cardExitRef.current)`. Confirm cardExitRef now reaches 1 as the LAST of
the 8 image cards flies (CardStack sets `clamp(displayed-(n-1),0,1)`, n=8 → reaches 1 as card 8
leaves = the 9th gallery card). Ensure the CTA sits z-behind the card while it's still leaving
(no hard pop) and is fully visible once card 9 is gone. Mostly a verification + small z/timing
tweak; do NOT change the svg/tilt work.

## Verification (all pieces)
`npm run typecheck`, `npm run build`, `npx tsx scripts/check-playback.ts` (all green). Headless
screenshots per docs memory `visual-verification` if useful. Numbers are tuning dials.
