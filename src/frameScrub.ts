import { FRAME_COUNT } from "./frames";

// Rate-limited frame scrub. The clip stays SCROLL-BOUND — the target frame is
// still a pure function of scroll position (videoMasterTimeFor → t →
// scrubTargetFrameFor) — but the DISPLAYED frame is only allowed to chase that
// target at a bounded frame rate. Without a cap a single wheel notch or a
// trackpad flick moves the target 10–15 frames in one rAF tick, and the plane
// paints that as a strobing jump (made worse by FrameSequenceLoader's ±32
// nearest-loaded fallback, which sticks then snaps). Chasing at a fixed rate
// restores the "cinematic" read: scroll still drives the clip, it just cannot
// be dragged faster than a film can run.
//
// 25 sequence-frames/s ≈ 2× native speed. The WebP sequence is every SECOND
// frame of a 25 fps master (589 → 295 frames), so playing all 295 in clip order
// at native pace is 12.5 sequence-frames/s; 25 is a brisk-but-filmic double.
// Both directions are separate knobs (both 25 today) so forward and rewind can
// be tuned independently without touching the call site.
export const FORWARD_SCRUB_FPS = 25;
export const BACKWARD_SCRUB_FPS = 25;

// Anti-tail: how far behind the scroll target the displayed frame may fall.
// 50 frames at 25 f/s = 2 s of catch-up. A scroll that teleports half the clip
// away (anchor jump, keyboard End, a violent flick) snaps to the edge of this
// budget instead of grinding through 12 s of rewind while the page sits still.
export const MAX_SCRUB_LAG_FRAMES = 50;

// Frame-delta clamp. A backgrounded tab (or a long GC pause) hands useFrame a
// multi-second delta on the next tick; without this the "rate limit" would pay
// out the whole backlog at once, i.e. exactly the jump it exists to prevent.
export const MAX_SCRUB_DELTA_S = 0.1;

export interface ScrubOptions {
  forwardFps?: number;
  backwardFps?: number;
  maxLagFrames?: number;
  maxDeltaSeconds?: number;
  count?: number;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}

function positive(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value as number) > 0
    ? (value as number)
    : fallback;
}

function frameSpan(count: number | undefined): number {
  const n = Number.isFinite(count) ? Math.floor(count as number) : FRAME_COUNT;
  return Math.max(n - 1, 0);
}

// Scroll-normalized clip time t∈[0,1] → FLOAT frame position [0, count-1].
// Deliberately un-rounded: frames.ts's frameIndexFor rounds, which would quantise
// the chase target and make sub-frame tracking impossible. Rounding happens once,
// at paint time.
export function scrubTargetFrameFor(t: number, count = FRAME_COUNT): number {
  const last = frameSpan(count);
  if (last <= 0) return 0;
  const x = Number.isFinite(t) ? clamp(t, 0, 1) : 0;
  return x * last;
}

// One tick of the chase. `displayed` is the float frame position painted last
// tick (null on the very first tick — then the target is adopted outright, so
// a deep-link / restored scroll position never animates in from frame 0).
// Returns the new float position; the caller rounds it for display.
export function advanceScrubFrame(
  displayed: number | null,
  target: number,
  deltaSeconds: number,
  opts: ScrubOptions = {},
): number {
  const last = frameSpan(opts.count);
  const goal = clamp(Number.isFinite(target) ? target : 0, 0, last);
  if (displayed === null || !Number.isFinite(displayed)) return goal;

  const maxDelta = positive(opts.maxDeltaSeconds, MAX_SCRUB_DELTA_S);
  const dt = Number.isFinite(deltaSeconds)
    ? clamp(deltaSeconds, 0, maxDelta)
    : 0;

  let from = clamp(displayed, 0, last);
  const lagBudget = positive(opts.maxLagFrames, MAX_SCRUB_LAG_FRAMES);
  let gap = goal - from;
  if (Math.abs(gap) > lagBudget) {
    from = clamp(goal - Math.sign(gap) * lagBudget, 0, last);
    gap = goal - from;
  }
  if (gap === 0) return from;

  const fps =
    gap > 0
      ? positive(opts.forwardFps, FORWARD_SCRUB_FPS)
      : positive(opts.backwardFps, BACKWARD_SCRUB_FPS);
  const step = fps * dt;
  if (step >= Math.abs(gap)) return goal;
  return clamp(from + Math.sign(gap) * step, 0, last);
}
