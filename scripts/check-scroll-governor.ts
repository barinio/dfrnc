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
function begunAt(y: number) {
  return beginScrollGesture(createScrollGovernorState(y));
}

// Within the video interval, native distance is preserved exactly. The
// authored VIDEO_TIME_KNOTS above are the only source of caption slowdowns.
let state = begunAt(bounds.startY);
let step = applyScrollSample(state, {
  rawY: bounds.startY + 333,
  innerHeight: IH,
  maxScrollY,
});
eq(
  step.state.virtualY,
  bounds.startY + 333,
  "interior forward motion preserves native distance",
  0,
);
eq(step.discardedForwardPx, 0, "interior forward motion discards nothing", 0);
let ended = endScrollGesture(step.state, IH);
ok(!ended.needsReanchor, "aligned interior gesture needs no re-anchor");
ok(!ended.state.suppressForward, "aligned interior end does not suppress forward input");
ok(!ended.state.gestureActive, "aligned interior end clears the active gesture");
ok(ended.state.gestureLocksGallery, "aligned interior end retains its gesture lock");

// A gesture that intersects the video interval may traverse all of it in one
// native sample, but it cannot carry into the image-card gallery.
state = begunAt(bounds.startY);
step = applyScrollSample(state, {
  rawY: bounds.endY + 321,
  innerHeight: IH,
  maxScrollY,
});
eq(step.state.virtualY, bounds.endY, "huge first sample lands at the seam", 0);
eqProgress(
  step.progress,
  { sp: 1, gp: VID_FLY_END },
  "huge first sample reports the video-gallery seam",
  1e-10,
);
eq(step.discardedForwardPx, 321, "only gallery overflow is discarded", 1e-9);
ok(step.state.gestureLocksGallery, "video-intersecting gesture owns the gallery lock");

step = applyScrollSample(step.state, {
  rawY: bounds.endY + 418,
  innerHeight: IH,
  maxScrollY,
});
eq(step.state.virtualY, bounds.endY, "same gesture remains at the seam", 0);
eq(step.discardedForwardPx, 97, "later same-gesture overflow is discarded once", 1e-9);

const afterDiscardY = step.state.virtualY;
const consumedRawY = step.state.lastRawY;
step = applyScrollSample(step.state, {
  rawY: consumedRawY,
  innerHeight: IH,
  maxScrollY,
});
eq(step.state.virtualY, afterDiscardY, "zero delta cannot replay discarded distance", 0);
eq(step.discardedForwardPx, 0, "zero delta discards nothing", 0);

step = applyScrollSample(step.state, {
  rawY: bounds.endY + 168,
  innerHeight: IH,
  maxScrollY,
});
eq(step.state.virtualY, bounds.endY - 250, "reverse motion preserves exact native distance", 0);
ok(step.state.gestureLocksGallery, "reverse preserves the same-gesture gallery lock");

step = applyScrollSample(step.state, {
  rawY: bounds.endY + 518,
  innerHeight: IH,
  maxScrollY,
});
eq(step.state.virtualY, bounds.endY, "re-forward motion clamps at the seam again", 0);
eqProgress(
  step.progress,
  { sp: 1, gp: VID_FLY_END },
  "re-forward motion remains at video end",
  1e-10,
);
eq(step.discardedForwardPx, 100, "re-forward gallery overflow is discarded", 1e-9);
const lockedSeamState = step.state;

// Ordinary forward motion wholly before the FPV interval stays one-to-one and
// does not acquire the same-gesture gallery lock.
state = begunAt(bounds.startY - 200);
const preVideoRequestedY = bounds.startY - 100;
step = applyScrollSample(state, {
  rawY: preVideoRequestedY,
  innerHeight: IH,
  maxScrollY,
});
eq(step.state.virtualY, preVideoRequestedY, "pre-video forward motion is exact", 0);
eq(step.state.lastRawY, preVideoRequestedY, "pre-video raw bookkeeping is exact", 0);
eq(step.discardedForwardPx, 0, "pre-video motion discards nothing", 0);
ok(!step.state.gestureLocksGallery, "pre-video motion does not lock the gallery");

// Repeated touch starts (for example a second finger) are not new gestures.
// They must leave every active lifecycle field intact, especially the gallery
// lock that prevents this gesture's remaining momentum reaching slide #2.
const lockedWithSuppression = { ...lockedSeamState, suppressForward: true };
state = beginScrollGesture(lockedWithSuppression);
eq(state.virtualY, lockedWithSuppression.virtualY, "repeated begin preserves virtualY", 0);
eq(state.lastRawY, lockedWithSuppression.lastRawY, "repeated begin preserves lastRawY", 0);
ok(state.gestureActive, "repeated begin keeps the gesture active");
ok(state.gestureLocksGallery, "repeated begin preserves the gallery lock");
ok(state.suppressForward, "repeated begin preserves suppression");
state = releaseScrollSuppression(state);
step = applyScrollSample(state, {
  rawY: state.lastRawY + 100,
  innerHeight: IH,
  maxScrollY,
});
eqProgress(
  step.progress,
  { sp: 1, gp: VID_FLY_END },
  "repeated begin cannot unlock image-gallery spill",
  1e-10,
);

// Programmatic scrolling and reduced motion bypass the governor and clear all
// dirty gesture lifecycle fields rather than leaking them back into the hook.
const dirtyLifecycleState = {
  ...begunAt(bounds.startY),
  gestureLocksGallery: true,
  suppressForward: true,
};
step = applyScrollSample(dirtyLifecycleState, {
  rawY: bounds.endY + 123,
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
ok(!step.state.gestureActive, "bypass ends the active gesture");
ok(!step.state.gestureLocksGallery, "bypass clears gallery lock");
ok(!step.state.suppressForward, "bypass clears suppression");

step = applyScrollSample(dirtyLifecycleState, {
  rawY: bounds.startY + 321,
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

  step = applyScrollSample(step.state, {
    rawY: invalidRequestedRawY,
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
  innerHeight: Number.NaN,
  maxScrollY: Number.POSITIVE_INFINITY,
  bypass: true,
});
eq(step.state.virtualY, 0, "invalid limits fail closed", 0);
eqProgress(step.progress, { sp: 0, gp: 0 }, "invalid sample cannot create NaN");

state = begunAt(maxScrollY - 10);
step = applyScrollSample(state, {
  rawY: maxScrollY + 1_000,
  innerHeight: IH,
  maxScrollY,
  bypass: true,
});
eq(step.state.virtualY, maxScrollY, "virtual state clamps at document end", 0);
eq(step.state.lastRawY, maxScrollY, "raw state clamps at document end", 0);

// Landing exactly on the locked boundary needs no coordinate repair, but the
// gesture end still suppresses positive inertial residue at the seam.
state = begunAt(bounds.endY - 1);
step = applyScrollSample(state, {
  rawY: bounds.endY,
  innerHeight: IH,
  maxScrollY,
});
eq(step.state.virtualY, bounds.endY, "one native pixel lands exactly at the seam", 0);
eq(step.discardedForwardPx, 0, "aligned seam arrival discards nothing", 0);
ok(step.state.gestureLocksGallery, "aligned seam arrival owns the gallery lock");
ended = endScrollGesture(step.state, IH);
ok(!ended.needsReanchor, "aligned seam end needs no re-anchor");
ok(ended.state.suppressForward, "aligned locked seam end enables suppression");

// A newly begun gesture after an aligned seam end clears the prior lock and
// suppression, so it may enter the ordinary image-card gallery immediately.
state = beginScrollGesture(ended.state);
ok(!state.gestureLocksGallery, "fresh gesture clears the previous gallery lock");
ok(!state.suppressForward, "fresh gesture clears boundary suppression");
step = applyScrollSample(state, {
  rawY: bounds.endY + 100,
  innerHeight: IH,
  maxScrollY,
});
ok(step.progress.gp > VID_FLY_END, "fresh gallery gesture advances normally");
eq(step.state.virtualY, bounds.endY + 100, "fresh gallery motion remains exact", 0);
eq(step.discardedForwardPx, 0, "fresh gallery gesture discards nothing", 0);

// A capped gesture asks the hook to reconcile native and virtual coordinates,
// then blocks positive inertial residue until explicit release.
state = begunAt(bounds.startY);
step = applyScrollSample(state, {
  rawY: maxScrollY,
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
  innerHeight: IH,
  maxScrollY,
});
eq(step.state.virtualY, suppressedY, "zero residual delta cannot catch up", 0);
eq(step.discardedForwardPx, 0, "zero residual delta discards nothing", 0);

step = applyScrollSample(step.state, {
  rawY: step.state.lastRawY - 20,
  innerHeight: IH,
  maxScrollY,
});
eq(step.state.virtualY, suppressedY - 20, "reverse works during suppression", 0);
state = releaseScrollSuppression(step.state);
ok(!state.suppressForward, "explicit release clears residual suppression");
const beforeReleasedForwardY = state.virtualY;
step = applyScrollSample(state, {
  rawY: state.lastRawY + 1,
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

console.log("✓ invertible timeline and boundary-only scroll governor");
