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

function normalizedCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) return fallback;
  return Math.max(1, Math.floor(value!));
}

function nonNegativeInteger(
  value: number | undefined,
  fallback: number,
): number {
  if (!Number.isFinite(value) || (value ?? 0) < 0) return fallback;
  return Math.floor(value!);
}

// Load order: COARSE-TO-FINE across the whole clip, NOT sequential 0→N. A
// sequential download has a single "front", so a scroll that outruns it shows a
// frame stuck at the front until it catches up (the church-frame freeze). Loading
// 0, N-1, N/2, then quarters, eighths, … spreads coverage over the WHOLE range
// first, so at ANY scroll position a nearby frame is already loaded — get()'s
// ±window fallback then resolves within a couple of frames while the rest fill in.
export function buildCoarseToFineOrder(n: number): number[] {
  n = normalizedCount(n);
  const order: number[] = [];
  const seen = new Uint8Array(n);
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

// The loader's cold-start coverage is a small, deterministic prefix of the
// whole-clip coarse order. Frame zero is always present for a non-empty clip,
// even if an invalid/zero anchor count is supplied.
export function buildStartupAnchorOrder(
  count: number,
  anchorCount = 9,
): number[] {
  const n = normalizedCount(count);
  if (n === 0) return [];
  const requested = Math.max(1, nonNegativeInteger(anchorCount, 9));
  return buildCoarseToFineOrder(n).slice(0, Math.min(requested, n));
}

// Latest demand replaces stale pending demand. Directional neighbours are
// ordered along travel first; a stationary/first request uses lower-index
// tie-breaking, matching get()'s nearest-loaded fallback.
export function buildDirectionalPriority(
  target: number,
  previous: number,
  count: number,
  radius = 2,
): number[] {
  const n = normalizedCount(count);
  if (n === 0) return [];
  const center = Math.min(Math.max(Math.round(target), 0), n - 1);
  const prior =
    Number.isFinite(previous) && previous >= 0 && previous < n
      ? Math.round(previous)
      : center;
  const r = nonNegativeInteger(radius, 2);
  const candidates = [center];

  if (prior < center) {
    for (let d = 1; d <= r; d++) candidates.push(center + d);
    for (let d = 1; d <= r; d++) candidates.push(center - d);
  } else if (prior > center) {
    for (let d = 1; d <= r; d++) candidates.push(center - d);
    for (let d = 1; d <= r; d++) candidates.push(center + d);
  } else {
    for (let d = 1; d <= r; d++) {
      candidates.push(center - d, center + d);
    }
  }

  const seen = new Uint8Array(n);
  return candidates.filter((index) => {
    if (index < 0 || index >= n || seen[index]) return false;
    seen[index] = 1;
    return true;
  });
}

export interface FrameLoaderBudget {
  concurrency: number;
  backgroundConcurrency: number;
  backgroundBatchSize: number;
}

export function frameLoaderBudgetFor(tier: number): FrameLoaderBudget {
  const mobileTier = FRAME_MANIFEST.tiers[0];
  if (tier === mobileTier) {
    return {
      concurrency: 4,
      backgroundConcurrency: 2,
      backgroundBatchSize: 2,
    };
  }
  return {
    concurrency: 6,
    backgroundConcurrency: 4,
    backgroundBatchSize: 4,
  };
}

export type FrameIdleScheduler = (callback: () => void) => () => void;

export interface FrameLoaderOptions {
  concurrency?: number;
  backgroundConcurrency?: number;
  backgroundBatchSize?: number;
  startupAnchorCount?: number;
  neighborRadius?: number;
  onStartupReady?: () => void;
  imageFactory?: () => HTMLImageElement;
  scheduleIdle?: FrameIdleScheduler;
  // Kept through the staged-loader commit so VideoPlane remains buildable.
  // Task 5 moves it to the stronger all-startup-anchors readiness callback.
  onFirstReady?: () => void;
}

type LoadPriority = "startup" | "foreground" | "background";

const MAX_ATTEMPTS = 4; // initial request + three retries

function defaultIdleScheduler(callback: () => void): () => void {
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    const id = window.requestIdleCallback(() => callback(), { timeout: 120 });
    return () => window.cancelIdleCallback(id);
  }
  const id = globalThis.setTimeout(callback, 16);
  return () => globalThis.clearTimeout(id);
}

// A demand-aware scheduler: nine coarse anchors establish whole-clip coverage,
// the latest visible neighbourhood owns foreground capacity, and the remaining
// sequence fills in small yielded background batches. get() never blocks.
export class FrameSequenceLoader {
  readonly tier: number;
  readonly count: number;
  private images: (HTMLImageElement | null)[];
  private loaded: boolean[];
  private terminal: boolean[];
  private attempts: Uint8Array;
  private generations: Uint32Array;
  private activePriorities: (LoadPriority | null)[];
  private promotedInFlight: boolean[];

  private readonly startupOrder: number[];
  private readonly startupSet: Uint8Array;
  private readonly startupSettled: Uint8Array;
  private startupSettledCount = 0;
  private startupQueue: number[];
  private readonly startupQueued: Uint8Array;
  private _startupLoadedCount = 0;
  private _startupReady = false;

  private foregroundDemand: number[] = [];
  private readonly foregroundDemandSet: Uint8Array;
  private readonly foregroundRetryQueue: number[] = [];
  private readonly foregroundRetryQueued: Uint8Array;

  private readonly backgroundOrder: number[];
  private backgroundCursor = 0;
  private readonly backgroundRetryQueue: number[] = [];
  private readonly backgroundRetryQueued: Uint8Array;
  private backgroundAllowance = 0;
  private backgroundInFlight = 0;
  private cancelIdle: (() => void) | null = null;

  private inFlight = 0;
  private readonly concurrency: number;
  private readonly backgroundConcurrency: number;
  private readonly backgroundBatchSize: number;
  private readonly neighborRadius: number;
  private readonly imageFactory: () => HTMLImageElement;
  private readonly scheduleIdle: FrameIdleScheduler;
  private disposed = false;
  private readonly onFirst?: () => void;
  private readonly onStartup?: () => void;
  private firstFired = false;
  private lastRequested = -1;
  loadedCount = 0;
  lastResolved = -1; // index get() last returned (diagnostic; -1 = none)

  isLoaded(i: number): boolean {
    return this.loaded[i] ?? false;
  }

  constructor(tier: number, count: number, opts: FrameLoaderOptions = {}) {
    this.tier = tier;
    this.count = normalizedCount(count);
    this.images = new Array(this.count).fill(null);
    this.loaded = new Array(this.count).fill(false);
    this.terminal = new Array(this.count).fill(false);
    this.attempts = new Uint8Array(this.count);
    this.generations = new Uint32Array(this.count);
    this.activePriorities = new Array(this.count).fill(null);
    this.promotedInFlight = new Array(this.count).fill(false);

    const budget = frameLoaderBudgetFor(tier);
    this.concurrency = positiveInteger(opts.concurrency, budget.concurrency);
    this.backgroundConcurrency = Math.min(
      this.concurrency,
      positiveInteger(
        opts.backgroundConcurrency,
        budget.backgroundConcurrency,
      ),
    );
    this.backgroundBatchSize = positiveInteger(
      opts.backgroundBatchSize,
      budget.backgroundBatchSize,
    );
    this.neighborRadius = nonNegativeInteger(opts.neighborRadius, 2);
    this.imageFactory = opts.imageFactory ?? (() => new Image());
    this.scheduleIdle = opts.scheduleIdle ?? defaultIdleScheduler;

    this.startupOrder = buildStartupAnchorOrder(
      this.count,
      opts.startupAnchorCount,
    );
    this.startupSet = new Uint8Array(this.count);
    this.startupSettled = new Uint8Array(this.count);
    this.startupQueued = new Uint8Array(this.count);
    for (const index of this.startupOrder) {
      this.startupSet[index] = 1;
      this.startupQueued[index] = 1;
    }
    this.startupQueue = [...this.startupOrder];

    this.foregroundDemandSet = new Uint8Array(this.count);
    this.foregroundRetryQueued = new Uint8Array(this.count);
    this.backgroundRetryQueued = new Uint8Array(this.count);
    this.backgroundOrder = buildCoarseToFineOrder(this.count);

    this.onFirst = opts.onFirstReady;
    this.onStartup = opts.onStartupReady;

    if (this.startupOrder.length === 0) this.markStartupReady();
    this.pump();
  }

  private pump(): void {
    while (!this.disposed && this.inFlight < this.concurrency) {
      const startup = this.takeStartup();
      if (startup !== null) {
        this.load(startup, "startup");
        continue;
      }

      const foreground = this.takeForeground();
      if (foreground !== null) {
        this.load(foreground, "foreground");
        continue;
      }

      if (
        !this._startupReady ||
        this.backgroundAllowance <= 0 ||
        this.backgroundInFlight >= this.backgroundConcurrency
      ) {
        break;
      }
      const background = this.takeBackground();
      if (background === null) {
        this.backgroundAllowance = 0;
        break;
      }
      if (this.load(background, "background")) {
        this.backgroundAllowance--;
      }
    }

    this.maybeScheduleBackground();
  }

  private canStart(i: number): boolean {
    return (
      i >= 0 &&
      i < this.count &&
      !this.loaded[i] &&
      !this.terminal[i] &&
      this.activePriorities[i] === null
    );
  }

  private takeStartup(): number | null {
    while (this.startupQueue.length > 0) {
      const i = this.startupQueue.shift()!;
      this.startupQueued[i] = 0;
      if (this.canStart(i)) return i;
    }
    return null;
  }

  private takeForeground(): number | null {
    while (this.foregroundDemand.length > 0) {
      const i = this.foregroundDemand.shift()!;
      this.foregroundDemandSet[i] = 0;
      if (this.canStart(i)) return i;
      if (this.activePriorities[i] === "background") {
        this.promotedInFlight[i] = true;
      }
    }
    while (this.foregroundRetryQueue.length > 0) {
      const i = this.foregroundRetryQueue.shift()!;
      this.foregroundRetryQueued[i] = 0;
      if (this.canStart(i)) return i;
    }
    return null;
  }

  private takeBackground(): number | null {
    while (this.backgroundRetryQueue.length > 0) {
      const i = this.backgroundRetryQueue.shift()!;
      this.backgroundRetryQueued[i] = 0;
      if (
        !this.foregroundDemandSet[i] &&
        !this.foregroundRetryQueued[i] &&
        this.canStart(i)
      ) {
        return i;
      }
    }
    while (this.backgroundCursor < this.backgroundOrder.length) {
      const i = this.backgroundOrder[this.backgroundCursor++];
      if (
        !this.startupSet[i] &&
        !this.foregroundDemandSet[i] &&
        !this.foregroundRetryQueued[i] &&
        this.canStart(i)
      ) {
        return i;
      }
    }
    return null;
  }

  private load(i: number, priority: LoadPriority): boolean {
    if (this.disposed || !this.canStart(i)) return false;
    let img: HTMLImageElement;
    try {
      img = this.imageFactory();
    } catch {
      this.failWithoutImage(i, priority);
      return false;
    }
    img.decoding = "async";
    this.images[i] = img;
    this.activePriorities[i] = priority;
    this.promotedInFlight[i] = false;
    this.attempts[i]++;
    const generation = ++this.generations[i];
    this.inFlight++;
    if (priority === "background") this.backgroundInFlight++;
    let settled = false;

    const done = (ok: boolean) => {
      if (
        settled ||
        this.disposed ||
        this.generations[i] !== generation
      ) {
        return;
      }
      settled = true;
      img.onload = null;
      img.onerror = null;
      this.inFlight = Math.max(this.inFlight - 1, 0);
      if (priority === "background") {
        this.backgroundInFlight = Math.max(this.backgroundInFlight - 1, 0);
      }
      this.activePriorities[i] = null;

      if (ok) {
        this.loaded[i] = true;
        this.loadedCount++;
        if (i === 0 && !this.firstFired) {
          this.firstFired = true;
          this.onFirst?.();
        }
        this.settleStartup(i, true);
      } else {
        if (this.images[i] === img) this.images[i] = null;
        if (this.attempts[i] < MAX_ATTEMPTS) {
          this.enqueueRetry(i, priority);
        } else {
          this.terminal[i] = true;
          this.settleStartup(i, false);
        }
      }
      this.pump();
    };

    img.onload = () => {
      if (i !== 0) {
        done(true);
        return;
      }
      Promise.resolve()
        .then(() => (typeof img.decode === "function" ? img.decode() : undefined))
        .then(
          () => done(true),
          () => done(false),
        );
    };
    img.onerror = () => done(false);
    try {
      img.src = frameUrl(this.tier, i);
    } catch {
      done(false);
    }
    return true;
  }

  private failWithoutImage(i: number, priority: LoadPriority): void {
    this.attempts[i]++;
    if (this.attempts[i] < MAX_ATTEMPTS) {
      this.enqueueRetry(i, priority);
    } else {
      this.terminal[i] = true;
      this.settleStartup(i, false);
    }
  }

  private enqueueRetry(i: number, attemptPriority: LoadPriority): void {
    if (this.disposed || this.loaded[i] || this.terminal[i]) return;
    if (this.startupSet[i]) {
      if (!this.startupQueued[i]) {
        this.startupQueued[i] = 1;
        this.startupQueue.unshift(i);
      }
      return;
    }
    if (attemptPriority === "foreground" || this.promotedInFlight[i]) {
      if (i === this.lastRequested && !this.foregroundDemandSet[i]) {
        this.foregroundDemandSet[i] = 1;
        this.foregroundDemand.unshift(i);
        return;
      }
      if (!this.foregroundRetryQueued[i]) {
        this.foregroundRetryQueued[i] = 1;
        this.foregroundRetryQueue.push(i);
      }
      return;
    }
    if (!this.backgroundRetryQueued[i]) {
      this.backgroundRetryQueued[i] = 1;
      this.backgroundRetryQueue.push(i);
    }
  }

  private settleStartup(i: number, loaded: boolean): void {
    if (!this.startupSet[i] || this.startupSettled[i]) return;
    this.startupSettled[i] = 1;
    this.startupSettledCount++;
    if (loaded) this._startupLoadedCount++;
    if (this.startupSettledCount === this.startupOrder.length) {
      this.markStartupReady();
    }
  }

  private markStartupReady(): void {
    if (this._startupReady || this.disposed) return;
    this._startupReady = true;
    this.onStartup?.();
    this.maybeScheduleBackground();
  }

  private hasBackgroundWork(): boolean {
    if (this.backgroundRetryQueue.some((i) => this.canStart(i))) return true;
    for (let cursor = this.backgroundCursor; cursor < this.backgroundOrder.length; cursor++) {
      const i = this.backgroundOrder[cursor];
      if (
        !this.startupSet[i] &&
        !this.foregroundDemandSet[i] &&
        !this.foregroundRetryQueued[i] &&
        this.canStart(i)
      ) {
        return true;
      }
    }
    return false;
  }

  private maybeScheduleBackground(): void {
    if (
      this.disposed ||
      !this._startupReady ||
      this.cancelIdle ||
      this.backgroundAllowance > 0 ||
      this.inFlight >= this.concurrency ||
      this.backgroundInFlight >= this.backgroundConcurrency ||
      !this.hasBackgroundWork()
    ) {
      return;
    }
    this.cancelIdle = this.scheduleIdle(() => {
      this.cancelIdle = null;
      if (this.disposed) return;
      this.backgroundAllowance = this.backgroundBatchSize;
      this.pump();
    });
  }

  // The decoded <img> for `index` if loaded; else the nearest loaded frame within
  // `window` indices; else null. Prioritises queuing the requested frame.
  get(index: number, window = 32): HTMLImageElement | null {
    if (this.disposed || this.count === 0) {
      this.lastResolved = -1;
      return null;
    }
    const i = Math.min(Math.max(index | 0, 0), this.count - 1);

    for (const old of this.foregroundDemand) this.foregroundDemandSet[old] = 0;
    const directional = buildDirectionalPriority(
      i,
      this.lastRequested,
      this.count,
      this.neighborRadius,
    );
    this.lastRequested = i;
    this.foregroundDemand = [];
    for (const candidate of directional) {
      if (this.loaded[candidate] || this.terminal[candidate]) continue;
      if (this.activePriorities[candidate] === "background") {
        this.promotedInFlight[candidate] = true;
      }
      if (this.activePriorities[candidate] !== null) continue;
      this.foregroundDemandSet[candidate] = 1;
      this.foregroundDemand.push(candidate);
    }
    this.pump();

    if (this.loaded[i]) {
      this.lastResolved = i;
      return this.images[i];
    }

    const searchWindow = nonNegativeInteger(window, 32);
    for (let d = 1; d <= searchWindow; d++) {
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

  get startupReady(): boolean {
    return this._startupReady;
  }

  get startupLoadedCount(): number {
    return this._startupLoadedCount;
  }

  get inFlightCount(): number {
    return this.inFlight;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelIdle?.();
    this.cancelIdle = null;
    this.backgroundAllowance = 0;
    this.startupQueue = [];
    this.foregroundDemand = [];
    this.foregroundRetryQueue.length = 0;
    this.backgroundRetryQueue.length = 0;
    for (const img of this.images) {
      if (img) {
        img.onload = null;
        img.onerror = null;
        img.src = "";
      }
    }
    this.images = [];
    this.loaded = [];
    this.terminal = [];
    this.activePriorities = [];
    this.promotedInFlight = [];
    this.inFlight = 0;
    this.backgroundInFlight = 0;
  }
}
