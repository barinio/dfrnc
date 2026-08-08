// Executable browser-lifecycle checks for the shared governed scroll controller.
// Run manually with: npx tsx scripts/check-scroll-lifecycle.ts
import {
  createScrollTimelineController,
  writeScrollTimelineRefs,
} from "../src/scrollTimelineController";
import type {
  ScrollTimelineControllerEnvironment,
  ScrollTimelineEventListener,
  ScrollTimelineListenerOptions,
  ScrollTimelinePublication,
} from "../src/scrollTimelineController";
import {
  scrollYForTimelineProgress,
  timelineProgressForY,
  videoGovernorBounds,
} from "../src/scrollGovernor";
import { VID_FLY_END, VIDEO_DURATION_S } from "../src/constants";

function ok(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(label);
}

function eq(actual: number, expected: number, label: string, eps = 1e-9) {
  ok(Number.isFinite(actual), `${label}: actual is finite`);
  ok(Number.isFinite(expected), `${label}: expected is finite`);
  if (Math.abs(actual - expected) > eps) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function captureFor(options?: ScrollTimelineListenerOptions): boolean {
  if (typeof options === "boolean") return options;
  return Boolean(options?.capture);
}

interface ListenerRecord {
  type: string;
  listener: ScrollTimelineEventListener;
  capture: boolean;
  passive: boolean;
}

class FakeEventTarget {
  private listeners: ListenerRecord[] = [];
  addCount = 0;
  removeCount = 0;
  unmatchedRemoveCount = 0;

  addEventListener(
    type: string,
    listener: ScrollTimelineEventListener,
    options?: ScrollTimelineListenerOptions,
  ) {
    this.addCount += 1;
    this.listeners.push({
      type,
      listener,
      capture: captureFor(options),
      passive: typeof options === "object" && Boolean(options.passive),
    });
  }

  removeEventListener(
    type: string,
    listener: ScrollTimelineEventListener,
    options?: ScrollTimelineListenerOptions,
  ) {
    this.removeCount += 1;
    const capture = captureFor(options);
    const index = this.listeners.findIndex(
      (entry) =>
        entry.type === type &&
        entry.listener === listener &&
        entry.capture === capture,
    );
    if (index < 0) {
      this.unmatchedRemoveCount += 1;
      return;
    }
    this.listeners.splice(index, 1);
  }

  dispatch(type: string, event: Record<string, unknown> = {}) {
    for (const entry of [...this.listeners]) {
      if (entry.type === type) entry.listener(event);
    }
  }

  listenerCount(type?: string): number {
    return type
      ? this.listeners.filter((entry) => entry.type === type).length
      : this.listeners.length;
  }

  passiveCount(type: string): number {
    return this.listeners.filter(
      (entry) => entry.type === type && entry.passive,
    ).length;
  }
}

interface ScheduledTimer {
  id: number;
  at: number;
  callback: () => void;
}

class FakeTimers {
  now = 0;
  private nextId = 1;
  private timers = new Map<number, ScheduledTimer>();

  setTimeout = (callback: () => void, delayMs: number): number => {
    const id = this.nextId;
    this.nextId += 1;
    this.timers.set(id, {
      id,
      at: this.now + Math.max(Number.isFinite(delayMs) ? delayMs : 0, 0),
      callback,
    });
    return id;
  };

  clearTimeout = (id: number) => {
    this.timers.delete(id);
  };

  advance(ms: number) {
    const target = this.now + ms;
    for (;;) {
      const next = [...this.timers.values()]
        .filter((timer) => timer.at <= target)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!next) break;
      this.timers.delete(next.id);
      this.now = next.at;
      next.callback();
    }
    this.now = target;
  }

  get size(): number {
    return this.timers.size;
  }
}

class FakeEnvironment implements ScrollTimelineControllerEnvironment {
  readonly windowTarget = new FakeEventTarget();
  readonly documentTarget = new FakeEventTarget();
  readonly timers = new FakeTimers();
  scrollY = 0;
  innerHeight = 844;
  innerWidth = 390;
  maxScrollY = 100_000;
  visibilityState = "visible";
  scrollToCalls: Array<{ top: number; behavior: "auto" }> = [];
  emitScrollFromScrollTo = false;
  emitScrollEndFromScrollTo = false;

  readScrollY = () => this.scrollY;
  readInnerHeight = () => this.innerHeight;
  readInnerWidth = () => this.innerWidth;
  readDocumentEnd = () => this.maxScrollY;
  readVisibilityState = () => this.visibilityState;
  now = () => this.timers.now;
  setTimeout = this.timers.setTimeout;
  clearTimeout = this.timers.clearTimeout;

  scrollTo = (options: { top: number; behavior: "auto" }) => {
    this.scrollToCalls.push(options);
    this.scrollY = options.top;
    if (this.emitScrollFromScrollTo) this.windowTarget.dispatch("scroll");
    if (this.emitScrollEndFromScrollTo) {
      this.windowTarget.dispatch("scrollend");
    }
  };

  scrollToRaw(y: number) {
    this.scrollY = y;
    this.windowTarget.dispatch("scroll");
  }

  touchStart(touchCount = 1) {
    this.windowTarget.dispatch("touchstart", {
      touches: Array.from({ length: touchCount }),
    });
  }

  touchEnd(remainingTouches = 0) {
    this.windowTarget.dispatch("touchend", {
      touches: Array.from({ length: remainingTouches }),
    });
  }

  wheel() {
    this.windowTarget.dispatch("wheel");
  }

  keyDown(
    key: string,
    extra: Record<string, unknown> = {},
  ) {
    this.windowTarget.dispatch("keydown", {
      key,
      defaultPrevented: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      target: null,
      ...extra,
    });
  }

  resize() {
    this.windowTarget.dispatch("resize");
  }
}

function createHarness(initialY: number, initialReducedMotion = false) {
  const environment = new FakeEnvironment();
  environment.scrollY = initialY;
  let reducedMotion = initialReducedMotion;
  const publications: ScrollTimelinePublication[] = [];
  const controller = createScrollTimelineController({
    environment,
    reducedMotion: () => reducedMotion,
    onPublish: (publication) => publications.push(publication),
  });
  const latest = () => {
    const publication = publications.at(-1);
    ok(publication, "controller has published a timeline snapshot");
    return publication;
  };

  return {
    environment,
    publications,
    controller,
    latest,
    setReducedMotion(value: boolean) {
      reducedMotion = value;
    },
  };
}

const IH = 844;
const bounds = videoGovernorBounds(IH);

// Runtime sentinel: this catches swapped or raw-scroll-backed returned refs.
{
  const refs = {
    scrollRef: { current: -1 },
    galleryRef: { current: -2 },
    virtualYRef: { current: -3 },
  };
  writeScrollTimelineRefs(refs, {
    sp: 0.125,
    gp: 0.875,
    virtualY: 321,
  });
  eq(refs.scrollRef.current, 0.125, "scrollRef receives governed sp");
  eq(refs.galleryRef.current, 0.875, "galleryRef receives governed gp");
  eq(refs.virtualYRef.current, 321, "virtualYRef receives the virtual cursor");
}

// One touch gesture may finish the video but cannot carry inertia into images.
{
  const harness = createHarness(bounds.endY - 1);
  const { environment, latest, controller } = harness;
  environment.touchStart();
  environment.scrollToRaw(bounds.endY + 100);
  eq(latest().gp, VID_FLY_END, "governed touch lands at the video-card seam");
  environment.touchEnd();
  const heldY = latest().virtualY;

  environment.scrollToRaw(heldY + 200);
  eq(latest().virtualY, heldY, "post-touch forward inertia is quarantined");
  ok(latest().discardedForwardPx > 0, "quarantined inertia is discarded");

  environment.timers.advance(119);
  environment.scrollToRaw(heldY + 50);
  eq(latest().virtualY, heldY, "each residual sample extends quarantine");
  environment.timers.advance(120);

  environment.touchStart();
  environment.scrollToRaw(heldY + 100);
  ok(latest().gp > VID_FLY_END, "a fresh gesture enters the image gallery");
  controller.dispose();
}

// Even an aligned end needs quarantine: otherwise no reanchor mismatch exists
// to make the reducer set suppressForward.
for (const [label, alignedY] of [
  ["at video end", bounds.endY],
  ["before video", bounds.startY - 100],
] as const) {
  const harness = createHarness(alignedY);
  const { environment, latest, controller } = harness;
  environment.touchStart();
  environment.touchEnd();
  environment.scrollToRaw(alignedY + 100);
  eq(
    latest().virtualY,
    alignedY,
    `aligned touch end ${label} quarantines forward inertia`,
  );
  environment.scrollToRaw(alignedY - 20);
  eq(
    latest().virtualY,
    alignedY - 20,
    `reverse remains immediate during aligned quarantine ${label}`,
  );
  controller.dispose();
}

// Wheel and scrolling-key bursts end at the exact 120ms boundary.
for (const [label, begin] of [
  ["wheel", (environment: FakeEnvironment) => environment.wheel()],
  ["key", (environment: FakeEnvironment) => environment.keyDown("ArrowDown")],
] as const) {
  const harness = createHarness(100);
  const { environment, latest, controller } = harness;
  begin(environment);
  ok(latest().gestureActive, `${label} begins an explicit gesture`);
  environment.timers.advance(119);
  ok(latest().gestureActive, `${label} remains active before 120ms`);
  environment.timers.advance(1);
  ok(!latest().gestureActive, `${label} ends at exactly 120ms`);
  environment.scrollToRaw(200);
  eq(latest().virtualY, 100, `${label} end quarantines forward residue`);
  controller.dispose();
}

// Touch and wheel/key bursts are independent modalities. Ending one must not
// terminate or quarantine the other modality's still-live gesture.
{
  const harness = createHarness(100);
  const { environment, latest, controller } = harness;
  environment.wheel();
  environment.touchStart();
  environment.touchEnd();
  ok(
    latest().gestureActive,
    "touchend does not finish an overlapping wheel burst",
  );
  environment.scrollToRaw(150);
  eq(
    latest().virtualY,
    150,
    "delayed wheel scroll remains attributed after overlapping touchend",
  );
  eq(
    latest().discardedForwardPx,
    0,
    "overlapping delayed wheel movement is not residual discard",
  );
  environment.timers.advance(120);
  ok(!latest().gestureActive, "overlapping wheel gesture ends at wheel quiet");
  controller.dispose();
}

{
  const harness = createHarness(100);
  const { environment, latest, controller } = harness;
  environment.touchStart();
  environment.wheel();
  environment.timers.advance(120);
  ok(
    latest().gestureActive,
    "wheel quiet does not finish an overlapping active touch",
  );
  environment.scrollToRaw(150);
  eq(latest().virtualY, 150, "touch remains attributed after wheel quiet");
  environment.touchEnd();
  ok(!latest().gestureActive, "final touchend finishes overlapping modalities");
  controller.dispose();
}

// Remaining fingers keep the touch modality active, and duplicate terminal
// events after the gesture ended are idempotent.
{
  const harness = createHarness(100);
  const { environment, latest, publications, controller } = harness;
  environment.touchStart(2);
  environment.touchEnd(1);
  ok(latest().gestureActive, "one remaining touch keeps the gesture active");
  environment.scrollToRaw(150);
  eq(latest().virtualY, 150, "remaining-finger scroll stays attributed");
  environment.touchEnd(0);
  ok(!latest().gestureActive, "last finger ends the gesture");
  const publicationCount = publications.length;
  environment.touchEnd(0);
  eq(
    publications.length,
    publicationCount,
    "duplicate touchend after completion is a no-op",
  );
  controller.dispose();
}

// Unattributed programmatic movement is exact, while attributed forward input
// through the FPV range is capped to one initial frame quantum.
{
  const harness = createHarness(bounds.startY);
  const { environment, latest, controller } = harness;
  const programmaticY = bounds.startY + 2_000;
  environment.scrollToRaw(programmaticY);
  eq(latest().virtualY, programmaticY, "unattributed programmatic scroll bypasses");
  environment.scrollToRaw(bounds.startY);
  eq(latest().virtualY, bounds.startY, "programmatic setup can seek backward exactly");

  environment.touchStart();
  environment.scrollToRaw(bounds.startY + 2_000);
  ok(
    latest().clipT <= (1000 / 60) / (VIDEO_DURATION_S * 1000) + 1e-10,
    "attributed first forward sample obeys the native-speed quantum",
  );
  ok(
    latest().virtualY < bounds.startY + 2_000,
    "attributed forward distance is not accidentally bypassed",
  );
  controller.dispose();
}

// A guarded self-reanchor event is accepted only at its exact target. A
// mismatched event is a real residual sample and is processed/reanchored again.
{
  const harness = createHarness(bounds.startY);
  const { environment, latest, controller } = harness;
  environment.touchStart();
  environment.scrollToRaw(bounds.startY + 2_000);
  environment.touchEnd();
  const targetY = latest().virtualY;
  const callsAfterEnd = environment.scrollToCalls.length;
  ok(callsAfterEnd > 0, "capped end requests a guarded reanchor");

  environment.scrollToRaw(targetY + 50);
  eq(latest().virtualY, targetY, "mismatched expected event is processed");
  ok(
    environment.scrollToCalls.length > callsAfterEnd,
    "mismatched expected event is reanchored again",
  );
  ok(latest().discardedForwardPx > 0, "mismatched residual is accounted");
  controller.dispose();
}

// scrollend generated synchronously by our own scrollTo must never release the
// quarantine before later native inertia arrives.
{
  const harness = createHarness(bounds.startY);
  const { environment, latest, controller } = harness;
  environment.emitScrollFromScrollTo = true;
  environment.emitScrollEndFromScrollTo = true;
  environment.touchStart();
  environment.scrollToRaw(bounds.startY + 2_000);
  const governedY = latest().virtualY;
  environment.touchEnd();
  eq(
    latest().virtualY,
    governedY,
    "the exact expected reanchor target event is ignored",
  );
  const heldY = latest().virtualY;

  environment.scrollToRaw(heldY + 100);
  eq(
    latest().virtualY,
    heldY,
    "self-scrollend cannot release suppression before residual inertia",
  );
  environment.timers.advance(120);
  environment.scrollToRaw(heldY + 100);
  eq(
    latest().virtualY,
    heldY + 100,
    "programmatic scrolling bypasses again after bounded quiet",
  );
  controller.dispose();
}

// scrollend only starts a new quiet window. At 119ms it must defer release for
// a fresh full 120ms, and a residual sample in that window rearms it again.
{
  const harness = createHarness(100);
  const { environment, latest, controller } = harness;
  environment.touchStart();
  environment.touchEnd();
  environment.timers.advance(119);
  environment.windowTarget.dispatch("scrollend");
  environment.timers.advance(1);
  environment.scrollToRaw(200);
  eq(
    latest().virtualY,
    100,
    "scrollend at 119ms cannot release quarantine at the old deadline",
  );
  environment.timers.advance(119);
  ok(environment.timers.size > 0, "residual sample owns a fresh quiet timer");
  environment.timers.advance(1);
  environment.scrollToRaw(200);
  eq(
    latest().virtualY,
    200,
    "quarantine releases only after the fresh 120ms quiet window",
  );
  controller.dispose();
}

// A height-only toolbar change can move the live physical document end while
// the logical vh timeline stays mounted at its original height. Neither a
// shorter nor a longer physical end may move the logical gallery endpoint.
// Raw bookkeeping remains physical so reversing out of longer-end slack has no
// dead zone.
{
  const logicalEndY = scrollYForTimelineProgress({ sp: 1, gp: 1 }, IH);
  const harness = createHarness(logicalEndY);
  const { environment, latest, controller } = harness;
  eq(latest().gp, 1, "logical endpoint begins at gp=1");

  environment.innerHeight = IH + 154;
  environment.maxScrollY = logicalEndY - 154;
  environment.scrollY = environment.maxScrollY;
  environment.resize();
  environment.windowTarget.dispatch("scroll");
  eq(
    latest().virtualY,
    logicalEndY,
    "shorter physical end preserves the logical virtual endpoint",
  );
  eq(latest().gp, 1, "shorter physical end preserves gp=1");
  environment.scrollToRaw(environment.maxScrollY - 100);
  eq(
    latest().virtualY,
    logicalEndY - 100,
    "offset-aware programmatic bypass applies the physical raw delta",
  );
  environment.scrollToRaw(environment.maxScrollY);
  eq(
    latest().virtualY,
    logicalEndY,
    "offset-aware programmatic bypass returns to the logical endpoint",
  );

  environment.innerHeight = IH - 100;
  environment.maxScrollY = logicalEndY + 100;
  environment.scrollY = environment.maxScrollY;
  environment.resize();
  environment.windowTarget.dispatch("scroll");
  eq(
    latest().virtualY,
    logicalEndY,
    "longer physical end preserves the logical virtual endpoint",
  );
  eq(latest().gp, 1, "longer physical end preserves gp=1");

  environment.touchStart();
  environment.scrollToRaw(environment.maxScrollY - 10);
  eq(
    latest().virtualY,
    logicalEndY - 10,
    "reverse from physical slack moves the logical cursor immediately",
  );
  environment.touchEnd();
  environment.timers.advance(120);

  const programmaticY = logicalEndY - 500;
  environment.scrollToRaw(programmaticY);
  eq(
    latest().virtualY,
    programmaticY,
    "programmatic bypass remains exact inside the logical timeline",
  );
  controller.dispose();
}

// Height-only resize during an active touch synchronizes raw bookkeeping but
// preserves both the logical cursor and the active gesture. The next physical
// delta is applied from the synchronized raw coordinate, not misread as a jump.
{
  const harness = createHarness(100);
  const { environment, latest, controller } = harness;
  environment.touchStart();
  environment.scrollY = 80;
  environment.innerHeight += 100;
  environment.resize();
  eq(latest().virtualY, 100, "height-only resize leaves active virtualY unchanged");
  ok(latest().gestureActive, "height-only resize preserves active touch lifecycle");
  environment.scrollToRaw(70);
  eq(
    latest().virtualY,
    90,
    "post-toolbar reverse uses the synchronized physical raw delta",
  );
  controller.dispose();
}

// A width/orientation change refreshes the cached mapping and directly
// resynchronizes the current raw coordinate.
{
  const initialY = bounds.startY / 2;
  const harness = createHarness(initialY);
  const { environment, latest, controller } = harness;
  environment.innerHeight = 1_000;
  environment.resize();
  const sameWidthY = initialY + 100;
  environment.scrollToRaw(sameWidthY);
  const cachedExpected = timelineProgressForY(sameWidthY, IH);
  eq(latest().sp, cachedExpected.sp, "same-width resize keeps cached height sp");
  eq(latest().gp, cachedExpected.gp, "same-width resize keeps cached height gp");

  environment.innerWidth += 1;
  environment.resize();
  const refreshedExpected = timelineProgressForY(sameWidthY, 1_000);
  eq(latest().sp, refreshedExpected.sp, "width resize refreshes height sp");
  eq(latest().gp, refreshedExpected.gp, "width resize refreshes height gp");
  controller.dispose();
}

// A reduced-motion rerender changes live semantics through the getter without
// reinstalling listeners or recaching the viewport.
{
  const harness = createHarness(bounds.startY);
  const { environment, latest, controller, setReducedMotion } = harness;
  const addCount =
    environment.windowTarget.addCount + environment.documentTarget.addCount;
  environment.touchStart();
  environment.scrollToRaw(bounds.startY + 1_000);
  ok(latest().virtualY < bounds.startY + 1_000, "normal mode is governed");

  setReducedMotion(true);
  const directY = bounds.startY + 2_000;
  environment.scrollToRaw(directY);
  eq(latest().virtualY, directY, "updated reduced-motion mode bypasses directly");
  eq(
    environment.windowTarget.addCount + environment.documentTarget.addCount,
    addCount,
    "reduced-motion update causes no listener churn",
  );
  controller.dispose();
}

// If reduced motion flips after a capped sample but before touchend, terminal
// handling must direct-sync to the current raw position. Reanchoring backward
// to the stale governed cursor would violate reduced-motion semantics.
{
  const harness = createHarness(bounds.startY);
  const { environment, latest, controller, setReducedMotion } = harness;
  environment.touchStart();
  const dirtyRawY = bounds.startY + 1_000;
  environment.scrollToRaw(dirtyRawY);
  ok(latest().virtualY < dirtyRawY, "pre-flip touch sample is capped");
  const scrollToCount = environment.scrollToCalls.length;

  setReducedMotion(true);
  environment.touchEnd();
  eq(
    latest().virtualY,
    dirtyRawY,
    "dirty reduced-motion touchend synchronizes directly to raw",
  );
  ok(!latest().gestureActive, "dirty reduced-motion touchend clears gesture state");
  eq(
    environment.scrollToCalls.length,
    scrollToCount,
    "dirty reduced-motion touchend performs no backward reanchor",
  );
  eq(environment.timers.size, 0, "dirty reduced-motion finish clears lifecycle timers");

  setReducedMotion(false);
  environment.touchStart();
  const recoveredRawY = dirtyRawY + 1_000;
  environment.scrollToRaw(recoveredRawY);
  ok(latest().gestureActive, "false mode starts a fresh governed gesture");
  ok(
    latest().virtualY < recoveredRawY,
    "true-to-false recovery restores the forward cap",
  );
  controller.dispose();
}

// Blur and hidden visibility reconcile and cancel both active and suppressed
// lifecycles, leaving no timer or stale quarantine behind.
for (const [label, interrupt] of [
  [
    "blur",
    (environment: FakeEnvironment) => {
      environment.windowTarget.dispatch("blur");
    },
  ],
  [
    "hidden",
    (environment: FakeEnvironment) => {
      environment.visibilityState = "hidden";
      environment.documentTarget.dispatch("visibilitychange");
    },
  ],
] as const) {
  const harness = createHarness(bounds.startY);
  const { environment, latest, controller, setReducedMotion } = harness;
  environment.touchStart();
  const dirtyRawY = bounds.startY + 1_000;
  environment.scrollToRaw(dirtyRawY);
  ok(latest().virtualY < dirtyRawY, `${label} reduced fixture is capped`);
  const scrollToCount = environment.scrollToCalls.length;

  setReducedMotion(true);
  interrupt(environment);
  eq(
    latest().virtualY,
    dirtyRawY,
    `${label} in reduced motion synchronizes directly to current raw`,
  );
  ok(!latest().gestureActive, `${label} reduced terminal clears gesture state`);
  eq(environment.timers.size, 0, `${label} reduced terminal clears all timers`);
  eq(
    environment.scrollToCalls.length,
    scrollToCount,
    `${label} reduced terminal performs no backward reanchor`,
  );

  setReducedMotion(false);
  environment.visibilityState = "visible";
  environment.touchStart();
  const recoveredRawY = dirtyRawY + 1_000;
  environment.scrollToRaw(recoveredRawY);
  ok(latest().gestureActive, `${label} false recovery starts a fresh gesture`);
  ok(
    latest().virtualY < recoveredRawY,
    `${label} false recovery restores the forward cap`,
  );
  controller.dispose();
}

{
  const harness = createHarness(bounds.startY);
  const { environment, latest, controller } = harness;
  environment.touchStart();
  environment.scrollToRaw(bounds.startY + 1_000);
  environment.windowTarget.dispatch("blur");
  ok(!latest().gestureActive, "blur ends an active gesture");
  eq(environment.timers.size, 0, "blur clears active lifecycle timers");
  const directY = latest().virtualY + 100;
  environment.scrollToRaw(directY);
  eq(latest().virtualY, directY, "post-blur programmatic scroll bypasses exactly");
  controller.dispose();
}

{
  const harness = createHarness(bounds.startY);
  const { environment, latest, controller } = harness;
  environment.touchStart();
  environment.scrollToRaw(bounds.startY + 1_000);
  environment.touchEnd();
  ok(environment.timers.size > 0, "suppressed lifecycle owns timers before hidden");
  environment.visibilityState = "hidden";
  environment.documentTarget.dispatch("visibilitychange");
  ok(!latest().gestureActive, "hidden visibility leaves no active gesture");
  eq(environment.timers.size, 0, "hidden visibility clears suppression/guard timers");
  const directY = latest().virtualY + 100;
  environment.scrollToRaw(directY);
  eq(latest().virtualY, directY, "post-hidden programmatic scroll bypasses exactly");
  controller.dispose();
}

// Width/orientation resize is a terminal resync even during active or
// suppressed lifecycles: it clears timers and gesture state.
for (const [label, prepare] of [
  [
    "active",
    (environment: FakeEnvironment) => {
      environment.touchStart();
      environment.wheel();
    },
  ],
  [
    "suppressed",
    (environment: FakeEnvironment) => {
      environment.touchStart();
      environment.scrollToRaw(bounds.startY + 1_000);
      environment.touchEnd();
    },
  ],
] as const) {
  const harness = createHarness(bounds.startY);
  const { environment, latest, controller } = harness;
  prepare(environment);
  ok(environment.timers.size > 0, `${label} resize fixture owns timers`);
  environment.innerWidth += 1;
  environment.innerHeight += 50;
  environment.resize();
  ok(!latest().gestureActive, `width resize clears ${label} gesture state`);
  eq(environment.timers.size, 0, `width resize clears ${label} timers`);
  const directY = environment.scrollY + 100;
  environment.scrollToRaw(directY);
  eq(
    latest().virtualY,
    directY,
    `post-width-resize ${label} programmatic scroll bypasses exactly`,
  );
  controller.dispose();
}

// Disposal is a real unmount: capture-compatible listener removals, no timers,
// and no later event can publish or mutate the timeline.
{
  const harness = createHarness(100);
  const { environment, publications, controller } = harness;
  environment.wheel();
  ok(environment.timers.size > 0, "active burst owns a timer before unmount");
  controller.dispose();
  eq(environment.windowTarget.listenerCount(), 0, "window listeners removed");
  eq(environment.documentTarget.listenerCount(), 0, "document listeners removed");
  eq(environment.windowTarget.unmatchedRemoveCount, 0, "window capture/options match");
  eq(environment.documentTarget.unmatchedRemoveCount, 0, "document capture/options match");
  eq(environment.timers.size, 0, "unmount clears every timer");
  const publicationCount = publications.length;
  environment.touchStart();
  environment.wheel();
  environment.keyDown("ArrowDown");
  environment.scrollToRaw(500);
  environment.resize();
  environment.windowTarget.dispatch("scrollend");
  environment.timers.advance(1_000);
  eq(
    publications.length,
    publicationCount,
    "post-unmount events publish nothing",
  );
}

// Disposal also clears the suppression quiet timer and expected-reanchor guard
// together; advancing fake time afterward cannot publish.
{
  const harness = createHarness(bounds.startY);
  const { environment, publications, controller } = harness;
  environment.touchStart();
  environment.scrollToRaw(bounds.startY + 1_000);
  environment.touchEnd();
  ok(
    environment.timers.size >= 2,
    "suppression and expected-reanchor timers are scheduled before dispose",
  );
  const publicationCount = publications.length;
  controller.dispose();
  eq(environment.timers.size, 0, "dispose clears suppression and guard timers");
  environment.timers.advance(1_000);
  eq(
    publications.length,
    publicationCount,
    "disposed suppression/guard timers publish nothing",
  );
}

// Passive/native behavior is observable, not just a source comment.
{
  const harness = createHarness(0);
  const { environment, controller } = harness;
  eq(environment.windowTarget.listenerCount("scroll"), 1, "one shared scroll listener");
  eq(environment.windowTarget.passiveCount("scroll"), 1, "scroll listener is passive");
  eq(environment.windowTarget.passiveCount("touchstart"), 1, "touchstart is passive");
  eq(environment.windowTarget.passiveCount("touchend"), 1, "touchend is passive");
  eq(environment.windowTarget.passiveCount("touchcancel"), 1, "touchcancel is passive");
  eq(environment.windowTarget.passiveCount("wheel"), 1, "wheel is passive");
  controller.dispose();
}

console.log("✓ shared scroll lifecycle controller");
