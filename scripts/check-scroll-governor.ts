// Pure-function checks for the canonical physical scroll/video timeline.
// Run manually with: npx tsx scripts/check-scroll-governor.ts
import {
  IMAGE_GALLERY_TRACK_VH,
  SCROLL_TRACK_VH,
  VIDEO_CARD_TRACK_VH,
  VIDEO_DURATION_S,
  VIDEO_SPLIT,
  VIDEO_START,
  VID_FLY_END,
} from "../src/constants";
import {
  VIDEO_TIME_KNOTS,
  videoMasterTimeFor,
  videoTimelinePositionFor,
} from "../src/playback";
import {
  applyScrollSample,
  animationEndY,
  beginScrollGesture,
  createScrollGovernorState,
  endScrollGesture,
  releaseScrollSuppression,
  scrollYForTimelineProgress,
  scrollYForVideoTime,
  syncRawScrollPosition,
  timelineProgressForY,
  videoGovernorBounds,
  videoTimeForY,
} from "../src/scrollGovernor";

function eq(actual: unknown, expected: unknown, label: string, eps = 1e-9) {
  if (typeof actual !== "number" || !Number.isFinite(actual)) {
    throw new Error(
      `${label}: actual value must be a finite number, got ${String(actual)}`,
    );
  }
  if (typeof expected !== "number" || !Number.isFinite(expected)) {
    throw new Error(
      `${label}: expected value must be a finite number, got ${String(expected)}`,
    );
  }
  if (Math.abs(actual - expected) > eps) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function ok(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(label);
}

function eqProgress(
  actual: { sp: number; gp: number },
  expected: { sp: number; gp: number },
  label: string,
  eps = 1e-9,
) {
  eq(actual.sp, expected.sp, `${label} sp`, eps);
  eq(actual.gp, expected.gp, `${label} gp`, eps);
}

const IH = 844;
const animY = ((SCROLL_TRACK_VH - 100) / 100) * IH;
const videoCardPx = (VIDEO_CARD_TRACK_VH / 100) * IH;
const imagePx = (IMAGE_GALLERY_TRACK_VH / 100) * IH;

eq(VIDEO_DURATION_S, 23.56, "authored clip duration");
eq(animationEndY(IH), animY, "animation end uses the canonical vh track");

const authoredKnots: readonly (readonly [number, number])[] = [
  [0, VIDEO_START],
  [0.11, 545.6 / SCROLL_TRACK_VH],
  [0.139, 551.8 / SCROLL_TRACK_VH],
  [0.248, 769.8 / SCROLL_TRACK_VH],
  [0.592, 843.1 / SCROLL_TRACK_VH],
  [0.786, 1228.5 / SCROLL_TRACK_VH],
  [VIDEO_SPLIT, 1],
];

for (const [t, expectedSp] of authoredKnots) {
  const position = videoTimelinePositionFor(t);
  eq(position.sp, expectedSp, `inverse authored knot ${t}: sp`, 1e-12);
  eq(position.gp, 0, `inverse authored knot ${t}: gp`, 1e-12);
}

// Endpoint-only tests would let a nonlinear inverse such as u² survive. Probe
// three independently interpolated interiors of EVERY canonical segment: the
// expected sp below comes from the segment endpoints, not from either mapping
// function, so easing or another nonlinear mutation is guaranteed to fail.
for (let segmentIndex = 1; segmentIndex < VIDEO_TIME_KNOTS.length; segmentIndex++) {
  const [sp0, t0] = VIDEO_TIME_KNOTS[segmentIndex - 1];
  const [sp1, t1] = VIDEO_TIME_KNOTS[segmentIndex];
  for (const u of [0.25, 0.5, 0.75]) {
    const t = t0 + (t1 - t0) * u;
    const expectedSp = sp0 + (sp1 - sp0) * u;
    const position = videoTimelinePositionFor(t);
    const label = `authored segment ${segmentIndex - 1} interior u=${u}`;

    eq(
      position.sp,
      expectedSp,
      `${label}: inverse must remain affine (reject nonlinear easing)`,
      1e-12,
    );
    eq(position.gp, 0, `${label}: remains on the animation track`, 1e-12);
    eq(
      videoMasterTimeFor(position.sp, position.gp, "scroll"),
      t,
      `${label}: forward round-trip`,
      1e-12,
    );
  }
}

const sampleTimes = [
  ...authoredKnots.map(([t]) => t),
  0.92, // FPV gallery tail
  1,
] as const;

for (const t of sampleTimes) {
  const position = videoTimelinePositionFor(t);
  eq(
    videoMasterTimeFor(position.sp, position.gp, "scroll"),
    t,
    `timeline inverse round-trip at t=${t}`,
    1e-8,
  );

  const y = scrollYForVideoTime(t, IH);
  eq(videoTimeForY(y, IH), t, `physical video round-trip at t=${t}`, 1e-8);
  eqProgress(
    timelineProgressForY(y, IH),
    position,
    `physical progress round-trip at t=${t}`,
    1e-8,
  );
}

const splitPosition = videoTimelinePositionFor(VIDEO_SPLIT);
eqProgress(splitPosition, { sp: 1, gp: 0 }, "sp to gp seam");
eq(scrollYForVideoTime(VIDEO_SPLIT, IH), animY, "split lands at animation end");

const galleryTail = videoTimelinePositionFor(0.92);
eq(galleryTail.sp, 1, "gallery tail pins sp");
eq(
  galleryTail.gp,
  ((0.92 - VIDEO_SPLIT) / (1 - VIDEO_SPLIT)) * VID_FLY_END,
  "gallery tail maps linearly through the video-card phase",
);

const clipEnd = videoTimelinePositionFor(1);
eqProgress(clipEnd, { sp: 1, gp: VID_FLY_END }, "clip end position");
eq(
  scrollYForTimelineProgress(clipEnd, IH),
  animY + videoCardPx,
  "clip ends at the video-card/image seam",
);

eqProgress(timelineProgressForY(0, IH), { sp: 0, gp: 0 }, "document start");
eqProgress(timelineProgressForY(animY, IH), { sp: 1, gp: 0 }, "animation seam");
eqProgress(
  timelineProgressForY(animY + videoCardPx, IH),
  { sp: 1, gp: VID_FLY_END },
  "video-card seam",
);
eqProgress(
  timelineProgressForY(animY + videoCardPx + imagePx, IH),
  { sp: 1, gp: 1 },
  "document end",
);

eq(
  scrollYForTimelineProgress({ sp: 0.5, gp: 0.3 }, IH),
  animY * 0.5,
  "animation progress owns the inverse while sp < 1",
);
eq(
  scrollYForTimelineProgress({ sp: 1, gp: VID_FLY_END / 2 }, IH),
  animY + videoCardPx / 2,
  "video-card inverse",
);
eq(
  scrollYForTimelineProgress({ sp: 1, gp: (1 + VID_FLY_END) / 2 }, IH),
  animY + videoCardPx + imagePx / 2,
  "image-track inverse",
);

const bounds = videoGovernorBounds(IH);
eq(bounds.startY, VIDEO_START * animY, "governor starts at clip t=0");
eq(bounds.endY, animY + videoCardPx, "governor ends at clip t=1");
ok(bounds.startY < bounds.endY, "governor bounds are ordered");

// Clamping and invalid input are deterministic and never leak NaN.
eqProgress(
  videoTimelinePositionFor(-1),
  { sp: VIDEO_START, gp: 0 },
  "negative clip time clamps to start",
);
eqProgress(
  videoTimelinePositionFor(Number.NaN),
  { sp: VIDEO_START, gp: 0 },
  "NaN clip time falls back to start",
);
eqProgress(
  videoTimelinePositionFor(Number.POSITIVE_INFINITY),
  { sp: 1, gp: VID_FLY_END },
  "+Infinity clip time clamps to end",
);
eqProgress(
  videoTimelinePositionFor(2),
  { sp: 1, gp: VID_FLY_END },
  "clip time clamps to end",
);

for (const invalidHeight of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
  eq(animationEndY(invalidHeight), 0, `invalid height ${invalidHeight}: animation end`);
  eqProgress(
    timelineProgressForY(500, invalidHeight),
    { sp: 0, gp: 0 },
    `invalid height ${invalidHeight}: forward mapping`,
  );
  eq(
    scrollYForTimelineProgress({ sp: 1, gp: 1 }, invalidHeight),
    0,
    `invalid height ${invalidHeight}: inverse mapping`,
  );
  eq(
    scrollYForVideoTime(0.5, invalidHeight),
    0,
    `invalid height ${invalidHeight}: video inverse`,
  );
  const invalidBounds = videoGovernorBounds(invalidHeight);
  eq(invalidBounds.startY, 0, `invalid height ${invalidHeight}: start bound`);
  eq(invalidBounds.endY, 0, `invalid height ${invalidHeight}: end bound`);
}

eqProgress(
  timelineProgressForY(Number.NaN, IH),
  { sp: 0, gp: 0 },
  "NaN scroll position falls back to document start",
);
eqProgress(
  timelineProgressForY(Number.NEGATIVE_INFINITY, IH),
  { sp: 0, gp: 0 },
  "negative infinite scroll clamps to start",
);
eqProgress(
  timelineProgressForY(Number.POSITIVE_INFINITY, IH),
  { sp: 1, gp: 1 },
  "positive infinite scroll clamps to end",
);
eq(
  scrollYForTimelineProgress({ sp: 1, gp: 2 }, IH),
  animY + videoCardPx + imagePx,
  "inverse progress clamps at document end",
);
eq(videoTimeForY(Number.NaN, IH), 0, "NaN scroll maps to clip start");
eq(
  scrollYForVideoTime(Number.NaN, IH),
  VIDEO_START * animY,
  "NaN clip time maps to the clip start position",
);

const maxScrollY = animY + videoCardPx + imagePx;
const INITIAL_INPUT_QUANTUM_MS = 1000 / 60;

function begunAt(y: number, nowMs = 0) {
  return beginScrollGesture(createScrollGovernorState(y), nowMs);
}

// Establish an active forward direction, then request far more motion than a
// 16ms input interval can legitimately play. Away from the end clamp, the
// source clip advances by exactly those same 16ms.
let state = begunAt(bounds.startY);
let step = applyScrollSample(state, {
  rawY: bounds.startY + 1,
  nowMs: 0,
  innerHeight: IH,
  maxScrollY,
});
const beforeSixteenMsT = videoTimeForY(step.state.virtualY, IH);
step = applyScrollSample(step.state, {
  rawY: bounds.startY + 10_001,
  nowMs: 16,
  innerHeight: IH,
  maxScrollY,
});
const afterSixteenMsT = videoTimeForY(step.state.virtualY, IH);
eq(
  afterSixteenMsT - beforeSixteenMsT,
  16 / (VIDEO_DURATION_S * 1000),
  "forward clip movement matches the active 16ms interval",
  1e-10,
);

// 50ms is the final consecutive-input gap that counts in full. Any larger gap
// is a new burst and receives only one initial frame quantum.
state = begunAt(bounds.startY);
step = applyScrollSample(state, {
  rawY: bounds.startY + 1,
  nowMs: 0,
  innerHeight: IH,
  maxScrollY,
});
let beforeBoundaryT = videoTimeForY(step.state.virtualY, IH);
step = applyScrollSample(step.state, {
  rawY: bounds.startY + 10_001,
  nowMs: 50,
  innerHeight: IH,
  maxScrollY,
});
eq(
  videoTimeForY(step.state.virtualY, IH) - beforeBoundaryT,
  50 / (VIDEO_DURATION_S * 1000),
  "50ms active gap is used exactly",
  1e-10,
);

state = begunAt(bounds.startY);
step = applyScrollSample(state, {
  rawY: bounds.startY + 1,
  nowMs: 0,
  innerHeight: IH,
  maxScrollY,
});
beforeBoundaryT = videoTimeForY(step.state.virtualY, IH);
step = applyScrollSample(step.state, {
  rawY: bounds.startY + 10_001,
  nowMs: 50.001,
  innerHeight: IH,
  maxScrollY,
});
eq(
  videoTimeForY(step.state.virtualY, IH) - beforeBoundaryT,
  INITIAL_INPUT_QUANTUM_MS / (VIDEO_DURATION_S * 1000),
  "gap above 50ms resets to the initial quantum",
  1e-10,
);

// A first forward input gets one frame-sized quantum regardless of how long
// the gesture existed before its first scroll sample.
state = begunAt(bounds.startY, 10);
step = applyScrollSample(state, {
  rawY: maxScrollY,
  nowMs: 5_000,
  innerHeight: IH,
  maxScrollY,
});
eq(
  videoTimeForY(step.state.virtualY, IH),
  INITIAL_INPUT_QUANTUM_MS / (VIDEO_DURATION_S * 1000),
  "first forward sample uses the initial quantum",
  1e-10,
);

// Requests below the allowance are not rescaled or rounded.
state = begunAt(bounds.startY);
const slowRequestedY = bounds.startY + 1;
step = applyScrollSample(state, {
  rawY: slowRequestedY,
  nowMs: 0,
  innerHeight: IH,
  maxScrollY,
});
eq(step.state.virtualY, slowRequestedY, "slow input is preserved exactly", 0);

// Ordinary forward motion wholly before the FPV interval stays one-to-one and
// does not acquire the same-gesture gallery lock.
state = begunAt(bounds.startY - 200);
const preVideoRequestedY = bounds.startY - 100;
step = applyScrollSample(state, {
  rawY: preVideoRequestedY,
  nowMs: 0,
  innerHeight: IH,
  maxScrollY,
});
eq(step.state.virtualY, preVideoRequestedY, "pre-video forward motion is exact", 0);
eq(step.state.lastRawY, preVideoRequestedY, "pre-video raw bookkeeping is exact", 0);
eq(step.discardedForwardPx, 0, "pre-video motion is not speed-limited", 0);
ok(!step.state.gestureLocksGallery, "pre-video motion does not lock the gallery");

// Crossing the start boundary spends no playback budget on the ordinary
// pre-video pixels: they move one-for-one before the clip-time cap begins.
state = begunAt(bounds.startY - 100);
step = applyScrollSample(state, {
  rawY: bounds.startY + 10_000,
  nowMs: 0,
  innerHeight: IH,
  maxScrollY,
});
ok(
  step.state.virtualY - (bounds.startY - 100) >= 100,
  "pre-video segment is preserved before governed motion",
);
eq(
  videoTimeForY(step.state.virtualY, IH),
  INITIAL_INPUT_QUANTUM_MS / (VIDEO_DURATION_S * 1000),
  "segment crossing caps only the in-video portion",
  1e-10,
);

// Idle time is never banked: a long gap resets to one initial quantum.
state = begunAt(bounds.startY);
step = applyScrollSample(state, {
  rawY: bounds.startY + 1,
  nowMs: 100,
  innerHeight: IH,
  maxScrollY,
});
const beforeIdleT = videoTimeForY(step.state.virtualY, IH);
step = applyScrollSample(step.state, {
  rawY: bounds.startY + 10_001,
  nowMs: 2_100,
  innerHeight: IH,
  maxScrollY,
});
eq(
  videoTimeForY(step.state.virtualY, IH) - beforeIdleT,
  INITIAL_INPUT_QUANTUM_MS / (VIDEO_DURATION_S * 1000),
  "idle time is not banked",
  1e-10,
);

// Discarded distance is consumed from raw input and never becomes a target.
const afterDiscardY = step.state.virtualY;
const consumedRawY = step.state.lastRawY;
ok(step.discardedForwardPx > 0, "excess forward distance is reported discarded");
step = applyScrollSample(step.state, {
  rawY: consumedRawY,
  nowMs: 2_116,
  innerHeight: IH,
  maxScrollY,
});
eq(step.state.virtualY, afterDiscardY, "zero delta cannot replay discarded distance", 0);
eq(step.discardedForwardPx, 0, "zero delta discards nothing", 0);

// Reverse motion remains a direct physical delta, even after a capped sample.
state = begunAt(bounds.startY + 4_000);
step = applyScrollSample(state, {
  rawY: bounds.startY + 2_000,
  nowMs: 10,
  innerHeight: IH,
  maxScrollY,
});
eq(
  step.state.virtualY,
  bounds.startY + 2_000,
  "reverse 2000px remains immediate and exact",
  0,
);

// Changing direction resets the forward budget instead of inheriting elapsed
// time from the earlier forward run.
state = begunAt(bounds.startY);
step = applyScrollSample(state, {
  rawY: bounds.startY + 10_000,
  nowMs: 0,
  innerHeight: IH,
  maxScrollY,
});
step = applyScrollSample(step.state, {
  rawY: step.state.lastRawY - 1,
  nowMs: 10,
  innerHeight: IH,
  maxScrollY,
});
const beforeDirectionResetT = videoTimeForY(step.state.virtualY, IH);
step = applyScrollSample(step.state, {
  rawY: step.state.lastRawY + 10_000,
  nowMs: 49,
  innerHeight: IH,
  maxScrollY,
});
eq(
  videoTimeForY(step.state.virtualY, IH) - beforeDirectionResetT,
  INITIAL_INPUT_QUANTUM_MS / (VIDEO_DURATION_S * 1000),
  "direction change resets to the initial quantum",
  1e-10,
);

// Repeated reverse/forward changes cannot mint a fresh frame quantum on every
// alternation. Start next to an authored knot so this also crosses between two
// different piecewise-linear mapping segments.
const alternatingStartY = scrollYForVideoTime(0.1095, IH);
state = begunAt(alternatingStartY);
let alternatingRawY = alternatingStartY + 100;
step = applyScrollSample(state, {
  rawY: alternatingRawY,
  nowMs: 0,
  innerHeight: IH,
  maxScrollY,
});
let aggregateForwardClipAdvance =
  videoTimeForY(step.state.virtualY, IH) - 0.1095;
ok(
  videoTimeForY(step.state.virtualY, IH) > 0.11,
  "initial quantum crosses an authored piecewise knot",
);
const alternatingCycles = 20;
for (let cycle = 0; cycle < alternatingCycles; cycle++) {
  alternatingRawY -= 1;
  step = applyScrollSample(step.state, {
    rawY: alternatingRawY,
    nowMs: cycle * 2 + 1,
    innerHeight: IH,
    maxScrollY,
  });
  const beforeAlternatingForwardT = videoTimeForY(step.state.virtualY, IH);

  alternatingRawY += 100;
  step = applyScrollSample(step.state, {
    rawY: alternatingRawY,
    nowMs: cycle * 2 + 2,
    innerHeight: IH,
    maxScrollY,
  });
  const alternatingForwardAdvance =
    videoTimeForY(step.state.virtualY, IH) - beforeAlternatingForwardT;
  ok(
    alternatingForwardAdvance <= 1 / (VIDEO_DURATION_S * 1000) + 1e-10,
    `post-reverse forward sample ${cycle} uses at most its actual 1ms gap`,
  );
  aggregateForwardClipAdvance += Math.max(alternatingForwardAdvance, 0);
}
ok(
  aggregateForwardClipAdvance <=
    (INITIAL_INPUT_QUANTUM_MS + alternatingCycles) /
      (VIDEO_DURATION_S * 1000) +
      1e-9,
  "alternating directions stay bounded by initial quantum plus real input time",
);

// Raw bookkeeping advances for capped, discarded, and zero-distance samples.
state = begunAt(bounds.startY);
step = applyScrollSample(state, {
  rawY: bounds.startY + 10_000,
  nowMs: 0,
  innerHeight: IH,
  maxScrollY,
});
step = applyScrollSample(step.state, {
  rawY: step.state.lastRawY - 1,
  nowMs: 10,
  innerHeight: IH,
  maxScrollY,
});
step = applyScrollSample(step.state, {
  rawY: step.state.lastRawY + 10_000,
  nowMs: 49,
  innerHeight: IH,
  maxScrollY,
});
eq(step.state.lastRawY, maxScrollY, "discarded sample still updates lastRawY", 0);
step = applyScrollSample(step.state, {
  rawY: maxScrollY - 50,
  nowMs: 50,
  innerHeight: IH,
  maxScrollY,
});
eq(step.state.lastRawY, maxScrollY - 50, "reverse sample updates lastRawY", 0);
step = applyScrollSample(step.state, {
  rawY: maxScrollY - 50,
  nowMs: 51,
  innerHeight: IH,
  maxScrollY,
});
eq(step.state.lastRawY, maxScrollY - 50, "zero sample updates lastRawY", 0);

// Entering the FPV range locks this gesture to the video-card seam. Starting
// only one pixel before the seam makes one quantum sufficient to land exactly.
state = begunAt(bounds.endY - 1);
step = applyScrollSample(state, {
  rawY: bounds.endY + 100,
  nowMs: 0,
  innerHeight: IH,
  maxScrollY,
});
ok(step.state.gestureLocksGallery, "forward gesture entering FPV locks the gallery");
eqProgress(
  step.progress,
  { sp: 1, gp: VID_FLY_END },
  "same gesture lands at video end",
  1e-10,
);
step = applyScrollSample(step.state, {
  rawY: bounds.endY + 200,
  nowMs: 16,
  innerHeight: IH,
  maxScrollY,
});
eqProgress(
  step.progress,
  { sp: 1, gp: VID_FLY_END },
  "same gesture cannot spill into image slides",
  1e-10,
);

// Repeated touch starts (for example a second finger) are not new gestures.
// They must leave every active lifecycle field intact, especially the gallery
// lock that prevents this gesture's remaining momentum reaching slide #2.
const lockedWithSuppression = { ...step.state, suppressForward: true };
state = beginScrollGesture(lockedWithSuppression, 999);
eq(state.virtualY, lockedWithSuppression.virtualY, "repeated begin preserves virtualY", 0);
eq(state.lastRawY, lockedWithSuppression.lastRawY, "repeated begin preserves lastRawY", 0);
eq(
  state.lastInputAtMs ?? Number.NaN,
  lockedWithSuppression.lastInputAtMs ?? Number.NaN,
  "repeated begin preserves input timing",
  0,
);
eq(state.direction, lockedWithSuppression.direction, "repeated begin preserves direction", 0);
ok(state.gestureActive, "repeated begin keeps the gesture active");
ok(state.gestureLocksGallery, "repeated begin preserves the gallery lock");
ok(state.suppressForward, "repeated begin preserves suppression");
state = releaseScrollSuppression(state);
step = applyScrollSample(state, {
  rawY: state.lastRawY + 100,
  nowMs: 1_000,
  innerHeight: IH,
  maxScrollY,
});
eqProgress(
  step.progress,
  { sp: 1, gp: VID_FLY_END },
  "repeated begin cannot unlock image-gallery spill",
  1e-10,
);
const lockedAtVideoEndState = step.state;
step = applyScrollSample(step.state, {
  rawY: step.state.lastRawY - 1,
  nowMs: 1_001,
  innerHeight: IH,
  maxScrollY,
});
ok(step.state.gestureLocksGallery, "reverse preserves the same-gesture gallery lock");
step = applyScrollSample(step.state, {
  rawY: step.state.lastRawY + 100,
  nowMs: 1_002,
  innerHeight: IH,
  maxScrollY,
});
eq(step.progress.sp, 1, "re-forward motion remains on the gallery phase", 1e-10);
ok(
  step.progress.gp <= VID_FLY_END + 1e-10,
  "re-forward motion in the same gesture remains locked",
);

// A newly begun gesture at the seam is allowed onto the ordinary gallery
// track. Re-anchor raw bookkeeping first, as the browser hook does.
let ended = endScrollGesture(lockedAtVideoEndState, IH);
ok(ended.needsReanchor, "capped gesture requests a re-anchor");
state = syncRawScrollPosition(ended.state, bounds.endY);
state = beginScrollGesture(state, 100);
ok(!state.gestureLocksGallery, "fresh gesture clears the previous gallery lock");
step = applyScrollSample(state, {
  rawY: bounds.endY + 100,
  nowMs: 100,
  innerHeight: IH,
  maxScrollY,
});
ok(step.progress.gp > VID_FLY_END, "fresh gallery gesture advances normally");
eq(step.state.virtualY, bounds.endY + 100, "gallery motion remains exact", 0);

// Programmatic scrolling and reduced motion bypass the governor and clear all
// dirty gesture lifecycle fields rather than leaking them back into the hook.
const dirtyLifecycleState = {
  ...begunAt(bounds.startY),
  lastInputAtMs: 42,
  direction: 1 as const,
  gestureLocksGallery: true,
  suppressForward: true,
};
step = applyScrollSample(dirtyLifecycleState, {
  rawY: bounds.endY + 123,
  nowMs: 10,
  innerHeight: IH,
  maxScrollY,
  bypass: true,
});
eq(step.state.virtualY, bounds.endY + 123, "bypass synchronizes virtual position", 0);
eq(step.state.lastRawY, bounds.endY + 123, "bypass synchronizes raw position", 0);
eq(step.discardedForwardPx, 0, "bypass discards no distance", 0);
eqProgress(
  step.progress,
  timelineProgressForY(bounds.endY + 123, IH),
  "bypass synchronizes progress",
  0,
);
ok(!step.needsReanchor, "bypass leaves no re-anchor mismatch");
eq(step.state.lastInputAtMs ?? 0, 0, "bypass clears input timing", 0);
eq(step.state.direction, 0, "bypass clears direction", 0);
ok(!step.state.gestureActive, "bypass ends the active gesture");
ok(!step.state.gestureLocksGallery, "bypass clears gallery lock");
ok(!step.state.suppressForward, "bypass clears suppression");

step = applyScrollSample(dirtyLifecycleState, {
  rawY: bounds.startY + 321,
  nowMs: 20,
  innerHeight: IH,
  maxScrollY,
  reducedMotion: true,
});
eq(step.state.virtualY, bounds.startY + 321, "reduced motion synchronizes directly", 0);
eq(step.state.lastRawY, bounds.startY + 321, "reduced motion updates raw position", 0);
eqProgress(
  step.progress,
  timelineProgressForY(bounds.startY + 321, IH),
  "reduced motion synchronizes progress",
  0,
);
ok(!step.needsReanchor, "reduced motion leaves no re-anchor mismatch");
eq(step.state.lastInputAtMs ?? 0, 0, "reduced motion clears input timing", 0);
eq(step.state.direction, 0, "reduced motion clears direction", 0);
ok(!step.state.gestureActive, "reduced motion ends the active gesture");
ok(!step.state.gestureLocksGallery, "reduced motion clears gallery lock");
ok(!step.state.suppressForward, "reduced motion clears suppression");

// Invalid viewport heights cannot move the governed cursor while reporting
// zero progress. Raw input is still consumed, and restoring a valid viewport
// with no new delta never catches up.
for (const invalidHeight of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
  state = begunAt(bounds.startY);
  const invalidRequestedRawY = bounds.startY + 100;
  step = applyScrollSample(state, {
    rawY: invalidRequestedRawY,
    nowMs: 10,
    innerHeight: invalidHeight,
    maxScrollY,
  });
  eq(
    step.state.virtualY,
    bounds.startY,
    `invalid height ${invalidHeight}: virtual position holds`,
    0,
  );
  eq(
    step.state.lastRawY,
    invalidRequestedRawY,
    `invalid height ${invalidHeight}: raw input is consumed`,
    0,
  );
  eq(
    step.discardedForwardPx,
    100,
    `invalid height ${invalidHeight}: forward distance is discarded`,
    1e-10,
  );
  eqProgress(
    step.progress,
    { sp: 0, gp: 0 },
    `invalid height ${invalidHeight}: progress fails closed`,
  );
  ok(
    step.state.lastInputAtMs === null,
    `invalid height ${invalidHeight}: timing resets`,
  );
  eq(step.state.direction, 0, `invalid height ${invalidHeight}: direction resets`, 0);

  step = applyScrollSample(step.state, {
    rawY: invalidRequestedRawY,
    nowMs: 20,
    innerHeight: IH,
    maxScrollY,
  });
  eq(
    step.state.virtualY,
    bounds.startY,
    `invalid height ${invalidHeight}: zero delta never catches up`,
    0,
  );
}

// Document bounds and malformed inputs are deterministic and finite.
state = createScrollGovernorState(-100);
eq(state.virtualY, 0, "initial virtual position clamps at document start", 0);
step = applyScrollSample(state, {
  rawY: Number.POSITIVE_INFINITY,
  nowMs: Number.NaN,
  innerHeight: Number.NaN,
  maxScrollY: Number.POSITIVE_INFINITY,
  bypass: true,
});
eq(step.state.virtualY, 0, "invalid limits fail closed", 0);
eqProgress(step.progress, { sp: 0, gp: 0 }, "invalid sample cannot create NaN");

state = begunAt(maxScrollY - 10);
step = applyScrollSample(state, {
  rawY: maxScrollY + 1_000,
  nowMs: 0,
  innerHeight: IH,
  maxScrollY,
  bypass: true,
});
eq(step.state.virtualY, maxScrollY, "virtual state clamps at document end", 0);
eq(step.state.lastRawY, maxScrollY, "raw state clamps at document end", 0);

// Gesture end asks the hook to reconcile native and virtual coordinates only
// when they differ, then blocks positive inertial residue until release.
state = begunAt(bounds.startY);
step = applyScrollSample(state, {
  rawY: maxScrollY,
  nowMs: 0,
  innerHeight: IH,
  maxScrollY,
});
ended = endScrollGesture(step.state, IH);
ok(ended.needsReanchor, "mismatched native and virtual Y requests re-anchor");
ok(ended.state.suppressForward, "re-anchor enables forward residual suppression");
eqProgress(
  ended.progress,
  timelineProgressForY(ended.state.virtualY, IH),
  "gesture end reports progress from the virtual cursor",
  0,
);
const suppressedY = ended.state.virtualY;
state = syncRawScrollPosition(ended.state, suppressedY);
ended = endScrollGesture(state, IH);
ok(ended.state.suppressForward, "duplicate end preserves residual suppression");
state = syncRawScrollPosition(ended.state, suppressedY);
step = applyScrollSample(state, {
  rawY: suppressedY + 100,
  nowMs: 10,
  innerHeight: IH,
  maxScrollY,
});
eq(step.state.virtualY, suppressedY, "positive residual momentum is discarded", 0);
eq(step.discardedForwardPx, 100, "suppression reports discarded residue", 1e-10);
eq(
  step.state.lastRawY,
  suppressedY + 100,
  "suppression still consumes the positive raw sample",
  0,
);
step = applyScrollSample(step.state, {
  rawY: suppressedY + 100,
  nowMs: 15,
  innerHeight: IH,
  maxScrollY,
});
eq(step.state.virtualY, suppressedY, "zero residual delta cannot catch up", 0);
eq(step.discardedForwardPx, 0, "zero residual delta discards nothing", 0);

step = applyScrollSample(step.state, {
  rawY: step.state.lastRawY - 20,
  nowMs: 20,
  innerHeight: IH,
  maxScrollY,
});
eq(step.state.virtualY, suppressedY - 20, "reverse works during suppression", 0);
state = releaseScrollSuppression(step.state);
ok(!state.suppressForward, "explicit release clears residual suppression");
const beforeReleasedForwardY = state.virtualY;
step = applyScrollSample(state, {
  rawY: state.lastRawY + 1,
  nowMs: 30,
  innerHeight: IH,
  maxScrollY,
});
ok(step.state.virtualY > beforeReleasedForwardY, "forward motion resumes after release");

state = createScrollGovernorState(500);
ended = endScrollGesture(state, IH);
ok(!ended.needsReanchor, "aligned state does not request re-anchor");
ok(!ended.state.suppressForward, "aligned end does not enable suppression");

// Re-anchor bookkeeping must not move the virtual timeline by itself.
state = syncRawScrollPosition(createScrollGovernorState(500), 700);
eq(state.virtualY, 500, "raw synchronization invents no virtual movement", 0);
eq(state.lastRawY, 700, "raw synchronization aligns bookkeeping", 0);

console.log("✓ invertible timeline and native-speed scroll governor");
