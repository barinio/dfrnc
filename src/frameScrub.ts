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

// The same native pace expressed in CLIP-TIME units per wall second, which is
// what the scroll governor caps: t ∈ [0,1] spans FRAME_COUNT − 1 frame steps,
// so one native frame is 1 / (FRAME_COUNT − 1) of the clip. Deriving it here
// (rather than in scrollGovernor) keeps ONE definition of "real time" for both
// the painted-frame chase and the page-speed limiter — they are the same rate
// by construction, which is why the cap is automatically 12.5 f/s at every
// VIDEO_TIME_KNOTS slope.
export const NATIVE_CLIP_RATE_PER_S =
  NATIVE_SCRUB_FPS / Math.max(FRAME_COUNT - 1, 1);

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

// ── Showable-frame gate ──────────────────────────────────────────────────────
// `advanceScrubFrame` says where the chase WANTS to be; this says where it is
// allowed to actually go. The chase may only commit to a position the loader
// can put on screen — `shown` is "get() returned an image for this position"
// (including its ±window substitute), or "waiting is pointless because that
// neighbourhood is terminally dead".
//
// This is the rule that keeps the page and the picture together. Before it, the
// chase walked on through undecoded frames, the index it walked to was reported
// as PAINTED, and the decode backpressure below therefore saw a healthy lead
// and let the page run — while the texture sat on the last image that actually
// arrived. The gap was invisible until the frames landed, and then it was paid
// off in ONE step: the jump at the end of a flick. Holding the index instead
// holds the picture, the reported paint and the page together; they resume
// together at the cap, so there is nothing to catch up.
export function commitScrubFrame(
  held: number | null,
  wanted: number,
  shown: boolean,
): number {
  if (shown) return wanted;
  if (held === null || !Number.isFinite(held)) return wanted;
  return held;
}

// ── Painted-frame bridge ─────────────────────────────────────────────────────
// The frame VideoPlane currently has ON THE TEXTURE, at module scope so that a
// VideoPlane remount inside a live session (a Scene re-key, a fast-refresh, a
// tier swap) resumes the chase where it left off instead of treating itself as
// a first paint and adopting the scroll target outright — which would be the one
// remaining way to paint a jump faster than the clip runs.
//
// It is the BOUND frame, not the chase index: an index nobody has seen is not a
// paint, and publishing one is exactly how the page used to run away from the
// picture. Negative values (−1 = nothing bound yet) are therefore not paints
// either and leave the survivor null.
//
// It lives HERE rather than inside the component so the scroll governor can read
// it for decode BACKPRESSURE without importing three/R3F: the page refuses to
// run more than a couple of frames ahead of what the loader has actually
// decoded, so on a slow connection the page literally waits for the picture.
// null = nothing has ever been painted in this session (the one legitimate
// snap) — and also, deliberately, whenever the last paint is STALE: a paused or
// throttled render loop (hidden tab, lost context) must never be able to
// deadlock the page. Staleness is ONLY about a stopped render loop: a held
// picture is republished with a fresh timestamp every rendered frame, so a
// starved loader makes the page wait for as long as it takes.
export const PAINTED_FRAME_STALE_MS = 500;

let lastPaintedScrubFrame: number | null = null;
let lastPaintedScrubAtMs = 0;

export function setLastPaintedScrubFrame(frame: number, atMs: number): void {
  if (!Number.isFinite(frame) || frame < 0) return;
  lastPaintedScrubFrame = frame;
  lastPaintedScrubAtMs = Number.isFinite(atMs) ? atMs : 0;
}

// `nowMs` omitted → no staleness test (the plain survivor used for remounts).
//
// A NEGATIVE age is the freshest state there is, not a stale one, and treating
// it as stale disabled decode backpressure completely. The two sides read the
// clock differently by construction: VideoPlane stamps performance.now() from
// inside R3F's animation-frame callback, while the scroll controller's tick is
// handed the requestAnimationFrame TIMESTAMP — the start of the very same
// frame, up to a frame earlier. R3F's callback is registered first and so runs
// first, so every single query arrived "before" the paint it was asking about
// (measured: 466 of 466, worst −18 ms) and the governor never saw a painted
// frame at all. Only genuine age is a staleness signal, so only genuine age is
// tested; the 500 ms rule keeps its one job, catching a STOPPED render loop.
export function getLastPaintedScrubFrame(nowMs?: number): number | null {
  if (lastPaintedScrubFrame === null) return null;
  if (nowMs === undefined || !Number.isFinite(nowMs)) {
    return lastPaintedScrubFrame;
  }
  const age = nowMs - lastPaintedScrubAtMs;
  if (!Number.isFinite(age) || age > PAINTED_FRAME_STALE_MS) {
    return null;
  }
  return lastPaintedScrubFrame;
}

export function resetLastPaintedScrubFrame(): void {
  lastPaintedScrubFrame = null;
  lastPaintedScrubAtMs = 0;
}
