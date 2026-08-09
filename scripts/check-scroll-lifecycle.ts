// Deterministic lifecycle checks for the pinned, one-step-per-gesture gallery.
// Run manually with: npx tsx scripts/check-scroll-lifecycle.ts
import {
  GALLERY_TRANSITION_MS,
  INPUT_QUIET_MS,
  TOUCH_STEP_PX,
  createScrollTimelineController,
} from "../src/scrollTimelineController";
import type {
  ScrollTimelineControllerEnvironment,
  ScrollTimelineEventListener,
  ScrollTimelineListenerOptions,
  ScrollTimelinePublication,
} from "../src/scrollTimelineController";
import {
  scrollYForTimelineProgress,
  videoGovernorBounds,
} from "../src/scrollGovernor";
import { galleryStepTargets } from "../src/galleryGestureStepper";
import { VID_FLY_END } from "../src/constants";

function ok(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(label);
}

function eq(actual: number | string, expected: number | string, label: string, eps = 1e-6) {
  if (
    typeof actual === "number" &&
    typeof expected === "number" &&
    Math.abs(actual - expected) <= eps
  ) {
    return;
  }
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

interface ListenerRecord {
  type: string;
  listener: ScrollTimelineEventListener;
  capture: boolean;
  passive: boolean;
}

function captureFor(options?: ScrollTimelineListenerOptions): boolean {
  return typeof options === "boolean" ? options : Boolean(options?.capture);
}

class FakeEventTarget {
  private listeners: ListenerRecord[] = [];

  addEventListener(
    type: string,
    listener: ScrollTimelineEventListener,
    options?: ScrollTimelineListenerOptions,
  ) {
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
    const capture = captureFor(options);
    const index = this.listeners.findIndex(
      (entry) =>
        entry.type === type &&
        entry.listener === listener &&
        entry.capture === capture,
    );
    if (index >= 0) this.listeners.splice(index, 1);
  }

  dispatch(type: string, event: Record<string, unknown>) {
    for (const entry of [...this.listeners]) {
      if (entry.type === type) entry.listener(event);
    }
  }

  listenerCount(): number {
    return this.listeners.length;
  }

  passiveCount(type: string): number {
    return this.listeners.filter(
      (entry) => entry.type === type && entry.passive,
    ).length;
  }
}

interface ScheduledTask {
  id: number;
  at: number;
  callback: (now: number) => void;
}

class FakeClock {
  now = 0;
  private nextId = 1;
  private tasks = new Map<number, ScheduledTask>();

  setTimeout = (callback: () => void, delayMs: number): number =>
    this.schedule((_) => callback(), delayMs);

  clearTimeout = (id: number) => {
    this.tasks.delete(id);
  };

  requestFrame = (callback: (now: number) => void): number =>
    this.schedule(callback, 16);

  cancelFrame = (id: number) => {
    this.tasks.delete(id);
  };

  private schedule(callback: (now: number) => void, delayMs: number): number {
    const id = this.nextId++;
    this.tasks.set(id, {
      id,
      at: this.now + Math.max(Number.isFinite(delayMs) ? delayMs : 0, 0),
      callback,
    });
    return id;
  }

  advance(ms: number) {
    const target = this.now + ms;
    for (;;) {
      const next = [...this.tasks.values()]
        .filter((task) => task.at <= target)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!next) break;
      this.tasks.delete(next.id);
      this.now = next.at;
      next.callback(this.now);
    }
    this.now = target;
  }

  get size(): number {
    return this.tasks.size;
  }
}

class FakeEnvironment implements ScrollTimelineControllerEnvironment {
  readonly windowTarget = new FakeEventTarget();
  readonly documentTarget = new FakeEventTarget();
  readonly clock = new FakeClock();
  scrollY = 0;
  innerHeight = 844;
  innerWidth = 390;
  visibilityState = "visible";
  scrollToCalls: number[] = [];

  readScrollY = () => this.scrollY;
  readInnerHeight = () => this.innerHeight;
  readInnerWidth = () => this.innerWidth;
  readVisibilityState = () => this.visibilityState;
  readNow = () => this.clock.now;
  setTimeout = this.clock.setTimeout;
  clearTimeout = this.clock.clearTimeout;
  requestFrame = this.clock.requestFrame;
  cancelFrame = this.clock.cancelFrame;

  scrollTo = ({ top }: { top: number; behavior: "auto" }) => {
    this.scrollToCalls.push(top);
    this.scrollY = top;
  };

  private event(extra: Record<string, unknown> = {}) {
    let prevented = false;
    return {
      event: {
        defaultPrevented: false,
        preventDefault() {
          prevented = true;
          this.defaultPrevented = true;
        },
        ...extra,
      },
      wasPrevented: () => prevented,
    };
  }

  wheel(deltaY: number, extra: Record<string, unknown> = {}) {
    const dispatched = this.event({ deltaY, deltaMode: 0, ...extra });
    this.windowTarget.dispatch("wheel", dispatched.event);
    if (!dispatched.wasPrevented()) {
      this.scrollY = Math.max(this.scrollY + deltaY, 0);
      this.windowTarget.dispatch("scroll", {});
    }
    return dispatched.wasPrevented();
  }

  touchStart(clientY: number) {
    const dispatched = this.event({
      touches: [{ clientY }],
      changedTouches: [{ clientY }],
    });
    this.windowTarget.dispatch("touchstart", dispatched.event);
    return dispatched.wasPrevented();
  }

  touchMove(clientY: number) {
    const dispatched = this.event({ touches: [{ clientY }] });
    const before = this.scrollY;
    this.windowTarget.dispatch("touchmove", dispatched.event);
    if (!dispatched.wasPrevented()) {
      const previous = this.lastNativeTouchY ?? clientY;
      this.scrollY = Math.max(this.scrollY + previous - clientY, 0);
      if (this.scrollY !== before) this.windowTarget.dispatch("scroll", {});
    }
    this.lastNativeTouchY = clientY;
    return dispatched.wasPrevented();
  }

  private lastNativeTouchY: number | null = null;

  touchEnd(clientY: number) {
    const dispatched = this.event({ touches: [], changedTouches: [{ clientY }] });
    this.windowTarget.dispatch("touchend", dispatched.event);
    this.lastNativeTouchY = null;
    return dispatched.wasPrevented();
  }

  keyDown(key: string, extra: Record<string, unknown> = {}) {
    const dispatched = this.event({
      key,
      repeat: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      target: null,
      ...extra,
    });
    this.windowTarget.dispatch("keydown", dispatched.event);
    return dispatched.wasPrevented();
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
    const value = publications.at(-1);
    ok(value, "controller published state");
    return value;
  };
  return {
    environment,
    controller,
    publications,
    latest,
    setReducedMotion(value: boolean) {
      reducedMotion = value;
      controller.syncReducedMotion();
    },
  };
}

const IH = 844;
const seamY = videoGovernorBounds(IH).endY;
const galleryEndY = scrollYForTimelineProgress({ sp: 1, gp: 1 }, IH);

// Native input remains untouched before the seam.
{
  const harness = createHarness(seamY - 500);
  const { environment, latest, controller } = harness;
  ok(!environment.wheel(100), "interior wheel remains native");
  eq(latest().scrollY, seamY - 400, "native publication follows physical scroll");
  eq(latest().galleryMode, "native-before", "interior remains native-before");
  controller.dispose();
}

// The crossing burst is burned at the seam; a fresh burst advances one card.
{
  const harness = createHarness(seamY - 40);
  const { environment, latest, controller } = harness;
  ok(environment.wheel(240), "crossing wheel is cancelled before native overshoot");
  eq(environment.scrollY, seamY, "physical scroll lands at seam");
  eq(latest().gp, VID_FLY_END, "entry lands at first photo-ready state");
  eq(latest().galleryStep, 0, "entry does not advance a photo");
  ok(environment.wheel(500), "entry momentum remains cancelled");
  eq(latest().galleryStep, 0, "entry momentum cannot advance a photo");

  environment.clock.advance(INPUT_QUIET_MS);
  ok(environment.wheel(80), "fresh gallery wheel is owned");
  eq(latest().galleryStep, 1, "fresh burst advances exactly one card");
  ok(environment.wheel(900), "same burst residue remains owned");
  eq(latest().galleryStep, 1, "same burst cannot advance twice");

  environment.clock.advance(INPUT_QUIET_MS);
  ok(environment.wheel(80), "input during transition is still consumed");
  eq(latest().galleryStep, 1, "transition input is not queued");
  environment.clock.advance(INPUT_QUIET_MS + GALLERY_TRANSITION_MS);
  eq(latest().galleryMode, "gallery-idle", "quiet settled transition becomes idle");

  ok(environment.wheel(80), "next settled burst is owned");
  eq(latest().galleryStep, 2, "next burst advances one adjacent card");
  controller.dispose();
}

// A touch that enters is consumed; the next swipe advances once despite distance.
{
  const harness = createHarness(seamY - 10);
  const { environment, latest, controller } = harness;
  environment.touchStart(500);
  ok(environment.touchMove(450), "seam-crossing touchmove is cancelled");
  eq(latest().galleryStep, 0, "entry touch cannot advance a photo");
  ok(environment.touchMove(100), "rest of entry swipe remains cancelled");
  eq(latest().galleryStep, 0, "long entry swipe remains burned");
  environment.touchEnd(100);
  environment.clock.advance(INPUT_QUIET_MS);

  environment.touchStart(500);
  ok(environment.touchMove(500 - TOUCH_STEP_PX - 1), "fresh gallery swipe is owned");
  eq(latest().galleryStep, 1, "threshold swipe advances one card");
  ok(environment.touchMove(0), "large remainder stays owned");
  eq(latest().galleryStep, 1, "one swipe cannot skip cards");
  environment.touchEnd(0);
  controller.dispose();
}

// Boundary releases consume their gesture and never replay its distance.
{
  const before = createHarness(seamY);
  before.environment.clock.advance(INPUT_QUIET_MS);
  ok(before.environment.wheel(-80), "reverse at first photo is owned");
  eq(before.latest().galleryMode, "native-before", "reverse releases before gallery");
  eq(before.environment.scrollY, seamY - 1, "reverse release moves one boundary pixel");
  before.controller.dispose();

  const after = createHarness(seamY);
  const targets = galleryStepTargets();
  after.environment.clock.advance(INPUT_QUIET_MS);
  for (let index = 1; index < targets.length; index += 1) {
    after.environment.keyDown("ArrowDown");
    after.environment.clock.advance(GALLERY_TRANSITION_MS + 1);
  }
  eq(after.latest().galleryStep, targets.length - 1, "last card gesture reaches CTA");
  ok(after.environment.keyDown("ArrowDown"), "CTA release key is consumed");
  eq(after.latest().galleryMode, "native-after", "CTA release restores native-after");
  eq(after.environment.scrollY, galleryEndY, "CTA release moves to physical gallery end");
  after.controller.dispose();
}

// Editable/repeated keys are ignored and cancellable listeners are intentional.
{
  const harness = createHarness(seamY);
  const { environment, latest, controller } = harness;
  environment.clock.advance(INPUT_QUIET_MS);
  ok(!environment.keyDown("ArrowDown", { repeat: true }), "key repeat is not captured");
  ok(!environment.keyDown("ArrowDown", { target: { closest: () => ({}) } }), "editable key is not captured");
  eq(latest().galleryStep, 0, "ignored keys do not advance");
  eq(environment.windowTarget.passiveCount("wheel"), 0, "wheel listener is cancellable");
  eq(environment.windowTarget.passiveCount("touchmove"), 0, "touchmove listener is cancellable");
  controller.dispose();
  eq(environment.windowTarget.listenerCount(), 0, "dispose removes window listeners");
  eq(environment.documentTarget.listenerCount(), 0, "dispose removes document listeners");
  eq(environment.clock.size, 0, "dispose clears timers and frames");
}
