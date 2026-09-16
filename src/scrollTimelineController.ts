import {
  BANK_EASE_OUT_CLIP_S,
  SCROLL_BANK_MAX_CLIP_S,
  bankClipSeconds,
  capVirtualY,
  clampBankPx,
  coastRateScale,
  scrollYForTimelineProgress,
  scrollYForVideoTime,
  timelineProgressForY,
  videoGovernorBounds,
  videoTimeForY,
} from "./scrollGovernor";
import { SCRUB_DIAL_OVERRIDES, scrubDialsActive } from "./scrubDials";
import {
  MAX_SCRUB_DELTA_S,
  getLastPaintedScrubFrame,
  scrubTargetFrameFor,
} from "./frameScrub";
import { FRAME_COUNT } from "./frames";
import { videoMasterTimeFor } from "./playback";
import {
  createGalleryStepperState,
  galleryStepTargets,
  requestGalleryStep,
} from "./galleryGestureStepper";
import type {
  GalleryDirection,
  GalleryStepResult,
  GalleryStepperState,
} from "./galleryGestureStepper";

export type ScrollTimelineEventListener = (
  event: Record<string, unknown>,
) => void;

export type ScrollTimelineListenerOptions =
  | boolean
  | { capture?: boolean; passive?: boolean };

export interface ScrollTimelineEventTarget {
  addEventListener(
    type: string,
    listener: ScrollTimelineEventListener,
    options?: ScrollTimelineListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: ScrollTimelineEventListener,
    options?: ScrollTimelineListenerOptions,
  ): void;
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
  // The soft pin's authoritative position inside the video zone. Outside the
  // zone it simply tracks the document, so it is always a valid seat.
  virtualY: number;
  // True while the video zone owns input and the page speed is capped.
  capActive: boolean;
  // Scroll the user has already asked for and the cap has not paid out yet
  // (signed, px). Zero outside the zone and the instant a gesture is spent.
  bankPx: number;
}

export interface ScrollTimelineControllerOptions {
  environment: ScrollTimelineControllerEnvironment;
  reducedMotion(): boolean;
  onPublish(publication: ScrollTimelinePublication): void;
}

export interface ScrollTimelineController {
  syncReducedMotion(): void;
  dispose(): void;
}

export interface WritableScrollTimelineRefs {
  scrollRef: { current: number };
  galleryRef: { current: number };
}

export interface ScrollTimelineRefValues {
  sp: number;
  gp: number;
}

export const INPUT_QUIET_MS = 140;
// Travel (px, toward the gesture's latched direction) required before an
// at-the-ends gesture releases the pin back to native scrolling.
export const TOUCH_STEP_PX = 24;
// Discrete (keyboard) step duration. Pointer gestures do NOT use this: they
// scrub the card live and only the post-release settle animates.
export const GALLERY_TRANSITION_MS = 520;

// ── Gesture-follow (scrub) dials ─────────────────────────────────────────────
// The card FOLLOWS the gesture (supervisor: "якщо він легко піднімає її до
// гори — вона слідує за його рухом; зупинився — і карточка зупинилась"), then
// settles when the gesture ends: forward to the adjacent card if it travelled
// far/fast enough, back to where it rested otherwise. One gesture still moves
// at most ONE step — the scrub is clamped to the adjacent target.
export const GALLERY_DRAG_DEAD_ZONE_PX = 8;
// Finger px for a FULL one-card scrub, as a fraction of the viewport height
// (mirrors the old native conveyor's ≈35vh-per-card cadence).
export const GALLERY_STEP_SPAN_FRAC = 0.35;
export const GALLERY_STEP_SPAN_MIN_PX = 180;
// Released past this fraction of the span → the step commits.
export const GALLERY_COMMIT_FRAC = 0.3;
// Release velocity (px/ms toward the latched direction) that commits a short
// swipe — the "flick" path.
export const GALLERY_FLICK_VELOCITY_PX_MS = 0.5;
// A wheel event this many times larger than the decaying envelope of recent
// deltas is a FRESH human impulse, not momentum residue — used ONLY to let a
// deliberate new swipe escape a consumed burst (boundary entry / pin
// release). Card ADVANCEMENT deliberately does not depend on this: gentle
// trackpad swipes ramp up gradually and never spike above their predecessor's
// envelope, so any gesture-segmentation heuristic eats them (supervisor had
// to park the cursor between swipes just to outwait the quiet window).
export const WHEEL_FRESH_FACTOR = 2.5;
export const WHEEL_FRESH_MIN_PX = 16;
const WHEEL_ENVELOPE_DECAY = 0.8;
// Wheel advancement is CONTINUOUS ACCUMULATION instead (the Lenis model):
// every pinned wheel px feeds the scrub; a full step span commits the card
// and accumulation restarts from the new anchor (overshoot dropped, so a
// flick's tail refills at most ~one more span). The cooldown bounds the
// commit cadence so heavy input steps through cards at a readable pace.
// When the input goes QUIET the card FREEZES exactly where the scroll ended
// (the radiance.family etalon: ScrollTrigger scrub with no snap) — settling
// it onto a target moved the card AFTER the user stopped, read as jumps: a
// committed burst's leftover eased BACK (card 4 already shown, quiet slid it
// back, card 3 rose again on the next swipe), and a fresh partial swipe flew
// FORWARD on its own. The next gesture just resumes from the frozen spot.
export const WHEEL_COMMIT_COOLDOWN_MS = 160;
// Boundary crossings absorb wheel input for a short TIME grace instead of
// burning the whole gesture: burning meant a macOS momentum tail (plus the
// user's seamlessly continued scrolling — gentle ramps never spike above the
// tail's envelope) was eaten for seconds after the pin caught (supervisor:
// "продовжую скролити далі але нічого не відбувається секунди 2"). The grace
// soaks up the crossing momentum peak; everything after it accumulates, so a
// continued scroll flows straight into the cards.
export const WHEEL_ENTRY_GRACE_MS = 250;
// Settle animation for a FULL remaining span; scaled down by the distance
// actually left, floored so the tail never pops.
export const GALLERY_SETTLE_MS = 360;
export const GALLERY_SETTLE_MIN_MS = 120;

// -- Video-zone soft pin -----------------------------------------------------
// Inside videoGovernorBounds the controller owns input exactly like the pinned
// gallery does: wheel/touch/keys are cancelled and queued as px, a rAF ticker
// integrates them through capVirtualY (clip-time limited) and WRITES the result
// back to the document. The page therefore cannot outrun the clip - the video,
// the Lottie titles, the 3D figures and the card morph all read the SAME
// published progress, so they stay in phase by construction instead of by a
// per-consumer lag. "Please scroll slower" is enforced, not requested.
//
// Excess input is BANKED (see the bank section of capTick) and paid out at the
// cap, so a flick buys playback instead of evaporating; a reversal past the
// per-source dead zone still discards the backlog and answers on the very next
// tick, so changing your mind is never charged for the direction you left.
// On touch the zone also has to SYNTHESIZE the fling the browser would have run
// (see TOUCH_FLING_TAU_MS): preventDefault killed it.
//
// How far the requested frame may run ahead of the frame actually PAINTED
// before the page itself waits (decode backpressure). With the chase running at
// the same 12.5 f/s this is normally a no-op; it only bites when the loader is
// starved, and then the page slows down instead of showing a stale picture.
export const DECODE_LEAD_FRAMES = 2;
// Per-event queue clamp, so a Home/End projection (MAX_SAFE_INTEGER) stays a
// finite number; the cap clamps it to the zone anyway.
const MAX_QUEUED_DELTA_PX = 1e6;
// How big a backwards event has to be before it counts as the user CHANGING
// THEIR MIND rather than noise. A finger leaving the glass wobbles a couple of
// pixels the other way, and a trackpad's momentum tail flutters around zero;
// throwing the whole banked swipe away over that would feel like the page
// randomly refusing a flick. Anything at or above this is a real reversal and
// takes effect on the very tick it arrives, backlog and all.
export const BANK_REVERSAL_DEAD_ZONE_PX = 8;
// …except from a FINGER, which rolls backwards as it leaves the glass far more
// than a trackpad's momentum tail flutters: a lift that wobbles 8-20 px the
// other way is ordinary, and at the wheel's dead zone it threw away the whole
// unpaid remainder of the swipe — the flick simply stopped dead. Touch therefore
// reverses only on a DELIBERATE step, the same TOUCH_STEP_PX the pinned gallery
// already treats as one. A frame that somehow mixed sources uses the larger.
export const TOUCH_BANK_REVERSAL_DEAD_ZONE_PX = TOUCH_STEP_PX;
// ── Synthetic touch fling ───────────────────────────────────────────────────
// Inside the zone every touchmove is preventDefault-ed, so the browser's own
// fling never happens: a swipe used to buy exactly the finger's travel (~400 px)
// and stop dead, which on the old caption dwells was 0.6 s of clip — the "hang".
// On release the zone now queues the fling the browser would have: velocity
// x TOUCH_FLING_TAU_MS px, banked and paid out at the cap like any other input.
//
// Below this release speed a drag is "just a bit" and must move exactly the
// finger travel and then stop — the client explicitly does not want a light
// scroll to carry on. Same number as the gallery pin's flick threshold, which
// is the same physical gesture judged by the same hand.
export const TOUCH_FLING_VELOCITY_PX_MS = 0.5;
// 2026-09-16 — 500 ms → 150 ms. 500 was modelled on iOS's own long glide and,
// on top of the 4 s bank, is what the client saw as "the page scrolls by itself
// for 2-4 s" after every swipe. Android's fling is the reference now: a 2 px/ms
// release travels ~300 px in ~0.4 s, which is exactly v x 150 ms here. A 1.6
// px/ms thumb flick buys 240 px, a violent 2.5 px/ms one 375 px — and the bank
// ceiling (1.2 s of clip ≈ 345 px at 844) tops both of them out, so the page
// answers a hard swipe and a firm one almost identically.
export const TOUCH_FLING_TAU_MS = 150;
// A finger that stopped before lifting is PLACING the page, not throwing it, so
// a stale velocity must not be paid out. (iOS in particular can hold the last
// touchmove well before touchend.)
export const TOUCH_FLING_MAX_IDLE_MS = 100;

// ── The dials as this page actually runs them ───────────────────────────────
// Defaults are the constants above and in scrollGovernor; `?bank=`, `?fling=`
// and `?ease=` override them for a phone-testing session (see scrubDials.ts).
// Resolved ONCE here so there is a single effective value to pass into the pure
// functions and to publish on window.__sg.
export const ACTIVE_SCRUB_DIALS = {
  bankMaxClipS: SCRUB_DIAL_OVERRIDES.bankMaxClipS ?? SCROLL_BANK_MAX_CLIP_S,
  flingTauMs: SCRUB_DIAL_OVERRIDES.flingTauMs ?? TOUCH_FLING_TAU_MS,
  easeWindowClipS:
    SCRUB_DIAL_OVERRIDES.easeWindowClipS ?? BANK_EASE_OUT_CLIP_S,
  overridden: scrubDialsActive(),
} as const;
// Below this the bank is finished, not "nearly finished": leaving a hundredth
// of a pixel owed would re-arm the ticker forever and creep the document.
const BANK_SNAP_PX = 0.01;
// The ticker writes sub-pixel steps (70 px/s is ~1.2 px/frame through the
// scenic stretches), so the physical write-back uses a much tighter tolerance
// than the 1 px boundary epsilon or the document would quietly drift off the
// virtual position.
const CAP_WRITE_TOLERANCE_PX = 0.25;
const CLIP_FRAME_SPAN = Math.max(FRAME_COUNT - 1, 1);

const PASSIVE_EVENT_OPTIONS = { passive: true } as const;
const CANCELLABLE_EVENT_OPTIONS = { passive: false } as const;
const BOUNDARY_TOLERANCE_PX = 1;
const LINE_DELTA_PX = 16;
const VELOCITY_SMOOTHING = 0.3;

interface GalleryTransition {
  fromGp: number;
  targetGp: number;
  startedAt: number;
  durationMs: number;
  ease: (value: number) => number;
}

// One live gesture scrubbing the pinned gallery. Direction is LATCHED at the
// first dead-zone crossing: the same physical gesture can pull the card back
// toward its anchor but never switches to the opposite step (and an at-the-end
// wiggle can never accidentally release the pin).
interface GalleryScrub {
  source: "touch" | "wheel";
  direction: GalleryDirection;
  anchorGp: number;
  result: GalleryStepResult;
  totalPx: number;
  velocityPxMs: number;
  lastMoveAt: number;
}

type PinSide = "before" | "after";

function validViewportHeight(value: number, fallback = 1): number {
  if (Number.isFinite(value) && value > 0) return value;
  if (Number.isFinite(fallback) && fallback > 0) return fallback;
  return 1;
}

function finiteScrollY(value: number): number {
  return Number.isFinite(value) ? Math.max(value, 0) : 0;
}

function preventDefault(event: Record<string, unknown>): void {
  const prevent = event.preventDefault;
  if (typeof prevent === "function") prevent.call(event);
}

function wheelDeltaPx(
  event: Record<string, unknown>,
  innerHeight: number,
): number {
  const raw = event.deltaY;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  const mode = event.deltaMode;
  if (mode === 1) return raw * LINE_DELTA_PX;
  if (mode === 2) return raw * innerHeight;
  return raw;
}

function directionFor(value: number): GalleryDirection | 0 {
  if (!Number.isFinite(value) || value === 0) return 0;
  return value > 0 ? 1 : -1;
}

function firstTouchY(
  event: Record<string, unknown>,
  key: "touches" | "changedTouches" = "touches",
): number | null {
  const list = event[key] as ArrayLike<{ clientY?: unknown }> | undefined;
  const value = list?.[0]?.clientY;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isEditableTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const candidate = target as {
    isContentEditable?: unknown;
    closest?: (selector: string) => unknown;
  };
  if (candidate.isContentEditable) return true;
  return Boolean(
    candidate.closest?.(
      'input, textarea, select, [contenteditable=""], [contenteditable="true"]',
    ),
  );
}

function keyDirection(event: Record<string, unknown>): GalleryDirection | 0 {
  if (
    event.defaultPrevented ||
    event.repeat ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    isEditableTarget(event.target)
  ) {
    return 0;
  }
  const key = String(event.key);
  if (key === " " || key === "Spacebar") return event.shiftKey ? -1 : 1;
  if (["ArrowDown", "PageDown", "End"].includes(key)) return 1;
  if (["ArrowUp", "PageUp", "Home"].includes(key)) return -1;
  return 0;
}

function keyProjectedDelta(
  event: Record<string, unknown>,
  innerHeight: number,
): number {
  const direction = keyDirection(event);
  if (direction === 0) return 0;
  const key = String(event.key);
  if (key === "Home" || key === "End") {
    return direction * Number.MAX_SAFE_INTEGER;
  }
  if (["PageUp", "PageDown", " ", "Spacebar"].includes(key)) {
    return direction * innerHeight * 0.9;
  }
  return direction * 40;
}

function easeInOutCubic(value: number): number {
  const u = Math.min(Math.max(value, 0), 1);
  return u < 0.5
    ? 4 * u * u * u
    : 1 - Math.pow(-2 * u + 2, 3) / 2;
}

function easeOutCubic(value: number): number {
  const u = Math.min(Math.max(value, 0), 1);
  return 1 - Math.pow(1 - u, 3);
}

function nearestStepIndex(gp: number): number {
  const targets = galleryStepTargets();
  let nearest = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < targets.length; index += 1) {
    const nextDistance = Math.abs(targets[index] - gp);
    if (nextDistance < distance) {
      nearest = index;
      distance = nextDistance;
    }
  }
  return nearest;
}

function isPinnedMode(mode: GalleryMode): boolean {
  return mode === "gallery-idle" || mode === "gallery-transitioning";
}

export function writeScrollTimelineRefs(
  refs: WritableScrollTimelineRefs,
  values: ScrollTimelineRefValues,
): void {
  refs.scrollRef.current = values.sp;
  refs.galleryRef.current = values.gp;
}

export function createScrollTimelineController(
  options: ScrollTimelineControllerOptions,
): ScrollTimelineController {
  const { environment, reducedMotion, onPublish } = options;
  let innerHeight = validViewportHeight(environment.readInnerHeight());
  let lastWidth = environment.readInnerWidth();
  let zoneStartY = videoGovernorBounds(innerHeight).startY;
  let seamY = videoGovernorBounds(innerHeight).endY;
  let galleryEndY = scrollYForTimelineProgress({ sp: 1, gp: 1 }, innerHeight);

  const initialY = finiteScrollY(environment.readScrollY());
  const initialProgress = timelineProgressForY(initialY, innerHeight);
  const initialStep = nearestStepIndex(initialProgress.gp);
  let stepper: GalleryStepperState = createGalleryStepperState(initialStep);
  let galleryGp = galleryStepTargets()[stepper.index];
  let mode: GalleryMode =
    initialY < seamY - BOUNDARY_TOLERANCE_PX
      ? "native-before"
      : initialY >= galleryEndY - BOUNDARY_TOLERANCE_PX
        ? "native-after"
        : "gallery-idle";
  let pinSide: PinSide = initialY >= (seamY + galleryEndY) / 2 ? "after" : "before";
  let pinY = pinSide === "before" ? seamY : galleryEndY;

  let wheelBurstActive = false;
  // The current wheel burst has been fully spent (boundary entry or pin
  // release) — its residue stays inert until the burst goes quiet OR a fresh
  // impulse spikes above the envelope (a new human swipe inside the tail).
  let wheelBurstConsumed = false;
  let wheelEnvelopePx = 0;
  let lastWheelCommitAt = -Infinity;
  let wheelEntryGraceUntil = -Infinity;
  // A commit already happened inside the current burst: its remaining tail
  // keeps ACCUMULATING toward further full-span commits (deliberate
  // continuous scrolling flows card by card), but at the boundary the ride
  // pays a HALF-SPAN price to release the pin, so a flick's decaying tail —
  // which spent its energy on the cards — cannot blow through.
  let wheelCommittedInBurst = false;
  let wheelQuietTimer: number | null = null;
  let touchActive = false;
  let touchOwned = false;
  let touchStepUsed = false;
  let touchStartY: number | null = null;
  let touchLastY: number | null = null;
  let touchQuietTimer: number | null = null;
  let scrub: GalleryScrub | null = null;
  let transition: GalleryTransition | null = null;
  let transitionFrame: number | null = null;
  let transitionEndTimer: number | null = null;
  let expectedScrollY: number | null = null;
  let disposed = false;

  // -- Soft-pin state -------------------------------------------------------
  let virtualY = initialY;
  let capActive = false;
  // pendingDeltaPx is only the INTRA-FRAME accumulator: whatever arrived since
  // the last tick. bankPx is the standing debt — everything the user has asked
  // for that the cap has not paid out yet (see the bank section of capTick).
  let pendingDeltaPx = 0;
  // Which input queued this frame's pending px. Only the reversal dead zone
  // reads it: a finger and a wheel disagree about what counts as jitter.
  let pendingFromTouch = false;
  let bankPx = 0;
  // Zone-side finger velocity (px/ms, signed, same EMA as the gallery scrub's).
  // The gallery keeps its own on a GalleryScrub struct, which the video zone
  // never allocates — the zone owns the finger before any card exists.
  let capTouchVelocityPxMs = 0;
  let capTouchLastMoveAt: number | null = null;
  // When the zone last received ANY input (wheel/touch/key, the synthetic fling
  // included). The ease-out below only engages once this is INPUT_QUIET_MS old
  // and no finger is on the glass — i.e. only while the page is coasting on a
  // gesture that is already over.
  let capLastInputAt: number | null = null;
  let capLastTickAt: number | null = null;
  let capEntryGraceUntil = -Infinity;
  let capFrame: number | null = null;

  const publish = () => {
    if (disposed) return;
    const rawY = finiteScrollY(environment.readScrollY());
    // While the soft pin owns the video zone the VIRTUAL position is the truth
    // (the document chases it, not the other way round), so progress is
    // published from virtualY and NEVER from readScrollY(). Outside the zone
    // virtualY just tracks the document, which keeps a later zone entry seated
    // on a real position - and makes "did we cross in?" answerable.
    if (!capActive) virtualY = isPinnedMode(mode) ? pinY : rawY;
    const scrollY = capActive ? virtualY : rawY;
    const progress = isPinnedMode(mode)
      ? { sp: 1, gp: galleryGp }
      : timelineProgressForY(scrollY, innerHeight);
    onPublish({
      scrollY,
      sp: progress.sp,
      gp: progress.gp,
      clipT: videoMasterTimeFor(progress.sp, progress.gp, "scroll"),
      galleryMode: mode,
      galleryStep: stepper.index,
      virtualY,
      capActive,
      bankPx,
    });
  };

  const clearWheelQuiet = () => {
    if (wheelQuietTimer === null) return;
    environment.clearTimeout(wheelQuietTimer);
    wheelQuietTimer = null;
  };

  const clearTouchQuiet = () => {
    if (touchQuietTimer === null) return;
    environment.clearTimeout(touchQuietTimer);
    touchQuietTimer = null;
  };

  const clearTransition = () => {
    if (transitionFrame !== null) {
      environment.cancelFrame(transitionFrame);
      transitionFrame = null;
    }
    if (transitionEndTimer !== null) {
      environment.clearTimeout(transitionEndTimer);
      transitionEndTimer = null;
    }
    transition = null;
  };

  const movePhysicalScroll = (
    targetY: number,
    tolerancePx = BOUNDARY_TOLERANCE_PX,
  ) => {
    const target = finiteScrollY(targetY);
    expectedScrollY = target;
    if (Math.abs(environment.readScrollY() - target) < tolerancePx) {
      expectedScrollY = null;
      return;
    }
    environment.scrollTo({ top: target, behavior: "auto" });
  };

  // ── Video-zone soft pin ──────────────────────────────────────────────────
  // Ownership is decided by POSITION, not by gesture: anywhere inside
  // [zoneStartY, seamY) while scrolling natively forward-of-the-gallery, the
  // controller drives the document itself. The zone ends exactly where the
  // gallery pin begins, so the two hand over at one shared coordinate and
  // videoMasterTimeFor already clamps to clip time 1 for every pinned step.
  const capShouldOwn = (y: number): boolean =>
    !reducedMotion() &&
    mode === "native-before" &&
    y >= zoneStartY &&
    y < seamY;

  const stopCapTicker = () => {
    if (capFrame === null) return;
    environment.cancelFrame(capFrame);
    capFrame = null;
  };

  const startCapTicker = () => {
    if (disposed || !capActive || capFrame !== null) return;
    capFrame = environment.requestFrame(capTick);
  };

  const exitCapZone = () => {
    capActive = false;
    // Whatever the gesture still owed is DISCARDED at the border. The pinned
    // gallery has its own gesture semantics on the far side, and native scroll
    // on the near side has the browser's own momentum: handing either of them a
    // banked debt would move the page after the zone stopped owning it.
    pendingDeltaPx = 0;
    pendingFromTouch = false;
    bankPx = 0;
    capLastTickAt = null;
    capLastInputAt = null;
    capEntryGraceUntil = -Infinity;
    stopCapTicker();
  };

  // `absorbMomentum` mirrors the gallery pin's entry grace: a crossing that was
  // driven by inertia (a macOS wheel tail, an iOS fling that kept scrolling
  // after touchend) has its remaining peak soaked up for WHEEL_ENTRY_GRACE_MS
  // instead of being paid out as free clip time. A finger still on the glass,
  // or a keyboard step, gets no grace - there is no momentum to absorb and the
  // gesture must keep driving immediately.
  const enterCapZone = (seatY: number, absorbMomentum: boolean) => {
    const seat = Math.min(
      Math.max(finiteScrollY(seatY), zoneStartY),
      Math.max(seamY - BOUNDARY_TOLERANCE_PX, zoneStartY),
    );
    virtualY = seat;
    pendingDeltaPx = 0;
    pendingFromTouch = false;
    bankPx = 0;
    capLastInputAt = null;
    capActive = true;
    // Seed the tick clock at ENTRY, not at the first frame: a null seed would
    // give the first tick dt = 0, which drops the very wheel event that asked
    // for the entry.
    capLastTickAt = environment.readNow();
    capEntryGraceUntil = absorbMomentum
      ? environment.readNow() + WHEEL_ENTRY_GRACE_MS
      : -Infinity;
    movePhysicalScroll(virtualY);
    startCapTicker();
    publish();
  };

  const queueCapDelta = (px: number, source: "wheel" | "touch" | "key") => {
    if (!Number.isFinite(px) || px === 0) return;
    if (source === "touch") pendingFromTouch = true;
    capLastInputAt = environment.readNow();
    pendingDeltaPx += Math.min(Math.max(px, -MAX_QUEUED_DELTA_PX), MAX_QUEUED_DELTA_PX);
    startCapTicker();
  };

  // Decode backpressure. The rate cap keeps the REQUESTED frame at the clip's
  // native pace, but on a starved connection the painted frame can still fall
  // behind it - and a page whose progress has run past the picture is exactly
  // the desync this whole change exists to remove. So the virtual position is
  // additionally clamped to stay within DECODE_LEAD_FRAMES of what was actually
  // painted: the page literally waits for frames. A stale/never-set painted
  // frame (paused render loop, loader still up) disables it, so nothing here
  // can deadlock scrolling.
  const decodeBackpressuredY = (
    fromY: number,
    toY: number,
    nowMs: number,
  ): number => {
    if (toY === fromY) return toY;
    const painted = getLastPaintedScrubFrame(nowMs);
    if (painted === null) return toY;
    const forward = toY > fromY;
    const limitFrame = forward
      ? painted + DECODE_LEAD_FRAMES
      : painted - DECODE_LEAD_FRAMES;
    const requestedFrame = scrubTargetFrameFor(videoTimeForY(toY, innerHeight));
    if (forward ? requestedFrame <= limitFrame : requestedFrame >= limitFrame) {
      return toY;
    }
    const limitY = scrollYForVideoTime(
      Math.min(Math.max(limitFrame / CLIP_FRAME_SPAN, 0), 1),
      innerHeight,
    );
    // Backpressure may only SLOW a move, never reverse it.
    return forward
      ? Math.max(fromY, Math.min(toY, limitY))
      : Math.min(fromY, Math.max(toY, limitY));
  };

  const capTick = (now: number) => {
    capFrame = null;
    if (disposed || !capActive) return;
    if (!capShouldOwn(virtualY)) {
      exitCapZone();
      return;
    }

    const previous = virtualY;
    const last = capLastTickAt;
    capLastTickAt = now;
    const dtSec =
      last === null
        ? 0
        : Math.min(Math.max((now - last) / 1000, 0), MAX_SCRUB_DELTA_S);
    // ── The bank ───────────────────────────────────────────────────────────
    // Everything the cap refuses is KEPT here, not dropped, and paid out at the
    // cap over the following ticks: a flick buys playback instead of
    // evaporating (the old behaviour cost the user ~150 wheel notches to cross
    // the zone, because 98.5 px of every 100 px notch was thrown away).
    const incoming = pendingDeltaPx;
    const incomingFromTouch = pendingFromTouch;
    pendingDeltaPx = 0;
    pendingFromTouch = false;
    if (
      bankPx !== 0 &&
      incoming !== 0 &&
      Math.sign(incoming) !== Math.sign(bankPx)
    ) {
      // Changing direction is not "netting off against the backlog": the user
      // wants to go the other way NOW, so the backlog is dropped and the
      // reverse applies on this very tick. Except for jitter — see
      // BANK_REVERSAL_DEAD_ZONE_PX — which is ignored outright. A FINGER
      // wobbles much harder than a trackpad tail as it lifts, so touch uses the
      // wider TOUCH_BANK_REVERSAL_DEAD_ZONE_PX (a mixed frame takes the larger).
      const deadZone = incomingFromTouch
        ? TOUCH_BANK_REVERSAL_DEAD_ZONE_PX
        : BANK_REVERSAL_DEAD_ZONE_PX;
      if (Math.abs(incoming) >= deadZone) bankPx = incoming;
    } else {
      bankPx += incoming;
    }
    // A bank is a debt in CLIP TIME, so its ceiling is too: one gesture may owe
    // at most ACTIVE_SCRUB_DIALS.bankMaxClipS seconds of playback. At the zone's
    // edges that horizon runs out of clip and the ceiling lifts, which is what
    // keeps the seam hand-off and the native hand-back below firing exactly as
    // before.
    bankPx = clampBankPx(
      previous,
      bankPx,
      innerHeight,
      ACTIVE_SCRUB_DIALS.bankMaxClipS,
    );
    const requested = previous + bankPx;

    // ── Ease-out ───────────────────────────────────────────────────────────
    // A native fling decelerates; a bank that runs out at the cap stops dead.
    // So the moment the page is purely COASTING — no finger on the glass and no
    // input for INPUT_QUIET_MS — the tick budget is scaled by how much clip is
    // still owed. While the gesture is live the scale is exactly 1: the client
    // rejected "lag" under the finger in August and nothing here may re-add it.
    const coasting =
      !touchActive &&
      capLastInputAt !== null &&
      now - capLastInputAt >= INPUT_QUIET_MS;
    const rateScale = coasting
      ? coastRateScale(
          bankClipSeconds(previous, bankPx, innerHeight),
          ACTIVE_SCRUB_DIALS.easeWindowClipS,
        )
      : 1;

    let next =
      requested === previous
        ? previous
        : capVirtualY(previous, requested, dtSec, innerHeight, rateScale);
    next = finiteScrollY(decodeBackpressuredY(previous, next, now));

    // STRICTLY at or past the seam. A boundary-epsilon threshold here would
    // hand back to the pin the instant releaseBefore re-seated the soft pin one
    // pixel short of it — an unbreakable ping-pong at the seam. capVirtualY
    // lands EXACTLY on seamY when the clip runs out (clip time clamps to 1,
    // whose inverse is the seam), so the exact comparison is always reachable.
    if (next >= seamY) {
      // The clip reached its last frame exactly at the seam: hand the same
      // gesture over to the pinned gallery, which owns everything past it.
      virtualY = seamY;
      exitCapZone();
      // A finger already on the glass must not also step cards with the
      // remainder of the same swipe (the seam-entry rule).
      if (touchOwned) touchStepUsed = true;
      enterGallery("before", true);
      return;
    }
    if (next < zoneStartY) {
      // Rewound out of the front of the zone: hand back to free native scroll.
      // A finger still on the glass has to be let go of here, and its swipe
      // BURNED: the browser already cancelled this gesture's scroll on the
      // first preventDefault, so the remainder can never move the page again —
      // and leaving it owned fed it to the gallery scrub, which pinned the
      // gallery from native-before and teleported the page to the seam.
      if (touchOwned) {
        touchOwned = false;
        touchStepUsed = true;
      }
      virtualY = next;
      exitCapZone();
      movePhysicalScroll(virtualY);
      publish();
      return;
    }

    // Only what was actually SPENT leaves the bank: whatever the cap (or the
    // decode backpressure above) refused is still owed, and the ticker — which
    // re-arms every frame while the zone is owned — pays it out next frame.
    bankPx -= next - previous;
    if (Math.abs(bankPx) < BANK_SNAP_PX) bankPx = 0;

    virtualY = next;
    if (virtualY !== previous) {
      movePhysicalScroll(virtualY, CAP_WRITE_TOLERANCE_PX);
      publish();
    }
    startCapTicker();
  };

  const settlePinnedMode = () => {
    if (!isPinnedMode(mode)) return;
    const blocked =
      transition !== null ||
      scrub !== null ||
      wheelBurstActive ||
      touchActive ||
      touchQuietTimer !== null;
    const nextMode: GalleryMode = blocked
      ? "gallery-transitioning"
      : "gallery-idle";
    if (mode === nextMode) return;
    mode = nextMode;
    publish();
  };

  const armWheelQuiet = () => {
    clearWheelQuiet();
    wheelQuietTimer = environment.setTimeout(() => {
      wheelQuietTimer = null;
      wheelBurstActive = false;
      wheelBurstConsumed = false;
      wheelEnvelopePx = 0;
      if (scrub !== null && scrub.source === "wheel") freezeScrub();
      wheelCommittedInBurst = false;
      settlePinnedMode();
    }, INPUT_QUIET_MS);
  };

  const armTouchQuiet = () => {
    clearTouchQuiet();
    touchQuietTimer = environment.setTimeout(() => {
      touchQuietTimer = null;
      settlePinnedMode();
    }, INPUT_QUIET_MS);
  };

  const enterGallery = (side: PinSide, consumeCurrentGesture: boolean) => {
    exitCapZone();
    clearTransition();
    scrub = null;
    pinSide = side;
    pinY = side === "before" ? seamY : galleryEndY;
    stepper = createGalleryStepperState(
      side === "before" ? 0 : galleryStepTargets().length - 1,
    );
    galleryGp = galleryStepTargets()[stepper.index];
    mode = consumeCurrentGesture ? "gallery-transitioning" : "gallery-idle";
    // A consumed entry must still reach "gallery-idle" on its own: entries
    // driven by a bare scroll event (scrollbar drag, momentum crossing) have
    // no gesture end of their own, and would otherwise leave the pin stuck in
    // "gallery-transitioning" with keyboard steps dead. The wheel grace soaks
    // up the crossing momentum peak; the rest of the tail then accumulates.
    if (consumeCurrentGesture) {
      armWheelQuiet();
      wheelEntryGraceUntil = environment.readNow() + WHEEL_ENTRY_GRACE_MS;
    }
    movePhysicalScroll(pinY);
    publish();
  };

  const finishTransition = () => {
    if (transition === null) return;
    galleryGp = transition.targetGp;
    clearTransition();
    settlePinnedMode();
    publish();
  };

  const tickTransition = (now: number) => {
    if (transition === null || disposed) return;
    const elapsed = now - transition.startedAt;
    const fraction = elapsed / transition.durationMs;
    galleryGp =
      transition.fromGp +
      (transition.targetGp - transition.fromGp) * transition.ease(fraction);
    publish();
    if (fraction >= 1) {
      finishTransition();
      return;
    }
    transitionFrame = environment.requestFrame(tickTransition);
  };

  const animateGalleryTo = (
    targetGp: number,
    durationMs = GALLERY_TRANSITION_MS,
    ease: (value: number) => number = easeInOutCubic,
  ) => {
    clearTransition();
    mode = "gallery-transitioning";
    transition = {
      fromGp: galleryGp,
      targetGp,
      startedAt: environment.readNow(),
      durationMs,
      ease,
    };
    transitionFrame = environment.requestFrame(tickTransition);
    transitionEndTimer = environment.setTimeout(finishTransition, durationMs);
    publish();
  };

  const releaseBefore = () => {
    clearTransition();
    mode = "native-before";
    const target = Math.max(seamY - BOUNDARY_TOLERANCE_PX, 0);
    // One pixel before the seam is the far end of the VIDEO ZONE, so the pin
    // does not release into free scrolling: it releases into the soft pin, and
    // the clip rewinds at its own pace. No entry grace - the gesture that asked
    // for the release is the one that should keep driving.
    if (capShouldOwn(target)) {
      enterCapZone(target, false);
      return;
    }
    movePhysicalScroll(target);
    publish();
  };

  const releaseAfter = () => {
    clearTransition();
    mode = "native-after";
    movePhysicalScroll(galleryEndY);
    publish();
  };

  // ── Gesture-follow scrub ────────────────────────────────────────────────────

  const stepSpanPx = () =>
    Math.max(innerHeight * GALLERY_STEP_SPAN_FRAC, GALLERY_STEP_SPAN_MIN_PX);

  const scrubDeadZonePx = (source: GalleryScrub["source"]) =>
    source === "touch" ? GALLERY_DRAG_DEAD_ZONE_PX : 0;

  // Px travelled toward the latched direction, past the dead zone (≥ 0 — the
  // gesture can pull back to its anchor but never scrub the opposite step).
  const scrubTravelPx = (active: GalleryScrub) =>
    Math.max(
      active.totalPx * active.direction - scrubDeadZonePx(active.source),
      0,
    );

  const scrubFrac = (active: GalleryScrub) =>
    Math.min(scrubTravelPx(active) / stepSpanPx(), 1);

  // Wheel stop = freeze: the card stays exactly where the scroll ended (the
  // etalon behaviour) and only the step BOOKKEEPING adopts the nearest
  // target, so keyboard steps and the next gesture resume consistently.
  const freezeScrub = () => {
    if (scrub === null) return;
    scrub = null;
    stepper = createGalleryStepperState(nearestStepIndex(galleryGp));
    publish();
  };

  // A release request from a gp frozen MID-GAP would unpin with a card half
  // in flight (visual pop on the native handoff) — substitute a step that
  // first scrubs the residue back onto the end target; releasing then takes
  // continued travel from the target itself.
  const requestScrubStep = (direction: GalleryDirection): GalleryStepResult => {
    const result = requestGalleryStep(stepper, direction);
    if (result.kind === "step") return result;
    const endTarget = galleryStepTargets()[stepper.index];
    if (Math.abs(galleryGp - endTarget) > 1e-6) {
      return {
        kind: "step",
        state: createGalleryStepperState(stepper.index),
        targetGp: endTarget,
      };
    }
    return result;
  };

  const beginScrub = (
    source: GalleryScrub["source"],
    direction: GalleryDirection,
    anchorGp = galleryGp,
  ): GalleryScrub => {
    scrub = {
      source,
      direction,
      anchorGp,
      result: requestScrubStep(direction),
      totalPx: 0,
      velocityPxMs: 0,
      lastMoveAt: environment.readNow(),
    };
    mode = "gallery-transitioning";
    return scrub;
  };

  const applyScrub = () => {
    if (scrub === null) return;
    const active = scrub;
    if (active.source === "wheel" && active.totalPx * active.direction < 0) {
      // Wheel accumulation crossing back through its anchor re-latches toward
      // the opposite neighbour — continuous scrolling flows both ways. (Touch
      // keeps its single latch so an in-swipe wiggle can never flip or
      // release; a reversed wheel at the first card releasing the pin is the
      // DESIRED way back up.)
      active.direction = (-active.direction) as GalleryDirection;
      active.result = requestScrubStep(active.direction);
    }
    if (active.result.kind !== "step") {
      // No adjacent card in the latched direction — this gesture can only
      // release the pin. The card holds its anchor while the gesture builds
      // up to the release threshold. A wheel burst that already committed
      // cards pays a HIGHER price (half a step span of extra travel) instead
      // of being blocked outright: continuous riding through the gallery
      // unpins at the boundary without ever needing a quiet gap (supervisor:
      // upward scrolling stalled at the first card until a 1-2s pause), while
      // a flick's decaying tail — which spent its energy on the cards —
      // still cannot blow through.
      galleryGp = active.anchorGp;
      const releaseThresholdPx =
        active.source === "wheel" && wheelCommittedInBurst
          ? stepSpanPx() * 0.5
          : TOUCH_STEP_PX;
      if (active.totalPx * active.direction >= releaseThresholdPx) {
        scrub = null;
        // Touch burns the rest of the swipe (finger-lift = natural gesture
        // end); a wheel tail after a release just scrolls the page natively —
        // that IS the user continuing in the released direction.
        if (active.source === "touch") touchStepUsed = true;
        if (active.result.kind === "release-before") releaseBefore();
        else releaseAfter();
        return;
      }
      publish();
      return;
    }
    galleryGp =
      active.anchorGp +
      (active.result.targetGp - active.anchorGp) * scrubFrac(active);
    publish();
  };

  // End-of-TOUCH settle (finger lift is a real gesture end; wheel quiet
  // FREEZES instead): commit to the adjacent card when the gesture travelled
  // far enough (or flicked fast enough), otherwise ease back to the anchor.
  // Duration scales with the distance actually left so short tails never
  // feel like a fresh full animation.
  const settleScrub = () => {
    if (scrub === null) return;
    const active = scrub;
    scrub = null;
    if (active.result.kind !== "step") {
      galleryGp = active.anchorGp;
      settlePinnedMode();
      publish();
      return;
    }
    const frac = scrubFrac(active);
    const flick =
      directionFor(active.velocityPxMs) === active.direction &&
      Math.abs(active.velocityPxMs) >= GALLERY_FLICK_VELOCITY_PX_MS;
    const commit = frac >= GALLERY_COMMIT_FRAC || flick;
    if (commit) {
      stepper = active.result.state;
    }
    const targetGp = commit ? active.result.targetGp : active.anchorGp;
    const stepSizeGp = Math.abs(active.result.targetGp - active.anchorGp);
    const remainingGp = Math.abs(targetGp - galleryGp);
    if (remainingGp < 1e-6 || stepSizeGp < 1e-9) {
      galleryGp = targetGp;
      clearTransition();
      settlePinnedMode();
      publish();
      return;
    }
    const durationMs = Math.max(
      GALLERY_SETTLE_MS * Math.min(remainingGp / stepSizeGp, 1),
      GALLERY_SETTLE_MIN_MS,
    );
    animateGalleryTo(targetGp, durationMs, easeOutCubic);
  };

  // Discrete (keyboard) navigation keeps the fixed-duration eased step.
  const acceptIntent = (direction: GalleryDirection) => {
    if (mode !== "gallery-idle" || transition !== null || scrub !== null) {
      return;
    }
    const result = requestScrubStep(direction);
    if (result.kind === "release-before") {
      releaseBefore();
      return;
    }
    if (result.kind === "release-after") {
      releaseAfter();
      return;
    }
    stepper = result.state;
    animateGalleryTo(result.targetGp);
  };

  const onScroll: ScrollTimelineEventListener = () => {
    if (reducedMotion()) {
      publish();
      return;
    }

    const rawY = finiteScrollY(environment.readScrollY());
    if (expectedScrollY !== null) {
      const expected = expectedScrollY;
      expectedScrollY = null;
      if (Math.abs(rawY - expected) <= BOUNDARY_TOLERANCE_PX) {
        publish();
        return;
      }
    }

    if (capActive) {
      // A stray native scroll INSIDE the zone - inertia that was already in
      // flight when the soft pin caught, a browser scroll restore, an anchor
      // jump - is corrected back to the virtual position exactly the way the
      // gallery pin corrects back to pinY. The entry grace soaks up the rest of
      // the tail, so the crossing costs the user no clip time.
      if (Math.abs(rawY - virtualY) > BOUNDARY_TOLERANCE_PX) {
        movePhysicalScroll(virtualY);
      }
      publish();
      return;
    }

    if (isPinnedMode(mode)) {
      if (Math.abs(rawY - pinY) > BOUNDARY_TOLERANCE_PX) {
        movePhysicalScroll(pinY);
      }
      publish();
      return;
    }

    if (mode === "native-before" && rawY >= seamY) {
      enterGallery("before", true);
      return;
    }
    if (mode === "native-after" && rawY < galleryEndY) {
      enterGallery("after", true);
      return;
    }
    if (mode === "native-before" && rawY >= zoneStartY) {
      // Native momentum (iOS keeps scrolling after touchend with no wheel
      // events at all) carried the page into the video zone. Take ownership:
      // a crossing IN from before the zone re-seats at zoneStartY and scrolls
      // back, because the distance inertia stole is precisely the free clip
      // time the cap exists to refuse. A position that was ALREADY inside -
      // a restored scroll, a deep link, the first publish - is adopted where
      // it is, so nothing yanks.
      const crossedIn = virtualY < zoneStartY;
      enterCapZone(crossedIn ? zoneStartY : rawY, crossedIn);
      return;
    }
    publish();
  };

  const onWheel: ScrollTimelineEventListener = (event) => {
    if (reducedMotion()) return;
    const delta = wheelDeltaPx(event, innerHeight);
    const direction = directionFor(delta);
    if (direction === 0) return;
    if (capActive) {
      // Soft pin: the wheel never moves the document directly, it only asks.
      preventDefault(event);
      if (environment.readNow() < capEntryGraceUntil) return;
      queueCapDelta(delta, "wheel");
      return;
    }
    const magnitude = Math.abs(delta);
    // Fresh-impulse test BEFORE the envelope absorbs this event: a new human
    // swipe spikes far above the decaying momentum tail it interrupts.
    const freshImpulse =
      magnitude >= WHEEL_FRESH_MIN_PX &&
      magnitude > wheelEnvelopePx * WHEEL_FRESH_FACTOR;
    wheelEnvelopePx = Math.max(
      magnitude,
      wheelEnvelopePx * WHEEL_ENVELOPE_DECAY,
    );

    if (wheelBurstActive && wheelBurstConsumed) {
      if (!freshImpulse) {
        // Residue of a spent burst (boundary entry / release / committed /
        // discarded) stays inert until quiet or a fresh impulse.
        preventDefault(event);
        armWheelQuiet();
        return;
      }
      // A fresh swipe inside the old tail begins a NEW gesture right here.
      wheelBurstConsumed = false;
    }

    if (isPinnedMode(mode)) {
      preventDefault(event);
      wheelBurstActive = true;
      armWheelQuiet();
      // Absorb the boundary-crossing momentum peak; after the grace the same
      // physical scroll seamlessly starts scrubbing the first card.
      if (environment.readNow() < wheelEntryGraceUntil) return;
      let active = scrub;
      if (active !== null && active.source !== "wheel") {
        // A live touch drag owns the card; wheel input stays consumed.
        wheelBurstConsumed = true;
        return;
      }
      if (transition !== null) {
        // Only the events that land DURING a settle animation are dropped —
        // no consumed flag, so the same physical swipe resumes accumulating
        // the moment the settle finishes (settles only exist after a pause;
        // live continuous scrolling commits instantly with no animation).
        return;
      }
      if (active === null) active = beginScrub("wheel", direction);
      active.totalPx += delta;
      applyScrub();
      // A full accumulated span commits the card; the next event re-anchors
      // at the committed target and keeps accumulating (overshoot dropped).
      // The cooldown paces violent input to a readable card cadence.
      const clamped = scrub;
      if (
        clamped !== null &&
        clamped.source === "wheel" &&
        clamped.result.kind === "step" &&
        scrubFrac(clamped) >= 1 &&
        environment.readNow() - lastWheelCommitAt >= WHEEL_COMMIT_COOLDOWN_MS
      ) {
        lastWheelCommitAt = environment.readNow();
        wheelCommittedInBurst = true;
        stepper = clamped.result.state;
        galleryGp = clamped.result.targetGp;
        scrub = null;
        publish();
      }
      return;
    }

    const rawY = finiteScrollY(environment.readScrollY());
    if (mode === "native-before") {
      if (direction > 0 && rawY + delta >= seamY) {
        preventDefault(event);
        wheelBurstActive = true;
        armWheelQuiet();
        enterGallery("before", true);
        return;
      }
      if (direction > 0 && rawY + delta >= zoneStartY) {
        preventDefault(event);
        enterCapZone(zoneStartY, true);
      }
      return;
    }
    if (mode === "native-after") {
      if (direction < 0 && rawY + delta <= galleryEndY) {
        preventDefault(event);
        wheelBurstActive = true;
        armWheelQuiet();
        enterGallery("after", true);
      }
      return;
    }
  };

  const onTouchStart: ScrollTimelineEventListener = (event) => {
    if (touchActive) return;
    const y = firstTouchY(event);
    if (y === null) return;
    clearTouchQuiet();
    touchActive = true;
    touchOwned = isPinnedMode(mode) || capActive;
    touchStepUsed = false;
    touchStartY = y;
    touchLastY = y;
    capTouchVelocityPxMs = 0;
    capTouchLastMoveAt = null;
  };

  const onTouchMove: ScrollTimelineEventListener = (event) => {
    const y = firstTouchY(event);
    if (y === null || touchLastY === null || touchStartY === null) return;
    const delta = touchLastY - y;
    const total = touchStartY - y;
    touchLastY = y;
    if (reducedMotion()) return;

    if (!touchOwned) {
      const rawY = finiteScrollY(environment.readScrollY());
      if (mode === "native-before" && delta > 0 && rawY + delta >= seamY) {
        preventDefault(event);
        touchOwned = true;
        touchStepUsed = true;
        enterGallery("before", true);
        return;
      }
      if (mode === "native-before" && delta > 0 && rawY + delta >= zoneStartY) {
        // The finger crosses into the video zone: own it from here, but do NOT
        // burn the swipe - unlike the gallery pin the zone wants the finger to
        // keep driving, just slower. No grace either: nothing is coasting while
        // a finger is down.
        preventDefault(event);
        touchOwned = true;
        enterCapZone(zoneStartY, false);
        return;
      }
      if (mode === "native-after" && delta < 0 && rawY + delta <= galleryEndY) {
        preventDefault(event);
        touchOwned = true;
        touchStepUsed = true;
        enterGallery("after", true);
      }
      return;
    }

    preventDefault(event);
    if (capActive) {
      // The zone keeps its own release velocity, on the same EMA the gallery
      // scrub uses, because there is no GalleryScrub here to hang it on and the
      // gallery path below is never reached while the soft pin owns the finger.
      // The first move after touchstart seeds nothing (no previous sample), so
      // a single stray sample can never read as a throw.
      const now = environment.readNow();
      const lastAt = capTouchLastMoveAt;
      capTouchLastMoveAt = now;
      if (lastAt !== null) {
        const dt = Math.max(now - lastAt, 1);
        capTouchVelocityPxMs =
          capTouchVelocityPxMs * (1 - VELOCITY_SMOOTHING) +
          (delta / dt) * VELOCITY_SMOOTHING;
      }
      queueCapDelta(delta, "touch");
      return;
    }
    // Everything below scrubs the pinned GALLERY. Ownership can outlive the
    // pin (the soft pin hands back mid-swipe), and running this path outside
    // it would re-pin the gallery from native scrolling.
    if (!isPinnedMode(mode)) return;
    if (touchStepUsed) return;
    if (transition !== null) return;
    let active = scrub;
    if (active !== null && active.source !== "touch") return;
    let freshScrub = false;
    if (active === null) {
      if (Math.abs(total) < GALLERY_DRAG_DEAD_ZONE_PX) return;
      const direction = directionFor(total);
      if (direction === 0) return;
      active = beginScrub("touch", direction);
      freshScrub = true;
    }
    if (!freshScrub) {
      const now = environment.readNow();
      const dt = Math.max(now - active.lastMoveAt, 1);
      active.lastMoveAt = now;
      active.velocityPxMs =
        active.velocityPxMs * (1 - VELOCITY_SMOOTHING) +
        (delta / dt) * VELOCITY_SMOOTHING;
    }
    active.totalPx = total;
    applyScrub();
  };

  const onTouchEnd: ScrollTimelineEventListener = (event) => {
    if (!touchActive) return;
    if (firstTouchY(event) !== null) return;
    if (touchOwned) preventDefault(event);
    // The fling the browser would have started if the zone had not cancelled
    // every touchmove. Only for touch, only while the zone owns it, and only
    // from a finger that was still MOVING when it left the glass.
    if (capActive && touchOwned) {
      const idleMs =
        capTouchLastMoveAt === null
          ? Number.POSITIVE_INFINITY
          : environment.readNow() - capTouchLastMoveAt;
      if (
        Math.abs(capTouchVelocityPxMs) >= TOUCH_FLING_VELOCITY_PX_MS &&
        idleMs <= TOUCH_FLING_MAX_IDLE_MS
      ) {
        queueCapDelta(
          capTouchVelocityPxMs * ACTIVE_SCRUB_DIALS.flingTauMs,
          "touch",
        );
      }
    }
    capTouchVelocityPxMs = 0;
    capTouchLastMoveAt = null;
    touchActive = false;
    touchOwned = false;
    touchStepUsed = false;
    touchStartY = null;
    touchLastY = null;
    if (scrub !== null && scrub.source === "touch") settleScrub();
    armTouchQuiet();
    settlePinnedMode();
  };

  const onKeyDown: ScrollTimelineEventListener = (event) => {
    if (reducedMotion()) return;
    const direction = keyDirection(event);
    if (direction === 0) return;
    const projectedDelta = keyProjectedDelta(event, innerHeight);
    const rawY = finiteScrollY(environment.readScrollY());

    if (capActive) {
      preventDefault(event);
      queueCapDelta(projectedDelta, "key");
      return;
    }

    if (mode === "native-before") {
      if (direction > 0 && rawY + projectedDelta >= seamY) {
        preventDefault(event);
        enterGallery("before", false);
        return;
      }
      if (direction > 0 && rawY + projectedDelta >= zoneStartY) {
        preventDefault(event);
        enterCapZone(zoneStartY, false);
      }
      return;
    }
    if (mode === "native-after") {
      if (direction < 0 && rawY + projectedDelta <= galleryEndY) {
        preventDefault(event);
        enterGallery("after", false);
      }
      return;
    }

    preventDefault(event);
    acceptIntent(direction);
  };

  const resetInputOwnership = () => {
    clearWheelQuiet();
    clearTouchQuiet();
    wheelBurstActive = false;
    wheelBurstConsumed = false;
    wheelEnvelopePx = 0;
    wheelCommittedInBurst = false;
    touchActive = false;
    touchOwned = false;
    touchStepUsed = false;
    touchStartY = null;
    touchLastY = null;
    capTouchVelocityPxMs = 0;
    capTouchLastMoveAt = null;
    // Queued-but-unspent scroll is abandoned with the gesture — the pending
    // accumulator AND the bank, so a tab that comes back does not finish a
    // swipe the user made before they left — and the tick clock restarts so a
    // backgrounded tab cannot pay out a multi-second dt.
    pendingDeltaPx = 0;
    pendingFromTouch = false;
    bankPx = 0;
    capLastTickAt = null;
    capLastInputAt = null;
    // Losing focus/visibility mid-gesture: freeze in place — any motion
    // behind the user's back reads as a jump when they come back.
    freezeScrub();
    settlePinnedMode();
  };

  const onVisibilityChange: ScrollTimelineEventListener = () => {
    if (environment.readVisibilityState() === "hidden") resetInputOwnership();
  };

  const onResize: ScrollTimelineEventListener = () => {
    const width = environment.readInnerWidth();
    if (width === lastWidth) {
      publish();
      return;
    }
    lastWidth = width;
    const clipBefore = capActive ? videoTimeForY(virtualY, innerHeight) : null;
    innerHeight = validViewportHeight(environment.readInnerHeight(), innerHeight);
    zoneStartY = videoGovernorBounds(innerHeight).startY;
    seamY = videoGovernorBounds(innerHeight).endY;
    galleryEndY = scrollYForTimelineProgress({ sp: 1, gp: 1 }, innerHeight);
    if (isPinnedMode(mode)) {
      pinY = pinSide === "before" ? seamY : galleryEndY;
      movePhysicalScroll(pinY);
    } else if (capActive) {
      // Re-seat by CLIP TIME rather than pixels: a rotation must leave the
      // video exactly where it was, and the whole zone just moved under it.
      const reseated =
        clipBefore === null
          ? virtualY
          : scrollYForVideoTime(clipBefore, innerHeight);
      if (capShouldOwn(reseated)) {
        enterCapZone(reseated, false);
        return;
      }
      exitCapZone();
      movePhysicalScroll(Math.min(Math.max(reseated, 0), seamY));
    }
    publish();
  };

  const syncReducedMotion = () => {
    resetInputOwnership();
    clearTransition();
    // Reduced motion bypasses the governor entirely: raw scroll, no soft pin,
    // no pinned gallery, no cap - exactly as before this change.
    exitCapZone();
    const rawY = finiteScrollY(environment.readScrollY());
    if (reducedMotion()) {
      mode = rawY < seamY ? "native-before" : "native-after";
      publish();
      return;
    }
    const progress = timelineProgressForY(rawY, innerHeight);
    if (rawY < seamY - BOUNDARY_TOLERANCE_PX) {
      mode = "native-before";
      if (capShouldOwn(rawY)) {
        enterCapZone(rawY, false);
        return;
      }
    } else if (rawY >= galleryEndY - BOUNDARY_TOLERANCE_PX) {
      mode = "native-after";
    } else {
      stepper = createGalleryStepperState(nearestStepIndex(progress.gp));
      galleryGp = galleryStepTargets()[stepper.index];
      pinSide = rawY >= (seamY + galleryEndY) / 2 ? "after" : "before";
      pinY = pinSide === "before" ? seamY : galleryEndY;
      mode = "gallery-idle";
      movePhysicalScroll(pinY);
    }
    publish();
  };

  environment.windowTarget.addEventListener(
    "scroll",
    onScroll,
    PASSIVE_EVENT_OPTIONS,
  );
  environment.windowTarget.addEventListener(
    "wheel",
    onWheel,
    CANCELLABLE_EVENT_OPTIONS,
  );
  environment.windowTarget.addEventListener(
    "touchstart",
    onTouchStart,
    PASSIVE_EVENT_OPTIONS,
  );
  environment.windowTarget.addEventListener(
    "touchmove",
    onTouchMove,
    CANCELLABLE_EVENT_OPTIONS,
  );
  environment.windowTarget.addEventListener(
    "touchend",
    onTouchEnd,
    CANCELLABLE_EVENT_OPTIONS,
  );
  environment.windowTarget.addEventListener(
    "touchcancel",
    onTouchEnd,
    CANCELLABLE_EVENT_OPTIONS,
  );
  environment.windowTarget.addEventListener("keydown", onKeyDown);
  environment.windowTarget.addEventListener("resize", onResize);
  environment.windowTarget.addEventListener("blur", resetInputOwnership);
  environment.documentTarget.addEventListener(
    "visibilitychange",
    onVisibilityChange,
  );

  // A first paint that already sits inside the video zone (restored scroll,
  // deep link, fast-refresh) adopts the soft pin where it is - no yank.
  if (capShouldOwn(initialY)) enterCapZone(initialY, false);
  else publish();

  return {
    syncReducedMotion,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearWheelQuiet();
      clearTouchQuiet();
      clearTransition();
      stopCapTicker();
      environment.windowTarget.removeEventListener(
        "scroll",
        onScroll,
        PASSIVE_EVENT_OPTIONS,
      );
      environment.windowTarget.removeEventListener(
        "wheel",
        onWheel,
        CANCELLABLE_EVENT_OPTIONS,
      );
      environment.windowTarget.removeEventListener(
        "touchstart",
        onTouchStart,
        PASSIVE_EVENT_OPTIONS,
      );
      environment.windowTarget.removeEventListener(
        "touchmove",
        onTouchMove,
        CANCELLABLE_EVENT_OPTIONS,
      );
      environment.windowTarget.removeEventListener(
        "touchend",
        onTouchEnd,
        CANCELLABLE_EVENT_OPTIONS,
      );
      environment.windowTarget.removeEventListener(
        "touchcancel",
        onTouchEnd,
        CANCELLABLE_EVENT_OPTIONS,
      );
      environment.windowTarget.removeEventListener("keydown", onKeyDown);
      environment.windowTarget.removeEventListener("resize", onResize);
      environment.windowTarget.removeEventListener(
        "blur",
        resetInputOwnership,
      );
      environment.documentTarget.removeEventListener(
        "visibilitychange",
        onVisibilityChange,
      );
    },
  };
}
