// Deterministic staged frame-loader assertions. No browser/test runner needed:
// run manually with `npx tsx scripts/check-frame-loader.ts`.
import {
  FrameSequenceLoader,
  buildDirectionalPriority,
  buildStartupAnchorOrder,
  frameLoaderBudgetFor,
} from "../src/frames";
import type { FrameIdleScheduler } from "../src/frames";

function ok(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(label);
}

function eq(actual: number, expected: number, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function same(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

class Deferred<T> {
  readonly promise: Promise<T>;
  private resolvePromise!: (value: T | PromiseLike<T>) => void;
  private rejectPromise!: (reason?: unknown) => void;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    });
  }

  resolve(value: T): void {
    this.resolvePromise(value);
  }

  reject(reason: unknown): void {
    this.rejectPromise(reason);
  }
}

interface FakeRequest {
  index: number;
  image: FakeImage;
}

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  decoding = "";
  decodeCalls = 0;
  cleared = false;
  private currentSrc = "";
  readonly decoded = new Deferred<void>();

  constructor(private readonly owner: FakeImages) {}

  get src(): string {
    return this.currentSrc;
  }

  set src(value: string) {
    this.currentSrc = value;
    if (value === "") {
      this.cleared = true;
      return;
    }
    const match = value.match(/\/(\d+)\.[^.]+$/);
    if (!match) throw new Error(`unparseable frame URL: ${value}`);
    const index = Number(match[1]) - 1;
    this.owner.requests.push({ index, image: this });
    if (this.owner.synchronousResult === "load") this.fireLoad();
    if (this.owner.synchronousResult === "error") this.fireError();
  }

  decode(): Promise<void> {
    this.decodeCalls++;
    return this.decoded.promise;
  }

  fireLoad(): void {
    this.onload?.();
  }

  fireError(): void {
    this.onerror?.();
  }
}

class FakeImages {
  readonly requests: FakeRequest[] = [];
  synchronousResult: "load" | "error" | null = null;

  factory = (): HTMLImageElement =>
    new FakeImage(this) as unknown as HTMLImageElement;

  indices(): number[] {
    return this.requests.map(({ index }) => index);
  }

  active(index: number): FakeImage {
    const request = [...this.requests]
      .reverse()
      .find(
        (entry) =>
          entry.index === index &&
          (entry.image.onload !== null || entry.image.onerror !== null),
      );
    ok(request, `active request exists for frame ${index}`);
    return request.image;
  }

  async succeed(index: number): Promise<FakeImage> {
    const image = this.active(index);
    image.fireLoad();
    await flushPromises();
    if (image.decodeCalls > 0) {
      image.decoded.resolve(undefined);
      await flushPromises();
    }
    return image;
  }

  fail(index: number): FakeImage {
    const image = this.active(index);
    image.fireError();
    return image;
  }
}

interface IdleEntry {
  callback: () => void;
  cancelled: boolean;
}

class ManualIdle {
  readonly entries: IdleEntry[] = [];
  cancelCount = 0;

  schedule: FrameIdleScheduler = (callback) => {
    const entry = { callback, cancelled: false };
    this.entries.push(entry);
    return () => {
      if (entry.cancelled) return;
      entry.cancelled = true;
      this.cancelCount++;
    };
  };

  get pending(): number {
    return this.entries.filter((entry) => !entry.cancelled).length;
  }

  flushOne(): void {
    const entry = this.entries.find((candidate) => !candidate.cancelled);
    ok(entry, "an idle callback is pending");
    entry.cancelled = true;
    entry.callback();
  }

  flushAll(): void {
    while (this.pending > 0) this.flushOne();
  }
}

class SynchronousIdle {
  callCount = 0;
  cancelCount = 0;

  schedule: FrameIdleScheduler = (callback) => {
    this.callCount++;
    callback();
    return () => {
      this.cancelCount++;
    };
  };
}

async function settleStartup(
  loader: FrameSequenceLoader,
  images: FakeImages,
): Promise<void> {
  const startup = new Set(buildStartupAnchorOrder(loader.count));
  let guard = 0;
  while (!loader.startupReady) {
    const request = images.requests.find(
      ({ index, image }) =>
        startup.has(index) &&
        (image.onload !== null || image.onerror !== null),
    );
    ok(request, "startup has an active request to settle");
    await images.succeed(request.index);
    guard++;
    ok(guard <= loader.count * 5 + 10, "startup settles without a loop");
  }
}

// Pure scheduling helpers are pinned independently of the implementation.
same(
  buildStartupAnchorOrder(295),
  [0, 294, 147, 74, 221, 37, 110, 184, 257],
  "the startup set is the first nine coarse anchors",
);
same(buildStartupAnchorOrder(3), [0, 2, 1], "small startup set is unique");
same(buildStartupAnchorOrder(1, 0), [0], "positive clips always anchor frame zero");
same(buildStartupAnchorOrder(0), [], "empty clips have no startup anchors");
same(
  frameLoaderBudgetFor(1280),
  { concurrency: 4, backgroundConcurrency: 2, backgroundBatchSize: 2 },
  "mobile loader budget",
);
same(
  frameLoaderBudgetFor(1920),
  { concurrency: 6, backgroundConcurrency: 4, backgroundBatchSize: 4 },
  "desktop loader budget",
);
same(
  buildDirectionalPriority(10, 9, 20, 2),
  [10, 11, 12, 9, 8],
  "forward target neighborhood",
);
same(
  buildDirectionalPriority(10, 11, 20, 2),
  [10, 9, 8, 11, 12],
  "reverse target neighborhood",
);
same(
  buildDirectionalPriority(10, 10, 20, 2),
  [10, 9, 11, 8, 12],
  "stationary target neighborhood",
);
same(
  buildDirectionalPriority(0, 1, 3, 3),
  [0, 1, 2],
  "directional order clamps and deduplicates boundaries",
);

// Only nine anchors are requested before idle work; readiness waits for frame
// zero decode plus all anchors, then fires each callback exactly once.
{
  const images = new FakeImages();
  const idle = new ManualIdle();
  let firstReadyCount = 0;
  let startupReadyCount = 0;
  const loader = new FrameSequenceLoader(1280, 295, {
    imageFactory: images.factory,
    scheduleIdle: idle.schedule,
    onFirstReady: () => firstReadyCount++,
    onStartupReady: () => startupReadyCount++,
  });
  eq(loader.inFlightCount, 4, "mobile startup obeys total concurrency");
  await settleStartup(loader, images);
  same(
    images.indices(),
    [0, 294, 147, 74, 221, 37, 110, 184, 257],
    "first URL assignments are exactly the nine anchors",
  );
  eq(images.requests[0].image.decodeCalls, 1, "frame zero is decoded once");
  ok(
    images.requests.slice(1).every(({ image }) => image.decodeCalls === 0),
    "nonzero anchors never call decode",
  );
  eq(loader.startupLoadedCount, 9, "successful startup coverage is diagnostic");
  eq(firstReadyCount, 1, "legacy first-ready fires after frame zero decode");
  eq(startupReadyCount, 1, "startup-ready fires after the full barrier");
  eq(idle.pending, 1, "background fill is yielded after startup");
  eq(images.requests.length, 9, "no background URL before an idle flush");
  loader.dispose();
}

// Frame-zero decode may finish last; other anchors do not release readiness.
{
  const images = new FakeImages();
  const idle = new ManualIdle();
  let readyCount = 0;
  const loader = new FrameSequenceLoader(1280, 3, {
    concurrency: 3,
    startupAnchorCount: 3,
    imageFactory: images.factory,
    scheduleIdle: idle.schedule,
    onStartupReady: () => readyCount++,
  });
  const zero = images.active(0);
  zero.fireLoad();
  await flushPromises();
  eq(zero.decodeCalls, 1, "frame-zero decode starts after load");
  await images.succeed(2);
  await images.succeed(1);
  ok(!loader.startupReady, "loaded anchors still wait for frame-zero decode");
  zero.decoded.resolve(undefined);
  await flushPromises();
  ok(loader.startupReady, "frame-zero decode completes the startup barrier");
  eq(readyCount, 1, "startup callback is one-shot");
  loader.dispose();
}

// Decode rejection is a normal failed attempt. Duplicate/late completion from
// that attempt cannot double-decrement counters or settle the retry.
{
  const images = new FakeImages();
  const idle = new ManualIdle();
  const loader = new FrameSequenceLoader(1280, 1, {
    concurrency: 1,
    imageFactory: images.factory,
    scheduleIdle: idle.schedule,
  });
  const first = images.active(0);
  first.fireLoad();
  await flushPromises();
  const lateLoad = first.onload;
  first.decoded.reject(new Error("decode failed"));
  await flushPromises();
  eq(images.indices().filter((index) => index === 0).length, 2, "decode failure retries");
  eq(loader.inFlightCount, 1, "retry owns the one in-flight slot");
  lateLoad?.();
  eq(loader.inFlightCount, 1, "late duplicate completion is ignored");
  await images.succeed(0);
  ok(loader.firstReady && loader.startupReady, "decoded retry becomes ready");
  loader.dispose();
}

// An exhausted startup anchor is terminal after initial + three retries. It
// cannot deadlock startup and later demand cannot resurrect a fifth request.
{
  const images = new FakeImages();
  const idle = new ManualIdle();
  let startupReadyCount = 0;
  const loader = new FrameSequenceLoader(1280, 2, {
    concurrency: 2,
    startupAnchorCount: 2,
    imageFactory: images.factory,
    scheduleIdle: idle.schedule,
    onStartupReady: () => startupReadyCount++,
  });
  await images.succeed(0);
  for (let attempt = 0; attempt < 4; attempt++) images.fail(1);
  eq(
    images.indices().filter((index) => index === 1).length,
    4,
    "startup failure has exactly three retries",
  );
  ok(loader.startupReady, "terminal failure satisfies the settled barrier");
  eq(loader.startupLoadedCount, 1, "failed startup is not counted as loaded");
  eq(startupReadyCount, 1, "failed startup still releases exactly once");
  loader.get(1);
  loader.get(1);
  eq(
    images.indices().filter((index) => index === 1).length,
    4,
    "get cannot resurrect an exhausted frame",
  );
  loader.dispose();
}

// Frame zero itself may terminally fail without deadlocking the intro. The
// legacy successful-first callback deliberately does not fire in this case.
{
  const images = new FakeImages();
  const idle = new ManualIdle();
  let firstReadyCount = 0;
  let startupReadyCount = 0;
  const loader = new FrameSequenceLoader(1280, 1, {
    concurrency: 1,
    imageFactory: images.factory,
    scheduleIdle: idle.schedule,
    onFirstReady: () => firstReadyCount++,
    onStartupReady: () => startupReadyCount++,
  });
  for (let attempt = 0; attempt < 4; attempt++) images.fail(0);
  ok(loader.startupReady, "terminal frame-zero failure releases startup");
  ok(!loader.firstReady, "terminal frame-zero failure is not first-ready");
  eq(firstReadyCount, 0, "legacy success callback stays silent on failure");
  eq(startupReadyCount, 1, "startup failure callback remains one-shot");
  eq(images.requests.length, 4, "frame zero also obeys the retry cap");
  loader.dispose();
}

// Background work needs an idle grant, consumes only its capped share, and
// leaves two mobile slots immediately available to the latest foreground.
{
  const images = new FakeImages();
  const idle = new ManualIdle();
  const loader = new FrameSequenceLoader(1280, 40, {
    startupAnchorCount: 1,
    imageFactory: images.factory,
    scheduleIdle: idle.schedule,
  });
  await images.succeed(0);
  eq(images.requests.length, 1, "background remains gated before idle");
  idle.flushOne();
  eq(images.requests.length, 3, "one mobile idle batch starts two URLs");
  eq(loader.inFlightCount, 2, "background uses only its two-slot cap");
  const background = images.indices().slice(1);

  loader.get(30);
  eq(loader.inFlightCount, 4, "foreground may fill the reserved total slots");
  same(images.indices().slice(3, 5), [30, 29], "latest target starts before more background");
  const target30Requests = images.indices().filter((index) => index === 30).length;
  loader.get(30);
  eq(
    images.indices().filter((index) => index === 30).length,
    target30Requests,
    "repeated get never duplicates an in-flight target",
  );

  loader.get(35); // replaces the still-queued neighbourhood around 30
  images.fail(background[0]);
  eq(images.indices().at(-1)!, 35, "newest foreground target wins the freed slot");
  ok(loader.inFlightCount <= 4, "total mobile concurrency never exceeds four");
  loader.dispose();
}

// A visible frame already loading in the background is promoted: if it fails,
// its retry is foreground and does not wait for another idle grant.
{
  const images = new FakeImages();
  const idle = new ManualIdle();
  const loader = new FrameSequenceLoader(1280, 20, {
    startupAnchorCount: 1,
    imageFactory: images.factory,
    scheduleIdle: idle.schedule,
  });
  await images.succeed(0);
  idle.flushOne();
  const promoted = images.indices()[1];
  loader.get(promoted);
  const before = images.requests.length;
  images.fail(promoted);
  eq(images.requests.length, before + 1, "promoted failure retries immediately");
  eq(images.indices().at(-1)!, promoted, "visible retry retains foreground priority");
  loader.dispose();
}

// A non-visible background failure keeps background priority and needs a fresh
// idle grant before its retry is assigned.
{
  const images = new FakeImages();
  const idle = new ManualIdle();
  const loader = new FrameSequenceLoader(1280, 20, {
    startupAnchorCount: 1,
    imageFactory: images.factory,
    scheduleIdle: idle.schedule,
  });
  await images.succeed(0);
  idle.flushOne();
  const failedIndex = images.indices()[1];
  const beforeFailure = images.requests.length;
  images.fail(failedIndex);
  eq(images.requests.length, beforeFailure, "background retry waits after failure");
  ok(idle.pending > 0, "background retry schedules another idle yield");
  idle.flushOne();
  eq(images.requests.length, beforeFailure + 1, "idle flush authorizes the retry");
  eq(images.indices().at(-1)!, failedIndex, "background retry preserves its class");
  loader.dispose();
}

// Background batches yield between completions and never exceed the configured
// number of actual assignments per idle flush.
{
  const images = new FakeImages();
  const idle = new ManualIdle();
  const loader = new FrameSequenceLoader(1280, 30, {
    startupAnchorCount: 1,
    imageFactory: images.factory,
    scheduleIdle: idle.schedule,
  });
  await images.succeed(0);
  idle.flushOne();
  const firstBatch = images.requests.slice(1);
  eq(firstBatch.length, 2, "first idle flush is capped at batch size two");
  await images.succeed(firstBatch[0].index);
  await images.succeed(firstBatch[1].index);
  ok(idle.pending > 0, "another background batch waits for a new idle flush");
  const before = images.requests.length;
  idle.flushOne();
  ok(images.requests.length - before <= 2, "second idle flush is independently capped");
  loader.dispose();
}

// The exported scheduler seam may invoke synchronously. A completed callback
// must not be written back as a stale pending cancel handle that blocks batch 2.
{
  const images = new FakeImages();
  const idle = new SynchronousIdle();
  const loader = new FrameSequenceLoader(1280, 12, {
    startupAnchorCount: 1,
    imageFactory: images.factory,
    scheduleIdle: idle.schedule,
  });
  await images.succeed(0);
  eq(images.requests.length, 3, "sync idle starts exactly one mobile batch");
  const firstBatch = images.requests.slice(1);
  await images.succeed(firstBatch[0].index);
  await images.succeed(firstBatch[1].index);
  ok(images.requests.length > 3, "sync idle can schedule a later batch");
  ok(idle.callCount >= 2, "sync scheduler is invoked again after completion");
  loader.dispose();
}

// Synchronous custom image events may re-enter pump() from src assignment, but
// they still consume only one idle batch and arrange a later yielded batch.
{
  const images = new FakeImages();
  const idle = new ManualIdle();
  const loader = new FrameSequenceLoader(1280, 12, {
    startupAnchorCount: 1,
    imageFactory: images.factory,
    scheduleIdle: idle.schedule,
  });
  await images.succeed(0);
  images.synchronousResult = "load";
  const before = images.requests.length;
  idle.flushOne();
  eq(images.requests.length - before, 2, "sync src events stay inside one batch");
  await flushPromises();
  ok(idle.pending > 0, "sync src completion yields before the next batch");
  loader.dispose();
}

// External readiness callbacks cannot interrupt committed loader state. Errors
// are reported, while startup, pumping, and background scheduling continue.
{
  const images = new FakeImages();
  const idle = new ManualIdle();
  let firstCalls = 0;
  let startupCalls = 0;
  let reportedErrors = 0;
  const originalConsoleError = console.error;
  console.error = () => {
    reportedErrors++;
  };
  try {
    const loader = new FrameSequenceLoader(1280, 3, {
      concurrency: 2,
      startupAnchorCount: 2,
      imageFactory: images.factory,
      scheduleIdle: idle.schedule,
      onFirstReady: () => {
        firstCalls++;
        throw new Error("first callback failed");
      },
      onStartupReady: () => {
        startupCalls++;
        throw new Error("startup callback failed");
      },
    });
    await images.succeed(0);
    let escaped = false;
    try {
      await images.succeed(2);
    } catch {
      escaped = true;
    }
    ok(!escaped, "readiness callback errors are isolated from image events");
    ok(loader.firstReady && loader.startupReady, "throwing callbacks cannot stall readiness");
    eq(loader.startupLoadedCount, 2, "throwing callbacks preserve settled coverage");
    eq(firstCalls, 1, "throwing first callback remains one-shot");
    eq(startupCalls, 1, "throwing startup callback remains one-shot");
    eq(reportedErrors, 2, "both callback errors are reported");
    eq(idle.pending, 1, "background scheduling survives callback errors");
    loader.dispose();
  } finally {
    console.error = originalConsoleError;
  }
}

// Nearest fallback is limited to the requested window and keeps the existing
// lower-index tie break.
{
  const images = new FakeImages();
  const idle = new ManualIdle();
  const loader = new FrameSequenceLoader(1280, 70, {
    concurrency: 6,
    startupAnchorCount: 1,
    imageFactory: images.factory,
    scheduleIdle: idle.schedule,
  });
  await images.succeed(0);
  loader.get(30);
  const lower = await images.succeed(30);
  eq(loader.get(63) === null ? 1 : 0, 1, "fallback rejects a frame at distance 33");
  ok(loader.get(62) === (lower as unknown as HTMLImageElement), "fallback accepts distance 32");
  const upper = await images.succeed(32);
  ok(loader.get(31) === (lower as unknown as HTMLImageElement), "lower frame wins an equal-distance tie");
  ok(upper !== lower, "tie fixtures are distinct images");
  eq(loader.lastResolved, 30, "nearest diagnostic records the resolved frame");
  loader.dispose();
}

// Empty/small inputs are safe and disposal cancels idle plus invalidates late
// image/decode callbacks without starting retries or publishing readiness.
{
  const emptyImages = new FakeImages();
  let emptyReady = 0;
  const empty = new FrameSequenceLoader(1280, Number.NaN, {
    imageFactory: emptyImages.factory,
    scheduleIdle: new ManualIdle().schedule,
    onStartupReady: () => emptyReady++,
  });
  ok(empty.startupReady, "empty loader is immediately settled");
  eq(emptyReady, 1, "empty startup callback fires once");
  ok(empty.get(0) === null, "empty get is null");
  eq(emptyImages.requests.length, 0, "empty loader creates no images");
  empty.dispose();

  const images = new FakeImages();
  const idle = new ManualIdle();
  let readyCount = 0;
  const loader = new FrameSequenceLoader(1280, 5, {
    concurrency: 1,
    startupAnchorCount: 1,
    imageFactory: images.factory,
    scheduleIdle: idle.schedule,
    onStartupReady: () => readyCount++,
  });
  const zero = images.active(0);
  const capturedLoad = zero.onload;
  zero.fireLoad();
  await flushPromises();
  eq(zero.decodeCalls, 1, "dispose fixture owns a pending decode");
  loader.dispose();
  eq(loader.inFlightCount, 0, "dispose clears in-flight diagnostics");
  ok(zero.onload === null && zero.onerror === null, "dispose detaches handlers");
  ok(zero.cleared, "dispose clears image sources after detaching handlers");
  zero.decoded.resolve(undefined);
  capturedLoad?.();
  await flushPromises();
  eq(readyCount, 0, "late decode/events cannot publish readiness");
  eq(images.requests.length, 1, "late callbacks cannot start a retry");

  const loadedImages = new FakeImages();
  const loadedIdle = new ManualIdle();
  const loaded = new FrameSequenceLoader(1280, 5, {
    startupAnchorCount: 1,
    imageFactory: loadedImages.factory,
    scheduleIdle: loadedIdle.schedule,
  });
  await loadedImages.succeed(0);
  eq(loadedIdle.pending, 1, "ready loader owns one idle callback");
  loaded.dispose();
  ok(loadedIdle.cancelCount >= 1, "dispose cancels scheduled idle work");
  const before = loadedImages.requests.length;
  loadedIdle.flushAll();
  eq(loadedImages.requests.length, before, "cancelled idle work creates no images");
}

console.log("✓ staged frame loader");
