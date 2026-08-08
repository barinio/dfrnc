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

// Mobile URL-bar height changes keep the cached mapping. A width/orientation
// change refreshes it and directly resynchronizes the current raw coordinate.
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
