# Mobile Playback Governor and Staged Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce cold reload/render pressure and ensure forward FPV playback never exceeds the source video's native 1x speed or carries one gesture into the image gallery.

**Architecture:** A pure scroll governor owns one virtual scroll cursor and derives both `sp` and `gp`; a React hook groups real touch/wheel/key input around that state machine while leaving native touch scrolling enabled. The frame sequence uses startup anchors, foreground target priority, and yielded background batches. Existing R3F regression is connected to `AdaptiveDpr`, and Lottie stops uploading at its unsmoothed handoff.

**Tech Stack:** React 18, TypeScript, @react-three/fiber, @react-three/drei, Three.js, lottie-web, Vite, `npx tsx` assertion scripts, Puppeteer/CDP verification.

---

## File map

- Create: `src/scrollGovernor.ts` — pure timeline conversion and governor reducer.
- Modify: `src/playback.ts` — inverse clip-time mapping.
- Modify: `src/constants.ts` — source duration.
- Modify: `src/hooks/useScrollProgress.ts` — one shared gesture-aware hook.
- Modify: `src/components/Scene.tsx` — consume shared refs and mount `AdaptiveDpr`.
- Modify: `src/frames.ts` — staged/priority frame scheduler.
- Modify: `src/components/VideoPlane.tsx` — staged readiness and diagnostics.
- Modify: `src/components/LottiePlane.tsx` — raw-target visibility cutoff.
- Create: `scripts/check-scroll-governor.ts` — deterministic governor assertions.
- Create: `scripts/check-frame-loader.ts` — fake-image scheduler assertions.
- Create: `scripts/verify/governor.mjs` — trusted wheel-burst browser verification.
- Modify: `scripts/check-playback.ts`, `scripts/check-render-profile.ts`, `scripts/verify/framelag.mjs` — integration gates.

### Task 1: Make the video timeline invertible

**Files:**
- Modify: `src/constants.ts`
- Modify: `src/playback.ts`
- Create: `src/scrollGovernor.ts`
- Create: `scripts/check-scroll-governor.ts`

- [ ] **Step 1: Write failing round-trip tests**

Create `scripts/check-scroll-governor.ts` with local `eq`/`ok` helpers matching `check-playback.ts`, import the APIs below before they exist, and cover video start, each authored caption knot, `VIDEO_SPLIT`, the `sp→gp` seam, and `VID_FLY_END`:

```ts
import { VIDEO_DURATION_S, VIDEO_SPLIT, VID_FLY_END } from "../src/constants";
import { videoMasterTimeFor, videoTimelinePositionFor } from "../src/playback";
import {
  scrollYForTimelineProgress,
  scrollYForVideoTime,
  timelineProgressForY,
  videoTimeForY,
} from "../src/scrollGovernor";

const IH = 844;
for (const t of [0, 0.11, 0.139, 0.248, 0.592, 0.786, VIDEO_SPLIT, 0.92, 1]) {
  const position = videoTimelinePositionFor(t);
  eq(videoMasterTimeFor(position.sp, position.gp, "scroll"), t, `inverse clip mapping @${t}`, 1e-8);
  const y = scrollYForVideoTime(t, IH);
  eq(videoTimeForY(y, IH), t, `clip↔scroll round trip @${t}`, 1e-8);
  const progress = timelineProgressForY(y, IH);
  eq(progress.sp, position.sp, `sp round trip @${t}`, 1e-8);
  eq(progress.gp, position.gp, `gp round trip @${t}`, 1e-8);
}
eq(VIDEO_DURATION_S, 23.56, "source duration is explicit");
eq(videoTimelinePositionFor(1).gp, VID_FLY_END, "clip ends with the FPV card");
```

- [ ] **Step 2: Run and confirm RED**

Run: `npx tsx scripts/check-scroll-governor.ts`

Expected: import/export failure because the inverse and scroll helpers do not exist.

- [ ] **Step 3: Add the source duration and inverse clip mapping**

In `src/constants.ts`:

```ts
export const VIDEO_DURATION_S = 23.56;
```

In `src/playback.ts`, export:

```ts
export interface VideoTimelinePosition {
  sp: number;
  gp: number;
}

export function videoTimelinePositionFor(t: number): VideoTimelinePosition {
  const f = clamp01(t);
  if (f <= VIDEO_SPLIT) {
    for (let i = 1; i < VIDEO_TIME_KNOTS.length; i++) {
      const [s1, f1] = VIDEO_TIME_KNOTS[i];
      if (f <= f1) {
        const [s0, f0] = VIDEO_TIME_KNOTS[i - 1];
        const u = f1 === f0 ? 0 : (f - f0) / (f1 - f0);
        return { sp: s0 + (s1 - s0) * u, gp: 0 };
      }
    }
    return { sp: 1, gp: 0 };
  }
  return {
    sp: 1,
    gp: clamp01((f - VIDEO_SPLIT) / (1 - VIDEO_SPLIT)) * VID_FLY_END,
  };
}
```

- [ ] **Step 4: Create canonical Y/progress conversion helpers**

Create `src/scrollGovernor.ts` with these public interfaces:

```ts
export interface TimelineProgress { sp: number; gp: number }

export function animationEndY(innerHeight: number): number;
export function timelineProgressForY(y: number, innerHeight: number): TimelineProgress;
export function scrollYForTimelineProgress(
  value: TimelineProgress,
  innerHeight: number,
): number;
export function videoTimeForY(y: number, innerHeight: number): number;
export function scrollYForVideoTime(t: number, innerHeight: number): number;
export function videoGovernorBounds(innerHeight: number): {
  startY: number;
  endY: number;
};
```

Implementation rules:

```ts
const animY = ((SCROLL_TRACK_VH - 100) / 100) * innerHeight;
const videoCardPx = (VIDEO_CARD_TRACK_VH / 100) * innerHeight;
const imagePx = (IMAGE_GALLERY_TRACK_VH / 100) * innerHeight;
```

Use the existing `galleryProgressFrom` for forward conversion. The inverse maps `sp < 1` onto `sp * animY`; `gp <= VID_FLY_END` onto the video-card sub-track; later `gp` onto the image-gallery sub-track. `videoTimeForY` delegates to `videoMasterTimeFor`; `scrollYForVideoTime` delegates to `videoTimelinePositionFor` and the progress inverse.

- [ ] **Step 5: Run GREEN and commit**

```bash
npx tsx scripts/check-scroll-governor.ts
npx tsx scripts/check-playback.ts
git add src/constants.ts src/playback.ts src/scrollGovernor.ts scripts/check-scroll-governor.ts
git commit -m "feat(scroll): add an invertible video timeline"
```

Expected: both assertion scripts pass.

### Task 2: Implement the pure native-speed governor

**Files:**
- Modify: `src/scrollGovernor.ts`
- Modify: `scripts/check-scroll-governor.ts`

- [ ] **Step 1: Add failing state-machine assertions**

Import and exercise these not-yet-created APIs:

```ts
export type ScrollDirection = -1 | 0 | 1;
export interface ScrollGovernorState {
  virtualY: number;
  lastRawY: number;
  lastInputAtMs: number | null;
  direction: ScrollDirection;
  gestureActive: boolean;
  gestureLocksGallery: boolean;
  suppressForward: boolean;
}
export interface ScrollSample {
  rawY: number;
  nowMs: number;
  innerHeight: number;
  maxScrollY: number;
  reducedMotion?: boolean;
  bypass?: boolean;
}
export interface ScrollGovernorStep {
  state: ScrollGovernorState;
  progress: TimelineProgress;
  discardedForwardPx: number;
  needsReanchor: boolean;
}
export function createScrollGovernorState(rawY?: number): ScrollGovernorState;
export function beginScrollGesture(state: ScrollGovernorState, nowMs: number): ScrollGovernorState;
export function applyScrollSample(state: ScrollGovernorState, sample: ScrollSample): ScrollGovernorStep;
export function endScrollGesture(state: ScrollGovernorState, innerHeight: number): ScrollGovernorStep;
export function releaseScrollSuppression(state: ScrollGovernorState): ScrollGovernorState;
export function syncRawScrollPosition(state: ScrollGovernorState, rawY: number): ScrollGovernorState;
```

Required assertions include:

```ts
// A huge 16ms forward request is capped to 16ms of source time.
ok(nextT - previousT <= 16 / (VIDEO_DURATION_S * 1000) + 1e-9, "forward capped at 1x");
// A smaller desired movement is unchanged.
eq(slow.state.virtualY, slowRequestedY, "slow input preserved exactly");
// A 2s gap produces only the first-sample quantum, not two seconds of credit.
eq(afterIdleT - beforeIdleT, (1000 / 60) / (VIDEO_DURATION_S * 1000), "idle is not banked", 1e-8);
// Reverse is direct.
eq(reverse.state.virtualY, beforeReverseY - 2000, "reverse remains immediate");
// The same gesture stops at video end, while a fresh gesture enters the gallery.
eq(held.progress.gp, VID_FLY_END, "same gesture cannot spill into image slides");
ok(fresh.progress.gp > VID_FLY_END, "fresh gallery gesture advances normally");
```

Also assert: excess delta never appears in a later zero-delta sample; direction change resets timing; reduced motion and `bypass` synchronize directly; state clamps to document bounds; `endScrollGesture` requests a re-anchor when raw and virtual Y differ.

- [ ] **Step 2: Run and confirm RED**

Run: `npx tsx scripts/check-scroll-governor.ts`

Expected: missing reducer exports.

- [ ] **Step 3: Implement the reducer**

Use these constants and rule:

```ts
const INITIAL_INPUT_QUANTUM_MS = 1000 / 60;
const MAX_ACTIVE_GAP_MS = 50;
const permittedClipDelta = activeInputMs / (VIDEO_DURATION_S * 1000);
```

Reducer requirements:

- update `lastRawY` for every sample, even when forward distance is discarded;
- when not bypassed, convert `current virtualY → current clip t`, clamp desired forward clip t, then invert the allowed t back to Y;
- preserve smaller forward requests exactly;
- apply reverse deltas directly and reset the direction/time budget;
- reset long gaps to `INITIAL_INPUT_QUANTUM_MS`, so idle cannot become credit;
- set `gestureLocksGallery` as soon as a forward gesture enters the FPV range;
- while locked, clamp at the Y for `gp = VID_FLY_END`;
- clear the previous lock in `beginScrollGesture`, allowing a new gesture that starts at video end to enter the image gallery;
- never store a desired target, token balance, or unapplied delta.

- [ ] **Step 4: Run GREEN and commit**

```bash
npx tsx scripts/check-scroll-governor.ts
git add src/scrollGovernor.ts scripts/check-scroll-governor.ts
git commit -m "feat(scroll): cap forward FPV movement at native speed"
```

### Task 3: Replace independent raw-scroll hooks with one governed controller

**Files:**
- Modify: `src/hooks/useScrollProgress.ts`
- Modify: `src/components/Scene.tsx`
- Modify: `scripts/check-playback.ts`

- [ ] **Step 1: Add failing integration assertions**

Change the source assertions in `scripts/check-playback.ts` to require one shared hook:

```ts
const scrollHookSrc = readFileSync(
  new URL("../src/hooks/useScrollProgress.ts", import.meta.url),
  "utf8",
);
ok(/useScrollTimelineRefs/.test(scrollHookSrc), "one hook owns sp and gp");
ok(/virtualY/.test(scrollHookSrc), "shared hook drives a virtual cursor");
ok(/lastWidth/.test(scrollHookSrc) && /innerHeight/.test(scrollHookSrc), "height stays cached across URL-bar resize");
ok(!/export function useGalleryProgressRef/.test(scrollHookSrc), "gallery no longer has an independent raw-scroll listener");
```

- [ ] **Step 2: Run and confirm RED**

Run: `npx tsx scripts/check-playback.ts`

Expected: FAIL because the two old hooks still exist.

- [ ] **Step 3: Implement the shared hook**

Replace both exports with:

```ts
export interface ScrollTimelineRefs {
  scrollRef: MutableRefObject<number>;
  galleryRef: MutableRefObject<number>;
  virtualYRef: MutableRefObject<number>;
}

export function useScrollTimelineRefs(reducedMotion: boolean): ScrollTimelineRefs;
```

The effect must:

- cache one `innerHeight` and update it only when viewport width changes;
- keep reducer state, `scrollRef`, and `galleryRef` in the same listener so they publish atomically;
- call `beginScrollGesture` on `touchstart` and group `wheel`/scrolling keys into a burst ending after 120ms of quiet;
- leave touch scrolling native while the finger is down;
- treat a `scroll` without a preceding touch/wheel/key burst as `bypass: true`, preserving programmatic `window.scrollTo` verification;
- on `touchend` or burst end, call `endScrollGesture`, guard one programmatic event, re-anchor with `window.scrollTo({ top: virtualY, behavior: "auto" })`, and suppress residual positive momentum until `scrollend` or a quiet timer;
- reset the timing budget on `visibilitychange`, `blur`, direction change, and gesture end;
- recompute from the shared cached height on width/orientation changes, but ignore height-only URL-bar resizes;
- remove every event listener and quiet timer on cleanup.

Expose DEV-only diagnostics:

```ts
window.__sg = {
  rawY: window.scrollY,
  virtualY: state.virtualY,
  sp: scrollRef.current,
  gp: galleryRef.current,
  clipT: videoTimeForY(state.virtualY, innerHeight),
  gestureActive: state.gestureActive,
  gestureLocksGallery: state.gestureLocksGallery,
  discardedForwardPx,
};
```

- [ ] **Step 4: Wire `Scene` to the shared refs**

```ts
import { useScrollTimelineRefs } from "../hooks/useScrollProgress";

const { scrollRef, galleryRef } = useScrollTimelineRefs(reducedMotion);
```

Remove the two old hook calls. No consumer component API changes.

- [ ] **Step 5: Run tests and commit**

```bash
npx tsx scripts/check-scroll-governor.ts
npx tsx scripts/check-playback.ts
npm run typecheck
git add src/hooks/useScrollProgress.ts src/components/Scene.tsx scripts/check-playback.ts
git commit -m "feat(scroll): share governed progress across the scene"
```

### Task 4: Stage the frame-sequence loader

**Files:**
- Modify: `src/frames.ts`
- Create: `scripts/check-frame-loader.ts`

- [ ] **Step 1: Write fake-image scheduler tests**

The loader must expose/inject:

```ts
export function buildStartupAnchorOrder(count: number, anchorCount = 9): number[];
export function buildDirectionalPriority(target: number, previous: number, count: number, radius = 2): number[];
export function frameLoaderBudgetFor(tier: number): {
  concurrency: number;
  backgroundConcurrency: number;
  backgroundBatchSize: number;
};

export interface FrameLoaderOptions {
  concurrency?: number;
  backgroundConcurrency?: number;
  backgroundBatchSize?: number;
  startupAnchorCount?: number;
  neighborRadius?: number;
  onStartupReady?: () => void;
  imageFactory?: () => HTMLImageElement;
  scheduleIdle?: (callback: () => void) => () => void;
}
```

Create `scripts/check-frame-loader.ts` with a fake image factory and manually flushed idle scheduler. Assert:

- the first nine URLs are the coarse anchors `0, 294, 147, 74, 221, 37, 110, 184, 257`;
- mobile uses `{ concurrency: 4, backgroundConcurrency: 2, backgroundBatchSize: 2 }`, desktop `{ 6, 4, 4 }`;
- readiness waits for frame 0 `decode()` plus all settled startup anchors;
- a failed/exhausted anchor does not deadlock readiness;
- no background URL is requested before an idle flush;
- `get(target)` queues the target and directional neighbors ahead of background fill;
- background batches yield and obey their limit;
- nearest-loaded fallback remains inside ±32;
- `dispose()` cancels scheduled idle work and image handlers.

- [ ] **Step 2: Run and confirm RED**

Run: `npx tsx scripts/check-frame-loader.ts`

Expected: missing scheduler exports/options.

- [ ] **Step 3: Implement staged scheduling**

In `FrameSequenceLoader`:

1. Request only the nine startup anchors initially.
2. Call `decode()` only for frame 0; other anchors settle on load/error.
3. Fire `onStartupReady` once frame 0 decoded (or terminally failed) and all nine anchors settled.
4. Reserve foreground capacity for `get(target)` plus the small directional neighbor queue.
5. Only after startup, fill remaining coarse-to-fine entries in yielded batches.
6. Use `requestIdleCallback(..., { timeout: 120 })` when available and a 16ms `setTimeout` fallback.
7. Retry failures inside their original priority class without exceeding three retries.
8. Preserve `loadedCount`, `lastResolved`, `firstReady`, nearest fallback, and `dispose()`.

Add diagnostics:

```ts
get startupReady(): boolean;
get startupLoadedCount(): number;
get inFlightCount(): number;
```

- [ ] **Step 4: Run GREEN and commit**

```bash
npx tsx scripts/check-frame-loader.ts
npx tsx scripts/check-playback.ts
npm run typecheck
git add src/frames.ts scripts/check-frame-loader.ts
git commit -m "perf(frames): stage sequence loading around demand"
```

### Task 5: Integrate staged readiness, real adaptive DPR, and the raw Lottie cutoff

**Files:**
- Modify: `src/components/VideoPlane.tsx`
- Modify: `src/components/Scene.tsx`
- Modify: `src/playback.ts`
- Modify: `src/components/LottiePlane.tsx`
- Modify: `scripts/check-playback.ts`
- Modify: `scripts/check-render-profile.ts`

- [ ] **Step 1: Add failing source and visibility assertions**

```ts
ok(lottiePlaneVisibleFor(LOTTIE_TOTAL_S - 1 / 60, LOTTIE_END - 1e-6), "Lottie visible before raw cutoff");
ok(!lottiePlaneVisibleFor(LOTTIE_TOTAL_S - 1 / 60, LOTTIE_END), "raw cutoff hides trailing smoothed Lottie");
ok(/<AdaptiveDpr\s*\/>/.test(sceneSource), "R3F performance regression drives DPR");
ok(/onStartupReady/.test(videoPlaneSource), "video readiness uses decoded startup coverage");
```

Update existing one-argument `lottiePlaneVisibleFor` assertions to pass a progress value.

- [ ] **Step 2: Run and confirm RED**

```bash
npx tsx scripts/check-playback.ts
npx tsx scripts/check-render-profile.ts
```

Expected: visibility signature/source assertions fail.

- [ ] **Step 3: Integrate `onStartupReady` in `VideoPlane`**

```ts
const tier = frameTierForScreen();
const loader = new FrameSequenceLoader(tier, FRAME_COUNT, {
  ...frameLoaderBudgetFor(tier),
  onStartupReady: () => {
    readyRef.current = true;
    notifyReady();
  },
});
```

Update the readiness comment and extend `window.__fp` with `startupReady`, `startupLoadedCount`, and `inFlight`.

- [ ] **Step 4: Connect the existing regressor to DPR**

```tsx
import { AdaptiveDpr, Environment, useProgress } from "@react-three/drei";

<PerformanceRegressor
  slowFrameMs={renderProfile.slowFrameMs}
  slowFrameLimit={renderProfile.slowFrameLimit}
/>
<AdaptiveDpr />
```

Do not use `pixelated`; temporary reduced resolution remains filtered.

- [ ] **Step 5: Cut Lottie visibility from the unsmoothed scroll target**

In `src/playback.ts`:

```ts
export function lottiePlaneVisibleFor(tSec: number, targetSp: number): boolean {
  return (
    targetSp < LOTTIE_END &&
    tSec < LOTTIE_TOTAL_S - LOTTIE_TRANSPARENT_TAIL_EPS
  );
}
```

In `LottiePlane.tsx`, call `lottiePlaneVisibleFor(tSec, scrollRef.current)` before frame-upload throttling. When false, hide the mesh and return without `goToAndStop` or `texture.needsUpdate`. Reverse scroll below `LOTTIE_END` makes it eligible again.

- [ ] **Step 6: Run full tests and commit**

```bash
npx tsx scripts/check-frame-loader.ts
npx tsx scripts/check-playback.ts
npx tsx scripts/check-render-profile.ts
npm run typecheck
npm run build
git add src/components/VideoPlane.tsx src/components/Scene.tsx src/playback.ts src/components/LottiePlane.tsx scripts/check-playback.ts scripts/check-render-profile.ts
git commit -m "perf(mobile): adapt rendering and end Lottie at the handoff"
```

### Task 6: Trusted-input browser regression

**Files:**
- Create: `scripts/verify/governor.mjs`
- Modify: `scripts/verify/framelag.mjs`

- [ ] **Step 1: Create the wheel-burst verifier**

Use `page.mouse.wheel()` (not `window.scrollTo`) for governed movement and read `window.__sg`. Programmatic jumps without an active burst remain the setup mechanism. Cover:

1. repeated large deltas for one second in a scenic interval; assert `clipDelta * VIDEO_DURATION_S / elapsedSeconds <= 1.05`;
2. 250ms without input; assert clip time is unchanged;
3. a new burst after idle; assert idle time was not banked;
4. a negative burst; assert reverse exceeds the forward 1x allowance and moves backward;
5. one burst starting just before video end; assert `gp <= VID_FLY_END` even after continued momentum;
6. a fresh burst after the 120ms quiet window; assert `gp > VID_FLY_END`.

Exit nonzero on any failed invariant and print sampled max rate, discarded pixels, stop drift, held gp, and fresh-gesture gp.

- [ ] **Step 2: Extend frame-lag diagnostics**

Print `startupReady`, `startupLoadedCount`, and `inFlight`. Fail when startup coverage never becomes ready or `abs(idx - resolved) > 32`; preserve the current detailed worst-sample output.

- [ ] **Step 3: Run the browser matrix**

With the real dev-server port:

```bash
node scripts/verify/governor.mjs --url http://127.0.0.1:5173 --viewport 390x844
node scripts/verify/framelag.mjs --url http://127.0.0.1:5173 --mbps 6 --track 1240 --viewport 390x844
node scripts/verify/seam.mjs --url http://127.0.0.1:5173 --track 1240 --viewport 390x844
```

Expected: governor rate `<=1.05x`, stop drift `0`, same-gesture gp `<= VID_FLY_END`, fresh gesture `> VID_FLY_END`, frame gap within 32 (normally 0–1), and seam `PASS`.

- [ ] **Step 4: Commit the browser regression**

```bash
git add scripts/verify/governor.mjs scripts/verify/framelag.mjs
git commit -m "test(scroll): verify native-speed governed playback"
```

### Task 7: Final mobile and automated verification

**Files:**
- No production edits expected.

- [ ] **Step 1: Run every deterministic gate**

```bash
npx tsx scripts/check-scroll-governor.ts
npx tsx scripts/check-frame-loader.ts
npx tsx scripts/check-playback.ts
npx tsx scripts/check-render-profile.ts
npm run typecheck
npm run build
git diff --check
```

Expected: all exit 0.

- [ ] **Step 2: Real-device/Simulator interaction pass**

On iPhone Safari verify cold and warm reload, both caption dwells, a fast scenic fling, lift-to-stop, reverse, URL-bar collapse, the video-card end, and a new gallery gesture. Expected: no catch-up after lift, no same-fling image slide, immediate reverse, and a new gallery gesture behaves exactly as before.

- [ ] **Step 3: Check repository state**

```bash
git status --short
git log --oneline -8
```

Expected: only intentional commits from this plan and no uncommitted production files.
