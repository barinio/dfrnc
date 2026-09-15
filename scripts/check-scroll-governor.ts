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
  SCROLL_BANK_MAX_CLIP_S,
  animationEndY,
  capVirtualY,
  clampBankPx,
  scrollYForTimelineProgress,
  scrollYForVideoTime,
  timelineProgressForY,
  videoGovernorBounds,
  videoTimeForY,
} from "../src/scrollGovernor";
import {
  NATIVE_CLIP_RATE_PER_S,
  NATIVE_SCRUB_FPS,
  scrubTargetFrameFor,
} from "../src/frameScrub";
import { FRAME_COUNT } from "../src/frames";

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

// ── Page-speed cap ───────────────────────────────────────────────────────────
// The requirement in one assertion: whatever the input asks for, the PUBLISHED
// position may never advance the clip faster than it was shot. Everything below
// measures the cap in the only unit that matters — SEQUENCE FRAMES PER WALL
// SECOND — by running capVirtualY at 60 Hz exactly the way the controller does.

const TICK_S = 1 / 60;
const TICKS_PER_S = Math.round(1 / TICK_S);
const FLICK_PX_PER_S = 10000;
const FRAME_SPAN = FRAME_COUNT - 1;

eq(
  NATIVE_CLIP_RATE_PER_S,
  NATIVE_SCRUB_FPS / FRAME_SPAN,
  "clip rate is the native fps expressed in clip units",
  1e-15,
);

const frameAt = (y: number) =>
  scrubTargetFrameFor(videoTimeForY(y, IH), FRAME_COUNT);

// Drive the cap with a constant request, sampling the requested FRAME after
// every tick — the same series the painted chase is asked to follow.
function driveCap(startY: number, pxPerSecond: number, seconds: number) {
  const totalTicks = Math.round(seconds / TICK_S);
  let y = startY;
  const frames: number[] = [frameAt(y)];
  const positions: number[] = [y];
  for (let tick = 0; tick < totalTicks; tick += 1) {
    y = capVirtualY(y, y + pxPerSecond * TICK_S, TICK_S, IH);
    frames.push(frameAt(y));
    positions.push(y);
  }
  return { y, frames, positions };
}

// Worst 1-second window anywhere in the run (frames advanced, absolute).
function maxFramesPerSecond(frames: number[]): number {
  let worst = 0;
  for (let i = TICKS_PER_S; i < frames.length; i += 1) {
    worst = Math.max(worst, Math.abs(frames[i] - frames[i - TICKS_PER_S]));
  }
  return worst;
}

const RATE_CEILING = NATIVE_SCRUB_FPS + 1;

// Every authored knot, both directions, at 10 000 px/s of demand.
for (const [knotSp, knotT] of VIDEO_TIME_KNOTS) {
  const knotY = scrollYForVideoTime(knotT, IH);
  for (const sign of [1, -1]) {
    const run = driveCap(knotY, sign * FLICK_PX_PER_S, 2);
    const worst = maxFramesPerSecond(run.frames);
    ok(
      worst <= RATE_CEILING,
      `knot sp=${knotSp.toFixed(4)} t=${knotT} dir=${sign}: ` +
        `${worst.toFixed(3)} frames/s exceeds the native ${RATE_CEILING}`,
    );
  }
}

// Mid-segment too: the cap must hold at every slope, not only at the joints.
for (let segment = 1; segment < VIDEO_TIME_KNOTS.length; segment += 1) {
  const [, t0] = VIDEO_TIME_KNOTS[segment - 1];
  const [, t1] = VIDEO_TIME_KNOTS[segment];
  for (const u of [0.25, 0.5, 0.75]) {
    const y = scrollYForVideoTime(t0 + (t1 - t0) * u, IH);
    for (const sign of [1, -1]) {
      const worst = maxFramesPerSecond(driveCap(y, sign * FLICK_PX_PER_S, 1.5).frames);
      ok(
        worst <= RATE_CEILING,
        `segment ${segment} u=${u} dir=${sign}: ${worst.toFixed(3)} frames/s`,
      );
    }
  }
}

// The video-card tail (sp = 1, gp ≤ VID_FLY_END) is inside the zone as well —
// it is where the clip runs out exactly at the pinned-gallery seam.
ok(
  scrollYForVideoTime(VIDEO_SPLIT, IH) === animY,
  "the video-card tail begins exactly at the anim-track end",
);
for (const t of [0.85, 0.92, 0.99]) {
  const y = scrollYForVideoTime(t, IH);
  for (const sign of [1, -1]) {
    const worst = maxFramesPerSecond(driveCap(y, sign * FLICK_PX_PER_S, 1.5).frames);
    ok(worst <= RATE_CEILING, `video-card tail t=${t} dir=${sign}: ${worst.toFixed(3)} frames/s`);
  }
}

// Whole-zone traversal at unlimited demand: the clip's own running time.
{
  let y = bounds.startY;
  let ticks = 0;
  while (y < bounds.endY - 1e-6 && ticks < 60 * 120) {
    y = capVirtualY(y, y + FLICK_PX_PER_S * TICK_S, TICK_S, IH);
    ticks += 1;
  }
  const seconds = ticks * TICK_S;
  ok(y >= bounds.endY - 1e-6, "the zone is traversable at full demand");
  ok(
    seconds >= FRAME_SPAN / NATIVE_SCRUB_FPS - 0.1,
    `full-demand traversal took ${seconds.toFixed(2)} s, below the clip's ` +
      `${(FRAME_SPAN / NATIVE_SCRUB_FPS).toFixed(2)} s`,
  );
  ok(seconds <= FRAME_SPAN / NATIVE_SCRUB_FPS + 0.5, "traversal is not slower than the clip");
}

// Symmetry: rewinding is metered exactly like running forward.
{
  const midY = scrollYForVideoTime(0.5, IH);
  const forward = capVirtualY(midY, midY + 5000, TICK_S, IH);
  const back = capVirtualY(midY, midY - 5000, TICK_S, IH);
  eq(
    videoTimeForY(forward, IH) - videoTimeForY(midY, IH),
    videoTimeForY(midY, IH) - videoTimeForY(back, IH),
    "forward and reverse budgets match",
    1e-12,
  );
  eq(
    videoTimeForY(forward, IH) - videoTimeForY(midY, IH),
    NATIVE_CLIP_RATE_PER_S * TICK_S,
    "one tick spends exactly one tick of clip time",
    1e-12,
  );
}

// PASS-THROUGH outside the zone: ordinary scrolling is never touched.
eq(capVirtualY(1000, 3000, TICK_S, IH), 3000, "below the zone passes through");
eq(capVirtualY(3000, 500, TICK_S, IH), 500, "below the zone passes through in reverse");
eq(
  capVirtualY(bounds.endY + 50, bounds.endY + 500, TICK_S, IH),
  bounds.endY + 500,
  "past the zone passes through",
);
eq(
  capVirtualY(bounds.endY + 500, bounds.endY + 50, TICK_S, IH),
  bounds.endY + 50,
  "past the zone passes through in reverse",
);
eq(capVirtualY(5000, 5000, TICK_S, IH), 5000, "a null request is returned unchanged");
for (const invalidHeight of [0, -1, Number.NaN]) {
  eq(
    capVirtualY(5000, 9000, TICK_S, invalidHeight),
    9000,
    `invalid height ${invalidHeight}: cap passes through`,
  );
}

// RESIDUE at both edges. Only the in-zone share of a movement is metered; the
// part that lies outside is spent for free, so a scroll that merely clips an
// edge on its way past is not throttled by a zone it is only touching.
{
  // Entering: the free run up to the zone start is granted, then the budget.
  const from = bounds.startY - 200;
  const next = capVirtualY(from, from + 250, TICK_S, IH);
  ok(next > bounds.startY, "entering residue crosses the zone start");
  eq(
    videoTimeForY(next, IH),
    NATIVE_CLIP_RATE_PER_S * TICK_S,
    "entering spends exactly one tick inside the zone",
    1e-12,
  );
}
{
  // Leaving forward: the last in-zone sliver fits the budget, so the whole
  // request lands past the seam and the pinned gallery takes over.
  const budgetY =
    bounds.endY - scrollYForVideoTime(1 - NATIVE_CLIP_RATE_PER_S * TICK_S, IH);
  ok(budgetY > 0, "the seam edge has a measurable per-tick budget");
  const from = bounds.endY - budgetY * 0.5;
  eq(
    capVirtualY(from, from + 500, TICK_S, IH),
    from + 500,
    "an in-budget sliver lets the whole request leave the zone",
  );
  const stuck = capVirtualY(bounds.startY, bounds.startY + 500, TICK_S, IH);
  ok(stuck < bounds.endY, "a full-zone request is still held inside the zone");
}
{
  // Leaving backward: symmetric.
  const budgetY = scrollYForVideoTime(NATIVE_CLIP_RATE_PER_S * TICK_S, IH) - bounds.startY;
  const from = bounds.startY + budgetY * 0.5;
  eq(
    capVirtualY(from, from - 500, TICK_S, IH),
    from - 500,
    "an in-budget sliver lets the whole request leave the zone backwards",
  );
}

// dt = 0 (a duplicated frame timestamp) must not hand out free travel.
{
  const midY = scrollYForVideoTime(0.5, IH);
  eq(
    videoTimeForY(capVirtualY(midY, midY + 5000, 0, IH), IH),
    videoTimeForY(midY, IH),
    "a zero-length tick buys no clip time",
    1e-12,
  );
}

// ── Input bank ceiling ───────────────────────────────────────────────────────
// The cap says how FAST the page may move; the bank says how much of a gesture
// may still be owed. Its ceiling is in CLIP TIME for the same reason the cap is:
// one flick buys SCROLL_BANK_MAX_CLIP_S seconds of playback anywhere in the
// zone, scenic stretch or caption dwell, and never a frame faster than 1×.
const BANK_BUDGET_T = SCROLL_BANK_MAX_CLIP_S * NATIVE_CLIP_RATE_PER_S;
const BANK_BUDGET_FRAMES = BANK_BUDGET_T * FRAME_SPAN;
const HUGE_BANK_PX = 1e6;

eq(
  BANK_BUDGET_FRAMES,
  SCROLL_BANK_MAX_CLIP_S * NATIVE_SCRUB_FPS,
  "the bank ceiling is exactly 4 s of native frames",
  1e-9,
);
eq(BANK_BUDGET_FRAMES, 50, "4 s at 12.5 f/s is 50 sequence frames", 1e-9);

// A scenic stretch (segment 4, the slowest page speed) with four seconds of
// clip on both sides of it: the ceiling binds in both directions.
{
  const t = 0.4;
  const y = scrollYForVideoTime(t, IH);
  ok(t + BANK_BUDGET_T < 1 && t - BANK_BUDGET_T > 0, "the scenic probe is mid-clip");

  const forward = clampBankPx(y, HUGE_BANK_PX, IH);
  const backward = clampBankPx(y, -HUGE_BANK_PX, IH);
  eq(
    forward,
    scrollYForVideoTime(t + BANK_BUDGET_T, IH) - y,
    "the forward ceiling is the px of exactly 4 s of clip",
    1e-9,
  );
  eq(
    backward,
    scrollYForVideoTime(t - BANK_BUDGET_T, IH) - y,
    "the backward ceiling is the px of exactly 4 s of clip",
    1e-9,
  );
  ok(forward > 0 && backward < 0, "the ceiling keeps the bank's sign");
  // Symmetric in the only unit that matters — both directions buy 50 frames.
  eq(
    videoTimeForY(y + forward, IH) - t,
    BANK_BUDGET_T,
    "a full forward bank buys 4 s of clip",
    1e-12,
  );
  eq(
    t - videoTimeForY(y + backward, IH),
    BANK_BUDGET_T,
    "a full backward bank buys 4 s of clip",
    1e-12,
  );
  eq(frameAt(y + forward) - frameAt(y), BANK_BUDGET_FRAMES, "50 frames forward", 1e-6);
  eq(frameAt(y) - frameAt(y + backward), BANK_BUDGET_FRAMES, "50 frames backward", 1e-6);

  // A bank INSIDE the ceiling is not touched at all.
  eq(clampBankPx(y, 3, IH), 3, "a small forward bank passes through unchanged");
  eq(clampBankPx(y, -3, IH), -3, "a small backward bank passes through unchanged");
  eq(clampBankPx(y, forward * 0.5, IH), forward * 0.5, "half a ceiling is untouched", 1e-9);
  eq(clampBankPx(y, 0, IH), 0, "an empty bank stays empty");
}

// NEAR THE SEAM the 4 s horizon runs out of clip: forward becomes UNBOUNDED, so
// the residue passes free and capTick's `next >= seamY` hand-off still fires.
// Backwards there is still a full 4 s of clip, so that side stays bounded.
{
  const t = 0.9;
  const y = scrollYForVideoTime(t, IH);
  ok(t + BANK_BUDGET_T >= 1, "the seam probe has less than 4 s of clip ahead");
  eq(clampBankPx(y, HUGE_BANK_PX, IH), HUGE_BANK_PX, "forward is unbounded at the seam");
  const backward = clampBankPx(y, -HUGE_BANK_PX, IH);
  ok(backward > -HUGE_BANK_PX, "backward is still bounded at the seam");
  eq(
    t - videoTimeForY(y + backward, IH),
    BANK_BUDGET_T,
    "the seam's backward bank is still 4 s of clip",
    1e-12,
  );
}

// NEAR THE ZONE START, the mirror: backward unbounded (the hand-back to native
// scrolling must not be held up), forward still bounded.
{
  const t = 0.05;
  const y = scrollYForVideoTime(t, IH);
  ok(t - BANK_BUDGET_T <= 0, "the start probe has less than 4 s of clip behind");
  eq(clampBankPx(y, -HUGE_BANK_PX, IH), -HUGE_BANK_PX, "backward is unbounded at the zone start");
  const forward = clampBankPx(y, HUGE_BANK_PX, IH);
  ok(forward < HUGE_BANK_PX, "forward is still bounded at the zone start");
  eq(
    videoTimeForY(y + forward, IH) - t,
    BANK_BUDGET_T,
    "the zone start's forward bank is still 4 s of clip",
    1e-12,
  );
}

// Both edges at once can never happen (the clip is 23.5 s long), but a degenerate
// viewport must still pass the bank through untouched rather than zero it.
for (const invalidHeight of [0, -1, Number.NaN]) {
  eq(
    clampBankPx(5000, 900, invalidHeight),
    900,
    `invalid height ${invalidHeight}: the bank passes through`,
  );
}
eq(clampBankPx(Number.NaN, 900, IH), 900, "a non-finite seat passes the bank through");

// Reported for the record: the page speed each authored segment allows.
const segmentSpeeds: string[] = [];
for (let segment = 1; segment < VIDEO_TIME_KNOTS.length; segment += 1) {
  const [, t0] = VIDEO_TIME_KNOTS[segment - 1];
  const [, t1] = VIDEO_TIME_KNOTS[segment];
  const y0 = scrollYForVideoTime(t0, IH);
  const y1 = scrollYForVideoTime(t1, IH);
  const pxPerSecond = ((y1 - y0) / (t1 - t0)) * NATIVE_CLIP_RATE_PER_S;
  segmentSpeeds.push(`  segment ${segment} (t ${t0}→${t1}): ${pxPerSecond.toFixed(1)} px/s`);
}
{
  const y0 = scrollYForVideoTime(VIDEO_SPLIT, IH);
  const pxPerSecond =
    ((bounds.endY - y0) / (1 - VIDEO_SPLIT)) * NATIVE_CLIP_RATE_PER_S;
  segmentSpeeds.push(
    `  video-card tail (t ${VIDEO_SPLIT}→1): ${pxPerSecond.toFixed(1)} px/s`,
  );
}

console.log("max page speed per knot segment at 390x844:");
console.log(segmentSpeeds.join("\n"));
console.log(
  `zone = ${(bounds.endY - bounds.startY).toFixed(1)} px, ` +
    `min traversal = ${(FRAME_SPAN / NATIVE_SCRUB_FPS).toFixed(2)} s`,
);

// What one flick may buy, in pixels, where the page is slowest (a scenic knot
// segment) and where it is fastest (a caption dwell) \u2014 the numbers the client
// feels: a single notch now carries the page this far instead of ~1.5 px.
const bankProbes: readonly (readonly [string, number])[] = [
  ["scenic  (t 0.40)", 0.4],
  ["dwell   (t 0.20)", 0.2],
];
console.log(
  `bank ceiling = ${SCROLL_BANK_MAX_CLIP_S} s of clip = ` +
    `${BANK_BUDGET_FRAMES.toFixed(0)} frames:`,
);
for (const height of [IH, 1080]) {
  for (const [label, t] of bankProbes) {
    const y = scrollYForVideoTime(t, height);
    const forward = clampBankPx(y, HUGE_BANK_PX, height);
    const backward = clampBankPx(y, -HUGE_BANK_PX, height);
    console.log(
      `  ${height === IH ? "390x844" : "1080p  "} ${label}: ` +
        `forward ${forward.toFixed(1)} px, backward ${backward.toFixed(1)} px`,
    );
  }
}
console.log("\u2713 scroll governor (mapping + page-speed cap + input bank)");
