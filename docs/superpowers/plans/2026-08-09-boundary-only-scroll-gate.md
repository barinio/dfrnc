# Boundary-only Scroll Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore native mobile scroll distance and inertia throughout the video while consuming the remainder of a boundary-reaching gesture before it can move the first image card.

**Architecture:** Keep the existing physical-scroll-to-video mapping, including `VIDEO_TIME_KNOTS`, but simplify the pure governor to a gesture-lifetime clamp at the existing `gp = VID_FLY_END` seam. The controller will keep post-`touchend` momentum attributed to its originating touch until 120 ms of scroll quiet, with a timer independent from wheel/key bursts. The reducer alone decides whether an ended gesture needs residual suppression; ordinary gestures ending inside the video remain native.

**Tech Stack:** TypeScript 6, React 18, Vite 5, pure `npx tsx` assertion scripts, Puppeteer/CDP trusted-input verification.

---

## File map

- Modify: `src/scrollGovernor.ts` — remove elapsed-time rate limiting and retain only the gesture-lifetime gallery seam clamp.
- Modify: `src/scrollTimelineController.ts` — attribute touch inertia after `touchend` and remove unconditional gesture quarantine.
- Modify: `src/hooks/useScrollProgress.ts` — remove the now-unused clock adapter.
- Modify: `scripts/check-scroll-governor.ts` — replace native-speed/rate-budget assertions with deterministic boundary-only behavior.
- Modify: `scripts/check-scroll-lifecycle.ts` — cover post-touch momentum ownership, seam burn, and a fresh gallery swipe.
- Modify: `scripts/check-playback.ts` — update static integration contracts for boundary-only suppression and touch momentum cleanup.
- Modify: `scripts/verify/governor.mjs` — replace rate measurements with one-event trusted-input seam verification.

### Task 1: Replace the 1× playback budget with a boundary-only pure governor

**Files:**
- Modify: `scripts/check-scroll-governor.ts`
- Modify: `src/scrollGovernor.ts`

- [ ] **Step 1: Replace the rate-oriented assertions with failing native-distance and seam assertions**

Keep the current `nowMs` call shape temporarily so the test compiles against the old reducer. Replace the block beginning at `const INITIAL_INPUT_QUANTUM_MS` with assertions equivalent to:

```ts
const maxScrollY = animY + videoCardPx + imagePx;

function begunAt(y: number) {
  return beginScrollGesture(createScrollGovernorState(y), 0);
}

let state = begunAt(bounds.startY);
let step = applyScrollSample(state, {
  rawY: bounds.startY + 333,
  nowMs: 16,
  innerHeight: IH,
  maxScrollY,
});
eq(step.state.virtualY, bounds.startY + 333, "video input keeps exact native distance");
eq(step.discardedForwardPx, 0, "interior video input discards nothing");

let ended = endScrollGesture(step.state, IH);
ok(!ended.needsReanchor, "aligned interior end needs no reanchor");
ok(!ended.state.suppressForward, "interior end keeps native momentum unsuppressed");

state = begunAt(bounds.startY);
step = applyScrollSample(state, {
  rawY: bounds.endY + 321,
  nowMs: 16,
  innerHeight: IH,
  maxScrollY,
});
eq(step.state.virtualY, bounds.endY, "one huge sample reaches the video endpoint");
eqProgress(step.progress, { sp: 1, gp: VID_FLY_END }, "huge sample stops at gallery seam");
eq(step.discardedForwardPx, 321, "only endpoint excess is discarded");

step = applyScrollSample(step.state, {
  rawY: bounds.endY + 418,
  nowMs: 32,
  innerHeight: IH,
  maxScrollY,
});
eq(step.state.virtualY, bounds.endY, "same gesture cannot enter image cards");
eq(step.discardedForwardPx, 97, "further same-gesture forward input burns completely");

step = applyScrollSample(step.state, {
  rawY: bounds.endY + 168,
  nowMs: 48,
  innerHeight: IH,
  maxScrollY,
});
eq(step.state.virtualY, bounds.endY - 250, "reverse remains exact");
ok(step.state.gestureLocksGallery, "reverse retains the gesture gallery lock");

step = applyScrollSample(step.state, {
  rawY: bounds.endY + 418,
  nowMs: 64,
  innerHeight: IH,
  maxScrollY,
});
eq(step.state.virtualY, bounds.endY, "re-forward in the same gesture clamps again");

state = begunAt(bounds.endY - 1);
step = applyScrollSample(state, {
  rawY: bounds.endY,
  nowMs: 16,
  innerHeight: IH,
  maxScrollY,
});
ended = endScrollGesture(step.state, IH);
ok(!ended.needsReanchor, "aligned seam end needs no coordinate repair");
ok(ended.state.suppressForward, "aligned seam end still suppresses late inertia");
```

Retain the authored-knot, inverse mapping, invalid-input, bypass, reduced-motion, zero-delta/no-debt, repeated-begin, bounds, suppression release, and fresh-gesture coverage. Delete only assertions about elapsed gaps, initial frame credit, 1× source-time movement, banked time, and alternating-direction time budgets.

- [ ] **Step 2: Run the pure check and confirm RED**

Run:

```bash
npx tsx scripts/check-scroll-governor.ts
```

Expected: failure at `video input keeps exact native distance` because the current reducer permits only a frame-sized clip-time increment. If that unexpectedly passes, the one-huge-sample endpoint assertion must still fail against the current time cap; stop if neither assertion fails.

- [ ] **Step 3: Remove time-budget state and implement the gesture-lifetime seam clamp**

In `src/scrollGovernor.ts`:

- remove the `VIDEO_DURATION_S` import;
- delete `ScrollDirection`, `lastInputAtMs`, `direction`, and `ScrollSample.nowMs`;
- delete `INITIAL_INPUT_QUANTUM_MS`, `MAX_ACTIVE_GAP_MS`, `sampleTime`, and `forwardInputMs`;
- change `beginScrollGesture(state, nowMs)` to `beginScrollGesture(state)`;
- remove timing/direction writes from normalization, bypass, invalid-height, reverse, and forward branches.

Replace the positive rate-limited branch with distance-only logic:

```ts
const requestedY = clampDocumentY(
  current.virtualY + rawDelta,
  maxVirtualY,
  current.virtualY,
);
const bounds = videoGovernorBounds(sample.innerHeight);
const hasGovernor = bounds.endY > bounds.startY;
const intersectsVideo =
  hasGovernor &&
  current.virtualY < bounds.endY &&
  requestedY > bounds.startY;
const gestureLocksGallery =
  current.gestureLocksGallery ||
  (current.gestureActive && intersectsVideo);

let virtualY = requestedY;
if (hasGovernor && gestureLocksGallery) {
  virtualY = Math.min(virtualY, bounds.endY);
}
```

Keep negative raw deltas one-to-one and preserve `gestureLocksGallery` after reversal. Calculate discarded pixels only after the endpoint clamp:

```ts
virtualY = clampDocumentY(virtualY, maxVirtualY, current.virtualY);
const appliedForwardPx = Math.max(virtualY - current.virtualY, 0);
const discardedForwardPx = Math.max(rawDelta - appliedForwardPx, 0);
```

Make gesture-end suppression boundary-specific:

```ts
const needsReanchor = current.lastRawY !== current.virtualY;
const bounds = videoGovernorBounds(innerHeight);
const atLockedBoundary =
  current.gestureLocksGallery &&
  bounds.endY > bounds.startY &&
  current.virtualY >= bounds.endY;

const ended: ScrollGovernorState = {
  ...current,
  gestureActive: false,
  suppressForward:
    current.suppressForward || needsReanchor || atLockedBoundary,
};
```

- [ ] **Step 4: Finalize the pure test for the new API and fresh-gesture gallery entry**

Remove every `nowMs` sample property and timestamp argument from `scripts/check-scroll-governor.ts`. Change the helper to:

```ts
function begunAt(y: number) {
  return beginScrollGesture(createScrollGovernorState(y));
}
```

Ensure the suite explicitly proves that only a fresh gesture may enter the gallery:

```ts
state = beginScrollGesture(ended.state);
step = applyScrollSample(state, {
  rawY: bounds.endY + 100,
  innerHeight: IH,
  maxScrollY,
});
ok(step.progress.gp > VID_FLY_END, "fresh gesture enters the image gallery");
eq(step.discardedForwardPx, 0, "fresh gallery input is not discarded");
```

Rename the final log line to `✓ invertible timeline and boundary-only scroll governor`.

- [ ] **Step 5: Run GREEN, scan for obsolete budget code, and commit**

```bash
npx tsx scripts/check-scroll-governor.ts
rg -n "VIDEO_DURATION_S|INITIAL_INPUT_QUANTUM_MS|MAX_ACTIVE_GAP_MS|forwardInputMs|lastInputAtMs|direction|nowMs" src/scrollGovernor.ts scripts/check-scroll-governor.ts
git diff --check
git add src/scrollGovernor.ts scripts/check-scroll-governor.ts
git commit -m "fix(scroll): gate only the video-gallery boundary"
```

Expected: the assertion script passes; `rg` finds only the intentional `VIDEO_DURATION_S` import/assertion that still verifies the authored clip duration in `scripts/check-scroll-governor.ts`, and none of the removed budget/state identifiers; the commit succeeds.

### Task 2: Keep native touch momentum in the originating gesture

**Files:**
- Modify: `scripts/check-scroll-lifecycle.ts`
- Modify: `src/scrollTimelineController.ts`
- Modify: `src/hooks/useScrollProgress.ts`
- Modify: `scripts/check-playback.ts`

- [ ] **Step 1: Write failing controller lifecycle assertions**

Remove the old expectation that every `touchend`, wheel quiet, or key quiet quarantines aligned forward movement. Add a touch-momentum scenario that begins inside the governed video:

```ts
{
  const harness = createHarness(bounds.startY);
  const { environment, latest, controller } = harness;

  environment.touchStart();
  environment.scrollToRaw(bounds.startY + 333);
  eq(latest().virtualY, bounds.startY + 333, "finger scroll uses exact raw distance");

  environment.touchEnd();
  ok(latest().gestureActive, "touchend keeps the momentum gesture active");

  environment.scrollToRaw(bounds.endY + 500);
  eq(latest().gp, VID_FLY_END, "post-touch momentum reaches the gallery seam");
  const heldY = latest().virtualY;

  environment.scrollToRaw(bounds.endY + 800);
  eq(latest().virtualY, heldY, "same momentum gesture burns at the seam");
  ok(latest().discardedForwardPx > 0, "seam excess is recorded as discarded");

  environment.timers.advance(119);
  ok(latest().gestureActive, "touch momentum remains active before 120ms quiet");
  environment.timers.advance(1);
  ok(!latest().gestureActive, "touch momentum ends at 120ms quiet");

  environment.touchStart();
  environment.scrollToRaw(heldY + 100);
  ok(latest().gp > VID_FLY_END, "fresh touch immediately moves the first image card");
  controller.dispose();
}
```

Add a second scenario proving ordinary inertia remains native and rearms its own quiet window:

```ts
environment.touchStart();
environment.scrollToRaw(bounds.startY + 100);
environment.touchEnd();
environment.timers.advance(119);
environment.scrollToRaw(bounds.startY + 250);
eq(latest().virtualY, bounds.startY + 250, "ordinary inertia remains exact");
environment.timers.advance(119);
ok(latest().gestureActive, "momentum scroll rearms touch quiet");
environment.timers.advance(1);
ok(!latest().gestureActive, "rearmed touch quiet ends exactly");
environment.scrollToRaw(bounds.startY + 350);
eq(latest().virtualY, bounds.startY + 350, "aligned interior end leaves no quarantine");
```

Also update multi-touch and overlap expectations:

- the last finger starts momentum ownership rather than finishing synchronously;
- a duplicate terminal `touchend` is a no-op and does not rearm the timer;
- wheel quiet cannot finish an active touch or touch momentum burst;
- touch quiet cannot finish a still-active wheel/key burst;
- a fresh `touchstart` before old momentum quiet finalizes the old boundary gesture and starts a clean one;
- reverse movement during touch momentum remains exact.

- [ ] **Step 2: Run the lifecycle check and confirm RED**

Run:

```bash
npx tsx scripts/check-scroll-lifecycle.ts
```

Expected: failure at `touchend keeps the momentum gesture active` because the current controller ends and quarantines the gesture immediately.

- [ ] **Step 3: Add touch-momentum ownership with an independent quiet timer**

In `src/scrollTimelineController.ts`, add state independent from the wheel/key timer:

```ts
let touchActive = false;
let touchMomentumActive = false;
let touchMomentumEndTimer: number | null = null;
let burstActive = false;
let burstEndTimer: number | null = null;
```

Add cleanup and quiet helpers:

```ts
const clearTouchMomentumEndTimer = () => {
  if (touchMomentumEndTimer === null) return;
  environment.clearTimeout(touchMomentumEndTimer);
  touchMomentumEndTimer = null;
};

const endTouchMomentumAfterQuiet = () => {
  clearTouchMomentumEndTimer();
  touchMomentumEndTimer = environment.setTimeout(() => {
    touchMomentumEndTimer = null;
    touchMomentumActive = false;
    finishGestureIfIdle();
  }, INPUT_QUIET_MS);
};
```

Make idle finishing depend on all three attribution flags and let the reducer alone decide suppression:

```ts
const finishGesture = () => {
  if (reducedMotion()) {
    finishReducedMotionLifecycle();
    return;
  }

  const step = endScrollGesture(state, innerHeight);
  publishStep(step);
  if (step.needsReanchor) reanchor();
  armSuppressionQuiet();
};

const finishGestureIfIdle = () => {
  if (
    touchActive ||
    touchMomentumActive ||
    burstActive ||
    !state.gestureActive
  ) return;
  finishGesture();
};
```

Delete `quarantineRealGesture` and the unconditional `suppressForward: true` controller override.

Attribute native post-touch scroll events before calculating bypass:

```ts
if (touchMomentumActive && !touchActive) {
  endTouchMomentumAfterQuiet();
}
const hasExplicitAttribution =
  touchActive || touchMomentumActive || burstActive;
```

Update touch handlers:

```ts
const onTouchStart: ScrollTimelineEventListener = (event) => {
  if (touchCount(event) <= 0) return;

  if (!touchActive && touchMomentumActive) {
    clearTouchMomentumEndTimer();
    touchMomentumActive = false;
    finishGestureIfIdle();
  }

  touchActive = true;
  beginExplicitGesture();
};

const onTouchEnd: ScrollTimelineEventListener = (event) => {
  if (touchCount(event) > 0 || !touchActive) return;
  touchActive = false;

  if (reducedMotion()) {
    finishReducedMotionLifecycle();
    return;
  }

  touchMomentumActive = true;
  endTouchMomentumAfterQuiet();
};
```

`onWheel` and `onKeyDown` keep their existing independent `burstEndTimer`. If a wheel/key burst overlaps touch momentum, neither timer may finish the reducer gesture while the other modality remains active.

- [ ] **Step 4: Clear momentum state on every terminal path and remove the dead clock API**

Call `clearTouchMomentumEndTimer()` and set `touchMomentumActive = false` in:

- `finishReducedMotionLifecycle`;
- `resetInterruptedGesture`;
- width-changing `onResize`;
- `dispose`.

Remove `now()` from `ScrollTimelineControllerEnvironment`, all `nowMs` sample fields, and all timestamp arguments to `beginScrollGesture`. Remove the `now` adapter from `src/hooks/useScrollProgress.ts` and the fake `now` implementation from `scripts/check-scroll-lifecycle.ts`; retain `FakeTimers.now` internally because timer scheduling still uses it.

- [ ] **Step 5: Update static integration checks to reject the old behavior**

In `scripts/check-playback.ts`:

- update `finishGestureIfIdle` source checks to require `touchMomentumActive` as well as `touchActive` and `burstActive`;
- require `touchend` to arm a 120 ms momentum quiet window;
- require `onScroll` during touch momentum to rearm that window;
- require reduced-motion, blur/hidden, width-resize, and dispose paths to clear the touch-momentum timer and flag;
- require `finishGesture` to delegate suppression to `endScrollGesture`;
- delete the assertion named `every real gesture receives an aligned-end forward quarantine`;
- add negative assertions forbidding the controller override `state = { ...state, suppressForward: true }` and reducer identifiers `INITIAL_INPUT_QUANTUM_MS`, `MAX_ACTIVE_GAP_MS`, `forwardInputMs`, `lastInputAtMs`.

The DEV `window.__sg` diagnostics contract remains unchanged.

- [ ] **Step 6: Run controller GREEN, typecheck, and commit**

```bash
npx tsx scripts/check-scroll-lifecycle.ts
npx tsx scripts/check-scroll-governor.ts
npx tsx scripts/check-playback.ts
npm run typecheck
git diff --check
git add src/scrollTimelineController.ts src/hooks/useScrollProgress.ts scripts/check-scroll-lifecycle.ts scripts/check-playback.ts
git commit -m "fix(scroll): keep touch momentum inside its gesture"
```

Expected: all deterministic checks and TypeScript pass; ordinary aligned ends do not suppress, seam-reaching ends do.

### Task 3: Replace the rate verifier with trusted boundary verification

**Files:**
- Modify: `scripts/verify/governor.mjs`

- [ ] **Step 1: Remove wall-clock/rate assumptions from the verifier**

Delete `VIDEO_DURATION_S`, `RATE_LIMIT`, `--interval-ms`, `--burst-ms`, `--end-burst-ms`, rate/credit calculations, scenic 1× assertions, the banked-credit scenario, and their metrics. Keep argument parsing for URL/viewport/Chrome, `readGovernor`, DEV diagnostic readiness, mouse placement, failure collection, and bounded browser cleanup.

Add quiet/reset helpers:

```js
async function waitForQuiet(page, minimumMs = 360) {
  await sleep(minimumMs);
  const sample = await readGovernor(page);
  if (sample.gestureActive) throw new Error("gesture remained active");
  if (Math.abs(sample.scrollY - sample.virtualY) > 1) {
    throw new Error("raw/virtual scroll did not reanchor");
  }
  return sample;
}

async function trustedWheelOnce(page, deltaY, accept, label) {
  const before = await readGovernor(page);
  await page.mouse.wheel({ deltaY });
  const deadline = Date.now() + 3000;

  while (Date.now() < deadline) {
    const after = await readGovernor(page);
    if (accept(after, before)) return { before, after, eventCount: 1 };
    await sleep(10);
  }

  throw new Error(`${label}: trusted wheel produced no expected publication`);
}
```

The helper must never retry input: a retry could become a fresh gesture and conceal the exact spillover bug.

- [ ] **Step 2: Verify one oversized real gesture stops exactly at the seam**

Programmatically reset to document top only before the trusted-input story, wait until `scrollY` and `virtualY` are aligned, then calculate the actual document end and send one oversized wheel event:

```js
const documentEnd = await page.evaluate(() => {
  const root = document.scrollingElement || document.documentElement;
  return Math.max(root.scrollHeight - window.innerHeight, 0);
});
const hugeDelta = documentEnd + height;

const boundary = await trustedWheelOnce(
  page,
  hugeDelta,
  (after) =>
    after.clipT >= 1 - 1e-7 &&
    Math.abs(after.gp - 0.4) <= 1e-7 &&
    after.discardedForwardPx > 1,
  "huge boundary gesture",
);
```

Assert that a single event advanced the clip from approximately 0 to 1, stopped at `gp = 0.4`, advanced `virtualY`, and discarded positive excess.

- [ ] **Step 3: Prove no debt, fresh gallery entry, and exact reverse movement**

Without any setup scroll between the boundary and fresh gesture:

```js
const held = boundary.after;
const quiet = await waitForQuiet(page, 360);
assertClose(quiet.virtualY, held.virtualY, 1, "quiet virtual drift");
assertClose(quiet.clipT, held.clipT, 1e-7, "quiet clip drift");
assertClose(quiet.gp, 0.4, 1e-7, "quiet gallery seam");

const freshDelta = Math.max(height * 0.5, 300);
const fresh = await trustedWheelOnce(
  page,
  freshDelta,
  (after) => after.gp > 0.4 + 1e-7,
  "fresh gallery gesture",
);

await waitForQuiet(page, 360);
const reverseDelta = -(freshDelta + height * 0.5);
const reverse = await trustedWheelOnce(
  page,
  reverseDelta,
  (after, before) => after.virtualY < before.virtualY - 1,
  "reverse gesture",
);
```

Assert raw/virtual alignment after quiet, no held-position drift, `fresh.before.gp = 0.4`, `fresh.after.gp > 0.4`, reverse `gp` decreases, and absolute raw-versus-virtual reverse-distance error is at most 1 px.

Print boundary, quiet, fresh, and reverse metrics, ending with:

```text
PASS — boundary-only gate, debt-free quiet, reverse, and fresh gallery gesture
```

- [ ] **Step 4: Run syntax and trusted-input browser checks in mobile and desktop viewports**

Use the already-running feature-worktree Vite server if it is healthy; otherwise start the same worktree on port 5173. Then run:

```bash
node --check scripts/verify/governor.mjs
node scripts/verify/governor.mjs --url http://127.0.0.1:5173 --viewport 390x844
node scripts/verify/governor.mjs --url http://127.0.0.1:5173 --viewport 1280x800
```

Expected: both viewports print the boundary-only PASS line; the huge event holds at `gp = 0.4`, and the fresh event advances beyond it.

- [ ] **Step 5: Commit the verifier rewrite**

```bash
git diff --check
git add scripts/verify/governor.mjs
git commit -m "test(scroll): verify only the gallery boundary gate"
```

### Task 4: Run the complete regression matrix and prepare local phone review

**Files:**
- Verify only unless a regression requires a scoped fix.

- [ ] **Step 1: Run all deterministic and build gates**

```bash
npx tsx scripts/check-scroll-governor.ts
npx tsx scripts/check-scroll-lifecycle.ts
npx tsx scripts/check-playback.ts
npx tsx scripts/check-render-profile.ts
npx tsx scripts/check-frame-loader.ts
npm run typecheck
npm run build
git diff --check
```

Expected: every command exits 0. If any failure appears, diagnose it before changing code and rerun the smallest failing check first.

- [ ] **Step 2: Run mobile browser performance and visual seam checks**

```bash
node scripts/verify/governor.mjs --url http://127.0.0.1:5173 --viewport 390x844
node scripts/verify/framelag.mjs --url http://127.0.0.1:5173 --mbps 6 --track 1240 --viewport 390x844
node scripts/verify/seam.mjs --url http://127.0.0.1:5173 --track 1240 --viewport 390x844
```

Expected: boundary-only governor PASS, frame-lag thresholds pass, and the video/card seam check reports no visual regression.

- [ ] **Step 3: Review the final diff against the approved interaction contract**

Verify explicitly:

- `VIDEO_TIME_KNOTS` and gallery/card timing are unchanged;
- no elapsed-time playback cap remains;
- ordinary touch momentum remains attributed after `touchend`;
- only a seam-reaching or raw/virtual-mismatched gesture suppresses residue;
- the same gesture cannot exceed `gp = 0.4`;
- a fresh gesture can immediately exceed `gp = 0.4`;
- reduced motion, programmatic scroll, same-width resize, width resize, blur/hidden, multi-touch, and disposal retain tested cleanup behavior;
- no unrelated user changes entered the commits.

Run a placeholder and conflict-marker scan:

```bash
rg -n "TODO|FIXME|XXX|<<<<<<<|=======|>>>>>>>" src/scrollGovernor.ts src/scrollTimelineController.ts src/hooks/useScrollProgress.ts scripts/check-scroll-governor.ts scripts/check-scroll-lifecycle.ts scripts/check-playback.ts scripts/verify/governor.mjs
git status --short
git log --oneline -6
```

Expected: no new placeholder/conflict markers; worktree clean; only intentional local commits ahead of the base branch.

- [ ] **Step 4: Keep the local server available for the user's real-phone validation**

Report the LAN URL and a short manual test script:

1. Reload on phone and make a normal swipe through the video; it must feel native, including existing caption slow zones.
2. Make one long, fast swipe near the end; it may complete the video but must leave the first normal image card unmoved.
3. Without waiting for an artificial delay, make a second swipe; exactly that fresh swipe may advance the image gallery.
4. Reverse inside the video and confirm it reacts immediately.

Do not push, merge, open a PR, or deploy to Vercel. Wait for the user's visual approval before any integration action.
