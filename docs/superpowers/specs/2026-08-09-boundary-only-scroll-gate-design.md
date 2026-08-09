# Boundary-only video-to-gallery scroll gate

## Context

The first scroll-governor implementation interpreted “do not outrun the video” as a continuous native-speed playback cap. It also quarantined forward momentum after every real gesture. On phones this makes the entire video section feel heavy: movement is time-limited while the finger is down, then ordinary inertial scrolling is cut off at `touchend`.

The corrected requirement is narrower. Scrolling through the video must feel exactly as it did before the governor, including the existing slower caption zones. A single long or fast gesture may traverse the whole video. That same gesture must not carry into the image-card conveyor once the video finishes.

## Approved interaction contract

- Forward scroll inside the video uses the browser's native distance and momentum. There is no elapsed-time or 1× playback cap.
- The existing piecewise `VIDEO_TIME_KNOTS` mapping remains the only source of caption slowdowns.
- One continuous touch, wheel, or scrolling-key gesture may advance as far as the end of the video-card track: `gp = VID_FLY_END` (`0.4`).
- At that boundary, the video has completed its morph/hold/fly lifecycle and the first ordinary image card is ready. The current gesture cannot move that image card.
- All remaining positive distance and native inertia from the boundary-reaching gesture are discarded. There is no saved distance or catch-up debt.
- Reverse input remains immediate. Reversing within the same gesture may move back into the video, but another forward movement in that gesture is still capped at the same boundary.
- A new explicit gesture starts cleanly and may advance the image-card gallery with its existing cadence.
- Programmatic scrolling, reduced motion, resize handling, and same-width mobile-toolbar resize behavior retain their current bypass/synchronization semantics.

## Design

### Pure scroll governor

`applyScrollSample` will stop converting elapsed input time into a permitted video-time delta. A positive raw delta will be applied one-to-one to `virtualY` until the video endpoint. If the active gesture intersects the governed video interval, it owns a gallery lock for its lifetime and `virtualY` is clamped to `videoGovernorBounds(innerHeight).endY`.

Only the portion beyond that endpoint is reported as discarded. Negative deltas continue to apply one-to-one. Obsolete time-budget state and helpers will be removed so the implementation cannot silently reintroduce playback-rate throttling.

Ending a gesture will enable forward suppression only when the gesture reached the video/gallery boundary or when raw and virtual positions diverged because distance was discarded. Ordinary gestures that finish inside the video will not be quarantined.

### Gesture and momentum lifecycle

Touch inertia must remain attributed to the touch that created it:

1. `touchstart` begins an explicit gesture.
2. `touchend` ends direct finger contact but keeps a momentum-owned burst active.
3. Each following native `scroll` event re-arms the 120 ms quiet timer and is processed as part of the same gesture.
4. Once scrolling is quiet, the controller finishes the gesture. If it hit the boundary, raw scroll is reanchored to the virtual endpoint and late positive residue stays suppressed for the existing quiet window.
5. A new `touchstart` explicitly closes any prior momentum-owned burst, clears boundary suppression, and begins a fresh gesture. This allows the first new swipe to operate the first image card without an artificial delay.

Wheel and scrolling-key bursts retain their quiet-window grouping. Their momentum remains part of the same burst while events continue. Programmatic scroll events remain outside explicit gesture ownership and bypass the boundary logic as they do today.

### Gallery behavior

No gallery timing, card conveyor, snapping, title, or CTA code changes. The gate acts only at the existing physical coordinate that maps to `gp = 0.4`. Once a new gesture starts past that seam, the current card behavior is untouched.

## Failure handling and edge cases

- A huge first delta from anywhere before the video endpoint lands exactly at the endpoint, never beyond it.
- Repeated forward momentum from the same gesture remains at the endpoint even if physical `scrollY` races far ahead.
- A gesture ending exactly on the endpoint, with no raw/virtual mismatch, is still quarantined briefly so delayed inertia cannot leak into the image gallery.
- A fresh touch interrupts the quarantine immediately and is never mistaken for old momentum.
- Blur, hidden-document, reduced-motion, and width-changing resize paths keep their existing direct synchronization and cleanup behavior.

## Verification

### Deterministic tests

- A large forward sample crosses the complete piecewise video timeline in one sample and lands at `gp = 0.4`; this proves the 1× cap is gone.
- A normal forward delta inside the video changes `virtualY` by the exact raw delta.
- Caption timing knots remain byte-for-byte unchanged.
- Additional positive samples in the same boundary-reaching gesture are discarded.
- Reverse movement applies immediately and exactly.
- Ending before the boundary does not suppress native momentum.
- Ending at the boundary does suppress late positive residue.
- Post-`touchend` momentum remains attributed to the original gesture, can continue through the video, and is stopped only at the boundary.
- A fresh `touchstart` after the boundary advances the gallery immediately.
- Existing wheel/key overlap, programmatic bypass, resize, reduced-motion, and disposal tests remain green.

### Browser verification

The trusted-input verifier will be changed from a playback-rate test to a boundary test:

- a large trusted wheel burst may traverse the video quickly;
- the same burst holds at `gp = 0.4` with discarded forward distance;
- no progress occurs without further physical input;
- a fresh trusted gesture advances to `gp > 0.4`;
- reverse input moves immediately;
- mobile viewport and throttled frame-loader checks remain green.

## Out of scope

- Retiming caption slowdowns or the video-card morph.
- Changing per-card gallery cadence or adding CSS scroll snapping.
- Replacing native scrolling with a custom touch scroller.
- Push, merge, or Vercel deployment before the user's visual approval.
