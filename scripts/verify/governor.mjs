// Browser regression for the native-speed scroll governor.
//
// Governed movement is driven exclusively with trusted CDP wheel input. Direct
// scrollTo calls are used only while no gesture is active, to place the test at
// a known clip position.
//
//   node scripts/verify/governor.mjs \
//     --url http://127.0.0.1:5173 --viewport 390x844
import puppeteer from "puppeteer-core";

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`--${name} requires a value`);
  }
  return value;
};

const positiveNumber = (name, fallback) => {
  const value = Number(opt(name, String(fallback)));
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`--${name} must be a positive number`);
  }
  return value;
};

const viewportMatch = /^(\d+)x(\d+)$/.exec(opt("viewport", "390x844"));
if (!viewportMatch) {
  throw new Error("--viewport must use WIDTHxHEIGHT, for example 390x844");
}
const width = Number(viewportMatch[1]);
const height = Number(viewportMatch[2]);
if (width <= 0 || height <= 0) {
  throw new Error("--viewport dimensions must be positive");
}

const CHROME =
  process.env.CHROME ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const url = opt("url", "http://localhost:5173");
const deltaY = positiveNumber("delta", 1200);
const intervalMs = positiveNumber("interval-ms", 20);
const scenicBurstMs = positiveNumber("burst-ms", 1050);
const endBurstMs = positiveNumber("end-burst-ms", 1800);
const timeoutMs = positiveNumber("timeout-ms", 45000);

const VIDEO_DURATION_S = 23.56;
const VID_FLY_END = 0.4;
const RATE_LIMIT = 1.05;
const QUIET_WAIT_MS = 300;
const INPUT_QUIET_MS = 120;
const DIAGNOSTIC_EPSILON = 1e-7;
const RAW_ALIGNMENT_EPSILON_PX = 1;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readGovernor(page) {
  const sample = await page.evaluate(() => {
    const diagnostic = window.__sg;
    if (!diagnostic) return null;
    return {
      ...diagnostic,
      now: performance.now(),
      scrollY: window.scrollY,
    };
  });
  if (!sample) throw new Error("window.__sg is unavailable (run a DEV build)");
  for (const field of ["clipT", "gp", "sp", "virtualY", "discardedForwardPx", "now"]) {
    if (!Number.isFinite(sample[field])) {
      throw new Error(`window.__sg.${field} is not finite`);
    }
  }
  return sample;
}

async function afterInputDelay(page, delayMs = 20) {
  await sleep(delayMs);
  return readGovernor(page);
}

async function waitForQuiet(page, waitMs = QUIET_WAIT_MS) {
  await sleep(waitMs);
  const sample = await readGovernor(page);
  if (sample.gestureActive) {
    throw new Error(`gesture remained active after ${waitMs}ms without input`);
  }
  if (Math.abs(sample.scrollY - sample.virtualY) > RAW_ALIGNMENT_EPSILON_PX) {
    throw new Error(
      `raw/virtual scroll did not reanchor after quiet ` +
        `(raw=${sample.scrollY}, virtual=${sample.virtualY})`,
    );
  }
  return sample;
}

async function seekClipOutsideGesture(page, targetClipT) {
  await waitForQuiet(page);
  // Isolate setup from the previous scenario's native momentum quarantine.
  // This synthetic interruption is setup-only; every governed assertion below
  // still uses trusted page.mouse.wheel input.
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await sleep(40);
  const reset = await readGovernor(page);
  if (
    reset.gestureActive ||
    Math.abs(reset.scrollY - reset.virtualY) > RAW_ALIGNMENT_EPSILON_PX
  ) {
    throw new Error(
      `could not reset governor for programmatic setup ` +
        `(active=${reset.gestureActive}, raw=${reset.scrollY}, ` +
        `virtual=${reset.virtualY})`,
    );
  }

  let low = 0;
  let high = await page.evaluate(() => {
    const root = document.scrollingElement || document.documentElement;
    return Math.max(root.scrollHeight - window.innerHeight, 0);
  });

  for (let index = 0; index < 24; index += 1) {
    const y = (low + high) / 2;
    await page.evaluate((nextY) => {
      window.scrollTo({ top: nextY, behavior: "auto" });
    }, y);
    await sleep(20);
    const sample = await readGovernor(page);
    if (sample.gestureActive) {
      throw new Error("programmatic setup was incorrectly attributed to a gesture");
    }
    if (sample.clipT < targetClipT) low = y;
    else high = y;
  }

  await page.evaluate((nextY) => {
    window.scrollTo({ top: nextY, behavior: "auto" });
  }, (low + high) / 2);
  await sleep(40);
  const result = await readGovernor(page);
  if (Math.abs(result.clipT - targetClipT) > 0.003) {
    throw new Error(
      `could not seek to clipT=${targetClipT}; landed at ${result.clipT}`,
    );
  }
  return result;
}

async function trustedWheel(page, amount, settleMs = intervalMs) {
  const before = await readGovernor(page);
  await page.mouse.wheel({ deltaY: amount });
  const deadline = Date.now() + 1000;
  let after = before;
  do {
    after = await afterInputDelay(page, settleMs);
    const moved =
      amount < 0
        ? after.virtualY < before.virtualY
        : after.virtualY > before.virtualY;
    if (moved) return after;
  } while (Date.now() < deadline);
  return after;
}

async function trustedWheelBurst(page, { amount, durationMs }) {
  const before = await readGovernor(page);
  const deadline = Date.now() + durationMs;
  let eventCount = 0;
  let lastScheduledAt = null;
  let maxScheduleGapMs = 0;
  const pendingWheels = [];

  // Do not await rAF or inspect WebGL state between wheel events. A headless
  // WebGL frame can take >120ms, which would accidentally split this into many
  // gestures and make the lock test meaningless.
  do {
    const scheduledAt = Date.now();
    if (lastScheduledAt !== null) {
      maxScheduleGapMs = Math.max(
        maxScheduleGapMs,
        scheduledAt - lastScheduledAt,
      );
    }
    lastScheduledAt = scheduledAt;
    // Intentionally do not await each CDP acknowledgement. Rendering can make
    // an acknowledgement slower than the 120ms gesture quiet window even
    // though the trusted input commands themselves are scheduled continuously.
    pendingWheels.push(page.mouse.wheel({ deltaY: amount }));
    eventCount += 1;
    await sleep(intervalMs);
  } while (Date.now() < deadline);

  await Promise.all(pendingWheels);
  await sleep(Math.max(intervalMs, 25));
  const after = await readGovernor(page);
  const elapsedSeconds = (after.now - before.now) / 1000;
  const rate =
    elapsedSeconds > 0
      ? ((after.clipT - before.clipT) * VIDEO_DURATION_S) / elapsedSeconds
      : 0;
  return {
    before,
    after,
    eventCount,
    rate,
    maxScheduleGapMs,
  };
}

async function closeBrowserWithin(browserInstance, timeoutMs = 5000) {
  let timeoutId;
  await Promise.race([
    browserInstance.close(),
    new Promise((resolve) => {
      timeoutId = setTimeout(() => {
        try {
          browserInstance.disconnect();
          browserInstance.process()?.kill();
        } catch {
          // The process may have exited between the timeout and cleanup.
        }
        resolve();
      }, timeoutMs);
    }),
  ]);
  if (timeoutId !== undefined) clearTimeout(timeoutId);
}

let browser;
try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      "--enable-unsafe-swiftshader",
      "--use-angle=swiftshader-webgl",
      `--window-size=${width},${height}`,
    ],
    defaultViewport: {
      width,
      height,
      deviceScaleFactor: 2,
    },
  });

  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await page.waitForFunction(
    () => !document.body.classList.contains("scroll-locked"),
    { timeout: timeoutMs },
  );
  await page.waitForFunction(
    () =>
      window.__sg &&
      Number.isFinite(window.__sg.clipT) &&
      Number.isFinite(window.__sg.gp),
    { timeout: timeoutMs },
  );
  await page.mouse.move(width / 2, height / 2);

  const failures = [];
  const check = (condition, message) => {
    if (!condition) failures.push(message);
  };

  // Scenic interval: a sustained stream of huge trusted deltas must advance the
  // source clip no faster than real elapsed time.
  await seekClipOutsideGesture(page, 0.2);
  const scenic = await trustedWheelBurst(page, {
    amount: deltaY,
    durationMs: scenicBurstMs,
  });
  check(
    scenic.rate <= RATE_LIMIT + DIAGNOSTIC_EPSILON,
    `sustained forward rate ${scenic.rate.toFixed(4)}x exceeds ${RATE_LIMIT}x`,
  );
  check(
    scenic.after.clipT > scenic.before.clipT + DIAGNOSTIC_EPSILON,
    "sustained forward burst did not advance the clip",
  );
  check(
    scenic.maxScheduleGapMs < INPUT_QUIET_MS,
    `trusted wheel scheduling split the burst (max gap ${scenic.maxScheduleGapMs}ms)`,
  );

  // Lifting/stopping must freeze immediately; no delayed catch-up is allowed.
  const stoppedAt = scenic.after;
  const afterStop = await waitForQuiet(page);
  const stopDrift = Math.abs(afterStop.clipT - stoppedAt.clipT);
  check(
    stopDrift <= DIAGNOSTIC_EPSILON,
    `clip drifted by ${stopDrift} after input stopped`,
  );

  // A fresh burst receives only the normal first-event quantum. The idle time
  // above cannot be converted into playback credit.
  await seekClipOutsideGesture(page, 0.45);
  const creditBefore = await readGovernor(page);
  const creditAfter = await trustedWheel(page, deltaY, 25);
  const creditedSourceSeconds =
    Math.max(creditAfter.clipT - creditBefore.clipT, 0) * VIDEO_DURATION_S;
  const firstEventAllowanceS = 1 / 60 + 0.004;
  check(
    creditedSourceSeconds <= firstEventAllowanceS,
    `fresh burst banked ${creditedSourceSeconds.toFixed(4)}s of source time`,
  );

  // Reverse input is intentionally uncapped and must take effect on its first
  // trusted event, even when it exceeds the forward first-event allowance.
  await waitForQuiet(page);
  await seekClipOutsideGesture(page, 0.55);
  const reverseBefore = await readGovernor(page);
  const reverseAfter = await trustedWheel(page, -deltaY, 25);
  const reverseSourceSeconds =
    (reverseBefore.clipT - reverseAfter.clipT) * VIDEO_DURATION_S;
  check(
    reverseAfter.clipT < reverseBefore.clipT - DIAGNOSTIC_EPSILON,
    "negative burst did not reverse the clip immediately",
  );
  check(
    reverseSourceSeconds > 1 / 60,
    `reverse moved only ${reverseSourceSeconds.toFixed(4)}s; expected uncapped movement`,
  );

  // The gesture that reaches the end of the video-card track stays locked there
  // no matter how much more forward wheel input arrives.
  await waitForQuiet(page);
  await seekClipOutsideGesture(page, 0.998);
  const endBurst = await trustedWheelBurst(page, {
    amount: deltaY,
    durationMs: endBurstMs,
  });
  const held = endBurst.after;
  check(
    held.clipT >= 0.999,
    `end-lock burst did not reach the clip end (clipT=${held.clipT})`,
  );
  check(
    held.gp <= VID_FLY_END + DIAGNOSTIC_EPSILON,
    `same gesture escaped into the gallery (gp=${held.gp})`,
  );
  check(
    endBurst.maxScheduleGapMs < INPUT_QUIET_MS,
    `end-lock wheel scheduling split the burst ` +
      `(max gap ${endBurst.maxScheduleGapMs}ms)`,
  );

  // Once the quiet window has elapsed, a new trusted gesture owns the gallery.
  await waitForQuiet(page);
  const fresh = await trustedWheel(page, Math.max(deltaY / 2, 300), 25);
  check(
    fresh.gp > VID_FLY_END + DIAGNOSTIC_EPSILON,
    `fresh gesture did not enter the gallery (gp=${fresh.gp})`,
  );

  console.log(
    `governor viewport=${width}x${height} wheelEvents=${scenic.eventCount}`,
  );
  console.log(
    `  forward rate=${scenic.rate.toFixed(4)}x ` +
      `max schedule gap=${scenic.maxScheduleGapMs}ms`,
  );
  console.log(
    `  discarded px=${held.discardedForwardPx.toFixed(2)} ` +
      `stop drift=${stopDrift.toFixed(8)}`,
  );
  console.log(
    `  reverse delta=${reverseSourceSeconds.toFixed(4)}s ` +
      `held gp=${held.gp.toFixed(6)} fresh gp=${fresh.gp.toFixed(6)}`,
  );

  if (failures.length) {
    for (const failure of failures) console.error(`FAIL — ${failure}`);
    process.exitCode = 1;
  } else {
    console.log("PASS — native-speed cap, stop, reverse, and gallery lock");
  }
} catch (error) {
  console.error("governor verifier failed:", error);
  process.exitCode = 1;
} finally {
  if (browser) await closeBrowserWithin(browser);
}
