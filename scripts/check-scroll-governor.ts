// Focused pure-function checks for the single physical scroll/video timeline.
// Run manually with: npx tsx scripts/check-scroll-governor.ts
import {
  GALLERY_PIN_TRACK_PX,
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

function eq(actual: number, expected: number, label: string, eps = 1e-9) {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > eps) {
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
const seamY = animY + videoCardPx;
const galleryEndY = seamY + GALLERY_PIN_TRACK_PX;

eq(VIDEO_DURATION_S, 23.56, "authored clip duration");
eq(animationEndY(IH), animY, "animation end uses canonical vh track");

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

for (let segment = 1; segment < VIDEO_TIME_KNOTS.length; segment += 1) {
  const [sp0, t0] = VIDEO_TIME_KNOTS[segment - 1];
  const [sp1, t1] = VIDEO_TIME_KNOTS[segment];
  for (const u of [0.25, 0.5, 0.75]) {
    const t = t0 + (t1 - t0) * u;
    const expectedSp = sp0 + (sp1 - sp0) * u;
    const position = videoTimelinePositionFor(t);
    eq(position.sp, expectedSp, `segment ${segment} inverse remains affine`, 1e-12);
    eq(videoMasterTimeFor(position.sp, position.gp, "scroll"), t, `segment ${segment} round-trip`, 1e-12);
  }
}

for (const t of [...authoredKnots.map(([time]) => time), 0.92, 1]) {
  const position = videoTimelinePositionFor(t);
  eq(videoMasterTimeFor(position.sp, position.gp, "scroll"), t, `timeline round-trip t=${t}`, 1e-8);
  const y = scrollYForVideoTime(t, IH);
  eq(videoTimeForY(y, IH), t, `physical video round-trip t=${t}`, 1e-8);
}

eqProgress(timelineProgressForY(0, IH), { sp: 0, gp: 0 }, "document start");
eqProgress(timelineProgressForY(animY, IH), { sp: 1, gp: 0 }, "animation seam");
eqProgress(timelineProgressForY(seamY, IH), { sp: 1, gp: VID_FLY_END }, "video/photo seam");
eqProgress(timelineProgressForY(galleryEndY, IH), { sp: 1, gp: 1 }, "pin-release end");

eq(scrollYForTimelineProgress({ sp: 1, gp: VID_FLY_END }, IH), seamY, "seam inverse");
eq(scrollYForTimelineProgress({ sp: 1, gp: 1 }, IH), galleryEndY, "CTA inverse");

const bounds = videoGovernorBounds(IH);
eq(bounds.startY, VIDEO_START * animY, "video starts at authored coordinate");
eq(bounds.endY, seamY, "video ends at the pinned gallery seam");
ok(bounds.startY < bounds.endY, "video bounds are ordered");

for (const invalidHeight of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
  eq(animationEndY(invalidHeight), 0, `invalid height ${invalidHeight}: animation end`);
  eqProgress(timelineProgressForY(500, invalidHeight), { sp: 0, gp: 0 }, `invalid height ${invalidHeight}: progress`);
}
