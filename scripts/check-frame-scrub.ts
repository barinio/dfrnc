// Rate-limited frame scrub assertions. No test runner in this project — run
// manually with:  npx tsx scripts/check-frame-scrub.ts
//
// The contract: the displayed frame stays SCROLL-BOUND (its target is a pure
// function of scroll position) but may never advance faster than the source clip
// runs. Scroll slower than native ⇒ the frame follows the scroll exactly. Scroll
// faster ⇒ the frame keeps moving at 1× and falls behind, catching up after the
// scroll stops. There is NO lag clamp: the old anti-tail snap re-seated the
// displayed frame near the target once the gap passed 50 frames, which cancelled
// the cap exactly when a flick made it matter. These assertions pin the chase
// arithmetic: the symmetric native cap, the absence of any snap, the delta clamp
// and the range clamp.
import {
  advanceScrubFrame,
  scrubTargetFrameFor,
  NATIVE_SCRUB_FPS,
  MAX_SCRUB_DELTA_S,
} from "../src/frameScrub";
import { FRAME_MANIFEST } from "../src/frameManifest";
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
  eq(NATIVE_SCRUB_FPS, 12.5, "native cap is 12.5 sequence-frames/s");
  // …and it is DERIVED from how the sequence was sampled, not a literal: the
  // WebP sequence keeps every `stride`-th frame of a `sourceFps` master.
  eq(
    NATIVE_SCRUB_FPS,
    FRAME_MANIFEST.sourceFps / FRAME_MANIFEST.stride,
    "native cap = manifest sourceFps / stride",
  );
  eq(FRAME_MANIFEST.sourceFps, 25, "master clip is 25 fps");
  eq(FRAME_MANIFEST.stride, 2, "sequence keeps every second source frame");
  eq(MAX_SCRUB_DELTA_S, 0.25, "delta clamp is 0.25 s");
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

// ── Initialization: the ONLY legitimate snap ──────────────────────────────
{
  eq(advanceScrubFrame(null, 137.4, TICK, opts), 137.4, "null ⇒ snap to target");
  eq(advanceScrubFrame(null, 137.4, 0, opts), 137.4, "null snaps with dt=0 too");
  eq(advanceScrubFrame(Number.NaN, 137.4, TICK, opts), 137.4, "NaN ⇒ snap");
  eq(advanceScrubFrame(null, -8, TICK, opts), 0, "null snap clamps low");
  eq(advanceScrubFrame(null, 1e6, TICK, opts), LAST, "null snap clamps high");
  // A real (non-null) position NEVER snaps, however far the target is.
  near(
    advanceScrubFrame(0, LAST, TICK, opts),
    NATIVE_SCRUB_FPS * TICK,
    "an established position never snaps, whatever the gap",
  );
  console.log("✓ initialization");
}

// ── Slow scroll: pure binding, displayed === target ───────────────────────
{
  // A per-tick target step BELOW the cap (12.5/60 ≈ 0.208 frames) must be
  // followed exactly — the rate limit must not add lag to ordinary scrolling.
  let displayed: number | null = 40;
  let target = 40;
  for (let i = 0; i < 200; i++) {
    target += 0.15;
    displayed = advanceScrubFrame(displayed, target, TICK, opts);
    near(displayed, target, `slow forward tick ${i} tracks exactly`);
  }
  for (let i = 0; i < 200; i++) {
    target -= 0.15;
    displayed = advanceScrubFrame(displayed, target, TICK, opts);
    near(displayed, target, `slow backward tick ${i} tracks exactly`);
  }
  // Already parked on the target ⇒ nothing moves.
  eq(advanceScrubFrame(88, 88, TICK, opts), 88, "stationary stays put");
  console.log("✓ slow scroll is exact binding");
}

// ── Fast forward jump is capped at the native rate ────────────────────────
{
  const stepped = advanceScrubFrame(100, 140, TICK, opts);
  near(stepped, 100 + NATIVE_SCRUB_FPS * TICK, "forward step = fps * dt");
  ok(stepped < 140, "forward step does not reach a far target");

  // A flick that lands 40 frames ahead and stops: every tick moves at most the
  // cap, and the catch-up takes 40 / 12.5 = 3.2 s ≈ 192 ticks.
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
    maxTickDelta <= NATIVE_SCRUB_FPS * TICK + 1e-9,
    `forward per-tick delta capped (was ${maxTickDelta})`,
  );
  eq(displayed, target, "forward catch-up finally lands on the target");
  ok(
    ticks >= 190 && ticks <= 195,
    `forward catch-up takes ≈192 ticks (was ${ticks})`,
  );
  console.log("✓ forward cap");
}

// ── Fast backward jump is capped at the same native rate ──────────────────
{
  const stepped = advanceScrubFrame(140, 100, TICK, opts);
  near(stepped, 140 - NATIVE_SCRUB_FPS * TICK, "backward step = fps * dt");
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
    maxTickDelta <= NATIVE_SCRUB_FPS * TICK + 1e-9,
    `backward per-tick delta capped (was ${maxTickDelta})`,
  );
  eq(displayed, target, "backward catch-up finally lands on the target");
  ok(
    ticks >= 190 && ticks <= 195,
    `backward catch-up takes ≈192 ticks (was ${ticks})`,
  );
  console.log("✓ backward cap");
}

// ── The cap is SYMMETRIC, with one overridable knob ───────────────────────
{
  near(
    advanceScrubFrame(100, 130, TICK, opts) - 100,
    100 - advanceScrubFrame(100, 70, TICK, opts),
    "forward and backward move by the same amount",
  );
  const slow = { count: COUNT, fps: 10 };
  near(advanceScrubFrame(100, 130, TICK, slow), 100 + 10 * TICK, "custom fps forward");
  near(advanceScrubFrame(100, 70, TICK, slow), 100 - 10 * TICK, "custom fps backward");
  console.log("✓ symmetric cap");
}

// ── Never overshoot the target ────────────────────────────────────────────
{
  // dt large enough for several frames of travel, target only 0.1 away.
  eq(advanceScrubFrame(100, 100.1, 1, opts), 100.1, "forward lands exactly");
  eq(advanceScrubFrame(100, 99.9, 1, opts), 99.9, "backward lands exactly");
  console.log("✓ no overshoot");
}

// ── No lag clamp: a whole-clip gap is WALKED, never snapped ───────────────
{
  // The deleted anti-tail snap used to re-seat `displayed` 50 frames from the
  // target, so a saturated flick painted frames at raw scroll speed. Now the
  // first step after any gap is exactly one capped step.
  near(
    advanceScrubFrame(10, 200, TICK, opts),
    10 + NATIVE_SCRUB_FPS * TICK,
    "a 190-frame gap still moves one capped step",
  );
  near(
    advanceScrubFrame(250, 10, TICK, opts),
    250 - NATIVE_SCRUB_FPS * TICK,
    "a 240-frame backward gap still moves one capped step",
  );
  // Worst case: the whole clip, walked at the native rate — 294 / 12.5 ≈ 23.5 s.
  let displayed: number | null = 0;
  let ticks = 0;
  while (displayed !== LAST && ticks < 100000) {
    displayed = advanceScrubFrame(displayed, LAST, TICK, opts);
    ticks++;
  }
  const seconds = ticks * TICK;
  ok(
    Math.abs(seconds - LAST / NATIVE_SCRUB_FPS) <= 2 * TICK,
    `full-clip jump takes the clip's own running time (${seconds.toFixed(3)} s)`,
  );
  eq(displayed, LAST, "full-clip jump still arrives");
  console.log("✓ no lag clamp");
}

// ── Delta clamp: a backgrounded tab must not teleport the frame ───────────
{
  const clamped = 100 + NATIVE_SCRUB_FPS * MAX_SCRUB_DELTA_S;
  near(advanceScrubFrame(100, 140, 5, opts), clamped, "huge dt is clamped");
  near(
    advanceScrubFrame(100, 280, 5, opts),
    clamped,
    "huge dt is clamped the same way however far the target is",
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
  // 15 frames in a single rAF tick. Model a burst followed by the release,
  // forwards then back. The PAINTED (rounded) index must never move more than
  // ~1 frame per tick.
  const perTick = Math.ceil(NATIVE_SCRUB_FPS * TICK); // 12.5/60 ≈ 0.21 ⇒ ≤ 1
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
  run(0, 300); // release: the frame chases at the native rate (45/12.5 = 3.6 s)
  eq(painted, Math.round(target), "forward flick fully catches up");
  run(-15, 3); // flick back
  run(0, 300);
  eq(painted, Math.round(target), "backward flick fully catches up");
  ok(maxJump <= perTick, `painted index moves ≤ ${perTick} frame/tick (was ${maxJump})`);
  console.log("✓ flick never jumps");
}

// ── Synthetic ride: the painted frame NEVER outruns the clip ──────────────
// The client-facing assertion. Scroll teleports the target across the whole clip
// in 0.2 s and then holds. Whatever the rAF cadence, the PAINTED index may not
// gain more than NATIVE_SCRUB_FPS frames per wall second (+1 for rounding) over
// ANY interval of the ride — and it must still arrive, because nothing snaps.
{
  interface Ride {
    maxForwardRate: number;
    maxBackwardRate: number;
    maxFloatRate: number;
    arrivedAt: number | null;
    seconds: number;
  }

  // painted[j] − painted[i] ≤ NATIVE * (t[j] − t[i]) + 1 for every i < j is
  // exactly u[j] ≤ min(u[0..j−1]) + 1 with u[k] = painted[k] − NATIVE * t[k],
  // so a running minimum checks every interval in one pass.
  function ride(dt: number, from: number, to: number, label: string): Ride {
    const rampSeconds = 0.2;
    const holdSeconds = 40; // long enough for the whole clip at 12.5 f/s
    let displayed: number | null = from;
    let elapsed = 0;
    let painted = Math.round(from);
    let minForward = painted - NATIVE_SCRUB_FPS * elapsed;
    let minBackward = -painted - NATIVE_SCRUB_FPS * elapsed;
    let excessForward = 0;
    let excessBackward = 0;
    let arrivedAt: number | null = null;
    // 1 s sliding window of samples, for the reported frames-per-second rate.
    const window: Array<{ t: number; painted: number; float: number }> = [
      { t: 0, painted, float: from },
    ];
    let maxForwardRate = 0;
    let maxBackwardRate = 0;
    let maxFloatRate = 0;

    while (elapsed < rampSeconds + holdSeconds) {
      elapsed += dt;
      const ramp = Math.min(elapsed / rampSeconds, 1);
      const target = from + (to - from) * ramp;
      displayed = advanceScrubFrame(displayed, target, dt, opts);
      painted = Math.round(displayed);

      const u = painted - NATIVE_SCRUB_FPS * elapsed;
      const v = -painted - NATIVE_SCRUB_FPS * elapsed;
      excessForward = Math.max(excessForward, u - minForward);
      excessBackward = Math.max(excessBackward, v - minBackward);
      minForward = Math.min(minForward, u);
      minBackward = Math.min(minBackward, v);

      window.push({ t: elapsed, painted, float: displayed });
      while (window.length > 1 && elapsed - window[0].t > 1) window.shift();
      const span = elapsed - window[0].t;
      if (span >= 0.5) {
        const rate = (painted - window[0].painted) / span;
        maxForwardRate = Math.max(maxForwardRate, rate);
        maxBackwardRate = Math.max(maxBackwardRate, -rate);
        maxFloatRate = Math.max(
          maxFloatRate,
          Math.abs(displayed - window[0].float) / span,
        );
      }
      if (arrivedAt === null && painted === Math.round(to)) arrivedAt = elapsed;
    }

    ok(
      excessForward <= 1 + 1e-9,
      `${label}: painted index gains ≤ NATIVE*elapsed + 1 forward (excess ${excessForward})`,
    );
    ok(
      excessBackward <= 1 + 1e-9,
      `${label}: painted index gains ≤ NATIVE*elapsed + 1 backward (excess ${excessBackward})`,
    );
    ok(arrivedAt !== null, `${label}: the chase still reaches the target (no clamp)`);
    ok(
      maxFloatRate <= NATIVE_SCRUB_FPS + 1e-9,
      `${label}: un-rounded chase rate never exceeds the native pace (${maxFloatRate})`,
    );
    return { maxForwardRate, maxBackwardRate, maxFloatRate, arrivedAt, seconds: elapsed };
  }

  let worst = 0;
  const peaks: string[] = [];
  for (const dt of [1 / 60, 1 / 120, 1 / 8]) {
    const hz = (1 / dt).toFixed(0);
    const fwd = ride(dt, 0, LAST, `ride forward @${hz}Hz`);
    const back = ride(dt, LAST, 0, `ride backward @${hz}Hz`);
    const peak = Math.max(fwd.maxForwardRate, back.maxBackwardRate);
    const floatPeak = Math.max(fwd.maxFloatRate, back.maxFloatRate);
    peaks.push(`${hz}Hz ${peak.toFixed(3)} (float ${floatPeak.toFixed(3)})`);
    worst = Math.max(worst, peak);
    // It cannot arrive sooner than the clip's own running time, either. The
    // painted index rounds, so it reads "arrived" half a frame early.
    const soonest = (LAST - 0.5) / NATIVE_SCRUB_FPS - 2 * dt;
    ok(
      (fwd.arrivedAt as number) >= soonest,
      `ride forward @${hz}Hz arrives no sooner than the clip runs (${fwd.arrivedAt})`,
    );
    ok(
      (back.arrivedAt as number) >= soonest,
      `ride backward @${hz}Hz arrives no sooner than the clip runs (${back.arrivedAt})`,
    );
  }
  ok(
    worst <= NATIVE_SCRUB_FPS + 1,
    `synthetic ride peak rate ${worst.toFixed(3)} f/s stays at the native pace`,
  );
  // The per-cadence peaks are measured over a ≥0.5 s window on the ROUNDED
  // index, so a coarse tick carries up to ±1 frame of rounding headroom.
  console.log(
    `✓ synthetic ride never outruns the clip (cap ${NATIVE_SCRUB_FPS} f/s; ` +
      `windowed peaks ${peaks.join(", ")})`,
  );
}

console.log("check-frame-scrub: all assertions passed");
