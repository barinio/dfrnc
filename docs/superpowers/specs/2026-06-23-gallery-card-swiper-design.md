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

- `STEP_RATE` — single-step ease rate (~18 → ~200 ms per slide).
- `MAX_STEP_PER_SEC` — cascade glide speed cap (slides/sec) for big scrolls.
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
