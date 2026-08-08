import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import {
  applyScrollSample,
  beginScrollGesture,
  createScrollGovernorState,
  endScrollGesture,
  releaseScrollSuppression,
  syncRawScrollPosition,
  timelineProgressForY,
  videoTimeForY,
} from "../scrollGovernor";
import type {
  ScrollGovernorState,
  ScrollGovernorStep,
  TimelineProgress,
} from "../scrollGovernor";

const INPUT_QUIET_MS = 120;
const REANCHOR_TOLERANCE_PX = 1;
const REANCHOR_GUARD_MS = 80;

export interface ScrollTimelineRefs {
  scrollRef: MutableRefObject<number>;
  galleryRef: MutableRefObject<number>;
  virtualYRef: MutableRefObject<number>;
}

interface ScrollGovernorDiagnostic {
  rawY: number;
  virtualY: number;
  sp: number;
  gp: number;
  clipT: number;
  gestureActive: boolean;
  gestureLocksGallery: boolean;
  discardedForwardPx: number;
}

declare global {
  interface Window {
    __sg?: ScrollGovernorDiagnostic;
  }
}

function validViewportHeight(value: number, fallback = 1): number {
  if (Number.isFinite(value) && value > 0) return value;
  if (Number.isFinite(fallback) && fallback > 0) return fallback;
  return 1;
}

function documentScrollEnd(): number {
  const root = document.documentElement;
  const body = document.body;
  const scrollHeight = Math.max(
    root.scrollHeight,
    root.offsetHeight,
    root.clientHeight,
    body?.scrollHeight ?? 0,
    body?.offsetHeight ?? 0,
    body?.clientHeight ?? 0,
  );
  const viewportHeight = validViewportHeight(
    window.innerHeight,
    root.clientHeight,
  );
  const end = scrollHeight - viewportHeight;
  return Number.isFinite(end) ? Math.max(end, 0) : 0;
}

function eventTime(): number {
  const now = window.performance?.now();
  return Number.isFinite(now) ? now : Date.now();
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return Boolean(
    target.closest(
      'input, textarea, select, [contenteditable=""], [contenteditable="true"]',
    ),
  );
}

function isScrollingKey(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
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
  ].includes(event.key);
}

export function useScrollTimelineRefs(
  reducedMotion: boolean,
): ScrollTimelineRefs {
  const scrollRef = useRef(0);
  const galleryRef = useRef(0);
  const virtualYRef = useRef(0);

  useEffect(() => {
    // Both timelines share this one stable viewport measurement. Mobile browser
    // chrome can change innerHeight while scrolling; only a width/orientation
    // change is allowed to replace it, keeping the sp→gp seam continuous.
    let innerHeight = validViewportHeight(
      window.innerHeight,
      document.documentElement.clientHeight,
    );
    let lastWidth = window.innerWidth;
    let state: ScrollGovernorState = createScrollGovernorState(window.scrollY);
    let touchActive = false;
    let burstActive = false;
    let burstEndTimer: number | null = null;
    let suppressionQuietTimer: number | null = null;
    let expectedReanchorTimer: number | null = null;
    let expectedReanchorY: number | null = null;
    let discardedForwardPx = 0;
    let diagnostic: ScrollGovernorDiagnostic | undefined;

    const clearBurstEndTimer = () => {
      if (burstEndTimer === null) return;
      window.clearTimeout(burstEndTimer);
      burstEndTimer = null;
    };

    const clearSuppressionQuietTimer = () => {
      if (suppressionQuietTimer === null) return;
      window.clearTimeout(suppressionQuietTimer);
      suppressionQuietTimer = null;
    };

    const clearExpectedReanchor = () => {
      if (expectedReanchorTimer !== null) {
        window.clearTimeout(expectedReanchorTimer);
        expectedReanchorTimer = null;
      }
      expectedReanchorY = null;
    };

    const publish = (
      progress: TimelineProgress,
      addedDiscardedForwardPx = 0,
    ) => {
      discardedForwardPx += Math.max(addedDiscardedForwardPx, 0);
      scrollRef.current = progress.sp;
      galleryRef.current = progress.gp;
      virtualYRef.current = state.virtualY;

      if (import.meta.env.DEV) {
        diagnostic = {
          rawY: window.scrollY,
          virtualY: state.virtualY,
          sp: progress.sp,
          gp: progress.gp,
          clipT: videoTimeForY(state.virtualY, innerHeight),
          gestureActive: state.gestureActive,
          gestureLocksGallery: state.gestureLocksGallery,
          discardedForwardPx,
        };
        window.__sg = diagnostic;
      }
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
      expectedReanchorTimer = window.setTimeout(() => {
        expectedReanchorTimer = null;
        expectedReanchorY = null;
      }, REANCHOR_GUARD_MS);
    };

    // Raw bookkeeping is synchronized before scrollTo. The following scroll
    // event is ignored only when it actually arrives at this expected target;
    // an unrelated event is never consumed by a blind one-shot guard.
    const reanchor = (guardExpectedEvent = true) => {
      const targetY = Math.min(
        Math.max(state.virtualY, 0),
        documentScrollEnd(),
      );
      state = syncRawScrollPosition(state, targetY);
      publishState();

      if (Math.abs(window.scrollY - targetY) <= REANCHOR_TOLERANCE_PX) {
        clearExpectedReanchor();
        return;
      }

      if (guardExpectedEvent) setExpectedReanchor(targetY);
      else clearExpectedReanchor();
      window.scrollTo({ top: targetY, behavior: "auto" });
    };

    const releaseSuppression = () => {
      clearSuppressionQuietTimer();
      if (!state.suppressForward) return;

      if (
        Math.abs(state.lastRawY - state.virtualY) >
          REANCHOR_TOLERANCE_PX ||
        Math.abs(window.scrollY - state.virtualY) > REANCHOR_TOLERANCE_PX
      ) {
        reanchor();
      }
      state = releaseScrollSuppression(state);
      publishState();
    };

    const armSuppressionQuiet = () => {
      clearSuppressionQuietTimer();
      if (!state.suppressForward) return;
      suppressionQuietTimer = window.setTimeout(() => {
        suppressionQuietTimer = null;
        releaseSuppression();
      }, INPUT_QUIET_MS);
    };

    const finishGesture = () => {
      clearBurstEndTimer();
      burstActive = false;
      const step = endScrollGesture(state, innerHeight);
      publishStep(step);
      if (step.needsReanchor) reanchor();
      armSuppressionQuiet();
    };

    const beginExplicitGesture = () => {
      if (state.gestureActive) return;
      discardedForwardPx = 0;
      state = beginScrollGesture(state, eventTime());
      publishState();
    };

    const onScroll = () => {
      const rawY = window.scrollY;
      if (expectedReanchorY !== null) {
        const expectedY = expectedReanchorY;
        clearExpectedReanchor();
        if (Math.abs(rawY - expectedY) <= REANCHOR_TOLERANCE_PX) {
          state = syncRawScrollPosition(state, rawY);
          publishState();
          return;
        }
      }

      const hasExplicitAttribution = touchActive || burstActive;
      if (
        hasExplicitAttribution &&
        !state.gestureActive &&
        !reducedMotion
      ) {
        beginExplicitGesture();
      }

      // A direct scrollTo used by verification (or any other programmatic
      // navigation) remains exact. Positive movement after a governed end is
      // never allowed through this bypass while suppression is active.
      const bypass = !hasExplicitAttribution && !state.suppressForward;
      const step = applyScrollSample(state, {
        rawY,
        nowMs: eventTime(),
        innerHeight,
        maxScrollY: documentScrollEnd(),
        reducedMotion,
        bypass,
      });
      publishStep(step);

      if (!state.suppressForward) return;
      armSuppressionQuiet();
      if (step.needsReanchor) reanchor();
    };

    const onTouchStart = (event: TouchEvent) => {
      touchActive = event.touches.length > 0;
      if (touchActive) beginExplicitGesture();
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length > 0) return;
      touchActive = false;
      // A finger lift is the exact visual stop point. Do not wait for a generic
      // scroll debounce before ending and reconciling the governed cursor.
      finishGesture();
    };

    const endBurstAfterQuiet = () => {
      clearBurstEndTimer();
      burstEndTimer = window.setTimeout(() => {
        burstEndTimer = null;
        burstActive = false;
        if (!touchActive) finishGesture();
      }, INPUT_QUIET_MS);
    };

    const onWheel = () => {
      burstActive = true;
      beginExplicitGesture();
      endBurstAfterQuiet();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isScrollingKey(event)) return;
      burstActive = true;
      beginExplicitGesture();
      endBurstAfterQuiet();
    };

    const onScrollEnd = () => {
      if (state.suppressForward) releaseSuppression();
    };

    const resetInterruptedGesture = () => {
      clearBurstEndTimer();
      clearSuppressionQuietTimer();
      clearExpectedReanchor();
      touchActive = false;
      burstActive = false;

      const step = endScrollGesture(state, innerHeight);
      publishStep(step);
      if (
        step.needsReanchor ||
        Math.abs(window.scrollY - state.virtualY) > REANCHOR_TOLERANCE_PX
      ) {
        reanchor(false);
      }
      if (state.suppressForward) {
        state = releaseScrollSuppression(state);
        publishState();
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") resetInterruptedGesture();
    };

    const onResize = () => {
      if (window.innerWidth === lastWidth) return;
      lastWidth = window.innerWidth;
      innerHeight = validViewportHeight(window.innerHeight, innerHeight);
      clearBurstEndTimer();
      clearSuppressionQuietTimer();
      clearExpectedReanchor();
      touchActive = false;
      burstActive = false;
      discardedForwardPx = 0;

      publishStep(
        applyScrollSample(state, {
          rawY: window.scrollY,
          nowMs: eventTime(),
          innerHeight,
          maxScrollY: documentScrollEnd(),
          reducedMotion,
          bypass: true,
        }),
      );
    };

    // Initial state goes through the same reducer path as programmatic jumps,
    // ensuring physical bounds and both timeline refs are synchronized at once.
    publishStep(
      applyScrollSample(state, {
        rawY: window.scrollY,
        nowMs: eventTime(),
        innerHeight,
        maxScrollY: documentScrollEnd(),
        reducedMotion,
        bypass: true,
      }),
    );

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scrollend", onScrollEnd);
    window.addEventListener("resize", onResize);
    window.addEventListener("blur", resetInterruptedGesture);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearBurstEndTimer();
      clearSuppressionQuietTimer();
      clearExpectedReanchor();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scrollend", onScrollEnd);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("blur", resetInterruptedGesture);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (window.__sg === diagnostic) delete window.__sg;
    };
  }, [reducedMotion]);

  return { scrollRef, galleryRef, virtualYRef };
}
