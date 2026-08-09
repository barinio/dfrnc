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
import { VID_FLY_END } from "../src/constants";

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
  rootScrollEnabled = true;
  visibilityState = "visible";
  scrollToCalls: Array<{ top: number; behavior: "auto" }> = [];
  emitScrollFromScrollTo = false;
  emitScrollEndFromScrollTo = false;

  readScrollY = () => this.scrollY;
  readInnerHeight = () => this.innerHeight;
  readInnerWidth = () => this.innerWidth;
  readDocumentEnd = () => this.maxScrollY;
  readRootScrollEnabled = () => this.rootScrollEnabled;
  readVisibilityState = () => this.visibilityState;
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

  wheel(deltaY = 0, extra: Record<string, unknown> = {}) {
    this.windowTarget.dispatch("wheel", { deltaY, ...extra });
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

function createHarness(
  initialY: number,
  initialReducedMotion = false,
  initialMaxScrollY = 100_000,
) {
  const environment = new FakeEnvironment();
  environment.scrollY = initialY;
  environment.maxScrollY = initialMaxScrollY;
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
      controller.syncReducedMotion();
    },
  };
}

const IH = 844;
const bounds = videoGovernorBounds(IH);
const documentEndY = scrollYForTimelineProgress({ sp: 1, gp: 1 }, IH);

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

// Ordinary touch inertia belongs to the originating gesture until 120ms of
// quiet. Each post-lift sample replaces (rather than stacks) that one timer.
{
  const initialY = bounds.startY + 500;
  const harness = createHarness(initialY);
  const { environment, latest, publications, controller } = harness;
  environment.touchStart();
  environment.scrollToRaw(initialY + 333);
  eq(
    latest().virtualY,
    initialY + 333,
    "direct touch applies the exact interior raw distance",
  );
  const publicationsBeforeLift = publications.length;
  environment.touchEnd();
  eq(
    Number(latest().gestureActive),
    1,
    "touchend keeps the momentum gesture active",
  );
  eq(
    publications.length,
    publicationsBeforeLift,
    "touchend publishes nothing while momentum remains live",
  );
  eq(environment.timers.size, 1, "touchend owns one momentum quiet timer");

  environment.timers.advance(119);
  environment.scrollToRaw(initialY + 444);
  eq(
    latest().virtualY,
    initialY + 444,
    "post-touch interior momentum remains exact",
  );
  eq(environment.timers.size, 1, "momentum sample replaces its quiet timer");
  environment.timers.advance(1);
  ok(latest().gestureActive, "the replaced old deadline cannot finish momentum");
  environment.timers.advance(118);
  ok(latest().gestureActive, "renewed momentum remains active through 119ms quiet");
  const publicationsBeforeQuiet = publications.length;
  environment.timers.advance(1);
  ok(!latest().gestureActive, "momentum ends at exactly 120ms renewed quiet");
  eq(
    publications.length,
    publicationsBeforeQuiet + 1,
    "aligned interior momentum publishes its finish once",
  );
  eq(environment.timers.size, 0, "aligned interior finish owns no suppression timer");

  environment.scrollToRaw(initialY + 517);
  eq(
    latest().virtualY,
    initialY + 517,
    "later unattributed movement bypasses exactly",
  );
  controller.dispose();
}

// Post-touch native inertia may finish the video, but the same gesture cannot
// spill into gallery cards. Reanchor waits for momentum quiet.
{
  const initialY = bounds.endY - 100;
  const harness = createHarness(initialY);
  const { environment, latest, controller } = harness;
  environment.touchStart();
  environment.touchEnd();
  environment.scrollToRaw(bounds.endY + 300);
  eq(latest().gp, VID_FLY_END, "touch inertia lands at the video-card seam");
  eq(latest().virtualY, bounds.endY, "touch inertia holds the seam coordinate");
  ok(latest().gestureActive, "boundary momentum remains gesture-owned");
  ok(latest().discardedForwardPx > 0, "boundary momentum records discarded residue");
  eq(
    environment.scrollToCalls.length,
    0,
    "live touch momentum performs no reanchor",
  );
  eq(environment.timers.size, 1, "boundary momentum owns one quiet timer");

  environment.timers.advance(119);
  const discardedBeforeResidual = latest().discardedForwardPx;
  environment.scrollToRaw(bounds.endY + 450);
  eq(latest().virtualY, bounds.endY, "further live inertia remains burned");
  ok(
    latest().discardedForwardPx > discardedBeforeResidual,
    "further live inertia adds discard accounting",
  );
  eq(environment.scrollToCalls.length, 0, "renewed live inertia still does not reanchor");
  eq(environment.timers.size, 1, "renewed live inertia replaces its quiet timer");
  environment.timers.advance(1);
  ok(latest().gestureActive, "old boundary momentum deadline is replaced");
  environment.timers.advance(119);

  ok(!latest().gestureActive, "boundary momentum ends after renewed quiet");
  eq(environment.scrollToCalls.length, 1, "dirty boundary finish reanchors once");
  eq(environment.scrollY, bounds.endY, "physical scroll reanchors to the seam");
  eq(latest().virtualY, bounds.endY, "virtual cursor remains at the seam");
  eq(
    environment.timers.size,
    2,
    "boundary finish owns suppression and expected-reanchor guards",
  );
  controller.dispose();
}

// A fresh touch supersedes old touch momentum: finalize/reanchor the old
// boundary gesture, clear its timers and metrics, then begin cleanly at seam.
{
  const harness = createHarness(bounds.endY - 100);
  const { environment, latest, controller } = harness;
  environment.touchStart();
  environment.touchEnd();
  environment.scrollToRaw(bounds.endY + 200);
  ok(latest().discardedForwardPx > 0, "old boundary momentum has discard state");
  ok(latest().gestureLocksGallery, "old boundary momentum owns the gallery lock");
  eq(environment.timers.size, 1, "old boundary momentum owns one timer");

  environment.touchStart();
  ok(latest().gestureActive, "fresh touch begins a clean gesture immediately");
  ok(!latest().gestureLocksGallery, "fresh touch clears the old gallery lock");
  eq(latest().discardedForwardPx, 0, "fresh touch resets discarded metrics");
  eq(environment.scrollToCalls.length, 1, "fresh touch reanchors old dirty momentum once");
  eq(environment.timers.size, 0, "fresh touch clears old momentum and suppression guards");

  environment.scrollToRaw(bounds.endY + 100);
  ok(latest().gp > VID_FLY_END, "fresh touch moves from seam into the gallery");
  eq(
    latest().virtualY,
    bounds.endY + 100,
    "fresh gallery touch applies exact raw distance",
  );
  controller.dispose();
}

// Fresh touch finalization must leave a simultaneous wheel/key burst and its
// original deadline intact.
{
  const harness = createHarness(bounds.endY - 100);
  const { environment, latest, controller } = harness;
  environment.touchStart();
  environment.touchEnd();
  environment.scrollToRaw(bounds.endY + 200);
  environment.timers.advance(20);
  environment.wheel(100);
  environment.timers.advance(40);
  eq(environment.timers.size, 2, "wheel and old touch momentum own two timers");

  environment.touchStart();
  eq(
    environment.timers.size,
    1,
    "fresh touch clears only the old touch-momentum lifecycle timers",
  );
  environment.scrollToRaw(bounds.endY + 100);
  eq(latest().virtualY, bounds.endY + 100, "fresh touch remains exact with live wheel");
  environment.timers.advance(79);
  ok(latest().gestureActive, "wheel deadline was not shortened by fresh touch");
  environment.timers.advance(1);
  eq(environment.timers.size, 0, "wheel clears at its original 120ms deadline");
  ok(latest().gestureActive, "wheel quiet cannot end the active fresh touch");

  environment.touchEnd();
  eq(environment.timers.size, 1, "fresh lift starts its own momentum timer");
  environment.timers.advance(120);
  ok(!latest().gestureActive, "fresh gesture ends after its own momentum quiet");
  controller.dispose();
}

// First direct touch contact also supersedes a wheel/key-only reducer gesture.
// It starts clean at the seam without changing the burst's original deadline.
for (const [label, beginBurst] of [
  ["wheel", (environment: FakeEnvironment) => environment.wheel(300)],
  ["key", (environment: FakeEnvironment) => environment.keyDown("ArrowDown")],
] as const) {
  const harness = createHarness(bounds.endY - 100);
  const { environment, latest, controller } = harness;
  beginBurst(environment);
  environment.scrollToRaw(bounds.endY + 200);
  eq(latest().virtualY, bounds.endY, `${label} burst reaches the seam`);
  ok(latest().gestureLocksGallery, `${label} burst owns the old gallery lock`);
  ok(latest().discardedForwardPx > 0, `${label} burst records boundary discard`);
  eq(environment.timers.size, 1, `${label} burst owns one timer`);

  environment.timers.advance(60);
  const reanchorsBeforeTouch = environment.scrollToCalls.length;
  environment.touchStart();
  eq(environment.timers.size, 1, `first touch preserves the ${label} burst timer`);

  const rawBeforeFirstSwipe = environment.scrollY;
  environment.scrollToRaw(rawBeforeFirstSwipe + 100);
  eq(
    latest().virtualY,
    bounds.endY + 100,
    `first touch swipe after ${label} moves exactly into the gallery`,
  );
  ok(!latest().gestureLocksGallery, `first touch clears the ${label} gallery lock`);
  eq(latest().discardedForwardPx, 0, `first touch clears the ${label} discard metric`);
  eq(
    environment.scrollToCalls.length,
    reanchorsBeforeTouch + 1,
    `first touch reanchors the old ${label} boundary once`,
  );

  environment.timers.advance(59);
  ok(latest().gestureActive, `${label} deadline remains live through 119ms`);
  eq(environment.timers.size, 1, `${label} retains its original timer before quiet`);
  environment.timers.advance(1);
  eq(environment.timers.size, 0, `${label} clears at its original deadline`);
  ok(latest().gestureActive, `${label} quiet cannot end active direct touch`);

  environment.touchEnd();
  eq(environment.timers.size, 1, `terminal touch after ${label} owns momentum quiet`);
  environment.timers.advance(120);
  ok(!latest().gestureActive, `touch after ${label} ends at momentum quiet`);
  controller.dispose();
}

// First touch contact cancels an outstanding default-scroll expectation while
// preserving the burst's already-running deadline. Direct touch publication
// cannot move that deadline or leave burst ownership behind.
for (const [label, beginBurst] of [
  ["wheel", (environment: FakeEnvironment) => environment.wheel(100)],
  ["key", (environment: FakeEnvironment) => environment.keyDown("ArrowDown")],
] as const) {
  const harness = createHarness(100);
  const { environment, latest, controller } = harness;
  beginBurst(environment);
  environment.timers.advance(60);
  environment.touchStart();
  eq(
    environment.timers.size,
    1,
    `${label} takeover preserves the original timer`,
  );
  environment.scrollToRaw(150);
  eq(latest().virtualY, 150, `${label} takeover touch scroll remains exact`);
  environment.timers.advance(59);
  ok(latest().gestureActive, `${label} original deadline remains live at 119ms`);
  eq(
    environment.timers.size,
    1,
    `${label} direct touch does not rearm burst quiet`,
  );
  environment.timers.advance(1);
  ok(latest().gestureActive, `${label} quiet cannot finish direct touch`);
  eq(
    environment.timers.size,
    0,
    `${label} ownership clears on its original deadline`,
  );
  environment.touchEnd();
  environment.timers.advance(120);
  ok(!latest().gestureActive, `${label} takeover has no lingering burst ownership`);
  controller.dispose();
}

// If input quiet elapsed while waiting, touch takeover releases the timerless
// burst immediately so the new touch gesture cannot become indefinite.
for (const [label, beginBurst] of [
  ["wheel", (environment: FakeEnvironment) => environment.wheel(100)],
  ["key", (environment: FakeEnvironment) => environment.keyDown("ArrowDown")],
] as const) {
  const harness = createHarness(100);
  const { environment, latest, controller } = harness;
  beginBurst(environment);
  environment.timers.advance(1_000);
  ok(latest().gestureActive, `${label} fixture is awaiting without a timer`);
  eq(environment.timers.size, 0, `${label} fixture owns no fallback timer`);
  environment.touchStart();
  eq(environment.timers.size, 0, `${label} expired takeover invents no burst timer`);
  environment.touchEnd();
  eq(environment.timers.size, 1, `${label} expired takeover owns only touch quiet`);
  environment.timers.advance(120);
  ok(!latest().gestureActive, `${label} expired takeover finishes with touch quiet`);
  controller.dispose();
}

// A delayed browser-default scroll remains owned even after the input quiet
// deadline. Expected native publication, rather than task ordering, keeps the
// burst alive without a grace timer.
for (const [label, beginBurst] of [
  ["wheel", (environment: FakeEnvironment) => environment.wheel(300)],
  ["key", (environment: FakeEnvironment) => environment.keyDown("ArrowDown")],
] as const) {
  const harness = createHarness(bounds.endY - 100);
  const { environment, latest, controller } = harness;
  beginBurst(environment);
  eq(environment.timers.size, 1, `${label} begins with one quiet timer`);

  environment.timers.advance(1_000);
  ok(latest().gestureActive, `${label} awaits its delayed native scroll`);
  eq(environment.timers.size, 0, `${label} awaiting scroll owns no grace timer`);

  environment.scrollToRaw(bounds.endY + 200);
  eq(latest().virtualY, bounds.endY, `delayed ${label} scroll clamps at the seam`);
  eq(latest().gp, VID_FLY_END, `delayed ${label} scroll stays at gp=VID_FLY_END`);
  ok(latest().discardedForwardPx > 0, `delayed ${label} scroll records discard`);
  ok(latest().gestureActive, `delayed ${label} scroll remains gesture-owned`);
  eq(
    environment.timers.size,
    1,
    `delayed ${label} scroll starts fresh quiet from publication`,
  );

  environment.timers.advance(119);
  ok(latest().gestureActive, `${label} remains owned through 119ms actual quiet`);
  environment.timers.advance(1);
  ok(!latest().gestureActive, `${label} finishes at 120ms actual quiet`);
  eq(environment.scrollToCalls.length, 1, `${label} dirty finish reanchors once`);
  eq(environment.scrollY, bounds.endY, `${label} physical scroll reanchors to seam`);
  eq(latest().virtualY, bounds.endY, `${label} virtual scroll remains at seam`);
  controller.dispose();
}

// Geometric room is not enough while the site's root scroll contract is
// disabled. Locked input finishes normally; a later unlocked input reads the
// live capability, awaits its native publication, and remains boundary-owned.
for (const [label, beginBurst] of [
  ["wheel", (environment: FakeEnvironment) => environment.wheel(300)],
  ["key", (environment: FakeEnvironment) => environment.keyDown("ArrowDown")],
] as const) {
  const harness = createHarness(bounds.endY - 100);
  const { environment, latest, controller } = harness;
  environment.rootScrollEnabled = false;
  beginBurst(environment);
  environment.timers.advance(119);
  ok(latest().gestureActive, `locked ${label} keeps ordinary quiet ownership`);
  environment.timers.advance(1);
  ok(!latest().gestureActive, `locked ${label} finishes without native scroll`);
  eq(environment.timers.size, 0, `locked ${label} leaves no timerless await`);

  environment.rootScrollEnabled = true;
  beginBurst(environment);
  environment.timers.advance(1_000);
  ok(latest().gestureActive, `unlocked ${label} reads live root capability`);
  eq(environment.timers.size, 0, `unlocked ${label} awaits without a grace timer`);
  environment.scrollToRaw(bounds.endY + 200);
  eq(latest().virtualY, bounds.endY, `unlocked ${label} clamps at the seam`);
  eq(latest().gp, VID_FLY_END, `unlocked ${label} holds gp=VID_FLY_END`);
  ok(latest().discardedForwardPx > 0, `unlocked ${label} records discard`);
  eq(environment.timers.size, 1, `unlocked ${label} publication starts quiet`);
  environment.timers.advance(120);
  ok(!latest().gestureActive, `unlocked ${label} finishes after actual quiet`);
  controller.dispose();
}

// The same live root gate applies to reverse intent, and an already-cancelled
// wheel has no browser-default scroll to await.
for (const [label, beginBurst] of [
  ["reverse wheel", (environment: FakeEnvironment) => environment.wheel(-100)],
  ["reverse key", (environment: FakeEnvironment) => environment.keyDown("ArrowUp")],
  [
    "prevented wheel",
    (environment: FakeEnvironment) =>
      environment.wheel(100, { defaultPrevented: true }),
  ],
] as const) {
  const harness = createHarness(bounds.startY + 500);
  const { environment, latest, controller } = harness;
  if (label !== "prevented wheel") environment.rootScrollEnabled = false;
  beginBurst(environment);
  environment.timers.advance(119);
  ok(latest().gestureActive, `${label} remains active through 119ms quiet`);
  environment.timers.advance(1);
  ok(!latest().gestureActive, `${label} does not enter timerless await`);
  eq(environment.timers.size, 0, `${label} finishes without a lingering timer`);
  controller.dispose();
}

// Every supported key maps to the correct physical direction and awaits when
// movement is possible. Cleanup proves an awaited/no-timer burst is terminal.
for (const [key, shiftKey, direction] of [
  ["ArrowDown", false, 1],
  ["PageDown", false, 1],
  ["End", false, 1],
  [" ", false, 1],
  ["Spacebar", false, 1],
  ["ArrowUp", false, -1],
  ["PageUp", false, -1],
  ["Home", false, -1],
  [" ", true, -1],
  ["Spacebar", true, -1],
] as const) {
  const harness = createHarness(direction > 0 ? 100 : 1_000);
  const { environment, latest, controller } = harness;
  environment.keyDown(key, { shiftKey });
  environment.timers.advance(1_000);
  ok(
    latest().gestureActive,
    `${shiftKey ? "shift-" : ""}${key} awaits native movement in its direction`,
  );
  eq(environment.timers.size, 0, `${key} awaited ownership has no grace timer`);
  environment.windowTarget.dispatch("blur");
  ok(!latest().gestureActive, `${key} awaited ownership is interruptible`);
  controller.dispose();
}

// Inputs that cannot change the physical scroll position never await a native
// publication. This includes zero wheel intent and every directional bound.
for (const [label, initialY, maxScrollY, dispatch] of [
  [
    "zero wheel",
    100,
    100_000,
    (environment: FakeEnvironment) => environment.wheel(0),
  ],
  [
    "forward wheel at end",
    documentEndY,
    documentEndY,
    (environment: FakeEnvironment) => environment.wheel(100),
  ],
  [
    "reverse wheel at top",
    0,
    100_000,
    (environment: FakeEnvironment) => environment.wheel(-100),
  ],
  [
    "ArrowDown at end",
    documentEndY,
    documentEndY,
    (environment: FakeEnvironment) => environment.keyDown("ArrowDown"),
  ],
  [
    "PageDown at end",
    documentEndY,
    documentEndY,
    (environment: FakeEnvironment) => environment.keyDown("PageDown"),
  ],
  [
    "End at end",
    documentEndY,
    documentEndY,
    (environment: FakeEnvironment) => environment.keyDown("End"),
  ],
  [
    "space at end",
    documentEndY,
    documentEndY,
    (environment: FakeEnvironment) => environment.keyDown(" "),
  ],
  [
    "ArrowUp at top",
    0,
    100_000,
    (environment: FakeEnvironment) => environment.keyDown("ArrowUp"),
  ],
  [
    "PageUp at top",
    0,
    100_000,
    (environment: FakeEnvironment) => environment.keyDown("PageUp"),
  ],
  [
    "Home at top",
    0,
    100_000,
    (environment: FakeEnvironment) => environment.keyDown("Home"),
  ],
  [
    "shift-space at top",
    0,
    100_000,
    (environment: FakeEnvironment) =>
      environment.keyDown(" ", { shiftKey: true }),
  ],
] as const) {
  const harness = createHarness(initialY, false, maxScrollY);
  const { environment, latest, controller } = harness;
  dispatch(environment);
  eq(environment.timers.size, 1, `${label} starts ordinary burst quiet`);
  environment.timers.advance(119);
  ok(latest().gestureActive, `${label} stays active through 119ms quiet`);
  environment.timers.advance(1);
  ok(!latest().gestureActive, `${label} finishes at exactly 120ms`);
  eq(
    environment.timers.size,
    0,
    `${label} leaves no timer or awaited ownership`,
  );
  controller.dispose();
}

// A prompt native publication consumes awaited ownership and replaces the
// input deadline with one ordinary 120ms quiet timer from that publication.
for (const [label, begin] of [
  ["wheel", (environment: FakeEnvironment) => environment.wheel(100)],
  ["key", (environment: FakeEnvironment) => environment.keyDown("ArrowDown")],
] as const) {
  const initialY = bounds.startY + 500;
  const harness = createHarness(initialY);
  const { environment, latest, controller } = harness;
  begin(environment);
  environment.timers.advance(100);
  environment.scrollToRaw(initialY + 100);
  eq(latest().virtualY, initialY + 100, `${label} applies prompt native distance`);
  eq(environment.timers.size, 1, `${label} prompt scroll owns one fresh timer`);
  environment.timers.advance(20);
  ok(latest().gestureActive, `${label} old input deadline was replaced`);
  environment.timers.advance(99);
  ok(latest().gestureActive, `${label} remains active through 119ms scroll quiet`);
  environment.timers.advance(1);
  ok(!latest().gestureActive, `${label} finishes 120ms after prompt publication`);
  eq(environment.timers.size, 0, `${label} prompt finish leaves no timer`);
  controller.dispose();
}

// Later burst inputs recompute expected movement instead of retaining stale
// awaited state from an earlier event.
{
  const harness = createHarness(100);
  const { environment, latest, controller } = harness;
  environment.wheel(100);
  environment.timers.advance(60);
  environment.wheel(0);
  environment.timers.advance(119);
  ok(latest().gestureActive, "zero wheel replacement preserves its own quiet window");
  environment.timers.advance(1);
  ok(!latest().gestureActive, "zero wheel replacement clears stale awaited ownership");

  environment.wheel(0);
  environment.timers.advance(60);
  environment.wheel(100);
  environment.timers.advance(1_000);
  ok(latest().gestureActive, "later directional wheel establishes fresh awaited ownership");
  eq(environment.timers.size, 0, "fresh awaited ownership uses no grace timer");
  environment.windowTarget.dispatch("blur");
  controller.dispose();
}

// Wheel and scrolling-key bursts end at 120ms, and an aligned interior finish
// does not quarantine later forward movement.
for (const [label, begin] of [
  ["wheel", (environment: FakeEnvironment) => environment.wheel(100)],
  ["key", (environment: FakeEnvironment) => environment.keyDown("ArrowDown")],
] as const) {
  const initialY = bounds.startY + 500;
  const harness = createHarness(initialY);
  const { environment, latest, controller } = harness;
  begin(environment);
  environment.scrollToRaw(initialY + 100);
  eq(latest().virtualY, initialY + 100, `${label} applies exact interior distance`);
  environment.timers.advance(119);
  ok(latest().gestureActive, `${label} remains active before 120ms`);
  environment.timers.advance(1);
  ok(!latest().gestureActive, `${label} ends at exactly 120ms`);
  eq(environment.timers.size, 0, `${label} aligned interior finish has no quarantine`);
  environment.scrollToRaw(initialY + 200);
  eq(latest().virtualY, initialY + 200, `${label} later forward movement is exact`);
  controller.dispose();
}

// Independent modality deadlines clear only their own ownership. The last live
// modality publishes the one shared gesture finish.
{
  const harness = createHarness(100);
  const { environment, latest, publications, controller } = harness;
  environment.wheel(100);
  environment.timers.advance(60);
  environment.touchStart();
  const publicationsBeforeLift = publications.length;
  environment.touchEnd();
  eq(publications.length, publicationsBeforeLift, "overlap touchend publishes nothing");
  eq(environment.timers.size, 2, "wheel then touch owns two independent timers");
  const publicationsBeforeWheelQuiet = publications.length;
  environment.timers.advance(60);
  eq(environment.timers.size, 1, "wheel quiet clears only the wheel timer");
  ok(latest().gestureActive, "wheel quiet cannot finish live touch momentum");
  eq(
    publications.length,
    publicationsBeforeWheelQuiet,
    "non-final wheel quiet publishes no finish",
  );
  environment.timers.advance(60);
  ok(!latest().gestureActive, "touch quiet finishes after wheel ownership clears");
  eq(
    publications.length,
    publicationsBeforeWheelQuiet + 1,
    "final touch modality publishes one finish",
  );
  controller.dispose();
}

{
  const harness = createHarness(100);
  const { environment, latest, publications, controller } = harness;
  environment.touchStart();
  environment.touchEnd();
  environment.timers.advance(60);
  environment.wheel(100);
  eq(environment.timers.size, 2, "touch then wheel owns two independent timers");
  const publicationsBeforeTouchQuiet = publications.length;
  environment.timers.advance(60);
  eq(environment.timers.size, 1, "touch quiet clears only the touch timer");
  ok(latest().gestureActive, "touch quiet cannot finish a live wheel burst");
  eq(
    publications.length,
    publicationsBeforeTouchQuiet,
    "non-final touch quiet publishes no finish",
  );
  environment.timers.advance(60);
  ok(!latest().gestureActive, "wheel quiet finishes after touch ownership clears");
  eq(
    publications.length,
    publicationsBeforeTouchQuiet + 1,
    "final wheel modality publishes one finish",
  );
  controller.dispose();
}

// Direct touch also remains authoritative across an unrelated wheel timeout.
{
  const harness = createHarness(100);
  const { environment, latest, controller } = harness;
  environment.touchStart();
  environment.wheel(100);
  environment.timers.advance(120);
  ok(latest().gestureActive, "wheel quiet does not finish active direct touch");
  environment.scrollToRaw(150);
  eq(latest().virtualY, 150, "direct touch remains attributed after wheel quiet");
  environment.touchEnd();
  ok(latest().gestureActive, "terminal lift transitions direct touch to momentum");
  environment.timers.advance(120);
  ok(!latest().gestureActive, "touch momentum quiet finishes the gesture");
  controller.dispose();
}

// Remaining fingers retain direct ownership. A duplicate terminal event is a
// complete no-op and cannot extend the original momentum deadline.
{
  const harness = createHarness(100);
  const { environment, latest, publications, controller } = harness;
  environment.touchStart(2);
  environment.touchEnd(1);
  ok(latest().gestureActive, "one remaining touch keeps direct ownership");
  eq(environment.timers.size, 0, "remaining touch starts no momentum timer");
  environment.scrollToRaw(150);
  eq(latest().virtualY, 150, "remaining-finger scroll stays attributed");
  const publicationsBeforeTerminal = publications.length;
  environment.touchEnd(0);
  ok(latest().gestureActive, "terminal touchend retains momentum ownership");
  eq(
    publications.length,
    publicationsBeforeTerminal,
    "terminal touchend publishes nothing",
  );
  eq(environment.timers.size, 1, "terminal touchend owns one momentum timer");
  environment.timers.advance(60);
  const publicationsBeforeDuplicate = publications.length;
  environment.touchEnd(0);
  eq(
    publications.length,
    publicationsBeforeDuplicate,
    "duplicate terminal touchend publishes nothing",
  );
  eq(environment.timers.size, 1, "duplicate terminal touchend adds no timer");
  environment.timers.advance(59);
  ok(latest().gestureActive, "duplicate terminal does not shorten the deadline");
  environment.timers.advance(1);
  ok(!latest().gestureActive, "duplicate terminal does not extend the deadline");
  controller.dispose();
}

// Unattributed movement and attributed interior movement both preserve exact
// distance; only a gesture that intersects the video/gallery seam is clamped.
{
  const harness = createHarness(bounds.startY);
  const { environment, latest, controller } = harness;
  const programmaticY = bounds.startY + 2_000;
  environment.scrollToRaw(programmaticY);
  eq(latest().virtualY, programmaticY, "unattributed programmatic scroll bypasses");
  environment.scrollToRaw(bounds.startY);
  eq(latest().virtualY, bounds.startY, "programmatic setup seeks backward exactly");

  environment.touchStart();
  environment.scrollToRaw(bounds.startY + 2_000);
  eq(
    latest().virtualY,
    bounds.startY + 2_000,
    "attributed interior sample applies exact raw distance",
  );
  controller.dispose();
}

{
  const harness = createHarness(bounds.endY - 100);
  const { environment, latest, controller } = harness;
  environment.touchStart();
  environment.scrollToRaw(bounds.endY + 200);
  eq(latest().virtualY, bounds.endY, "boundary-crossing sample clamps at seam");
  eq(latest().gp, VID_FLY_END, "boundary-crossing sample clamps at gp=VID_FLY_END");
  ok(latest().discardedForwardPx > 0, "boundary-crossing excess is discarded");
  controller.dispose();
}

// Aligned gesture ends suppress only at the locked video boundary. A before-
// video aligned end has no quarantine.
{
  const harness = createHarness(bounds.endY - 100);
  const { environment, latest, controller } = harness;
  environment.touchStart();
  environment.scrollToRaw(bounds.endY);
  environment.touchEnd();
  environment.timers.advance(120);
  environment.scrollToRaw(bounds.endY + 100);
  eq(latest().virtualY, bounds.endY, "aligned seam end suppresses forward residue");
  environment.scrollToRaw(bounds.endY - 20);
  eq(latest().virtualY, bounds.endY - 20, "reverse remains immediate at seam suppression");
  controller.dispose();
}

{
  const alignedY = bounds.startY - 100;
  const harness = createHarness(alignedY);
  const { environment, latest, controller } = harness;
  environment.touchStart();
  environment.touchEnd();
  environment.timers.advance(120);
  eq(environment.timers.size, 0, "before-video aligned finish owns no suppression timer");
  environment.scrollToRaw(alignedY + 100);
  eq(latest().virtualY, alignedY + 100, "before-video aligned end does not suppress");
  controller.dispose();
}

// A guarded self-reanchor event is accepted only at its exact target. Wait for
// touch-momentum quiet before probing the resulting suppression guard.
{
  const harness = createHarness(bounds.endY - 100);
  const { environment, latest, controller } = harness;
  environment.touchStart();
  environment.scrollToRaw(bounds.endY + 200);
  environment.touchEnd();
  eq(environment.scrollToCalls.length, 0, "live momentum defers guarded reanchor");
  environment.timers.advance(120);
  const targetY = latest().virtualY;
  const callsAfterEnd = environment.scrollToCalls.length;
  eq(callsAfterEnd, 1, "quiet boundary finish requests one guarded reanchor");

  environment.scrollToRaw(targetY + 50);
  eq(latest().virtualY, targetY, "mismatched expected event is processed");
  ok(
    environment.scrollToCalls.length > callsAfterEnd,
    "mismatched expected event is reanchored again",
  );
  ok(latest().discardedForwardPx > 0, "mismatched residual is accounted");
  controller.dispose();
}

// scrollend generated synchronously by our own reanchor never releases the
// boundary suppression before later native residue arrives.
{
  const harness = createHarness(bounds.endY - 100);
  const { environment, latest, controller } = harness;
  environment.emitScrollFromScrollTo = true;
  environment.emitScrollEndFromScrollTo = true;
  environment.touchStart();
  environment.scrollToRaw(bounds.endY + 200);
  const governedY = latest().virtualY;
  environment.touchEnd();
  environment.timers.advance(120);
  eq(
    latest().virtualY,
    governedY,
    "quiet reanchor accepts its exact expected scroll event",
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

// scrollend only starts a new suppression quiet window. It cannot release at
// an older deadline, and residual movement rearms the new window again.
{
  const harness = createHarness(bounds.endY - 100);
  const { environment, latest, controller } = harness;
  environment.touchStart();
  environment.scrollToRaw(bounds.endY);
  environment.touchEnd();
  environment.timers.advance(120);
  environment.timers.advance(119);
  environment.windowTarget.dispatch("scrollend");
  environment.timers.advance(1);
  environment.scrollToRaw(bounds.endY + 100);
  eq(
    latest().virtualY,
    bounds.endY,
    "scrollend at 119ms cannot release suppression at the old deadline",
  );
  environment.timers.advance(119);
  ok(environment.timers.size > 0, "residual sample owns a fresh quiet timer");
  environment.timers.advance(1);
  environment.scrollToRaw(bounds.endY + 100);
  eq(
    latest().virtualY,
    bounds.endY + 100,
    "suppression releases only after the fresh 120ms quiet window",
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

// Height-only resize also preserves post-lift touch momentum and its original
// quiet deadline.
{
  const harness = createHarness(100);
  const { environment, latest, controller } = harness;
  environment.touchStart();
  environment.touchEnd();
  eq(environment.timers.size, 1, "touch momentum owns one timer before toolbar resize");
  environment.innerHeight += 100;
  environment.resize();
  ok(latest().gestureActive, "height-only resize preserves touch momentum lifecycle");
  eq(environment.timers.size, 1, "height-only resize preserves momentum timer ownership");
  environment.timers.advance(119);
  ok(latest().gestureActive, "toolbar resize does not shorten momentum quiet");
  environment.timers.advance(1);
  ok(!latest().gestureActive, "momentum ends at its original post-resize deadline");
  eq(environment.timers.size, 0, "aligned momentum finish remains timer-free");
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

// A reduced-motion prop transition immediately direct-syncs and clears live
// touch momentum and wheel/key ownership without waiting for scroll or quiet.
{
  const harness = createHarness(bounds.endY - 100);
  const { environment, latest, controller, setReducedMotion } = harness;
  environment.touchStart();
  environment.scrollToRaw(bounds.endY + 200);
  ok(latest().discardedForwardPx > 0, "pre-reduced fixture has boundary discard");
  environment.touchEnd();
  environment.wheel();
  eq(
    environment.timers.size,
    2,
    "pre-reduced fixture owns touch-momentum and wheel timers",
  );

  const directY = bounds.endY + 250;
  environment.scrollY = directY;
  const scrollToCount = environment.scrollToCalls.length;
  const publicationsBeforeFlip = harness.publications.length;
  setReducedMotion(true);
  eq(latest().virtualY, directY, "reduced flip immediately syncs live momentum rawY");
  ok(!latest().gestureActive, "reduced flip immediately clears the shared gesture");
  eq(environment.timers.size, 0, "reduced flip immediately clears every modality timer");
  eq(latest().discardedForwardPx, 0, "reduced flip clears stale discard metrics");
  eq(
    harness.publications.length,
    publicationsBeforeFlip + 1,
    "reduced flip publishes one immediate direct sync",
  );
  eq(
    environment.scrollToCalls.length,
    scrollToCount,
    "reduced flip performs no backward reanchor",
  );

  setReducedMotion(false);
  environment.scrollToRaw(directY + 50);
  eq(
    latest().virtualY,
    directY + 50,
    "post-reduced unattributed movement remains exact",
  );
  ok(!latest().gestureActive, "post-reduced movement has no stale modality ownership");
  controller.dispose();
}

// Reduced-mode explicit inputs are direct and timer-free even when no matching
// scroll event follows the input notification.
{
  const failures: string[] = [];
  for (const [label, dispatch] of [
    ["wheel", (environment: FakeEnvironment) => environment.wheel()],
    ["key", (environment: FakeEnvironment) => environment.keyDown("ArrowDown")],
    ["touch", (environment: FakeEnvironment) => environment.touchStart()],
  ] as const) {
    const harness = createHarness(100, true);
    const { environment, latest, controller } = harness;
    dispatch(environment);
    const snapshot = latest();
    if (
      snapshot.gestureActive ||
      environment.timers.size !== 0 ||
      snapshot.discardedForwardPx !== 0
    ) {
      failures.push(
        `${label} gestureActive=${snapshot.gestureActive} timers=${environment.timers.size} discard=${snapshot.discardedForwardPx}`,
      );
    }
    controller.dispose();
  }
  if (failures.length > 0) {
    throw new Error(`reduced explicit input must stay idle: ${failures.join("; ")}`);
  }
}

// A reduced-motion rerender changes live semantics through the getter without
// reinstalling listeners or recaching the viewport.
{
  const harness = createHarness(bounds.endY - 100);
  const { environment, latest, controller, setReducedMotion } = harness;
  const addCount =
    environment.windowTarget.addCount + environment.documentTarget.addCount;
  environment.touchStart();
  environment.scrollToRaw(bounds.endY + 200);
  eq(latest().virtualY, bounds.endY, "normal mode enforces only the video boundary");

  setReducedMotion(true);
  const directY = bounds.endY + 400;
  environment.scrollToRaw(directY);
  eq(latest().virtualY, directY, "updated reduced-motion mode bypasses directly");
  eq(environment.timers.size, 0, "reduced-motion direct sync stays timer-free");
  eq(
    environment.windowTarget.addCount + environment.documentTarget.addCount,
    addCount,
    "reduced-motion update causes no listener churn",
  );
  controller.dispose();
}

// If reduced motion flips after a boundary sample but before touchend, the prop
// notification direct-syncs immediately and makes the later terminal event a
// no-op. Reanchoring backward would violate reduced-motion semantics.
{
  const harness = createHarness(bounds.endY - 100);
  const { environment, latest, controller, setReducedMotion } = harness;
  environment.touchStart();
  const dirtyRawY = bounds.endY + 200;
  environment.scrollToRaw(dirtyRawY);
  eq(latest().virtualY, bounds.endY, "pre-flip touch is clamped only at the seam");
  const scrollToCount = environment.scrollToCalls.length;

  setReducedMotion(true);
  const publicationsAfterFlip = harness.publications.length;
  environment.touchEnd();
  eq(
    latest().virtualY,
    dirtyRawY,
    "dirty reduced-motion prop sync synchronizes directly to raw",
  );
  ok(!latest().gestureActive, "dirty reduced-motion prop sync clears gesture state");
  eq(
    harness.publications.length,
    publicationsAfterFlip,
    "touchend after reduced sync is a no-op",
  );
  eq(
    environment.scrollToCalls.length,
    scrollToCount,
    "dirty reduced-motion prop sync performs no backward reanchor",
  );
  eq(environment.timers.size, 0, "dirty reduced-motion sync clears lifecycle timers");

  setReducedMotion(false);
  environment.scrollToRaw(bounds.endY - 100);
  eq(
    latest().virtualY,
    bounds.endY - 100,
    "post-reduced programmatic setup remains exact",
  );
  environment.touchStart();
  const recoveredRawY = bounds.endY + 200;
  environment.scrollToRaw(recoveredRawY);
  ok(latest().gestureActive, "false mode starts a fresh governed gesture");
  eq(latest().virtualY, bounds.endY, "true-to-false recovery restores boundary-only clamping");
  controller.dispose();
}

// Blur and hidden visibility reconcile and cancel both active and suppressed
// lifecycles, leaving no timer or stale quarantine behind.
for (const [label, beginBurst, interrupt] of [
  [
    "reduced",
    (environment: FakeEnvironment) => environment.wheel(100),
    (harness: ReturnType<typeof createHarness>) => harness.setReducedMotion(true),
  ],
  [
    "blur",
    (environment: FakeEnvironment) => environment.keyDown("ArrowDown"),
    (harness: ReturnType<typeof createHarness>) => {
      harness.environment.windowTarget.dispatch("blur");
    },
  ],
  [
    "hidden",
    (environment: FakeEnvironment) => environment.wheel(100),
    (harness: ReturnType<typeof createHarness>) => {
      harness.environment.visibilityState = "hidden";
      harness.environment.documentTarget.dispatch("visibilitychange");
    },
  ],
  [
    "width resize",
    (environment: FakeEnvironment) => environment.keyDown("ArrowDown"),
    (harness: ReturnType<typeof createHarness>) => {
      harness.environment.innerWidth += 1;
      harness.environment.resize();
    },
  ],
] as const) {
  const harness = createHarness(100);
  const { environment, latest, controller } = harness;
  beginBurst(environment);
  environment.timers.advance(1_000);
  ok(latest().gestureActive, `${label} fixture awaits native scroll`);
  eq(environment.timers.size, 0, `${label} fixture has no grace timer`);
  interrupt(harness);
  ok(!latest().gestureActive, `${label} clears awaited burst ownership`);
  eq(environment.timers.size, 0, `${label} leaves no lifecycle timer`);
  controller.dispose();
}

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
  const harness = createHarness(bounds.endY - 100);
  const { environment, latest, controller, setReducedMotion } = harness;
  environment.touchStart();
  const dirtyRawY = bounds.endY + 200;
  environment.scrollToRaw(dirtyRawY);
  eq(latest().virtualY, bounds.endY, `${label} reduced fixture reaches the seam`);
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
  environment.scrollToRaw(bounds.endY - 100);
  environment.touchStart();
  const recoveredRawY = bounds.endY + 200;
  environment.scrollToRaw(recoveredRawY);
  ok(latest().gestureActive, `${label} false recovery starts a fresh gesture`);
  eq(
    latest().virtualY,
    bounds.endY,
    `${label} false recovery restores boundary-only behavior`,
  );
  controller.dispose();
}

{
  const harness = createHarness(bounds.endY - 100);
  const { environment, latest, controller } = harness;
  environment.touchStart();
  environment.scrollToRaw(bounds.endY + 200);
  environment.touchEnd();
  environment.wheel();
  eq(environment.timers.size, 2, "blur fixture owns touch and wheel timers");
  environment.windowTarget.dispatch("blur");
  ok(!latest().gestureActive, "blur ends live momentum and burst ownership");
  eq(environment.timers.size, 0, "blur clears all modality and guard timers");
  const directY = latest().virtualY + 100;
  environment.scrollToRaw(directY);
  eq(latest().virtualY, directY, "post-blur programmatic scroll bypasses exactly");
  controller.dispose();
}

{
  const harness = createHarness(bounds.endY - 100);
  const { environment, latest, controller } = harness;
  environment.touchStart();
  environment.scrollToRaw(bounds.endY + 200);
  environment.touchEnd();
  environment.timers.advance(120);
  ok(environment.timers.size >= 2, "suppressed lifecycle owns timers before hidden");
  environment.visibilityState = "hidden";
  environment.documentTarget.dispatch("visibilitychange");
  ok(!latest().gestureActive, "hidden visibility leaves no active gesture");
  eq(environment.timers.size, 0, "hidden visibility clears suppression/guard timers");
  const directY = latest().virtualY + 100;
  environment.scrollToRaw(directY);
  eq(latest().virtualY, directY, "post-hidden programmatic scroll bypasses exactly");
  controller.dispose();
}

// Width/orientation resize is terminal during active touch, live momentum, or
// boundary suppression: it clears every timer and gesture state.
for (const [label, prepare] of [
  [
    "active",
    (environment: FakeEnvironment) => {
      environment.touchStart();
      environment.wheel();
    },
  ],
  [
    "momentum",
    (environment: FakeEnvironment) => {
      environment.touchStart();
      environment.touchEnd();
    },
  ],
  [
    "suppressed",
    (environment: FakeEnvironment) => {
      environment.touchStart();
      environment.scrollToRaw(bounds.endY + 200);
      environment.touchEnd();
      environment.timers.advance(120);
    },
  ],
] as const) {
  const harness = createHarness(bounds.endY - 100);
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
  const { environment, latest, publications, controller } = harness;
  environment.wheel(100);
  environment.timers.advance(1_000);
  ok(latest().gestureActive, "dispose fixture awaits native scroll");
  eq(environment.timers.size, 0, "dispose fixture has no grace timer");
  const publicationCount = publications.length;
  controller.dispose();
  eq(environment.timers.size, 0, "dispose leaves awaited ownership timer-free");
  environment.scrollToRaw(200);
  environment.timers.advance(1_000);
  eq(publications.length, publicationCount, "disposed awaited scroll publishes nothing");
}

{
  const harness = createHarness(100);
  const { environment, publications, controller, setReducedMotion } = harness;
  environment.wheel();
  environment.touchStart();
  environment.touchEnd();
  eq(environment.timers.size, 2, "active touch momentum and burst own timers before unmount");
  controller.dispose();
  eq(environment.windowTarget.listenerCount(), 0, "window listeners removed");
  eq(environment.documentTarget.listenerCount(), 0, "document listeners removed");
  eq(environment.windowTarget.unmatchedRemoveCount, 0, "window capture/options match");
  eq(environment.documentTarget.unmatchedRemoveCount, 0, "document capture/options match");
  eq(environment.timers.size, 0, "unmount clears every timer");
  const publicationCount = publications.length;
  environment.scrollY = 400;
  setReducedMotion(true);
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
  const harness = createHarness(bounds.endY - 100);
  const { environment, publications, controller } = harness;
  environment.touchStart();
  environment.scrollToRaw(bounds.endY + 200);
  environment.touchEnd();
  environment.timers.advance(120);
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
