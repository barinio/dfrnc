// 1:1 port of the reference loader animations:
//   load_loop.html  → drawLoopFrame   (endless bouncing traverse)
//   load_final.html → drawSettleFrame (momentum decays, balls roll off)
// Pure functions of elapsed time — the Loader component owns the rAF loop.

export const TRAVEL_DURATION = 2500;
export const PAUSE_DURATION = 1500;
export const TOTAL_CYCLE = TRAVEL_DURATION + PAUSE_DURATION;
const BALL_COLOR = "#FFFFFF";

// bounceSpeed sets bounce frequency (= 4 * bounceSpeed). Spread these out and
// keep them mutually un-synced so no pair appears to bounce in unison. Higher
// frequency = lower arc, so frequency stays inversely tied to bounceHeight.
const LOOP_BALLS = [
  { phase: 0, entryPhase: 0.5, bounceHeight: 0.25, bounceSpeed: 1.175 },
  { phase: 0.084, entryPhase: 0.72, bounceHeight: 0.3, bounceSpeed: 0.675 },
  { phase: 0.1596, entryPhase: 0.33, bounceHeight: 0.2, bounceSpeed: 1.475 },
  { phase: 0.273, entryPhase: 0.58, bounceHeight: 0.27, bounceSpeed: 0.975 },
];

const SETTLE_BALLS = [
  { finalPhase: 0, bounceHeight: 0.25, bounceSpeed: 1.0 },
  { finalPhase: 0.18, bounceHeight: 0.3, bounceSpeed: 0.9 },
  { finalPhase: 0.4, bounceHeight: 0.2, bounceSpeed: 1.1 },
  { finalPhase: 0.66, bounceHeight: 0.27, bounceSpeed: 0.95 },
];

const INITIAL_MOMENTUM = 0.6;
const ROLL_START = 0.47; // where bounces go small and friction begins
const ROLL_FLOOR = 0.6; // speed (fraction of cruise) at the end of the roll
const ROLL_TERMINAL = 0.3; // speed the tail keeps easing toward rolling off
const ROLL_TAIL_K = 1.0; // how quickly the tail bleeds toward terminal
const PURE_ROLL_WIDTH = 0.08; // last ~8% of travel is pure rolling

function ballRadius(w: number, h: number): number {
  return w > h ? h * 0.02 : w * 0.02;
}

// Squash/stretch at ground contact, computed BEFORE the ground position so the
// contact point can account for the compressed half-height.
function squash(
  bounceArc: number,
  momentum: number,
): { scaleX: number; scaleY: number; isCompressed: boolean } {
  let scaleX = 1;
  let scaleY = 1;
  let isCompressed = false;
  if (bounceArc < 0.15 && momentum > 0.2) {
    const deformAmount = 1 - bounceArc / 0.15;
    const compressionScale = Math.min(momentum / 0.4, 1);
    scaleY = 1 - deformAmount * 0.4 * compressionScale;
    const horizontalStretch = deformAmount < 0.5 ? 0.15 : 0.3;
    scaleX = 1 + deformAmount * horizontalStretch * compressionScale;
    isCompressed = true;
  }
  return { scaleX, scaleY, isCompressed };
}

// Draw one ball, optionally with the 3-ghost motion-blur trail.
function renderBall(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scaleX: number,
  scaleY: number,
  r: number,
  blur: { vx: number; vy: number } | null,
): void {
  if (blur) {
    const mag = Math.sqrt(blur.vx * blur.vx + blur.vy * blur.vy);
    const blurLength = mag * 0.4;
    const dirX = blur.vx / mag;
    const dirY = blur.vy / mag;
    for (let i = 2; i >= 0; i--) {
      const off = (i / 3) * blurLength;
      ctx.save();
      ctx.globalAlpha = 0.1 + 0.9 * (i / 2);
      ctx.translate(x - dirX * off, y - dirY * off);
      ctx.scale(scaleX, scaleY);
      ctx.fillStyle = BALL_COLOR;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  } else {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scaleX, scaleY);
    ctx.fillStyle = BALL_COLOR;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ── loop phase ────────────────────────────────────────────────────────────────

export function drawLoopFrame(
  ctx: CanvasRenderingContext2D,
  elapsedMs: number,
  w: number,
  h: number,
): void {
  const r = ballRadius(w, h);
  for (const ball of LOOP_BALLS) {
    const cycleTime = (elapsedMs + ball.phase * TOTAL_CYCLE) % TOTAL_CYCLE;
    if (cycleTime >= TRAVEL_DURATION) continue;
    const progress = cycleTime / TRAVEL_DURATION;
    const x = -r + progress * (w + r * 2);

    const momentumLoss = 1 - progress * 0.25;
    const bounceFrequency = 4 * ball.bounceSpeed;
    // Per-ball entry offset: each ball enters at a different point in its arc,
    // so they don't all materialise at the apex.
    const bounceProgress = (progress * bounceFrequency + ball.entryPhase) % 1;
    const bounceArc = Math.sin(bounceProgress * Math.PI);
    const easedArc = 1 - Math.pow(1 - bounceArc, 2);
    const bounceHeight = h * ball.bounceHeight * momentumLoss;

    const { scaleX, scaleY, isCompressed } = squash(bounceArc, momentumLoss);

    // Rest the BOTTOM edge on the floor (not the center), so the ball can't
    // sink half-below the bottom edge at contact.
    const groundY = h - r * scaleY;
    const y = groundY - easedArc * bounceHeight;

    const vx = ((w + r * 2) / TRAVEL_DURATION) * 16.67;
    const vy = Math.cos(bounceProgress * Math.PI) * bounceHeight * 0.05;
    const shouldBlur = !isCompressed && bounceArc < 0.4 && momentumLoss > 0.2;
    renderBall(ctx, x, y, scaleX, scaleY, r, shouldBlur ? { vx, vy } : null);
  }
}

// True when no loop ball is on screen (all are in their pause segment) — the
// seamless moment to switch from loop to settle.
export function loopScreenEmpty(elapsedMs: number): boolean {
  return LOOP_BALLS.every(
    (b) =>
      (elapsedMs + b.phase * TOTAL_CYCLE) % TOTAL_CYCLE >= TRAVEL_DURATION,
  );
}

// ── settle phase ─────────────────────────────────────────────────────────────

// Remaining bounce energy at a given point across the screen (drives bounce
// height, squash and blur). Decay completes at 60% across, so the ball loses
// momentum fast and the low-energy rolling phase begins early.
function momentumAt(progress: number): number {
  const lossProgress = Math.min(progress / 0.6, 1);
  return INITIAL_MOMENTUM * (1 - Math.pow(lossProgress, 1.5) * 0.98);
}

// Horizontal speed: balls arrive at full cruise speed, decelerate steadily
// through the roll to ROLL_FLOOR of cruise, then keep gently slowing toward
// ROLL_TERMINAL as they roll off the right edge — never zero, so the trailing
// balls never catch and overlap the lead ball.
function speedFactor(progress: number): number {
  if (progress <= ROLL_START) return 1;
  const s = (progress - ROLL_START) / (1 - ROLL_START);
  if (s <= 1) return 1 - (1 - ROLL_FLOOR) * s;
  return (
    ROLL_TERMINAL +
    (ROLL_FLOOR - ROLL_TERMINAL) * Math.exp(-(s - 1) * ROLL_TAIL_K)
  );
}

// Distance travelled (integral of speed) by a given progress. Drives the
// horizontal position directly; cruise speed equals the loop's.
function horizontalDistance(progress: number): number {
  const steps = 240;
  const dp = progress / steps;
  let dist = 0;
  let prev = speedFactor(0);
  for (let i = 1; i <= steps; i++) {
    const s = speedFactor(dp * i);
    dist += (prev + s) * 0.5 * dp;
    prev = s;
  }
  return dist;
}

const FINAL_TRAVEL = horizontalDistance(1);
const PURE_ROLL_TRAVEL = FINAL_TRAVEL - PURE_ROLL_WIDTH;

// Flutter amplitude vs. travelled distance: full while bouncing, fading to
// zero so the last ~8% of the path is pure rolling — flat, no vertical motion.
function flutterDamp(travel: number): number {
  if (travel <= ROLL_START) return 1;
  if (travel >= PURE_ROLL_TRAVEL) return 0;
  return 1 - (travel - ROLL_START) / (PURE_ROLL_TRAVEL - ROLL_START);
}

// Number of completed bounces by a given progress. Real physics: time between
// bounces ∝ sqrt(bounce height), so instantaneous frequency ∝ 1/sqrt(energy).
// Phase is the time-INTEGRAL of that frequency, accumulated by trapezoidal
// integration so the cadence stays physically consistent as the ball decays.
function bouncePhase(progress: number, bounceSpeed: number): number {
  const baseFrequency = 4 * bounceSpeed;
  const steps = 240;
  const dp = progress / steps;
  let phase = 0;
  let prevRate = 1;
  for (let i = 1; i <= steps; i++) {
    const rate = Math.sqrt(INITIAL_MOMENTUM / momentumAt(dp * i));
    phase += (prevRate + rate) * 0.5 * dp;
    prevRate = rate;
  }
  return baseFrequency * phase;
}

// Draw the settle frame. Returns true once EVERY ball has rolled fully off the
// right edge — the loader's completion signal.
export function drawSettleFrame(
  ctx: CanvasRenderingContext2D,
  elapsedMs: number,
  w: number,
  h: number,
): boolean {
  const r = ballRadius(w, h);
  let allDone = true;
  for (const ball of SETTLE_BALLS) {
    const cycleTime = elapsedMs - ball.finalPhase * PAUSE_DURATION;
    if (cycleTime < 0) {
      allDone = false;
      continue;
    }
    const progress = cycleTime / TRAVEL_DURATION;
    const travel = horizontalDistance(progress);
    if (travel > 1) continue; // rolled fully off — done
    allDone = false;
    const x = -r + travel * (w + r * 2);

    const momentumLoss = momentumAt(progress);
    // +0.5 so the ball enters at the apex of its arc, not the ground.
    const phase = bouncePhase(progress, ball.bounceSpeed);
    const bounceProgress = (phase + 0.5) % 1;
    const bounceArc = Math.sin(bounceProgress * Math.PI);
    const easedArc = 1 - Math.pow(1 - bounceArc, 2);
    const bounceHeight =
      h * ball.bounceHeight * momentumLoss * flutterDamp(travel) * 1.1;

    const { scaleX, scaleY, isCompressed } = squash(bounceArc, momentumLoss);

    const groundY = h - r * scaleY;
    const y = groundY - easedArc * bounceHeight;

    const vx = ((w + r * 2) / TRAVEL_DURATION) * 16.67;
    const vy = Math.cos(bounceProgress * Math.PI) * bounceHeight * 0.05;
    const shouldBlur = !isCompressed && bounceArc < 0.4 && momentumLoss > 0.2;
    renderBall(ctx, x, y, scaleX, scaleY, r, shouldBlur ? { vx, vy } : null);
  }
  return allDone;
}
