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
  BANK_EASE_OUT_CLIP_S,
  BANK_EASE_OUT_FLOOR,
  SCROLL_BANK_MAX_CLIP_S_TOUCH,
  SCROLL_BANK_MAX_CLIP_S_WHEEL,
  animationEndY,
  bankClipSeconds,
  capVirtualY,
  clampBankPx,
  coastRateScale,
  scrollYForTimelineProgress,
  scrollYForVideoTime,
  timelineProgressForY,
  videoGovernorBounds,
  videoTimeForY,
} from "../src/scrollGovernor";
import { parseScrubDials } from "../src/scrubDials";
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

// The whole authored map, post-2026-09-16: two knots, one uniform ramp. The
// five caption-dwell knots (0.11 / 0.139 / 0.248 / 0.592 / 0.786 at
// 545.6 / 551.8 / 769.8 / 843.1 / 1228.5 vh) are gone.
const authoredKnots: readonly (readonly [number, number])[] = [
  [0, VIDEO_START],
  [VIDEO_SPLIT, 1],
];
eq(VIDEO_TIME_KNOTS.length, 2, "the anim-track map is exactly two knots");
for (const t of [0.11, 0.139, 0.248, 0.592, 0.786]) {
  const expected = VIDEO_START + (t / VIDEO_SPLIT) * (1 - VIDEO_START);
  eq(
    videoTimelinePositionFor(t).sp,
    expected,
    `old dwell anchor t=${t} is now plain interpolation`,
    1e-12,
  );
}

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

// Whole-zone traversal at unlimited demand is now EXACTLY the clip's own
// running time: one uniform slope, one rate, nothing stretched.
const EXPECTED_TRAVERSAL_S = 1 / NATIVE_CLIP_RATE_PER_S;
eq(
  EXPECTED_TRAVERSAL_S,
  FRAME_SPAN / NATIVE_SCRUB_FPS,
  "a full-demand ride is the clip's runtime, with no caption stretching",
  1e-9,
);
{
  let y = bounds.startY;
  let ticks = 0;
  while (y < bounds.endY - 1e-6 && ticks < 60 * 240) {
    y = capVirtualY(y, y + FLICK_PX_PER_S * TICK_S, TICK_S, IH);
    ticks += 1;
  }
  const seconds = ticks * TICK_S;
  ok(y >= bounds.endY - 1e-6, "the zone is traversable at full demand");
  ok(
    seconds >= EXPECTED_TRAVERSAL_S - 0.1,
    `full-demand traversal took ${seconds.toFixed(2)} s, below the expected ` +
      `${EXPECTED_TRAVERSAL_S.toFixed(2)} s`,
  );
  ok(
    seconds <= EXPECTED_TRAVERSAL_S + 0.5,
    `full-demand traversal took ${seconds.toFixed(2)} s, past the expected ` +
      `${EXPECTED_TRAVERSAL_S.toFixed(2)} s`,
  );
  // Nothing lengthens the ride any more: it IS the clip.
  ok(
    Math.abs(seconds - FRAME_SPAN / NATIVE_SCRUB_FPS) <= 0.5,
    `a full-demand ride is ${seconds.toFixed(2)} s, the clip is ` +
      `${(FRAME_SPAN / NATIVE_SCRUB_FPS).toFixed(2)} s`,
  );
}

// ── Uniform px per frame ────────────────────────────────────────────────────
// The point of the 2-knot map: one sequence frame costs the SAME scroll
// everywhere in the zone, so a flick is worth the same amount of picture
// wherever it lands. (Before: 5.6 px/frame through a scenic stretch against
// 52 px/frame in a caption dwell at 844 — a 9× asymmetry that made the same
// swipe buy 5.7 s of clip in one place and 0.6 s in another.)
function pxPerFrameAt(t: number, height: number): number {
  const step = NATIVE_CLIP_RATE_PER_S / NATIVE_SCRUB_FPS; // one frame of clip
  const lo = Math.max(t - step / 2, 0);
  const hi = Math.min(t + step / 2, VIDEO_SPLIT);
  return (
    (scrollYForVideoTime(hi, height) - scrollYForVideoTime(lo, height)) /
    ((hi - lo) / step)
  );
}

const UNIFORM_PX_PER_FRAME: Record<number, number> = {};
for (const height of [IH, 1080]) {
  const probes = [0.02, 0.11, 0.2, 0.4, 0.592, 0.7, 0.82];
  const first = pxPerFrameAt(probes[0], height);
  for (const t of probes) {
    eq(
      pxPerFrameAt(t, height),
      first,
      `px/frame is uniform at t=${t} (height ${height})`,
      1e-9,
    );
  }
  UNIFORM_PX_PER_FRAME[height] = first;
}
ok(
  Math.abs(UNIFORM_PX_PER_FRAME[IH] - 23.1) < 0.3,
  `px/frame at 844 = ${UNIFORM_PX_PER_FRAME[IH].toFixed(2)} (want ≈23.1)`,
);
ok(
  Math.abs(UNIFORM_PX_PER_FRAME[1080] - 29.6) < 0.3,
  `px/frame at 1080 = ${UNIFORM_PX_PER_FRAME[1080].toFixed(2)} (want ≈29.6)`,
);

// The same thing as the client feels it: the page's own top speed.
function pageCapPxPerS(height: number): number {
  const y0 = scrollYForVideoTime(0.4, height);
  const y1 = capVirtualY(y0, y0 + 1e6, 1, height);
  return y1 - y0;
}
ok(
  Math.abs(pageCapPxPerS(IH) - 289) < 4,
  `page cap at 844 = ${pageCapPxPerS(IH).toFixed(1)} px/s (want ≈289)`,
);
ok(
  Math.abs(pageCapPxPerS(1080) - 370) < 4,
  `page cap at 1080 = ${pageCapPxPerS(1080).toFixed(1)} px/s (want ≈370)`,
);

// A tick at full demand spends exactly one tick of clip, anywhere.
{
  const FULL_TICK_T = NATIVE_CLIP_RATE_PER_S * TICK_S;
  const spend = (t: number, sign: number) =>
    Math.abs(
      videoTimeForY(
        capVirtualY(
          scrollYForVideoTime(t, IH),
          scrollYForVideoTime(t, IH) + sign * FLICK_PX_PER_S,
          TICK_S,
          IH,
        ),
        IH,
      ) - t,
    );
  for (const t of [0.05, 0.2, 0.4, 0.5, 0.65, 0.9]) {
    eq(spend(t, 1), FULL_TICK_T, `t=${t} spends a whole tick of clip`, 1e-12);
    eq(spend(t, -1), FULL_TICK_T, `t=${t} rewinds a whole tick of clip`, 1e-12);
  }
}

// ── coastRateScale: the ease-out curve, SHIPPED OFF ─────────────────────────
// A bank that runs out at the cap stops DEAD; a native fling decelerates. The
// mechanism is still here — and still a pure function behind the ?ease= dial —
// but the user tested both on a phone and on a MacBook trackpad and chose the
// constant capped speed: a 0.3 s window stretches into ~0.87 s of WALL time,
// which reads as the page creeping on after the gesture ended. So the SHIPPED
// window is 0, and 0 has to mean "no ease", never a division by zero.
eq(BANK_EASE_OUT_CLIP_S, 0, "the ease window ships at 0 — the ease is disabled");
eq(BANK_EASE_OUT_FLOOR, 0.15, "the ease floor is still 0.15 of the cap");
for (const owed of [0, 1e-12, 0.001, 0.05, 0.15, 0.3, 1.2, 4, -0.001, -0.15, -1.2]) {
  const shipped = coastRateScale(owed);
  eq(shipped, 1, `the shipped window coasts ${owed} s of debt at the full cap`);
  ok(Number.isFinite(shipped), `window 0 is finite at ${owed} s owed`);
  eq(coastRateScale(owed, 0), 1, `an explicit 0 window is full rate at ${owed} s`);
}
// A broken window is the same "no ease", never a NaN leaking into the budget.
for (const badWindow of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
  eq(coastRateScale(0.15, badWindow), 1, `window ${badWindow} disables the ease-out`);
}

// The CURVE itself, exercised through the dial. W is what `?ease=0.3` would set.
{
  const W = 0.3;
  eq(coastRateScale(1.2, W), 1, "a full bank coasts at the cap");
  eq(coastRateScale(W, W), 1, "the window's top edge is still full rate");
  eq(coastRateScale(W + 1e-9, W), 1, "just above the window is full rate");
  eq(coastRateScale(0, W), BANK_EASE_OUT_FLOOR, "an empty bank sits on the floor");
  eq(coastRateScale(W / 2, W), 0.5, "half the window is half the cap");
  eq(coastRateScale(0.15, W), 0.5, "linear between the floor and 1");
  eq(coastRateScale(0.09, W), 0.3, "linear at 0.09 s of clip owed");
  eq(
    coastRateScale(W * BANK_EASE_OUT_FLOOR, W),
    BANK_EASE_OUT_FLOOR,
    "the floor takes over exactly where the ramp reaches it",
  );
  eq(coastRateScale(0.001, W), BANK_EASE_OUT_FLOOR, "below the floor's knee it clamps");
  eq(coastRateScale(-0.5, W), 1, "a REWIND bank eases on its magnitude", 1e-12);
  eq(coastRateScale(-0.15, W), 0.5, "a rewind halfway through is half the cap", 1e-12);
  eq(coastRateScale(Number.NaN, W), 1, "a non-finite bank never brakes the page");
  eq(coastRateScale(0.5, 1), 0.5, "the window is a parameter (the ?ease= dial)");

  // Monotonic, and never above 1 or below the floor.
  let previous = -1;
  for (let owed = 0; owed <= 0.6; owed += 0.005) {
    const scale = coastRateScale(owed, W);
    ok(scale >= previous - 1e-12, `coastRateScale monotonic at ${owed.toFixed(3)}`);
    ok(scale >= BANK_EASE_OUT_FLOOR - 1e-12 && scale <= 1, "scale stays in range");
    previous = scale;
  }
}

// capVirtualY honours it: half the scale, half the clip in the same tick.
{
  const y = scrollYForVideoTime(0.4, IH);
  const full = videoTimeForY(capVirtualY(y, y + 1e6, TICK_S, IH, 1), IH) - 0.4;
  const half = videoTimeForY(capVirtualY(y, y + 1e6, TICK_S, IH, 0.5), IH) - 0.4;
  eq(half, full / 2, "rateScale 0.5 spends half a tick of clip", 1e-12);
  eq(
    videoTimeForY(capVirtualY(y, y + 1e6, TICK_S, IH, 0), IH),
    0.4,
    "rateScale 0 spends nothing",
    1e-12,
  );
  eq(
    videoTimeForY(capVirtualY(y, y + 1e6, TICK_S, IH, 4), IH) - 0.4,
    full,
    "rateScale can never buy MORE than the cap",
    1e-12,
  );
  eq(
    videoTimeForY(capVirtualY(y, y + 1e6, TICK_S, IH, Number.NaN), IH) - 0.4,
    full,
    "a non-finite rateScale falls back to the cap",
    1e-12,
  );
}

// bankClipSeconds: the debt in the unit the ease-out reasons about.
{
  const y = scrollYForVideoTime(0.4, IH);
  const oneSecond = scrollYForVideoTime(0.4 + NATIVE_CLIP_RATE_PER_S, IH) - y;
  eq(bankClipSeconds(y, oneSecond, IH), 1, "one second of clip owed", 1e-9);
  eq(bankClipSeconds(y, -oneSecond, IH), 1, "a rewind owes the same magnitude", 1e-9);
  eq(bankClipSeconds(y, 0, IH), 0, "an empty bank owes nothing");
  eq(bankClipSeconds(y, 100, 0), 0, "an invalid viewport owes nothing");
}

// ── URL dials (?bank= / ?bankw= / ?fling= / ?ease=) ─────────────────────────
{
  const none = parseScrubDials("");
  ok(none.touchBankMaxClipS === null, "no query: no touch bank override");
  ok(none.wheelBankMaxClipS === null, "no query: no wheel bank override");
  ok(none.flingTauMs === null, "no query: no fling override");
  ok(none.easeWindowClipS === null, "no query: no ease override");

  const all = parseScrubDials("?bank=2.5&bankw=0.7&fling=220&ease=0.5");
  eq(all.touchBankMaxClipS ?? -1, 2.5, "?bank= parses (the TOUCH ceiling)");
  eq(all.wheelBankMaxClipS ?? -1, 0.7, "?bankw= parses (the WHEEL ceiling)");
  eq(all.flingTauMs ?? -1, 220, "?fling= parses");
  eq(all.easeWindowClipS ?? -1, 0.5, "?ease= parses");

  // The two ceilings are INDEPENDENT: setting one never moves the other.
  ok(parseScrubDials("?bank=3").wheelBankMaxClipS === null, "?bank= alone leaves the wheel default");
  ok(parseScrubDials("?bankw=3").touchBankMaxClipS === null, "?bankw= alone leaves the touch default");

  // Validation: finite, and inside the published ranges, or the default wins.
  for (const query of ["?bank=0", "?bank=-1", "?bank=11", "?bank=abc", "?bank="]) {
    ok(parseScrubDials(query).touchBankMaxClipS === null, `${query} is refused`);
  }
  for (const query of ["?bankw=0", "?bankw=-1", "?bankw=11", "?bankw=abc", "?bankw="]) {
    ok(parseScrubDials(query).wheelBankMaxClipS === null, `${query} is refused`);
  }
  for (const query of ["?fling=-1", "?fling=1001", "?fling=NaN", "?fling=x"]) {
    ok(parseScrubDials(query).flingTauMs === null, `${query} is refused`);
  }
  for (const query of ["?ease=-0.1", "?ease=2.1", "?ease=Infinity"]) {
    ok(parseScrubDials(query).easeWindowClipS === null, `${query} is refused`);
  }
  eq(parseScrubDials("?fling=0").flingTauMs ?? -1, 0, "fling=0 (no fling at all) is legal");
  eq(parseScrubDials("?ease=0").easeWindowClipS ?? -1, 0, "ease=0 (no ease) is legal");
  eq(parseScrubDials("?gyro=1&bank=1.5").touchBankMaxClipS ?? -1, 1.5, "other flags are ignored");
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

// ── Input bank ceiling, ONE PER INPUT SOURCE ─────────────────────────────────
// The cap says how FAST the page may move; the bank says how much of a gesture
// may still be owed. Its ceiling is in CLIP TIME for the same reason the cap is,
// and since 2026-09-16 there are TWO of them, because the devices deliver a
// gesture in opposite shapes: a FINGER gives one burst and nothing after, so its
// backlog IS the coast (1.2 s of clip = 15 frames); a TRACKPAD keeps feeding OS
// momentum wheel events for another 1-2 s, so its backlog has to be short or the
// page overshoots the hand (0.4 s = 5 frames). The pure function takes the
// ceiling as a parameter and defaults to the permissive, touch one.
const BANK_BUDGET_T = SCROLL_BANK_MAX_CLIP_S_TOUCH * NATIVE_CLIP_RATE_PER_S;
const BANK_BUDGET_FRAMES = BANK_BUDGET_T * FRAME_SPAN;
const WHEEL_BUDGET_T = SCROLL_BANK_MAX_CLIP_S_WHEEL * NATIVE_CLIP_RATE_PER_S;
const WHEEL_BUDGET_FRAMES = WHEEL_BUDGET_T * FRAME_SPAN;
const HUGE_BANK_PX = 1e6;

eq(SCROLL_BANK_MAX_CLIP_S_TOUCH, 1.2, "the TOUCH bank ceiling is 1.2 s of clip");
eq(SCROLL_BANK_MAX_CLIP_S_WHEEL, 0.4, "the WHEEL bank ceiling is 0.4 s of clip");
ok(
  SCROLL_BANK_MAX_CLIP_S_WHEEL < SCROLL_BANK_MAX_CLIP_S_TOUCH,
  "a trackpad may owe LESS than a finger — the OS keeps feeding its momentum",
);
eq(
  BANK_BUDGET_FRAMES,
  SCROLL_BANK_MAX_CLIP_S_TOUCH * NATIVE_SCRUB_FPS,
  "the touch ceiling is exactly 1.2 s of native frames",
  1e-9,
);
eq(BANK_BUDGET_FRAMES, 15, "1.2 s at 12.5 f/s is 15 sequence frames", 1e-9);
eq(WHEEL_BUDGET_FRAMES, 5, "0.4 s at 12.5 f/s is 5 sequence frames", 1e-9);

// PARAMETERISED: the pure function takes the ceiling, so the ?bank= dial moves
// it without this module (or these tests) knowing about a URL.
{
  const y = scrollYForVideoTime(0.4, IH);
  for (const clipS of [0.4, 1.2, 3]) {
    const px = clampBankPx(y, HUGE_BANK_PX, IH, clipS);
    eq(
      videoTimeForY(y + px, IH) - 0.4,
      clipS * NATIVE_CLIP_RATE_PER_S,
      `an explicit ${clipS} s ceiling buys ${clipS} s of clip`,
      1e-12,
    );
  }
  eq(
    clampBankPx(y, HUGE_BANK_PX, IH),
    clampBankPx(y, HUGE_BANK_PX, IH, SCROLL_BANK_MAX_CLIP_S_TOUCH),
    "the default parameter is the shipped TOUCH constant",
    1e-12,
  );
  eq(clampBankPx(y, HUGE_BANK_PX, IH, Number.NaN), HUGE_BANK_PX, "a broken dial passes through");

  // The two shipped ceilings, in the unit the thumb feels: the wheel's is a
  // strict subset of the finger's, in both directions.
  const touchFwd = clampBankPx(y, HUGE_BANK_PX, IH, SCROLL_BANK_MAX_CLIP_S_TOUCH);
  const wheelFwd = clampBankPx(y, HUGE_BANK_PX, IH, SCROLL_BANK_MAX_CLIP_S_WHEEL);
  const touchBack = clampBankPx(y, -HUGE_BANK_PX, IH, SCROLL_BANK_MAX_CLIP_S_TOUCH);
  const wheelBack = clampBankPx(y, -HUGE_BANK_PX, IH, SCROLL_BANK_MAX_CLIP_S_WHEEL);
  ok(wheelFwd > 0 && wheelFwd < touchFwd, "the wheel owes fewer forward px than the finger");
  ok(wheelBack < 0 && wheelBack > touchBack, "…and fewer backward px too");
  eq(
    frameAt(y + wheelFwd) - frameAt(y),
    WHEEL_BUDGET_FRAMES,
    "the wheel ceiling is 5 frames forward",
    1e-6,
  );
  eq(
    frameAt(y) - frameAt(y + wheelBack),
    WHEEL_BUDGET_FRAMES,
    "the wheel ceiling is 5 frames backward",
    1e-6,
  );
  // A touch-sized bank that a wheel event then claims is RE-CLAMPED, not kept:
  // clamping is idempotent per source, so the controller may re-apply it every
  // tick with whichever source last touched the bank.
  eq(
    clampBankPx(y, touchFwd, IH, SCROLL_BANK_MAX_CLIP_S_WHEEL),
    wheelFwd,
    "a finger-sized bank re-clamps to the wheel ceiling",
    1e-9,
  );
  eq(
    clampBankPx(y, wheelFwd, IH, SCROLL_BANK_MAX_CLIP_S_TOUCH),
    wheelFwd,
    "…and a wheel-sized bank is NOT inflated by the touch ceiling",
    1e-9,
  );
}

// A scenic stretch (segment 4, the slowest page speed) with four seconds of
// clip on both sides of it: the ceiling binds in both directions.
{
  const t = 0.4;
  const y = scrollYForVideoTime(t, IH);
  ok(t + BANK_BUDGET_T < 1 && t - BANK_BUDGET_T > 0, "the mid-clip probe has room both ways");

  const forward = clampBankPx(y, HUGE_BANK_PX, IH);
  const backward = clampBankPx(y, -HUGE_BANK_PX, IH);
  eq(
    forward,
    scrollYForVideoTime(t + BANK_BUDGET_T, IH) - y,
    "the forward ceiling is the px of exactly 1.2 s of clip",
    1e-9,
  );
  eq(
    backward,
    scrollYForVideoTime(t - BANK_BUDGET_T, IH) - y,
    "the backward ceiling is the px of exactly 1.2 s of clip",
    1e-9,
  );
  ok(forward > 0 && backward < 0, "the ceiling keeps the bank's sign");
  // Symmetric in the only unit that matters — both directions buy 15 frames.
  eq(
    videoTimeForY(y + forward, IH) - t,
    BANK_BUDGET_T,
    "a full forward bank buys 1.2 s of clip",
    1e-12,
  );
  eq(
    t - videoTimeForY(y + backward, IH),
    BANK_BUDGET_T,
    "a full backward bank buys 1.2 s of clip",
    1e-12,
  );
  eq(frameAt(y + forward) - frameAt(y), BANK_BUDGET_FRAMES, "15 frames forward", 1e-6);
  eq(frameAt(y) - frameAt(y + backward), BANK_BUDGET_FRAMES, "15 frames backward", 1e-6);

  // A bank INSIDE the ceiling is not touched at all.
  eq(clampBankPx(y, 3, IH), 3, "a small forward bank passes through unchanged");
  eq(clampBankPx(y, -3, IH), -3, "a small backward bank passes through unchanged");
  eq(clampBankPx(y, forward * 0.5, IH), forward * 0.5, "half a ceiling is untouched", 1e-9);
  eq(clampBankPx(y, 0, IH), 0, "an empty bank stays empty");
}

// NEAR THE SEAM the horizon runs out of clip: forward becomes UNBOUNDED, so
// the residue passes free and capTick's `next >= seamY` hand-off still fires.
// Backwards there is still a full ceiling of clip, so that side stays bounded.
{
  const t = 0.98;
  const y = scrollYForVideoTime(t, IH);
  ok(t + BANK_BUDGET_T >= 1, "the seam probe has less than the ceiling of clip ahead");
  eq(clampBankPx(y, HUGE_BANK_PX, IH), HUGE_BANK_PX, "forward is unbounded at the seam");
  const backward = clampBankPx(y, -HUGE_BANK_PX, IH);
  ok(backward > -HUGE_BANK_PX, "backward is still bounded at the seam");
  eq(
    t - videoTimeForY(y + backward, IH),
    BANK_BUDGET_T,
    "the seam's backward bank is still 1.2 s of clip",
    1e-12,
  );
}

// NEAR THE ZONE START, the mirror: backward unbounded (the hand-back to native
// scrolling must not be held up), forward still bounded.
{
  const t = 0.03;
  const y = scrollYForVideoTime(t, IH);
  ok(t - BANK_BUDGET_T <= 0, "the start probe has less than the ceiling of clip behind");
  eq(clampBankPx(y, -HUGE_BANK_PX, IH), -HUGE_BANK_PX, "backward is unbounded at the zone start");
  const forward = clampBankPx(y, HUGE_BANK_PX, IH);
  ok(forward < HUGE_BANK_PX, "forward is still bounded at the zone start");
  eq(
    videoTimeForY(y + forward, IH) - t,
    BANK_BUDGET_T,
    "the zone start's forward bank is still 1.2 s of clip",
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

// Reported for the record: the page speed the uniform map allows, and what one
// flick is worth, in the numbers the client feels.
function segmentSpeed(segment: number, height: number): number {
  const [, t0] = VIDEO_TIME_KNOTS[segment - 1];
  const [, t1] = VIDEO_TIME_KNOTS[segment];
  const y0 = scrollYForVideoTime(t0, height);
  const y1 = scrollYForVideoTime(t1, height);
  return ((y1 - y0) / (t1 - t0)) * NATIVE_CLIP_RATE_PER_S;
}

for (const height of [IH, 1080]) {
  const label = height === IH ? "390x844" : "1080p  ";
  const tailY0 = scrollYForVideoTime(VIDEO_SPLIT, height);
  const tailEnd = videoGovernorBounds(height).endY;
  console.log(
    `${label}: uniform ${UNIFORM_PX_PER_FRAME[height].toFixed(2)} px/frame, ` +
      `page cap ${segmentSpeed(1, height).toFixed(1)} px/s ` +
      `(video-card tail ${(((tailEnd - tailY0) / (1 - VIDEO_SPLIT)) * NATIVE_CLIP_RATE_PER_S).toFixed(1)} px/s)`,
  );
}
console.log(
  `zone = ${(bounds.endY - bounds.startY).toFixed(1)} px, ` +
    `clip runtime = ${(FRAME_SPAN / NATIVE_SCRUB_FPS).toFixed(2)} s, ` +
    `min traversal = ${EXPECTED_TRAVERSAL_S.toFixed(2)} s (uniform: no dwells)`,
);
console.log(
  `bank ceilings: finger ${SCROLL_BANK_MAX_CLIP_S_TOUCH} s of clip = ` +
    `${BANK_BUDGET_FRAMES.toFixed(0)} frames, trackpad/wheel/keys ` +
    `${SCROLL_BANK_MAX_CLIP_S_WHEEL} s = ${WHEEL_BUDGET_FRAMES.toFixed(0)} frames; ` +
    `ease-out ${BANK_EASE_OUT_CLIP_S} s of clip (0 = OFF, floor ` +
    `${BANK_EASE_OUT_FLOOR}x kept for the ?ease= dial):`,
);
for (const height of [IH, 1080]) {
  const y = scrollYForVideoTime(0.4, height);
  const label = height === IH ? "390x844" : "1080p  ";
  const cell = (clipS: number) =>
    `forward ${clampBankPx(y, HUGE_BANK_PX, height, clipS).toFixed(1)} px, ` +
    `backward ${clampBankPx(y, -HUGE_BANK_PX, height, clipS).toFixed(1)} px`;
  console.log(
    `  ${label} at t=0.40  finger ${SCROLL_BANK_MAX_CLIP_S_TOUCH}s: ` +
      `${cell(SCROLL_BANK_MAX_CLIP_S_TOUCH)}`,
  );
  console.log(
    `  ${label} at t=0.40  wheel  ${SCROLL_BANK_MAX_CLIP_S_WHEEL}s: ` +
      `${cell(SCROLL_BANK_MAX_CLIP_S_WHEEL)}`,
  );
}
console.log("\u2713 scroll governor (uniform mapping + page-speed cap + per-source bank)");
