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
export const TOUCH_STEP_PX = 24;
export const GALLERY_TRANSITION_MS = 520;

const PASSIVE_EVENT_OPTIONS = { passive: true } as const;
const CANCELLABLE_EVENT_OPTIONS = { passive: false } as const;
const BOUNDARY_TOLERANCE_PX = 1;
const LINE_DELTA_PX = 16;

interface GalleryTransition {
  fromGp: number;
  targetGp: number;
  startedAt: number;
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
  let wheelQuietTimer: number | null = null;
  let touchActive = false;
  let touchOwned = false;
  let touchStepUsed = false;
  let touchStartY: number | null = null;
  let touchLastY: number | null = null;
  let touchQuietTimer: number | null = null;
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
    pinSide = side;
    pinY = side === "before" ? seamY : galleryEndY;
    stepper = createGalleryStepperState(
      side === "before" ? 0 : galleryStepTargets().length - 1,
    );
    galleryGp = galleryStepTargets()[stepper.index];
    mode = consumeCurrentGesture ? "gallery-transitioning" : "gallery-idle";
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
    const fraction = elapsed / GALLERY_TRANSITION_MS;
    galleryGp =
      transition.fromGp +
      (transition.targetGp - transition.fromGp) * easeInOutCubic(fraction);
    publish();
    if (fraction >= 1) {
      finishTransition();
      return;
    }
    transitionFrame = environment.requestFrame(tickTransition);
  };

  const animateGalleryTo = (targetGp: number) => {
    clearTransition();
    mode = "gallery-transitioning";
    transition = {
      fromGp: galleryGp,
      targetGp,
      startedAt: environment.readNow(),
    };
    transitionFrame = environment.requestFrame(tickTransition);
    transitionEndTimer = environment.setTimeout(
      finishTransition,
      GALLERY_TRANSITION_MS,
    );
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

  const acceptIntent = (direction: GalleryDirection) => {
    if (mode !== "gallery-idle" || transition !== null) return;
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

    if (wheelBurstActive) {
      preventDefault(event);
      armWheelQuiet();
      return;
    }

    const rawY = finiteScrollY(environment.readScrollY());
    if (mode === "native-before") {
      if (direction > 0 && rawY + delta >= seamY) {
        preventDefault(event);
        wheelBurstActive = true;
        armWheelQuiet();
        enterGallery("before", true);
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

    preventDefault(event);
    wheelBurstActive = true;
    armWheelQuiet();
    acceptIntent(direction);
    settlePinnedMode();
  };

  const onTouchStart: ScrollTimelineEventListener = (event) => {
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
    if (touchStepUsed || Math.abs(total) < TOUCH_STEP_PX) return;
    touchStepUsed = true;
    const direction = directionFor(total);
    if (direction !== 0) acceptIntent(direction);
    settlePinnedMode();
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
    touchActive = false;
    touchOwned = false;
    touchStepUsed = false;
    touchStartY = null;
    touchLastY = null;
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
