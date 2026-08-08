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
  animationEndY,
  scrollYForTimelineProgress,
  scrollYForVideoTime,
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

console.log("✓ invertible video timeline and canonical physical mapping");
