// Browser regression for the scroll governor's video-to-gallery boundary.
//
// Governed movement is driven exclusively with trusted CDP wheel input. The
// only programmatic scroll is the setup reset performed before the complete
// boundary -> quiet -> fresh -> reverse story begins.
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
const timeoutMs = positiveNumber("timeout-ms", 45000);

const VID_FLY_END = 0.4;
const DIAGNOSTIC_EPSILON = 1e-7;
const RAW_ALIGNMENT_EPSILON_PX = 1;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readGovernor(page) {
  const sample = await page.evaluate(() => {
    const diagnostic = window.__sg;
    if (!diagnostic) return null;
    return {
      ...diagnostic,
      scrollY: window.scrollY,
    };
  });
  if (!sample) throw new Error("window.__sg is unavailable (run a DEV build)");
  for (const field of [
    "rawY",
    "virtualY",
    "scrollY",
    "clipT",
    "gp",
    "sp",
    "discardedForwardPx",
  ]) {
    if (!Number.isFinite(sample[field])) {
      throw new Error(`window.__sg.${field} is not finite`);
    }
  }
  if (typeof sample.gestureActive !== "boolean") {
    throw new Error("window.__sg.gestureActive is not boolean");
  }
  return sample;
}

async function waitForQuiet(page, minimumMs = 360) {
  await sleep(minimumMs);
  const sample = await readGovernor(page);
  if (sample.gestureActive) throw new Error("gesture remained active");
  if (Math.abs(sample.scrollY - sample.virtualY) > 1) {
    throw new Error("raw/virtual scroll did not reanchor");
  }
  return sample;
}

async function trustedWheelOnce(page, deltaY, accept, label) {
  const before = await readGovernor(page);
  await page.mouse.wheel({ deltaY });
  const deadline = Date.now() + 3000;
  let after = before;
  while (Date.now() < deadline) {
    after = await readGovernor(page);
    if (accept(after, before)) return { before, after, eventCount: 1 };
    await sleep(10);
  }
  throw new Error(
    `${label}: trusted wheel produced no expected publication ` +
      `(before raw=${before.rawY}, virtual=${before.virtualY}, ` +
      `clipT=${before.clipT}, gp=${before.gp}; ` +
      `after raw=${after.rawY}, virtual=${after.virtualY}, ` +
      `clipT=${after.clipT}, gp=${after.gp}, ` +
      `discarded=${after.discardedForwardPx})`,
  );
}

async function resetToTop(page) {
  await waitForQuiet(page);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await sleep(40);

  let sample = await readGovernor(page);
  if (sample.gestureActive) {
    throw new Error("could not clear gesture state before top reset");
  }

  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  });

  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    sample = await readGovernor(page);
    const physicalAtTop = Math.abs(sample.scrollY) <= RAW_ALIGNMENT_EPSILON_PX;
    const rawAtTop = Math.abs(sample.rawY) <= RAW_ALIGNMENT_EPSILON_PX;
    const virtualAtTop = Math.abs(sample.virtualY) <= RAW_ALIGNMENT_EPSILON_PX;
    const clipAtTop = Math.abs(sample.clipT) <= DIAGNOSTIC_EPSILON;
    const galleryAtTop = Math.abs(sample.gp) <= DIAGNOSTIC_EPSILON;
    if (
      !sample.gestureActive &&
      physicalAtTop &&
      rawAtTop &&
      virtualAtTop &&
      clipAtTop &&
      galleryAtTop
    ) {
      return sample;
    }
    await sleep(10);
  }

  throw new Error(
    `could not reset governor to top ` +
      `(active=${sample.gestureActive}, scrollY=${sample.scrollY}, ` +
      `rawY=${sample.rawY}, virtualY=${sample.virtualY}, ` +
      `clipT=${sample.clipT}, gp=${sample.gp})`,
  );
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
  const approximately = (actual, expected, tolerance) =>
    Math.abs(actual - expected) <= tolerance;

  await resetToTop(page);
  const documentEnd = await page.evaluate(() => {
    const root = document.scrollingElement || document.documentElement;
    return Math.max(root.scrollHeight - window.innerHeight, 0);
  });
  if (!Number.isFinite(documentEnd) || documentEnd <= 0) {
    throw new Error(`document end is invalid (${documentEnd})`);
  }
  const hugeDelta = documentEnd + height;

  // One oversized trusted event must cross the full video but may not spill
  // into the gallery during the same gesture.
  const boundary = await trustedWheelOnce(
    page,
    hugeDelta,
    (after) =>
      after.clipT >= 1 - DIAGNOSTIC_EPSILON &&
      Math.abs(after.gp - VID_FLY_END) <= DIAGNOSTIC_EPSILON &&
      after.discardedForwardPx > 1,
    "huge boundary gesture",
  );
  check(
    approximately(boundary.before.clipT, 0, DIAGNOSTIC_EPSILON),
    `boundary gesture did not start at clipT=0 (clipT=${boundary.before.clipT})`,
  );
  check(
    approximately(boundary.before.gp, 0, DIAGNOSTIC_EPSILON),
    `boundary gesture did not start at gp=0 (gp=${boundary.before.gp})`,
  );
  check(
    boundary.eventCount === 1,
    `boundary story sent ${boundary.eventCount} trusted wheel events`,
  );
  check(
    approximately(boundary.after.clipT, 1, DIAGNOSTIC_EPSILON),
    `single boundary event did not reach clipT=1 (clipT=${boundary.after.clipT})`,
  );
  check(
    approximately(boundary.after.gp, VID_FLY_END, DIAGNOSTIC_EPSILON),
    `single boundary event escaped the seam (gp=${boundary.after.gp})`,
  );
  check(
    boundary.after.virtualY > boundary.before.virtualY + 1,
    "single boundary event did not advance virtual scroll",
  );
  check(
    boundary.after.discardedForwardPx > 1,
    "single boundary event did not discard gallery spillover",
  );
  check(
    boundary.after.clipT - boundary.before.clipT >=
      1 - 2 * DIAGNOSTIC_EPSILON,
    "single boundary event did not cross the whole video",
  );

  // With no further input, the held boundary must reanchor without debt or
  // delayed motion.
  const held = boundary.after;
  const quiet = await waitForQuiet(page, 360);
  const quietVirtualDrift = Math.abs(quiet.virtualY - held.virtualY);
  const quietClipDrift = Math.abs(quiet.clipT - held.clipT);
  const quietRawAlignment = Math.abs(quiet.scrollY - quiet.virtualY);
  check(!quiet.gestureActive, "boundary gesture remained active after quiet");
  check(
    quietRawAlignment <= RAW_ALIGNMENT_EPSILON_PX,
    `quiet raw/virtual alignment error is ${quietRawAlignment}px`,
  );
  check(
    quietVirtualDrift <= RAW_ALIGNMENT_EPSILON_PX,
    `virtual scroll drifted by ${quietVirtualDrift}px without input`,
  );
  check(
    quietClipDrift <= DIAGNOSTIC_EPSILON,
    `clip drifted by ${quietClipDrift} without input`,
  );
  check(
    approximately(quiet.gp, VID_FLY_END, DIAGNOSTIC_EPSILON),
    `quiet boundary moved away from gp=0.4 (gp=${quiet.gp})`,
  );
  check(
    quiet.discardedForwardPx <=
      held.discardedForwardPx + DIAGNOSTIC_EPSILON,
    "discarded distance increased while no input occurred",
  );

  // No setup occurs between the boundary event and this new trusted gesture.
  // A fresh gesture owns the gallery immediately and starts clean diagnostics.
  const freshDelta = Math.max(height * 0.5, 300);
  const fresh = await trustedWheelOnce(
    page,
    freshDelta,
    (after) => after.gp > VID_FLY_END + DIAGNOSTIC_EPSILON,
    "fresh gallery gesture",
  );
  const freshVirtualDelta = fresh.after.virtualY - fresh.before.virtualY;
  check(
    approximately(fresh.before.gp, VID_FLY_END, DIAGNOSTIC_EPSILON),
    `fresh gesture did not begin at gp=0.4 (gp=${fresh.before.gp})`,
  );
  check(
    fresh.after.gp > VID_FLY_END + DIAGNOSTIC_EPSILON,
    `fresh gesture did not enter the gallery (gp=${fresh.after.gp})`,
  );
  check(
    freshVirtualDelta > 1,
    `fresh gesture advanced virtual scroll by only ${freshVirtualDelta}px`,
  );
  check(
    fresh.eventCount === 1,
    `fresh story sent ${fresh.eventCount} trusted wheel events`,
  );
  check(
    approximately(fresh.after.discardedForwardPx, 0, DIAGNOSTIC_EPSILON),
    `fresh gesture retained ${fresh.after.discardedForwardPx}px of discarded distance`,
  );

  // Reverse from the resulting physical position, again without any setup
  // seek. Reverse input is exact and does not inherit the old boundary gate.
  await waitForQuiet(page, 360);
  const reverseDelta = -(freshDelta + height * 0.5);
  const reverse = await trustedWheelOnce(
    page,
    reverseDelta,
    (after, before) => after.virtualY < before.virtualY - 1,
    "reverse gesture",
  );
  const reverseRawDelta = reverse.after.rawY - reverse.before.rawY;
  const reversePhysicalDelta =
    reverse.after.scrollY - reverse.before.scrollY;
  const reverseVirtualDelta =
    reverse.after.virtualY - reverse.before.virtualY;
  const reverseError = Math.abs(
    Math.abs(reverseRawDelta) - Math.abs(reverseVirtualDelta),
  );
  check(
    reverseRawDelta < -1,
    `reverse raw scroll moved by ${reverseRawDelta}px`,
  );
  check(
    reversePhysicalDelta < -1,
    `reverse physical scroll moved by ${reversePhysicalDelta}px`,
  );
  check(
    reverseVirtualDelta < -1,
    `reverse virtual scroll moved by ${reverseVirtualDelta}px`,
  );
  check(
    reverse.after.gp < reverse.before.gp - DIAGNOSTIC_EPSILON,
    `reverse gesture did not decrease gallery progress ` +
      `(gp=${reverse.before.gp} -> ${reverse.after.gp})`,
  );
  check(
    reverse.eventCount === 1,
    `reverse story sent ${reverse.eventCount} trusted wheel events`,
  );
  check(
    reverseError <= RAW_ALIGNMENT_EPSILON_PX,
    `reverse raw/virtual distance error is ${reverseError}px`,
  );

  console.log(`governor viewport=${width}x${height}`);
  console.log(
    `  boundary events=${boundary.eventCount} ` +
      `clip=${boundary.before.clipT.toFixed(0)}\u2192${boundary.after.clipT.toFixed(0)} ` +
      `gp=${boundary.after.gp.toFixed(6)} ` +
      `requestedDelta=${hugeDelta.toFixed(2)} ` +
      `discardedPx=${boundary.after.discardedForwardPx.toFixed(2)}`,
  );
  console.log(
    `  quiet virtualDriftPx=${quietVirtualDrift.toFixed(6)} ` +
      `clipDrift=${quietClipDrift.toFixed(8)} ` +
      `rawAlignmentPx=${quietRawAlignment.toFixed(6)}`,
  );
  console.log(
    `  fresh gp=${fresh.before.gp.toFixed(6)}\u2192${fresh.after.gp.toFixed(6)} ` +
      `virtualDeltaPx=${freshVirtualDelta.toFixed(2)}`,
  );
  console.log(
    `  reverse gp=${reverse.before.gp.toFixed(6)}\u2192${reverse.after.gp.toFixed(6)} ` +
      `rawDeltaPx=${reverseRawDelta.toFixed(2)} ` +
      `virtualDeltaPx=${reverseVirtualDelta.toFixed(2)} ` +
      `errorPx=${reverseError.toFixed(6)}`,
  );

  if (failures.length) {
    for (const failure of failures) console.error(`FAIL \u2014 ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(
      "PASS \u2014 boundary-only gate, debt-free quiet, reverse, and fresh gallery gesture",
    );
  }
} catch (error) {
  console.error("governor verifier failed:", error);
  process.exitCode = 1;
} finally {
  if (browser) await closeBrowserWithin(browser);
}
