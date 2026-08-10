// Deterministic lifecycle checks for the pinned gallery with GESTURE-FOLLOW
// navigation: the card scrubs live with the finger/wheel (stops when the user
// stops), then settles on release — forward to the adjacent card past the
// commit threshold or a flick, back to its anchor otherwise. One gesture still
// moves at most one step. Run manually with:
//   npx tsx scripts/check-scroll-lifecycle.ts
import {
  GALLERY_COMMIT_FRAC,
  GALLERY_DRAG_DEAD_ZONE_PX,
  GALLERY_SETTLE_MS,
  GALLERY_STEP_SPAN_FRAC,
  GALLERY_STEP_SPAN_MIN_PX,
  GALLERY_TRANSITION_MS,
  INPUT_QUIET_MS,
  TOUCH_STEP_PX,
  WHEEL_COMMIT_PX,
  WHEEL_ENTRY_GRACE_MS,
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
const targets = galleryStepTargets();
const SPAN = Math.max(IH * GALLERY_STEP_SPAN_FRAC, GALLERY_STEP_SPAN_MIN_PX);
const stepGpAt = (index: number, travelPx: number) =>
  targets[index] +
  (targets[index + 1] - targets[index]) * Math.min(travelPx / SPAN, 1);
const SETTLE_DRAIN_MS = GALLERY_SETTLE_MS + INPUT_QUIET_MS + 64;

// Native input remains untouched before the seam.
{
  const harness = createHarness(seamY - 500);
  const { environment, latest, controller } = harness;
  ok(!environment.wheel(100), "interior wheel remains native");
  eq(latest().scrollY, seamY - 400, "native publication follows physical scroll");
  eq(latest().galleryMode, "native-before", "interior remains native-before");
  controller.dispose();
}

// The crossing momentum peak is ABSORBED at the seam for a short grace; after
// it, wheel input SCRUBS the card in proportion to its travel.
{
  const harness = createHarness(seamY - 40);
  const { environment, latest, controller } = harness;
  ok(environment.wheel(240), "crossing wheel is cancelled before native overshoot");
  eq(environment.scrollY, seamY, "physical scroll lands at seam");
  eq(latest().gp, VID_FLY_END, "entry lands at first photo-ready state");
  eq(latest().galleryStep, 0, "entry does not advance a photo");
  ok(environment.wheel(500), "entry momentum remains cancelled");
  eq(latest().galleryStep, 0, "in-grace momentum cannot advance a photo");
  eq(latest().gp, VID_FLY_END, "in-grace momentum does not scrub the card", 1e-9);

  environment.clock.advance(WHEEL_ENTRY_GRACE_MS);
  ok(environment.wheel(80), "fresh gallery wheel is owned");
  eq(latest().gp, stepGpAt(0, 80), "wheel scrub follows burst travel", 1e-9);
  eq(latest().galleryStep, 0, "scrubbing does not commit mid-burst");
  ok(environment.wheel(900), "same burst residue remains owned");
  eq(latest().gp, targets[1], "a full span lands on the adjacent card", 1e-9);
  eq(latest().galleryStep, 1, "a full accumulated span commits immediately");
  ok(environment.wheel(300), "post-commit tail remains owned");
  eq(latest().galleryStep, 1, "the commit cooldown paces same-instant input");

  environment.clock.advance(INPUT_QUIET_MS + SETTLE_DRAIN_MS);
  eq(latest().galleryStep, 1, "a below-cooldown tail eases back at quiet");
  eq(latest().gp, targets[1], "committed scrub rests on the adjacent target", 1e-9);
  eq(latest().galleryMode, "gallery-idle", "settled scrub becomes idle");

  // Input during the settle transition is consumed, never queued.
  ok(environment.wheel(100), "next settled burst is owned");
  environment.clock.advance(INPUT_QUIET_MS);
  eq(latest().galleryStep, 2, "past-commit travel advances at quiet");
  ok(environment.wheel(80), "input during the settle is still consumed");
  environment.clock.advance(SETTLE_DRAIN_MS + GALLERY_TRANSITION_MS);
  eq(latest().galleryStep, 2, "transition input is not queued");
  eq(latest().gp, targets[2], "settle finishes on its own target", 1e-9);
  eq(latest().galleryMode, "gallery-idle", "quiet settled transition becomes idle");

  // A tiny nudge below both commit thresholds eases back to its anchor.
  ok(environment.wheel(WHEEL_COMMIT_PX / 2), "tiny nudge is owned");
  ok(latest().gp > targets[2], "tiny nudge still moves the card while active");
  environment.clock.advance(INPUT_QUIET_MS + SETTLE_DRAIN_MS);
  eq(latest().galleryStep, 2, "a sub-threshold nudge does not commit");
  eq(latest().gp, targets[2], "a sub-threshold nudge eases back", 1e-9);

  // Continuous deliberate scrolling flows card after card with NO quiet gaps
  // (the trackpad complaint: gestures must never be eaten as "residue"),
  // paced only by the commit cooldown.
  const beforeSteady = latest().galleryStep;
  for (let i = 0; i < 12; i += 1) {
    ok(environment.wheel(150), "steady scrolling stays owned");
    environment.clock.advance(60);
  }
  const afterSteady = latest().galleryStep;
  ok(
    afterSteady - beforeSteady >= 3,
    `steady scrolling flows through multiple cards (got ${afterSteady - beforeSteady})`,
  );
  ok(
    afterSteady < targets.length - 1,
    "steady scrolling stays inside the gallery",
  );
  environment.clock.advance(INPUT_QUIET_MS + SETTLE_DRAIN_MS);
  eq(latest().gp, targets[afterSteady], "steady leftover settles on a target", 1e-9);
  eq(latest().galleryMode, "gallery-idle", "steady chain settles idle");
  controller.dispose();
}

// A scroll-driven entry (scrollbar drag / momentum crossing) settles to idle
// on its own, so keyboard steps work without any wheel/touch gesture first.
{
  const harness = createHarness(seamY - 200);
  const { environment, latest, controller } = harness;
  environment.scrollY = seamY + 50;
  environment.windowTarget.dispatch("scroll", {});
  eq(latest().galleryMode, "gallery-transitioning", "scroll entry consumes the gesture");
  eq(environment.scrollY, seamY, "scroll entry pins at the seam");
  environment.clock.advance(INPUT_QUIET_MS + 1);
  eq(latest().galleryMode, "gallery-idle", "scroll-driven entry settles to idle on its own");
  environment.keyDown("ArrowDown");
  environment.clock.advance(GALLERY_TRANSITION_MS + 1);
  eq(latest().galleryStep, 1, "keyboard advances after a scroll-driven entry");
  controller.dispose();
}

// A touch that enters is consumed; a fresh swipe DRAGS the card with the
// finger, holds where the finger holds, and settles only on release.
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

  // Follow: 150px drag → the card sits at (150 − dead zone)/span of the step.
  environment.touchStart(600);
  ok(environment.touchMove(450), "fresh gallery swipe is owned");
  eq(
    latest().gp,
    stepGpAt(0, 150 - GALLERY_DRAG_DEAD_ZONE_PX),
    "card follows the finger",
    1e-9,
  );
  eq(latest().galleryStep, 0, "following does not commit");

  // Stop: no movement → the card rests exactly where the finger rests.
  environment.clock.advance(250);
  eq(
    latest().gp,
    stepGpAt(0, 150 - GALLERY_DRAG_DEAD_ZONE_PX),
    "card rests where the finger stopped",
    1e-9,
  );

  // Pull back: the same gesture retreats toward its anchor (never the
  // opposite card), and a release short of the commit fraction reverts.
  ok(environment.touchMove(520), "pull-back stays owned");
  eq(
    latest().gp,
    stepGpAt(0, 80 - GALLERY_DRAG_DEAD_ZONE_PX),
    "pull-back follows the finger down",
    1e-9,
  );
  ok(
    (80 - GALLERY_DRAG_DEAD_ZONE_PX) / SPAN < GALLERY_COMMIT_FRAC,
    "pull-back travel sits below the commit fraction",
  );
  environment.touchEnd(520);
  environment.clock.advance(SETTLE_DRAIN_MS);
  eq(latest().galleryStep, 0, "sub-commit release does not advance");
  eq(latest().gp, targets[0], "sub-commit release eases back to the anchor", 1e-9);

  // Slow but far: a gentle drag past the commit fraction advances one card
  // after release, easing the remainder instead of jumping.
  environment.touchStart(600);
  ok(environment.touchMove(400), "gentle far drag is owned");
  ok(
    (200 - GALLERY_DRAG_DEAD_ZONE_PX) / SPAN > GALLERY_COMMIT_FRAC,
    "far drag travel clears the commit fraction",
  );
  eq(latest().galleryStep, 0, "no commit while the finger is down");
  environment.touchEnd(400);
  eq(latest().galleryStep, 1, "release past commit advances exactly one card");
  ok(latest().gp < targets[1] - 1e-9, "the remainder eases instead of jumping");
  environment.clock.advance(SETTLE_DRAIN_MS);
  eq(latest().gp, targets[1], "settle finishes on the adjacent card", 1e-9);

  // Flick: a short fast swipe commits on velocity.
  environment.touchStart(600);
  environment.touchMove(570);
  environment.clock.advance(16);
  environment.touchMove(540);
  environment.touchEnd(540);
  eq(latest().galleryStep, 2, "a short fast flick commits on velocity");
  environment.clock.advance(SETTLE_DRAIN_MS);
  eq(latest().gp, targets[2], "flick settles on the adjacent card", 1e-9);

  // One gesture can never skip a card: a huge drag clamps at the neighbour.
  environment.touchStart(700);
  ok(environment.touchMove(0), "huge swipe stays owned");
  eq(latest().gp, targets[3], "huge swipe clamps at the adjacent card", 1e-9);
  environment.touchEnd(0);
  environment.clock.advance(SETTLE_DRAIN_MS);
  eq(latest().galleryStep, 3, "huge swipe still advances exactly one card");
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

  // An at-the-end wiggle (forward then back past the anchor) must NOT release:
  // the direction is latched by the first dead-zone crossing.
  const wiggle = createHarness(seamY);
  wiggle.environment.clock.advance(INPUT_QUIET_MS);
  wiggle.environment.touchStart(500);
  wiggle.environment.touchMove(400);
  ok(
    wiggle.latest().galleryMode !== "native-before",
    "forward drag keeps the gallery pinned",
  );
  wiggle.environment.touchMove(500 + TOUCH_STEP_PX + 10);
  ok(
    wiggle.latest().galleryMode !== "native-before",
    "reversing within one gesture cannot release the pin",
  );
  wiggle.environment.touchEnd(500 + TOUCH_STEP_PX + 10);
  wiggle.environment.clock.advance(SETTLE_DRAIN_MS);
  eq(wiggle.latest().galleryStep, 0, "wiggle gesture commits nothing");
  eq(wiggle.latest().gp, targets[0], "wiggle gesture returns to its anchor", 1e-9);
  wiggle.controller.dispose();
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

console.log("✓ scroll lifecycle (gesture-follow gallery)");
