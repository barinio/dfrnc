import { FRAME_MANIFEST } from "./frameManifest";

// Frame-sequence scrub: the FPV clip is pre-extracted to a numbered WebP
// sequence (public/frames/<tier>/NNNN.webp, see scripts/extract-frames.mjs) and
// the scroll paints the scroll-indexed frame as a texture. This replaces the
// HTMLVideoElement scrub, which froze the "church frame" on iOS/WebKit (paused
// seeks are throughput-limited; offscreen muted video decode is suspended).
// Image→texture upload is frame-accurate and reliable on every browser.

export const FRAME_COUNT = FRAME_MANIFEST.count;
export const FRAME_LAST = FRAME_COUNT - 1;

function clamp01(x: number): number {
  return Math.min(Math.max(x, 0), 1);
}

// Responsive tier by viewport width — matches the OLD video source breakpoint
// (≤899.98px got the 720p file), so phones get the lighter 1280px sequence and
// wider screens the crisp 1920px one. tiers = [mobile, desktop].
export const SMALL_SCREEN_MAX = 899.98;

export function frameTierFor(width: number): number {
  const [mobile, desktop] = FRAME_MANIFEST.tiers;
  return width <= SMALL_SCREEN_MAX ? mobile : desktop;
}

export function frameTierForScreen(): number {
  const w = typeof window === "undefined" ? 1024 : window.innerWidth;
  return frameTierFor(w);
}

// public-relative URL for a 0-based frame index (files are 1-indexed, zero-padded).
export function frameUrl(tier: number, index0: number): string {
  const base = typeof import.meta !== "undefined" && import.meta.env
    ? import.meta.env.BASE_URL
    : "/";
  const n = String(index0 + 1).padStart(FRAME_MANIFEST.digits, "0");
  return `${base}frames/${tier}/${n}.${FRAME_MANIFEST.ext}`;
}

// Scroll-normalized clip time t∈[0,1] → frame index [0, count-1]. Mirrors the
// video scrub: t comes from videoMasterTimeFor, so the frame the user sees is an
// exact function of scroll position (frame-accurate — no playback drift).
export function frameIndexFor(t: number, count = FRAME_COUNT): number {
  if (count <= 1) return 0;
  const i = Math.round(clamp01(t) * (count - 1));
  return Math.min(Math.max(i, 0), count - 1);
}

// Load order: COARSE-TO-FINE across the whole clip, NOT sequential 0→N. A
// sequential download has a single "front", so a scroll that outruns it shows a
// frame stuck at the front until it catches up (the church-frame freeze). Loading
// 0, N-1, N/2, then quarters, eighths, … spreads coverage over the WHOLE range
// first, so at ANY scroll position a nearby frame is already loaded — get()'s
// ±window fallback then resolves within a couple of frames while the rest fill in.
export function buildCoarseToFineOrder(n: number): number[] {
  const order: number[] = [];
  const seen = new Uint8Array(Math.max(n, 0));
  const add = (x: number) => {
    const i = Math.round(x);
    if (i >= 0 && i < n && !seen[i]) {
      seen[i] = 1;
      order.push(i);
    }
  };
  if (n <= 0) return order;
  add(0);
  add(n - 1);
  for (let div = 2; div < n * 2; div *= 2) {
    for (let k = 1; k < div; k += 2) add((k / div) * (n - 1));
  }
  for (let i = 0; i < n; i++) add(i); // safety net: guarantee a full permutation
  return order;
}

export interface FrameLoaderOptions {
  concurrency?: number;
  onFirstReady?: () => void;
}

// Progressive <img> preloader with a concurrency cap (mirrors the miso reference).
// Loads frames in scrub order (0→N), so the earliest frames — needed first when
// the clip reveals at sp=0.63, after ~440vh of runway — are ready first. The
// browser keeps the compressed source and lazily decodes/purges, so memory stays
// bounded (≈15MB compressed for the 1280px tier; one frame decoded into the GPU
// texture at a time). get() never blocks: it returns the nearest already-loaded
// frame so a fast scroll that outruns the download holds a near frame, never blank.
export class FrameSequenceLoader {
  readonly tier: number;
  readonly count: number;
  private images: (HTMLImageElement | null)[];
  private loaded: boolean[];
  private readonly order: number[];
  private readonly retryQueue: number[] = [];
  private attempts: Uint8Array;
  private nextToQueue = 0;
  private inFlight = 0;
  private readonly concurrency: number;
  private disposed = false;
  private onFirst?: () => void;
  private firstFired = false;
  loadedCount = 0;
  lastResolved = -1; // index get() last returned (diagnostic; -1 = none)

  isLoaded(i: number): boolean {
    return this.loaded[i] ?? false;
  }

  constructor(tier: number, count: number, opts: FrameLoaderOptions = {}) {
    this.tier = tier;
    this.count = count;
    this.images = new Array(count).fill(null);
    this.loaded = new Array(count).fill(false);
    this.attempts = new Uint8Array(Math.max(count, 0));
    this.order = buildCoarseToFineOrder(count);
    this.concurrency = opts.concurrency ?? 8;
    this.onFirst = opts.onFirstReady;
    this.pump();
  }

  private pump(): void {
    while (!this.disposed && this.inFlight < this.concurrency) {
      // Failed frames retry FIRST (so a transient error never abandons a frame),
      // then the coarse-to-fine order. Both stay inside the concurrency budget.
      let i: number;
      if (this.retryQueue.length > 0) i = this.retryQueue.shift()!;
      else if (this.nextToQueue < this.order.length) i = this.order[this.nextToQueue++];
      else break;
      this.load(i);
    }
  }

  private load(i: number): void {
    if (this.disposed || this.loaded[i] || this.images[i]) return;
    const img = new Image();
    img.decoding = "async";
    this.images[i] = img;
    this.inFlight++;
    const done = (ok: boolean) => {
      this.inFlight--;
      if (this.disposed) return;
      if (ok) {
        this.loaded[i] = true;
        this.loadedCount++;
        if (!this.firstFired && this.loaded[0]) {
          this.firstFired = true;
          this.onFirst?.();
        }
      } else {
        this.images[i] = null; // failed
        if (this.attempts[i] < 3) {
          this.attempts[i] += 1;
          this.retryQueue.push(i); // re-attempt via pump (capped)
        }
      }
      this.pump();
    };
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.src = frameUrl(this.tier, i);
  }

  // The decoded <img> for `index` if loaded; else the nearest loaded frame within
  // `window` indices; else null. Prioritises queuing the requested frame.
  get(index: number, window = 32): HTMLImageElement | null {
    const i = Math.min(Math.max(index | 0, 0), this.count - 1);
    if (this.loaded[i]) {
      this.lastResolved = i;
      return this.images[i];
    }
    // Jump the queue for the visible frame, but ONLY with spare capacity — an
    // uncapped jump-queue balloons inFlight during a fast scrub and stalls pump()
    // (its `inFlight < concurrency` loop never runs), freezing the load frontier.
    if (!this.images[i] && this.inFlight < this.concurrency) this.load(i);
    for (let d = 1; d <= window; d++) {
      if (i - d >= 0 && this.loaded[i - d]) {
        this.lastResolved = i - d;
        return this.images[i - d];
      }
      if (i + d < this.count && this.loaded[i + d]) {
        this.lastResolved = i + d;
        return this.images[i + d];
      }
    }
    this.lastResolved = -1;
    return null;
  }

  get firstReady(): boolean {
    return this.loaded[0] ?? false;
  }

  dispose(): void {
    this.disposed = true;
    for (const img of this.images) {
      if (img) {
        img.onload = null;
        img.onerror = null;
        img.src = "";
      }
    }
    this.images = [];
  }
}
