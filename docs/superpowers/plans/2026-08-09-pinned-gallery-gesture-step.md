# Pinned Gallery Gesture Step Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the divergent physical/virtual scroll governor with a pinned gallery in which one fresh swipe, touchpad gesture, wheel burst, or scrolling-key action advances exactly one card.

**Architecture:** Keep native `window.scrollY` as the sole document coordinate through the Lottie/video track and the video-card morph. At the photo-gallery seam, cancel owned native input, hold the physical scroll coordinate, and drive gallery progress through semantic step targets. Release native scrolling only through explicit boundary actions; never accumulate discarded distance or reanchor a lagging virtual cursor.

**Tech Stack:** React 18, TypeScript, React Three Fiber, browser wheel/touch/keyboard events, `requestAnimationFrame`, Vite, executable TypeScript verification scripts.

---

## File structure

- Create `src/galleryGestureStepper.ts` — pure semantic target generation and adjacent-step decisions; no DOM access.
- Create `scripts/check-gallery-gesture-stepper.ts` — focused executable checks for target ordering and one-step boundaries.
- Modify `src/constants.ts` — replace the old 420vh physical image-scroll runway with a short fixed pin-release span.
- Modify `src/gallery.ts` — expose stable `gp` targets and map the reduced-motion/direct-scroll fallback across the short release span.
- Modify `src/scrollGovernor.ts` — retain only canonical scroll/timeline conversion helpers; remove divergent governor state and reanchor-related operations.
- Rewrite `src/scrollTimelineController.ts` — explicit native/pinned state machine, gesture ownership, transition tween, and native release.
- Rewrite `scripts/check-scroll-lifecycle.ts` — deterministic wheel, touch, keyboard, transition, entry, exit, and cleanup checks for the new controller.
- Modify `src/hooks/useScrollProgress.ts` — wire cancellable events and animation-frame timing; publish one physical coordinate.
- Modify `src/components/Scene.tsx` — size the document with the fixed gallery release span.
- Update `scripts/check-scroll-governor.ts` and `scripts/check-playback.ts` — preserve timeline assertions while removing obsolete virtual-governor expectations.

### Task 1: Define semantic gallery steps

**Files:**
- Create: `src/galleryGestureStepper.ts`
- Modify: `src/gallery.ts`
- Create: `scripts/check-gallery-gesture-stepper.ts`

- [ ] **Step 1: Write the focused failing checks**

Create `scripts/check-gallery-gesture-stepper.ts` with direct assertions that:

```ts
import { VID_FLY_END } from "../src/constants";
import { GALLERY_IMAGES } from "../src/gallery";
import {
  createGalleryStepperState,
  galleryStepTargets,
  requestGalleryStep,
} from "../src/galleryGestureStepper";

function ok(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
}

function eq(actual: number | string, expected: number | string, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

const targets = galleryStepTargets();
eq(targets.length, GALLERY_IMAGES.length + 1, "entrance plus one exit per photo");
eq(targets[0], VID_FLY_END, "entrance is the video/photo seam");
eq(targets.at(-1)!, 1, "CTA is the terminal semantic target");
for (let index = 1; index < targets.length; index += 1) {
  ok(targets[index] > targets[index - 1], `target ${index} is ordered`);
}

let state = createGalleryStepperState();
let result = requestGalleryStep(state, 1);
eq(result.kind, "step", "forward entrance advances one card");
if (result.kind === "step") {
  eq(result.state.index, 1, "one forward gesture advances exactly one index");
  state = result.state;
}
result = requestGalleryStep(state, -1);
eq(result.kind, "step", "reverse gesture rewinds one card");
if (result.kind === "step") eq(result.state.index, 0, "reverse returns to entrance");

eq(requestGalleryStep(createGalleryStepperState(), -1).kind, "release-before", "reverse at entrance releases video scroll");
const terminal = { index: targets.length - 1 };
eq(requestGalleryStep(terminal, 1).kind, "release-after", "forward at CTA releases page scroll");
```

- [ ] **Step 2: Run only this focused check and confirm it fails**

Run: `npx tsx scripts/check-gallery-gesture-stepper.ts`

Expected: FAIL because `src/galleryGestureStepper.ts` does not exist.

- [ ] **Step 3: Expose gallery target progress values**

Add to `src/gallery.ts`:

```ts
export function galleryProgressForImageLinear(linear: number): number {
  const n = Math.max(GALLERY_IMAGES.length, 1);
  const clamped = clamp01(linear / n);
  const imageProgress = lerp(CARDS_FLY_START, CARDS_FLY_END, clamped);
  return clamp01(
    IMAGE_GALLERY_START + imageProgress * (1 - IMAGE_GALLERY_START),
  );
}
```

The terminal semantic target is deliberately normalized to `1` so the CTA and
all end-state helpers receive their authored final state after the last card
exit.

- [ ] **Step 4: Implement the pure stepper**

Create `src/galleryGestureStepper.ts`:

```ts
import { GALLERY_IMAGES, VID_FLY_END, galleryProgressForImageLinear } from "./gallery";

export type GalleryDirection = -1 | 1;

export interface GalleryStepperState {
  index: number;
}

export type GalleryStepResult =
  | { kind: "step"; state: GalleryStepperState; targetGp: number }
  | { kind: "release-before"; state: GalleryStepperState }
  | { kind: "release-after"; state: GalleryStepperState };

export function galleryStepTargets(): readonly number[] {
  return [
    VID_FLY_END,
    ...GALLERY_IMAGES.map((_, index) =>
      index === GALLERY_IMAGES.length - 1
        ? 1
        : galleryProgressForImageLinear(index + 1),
    ),
  ];
}

export function createGalleryStepperState(index = 0): GalleryStepperState {
  const max = galleryStepTargets().length - 1;
  return { index: Math.min(Math.max(Math.trunc(index), 0), max) };
}

export function requestGalleryStep(
  state: GalleryStepperState,
  direction: GalleryDirection,
): GalleryStepResult {
  const current = createGalleryStepperState(state.index);
  const targets = galleryStepTargets();
  if (direction < 0 && current.index === 0) {
    return { kind: "release-before", state: current };
  }
  if (direction > 0 && current.index === targets.length - 1) {
    return { kind: "release-after", state: current };
  }
  const next = createGalleryStepperState(current.index + direction);
  return { kind: "step", state: next, targetGp: targets[next.index] };
}
```

- [ ] **Step 5: Run the focused check**

Run: `npx tsx scripts/check-gallery-gesture-stepper.ts`

Expected: PASS with no output.

- [ ] **Step 6: Commit the semantic model**

```bash
git add src/gallery.ts src/galleryGestureStepper.ts scripts/check-gallery-gesture-stepper.ts
git commit -m "feat(scroll): define semantic gallery steps"
```

### Task 2: Make the physical gallery runway a short pin-release span

**Files:**
- Modify: `src/constants.ts`
- Modify: `src/gallery.ts`
- Modify: `src/scrollGovernor.ts`
- Modify: `src/components/Scene.tsx`
- Modify: `scripts/check-scroll-governor.ts`

- [ ] **Step 1: Replace physical image-track assertions**

In `scripts/check-scroll-governor.ts`, retain all authored video-knot and video
round-trip checks, then replace the old 420vh image-track assertions with:

```ts
import { GALLERY_PIN_TRACK_PX } from "../src/constants";

const galleryEndY = animY + videoCardPx + GALLERY_PIN_TRACK_PX;
eqProgress(
  timelineProgressForY(galleryEndY, IH),
  { sp: 1, gp: 1 },
  "pin-release span ends at CTA",
);
eq(
  scrollYForTimelineProgress({ sp: 1, gp: 1 }, IH),
  galleryEndY,
  "CTA inverse uses the pin-release span",
);
```

Delete governor-state, discarded-distance, suppression, and reanchor assertions;
those APIs are intentionally removed.

- [ ] **Step 2: Run the focused mapping check and confirm it fails**

Run: `npx tsx scripts/check-scroll-governor.ts`

Expected: FAIL because `GALLERY_PIN_TRACK_PX` does not exist and the old mapping
still uses `IMAGE_GALLERY_TRACK_VH`.

- [ ] **Step 3: Define the fixed pin span**

In `src/constants.ts`, preserve `VIDEO_CARD_TRACK_VH = 140`, remove the physical
`IMAGE_GALLERY_TRACK_VH` and `GALLERY_TRACK_VH` exports, and add:

```ts
// Small real document span used only to enter/leave the pinned photo gallery.
// Card navigation itself is gesture-driven and does not consume scroll debt.
export const GALLERY_PIN_TRACK_PX = 300;
```

- [ ] **Step 4: Update direct physical mapping**

In `src/gallery.ts`, map the post-video raw coordinate across
`GALLERY_PIN_TRACK_PX` only for reduced motion/direct programmatic access:

```ts
const imagePx = GALLERY_PIN_TRACK_PX;
const r = imagePx > 0 ? (s - videoCardPx) / imagePx : 1;
return clamp01(VID_FLY_END + r * (1 - VID_FLY_END));
```

In `src/scrollGovernor.ts`, keep `TimelineProgress`, `animationEndY`,
`timelineProgressForY`, `scrollYForTimelineProgress`, `videoTimeForY`,
`scrollYForVideoTime`, and `videoGovernorBounds`. Change `physicalTracks()` so:

```ts
return {
  animY: ((SCROLL_TRACK_VH - 100) / 100) * innerHeight,
  videoCardPx: (VIDEO_CARD_TRACK_VH / 100) * innerHeight,
  imagePx: GALLERY_PIN_TRACK_PX,
};
```

Remove `ScrollGovernorState`, `ScrollSample`, `ScrollGovernorStep`, and all
mutation functions (`createScrollGovernorState` through
`syncRawScrollPosition`).

- [ ] **Step 5: Resize the real document spacer**

In `src/components/Scene.tsx`, import `VIDEO_CARD_TRACK_VH` and
`GALLERY_PIN_TRACK_PX`, then use:

```tsx
height: `calc(${SCROLL_TRACK_VH + VIDEO_CARD_TRACK_VH}vh + ${GALLERY_PIN_TRACK_PX}px)`,
```

- [ ] **Step 6: Run the focused mapping check**

Run: `npx tsx scripts/check-scroll-governor.ts`

Expected: PASS with no output.

- [ ] **Step 7: Commit the physical-track change**

```bash
git add src/constants.ts src/gallery.ts src/scrollGovernor.ts src/components/Scene.tsx scripts/check-scroll-governor.ts
git commit -m "refactor(scroll): replace gallery runway with pin span"
```

### Task 3: Replace the controller with a pinned gesture state machine

**Files:**
- Modify: `src/scrollTimelineController.ts`
- Rewrite: `scripts/check-scroll-lifecycle.ts`

- [ ] **Step 1: Define deterministic controller scenarios**

Rewrite `scripts/check-scroll-lifecycle.ts` around a fake cancellable event and
fake animation frames. The fake event must expose `preventDefault()` and count
calls. The focused scenarios are:

```ts
// 1. Native scroll before the seam publishes raw scroll progress with no cancel.
// 2. A wheel delta projected across the seam is cancelled and lands at seamY.
// 3. All remaining wheel events in that entry burst are cancelled; gp stays VID_FLY_END.
// 4. After the quiet window, the first new wheel burst advances index 0 -> 1 only.
// 5. More events in the same burst cannot advance index 1 -> 2.
// 6. Input during the transition is cancelled and not queued.
// 7. A new quiet-separated gesture after transition advances one more index.
// 8. One touch swipe crossing TOUCH_STEP_PX advances once; extra touchmove does not.
// 9. A touch that enters at the seam cannot also advance a photo.
// 10. Reverse at index 0 releases to native-before without replaying the swipe.
// 11. Forward at the CTA scrolls once to galleryEndY and enters native-after.
// 12. Scrolling keys advance once; editable and modified keys remain untouched.
// 13. blur, visibilitychange, touchcancel, resize, and dispose clear ownership.
// 14. No publication contains divergent rawY/virtualY or discarded-distance fields.
```

The harness should advance fake time explicitly and assert `gp`, `galleryMode`,
`galleryStep`, cancelled-event count, and `scrollToCalls` after each action.

- [ ] **Step 2: Run the lifecycle check and confirm the old architecture fails**

Run: `npx tsx scripts/check-scroll-lifecycle.ts`

Expected: FAIL because the old controller exposes virtual-governor publications
and does not cancel pinned gestures.

- [ ] **Step 3: Replace controller types**

Use these public contracts in `src/scrollTimelineController.ts`:

```ts
export type GalleryMode =
  | "native-before"
  | "gallery-idle"
  | "gallery-transitioning"
  | "native-after";

export interface ScrollTimelinePublication {
  scrollY: number;
  sp: number;
  gp: number;
  clipT: number;
  galleryMode: GalleryMode;
  galleryStep: number;
}

export interface ScrollTimelineControllerEnvironment {
  windowTarget: ScrollTimelineEventTarget;
  documentTarget: ScrollTimelineEventTarget;
  readScrollY(): number;
  readInnerHeight(): number;
  readInnerWidth(): number;
  readVisibilityState(): string;
  readNow(): number;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(id: number): void;
  requestFrame(callback: (now: number) => void): number;
  cancelFrame(id: number): void;
  scrollTo(options: { top: number; behavior: "auto" }): void;
}
```

Set `WHEEL_QUIET_MS = 140`, `TOUCH_STEP_PX = 24`, and
`GALLERY_TRANSITION_MS = 520` as exported tuning constants for deterministic
checks.

- [ ] **Step 4: Implement native entry without coordinate divergence**

Compute `seamY = videoGovernorBounds(innerHeight).endY` and
`galleryEndY = scrollYForTimelineProgress({ sp: 1, gp: 1 }, innerHeight)`.
Before the seam, publish directly from `timelineProgressForY(readScrollY())`.

Normalize wheel deltas by `deltaMode` (pixels, 16px lines, or one viewport page).
If a forward wheel projects across `seamY`, call `preventDefault()`, perform one
`scrollTo({ top: seamY, behavior: "auto" })`, set step index `0`, publish
`gp = galleryStepTargets()[0]`, and hold the entry burst until quiet. Do not
apply any excess distance.

For touch, record `clientY` at `touchstart`; on `touchmove`, compare the current
finger displacement with the remaining distance to `seamY`. Cancel and enter
before the browser can apply the crossing move. The touch that enters is marked
consumed through `touchend` and cannot request a gallery step.

- [ ] **Step 5: Implement one-step gesture ownership**

While gallery mode is pinned:

```ts
function acceptIntent(direction: -1 | 1) {
  if (!galleryReady || mode === "gallery-transitioning") return;
  const result = requestGalleryStep(stepper, direction);
  if (result.kind === "release-before") return releaseBefore();
  if (result.kind === "release-after") return releaseAfter();
  stepper = result.state;
  animateGalleryTo(result.targetGp);
}
```

For wheel/touchpad, accept only the first intent of a burst and restart its quiet
timer on every residual event. For touch, accept only once after displacement
crosses `TOUCH_STEP_PX`. Always cancel gallery-owned events. For keys, treat each
non-repeat scrolling keydown as one intent and cancel it; ignore editable,
modified, and repeated keydowns.

- [ ] **Step 6: Animate exactly one adjacent target**

`animateGalleryTo(targetGp)` stores the current rendered `gp`, target, and start
time, sets `gallery-transitioning`, then updates on animation frames using:

```ts
const u = Math.min(Math.max((now - startedAt) / GALLERY_TRANSITION_MS, 0), 1);
const eased = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
galleryGp = fromGp + (targetGp - fromGp) * eased;
```

At `u === 1`, snap exactly to `targetGp`. Return to `gallery-idle` only if the
gesture/burst is also finished; otherwise remain unavailable until its quiet
end. Events received during the transition are consumed and never queued.

- [ ] **Step 7: Implement clean releases**

`releaseBefore()` consumes the boundary gesture, sets `native-before`, and moves
to `Math.max(seamY - 1, 0)` once. `releaseAfter()` consumes the boundary gesture,
sets `native-after`, and moves to `galleryEndY` once. Neither release preserves
or replays gesture distance. Subsequent browser input is native.

On backward entry from `native-after`, cancel the crossing event, move to
`galleryEndY`, restore the terminal step/CTA target, and require quiet/new input
before rewinding.

- [ ] **Step 8: Run the focused lifecycle check**

Run: `npx tsx scripts/check-scroll-lifecycle.ts`

Expected: PASS with no output.

- [ ] **Step 9: Commit the controller replacement**

```bash
git add src/scrollTimelineController.ts scripts/check-scroll-lifecycle.ts
git commit -m "fix(scroll): pin gallery to one step per gesture"
```

### Task 4: Wire the single-coordinate controller into React

**Files:**
- Modify: `src/hooks/useScrollProgress.ts`
- Modify: `src/components/Scene.tsx`
- Modify: `scripts/check-playback.ts`

- [ ] **Step 1: Simplify timeline refs and diagnostics**

In `src/hooks/useScrollProgress.ts`, remove `virtualYRef`, `rawY`, `virtualY`,
`gestureActive`, `gestureLocksGallery`, and `discardedForwardPx`. Keep:

```ts
export interface ScrollTimelineRefs {
  scrollRef: MutableRefObject<number>;
  galleryRef: MutableRefObject<number>;
}

interface ScrollTimelineDiagnostic {
  scrollY: number;
  sp: number;
  gp: number;
  clipT: number;
  galleryMode: GalleryMode;
  galleryStep: number;
}
```

`writeScrollTimelineRefs` writes only `sp` and `gp`.

- [ ] **Step 2: Wire browser timing and cancellable listeners**

Provide the environment with:

```ts
readNow: () => performance.now(),
requestFrame: (callback) => window.requestAnimationFrame(callback),
cancelFrame: (id) => window.cancelAnimationFrame(id),
```

Remove `readDocumentEnd()` and `readRootScrollEnabled()` because the new
controller has explicit physical bounds and never derives a second cursor.

- [ ] **Step 3: Remove obsolete structural assertions**

In `scripts/check-playback.ts`, replace source-text assertions for
`logicalMaxY`, `virtualY`, governor suppression, and the 420vh image runway with
assertions for `GALLERY_PIN_TRACK_PX`, semantic targets, and the absence of
`reanchor`/`discardedForwardPx` in runtime source.

- [ ] **Step 4: Run only focused static/type checks for handoff safety**

Run: `npx tsx scripts/check-playback.ts`

Expected: PASS with the updated architectural assertions.

Run: `npm run typecheck`

Expected: PASS with no TypeScript diagnostics.

- [ ] **Step 5: Commit the React integration**

```bash
git add src/hooks/useScrollProgress.ts src/components/Scene.tsx scripts/check-playback.ts
git commit -m "refactor(scroll): wire pinned gallery controller"
```

### Task 5: Prepare the manual-validation handoff

**Files:**
- No production file changes expected.

- [ ] **Step 1: Confirm the worktree contains only intended committed changes**

Run: `git status --short`

Expected: no output.

- [ ] **Step 2: Start the existing local development server**

Run: `npm run dev -- --host 0.0.0.0`

Expected: Vite reports a local URL and a LAN URL.

- [ ] **Step 3: Hand off these exact manual checks**

Ask the user to verify on phone and desktop:

1. A violent final video swipe stops at the first photo-ready gallery state.
2. The scrollbar stays fixed at the seam—no race to the bottom and no return.
3. A fresh swipe/wheel/touchpad gesture advances one card only.
4. Another input during the card animation does not queue or accelerate.
5. Reverse gestures rewind one card at a time.
6. The last-card gesture reveals the CTA; the next forward gesture releases the
   scrollbar to the end.

- [ ] **Step 4: Defer the full regression sweep**

Do not run `npm run build`, browser screenshots, performance scripts, or the full
verification set until the user confirms the interaction is correct. After that
approval, run the complete project verification and only then discuss push,
merge, or Vercel deployment.
