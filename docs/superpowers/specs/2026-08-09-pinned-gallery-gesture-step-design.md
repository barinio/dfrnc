# Pinned gallery with one-card-per-gesture navigation

## Context

The boundary-only scroll governor solved the original momentum leak by keeping a
logical `virtualY` behind the browser's physical `scrollY`, discarding excess
distance, and later reanchoring the browser with `window.scrollTo()`.

That architecture creates a visible and functional split between the page and
its scrollbar: the thumb can reach the document end while the gallery remains
on its first card, then jump back after reanchoring. Input received during that
split can inherit a very large raw delta and race through cards; at the physical
document end desktop may emit no further useful scroll events, leaving the
gallery stuck.

The approved replacement follows the interaction model used by the reference
site, `https://radiance.family/`: native scrolling brings the user to the
gallery, the gallery is pinned while a gesture observer owns navigation, and
native scrolling resumes only after the internal sequence is complete.

## Approved interaction contract

- Before the gallery, scrolling remains native and keeps the existing video and
  caption timing.
- A fast gesture that reaches the video/gallery boundary is consumed at that
  boundary. Its remaining momentum cannot advance a photo card.
- While the photo gallery is active, one downward phone swipe, touchpad gesture,
  mouse-wheel gesture, or scrolling-key action advances exactly one step.
- One upward gesture reverses exactly one step.
- Residual events from the same physical gesture are ignored. They are never
  accumulated as distance or replayed later.
- A new step is accepted only after both the previous gesture has ended and the
  current card transition is ready for another step.
- The last photo card exits on its own discrete step and reveals the final CTA.
- The next separate forward gesture releases the gallery and restores native
  page scrolling.
- When moving backward into the gallery, it pins at the exit boundary and
  restores the CTA/last-step state before accepting one-step reverse gestures.
- Reduced-motion mode remains directly scroll-addressable and does not introduce
  forced animated transitions.

## Architecture

### One physical scroll coordinate

The browser's `scrollY` is the only document coordinate. The replacement removes
the runtime model that allows `lastRawY` and `virtualY` to diverge, along with
automatic reanchoring and discarded-distance debt.

Before the pinned gallery, `scrollY` maps directly to the existing animation and
video timeline. The gallery entry boundary is a stable physical coordinate.
When that boundary is reached, the controller prevents further native movement
for owned gallery gestures, so the scrollbar stays at the same coordinate rather
than racing ahead and snapping back.

### Pinned gallery state machine

The controller has four explicit states:

1. `native-before` — normal document scrolling before the gallery.
2. `gallery-idle` — gallery pinned and ready for a new gesture.
3. `gallery-transitioning` — one card/CTA transition is running; further input is
   consumed but cannot start another step.
4. `native-after` — gallery completed and normal document scrolling restored.

Entering from above changes `native-before` to `gallery-idle` at the boundary.
Entering backward changes `native-after` to `gallery-idle` at the gallery exit.
There is no timer that teleports the page to reconcile separate coordinates.

### Gesture ownership

Wheel and touchpad events are grouped into one burst using direction plus a
quiet window. Only the first accepted directional intent in that burst may
change the gallery step. Momentum events remain prevented until the burst is
quiet.

Touch input is grouped from `touchstart` through `touchend`, including the
browser's residual momentum window. A swipe must cross a small directional
threshold before it becomes an accepted step; jitter and taps do nothing. Once
accepted, the rest of that swipe is consumed.

Scrolling keys are treated as individual discrete intents. Editable controls,
modified shortcuts, and unrelated keys are not intercepted.

The controller listens with non-passive handlers only where cancellation is
required. Outside the active gallery it does not prevent native scrolling.

### Gallery step model

Gallery visuals continue to use the existing pure `gp`-based choreography.
Instead of deriving `gp` from every raw scroll pixel while pinned, the controller
owns a finite ordered list of semantic step targets:

- gallery entrance / first photo-ready state;
- one target per photo-card advance;
- last-card exit / CTA state.

An accepted gesture moves to the adjacent target only. The rendered `gp` eases
between the current and target values using the existing card motion treatment;
it never skips intermediate targets. Reverse gestures use the same targets in
the opposite direction.

The exact target values are derived from the existing gallery functions and
image count so adding or removing gallery images does not require hard-coded
indices in the input controller.

### Entry and exit

The fast gesture that first reaches the boundary may complete the video-card
morph/exit but cannot also trigger the first photo step. The gallery observer is
armed only after that incoming gesture becomes quiet.

At the CTA state, one additional separate forward gesture disables the gallery
observer and lets native scrolling continue. The release gesture itself does not
carry stored distance through the page; native movement begins with subsequent
browser input. Reverse entry uses the corresponding rule so old momentum cannot
immediately rewind several cards.

## Failure handling

- Direction changes within one wheel/touchpad burst do not create multiple
  steps; a new quiet-separated gesture is required.
- A gesture received during a transition is consumed and discarded, not queued.
- Losing focus, hiding the page, or cancelling touch clears gesture ownership
  without changing the current gallery step.
- Viewport-height changes caused by mobile browser chrome do not remap the
  current semantic step. Width changes recompute layout while preserving the
  current step.
- Programmatic navigation synchronizes directly to the nearest semantic state
  without fabricating a user gesture.

## Implementation boundaries

- Replace the `virtualY` governor/reanchor path rather than layering another
  suppression timer on top of it.
- Keep the video timeline knots, Lottie timing, card visuals, titles, CTA,
  assets, and responsive layout unchanged unless a small adapter is required to
  expose semantic gallery targets.
- Do not push, merge, or deploy before the user's manual approval.
- Do not run the full regression suite before the user has visually validated
  the interaction. During implementation, use only focused checks needed to
  catch syntax/type errors or an obviously broken local handoff.

## Acceptance criteria

- The scrollbar never moves ahead of the visible gallery and never jumps back.
- A single aggressive gesture that finishes the video cannot advance a photo
  card.
- Every fresh swipe, touchpad gesture, mouse-wheel gesture, or scrolling-key
  action changes at most one gallery step.
- Repeated momentum events from one gesture cannot accelerate the gallery.
- Desktop cannot become stuck at document end with the first card visible.
- Reverse navigation is symmetric, one step per gesture.
- The last-card step reveals the CTA; the following forward gesture releases
  native scrolling.
