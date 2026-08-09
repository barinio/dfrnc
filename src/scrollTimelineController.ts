import {
  applyScrollSample,
  beginScrollGesture,
  createScrollGovernorState,
  endScrollGesture,
  releaseScrollSuppression,
  scrollYForTimelineProgress,
  syncRawScrollPosition,
  timelineProgressForY,
  videoTimeForY,
} from "./scrollGovernor";
import type {
  ScrollGovernorState,
  ScrollGovernorStep,
  TimelineProgress,
} from "./scrollGovernor";

export type ScrollTimelineEventListener = (event: Record<string, unknown>) => void;

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
  readDocumentEnd(): number;
  readVisibilityState(): string;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(id: number): void;
  scrollTo(options: { top: number; behavior: "auto" }): void;
}

export interface ScrollTimelinePublication {
  rawY: number;
  virtualY: number;
  sp: number;
  gp: number;
  clipT: number;
  gestureActive: boolean;
  gestureLocksGallery: boolean;
  discardedForwardPx: number;
}

export interface ScrollTimelineControllerOptions {
  environment: ScrollTimelineControllerEnvironment;
  reducedMotion(): boolean;
  onPublish(publication: ScrollTimelinePublication): void;
}

export interface ScrollTimelineController {
  dispose(): void;
}

export interface WritableScrollTimelineRefs {
  scrollRef: { current: number };
  galleryRef: { current: number };
  virtualYRef: { current: number };
}

export interface ScrollTimelineRefValues {
  sp: number;
  gp: number;
  virtualY: number;
}

export const INPUT_QUIET_MS = 120;
const REANCHOR_TOLERANCE_PX = 1;
const REANCHOR_GUARD_MS = 80;
const PASSIVE_EVENT_OPTIONS = { passive: true } as const;

function validViewportHeight(value: number, fallback = 1): number {
  if (Number.isFinite(value) && value > 0) return value;
  if (Number.isFinite(fallback) && fallback > 0) return fallback;
  return 1;
}

function safeDocumentEnd(environment: ScrollTimelineControllerEnvironment) {
  const end = environment.readDocumentEnd();
  return Number.isFinite(end) ? Math.max(end, 0) : 0;
}

function touchCount(event: Record<string, unknown>): number {
  const touches = event.touches as { length?: unknown } | undefined;
  return typeof touches?.length === "number" && Number.isFinite(touches.length)
    ? Math.max(touches.length, 0)
    : 0;
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

function isScrollingKey(event: Record<string, unknown>): boolean {
  if (
    event.defaultPrevented ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey
  ) {
    return false;
  }
  if (event.shiftKey && event.key !== " " && event.key !== "Spacebar") {
    return false;
  }
  if (isEditableTarget(event.target)) return false;
  return [
    "ArrowUp",
    "ArrowDown",
    "PageUp",
    "PageDown",
    " ",
    "Spacebar",
    "Home",
    "End",
  ].includes(String(event.key));
}

export function writeScrollTimelineRefs(
  refs: WritableScrollTimelineRefs,
  values: ScrollTimelineRefValues,
): void {
  refs.scrollRef.current = values.sp;
  refs.galleryRef.current = values.gp;
  refs.virtualYRef.current = values.virtualY;
}

export function createScrollTimelineController(
  options: ScrollTimelineControllerOptions,
): ScrollTimelineController {
  const { environment, reducedMotion, onPublish } = options;
  let innerHeight = validViewportHeight(environment.readInnerHeight());
  let logicalMaxY = scrollYForTimelineProgress(
    { sp: 1, gp: 1 },
    innerHeight,
  );
  let lastWidth = environment.readInnerWidth();
  let state: ScrollGovernorState = createScrollGovernorState(
    environment.readScrollY(),
  );
  let touchActive = false;
  let touchMomentumActive = false;
  let touchMomentumEndTimer: number | null = null;
  let burstActive = false;
  let burstEndTimer: number | null = null;
  let suppressionQuietTimer: number | null = null;
  let expectedReanchorTimer: number | null = null;
  let expectedReanchorY: number | null = null;
  let selfReanchorPending = false;
  let discardedForwardPx = 0;
  let disposed = false;

  const clearBurstEndTimer = () => {
    if (burstEndTimer === null) return;
    environment.clearTimeout(burstEndTimer);
    burstEndTimer = null;
  };

  const clearTouchMomentumEndTimer = () => {
    if (touchMomentumEndTimer === null) return;
    environment.clearTimeout(touchMomentumEndTimer);
    touchMomentumEndTimer = null;
  };

  const clearSuppressionQuietTimer = () => {
    if (suppressionQuietTimer === null) return;
    environment.clearTimeout(suppressionQuietTimer);
    suppressionQuietTimer = null;
  };

  const clearExpectedReanchor = () => {
    if (expectedReanchorTimer !== null) {
      environment.clearTimeout(expectedReanchorTimer);
      expectedReanchorTimer = null;
    }
    expectedReanchorY = null;
  };

  const publish = (
    progress: TimelineProgress,
    addedDiscardedForwardPx = 0,
  ) => {
    if (disposed) return;
    discardedForwardPx += Math.max(addedDiscardedForwardPx, 0);
    onPublish({
      rawY: environment.readScrollY(),
      virtualY: state.virtualY,
      sp: progress.sp,
      gp: progress.gp,
      clipT: videoTimeForY(state.virtualY, innerHeight),
      gestureActive: state.gestureActive,
      gestureLocksGallery: state.gestureLocksGallery,
      discardedForwardPx,
    });
  };

  const publishStep = (step: ScrollGovernorStep) => {
    state = step.state;
    publish(step.progress, step.discardedForwardPx);
  };

  const publishState = () => {
    publish(timelineProgressForY(state.virtualY, innerHeight));
  };

  const setExpectedReanchor = (targetY: number) => {
    clearExpectedReanchor();
    expectedReanchorY = targetY;
    expectedReanchorTimer = environment.setTimeout(() => {
      expectedReanchorTimer = null;
      expectedReanchorY = null;
    }, REANCHOR_GUARD_MS);
  };

  const reanchor = (guardExpectedEvent = true) => {
    const targetY = Math.min(
      Math.max(state.virtualY, 0),
      safeDocumentEnd(environment),
    );
    state = syncRawScrollPosition(state, targetY);
    publishState();

    if (
      Math.abs(environment.readScrollY() - targetY) <=
      REANCHOR_TOLERANCE_PX
    ) {
      clearExpectedReanchor();
      return;
    }

    selfReanchorPending = true;
    if (guardExpectedEvent) setExpectedReanchor(targetY);
    else clearExpectedReanchor();
    environment.scrollTo({ top: targetY, behavior: "auto" });
  };

  const releaseSuppression = () => {
    clearSuppressionQuietTimer();
    if (!state.suppressForward) return;

    if (
      Math.abs(state.lastRawY - state.virtualY) >
        REANCHOR_TOLERANCE_PX ||
      Math.abs(environment.readScrollY() - state.virtualY) >
        REANCHOR_TOLERANCE_PX
    ) {
      reanchor();
    }
    state = releaseScrollSuppression(state);
    selfReanchorPending = false;
    publishState();
  };

  const armSuppressionQuiet = () => {
    clearSuppressionQuietTimer();
    if (!state.suppressForward) return;
    suppressionQuietTimer = environment.setTimeout(() => {
      suppressionQuietTimer = null;
      releaseSuppression();
    }, INPUT_QUIET_MS);
  };

  const finishReducedMotionLifecycle = () => {
    clearTouchMomentumEndTimer();
    clearBurstEndTimer();
    clearSuppressionQuietTimer();
    clearExpectedReanchor();
    touchActive = false;
    touchMomentumActive = false;
    burstActive = false;
    selfReanchorPending = false;
    discardedForwardPx = 0;
    publishStep(
      applyScrollSample(state, {
        rawY: environment.readScrollY(),
        innerHeight,
        maxScrollY: safeDocumentEnd(environment),
        maxVirtualY: logicalMaxY,
        reducedMotion: true,
        bypass: true,
      }),
    );
  };

  const finishGesture = () => {
    if (reducedMotion()) {
      finishReducedMotionLifecycle();
      return;
    }

    const step = endScrollGesture(state, innerHeight);
    state = step.state;
    publish(step.progress, step.discardedForwardPx);
    if (step.needsReanchor) reanchor();
    armSuppressionQuiet();
  };

  const finishGestureIfIdle = () => {
    if (
      touchActive ||
      touchMomentumActive ||
      burstActive ||
      !state.gestureActive
    ) {
      return;
    }
    finishGesture();
  };

  const endTouchMomentumAfterQuiet = () => {
    clearTouchMomentumEndTimer();
    touchMomentumEndTimer = environment.setTimeout(() => {
      touchMomentumEndTimer = null;
      touchMomentumActive = false;
      finishGestureIfIdle();
    }, INPUT_QUIET_MS);
  };

  const beginExplicitGesture = () => {
    if (state.gestureActive) return;
    clearSuppressionQuietTimer();
    clearExpectedReanchor();
    selfReanchorPending = false;
    discardedForwardPx = 0;
    state = beginScrollGesture(state);
    publishState();
  };

  const onScroll: ScrollTimelineEventListener = () => {
    const rawY = environment.readScrollY();
    if (reducedMotion()) {
      finishReducedMotionLifecycle();
      return;
    }
    if (expectedReanchorY !== null) {
      const expectedY = expectedReanchorY;
      clearExpectedReanchor();
      if (Math.abs(rawY - expectedY) <= REANCHOR_TOLERANCE_PX) {
        state = syncRawScrollPosition(state, rawY);
        publishState();
        return;
      }
    }

    const hasExplicitAttribution =
      touchActive || touchMomentumActive || burstActive;
    if (
      hasExplicitAttribution &&
      !state.gestureActive &&
      !reducedMotion()
    ) {
      beginExplicitGesture();
    }

    const bypass = !hasExplicitAttribution && !state.suppressForward;
    const step = applyScrollSample(state, {
      rawY,
      innerHeight,
      maxScrollY: safeDocumentEnd(environment),
      maxVirtualY: logicalMaxY,
      reducedMotion: reducedMotion(),
      bypass,
      preserveVirtualOffset: true,
    });
    publishStep(step);

    if (touchMomentumActive) endTouchMomentumAfterQuiet();
    if (!state.suppressForward) return;
    armSuppressionQuiet();
    if (step.needsReanchor) reanchor();
  };

  const onTouchStart: ScrollTimelineEventListener = (event) => {
    if (touchCount(event) <= 0 || touchActive) return;

    if (touchMomentumActive) {
      clearTouchMomentumEndTimer();
      touchMomentumActive = false;
      if (state.gestureActive) finishGesture();
      clearSuppressionQuietTimer();
      clearExpectedReanchor();
      selfReanchorPending = false;
    }

    touchActive = true;
    beginExplicitGesture();
  };

  const onTouchEnd: ScrollTimelineEventListener = (event) => {
    if (!touchActive) return;
    if (touchCount(event) > 0) return;
    touchActive = false;
    if (reducedMotion()) {
      finishReducedMotionLifecycle();
      return;
    }
    touchMomentumActive = true;
    endTouchMomentumAfterQuiet();
  };

  const endBurstAfterQuiet = () => {
    clearBurstEndTimer();
    burstEndTimer = environment.setTimeout(() => {
      burstEndTimer = null;
      burstActive = false;
      finishGestureIfIdle();
    }, INPUT_QUIET_MS);
  };

  const onWheel: ScrollTimelineEventListener = () => {
    burstActive = true;
    beginExplicitGesture();
    endBurstAfterQuiet();
  };

  const onKeyDown: ScrollTimelineEventListener = (event) => {
    if (!isScrollingKey(event)) return;
    burstActive = true;
    beginExplicitGesture();
    endBurstAfterQuiet();
  };

  const onScrollEnd: ScrollTimelineEventListener = () => {
    if (!state.suppressForward) {
      selfReanchorPending = false;
      return;
    }
    // scrollend can be emitted by our own auto scrollTo. Whether self-authored
    // or native, it is only evidence for a new quiet window—not permission to
    // release synchronously while residual momentum can still arrive.
    if (selfReanchorPending) {
      selfReanchorPending = false;
      armSuppressionQuiet();
      return;
    }
    armSuppressionQuiet();
  };

  const resetInterruptedGesture = () => {
    if (reducedMotion()) {
      finishReducedMotionLifecycle();
      return;
    }

    clearTouchMomentumEndTimer();
    clearBurstEndTimer();
    clearSuppressionQuietTimer();
    clearExpectedReanchor();
    touchActive = false;
    touchMomentumActive = false;
    burstActive = false;
    selfReanchorPending = false;

    const step = endScrollGesture(state, innerHeight);
    publishStep(step);
    if (
      step.needsReanchor ||
      Math.abs(environment.readScrollY() - state.virtualY) >
        REANCHOR_TOLERANCE_PX
    ) {
      reanchor(false);
    }
    if (state.suppressForward) {
      state = releaseScrollSuppression(state);
      publishState();
    }
    clearSuppressionQuietTimer();
    clearExpectedReanchor();
    selfReanchorPending = false;
  };

  const onVisibilityChange: ScrollTimelineEventListener = () => {
    if (environment.readVisibilityState() === "hidden") {
      resetInterruptedGesture();
    }
  };

  const onResize: ScrollTimelineEventListener = () => {
    const currentWidth = environment.readInnerWidth();
    if (currentWidth === lastWidth) {
      state = syncRawScrollPosition(state, environment.readScrollY());
      publishState();
      return;
    }
    lastWidth = currentWidth;
    innerHeight = validViewportHeight(
      environment.readInnerHeight(),
      innerHeight,
    );
    logicalMaxY = scrollYForTimelineProgress(
      { sp: 1, gp: 1 },
      innerHeight,
    );
    clearTouchMomentumEndTimer();
    clearBurstEndTimer();
    clearSuppressionQuietTimer();
    clearExpectedReanchor();
    touchActive = false;
    touchMomentumActive = false;
    burstActive = false;
    selfReanchorPending = false;
    discardedForwardPx = 0;

    publishStep(
      applyScrollSample(state, {
        rawY: environment.readScrollY(),
        innerHeight,
        maxScrollY: safeDocumentEnd(environment),
        maxVirtualY: logicalMaxY,
        reducedMotion: reducedMotion(),
        bypass: true,
      }),
    );
  };

  publishStep(
    applyScrollSample(state, {
      rawY: environment.readScrollY(),
      innerHeight,
      maxScrollY: safeDocumentEnd(environment),
      maxVirtualY: logicalMaxY,
      reducedMotion: reducedMotion(),
      bypass: true,
    }),
  );

  environment.windowTarget.addEventListener(
    "scroll",
    onScroll,
    PASSIVE_EVENT_OPTIONS,
  );
  environment.windowTarget.addEventListener(
    "touchstart",
    onTouchStart,
    PASSIVE_EVENT_OPTIONS,
  );
  environment.windowTarget.addEventListener(
    "touchend",
    onTouchEnd,
    PASSIVE_EVENT_OPTIONS,
  );
  environment.windowTarget.addEventListener(
    "touchcancel",
    onTouchEnd,
    PASSIVE_EVENT_OPTIONS,
  );
  environment.windowTarget.addEventListener(
    "wheel",
    onWheel,
    PASSIVE_EVENT_OPTIONS,
  );
  environment.windowTarget.addEventListener("keydown", onKeyDown);
  environment.windowTarget.addEventListener("scrollend", onScrollEnd);
  environment.windowTarget.addEventListener("resize", onResize);
  environment.windowTarget.addEventListener("blur", resetInterruptedGesture);
  environment.documentTarget.addEventListener(
    "visibilitychange",
    onVisibilityChange,
  );

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTouchMomentumEndTimer();
      clearBurstEndTimer();
      clearSuppressionQuietTimer();
      clearExpectedReanchor();
      touchActive = false;
      touchMomentumActive = false;
      burstActive = false;
      selfReanchorPending = false;
      environment.windowTarget.removeEventListener(
        "scroll",
        onScroll,
        PASSIVE_EVENT_OPTIONS,
      );
      environment.windowTarget.removeEventListener(
        "touchstart",
        onTouchStart,
        PASSIVE_EVENT_OPTIONS,
      );
      environment.windowTarget.removeEventListener(
        "touchend",
        onTouchEnd,
        PASSIVE_EVENT_OPTIONS,
      );
      environment.windowTarget.removeEventListener(
        "touchcancel",
        onTouchEnd,
        PASSIVE_EVENT_OPTIONS,
      );
      environment.windowTarget.removeEventListener(
        "wheel",
        onWheel,
        PASSIVE_EVENT_OPTIONS,
      );
      environment.windowTarget.removeEventListener("keydown", onKeyDown);
      environment.windowTarget.removeEventListener("scrollend", onScrollEnd);
      environment.windowTarget.removeEventListener("resize", onResize);
      environment.windowTarget.removeEventListener(
        "blur",
        resetInterruptedGesture,
      );
      environment.documentTarget.removeEventListener(
        "visibilitychange",
        onVisibilityChange,
      );
    },
  };
}
