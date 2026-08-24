// Rate-limited frame scrub assertions. No test runner in this project — run
// manually with:  npx tsx scripts/check-frame-scrub.ts
//
// The displayed frame stays SCROLL-BOUND (its target is a pure function of
// scroll position) but is only allowed to CHASE that target at a bounded frame
// rate, so a flick that moves the target 15 frames in one rAF tick no longer
// paints a 15-frame jump. These assertions pin the chase arithmetic: the cap in
// both directions, the anti-tail snap, the delta clamp and the range clamp.
import {
  advanceScrubFrame,
  scrubTargetFrameFor,
  FORWARD_SCRUB_FPS,
  BACKWARD_SCRUB_FPS,
  MAX_SCRUB_LAG_FRAMES,
  MAX_SCRUB_DELTA_S,
} from "../src/frameScrub";
import { FRAME_COUNT } from "../src/frames";

function ok(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(label);
}

function eq(actual: number, expected: number, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function near(
  actual: number,
  expected: number,
  label: string,
  eps = 1e-9,
): void {
  if (!(Math.abs(actual - expected) <= eps)) {
    throw new Error(`${label}: expected ≈${expected}, got ${actual}`);
  }
}

const TICK = 1 / 60; // one rAF tick at 60 Hz
const COUNT = 295;
const LAST = COUNT - 1;
const opts = { count: COUNT };

// ── Tuning constants ──────────────────────────────────────────────────────
{
  eq(FORWARD_SCRUB_FPS, 25, "forward cap is 25 sequence-frames/s");
  eq(BACKWARD_SCRUB_FPS, 25, "backward cap is 25 sequence-frames/s");
  eq(MAX_SCRUB_LAG_FRAMES, 50, "anti-tail lag budget is 50 frames (≈2 s)");
  ok(MAX_SCRUB_DELTA_S > 0 && MAX_SCRUB_DELTA_S <= 0.25, "delta clamp is sane");
  console.log("✓ scrub constants");
}

// ── Float scroll target ───────────────────────────────────────────────────
{
  eq(scrubTargetFrameFor(0, COUNT), 0, "t=0 ⇒ first frame");
  eq(scrubTargetFrameFor(1, COUNT), LAST, "t=1 ⇒ last frame");
  near(scrubTargetFrameFor(0.5, COUNT), LAST / 2, "t=0.5 ⇒ mid, un-rounded");
  // The point of the float target: it does NOT snap to integers.
  const t = 0.12345;
  ok(
    scrubTargetFrameFor(t, COUNT) !== Math.round(scrubTargetFrameFor(t, COUNT)),
    "target keeps sub-frame precision",
  );
  eq(scrubTargetFrameFor(-3, COUNT), 0, "t below 0 clamps");
  eq(scrubTargetFrameFor(9, COUNT), LAST, "t above 1 clamps");
  eq(scrubTargetFrameFor(Number.NaN, COUNT), 0, "NaN t ⇒ first frame");
  eq(scrubTargetFrameFor(1, 1), 0, "single-frame clip ⇒ 0");
  eq(scrubTargetFrameFor(0.5), scrubTargetFrameFor(0.5, FRAME_COUNT),
    "default count is the manifest count");
  console.log("✓ float scroll target");
}

// ── Initialization: no animation on the first painted frame ───────────────
{
  eq(advanceScrubFrame(null, 137.4, TICK, opts), 137.4, "null ⇒ snap to target");
  eq(advanceScrubFrame(null, 137.4, 0, opts), 137.4, "null snaps with dt=0 too");
  eq(advanceScrubFrame(Number.NaN, 137.4, TICK, opts), 137.4, "NaN ⇒ snap");
  eq(advanceScrubFrame(null, -8, TICK, opts), 0, "null snap clamps low");
  eq(advanceScrubFrame(null, 1e6, TICK, opts), LAST, "null snap clamps high");
  console.log("✓ initialization");
}

// ── Slow scroll: pure binding, displayed === target ───────────────────────
{
  // A per-tick target step BELOW the cap (25/60 ≈ 0.4167 frames) must be
  // followed exactly — the rate limit must not add lag to ordinary scrolling.
  let displayed: number | null = 40;
  let target = 40;
  for (let i = 0; i < 200; i++) {
    target += 0.3;
    displayed = advanceScrubFrame(displayed, target, TICK, opts);
    near(displayed, target, `slow forward tick ${i} tracks exactly`);
  }
  for (let i = 0; i < 200; i++) {
    target -= 0.3;
    displayed = advanceScrubFrame(displayed, target, TICK, opts);
    near(displayed, target, `slow backward tick ${i} tracks exactly`);
  }
  // Already parked on the target ⇒ nothing moves.
  eq(advanceScrubFrame(88, 88, TICK, opts), 88, "stationary stays put");
  console.log("✓ slow scroll is exact binding");
}

// ── Fast forward jump is capped at FORWARD_SCRUB_FPS ──────────────────────
{
  const stepped = advanceScrubFrame(100, 140, TICK, opts);
  near(stepped, 100 + FORWARD_SCRUB_FPS * TICK, "forward step = fps * dt");
  ok(stepped < 140, "forward step does not reach a far target");

  // A flick that lands 40 frames ahead (inside the lag budget, so no snap) and
  // stops: every tick moves at most the cap, and the catch-up takes
  // 40 / 25 = 1.6 s ≈ 96 ticks.
  let displayed: number | null = 20;
  const target = 60;
  let maxTickDelta = 0;
  let ticks = 0;
  while (displayed !== target && ticks < 10000) {
    const before = displayed as number;
    displayed = advanceScrubFrame(displayed, target, TICK, opts);
    maxTickDelta = Math.max(maxTickDelta, displayed - before);
    ticks++;
  }
  ok(
    maxTickDelta <= FORWARD_SCRUB_FPS * TICK + 1e-9,
    `forward per-tick delta capped (was ${maxTickDelta})`,
  );
  eq(displayed, target, "forward catch-up finally lands on the target");
  ok(
    ticks >= 94 && ticks <= 99,
    `forward catch-up takes ≈96 ticks (was ${ticks})`,
  );
  console.log("✓ forward cap");
}

// ── Fast backward jump is capped at BACKWARD_SCRUB_FPS ────────────────────
{
  const stepped = advanceScrubFrame(140, 100, TICK, opts);
  near(stepped, 140 - BACKWARD_SCRUB_FPS * TICK, "backward step = fps * dt");
  ok(stepped > 100, "backward step does not reach a far target");

  let displayed: number | null = 60;
  const target = 20;
  let maxTickDelta = 0;
  let ticks = 0;
  while (displayed !== target && ticks < 10000) {
    const before = displayed as number;
    displayed = advanceScrubFrame(displayed, target, TICK, opts);
    maxTickDelta = Math.max(maxTickDelta, before - displayed);
    ticks++;
  }
  ok(
    maxTickDelta <= BACKWARD_SCRUB_FPS * TICK + 1e-9,
    `backward per-tick delta capped (was ${maxTickDelta})`,
  );
  eq(displayed, target, "backward catch-up finally lands on the target");
  ok(
    ticks >= 94 && ticks <= 99,
    `backward catch-up takes ≈96 ticks (was ${ticks})`,
  );
  console.log("✓ backward cap");
}

// ── The two caps are independent knobs ────────────────────────────────────
{
  const asym = { count: COUNT, forwardFps: 10, backwardFps: 50 };
  near(advanceScrubFrame(100, 130, TICK, asym), 100 + 10 * TICK, "custom forward fps");
  near(advanceScrubFrame(100, 70, TICK, asym), 100 - 50 * TICK, "custom backward fps");
  // …and a custom lag budget is honoured too.
  near(
    advanceScrubFrame(10, 200, TICK, { count: COUNT, maxLagFrames: 20 }),
    200 - 20 + FORWARD_SCRUB_FPS * TICK,
    "custom lag budget",
  );
  console.log("✓ per-direction caps");
}

// ── Never overshoot the target ────────────────────────────────────────────
{
  // dt large enough for 25 frames of travel, target only 0.1 away.
  eq(advanceScrubFrame(100, 100.1, 1, opts), 100.1, "forward lands exactly");
  eq(advanceScrubFrame(100, 99.9, 1, opts), 99.9, "backward lands exactly");
  console.log("✓ no overshoot");
}

// ── Anti-tail: a gap wider than MAX_SCRUB_LAG_FRAMES snaps forward ────────
{
  // Gap 190 ≫ 50 ⇒ jump to target − 50, then chase from there at the cap.
  const forward = advanceScrubFrame(10, 200, TICK, opts);
  near(
    forward,
    200 - MAX_SCRUB_LAG_FRAMES + FORWARD_SCRUB_FPS * TICK,
    "forward anti-tail snap + capped step",
  );
  const backward = advanceScrubFrame(250, 10, TICK, opts);
  near(
    backward,
    10 + MAX_SCRUB_LAG_FRAMES - BACKWARD_SCRUB_FPS * TICK,
    "backward anti-tail snap + capped step",
  );
  // Exactly at the budget: no snap, just a capped step.
  near(
    advanceScrubFrame(100, 100 + MAX_SCRUB_LAG_FRAMES, TICK, opts),
    100 + FORWARD_SCRUB_FPS * TICK,
    "a gap equal to the budget does not snap",
  );
  // Worst case (whole clip) still recovers within the budget's 2 s, not 12 s.
  let displayed: number | null = 0;
  let ticks = 0;
  while (displayed !== LAST && ticks < 10000) {
    displayed = advanceScrubFrame(displayed, LAST, TICK, opts);
    ticks++;
  }
  ok(
    ticks <= Math.ceil((MAX_SCRUB_LAG_FRAMES / FORWARD_SCRUB_FPS) / TICK) + 2,
    `full-clip jump recovers within the lag budget (${ticks} ticks)`,
  );
  console.log("✓ anti-tail snap");
}

// ── Delta clamp: a backgrounded tab must not teleport the frame ───────────
{
  near(
    advanceScrubFrame(100, 280, 5, opts),
    // 180 > 50 ⇒ snap to 230, then at most MAX_SCRUB_DELTA_S of travel.
    280 - MAX_SCRUB_LAG_FRAMES + FORWARD_SCRUB_FPS * MAX_SCRUB_DELTA_S,
    "huge dt is clamped",
  );
  near(
    advanceScrubFrame(100, 140, 5, opts),
    100 + FORWARD_SCRUB_FPS * MAX_SCRUB_DELTA_S,
    "huge dt is clamped without a snap",
  );
  eq(advanceScrubFrame(100, 140, 0, opts), 100, "dt=0 holds the frame");
  eq(advanceScrubFrame(100, 140, -2, opts), 100, "negative dt holds the frame");
  eq(advanceScrubFrame(100, 140, Number.NaN, opts), 100, "NaN dt holds the frame");
  console.log("✓ delta clamp");
}

// ── Range clamp ───────────────────────────────────────────────────────────
{
  eq(advanceScrubFrame(0, -50, 1, opts), 0, "cannot go below 0");
  eq(advanceScrubFrame(LAST, 1e6, 1, opts), LAST, "cannot go past the last frame");
  ok(advanceScrubFrame(-40, 10, TICK, opts) >= 0, "out-of-range displayed clamps in");
  ok(
    advanceScrubFrame(1e6, 10, TICK, opts) <= LAST,
    "out-of-range displayed clamps in from above",
  );
  eq(advanceScrubFrame(0, 5, TICK, { count: 1 }), 0, "single-frame clip pins to 0");
  eq(advanceScrubFrame(null, 5, TICK, { count: 0 }), 0, "empty clip pins to 0");
  console.log("✓ range clamp");
}

// ── End-to-end: a flick never paints a multi-frame jump ───────────────────
{
  // The real symptom: one wheel notch / trackpad flick drags the scroll target
  // 15 frames in a single rAF tick. Model a burst (a few such ticks, total
  // travel inside the lag budget) followed by the release, forwards then back.
  // The PAINTED (rounded) index must never move more than ~1 frame per tick.
  const perTick = Math.ceil(FORWARD_SCRUB_FPS * TICK); // 25/60 ≈ 0.42 ⇒ ≤ 1
  let displayed: number | null = null;
  let target = 100;
  let painted = 100;
  let maxJump = 0;
  const run = (delta: number, steps: number) => {
    for (let i = 0; i < steps; i++) {
      target = Math.min(Math.max(target + delta, 0), LAST);
      const first = displayed === null;
      displayed = advanceScrubFrame(displayed, target, TICK, opts);
      const next = Math.round(displayed);
      if (!first) maxJump = Math.max(maxJump, Math.abs(next - painted));
      painted = next;
    }
  };
  run(0, 1); // settle: first tick adopts the target
  run(15, 3); // flick forward: +45 frames of scroll in 3 ticks
  run(0, 150); // release: the frame chases at the cap
  eq(painted, Math.round(target), "forward flick fully catches up");
  run(-15, 3); // flick back
  run(0, 150);
  eq(painted, Math.round(target), "backward flick fully catches up");
  ok(maxJump <= perTick, `painted index moves ≤ ${perTick} frame/tick (was ${maxJump})`);
  console.log("✓ flick never jumps");
}

// ── Saturation contract: a drag faster than the cap pins the lag, never more ─
{
  // Scroll dragged continuously at 15 frames/tick outruns the 25 f/s cap. The
  // displayed frame then rides exactly MAX_SCRUB_LAG_FRAMES behind (it cannot
  // fall further, and it cannot lead the target). This is the documented cost
  // of the anti-tail snap: while saturated the frame moves at the scroll's
  // pace, as it did before the cap existed.
  let displayed: number | null = 0;
  let target = 0;
  let maxLag = 0;
  for (let i = 0; i < 200; i++) {
    target = Math.min(target + 15, LAST);
    displayed = advanceScrubFrame(displayed, target, TICK, opts);
    maxLag = Math.max(maxLag, target - displayed);
    ok(displayed <= target + 1e-9, "displayed never leads the target");
  }
  ok(
    maxLag <= MAX_SCRUB_LAG_FRAMES + 1e-9,
    `saturated lag never exceeds the budget (was ${maxLag})`,
  );
  console.log("✓ saturation pins the lag");
}

console.log("check-frame-scrub: all assertions passed");
