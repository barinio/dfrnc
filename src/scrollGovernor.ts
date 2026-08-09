import {
  IMAGE_GALLERY_TRACK_VH,
  SCROLL_TRACK_VH,
  VIDEO_CARD_TRACK_VH,
  VID_FLY_END,
} from "./constants";
import { galleryProgressFrom } from "./gallery";
import { videoMasterTimeFor, videoTimelinePositionFor } from "./playback";

export interface TimelineProgress {
  sp: number;
  gp: number;
}

export interface ScrollGovernorState {
  virtualY: number;
  lastRawY: number;
  gestureActive: boolean;
  gestureLocksGallery: boolean;
  suppressForward: boolean;
}

export interface ScrollSample {
  rawY: number;
  innerHeight: number;
  // Physical browser scroll bound. Raw bookkeeping is clamped here.
  maxScrollY: number;
  // Stable logical timeline bound. Defaults to maxScrollY for backward
  // compatibility, but may differ while mobile browser chrome changes height.
  maxVirtualY?: number;
  reducedMotion?: boolean;
  bypass?: boolean;
  // Programmatic scroll with a physical/logical coordinate offset should apply
  // the raw delta to virtualY instead of snapping virtualY to the raw coordinate.
  preserveVirtualOffset?: boolean;
}

export interface ScrollGovernorStep {
  state: ScrollGovernorState;
  progress: TimelineProgress;
  discardedForwardPx: number;
  needsReanchor: boolean;
}

function validHeight(innerHeight: number): boolean {
  return Number.isFinite(innerHeight) && innerHeight > 0;
}

function clampProgress(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}

function physicalTracks(innerHeight: number) {
  return {
    animY: ((SCROLL_TRACK_VH - 100) / 100) * innerHeight,
    videoCardPx: (VIDEO_CARD_TRACK_VH / 100) * innerHeight,
    imagePx: (IMAGE_GALLERY_TRACK_VH / 100) * innerHeight,
  };
}

export function animationEndY(innerHeight: number): number {
  if (!validHeight(innerHeight)) return 0;
  return physicalTracks(innerHeight).animY;
}

// Canonical physical scroll position → both logical timelines. Gallery
// conversion deliberately delegates to galleryProgressFrom so its piecewise
// video-card/image cadence remains a single source of truth.
export function timelineProgressForY(
  y: number,
  innerHeight: number,
): TimelineProgress {
  if (!validHeight(innerHeight)) return { sp: 0, gp: 0 };

  const { animY, videoCardPx, imagePx } = physicalTracks(innerHeight);
  const maxY = animY + videoCardPx + imagePx;
  const scrollY = Number.isNaN(y) ? 0 : Math.min(Math.max(y, 0), maxY);
  const sp = animY > 0 ? clampProgress(scrollY / animY) : 0;

  return { sp, gp: galleryProgressFrom(scrollY, innerHeight) };
}

// Inverse timeline mapping. Animation progress owns positions while sp < 1;
// once sp is complete, gp selects the short video-card track and then the image
// track. This gives the ambiguous seam one stable representation: sp=1,gp=0.
export function scrollYForTimelineProgress(
  value: TimelineProgress,
  innerHeight: number,
): number {
  if (!validHeight(innerHeight)) return 0;

  const { animY, videoCardPx, imagePx } = physicalTracks(innerHeight);
  const sp = clampProgress(value.sp);
  const gp = clampProgress(value.gp);

  if (sp < 1) return sp * animY;
  if (gp <= VID_FLY_END) {
    return animY + (gp / VID_FLY_END) * videoCardPx;
  }
  return (
    animY +
    videoCardPx +
    ((gp - VID_FLY_END) / (1 - VID_FLY_END)) * imagePx
  );
}

export function videoTimeForY(y: number, innerHeight: number): number {
  const { sp, gp } = timelineProgressForY(y, innerHeight);
  return videoMasterTimeFor(sp, gp, "scroll");
}

export function scrollYForVideoTime(t: number, innerHeight: number): number {
  return scrollYForTimelineProgress(videoTimelinePositionFor(t), innerHeight);
}

export function videoGovernorBounds(innerHeight: number): {
  startY: number;
  endY: number;
} {
  if (!validHeight(innerHeight)) return { startY: 0, endY: 0 };
  return {
    startY: scrollYForVideoTime(0, innerHeight),
    endY: scrollYForVideoTime(1, innerHeight),
  };
}

function finiteNonNegative(value: number, fallback = 0): number {
  return Number.isFinite(value) ? Math.max(value, 0) : Math.max(fallback, 0);
}

function validDocumentEnd(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function clampDocumentY(value: number, maxScrollY: number, fallback = 0): number {
  if (value === Number.POSITIVE_INFINITY) return maxScrollY;
  if (value === Number.NEGATIVE_INFINITY) return 0;
  const safeValue = Number.isFinite(value) ? value : fallback;
  return Math.min(Math.max(safeValue, 0), maxScrollY);
}

function normalizedState(
  state: ScrollGovernorState,
  maxScrollY?: number,
  maxVirtualY?: number,
): ScrollGovernorState {
  const hasDocumentEnd = maxScrollY !== undefined;
  const documentEnd = hasDocumentEnd ? validDocumentEnd(maxScrollY) : 0;
  const virtualEnd =
    maxVirtualY !== undefined
      ? validDocumentEnd(maxVirtualY)
      : documentEnd;
  const virtualY = hasDocumentEnd
    ? clampDocumentY(state.virtualY, virtualEnd)
    : finiteNonNegative(state.virtualY);
  const lastRawY = hasDocumentEnd
    ? clampDocumentY(state.lastRawY, documentEnd, virtualY)
    : finiteNonNegative(state.lastRawY, virtualY);

  return {
    virtualY,
    lastRawY,
    gestureActive: Boolean(state.gestureActive),
    gestureLocksGallery: Boolean(state.gestureLocksGallery),
    suppressForward: Boolean(state.suppressForward),
  };
}

function stepFor(
  state: ScrollGovernorState,
  innerHeight: number,
  discardedForwardPx = 0,
): ScrollGovernorStep {
  return {
    state,
    progress: timelineProgressForY(state.virtualY, innerHeight),
    discardedForwardPx: finiteNonNegative(discardedForwardPx),
    needsReanchor: state.lastRawY !== state.virtualY,
  };
}

export function createScrollGovernorState(rawY = 0): ScrollGovernorState {
  const initialY = finiteNonNegative(rawY);
  return {
    virtualY: initialY,
    lastRawY: initialY,
    gestureActive: false,
    gestureLocksGallery: false,
    suppressForward: false,
  };
}

export function beginScrollGesture(state: ScrollGovernorState): ScrollGovernorState {
  const current = normalizedState(state);
  if (current.gestureActive) return current;

  return {
    ...current,
    gestureActive: true,
    gestureLocksGallery: false,
    // A newly identified input gesture is intentional user motion, not the
    // positive inertial residue left behind by the previous gesture.
    suppressForward: false,
  };
}

export function applyScrollSample(
  state: ScrollGovernorState,
  sample: ScrollSample,
): ScrollGovernorStep {
  const maxScrollY = validDocumentEnd(sample.maxScrollY);
  const maxVirtualY =
    sample.maxVirtualY === undefined
      ? maxScrollY
      : validDocumentEnd(sample.maxVirtualY);
  const current = normalizedState(state, maxScrollY, maxVirtualY);
  const rawY = clampDocumentY(sample.rawY, maxScrollY, current.lastRawY);
  const rawDelta = rawY - current.lastRawY;

  if (sample.bypass || sample.reducedMotion) {
    const virtualY =
      sample.bypass &&
      !sample.reducedMotion &&
      sample.preserveVirtualOffset
        ? clampDocumentY(
            current.virtualY + rawDelta,
            maxVirtualY,
            current.virtualY,
          )
        : clampDocumentY(rawY, maxVirtualY, current.virtualY);
    const synchronized: ScrollGovernorState = {
      ...current,
      virtualY,
      lastRawY: rawY,
      gestureActive: false,
      gestureLocksGallery: false,
      suppressForward: false,
    };
    return stepFor(synchronized, sample.innerHeight);
  }

  if (!validHeight(sample.innerHeight)) {
    return stepFor(
      {
        ...current,
        lastRawY: rawY,
      },
      sample.innerHeight,
      Math.max(rawDelta, 0),
    );
  }

  if (rawDelta === 0) {
    return stepFor({ ...current, lastRawY: rawY }, sample.innerHeight);
  }

  if (rawDelta < 0) {
    const virtualY = clampDocumentY(
      current.virtualY + rawDelta,
      maxVirtualY,
      current.virtualY,
    );
    return stepFor(
      {
        ...current,
        virtualY,
        lastRawY: rawY,
      },
      sample.innerHeight,
    );
  }

  if (current.suppressForward) {
    return stepFor(
      { ...current, lastRawY: rawY },
      sample.innerHeight,
      rawDelta,
    );
  }

  const requestedY = clampDocumentY(
    current.virtualY + rawDelta,
    maxVirtualY,
    current.virtualY,
  );
  const bounds = videoGovernorBounds(sample.innerHeight);
  const hasGovernor =
    validHeight(sample.innerHeight) && bounds.endY > bounds.startY;
  const intersectsVideo =
    hasGovernor &&
    current.virtualY < bounds.endY &&
    requestedY > bounds.startY;
  const gestureLocksGallery =
    current.gestureLocksGallery ||
    (current.gestureActive && intersectsVideo);

  let virtualY = requestedY;
  if (hasGovernor && current.gestureActive && gestureLocksGallery) {
    virtualY = Math.min(virtualY, bounds.endY);
  }

  virtualY = clampDocumentY(virtualY, maxVirtualY, current.virtualY);
  const appliedForwardPx = Math.max(virtualY - current.virtualY, 0);
  const discardedForwardPx = Math.max(rawDelta - appliedForwardPx, 0);

  return stepFor(
    {
      ...current,
      virtualY,
      lastRawY: rawY,
      gestureLocksGallery,
    },
    sample.innerHeight,
    discardedForwardPx,
  );
}

export function endScrollGesture(
  state: ScrollGovernorState,
  innerHeight: number,
): ScrollGovernorStep {
  const current = normalizedState(state);
  const needsReanchor = current.lastRawY !== current.virtualY;
  const bounds = videoGovernorBounds(innerHeight);
  const atLockedBoundary =
    current.gestureLocksGallery &&
    validHeight(innerHeight) &&
    bounds.endY > bounds.startY &&
    current.virtualY >= bounds.endY;
  const ended: ScrollGovernorState = {
    ...current,
    gestureActive: false,
    suppressForward:
      current.suppressForward || needsReanchor || atLockedBoundary,
  };
  return stepFor(ended, innerHeight);
}

export function releaseScrollSuppression(
  state: ScrollGovernorState,
): ScrollGovernorState {
  return { ...normalizedState(state), suppressForward: false };
}

export function syncRawScrollPosition(
  state: ScrollGovernorState,
  rawY: number,
): ScrollGovernorState {
  const current = normalizedState(state);
  return {
    ...current,
    lastRawY: finiteNonNegative(rawY, current.lastRawY),
  };
}
