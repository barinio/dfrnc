// Deterministic lifecycle checks for the pinned gallery with GESTURE-FOLLOW
// navigation: the card scrubs live with the finger/wheel (stops when the user
// stops). TOUCH settles on finger lift — forward to the adjacent card past
// the commit threshold or a flick, back to its anchor otherwise. WHEEL
// FREEZES at quiet exactly where the scroll ended (the radiance.family
// etalon): settling wheel input moved the card AFTER the user stopped, which
// read as back-jumps and fly-aways on a macOS trackpad. Run manually with:
//   npx tsx scripts/check-scroll-lifecycle.ts
import {
  BANK_REVERSAL_DEAD_ZONE_PX,
  TOUCH_BANK_REVERSAL_DEAD_ZONE_PX,
  TOUCH_FLING_MAX_IDLE_MS,
  TOUCH_FLING_TAU_MS,
  TOUCH_FLING_VELOCITY_PX_MS,
  GALLERY_COMMIT_FRAC,
  GALLERY_DRAG_DEAD_ZONE_PX,
  GALLERY_SETTLE_MS,
  GALLERY_STEP_SPAN_FRAC,
  GALLERY_STEP_SPAN_MIN_PX,
  GALLERY_TRANSITION_MS,
  INPUT_QUIET_MS,
  TOUCH_STEP_PX,
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
  SCROLL_BANK_MAX_CLIP_S,
  scrollYForTimelineProgress,
  scrollYForVideoTime,
  videoGovernorBounds,
  videoTimeForY,
} from "../src/scrollGovernor";
import { CAPTION_RATE, clipRateFactorAt } from "../src/playback";
import { NATIVE_SCRUB_FPS, scrubTargetFrameFor } from "../src/frameScrub";
import { FRAME_COUNT } from "../src/frames";
import { galleryStepTargets } from "../src/galleryGestureStepper";
import { SCROLL_TRACK_VH, VID_FLY_END } from "../src/constants";

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
const zoneStartY = videoGovernorBounds(IH).startY;
const seamY = videoGovernorBounds(IH).endY;
const galleryEndY = scrollYForTimelineProgress({ sp: 1, gp: 1 }, IH);
const targets = galleryStepTargets();
const SPAN = Math.max(IH * GALLERY_STEP_SPAN_FRAC, GALLERY_STEP_SPAN_MIN_PX);
const stepGpAt = (index: number, travelPx: number) =>
  targets[index] +
  (targets[index + 1] - targets[index]) * Math.min(travelPx / SPAN, 1);
const SETTLE_DRAIN_MS = GALLERY_SETTLE_MS + INPUT_QUIET_MS + 64;
// FakeClock.requestFrame schedules at +16 ms, so one advance(TICK_MS) is
// exactly one rAF tick of the video-zone soft pin.
const TICK_MS = 16;
const frameAt = (y: number) => scrubTargetFrameFor(videoTimeForY(y, IH), FRAME_COUNT);

type Harness = ReturnType<typeof createHarness>;

// Ride the capped video zone with sustained input until the pinned gallery
// takes over. Sustained is the point: the cap DROPS the excess of a single
// event, so one huge flick buys one tick of travel and nothing more.
function rideCapToSeam(harness: Harness, pxPerEvent = 200, maxTicks = 2000): number {
  const { environment, latest } = harness;
  for (let tick = 0; tick < maxTicks; tick += 1) {
    if (latest().galleryMode !== "native-before") return tick;
    environment.wheel(pxPerEvent);
    environment.clock.advance(TICK_MS);
  }
  throw new Error("the capped video zone never reached the seam");
}

// ── The video zone is a SOFT PIN ────────────────────────────────────────────
// Input inside [zoneStartY, seamY) is owned by the controller: cancelled,
// queued, integrated at the clip's own rate and written back to the document.
{
  const harness = createHarness(zoneStartY + 1200);
  const { environment, latest, controller } = harness;
  ok(latest().capActive, "a first paint inside the video zone adopts the soft pin");
  eq(latest().virtualY, zoneStartY + 1200, "the soft pin seats where it found the page");
  eq(latest().scrollY, zoneStartY + 1200, "progress is published from the virtual position");

  // A single violent flick is CAPPED — its excess is BANKED, never spent at
  // once: four ticks buy four ticks of clip, not 4000 px of it.
  const startFrame = frameAt(latest().virtualY);
  ok(environment.wheel(4000), "a flick inside the video zone is cancelled");
  environment.clock.advance(TICK_MS * 4);
  const flickFrames = frameAt(latest().virtualY) - startFrame;
  ok(flickFrames > 0, "the flick still moves the page forward");
  ok(
    flickFrames <= 1,
    `a banked flick still advances at most one frame in four ticks (got ${flickFrames.toFixed(3)})`,
  );

  // Sustained maximum input for a full second: still the clip's own rate —
  // times the caption factor, and zoneStartY + 1200 px happens to land inside
  // caption 1's readable window, where the clip runs at CAPTION_RATE.
  const before = frameAt(latest().virtualY);
  const seatFactor = clipRateFactorAt(videoTimeForY(latest().virtualY, IH));
  eq(seatFactor, CAPTION_RATE, "this probe sits inside a caption window");
  for (let tick = 0; tick < 60; tick += 1) {
    environment.wheel(4000);
    environment.clock.advance(TICK_MS);
  }
  const advanced = frameAt(latest().virtualY) - before;
  const seatFps = NATIVE_SCRUB_FPS * seatFactor;
  ok(
    advanced <= seatFps + 1,
    `one second of 4000 px wheel events advanced ${advanced.toFixed(2)} frames ` +
      `(cap ${seatFps})`,
  );
  ok(advanced > seatFps - 1, "sustained input still runs at the clip's pace");

  // The document FOLLOWS the virtual position (physical write-back).
  ok(environment.scrollToCalls.length > 0, "the soft pin writes back to the document");
  ok(
    Math.abs(environment.scrollY - latest().virtualY) < 1,
    "the document tracks virtualY inside the zone",
  );
  eq(latest().scrollY, latest().virtualY, "published scrollY is the virtual position", 1e-9);

  // One reverse event lowers sp within two ticks: a reversal DISCARDS the
  // forward backlog instead of queueing behind it.
  const spBefore = latest().sp;
  ok(environment.wheel(-300), "a reverse wheel inside the zone is owned");
  environment.clock.advance(TICK_MS * 2);
  ok(latest().sp < spBefore, "one reverse event lowers sp within two ticks");

  // Keyboard is owned too, and Home/End projections stay finite.
  const spBeforeKey = latest().sp;
  ok(environment.keyDown("PageDown"), "a pinned-zone key is consumed");
  environment.clock.advance(TICK_MS * 2);
  ok(latest().sp > spBeforeKey, "a key step advances the capped page");
  ok(environment.keyDown("End"), "End is consumed inside the zone");
  environment.clock.advance(TICK_MS);
  ok(Number.isFinite(latest().virtualY), "an End projection stays finite");
  ok(latest().virtualY < seamY, "End cannot teleport past the clip");
  controller.dispose();
  eq(environment.clock.size, 0, "dispose stops the soft-pin ticker");
}

// ── The video zone BANKS what the cap cannot spend ──────────────────────────
// The cap used to drop the excess of every tick, so a 100 px notch bought the
// ~1.5 px a scenic stretch allows and the rest evaporated: crossing the 23.5 s
// zone took ~150 notches of continuous cranking. The remainder is now banked
// and paid out at the very same cap after the input stops — bounded by
// SCROLL_BANK_MAX_CLIP_S seconds of clip, so one flick can never buy the whole
// zone and never plays it faster than 1×.

// Tick a harness with ZERO further input until the page comes to rest, watching
// that no single tick ever outruns the clip.
function coastToRest(harness: Harness, maxTicks = 900) {
  const { environment, latest } = harness;
  const fromY = latest().virtualY;
  const fromFrame = frameAt(fromY);
  let ticks = 0;
  let worstTickFrames = 0;
  for (; ticks < maxTicks; ticks += 1) {
    const before = latest().virtualY;
    environment.clock.advance(TICK_MS);
    const after = latest().virtualY;
    worstTickFrames = Math.max(
      worstTickFrames,
      Math.abs(frameAt(after) - frameAt(before)),
    );
    if (after === before) break;
  }
  return {
    ticks,
    movedPx: latest().virtualY - fromY,
    movedFrames: frameAt(latest().virtualY) - fromFrame,
    worstTickFrames,
  };
}

// Reported for the record: what a flick actually buys, in the numbers the
// client feels (px of page, frames of clip, seconds of coasting).
const bankReport: string[] = [];
const MAX_TICK_FRAMES = (NATIVE_SCRUB_FPS * TICK_MS) / 1000;
const BANK_FRAMES = SCROLL_BANK_MAX_CLIP_S * NATIVE_SCRUB_FPS;
const SCENIC_Y = scrollYForVideoTime(0.4, IH);

// (A) A BURST is banked: input stops, the page keeps running at the clip's own
// pace until the bank is spent, and the bank is worth 4 s of playback.
{
  const harness = createHarness(SCENIC_Y);
  const { environment, latest, controller } = harness;
  ok(latest().capActive, "the burst starts inside the soft pin");
  eq(latest().bankPx, 0, "a fresh seat owes nothing");

  // Ten 100 px notches inside 100 ms — one ordinary trackpad flick.
  for (let i = 0; i < 10; i += 1) {
    ok(environment.wheel(100), "each burst event is owned");
    environment.clock.advance(10);
  }
  ok(latest().bankPx > 0, "the unspent burst is banked, not dropped");

  const coast = coastToRest(harness);
  ok(
    coast.ticks * TICK_MS >= 2000,
    `the page kept moving ${(coast.ticks * TICK_MS) / 1000} s after the input stopped`,
  );
  ok(
    Math.abs(coast.movedFrames - BANK_FRAMES) <= 1.5,
    `a 1000 px burst bought ${coast.movedFrames.toFixed(2)} frames (want ${BANK_FRAMES})`,
  );
  ok(
    coast.worstTickFrames <= MAX_TICK_FRAMES + 1e-9,
    `a banked tick advanced ${coast.worstTickFrames.toFixed(4)} frames (cap ${MAX_TICK_FRAMES})`,
  );
  bankReport.push(
    `  (A) 10x100 px burst at t=0.40: coasted ${coast.movedPx.toFixed(1)} px / ` +
      `${coast.movedFrames.toFixed(2)} frames over ${coast.ticks} ticks ` +
      `(${((coast.ticks * TICK_MS) / 1000).toFixed(2)} s), worst tick ` +
      `${coast.worstTickFrames.toFixed(4)} frames (cap ${MAX_TICK_FRAMES})`,
  );
  // …and then it STOPS. No residue, no creep.
  eq(latest().bankPx, 0, "a spent bank is empty");
  const restY = latest().virtualY;
  environment.clock.advance(TICK_MS * 60);
  eq(latest().virtualY, restY, "a spent bank leaves the page still");
  controller.dispose();
}

// (E) The bank NEVER buys speed: a single 1e6 px flick still moves at the cap,
// still for 4 s, and never a frame more per tick than 12.5 f/s allows.
{
  const harness = createHarness(SCENIC_Y);
  const { environment, latest, controller } = harness;
  ok(environment.wheel(1_000_000), "an absurd flick is owned");
  environment.clock.advance(TICK_MS);
  const coast = coastToRest(harness);
  ok(
    coast.worstTickFrames <= MAX_TICK_FRAMES + 1e-9,
    `an absurd bank advanced ${coast.worstTickFrames.toFixed(4)} frames in one tick`,
  );
  ok(
    Math.abs(coast.movedFrames + MAX_TICK_FRAMES - BANK_FRAMES) <= 1.5,
    `an absurd flick still bought only ${coast.movedFrames.toFixed(2)} frames`,
  );
  bankReport.push(
    `  (E) 1e6 px flick at t=0.40: ${coast.movedFrames.toFixed(2)} frames over ` +
      `${coast.ticks} ticks, worst tick ${coast.worstTickFrames.toFixed(4)} frames`,
  );
  eq(latest().bankPx, 0, "even an absurd bank empties");
  controller.dispose();
}

// (B) A REVERSAL is felt on the very next tick and DISCARDS the forward
// backlog: the page must never owe the user a direction they abandoned.
{
  const harness = createHarness(SCENIC_Y);
  const { environment, latest, controller } = harness;
  ok(environment.wheel(1000), "the forward flick is owned");
  environment.clock.advance(TICK_MS * 3);
  ok(latest().bankPx > 100, "a forward bank is pending");
  const yBefore = latest().virtualY;
  ok(environment.wheel(-50), "the reverse event is owned");
  environment.clock.advance(TICK_MS);
  ok(latest().virtualY < yBefore, "the reversal moves the page back on the next tick");
  ok(latest().bankPx < 0, "the bank now owes the reverse direction");
  ok(latest().bankPx > -50, "the reverse bank is only the reverse event itself");
  const coast = coastToRest(harness);
  ok(coast.movedPx < 0, "the discarded forward backlog never comes back");
  ok(
    Math.abs(yBefore - latest().virtualY - 50) <= 1.5,
    `the reversal spent ${(yBefore - latest().virtualY).toFixed(2)} px, not the forward 1000`,
  );
  bankReport.push(
    `  (B) -50 px against a 1000 px bank: back on tick 1, total rewind ` +
      `${(yBefore - latest().virtualY).toFixed(2)} px over ${coast.ticks + 1} ticks`,
  );
  controller.dispose();
}

// (C) JITTER is not a reversal. A finger lifting off the glass wobbles a few
// pixels backwards; that must not throw away the swipe the user just made.
{
  const harness = createHarness(SCENIC_Y);
  const { environment, latest, controller } = harness;
  ok(environment.wheel(1000), "the forward flick is owned");
  environment.clock.advance(TICK_MS * 3);
  const bankBefore = latest().bankPx;
  const yBefore = latest().virtualY;
  ok(environment.wheel(-3), "the jitter event is still owned");
  environment.clock.advance(TICK_MS);
  ok(latest().virtualY > yBefore, "a sub-dead-zone reverse keeps the page going forward");
  ok(latest().bankPx > 0, "the forward bank survives finger jitter");
  eq(
    latest().bankPx,
    bankBefore - (latest().virtualY - yBefore),
    "the jitter is IGNORED, not banked against the swipe",
    1e-9,
  );
  // Exactly at the dead zone it IS a reversal.
  const yJitter = latest().virtualY;
  ok(environment.wheel(-BANK_REVERSAL_DEAD_ZONE_PX), "a dead-zone-sized reverse is owned");
  environment.clock.advance(TICK_MS);
  ok(latest().virtualY < yJitter, "8 px is a real reversal");
  ok(latest().bankPx < 0, "a real reversal takes the bank with it");
  bankReport.push(
    `  (C) -3 px jitter against a ${bankBefore.toFixed(1)} px bank: still forward, ` +
      `bank ${latest().bankPx.toFixed(1)} px only after the -8 px reversal`,
  );
  controller.dispose();
}

// (D) EDGES: a full bank never fences the zone in. Forward it still hands over
// to the pinned gallery at the seam; backward it still hands back to native
// scrolling — and the leftover bank is discarded on the way out, so nothing
// coasts into a track the soft pin does not own.
{
  const harness = createHarness(seamY - 120);
  const { environment, latest, controller } = harness;
  ok(environment.wheel(100000), "a huge flick near the seam is owned");
  for (let tick = 0; tick < 400 && latest().galleryMode === "native-before"; tick += 1) {
    environment.clock.advance(TICK_MS);
  }
  eq(latest().galleryMode, "gallery-transitioning", "a full bank still reaches the seam");
  ok(!latest().capActive, "the soft pin releases at the seam");
  eq(latest().bankPx, 0, "leftover bank is discarded at the hand-off");
  eq(environment.scrollY, seamY, "the hand-off still pins at the seam");
  eq(latest().clipT, 1, "the clip is still on its last frame at the seam", 1e-9);
  controller.dispose();
}
{
  const harness = createHarness(zoneStartY + 40);
  const { environment, latest, controller } = harness;
  ok(environment.wheel(-5000), "a huge reverse flick is owned");
  for (let tick = 0; tick < 400 && latest().capActive; tick += 1) {
    environment.clock.advance(TICK_MS);
  }
  ok(!latest().capActive, "the zone still hands back at its front edge");
  eq(latest().galleryMode, "native-before", "the hand-back stays native");
  eq(latest().bankPx, 0, "native scrolling inherits no banked momentum");
  const restY = environment.scrollY;
  environment.clock.advance(TICK_MS * 60);
  eq(environment.scrollY, restY, "the discarded bank does not coast the document");
  controller.dispose();
}

// ── A TOUCH FLICK COASTS, and the captions run at half speed ────────────────
// On a phone the zone kills the browser's own fling (every touchmove is
// preventDefault-ed) and nothing replaced it, so a swipe bought exactly the
// finger's travel — ~400 px — while the two caption dwells are 82 % of the
// zone's pixels: five to ten flicks to read one caption, which the client
// reported as a hang. A release above TOUCH_FLING_VELOCITY_PX_MS now queues
// v × TOUCH_FLING_TAU_MS more pixels (Chrome's own fling for 2 px/ms travels
// ~1500-2000 px; we grant ~1000, and the 4 s bank ceiling bounds it anyway),
// and inside the caption windows the page pays that out at CAPTION_RATE.
const DWELL_T = 0.65; // inside caption 2's readable window [0.592, 0.786]
const DWELL_Y = scrollYForVideoTime(DWELL_T, IH);
const DWELL_TICK_FRAMES = MAX_TICK_FRAMES * CAPTION_RATE;

// One finger stroke through the capped zone: `steps` touchmoves of `pxPerStep`
// (positive = the finger travels UP the glass, i.e. the page goes forward),
// with one clock advance of `stepMs` after each. Returns the finger position.
function fingerStroke(
  harness: Harness,
  steps: number,
  pxPerStep: number,
  stepMs: number,
  fromY = 700,
): number {
  const { environment } = harness;
  environment.touchStart(fromY);
  let fingerY = fromY;
  for (let i = 0; i < steps; i += 1) {
    fingerY -= pxPerStep;
    environment.touchMove(fingerY);
    environment.clock.advance(stepMs);
  }
  return fingerY;
}

// How many px the LIFT itself added to the bank: everything else on that tick
// is the cap spending, which is observable as the move of virtualY.
function liftFlingPx(harness: Harness, fingerY: number): number {
  const { environment, latest } = harness;
  const bankBefore = latest().bankPx;
  const yBefore = latest().virtualY;
  environment.touchEnd(fingerY);
  environment.clock.advance(TICK_MS);
  return latest().bankPx - bankBefore + (latest().virtualY - yBefore);
}

// (F1) A real thumb flick inside caption 2: 400 px in 250 ms (≈1.6 px/ms).
{
  const harness = createHarness(DWELL_Y);
  const { environment, latest, controller } = harness;
  ok(latest().capActive, "the flick starts inside the soft pin");
  eq(latest().bankPx, 0, "a fresh seat owes nothing");

  const fingerY = fingerStroke(harness, 16, 25, 16); // 400 px over 256 ms
  const velocity = 25 / 16;
  ok(
    velocity >= TOUCH_FLING_VELOCITY_PX_MS,
    "the probe swipe is above the fling threshold",
  );
  const bankBeforeLift = latest().bankPx;
  ok(bankBeforeLift > 0, "the unpaid finger travel is still owed at the lift");
  const fling = liftFlingPx(harness, fingerY);
  const wanted = velocity * TOUCH_FLING_TAU_MS;
  ok(
    Math.abs(fling - wanted) <= 40,
    `the lift queued ${fling.toFixed(1)} px of fling (want ≈${wanted.toFixed(0)})`,
  );

  const coast = coastToRest(harness);
  ok(
    coast.ticks * TICK_MS >= 2000,
    `the flick coasted only ${(coast.ticks * TICK_MS) / 1000} s with no input`,
  );
  ok(
    coast.worstTickFrames <= DWELL_TICK_FRAMES + 1e-9,
    `a caption tick advanced ${coast.worstTickFrames.toFixed(4)} frames ` +
      `(cap ${DWELL_TICK_FRAMES})`,
  );
  ok(
    videoTimeForY(latest().virtualY, IH) < 0.786,
    "the whole coast stayed inside caption 2",
  );
  eq(latest().bankPx, 0, "the flick's bank empties");
  bankReport.push(
    `  (F1) 400 px / 250 ms touch flick at t=${DWELL_T}: lift queued ` +
      `${fling.toFixed(0)} px on top of ${bankBeforeLift.toFixed(0)} px owed, ` +
      `coasted ${coast.movedPx.toFixed(0)} px / ${coast.movedFrames.toFixed(2)} ` +
      `frames over ${((coast.ticks * TICK_MS) / 1000).toFixed(2)} s, worst tick ` +
      `${coast.worstTickFrames.toFixed(4)} frames (cap ${DWELL_TICK_FRAMES})`,
  );
  controller.dispose();
}

// (F2) A SLOW drag is "just a bit" and must move exactly the finger travel and
// stop — the client explicitly does not want a light scroll to carry on.
{
  const harness = createHarness(DWELL_Y);
  const { latest, controller } = harness;
  const startY = latest().virtualY;
  const fingerY = fingerStroke(harness, 12, 10, 50); // 120 px over 600 ms
  ok(10 / 50 < TOUCH_FLING_VELOCITY_PX_MS, "the probe drag is below the threshold");
  const fling = liftFlingPx(harness, fingerY);
  eq(fling, 0, "a slow drag queues no fling", 1e-9);
  const coast = coastToRest(harness);
  ok(Math.abs(coast.movedPx) < 1, `the page coasted ${coast.movedPx.toFixed(2)} px after a slow drag`);
  ok(
    Math.abs(latest().virtualY - startY - 120) <= 2,
    `a 120 px drag moved the page ${(latest().virtualY - startY).toFixed(2)} px`,
  );
  bankReport.push(
    `  (F2) 120 px / 600 ms drag at t=${DWELL_T}: no fling, page moved ` +
      `${(latest().virtualY - startY).toFixed(1)} px and stopped`,
  );
  controller.dispose();
}

// (F3) A finger that PAUSES before lifting is not flicking — it is placing the
// page. No fling, only the travel it already asked for.
{
  const harness = createHarness(DWELL_Y);
  const { environment, latest, controller } = harness;
  const fingerY = fingerStroke(harness, 16, 25, 16);
  environment.clock.advance(150); // the finger rests on the glass
  ok(150 > TOUCH_FLING_MAX_IDLE_MS, "the probe pause is past the idle guard");
  const fling = liftFlingPx(harness, fingerY);
  eq(fling, 0, "a paused finger queues no fling", 1e-9);
  bankReport.push(
    `  (F3) 150 ms pause before the lift: fling ${fling.toFixed(2)} px`,
  );
  controller.dispose();
}

// (F4) The reversal dead zone is PER SOURCE. A finger rolls back a few px as it
// leaves the glass — at 8 px that discarded the whole unpaid remainder of the
// swipe — so touch gets TOUCH_BANK_REVERSAL_DEAD_ZONE_PX (a deliberate step).
// The wheel keeps the tight 8 px it always had.
{
  const harness = createHarness(SCENIC_Y);
  const { environment, latest, controller } = harness;
  environment.touchStart(700);
  environment.touchMove(300); // 400 px of forward swipe in one sample
  environment.clock.advance(TICK_MS * 3);
  const bankBefore = latest().bankPx;
  ok(bankBefore > 100, "a forward touch bank is pending");

  const yBefore = latest().virtualY;
  environment.touchMove(312); // the finger rolls back 12 px at the lift
  environment.clock.advance(TICK_MS);
  ok(
    12 < TOUCH_BANK_REVERSAL_DEAD_ZONE_PX && 12 >= BANK_REVERSAL_DEAD_ZONE_PX,
    "the probe wobble sits between the wheel and touch dead zones",
  );
  ok(latest().virtualY > yBefore, "a 12 px touch wobble keeps the page going forward");
  ok(latest().bankPx > 0, "a 12 px touch wobble keeps the swipe");
  eq(
    latest().bankPx,
    bankBefore - (latest().virtualY - yBefore),
    "the wobble is IGNORED, not banked against the swipe",
    1e-9,
  );

  const yWobble = latest().virtualY;
  environment.touchMove(342); // a deliberate 30 px step back
  environment.clock.advance(TICK_MS);
  ok(latest().virtualY < yWobble, "a 30 px touch step is a real reversal");
  ok(latest().bankPx < 0, "a real touch reversal takes the bank with it");
  bankReport.push(
    `  (F4) touch: -12 px kept a ${bankBefore.toFixed(0)} px bank, -30 px ` +
      `replaced it (dead zone ${TOUCH_BANK_REVERSAL_DEAD_ZONE_PX} px vs ` +
      `${BANK_REVERSAL_DEAD_ZONE_PX} px for the wheel)`,
  );
  controller.dispose();
}
{
  // The wheel is unchanged: 12 px still reverses it.
  const harness = createHarness(SCENIC_Y);
  const { environment, latest, controller } = harness;
  ok(environment.wheel(1000), "the forward wheel flick is owned");
  environment.clock.advance(TICK_MS * 3);
  const yBefore = latest().virtualY;
  ok(environment.wheel(-12), "the reverse wheel event is owned");
  environment.clock.advance(TICK_MS);
  ok(latest().virtualY < yBefore, "-12 px of wheel still reverses (dead zone 8)");
  ok(latest().bankPx < 0, "the wheel bank follows the reversal");
  controller.dispose();
}

// (F5) The caption brake must NOT leak: a scenic stretch still runs at the full
// 12.5 f/s.
{
  const harness = createHarness(SCENIC_Y);
  const { environment, latest, controller } = harness;
  ok(environment.wheel(100000), "the scenic flick is owned");
  environment.clock.advance(TICK_MS);
  const coast = coastToRest(harness);
  ok(
    coast.worstTickFrames <= MAX_TICK_FRAMES + 1e-9,
    `a scenic tick advanced ${coast.worstTickFrames.toFixed(4)} frames`,
  );
  ok(
    coast.worstTickFrames > DWELL_TICK_FRAMES + 1e-6,
    `the caption brake leaked into the scenic run ` +
      `(${coast.worstTickFrames.toFixed(4)} frames/tick)`,
  );
  bankReport.push(
    `  (F5) scenic tick ${coast.worstTickFrames.toFixed(4)} frames vs caption ` +
      `cap ${DWELL_TICK_FRAMES} — the brake does not leak`,
  );
  controller.dispose();
}

// Rewinding out of the FRONT of the zone with the finger still down hands back
// to native scrolling and BURNS the rest of that swipe. (Left owned, those
// leftover touchmoves fell through into the gallery scrub, which pinned the
// gallery from native-before and teleported the page forward to the seam.)
{
  const harness = createHarness(zoneStartY + 40);
  const { environment, latest, controller } = harness;
  ok(latest().capActive, "the finger starts inside the capped zone");
  environment.touchStart(200);
  let fingerY = 200;
  for (let i = 0; i < 400 && latest().capActive; i += 1) {
    fingerY += 20; // finger travels DOWN the glass: the page rewinds
    environment.touchMove(fingerY);
    environment.clock.advance(TICK_MS);
  }
  ok(!latest().capActive, "the zone hands back at its front edge");
  eq(latest().galleryMode, "native-before", "the hand-back stays native");
  const handBackY = environment.scrollY;
  for (let i = 0; i < 40; i += 1) {
    fingerY += 20;
    environment.touchMove(fingerY);
    environment.clock.advance(TICK_MS);
  }
  eq(latest().galleryMode, "native-before", "a burned swipe cannot pin the gallery");
  eq(latest().sp, latest().scrollY / ((SCROLL_TRACK_VH - 100) / 100) / IH, "progress stays physical", 1e-9);
  ok(environment.scrollY <= handBackY, "the burned swipe never drives the page forward");
  environment.touchEnd(fingerY);
  environment.clock.advance(SETTLE_DRAIN_MS);
  eq(latest().galleryMode, "native-before", "release keeps native scrolling");
  controller.dispose();
}

// Native scrolling BEFORE the video zone is untouched, and the crossing
// wheel event is the one that takes ownership.
{
  const harness = createHarness(zoneStartY - 500);
  const { environment, latest, controller } = harness;
  ok(!latest().capActive, "the soft pin is idle before the video zone");
  ok(!environment.wheel(100), "pre-video wheel remains native");
  eq(latest().scrollY, zoneStartY - 400, "native publication follows physical scroll");
  eq(latest().galleryMode, "native-before", "pre-video remains native-before");
  ok(environment.wheel(600), "the wheel that would cross into the zone is cancelled");
  ok(latest().capActive, "crossing the zone start takes ownership");
  eq(environment.scrollY, zoneStartY, "the crossing seats exactly at the zone start");
  controller.dispose();
}

// Native MOMENTUM carrying the page into the zone (iOS keeps scrolling after
// touchend with no wheel events at all) is corrected back to the zone start.
{
  const harness = createHarness(zoneStartY - 300);
  const { environment, latest, controller } = harness;
  environment.scrollY = zoneStartY + 420;
  environment.windowTarget.dispatch("scroll", {});
  ok(latest().capActive, "a momentum crossing arms the soft pin");
  eq(environment.scrollY, zoneStartY, "momentum overshoot is scrolled back to the zone start");
  eq(latest().virtualY, zoneStartY, "the virtual position starts at the zone start");
  // The rest of the in-flight tail is absorbed, exactly like the gallery pin's
  // entry grace, so the crossing costs no clip time.
  ok(environment.wheel(900), "in-grace momentum is cancelled");
  environment.clock.advance(TICK_MS * 2);
  eq(latest().virtualY, zoneStartY, "in-grace momentum buys no clip time", 1e-9);
  // A further stray scroll event is pulled back to the virtual position.
  environment.scrollY = zoneStartY + 250;
  environment.windowTarget.dispatch("scroll", {});
  eq(environment.scrollY, zoneStartY, "a stray in-zone scroll is corrected back");
  controller.dispose();
}

// A position ALREADY inside the zone (restored scroll / deep link) is adopted
// where it is instead of being yanked to the zone start.
{
  const harness = createHarness(zoneStartY + 2000);
  const { environment, latest, controller } = harness;
  environment.scrollY = zoneStartY + 2000;
  environment.windowTarget.dispatch("scroll", {});
  eq(latest().virtualY, zoneStartY + 2000, "a restored in-zone position is adopted");
  controller.dispose();
}

// The zone hands over to the pinned gallery at the seam, with the clip on its
// LAST frame — the phase coherence the whole change exists for.
{
  const harness = createHarness(seamY - 120);
  const { environment, latest, publications, controller } = harness;
  ok(latest().capActive, "the last stretch before the seam is capped");
  const from = publications.length;
  const ticks = rideCapToSeam(harness);
  ok(ticks > 0, "the seam is not reached instantly");
  eq(latest().galleryMode, "gallery-transitioning", "the pin takes the hand-off");
  ok(!latest().capActive, "the soft pin releases at the seam");
  eq(environment.scrollY, seamY, "the hand-off pins at the seam");
  eq(latest().gp, VID_FLY_END, "the hand-off lands at the first photo-ready state");
  eq(latest().galleryStep, 0, "the hand-off does not advance a photo");
  eq(latest().clipT, 1, "the clip is on its last frame exactly at the seam", 1e-9);
  // Nothing in the ride ever outran the clip.
  let worst = 0;
  for (let i = from + 1; i < publications.length; i += 1) {
    worst = Math.max(worst, publications[i].clipT - publications[i - 1].clipT);
  }
  ok(
    worst * (FRAME_COUNT - 1) <= (NATIVE_SCRUB_FPS * TICK_MS) / 1000 + 1e-6,
    `the ride never published more than one tick of clip time (got ${(worst * (FRAME_COUNT - 1)).toFixed(4)} frames)`,
  );
  controller.dispose();
}

// Reduced motion bypasses the soft pin entirely: raw scroll, no ownership.
{
  const harness = createHarness(zoneStartY + 1000);
  const { environment, latest, controller } = harness;
  ok(latest().capActive, "the zone is capped under normal motion");
  harness.setReducedMotion(true);
  ok(!latest().capActive, "reduced motion drops the soft pin");
  ok(!environment.wheel(2000), "reduced-motion wheel is native");
  eq(latest().scrollY, zoneStartY + 3000, "reduced motion publishes raw scroll");
  harness.setReducedMotion(false);
  ok(latest().capActive, "restoring motion re-seats the soft pin");
  eq(latest().virtualY, zoneStartY + 3000, "the re-seat adopts the current position");
  controller.dispose();
}

// A rotation re-seats the soft pin by CLIP TIME, not by pixels.
{
  const harness = createHarness(zoneStartY + 2500);
  const { environment, latest, controller } = harness;
  const clipBefore = latest().clipT;
  environment.innerWidth = 844;
  environment.innerHeight = 390;
  environment.windowTarget.dispatch("resize", {});
  eq(latest().clipT, clipBefore, "a rotation leaves the video where it was", 1e-9);
  eq(
    latest().virtualY,
    scrollYForVideoTime(clipBefore, 390),
    "the re-seat is the inverse of the clip time in the new viewport",
    1e-6,
  );
  controller.dispose();
}

// The crossing momentum peak is ABSORBED at the seam for a short grace; after
// it, wheel input SCRUBS the card in proportion to its travel.
{
  const harness = createHarness(seamY - 40);
  const { environment, latest, controller } = harness;
  rideCapToSeam(harness);
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
  eq(latest().galleryStep, 2, "a cooldown-clamped tail keeps its card at quiet");
  eq(latest().gp, targets[2], "the freeze rests exactly where the scrub ended", 1e-9);
  eq(latest().galleryMode, "gallery-idle", "frozen scrub becomes idle");

  // After a freeze there is NO settle animation to swallow input — the very
  // next wheel event resumes scrubbing from the frozen spot.
  ok(environment.wheel(100), "next burst is owned");
  environment.clock.advance(INPUT_QUIET_MS);
  const frozenTail = stepGpAt(2, 100);
  eq(latest().gp, frozenTail, "quiet freezes the scrub mid-gap", 1e-9);
  eq(latest().galleryStep, 2, "a sub-half freeze keeps its anchor step");
  ok(environment.wheel(80), "post-freeze input immediately resumes");
  ok(latest().gp > frozenTail, "the resumed scrub continues from the frozen spot");
  environment.clock.advance(INPUT_QUIET_MS + SETTLE_DRAIN_MS);
  eq(latest().galleryMode, "gallery-idle", "resumed scrub freezes idle again");

  // Even a tiny nudge freezes where it stops — nothing snaps behind the user.
  const beforeNudge = latest().gp;
  ok(environment.wheel(20), "tiny nudge is owned");
  ok(latest().gp > beforeNudge, "tiny nudge still moves the card while active");
  const afterNudge = latest().gp;
  environment.clock.advance(INPUT_QUIET_MS + SETTLE_DRAIN_MS);
  eq(latest().gp, afterNudge, "the nudge freezes in place", 1e-9);

  // Continuous deliberate scrolling flows card after card with NO quiet gaps
  // (the trackpad complaint: gestures must never be eaten as "residue"),
  // paced only by the commit cooldown.
  const beforeSteady = latest().galleryStep;
  for (let i = 0; i < 8; i += 1) {
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
  const beforeQuiet = latest().gp;
  environment.clock.advance(INPUT_QUIET_MS + SETTLE_DRAIN_MS);
  eq(latest().gp, beforeQuiet, "steady leftover freezes exactly where it ended", 1e-9);
  eq(latest().galleryMode, "gallery-idle", "steady chain settles idle");
  controller.dispose();
}

// A scroll-driven entry (scrollbar drag / momentum crossing) settles to idle
// on its own, so keyboard steps work without any wheel/touch gesture first.
{
  const harness = createHarness(zoneStartY - 200);
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
  ok(environment.touchMove(450), "in-zone touchmove is cancelled");
  // The finger drags the last of the video zone at the capped pace; the seam
  // hands over to the pin and BURNS the rest of that same swipe.
  let fingerY = 450;
  for (let i = 0; i < 200 && latest().galleryMode === "native-before"; i += 1) {
    fingerY -= 20;
    environment.touchMove(fingerY);
    environment.clock.advance(TICK_MS);
  }
  eq(latest().galleryMode, "gallery-transitioning", "the finger reaches the pin");
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
  // One pixel before the seam is still the VIDEO ZONE: the release re-seats the
  // soft pin there, so the way back up is capped too (the flick that used to
  // show the first Lottie title while the clip was still on the dome).
  ok(before.latest().capActive, "the release re-seats the soft pin");
  eq(before.latest().virtualY, seamY - 1, "the re-seat is the seam edge", 1e-9);
  const rewindFrom = before.latest().clipT;
  for (let tick = 0; tick < 30; tick += 1) {
    before.environment.wheel(-400);
    before.environment.clock.advance(TICK_MS);
  }
  const rewound = (rewindFrom - before.latest().clipT) * (FRAME_COUNT - 1);
  ok(rewound > 0, "the capped zone rewinds");
  ok(
    rewound <= (NATIVE_SCRUB_FPS * 30 * TICK_MS) / 1000 + 1,
    `a rewind cannot outrun the clip either (got ${rewound.toFixed(2)} frames)`,
  );
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

// Continuous riding back through the gallery unpins at the boundary WITHOUT
// any quiet gap — the boundary just costs half a span of extra travel (the
// regression: upward scrolling stalled at the first card until a 1-2s pause).
{
  const ride = createHarness(seamY);
  ride.environment.clock.advance(INPUT_QUIET_MS);
  for (let i = 0; i < 2; i += 1) {
    ride.environment.keyDown("ArrowDown");
    ride.environment.clock.advance(GALLERY_TRANSITION_MS + 1);
  }
  eq(ride.latest().galleryStep, 2, "ride starts two cards deep");
  let released = false;
  for (let i = 0; i < 20 && !released; i += 1) {
    ride.environment.wheel(-150);
    ride.environment.clock.advance(60); // < INPUT_QUIET_MS: never a quiet gap
    released = ride.latest().galleryMode === "native-before";
  }
  ok(released, "continuous upward ride releases the pin without a quiet gap");
  ride.controller.dispose();
}

// Wheel STOP = FREEZE (the radiance.family etalon): when trackpad input goes
// quiet the card stays EXACTLY where the scroll ended — no auto-commit
// fly-away, and never the reported back-slide (card 4 already shown, quiet
// eases back, card 3 rises again on the next swipe).
{
  const harness = createHarness(seamY);
  const { environment, latest, publications, controller } = harness;
  environment.clock.advance(WHEEL_ENTRY_GRACE_MS);
  const monotonicFrom = publications.length;

  // A fresh partial swipe freezes in place at quiet.
  ok(environment.wheel(120), "partial swipe is owned");
  const frozen1 = stepGpAt(0, 120);
  eq(latest().gp, frozen1, "partial swipe scrubs in proportion", 1e-9);
  environment.clock.advance(INPUT_QUIET_MS + SETTLE_DRAIN_MS);
  eq(latest().gp, frozen1, "card freezes where the scroll ended (no fly-away)", 1e-9);
  eq(latest().galleryStep, 0, "sub-half freeze keeps the anchor step");
  eq(latest().galleryMode, "gallery-idle", "frozen scrub settles to idle");

  // Resuming scrubs onward from the frozen position and can commit.
  ok(environment.wheel(SPAN), "resumed swipe is owned");
  eq(latest().gp, targets[1], "resumed full span lands on the adjacent card", 1e-9);
  eq(latest().galleryStep, 1, "resumed full span commits");

  // THE reported bug: a committed burst's leftover must freeze, never slide
  // back to its anchor at quiet.
  ok(environment.wheel(100), "post-commit leftover is owned");
  const frozen2 = stepGpAt(1, 100);
  eq(latest().gp, frozen2, "leftover scrubs past the committed card", 1e-9);
  environment.clock.advance(INPUT_QUIET_MS + SETTLE_DRAIN_MS);
  eq(latest().gp, frozen2, "committed-burst leftover freezes (never slides back)", 1e-9);
  eq(latest().galleryMode, "gallery-idle", "frozen leftover settles to idle");

  // Cooldown-clamped full span: the card fully advanced visually while the
  // commit stayed gated — at quiet it must KEEP the advanced card (this was
  // the full-card back-jump on a real trackpad).
  ok(environment.wheel(SPAN), "burst head is owned");
  eq(latest().galleryStep, 2, "burst head commits its span");
  ok(environment.wheel(SPAN + 60), "same-instant burst tail is owned");
  eq(latest().gp, targets[3], "tail clamps fully onto the next card", 1e-9);
  eq(latest().galleryStep, 2, "the cooldown gates the tail's commit");
  environment.clock.advance(INPUT_QUIET_MS + SETTLE_DRAIN_MS);
  eq(latest().gp, targets[3], "the fully-advanced card stays at quiet", 1e-9);
  eq(latest().galleryStep, 3, "quiet freeze adopts the visually-advanced card");

  // Through the whole forward-only sequence gp must never move backward.
  for (let i = monotonicFrom + 1; i < publications.length; i += 1) {
    ok(
      publications[i].gp >= publications[i - 1].gp - 1e-9,
      `forward-only wheel input never moves gp backward (publication ${i})`,
    );
  }
  controller.dispose();
}

// A frozen mid-gap residue next to a boundary scrubs back to the end target
// first — releasing the pin from a mid-card position would visually pop.
{
  const harness = createHarness(seamY);
  const { environment, latest, controller } = harness;
  environment.clock.advance(INPUT_QUIET_MS);
  ok(environment.wheel(120), "seed swipe is owned");
  environment.clock.advance(INPUT_QUIET_MS + SETTLE_DRAIN_MS);
  const frozen = stepGpAt(0, 120);
  eq(latest().gp, frozen, "seed swipe froze mid-gap", 1e-9);

  ok(environment.wheel(-40), "upward resume is owned");
  ok(
    latest().gp < frozen && latest().gp > targets[0],
    "upward resume scrubs back through the residue",
  );
  ok(
    latest().galleryMode !== "native-before",
    "a frozen mid position cannot release the pin outright",
  );
  ok(environment.wheel(-SPAN), "residue span is owned");
  eq(latest().gp, targets[0], "residue commit rests on the first target", 1e-9);
  ok(
    latest().galleryMode !== "native-before",
    "the residue commit itself does not unpin",
  );
  // The same burst rode the residue, so the boundary costs half a span.
  ok(environment.wheel(-(SPAN / 2 + 8)), "release travel is owned");
  eq(latest().galleryMode, "native-before", "continued outward travel releases");
  controller.dispose();
}

// Keyboard from a frozen mid position eases to the adjacent target; at the
// boundary it consumes the residue before releasing.
{
  const harness = createHarness(seamY);
  const { environment, latest, controller } = harness;
  environment.clock.advance(INPUT_QUIET_MS);
  ok(environment.wheel(120), "seed swipe is owned");
  environment.clock.advance(INPUT_QUIET_MS + SETTLE_DRAIN_MS);
  const frozen = stepGpAt(0, 120);
  eq(latest().gp, frozen, "seed swipe froze mid-gap", 1e-9);

  ok(environment.keyDown("ArrowUp"), "boundary key is consumed");
  environment.clock.advance(GALLERY_TRANSITION_MS + INPUT_QUIET_MS + 1);
  eq(latest().gp, targets[0], "boundary key first consumes the residue", 1e-9);
  ok(latest().galleryMode !== "native-before", "residue key does not unpin");
  ok(environment.keyDown("ArrowUp"), "follow-up key is consumed");
  eq(latest().galleryMode, "native-before", "follow-up key releases the pin");
  controller.dispose();
}

// Losing focus mid-scrub freezes in place — a blur must not jump the card.
{
  const harness = createHarness(seamY);
  const { environment, latest, controller } = harness;
  environment.clock.advance(INPUT_QUIET_MS);
  ok(environment.wheel(150), "blur-test swipe is owned");
  const frozen = stepGpAt(0, 150);
  eq(latest().gp, frozen, "swipe scrubbed before blur", 1e-9);
  environment.windowTarget.dispatch("blur", {});
  eq(latest().gp, frozen, "blur freezes the card in place", 1e-9);
  environment.clock.advance(SETTLE_DRAIN_MS);
  eq(latest().gp, frozen, "nothing moves after a blur freeze", 1e-9);
  eq(latest().galleryMode, "gallery-idle", "blur freeze settles to idle");
  controller.dispose();
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

console.log(
  `input bank (ceiling ${SCROLL_BANK_MAX_CLIP_S} s of clip = ${BANK_FRAMES} frames) at 390x844:`,
);
console.log(bankReport.join("\n"));
console.log("✓ scroll lifecycle (capped video zone + banked input + gesture-follow gallery)");
