import {
  scrollYForTimelineProgress,
  timelineProgressForY,
  videoGovernorBounds,
} from "./scrollGovernor";
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
// A wheel burst that travelled at least this many px commits even below
// GALLERY_COMMIT_FRAC, so a single mouse-wheel notch still advances a card.
export const WHEEL_COMMIT_PX = 40;
// A wheel event this many times larger than the decaying envelope of recent
// deltas is a FRESH human impulse, not momentum residue: macOS trackpad
// inertia produces monotonically decaying deltas at frame rate, so a new
// swipe spikes far above the envelope. Without this, rhythmic trackpad
// scrolling never sees a quiet window and every follow-up swipe is eaten as
// "same burst" (supervisor: "скрол веде себе дуже погано і не завжди
// спрацьовує в обидві сторони").
export const WHEEL_FRESH_FACTOR = 2.5;
export const WHEEL_FRESH_MIN_PX = 16;
const WHEEL_ENVELOPE_DECAY = 0.8;
// Settle animation for a FULL remaining span; scaled down by the distance
// actually left, floored so the tail never pops.
export const GALLERY_SETTLE_MS = 360;
export const GALLERY_SETTLE_MIN_MS = 120;

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
  // The current wheel burst has been fully spent (boundary entry, pin release,
  // committed step, or discarded into a running transition) — its residue
  // stays inert until the burst goes quiet OR a fresh impulse spikes above
  // the envelope (a new human swipe inside the old momentum tail).
  let wheelBurstConsumed = false;
  let wheelEnvelopePx = 0;
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

  const publish = () => {
    if (disposed) return;
    const scrollY = finiteScrollY(environment.readScrollY());
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

  const movePhysicalScroll = (targetY: number) => {
    const target = finiteScrollY(targetY);
    expectedScrollY = target;
    if (Math.abs(environment.readScrollY() - target) < BOUNDARY_TOLERANCE_PX) {
      expectedScrollY = null;
      return;
    }
    environment.scrollTo({ top: target, behavior: "auto" });
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
      if (scrub !== null && scrub.source === "wheel") settleScrub();
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
    // "gallery-transitioning" with keyboard steps dead.
    if (consumeCurrentGesture) armWheelQuiet();
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
    movePhysicalScroll(Math.max(seamY - BOUNDARY_TOLERANCE_PX, 0));
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

  const beginScrub = (
    source: GalleryScrub["source"],
    direction: GalleryDirection,
  ): GalleryScrub => {
    scrub = {
      source,
      direction,
      anchorGp: galleryGp,
      result: requestGalleryStep(stepper, direction),
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
    if (active.result.kind !== "step") {
      // No adjacent card in the latched direction — this gesture can only
      // release the pin. The card holds its anchor while the gesture builds up
      // to the release threshold.
      galleryGp = active.anchorGp;
      if (active.totalPx * active.direction >= TOUCH_STEP_PX) {
        scrub = null;
        if (active.source === "touch") touchStepUsed = true;
        else wheelBurstConsumed = true;
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

  // End-of-gesture settle: commit to the adjacent card when the gesture
  // travelled far enough (or flicked fast enough), otherwise ease back to the
  // anchor. Duration scales with the distance actually left so short tails
  // never feel like a fresh full animation.
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
      active.source === "touch" &&
      directionFor(active.velocityPxMs) === active.direction &&
      Math.abs(active.velocityPxMs) >= GALLERY_FLICK_VELOCITY_PX_MS;
    const wheelCommit =
      active.source === "wheel" && scrubTravelPx(active) >= WHEEL_COMMIT_PX;
    const commit = frac >= GALLERY_COMMIT_FRAC || flick || wheelCommit;
    if (commit && active.result.kind === "step") {
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
    const result = requestGalleryStep(stepper, direction);
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
    publish();
  };

  const onWheel: ScrollTimelineEventListener = (event) => {
    if (reducedMotion()) return;
    const delta = wheelDeltaPx(event, innerHeight);
    const direction = directionFor(delta);
    if (direction === 0) return;
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
      if (transition !== null) {
        // Contract: input during a transition is consumed, never queued.
        wheelBurstConsumed = true;
        return;
      }
      let active = scrub;
      if (active !== null && active.source !== "wheel") {
        wheelBurstConsumed = true;
        return;
      }
      if (
        active !== null &&
        freshImpulse &&
        direction !== active.direction
      ) {
        // Direction flip on a fresh swipe: drop the old scrub at its anchor
        // (no settle animation — the new gesture owns the card now).
        galleryGp = active.anchorGp;
        scrub = null;
        active = null;
      }
      if (active === null) active = beginScrub("wheel", direction);
      active.totalPx += delta;
      applyScrub();
      // Full clamp = the step is unambiguous: commit NOW instead of waiting
      // out the quiet window, and burn the rest of this burst (still exactly
      // one step per gesture). The next fresh impulse starts the next card.
      const settled = scrub;
      if (
        settled !== null &&
        settled.source === "wheel" &&
        settled.result.kind === "step" &&
        scrubFrac(settled) >= 1
      ) {
        stepper = settled.result.state;
        galleryGp = settled.result.targetGp;
        scrub = null;
        wheelBurstConsumed = true;
        settlePinnedMode();
        publish();
      }
      return;
    }

    const rawY = finiteScrollY(environment.readScrollY());
    if (mode === "native-before") {
      if (direction > 0 && rawY + delta >= seamY) {
        preventDefault(event);
        wheelBurstActive = true;
        wheelBurstConsumed = true;
        armWheelQuiet();
        enterGallery("before", true);
      }
      return;
    }
    if (mode === "native-after") {
      if (direction < 0 && rawY + delta <= galleryEndY) {
        preventDefault(event);
        wheelBurstActive = true;
        wheelBurstConsumed = true;
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
    touchOwned = isPinnedMode(mode);
    touchStepUsed = false;
    touchStartY = y;
    touchLastY = y;
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
      if (mode === "native-after" && delta < 0 && rawY + delta <= galleryEndY) {
        preventDefault(event);
        touchOwned = true;
        touchStepUsed = true;
        enterGallery("after", true);
      }
      return;
    }

    preventDefault(event);
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

    if (mode === "native-before") {
      if (direction > 0 && rawY + projectedDelta >= seamY) {
        preventDefault(event);
        enterGallery("before", false);
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
    touchActive = false;
    touchOwned = false;
    touchStepUsed = false;
    touchStartY = null;
    touchLastY = null;
    if (scrub !== null) {
      // Losing focus/visibility mid-gesture: revert to the anchor without an
      // animation so the step state stays consistent (no commit on blur).
      galleryGp = scrub.anchorGp;
      scrub = null;
      publish();
    }
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
    innerHeight = validViewportHeight(environment.readInnerHeight(), innerHeight);
    seamY = videoGovernorBounds(innerHeight).endY;
    galleryEndY = scrollYForTimelineProgress({ sp: 1, gp: 1 }, innerHeight);
    if (isPinnedMode(mode)) {
      pinY = pinSide === "before" ? seamY : galleryEndY;
      movePhysicalScroll(pinY);
    }
    publish();
  };

  const syncReducedMotion = () => {
    resetInputOwnership();
    clearTransition();
    const rawY = finiteScrollY(environment.readScrollY());
    if (reducedMotion()) {
      mode = rawY < seamY ? "native-before" : "native-after";
      publish();
      return;
    }
    const progress = timelineProgressForY(rawY, innerHeight);
    if (rawY < seamY - BOUNDARY_TOLERANCE_PX) {
      mode = "native-before";
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

  publish();

  return {
    syncReducedMotion,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearWheelQuiet();
      clearTouchQuiet();
      clearTransition();
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
