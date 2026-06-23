# Gallery card stack — discrete-step swiper (design)

Date: 2026-06-23

Refines the gallery card-stack interaction (supersedes the "continuous eased
conveyor" behavior from `2026-06-22-gallery-section-design.md` — only the card
*motion model* changes; layout, titles, backdrop, CTA, and the `gp` partition are
unchanged). Reference feel: https://radiance.family/ `.portfolio-slider-layout`
(Lenis + GSAP ScrollTrigger discrete snapped slides).

## Problem

Tying the card position linearly/continuously to scroll makes it "creep," and a
slow eased-follow makes the leave/arrive + settle animations feel long. We want a
**swiper**: the deck holds still until you swipe to the next slide, then a quick
fly-up; reversible; a big scroll cascades through slides and lands on the target.

## Behavior

- The deck is **static** while scrolling within a slide's band — nothing tracks
  the scroll continuously.
- The **target slide** is the rounded conveyor position from scroll:
  `target = round(span · N)` where `span` is the existing `cardConveyorFor(gp)`
  card-phase progress and `N = GALLERY_IMAGES.length`. Rounding makes the deck
  flip at each band's **midpoint**.
- Crossing into the next band (a short, natural swipe) → **one quick eased
  fly-up** of the front card; the next settles. Short swipe back → quick return.
- A **big scroll** jumps `target` several slides; the deck moves through the
  intermediates at an even capped speed (each briefly visible, one-after-another)
  and **eases to a stop on the target** slide.
- Fully **reversible** — `target` follows scroll position both directions.
- **No pagination element** (no counter/bar); "pagination" just means the slide
  index advances.

## Mechanism (self-contained in `CardStack`)

A `displayed` float (the live slide position driving `lead`/`local`) moves toward
the integer `target` each frame with a **speed-capped exponential ease**:

- single-slide step → exponential ease dominates → quick (~200 ms) eased fly-up;
- multi-slide jump → the speed cap holds an even glide through the intermediates,
  easing in as it nears the target → sequential cascade, clean stop on target.

`displayed` settles exactly when it reaches `target` (snap within ε) → the deck is
genuinely static between bands (no per-frame drift). Reduced motion sets
`displayed = target` directly (no animation; content still reachable by scroll).

Replaces the previous `SNAP_RATE`/`IDLE_SNAP_TIME` (eased-follow + idle-snap);
no idle detection is needed because rounding makes "static between bands" emerge
from the target itself.

## Tuning dials

- `STEP_RATE` — single-step ease rate (~9 → a clearly readable ~500 ms fly-up;
  was 18/~200 ms, which felt almost imperceptible).
- `MAX_STEP_PER_SEC` — cascade glide speed cap (slides/sec) for big scrolls; also
  governs the bulk of a single step's travel, so lowering it (6 → 3) is the main
  lever for a visibly slower swap.
- `GALLERY_TRACK_VH` — shortened (600 → ~400) so a modest, "short natural" swipe
  (~¼ screen) advances one slide instead of the current ~⅓-screen-plus.

All are constants; expect a live tuning pass (the feel is judged in-browser).

## Unchanged

Layout (3% gutter, 8/64/16 vh bands, 3:2 / 86vw), the rounded card geometry,
cursor tilt + idle drift, the entrance lift, titles (continuous scrub — framing
text, not slides), backdrop, CTA, reduced-motion gating elsewhere, and every
`gp`-partition constant except `GALLERY_TRACK_VH`.

## Verification

`npm run typecheck` + `npm run build`; `npx tsx scripts/check-playback.ts`
(unchanged pure functions still pass); headless screenshots at mid-band scroll
positions must show **clean settled stacks** (not half-fly-out), confirming the
deck rounds to a whole slide. The step/cascade motion itself is judged live.

## Refinement — round 2 (2026-06-23)

Card-stack visuals + interaction reworked toward the radiance.family stack
(supersedes the conveyor's up-right peek, always-on parallax, and the
title-clip). Discrete-step snapping (above) is unchanged.

- **Smaller cards.** Rendered at `CARD_FILL` (≈0.72) of the 64vh band, centred in
  the band — so the hover scale-up stays clear of the titles without clipping.
- **Hover-only parallax + scale.** Parallax tilt and a scale `1 → HOVER_SCALE`
  (1.3) apply ONLY while the cursor is over the card (window-pointer NDC
  hit-test — no canvas pointer-events needed). No always-on tilt, no idle drift.
- **Clipping removed.** Cards and the peek show fully; the group still enters
  from below. The smaller base + bounded hover keep the card clear of the titles
  by construction (verified at rest / hover-centre / hover-corner).
- **Peek-below stack.** Back cards are CENTRED (x=0), each ~8% / 15% smaller, and
  offset DOWN to peek below the front (per-depth `STOPS`), replacing the
  up-right offset.
- **Transition.** Front card rises and **fades out**; the next **fades in from
  below** (per-depth opacity envelope in `depthState`). Reversible.
- New dials: `CARD_FILL`, `HOVER_SCALE`, `HOVER_TILT_MAX`, `HOVER_RATE`, the
  `STOPS` per-depth placement, and `RISE` (leaving-card travel).

(The earlier "Unchanged → cursor tilt + idle drift" and the title-clip fix are
superseded by this round.)

## Refinement — round 3 (2026-06-23)

Re-aligns the stack to the PDF mockups exactly (size + placement + peek), scopes
the hover effect to the front card only, and re-phases the card exits to the
title text so a card leaves at the **end** of each text display (not the start),
ending on a synchronized title fade-out → CTA. Source of truth for layout:
`~/Downloads/gallery web (1).pdf`. The discrete-step swiper (round 1) and the
`gp` partition are unchanged; round 2's "smaller, centred, peek-below" is
superseded.

### A. Size & placement — exactly per the PDF (not shrunk, not centred)

- **Full size.** `CARD_FILL` 0.72 → **1.0**. The front card occupies the full
  band: **64vh tall**, 3:2 → **96vh wide** at aspect ≥ 1:1; at aspect < 1:1 it
  stays 64vh tall and tracks the viewport at **86vw**; capped at 16:9 (letterbox
  beyond). Corner radius 2.5vh. The band anchor is **unchanged** (`bandOffsetY`,
  band centre at 46vh from top) — only the rendered scale grows, so the card now
  fills the band instead of floating shrunk-and-centred inside it.
- **Top-right peek** (restores the PDF). New `STOPS`: back cards are offset
  **right and up** (+x, +y) and slightly smaller (≈0.97 / 0.94), replacing the
  round-2 centred peek-below. Three cards visible; the distribution repeats every
  3. The leaving front card still rises + fades out (`RISE`); the entering card
  fades in at the deepest back slot. The peek offset is small enough that the
  topmost back card stays within the **3vmin top gutter** (never touches the top
  title) — verified by screenshot.

### B + C. Hover parallax — front card only, clear of the titles

- **Front card only.** The hover parallax tilt + scale apply to **slot 0** alone
  (composed on top of its resting depth transform), not to the whole group.
  Hovering a back card does nothing — its transform is untouched until it becomes
  the front card. (Was: tilt + scale on the whole `groupRef`.)
- **Small effect.** Because the card is now full-size, `HOVER_SCALE` drops 1.3 →
  **~1.03** and the tilt stays small (`HOVER_TILT_MAX` tuned down) — "невелике
  збільшення".
- **Never overlaps the titles (top or bottom).** The effect is small by
  construction (at 1.03 the edge moves only ≈0.96vh, inside the 3vmin gutter), and
  the front card's vertical excursion is additionally **clamped** so even at max
  tilt/scale it cannot enter either title band. Verified at hover-centre and
  hover-corner. (Alternative considered and rejected: per-frame clamping of the
  projected corners — more robust but heavier; small-effect + clamp + screenshot
  verification suffices.)

### D. Exits re-phased to the text + title fade-out finale

Mechanic unchanged: **1 scroll step = one front card flies up** (discrete-step
swiper); the image count stays flexible/drop-in.

- **Phase lag.** The card conveyor now **trails** the title scrub by ~half a beat
  so a card leaves at the **end** of each text display, not before it (today it
  leaves first, then the text appears). Implemented by moving the conveyor's
  `span` basis to a delayed/retimed window `[CARDS_FLY_START, CARDS_FLY_END]`
  instead of `[BACKDROP_FADE_END, CTA_START]`; the rounded `target` step model is
  unchanged.
- **First card lingers.** At gallery start there is no text yet (the title grows
  in over title-frac 0→0.5). `CARDS_FLY_START` is set so the first card holds
  through that grow-in and flies out only as the first text appears — so by the
  time text 1 (`STRATEGISCHE KOMMUNIKATION`) is fully readable, card 2 is already
  the front.
- **Finale.** `CARDS_FLY_END` is placed so the **last** card flies up together
  with a new **title fade-out** (the title plane's opacity runs 1→0, the text
  "погасне"), finishing by `CTA_START`; the CTA (`«small call to action…»`) then
  fades in immediately. This also closes a gap: today the titles hold on frame
  100 (`GANZ GROSSEN BILDER`) and are never hidden, so they'd otherwise show
  behind the CTA — the PDF's CTA page is pure black + the call-to-action only.
- Alternatives considered and rejected: **D2** pinning each card step to one of
  the 3 title text frames (breaks with a flexible image count); **D3** stepping
  the title frame per card step (only 3 title states; loses the smooth continuous
  scrub).

### Future — if the client fixes the gallery at exactly 3 images

Then switch to a **strict 1:1** card↔text model: each of the 3 title texts gets
exactly one card, every card step lands on a text beat, and the title Lottie is
likely **re-authored to step per scroll-step** (discrete text swaps instead of a
continuous scrub) so text and cards advance in lockstep. Out of scope for this
round (count is currently flexible); noted so the timing model above can be
swapped for the stepped one without reworking layout/hover.

### New / changed dials (round 3)

`CARD_FILL` → 1.0; `HOVER_SCALE` → ~1.03; `HOVER_TILT_MAX` tuned down; `STOPS`
re-defined for the top-right peek; new card-fly window `CARDS_FLY_START` /
`CARDS_FLY_END`; new title fade-out window (`TITLES_FADE_*`). All judged live.

### Verification (round 3)

`npm run typecheck` + `npm run build`; `npx tsx scripts/check-playback.ts` with
new assertions for the retimed card-fly window (monotonic; first step delayed
past the title grow-in; last step coincides with the title fade-out before
`CTA_START`). Headless screenshots: a settled stack (full size, top-right peek,
back card clear of the top title), hover-centre and hover-corner (front card
does not touch either title; back cards unchanged), and the finale (last card
rising while the title fades and the CTA appears).
