import { FRAME_COUNT } from "./frames";
import { FRAME_MANIFEST } from "./frameManifest";

// Rate-limited frame scrub. The clip stays SCROLL-BOUND — the target frame is
// still a pure function of scroll position (videoMasterTimeFor → t →
// scrubTargetFrameFor) — but the DISPLAYED frame is only allowed to chase that
// target at the clip's NATIVE playback rate. The contract the client keeps
// asking for, in one line: the video NEVER plays faster than the source clip.
// Scroll slower than native ⇒ the frame follows the scroll exactly (it may go
// arbitrarily slowly, or stop, or run backwards). Scroll faster than native ⇒
// the frame keeps running at 1× and simply falls behind, catching up after the
// scroll stops — the "please scroll slower" feel.
//
// NATIVE pace is DERIVED, not guessed: the WebP sequence keeps every
// FRAME_MANIFEST.stride-th frame of a FRAME_MANIFEST.sourceFps master
// (25 fps, 589 frames → stride 2 → 295 sequence frames), so playing the whole
// sequence in clip order at real time is sourceFps / stride = 12.5
// SEQUENCE-frames per second. The old 25 was sequence-frames/s, i.e. exactly 2×
// real time. Both directions use the same cap — a rewind cannot outrun the clip
// either.
function derivedNativeFps(): number {
  const source = FRAME_MANIFEST.sourceFps as number;
  const stride = FRAME_MANIFEST.stride as number;
  if (!Number.isFinite(source) || source <= 0) return 12.5;
  if (!Number.isFinite(stride) || stride <= 0) return source;
  return source / stride;
}

export const NATIVE_SCRUB_FPS = derivedNativeFps();

// Frame-delta clamp. A backgrounded tab (or a long GC pause) hands useFrame a
// multi-second delta on the next tick; without this the "rate limit" would pay
// out the whole backlog at once, i.e. exactly the jump it exists to prevent.
// 0.25 s ≈ 3 native frames — generous enough that a phone rendering at 8 fps
// still gets paid in full, tight enough that a restored tab cannot teleport.
export const MAX_SCRUB_DELTA_S = 0.25;

export interface ScrubOptions {
  // Symmetric cap (sequence-frames per wall second). Defaults to the clip's
  // native pace; exposed so tests and tools can drive the chase explicitly.
  fps?: number;
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
// tick (null ONLY on genuine first paint — then the target is adopted outright,
// so a deep-link / restored scroll position never animates in from frame 0).
// There is deliberately NO lag clamp: a gap of any size is walked at the native
// rate, in both directions. The previous anti-tail snap re-seated `displayed`
// near the target whenever the gap passed 50 frames, which cancelled the cap
// exactly when the user scrolled fast enough to need it.
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

  const from = clamp(displayed, 0, last);
  const gap = goal - from;
  if (gap === 0) return from;

  const step = positive(opts.fps, NATIVE_SCRUB_FPS) * dt;
  if (step >= Math.abs(gap)) return goal;
  return clamp(from + Math.sign(gap) * step, 0, last);
}
