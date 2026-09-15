// End-to-end proof that THE SCROLL IS TIED TO THE VIDEO.
//
// The claim under test is not "the painted frame is rate-limited" (that is
// scrubrate.mjs) but the stronger one the client asked for: inside the video
// zone the PAGE ITSELF may not move faster than the clip, so the video, the
// Lottie titles, the 3D figures and the gallery card morph are never out of
// phase with each other — not even for a frame, not even on a violent flick.
//
// Everything here is driven with TRUSTED INPUT. window.scrollTo is deliberately
// never used: the soft pin owns wheel/touch and writes the document itself, so
// a programmatic scroll would bypass exactly the thing being measured.
//   desktop: page.mouse.wheel          (CDP Input.dispatchMouseEvent)
//   mobile:  Input.dispatchTouchEvent  (touchStart / touchMove xN / touchEnd)
//
//   node scripts/verify/sync.mjs
//   node scripts/verify/sync.mjs --url http://127.0.0.1:5183   (reuse a server)
//   node scripts/verify/sync.mjs --only desktop|touch
//
// The known SwiftShader-only 1-2 px black vertical centre line is irrelevant
// here: nothing in this probe reads pixels.
import puppeteer from "puppeteer-core";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = Number(opt("port", "5183"));
const externalUrl = opt("url", null);
const url = externalUrl ?? `http://127.0.0.1:${PORT}`;
const only = opt("only", null);
const CHROME =
  process.env.CHROME ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// ── Authored constants, mirrored from src/constants.ts + src/playback.ts ─────
// Keep in sync (the other scripts/verify probes do the same — plain node cannot
// import the TypeScript sources).
const SCROLL_TRACK_VH = 1240;
const VIDEO_CARD_TRACK_VH = 140;
const VIDEO_START = 504 / SCROLL_TRACK_VH;
const LOTTIE_END = 544 / SCROLL_TRACK_VH;
const VID_FLY_END = 0.4;
const VIDEO_SPLIT = 0.84;
const FRAME_COUNT = 295;
const FRAME_SPAN = FRAME_COUNT - 1;
const NATIVE_FPS = 12.5;
const VIDEO_TIME_KNOTS = [
  [VIDEO_START, 0],
  [545.6 / SCROLL_TRACK_VH, 0.11],
  [551.8 / SCROLL_TRACK_VH, 0.139],
  [769.8 / SCROLL_TRACK_VH, 0.248],
  [843.1 / SCROLL_TRACK_VH, 0.592],
  [1228.5 / SCROLL_TRACK_VH, 0.786],
  [1, VIDEO_SPLIT],
];

function animTrackClipTimeFor(sp) {
  const s = Math.min(Math.max(sp, VIDEO_START), 1);
  for (let i = 1; i < VIDEO_TIME_KNOTS.length; i += 1) {
    const [s1, f1] = VIDEO_TIME_KNOTS[i];
    if (s <= s1) {
      const [s0, f0] = VIDEO_TIME_KNOTS[i - 1];
      return f0 + ((s - s0) / (s1 - s0)) * (f1 - f0);
    }
  }
  return VIDEO_SPLIT;
}

// The clip frame implied by the PUBLISHED progress — computed here, from the
// authored knots, so the probe never just trusts window.__fp.target.
function frameForProgress(sp, gp) {
  const t =
    gp <= 0
      ? animTrackClipTimeFor(sp)
      : Math.min(VIDEO_SPLIT + Math.min(gp / VID_FLY_END, 1) * (1 - VIDEO_SPLIT), 1);
  return t * FRAME_SPAN;
}

// The Lottie plane is on screen while sp < LOTTIE_END (lottiePlaneVisibleFor:
// past that the export is on its transparent final frame).
const LOTTIE_END_FRAME = frameForProgress(LOTTIE_END, 0);
const PINNED_MODES = new Set(["gallery-idle", "gallery-transitioning"]);

// A probe cannot read the governor and the painter at the same instant: both
// values are whatever the LAST animation frame left behind, and under
// SwiftShader frame times swing between ~10 ms and ~80 ms. Two window endpoints
// with different frame ages skew the measured span by up to one frame time,
// which at the native pace is about one frame of clip. So the per-window
// allowance is the contract's 12.5·Δt + 1 plus one frame of sampling skew; the
// RAW rate is printed either way, and the whole-phase average — immune to that
// skew because its span is tens of seconds — is checked against the bare 12.5.
const JITTER_FRAMES = 2;
const OVERALL_CEILING = NATIVE_FPS + 0.1;

const bounds = (innerHeight) => {
  const animY = ((SCROLL_TRACK_VH - 100) / 100) * innerHeight;
  const videoCardPx = (VIDEO_CARD_TRACK_VH / 100) * innerHeight;
  return { animY, startY: VIDEO_START * animY, endY: animY + videoCardPx };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : String(x));

// ── Dev server ──────────────────────────────────────────────────────────────
function listeners(port) {
  try {
    return execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf8",
    })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function startDevServer() {
  if (externalUrl) return null;
  const already = listeners(PORT);
  if (already.length > 0) {
    throw new Error(
      `port ${PORT} is already in use by pid(s) ${already.join(", ")} — ` +
        `kill them or pass --url`,
    );
  }
  const child = spawn(
    "npx",
    ["vite", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"],
    { cwd: REPO, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout.on("data", () => {});
  child.stderr.on("data", (d) => process.stderr.write(`[vite] ${d}`));
  for (let i = 0; i < 120; i += 1) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.ok) return child;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error("dev server never came up");
}

function stopDevServer(child) {
  if (child && !child.killed) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
  if (externalUrl) return;
  for (const pid of listeners(PORT)) {
    try {
      process.kill(Number(pid), "SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

// ── Input drivers ───────────────────────────────────────────────────────────
function wheelDriver(page, cdp, viewport) {
  const x = Math.round(viewport.width / 2);
  const y = Math.round(viewport.height / 2);
  const send = (deltaY) =>
    cdp.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x,
      y,
      deltaX: 0,
      deltaY,
    });
  return {
    async pulse(deltaY) {
      await send(deltaY);
    },
    // PIPELINED on purpose: awaiting each CDP ack caps the event rate at ~25/s,
    // well under one event per animation frame, and the soft pin deliberately
    // DROPS what it cannot spend in a tick — so an un-pipelined probe measures
    // its own round-trip latency, not the cap. A real trackpad delivers
    // 60-120 events per second during a flick.
    async drive(deltaY, ms) {
      const until = Date.now() + ms;
      const inFlight = [];
      while (Date.now() < until) {
        inFlight.push(send(deltaY).catch(() => {}));
        if (inFlight.length >= 32) await Promise.all(inFlight.splice(0));
        await sleep(4);
      }
      await Promise.all(inFlight);
    },
    async reverseOnce() {
      await send(-400);
    },
  };
}

function touchDriver(page, cdp, viewport) {
  const x = Math.round(viewport.width / 2);
  const top = Math.round(viewport.height * 0.15);
  const bottom = Math.round(viewport.height * 0.85);
  const send = (type, points) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });

  async function swipe(direction, steps = 44, stepMs = 8) {
    // direction > 0: the finger travels UP the screen, i.e. the page goes DOWN.
    const from = direction > 0 ? bottom : top;
    const to = direction > 0 ? top : bottom;
    await send("touchStart", [{ x, y: from }]);
    const inFlight = [];
    for (let i = 1; i <= steps; i += 1) {
      inFlight.push(
        send("touchMove", [
          { x, y: Math.round(from + ((to - from) * i) / steps) },
        ]).catch(() => {}),
      );
      if (inFlight.length >= 16) await Promise.all(inFlight.splice(0));
      await sleep(stepMs);
    }
    await Promise.all(inFlight);
    await send("touchEnd", []);
  }

  return {
    async pulse(deltaY) {
      await swipe(deltaY > 0 ? 1 : -1, 8, 10);
    },
    async drive(deltaY, ms) {
      const until = Date.now() + ms;
      while (Date.now() < until) await swipe(deltaY > 0 ? 1 : -1);
    },
    async reverseOnce() {
      // One touchmove is one input event — exactly what (iv) asks about.
      await send("touchStart", [{ x, y: top }]);
      await send("touchMove", [{ x, y: top + 60 }]);
      await sleep(60);
      await send("touchEnd", []);
    },
  };
}

// ── Sampling ────────────────────────────────────────────────────────────────
const INSTALL_SAMPLER = () => {
  window.__syncSamples = [];
  if (window.__syncRaf) cancelAnimationFrame(window.__syncRaf);
  let last = -1e9;
  const tick = (now) => {
    window.__syncRaf = requestAnimationFrame(tick);
    if (now - last < 50) return;
    last = now;
    const fp = window.__fp;
    const sg = window.__sg;
    if (!fp || !sg) return;
    window.__syncSamples.push({
      ms: now,
      target: fp.target,
      displayed: fp.displayed,
      sp: sg.sp,
      gp: sg.gp,
      clipT: sg.clipT,
      mode: sg.galleryMode,
      virtualY: sg.virtualY,
      capActive: sg.capActive,
      scrollY: window.scrollY,
    });
  };
  window.__syncRaf = requestAnimationFrame(tick);
};

// ── Analysis ────────────────────────────────────────────────────────────────
function analyse(samples, label) {
  const failures = [];
  const n = samples.length;
  if (n < 20) failures.push(`${label}: only ${n} samples`);

  // (i) rate over every window of at least one second.
  let worstTarget = { excess: -Infinity, rate: 0, span: 0 };
  let worstDisplayed = { excess: -Infinity, rate: 0, span: 0 };
  for (let j = 1; j < n; j += 1) {
    for (let i = 0; i < j; i += 1) {
      const span = (samples[j].ms - samples[i].ms) / 1000;
      if (span < 1) continue;
      const allowance = NATIVE_FPS * span + 1 + JITTER_FRAMES;
      const dTarget =
        Math.abs(samples[j].clipT - samples[i].clipT) * FRAME_SPAN;
      const dDisplayed = Math.abs(samples[j].displayed - samples[i].displayed);
      if (dTarget - allowance > worstTarget.excess) {
        worstTarget = { excess: dTarget - allowance, rate: dTarget / span, span };
      }
      if (dDisplayed - allowance > worstDisplayed.excess) {
        worstDisplayed = { excess: dDisplayed - allowance, rate: dDisplayed / span, span };
      }
    }
  }
  if (worstTarget.excess > 0) {
    failures.push(
      `${label} (i): target moved ${fmt(worstTarget.rate, 3)} frames/s over a ` +
        `${fmt(worstTarget.span)} s window`,
    );
  }
  if (worstDisplayed.excess > 0) {
    failures.push(
      `${label} (i): painted frame moved ${fmt(worstDisplayed.rate, 3)} frames/s`,
    );
  }

  // (ii) the painted frame never falls behind the request.
  let maxLag = 0;
  // (iii) phase coherence.
  let pinnedMinDisplayed = Infinity;
  let unpinnedMaxDisplayed = -Infinity;
  let lottieViolations = 0;
  let maxSpFrameGap = 0;
  let worstSpSample = null;
  // (v) the document follows the virtual position.
  let maxDrift = 0;
  let cappedSamples = 0;
  // Whole-phase average: the one number no sampling skew can inflate.
  const phaseSpan = (samples[n - 1].ms - samples[0].ms) / 1000;
  const phaseFrames =
    Math.abs(samples[n - 1].clipT - samples[0].clipT) * FRAME_SPAN;
  const overallRate = phaseSpan > 0 ? phaseFrames / phaseSpan : 0;
  if (overallRate > OVERALL_CEILING) {
    failures.push(
      `${label} (i): whole-phase average ${fmt(overallRate, 3)} frames/s exceeds the native ${NATIVE_FPS}`,
    );
  }

  for (const s of samples) {
    maxLag = Math.max(maxLag, Math.abs(s.target - s.displayed));
    if (PINNED_MODES.has(s.mode)) {
      pinnedMinDisplayed = Math.min(pinnedMinDisplayed, s.displayed);
    } else {
      unpinnedMaxDisplayed = Math.max(unpinnedMaxDisplayed, s.displayed);
    }
    const lottieVisible = s.sp < LOTTIE_END;
    if (lottieVisible && s.displayed > LOTTIE_END_FRAME + 2) lottieViolations += 1;
    if (!lottieVisible && s.displayed < LOTTIE_END_FRAME - 2) lottieViolations += 1;
    const spFrameGap = Math.abs(frameForProgress(s.sp, s.gp) - s.displayed);
    if (spFrameGap > maxSpFrameGap) {
      maxSpFrameGap = spFrameGap;
      worstSpSample = s;
    }
    if (s.capActive) {
      cappedSamples += 1;
      maxDrift = Math.max(maxDrift, Math.abs(s.scrollY - s.virtualY));
    }
  }

  if (maxLag > 2.5) failures.push(`${label} (ii): |target-displayed| reached ${fmt(maxLag, 3)}`);
  if (pinnedMinDisplayed < 292) {
    failures.push(
      `${label} (iii): card mode reached with the clip on frame ${fmt(pinnedMinDisplayed, 1)}`,
    );
  }
  if (lottieViolations > 0) {
    failures.push(`${label} (iii): ${lottieViolations} Lottie/clip phase mismatches`);
  }
  if (maxSpFrameGap > 2.5) {
    failures.push(
      `${label} (iii): published sp implies a frame ${fmt(maxSpFrameGap, 2)} away from the painted one`,
    );
  }
  if (cappedSamples > 0 && maxDrift > 4) {
    failures.push(`${label} (v): document drifted ${fmt(maxDrift, 2)} px from virtualY`);
  }

  return {
    failures,
    n,
    targetRate: worstTarget.rate,
    displayedRate: worstDisplayed.rate,
    maxLag,
    pinnedMinDisplayed,
    unpinnedMaxDisplayed,
    lottieViolations,
    maxSpFrameGap,
    maxDrift,
    cappedSamples,
    worstSpSample,
    overallRate,
    phaseSpan,
    phaseFrames,
  };
}

function report(label, a) {
  console.log(`  ${label}`);
  console.log(
    `    (i)   max 1s-window rate: target ${fmt(a.targetRate, 3)} f/s, ` +
      `painted ${fmt(a.displayedRate, 3)} f/s  (native ${NATIVE_FPS}, ` +
      `allowance 12.5·Δt+${1 + JITTER_FRAMES})`,
  );
  console.log(
    `          whole phase: ${fmt(a.phaseFrames, 1)} frames in ${fmt(a.phaseSpan)} s ` +
      `= ${fmt(a.overallRate, 3)} f/s`,
  );
  console.log(`    (ii)  max |target - displayed| = ${fmt(a.maxLag, 3)} frames`);
  console.log(
    `    (iii) min painted frame while card-pinned = ${fmt(a.pinnedMinDisplayed, 1)} ` +
      `(need >= 292); max painted frame before the pin = ${fmt(a.unpinnedMaxDisplayed, 1)}`,
  );
  console.log(
    `          Lottie/clip phase mismatches = ${a.lottieViolations} ` +
      `(boundary frame ${fmt(LOTTIE_END_FRAME, 1)}); ` +
      `max |frame(published sp) - painted| = ${fmt(a.maxSpFrameGap, 2)}`,
  );
  if (a.worstSpSample) {
    const w = a.worstSpSample;
    console.log(
      `          worst at sp=${fmt(w.sp, 5)} gp=${fmt(w.gp, 5)} mode=${w.mode} ` +
        `cap=${w.capActive} target=${w.target} painted=${fmt(w.displayed, 2)} ` +
        `frame(sp)=${fmt(frameForProgress(w.sp, w.gp), 2)}`,
    );
  }
  console.log(
    `    (v)   max |window.scrollY - __sg.virtualY| in-zone = ${fmt(a.maxDrift, 2)} px ` +
      `over ${a.cappedSamples}/${a.n} samples`,
  );
}

// ── One profile (desktop wheel / mobile touch) ──────────────────────────────
async function runProfile(browser, profile) {
  const failures = [];
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log(`  PAGEERROR ${e.message}`));
  if (profile.emulate) await page.emulate(profile.emulate);
  else await page.setViewport(profile.viewport);

  const cdp = await page.createCDPSession();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => !document.body.classList.contains("scroll-locked"),
    { timeout: 90000 },
  );
  await page.waitForFunction(() => Boolean(window.__fp && window.__sg), {
    timeout: 30000,
  });

  const innerHeight = await page.evaluate(() => window.innerHeight);
  const zone = bounds(innerHeight);
  const driver = profile.emulate
    ? touchDriver(page, cdp, profile.emulate.viewport)
    : wheelDriver(page, cdp, profile.viewport);

  console.log(
    `\n== ${profile.name} (innerHeight ${innerHeight}, zone ` +
      `${fmt(zone.startY, 0)} → ${fmt(zone.endY, 0)} px) ==`,
  );

  // ── approach: ordinary native scrolling up to just before VIDEO_START ─────
  for (let i = 0; i < 200; i += 1) {
    const y = await page.evaluate(() => window.scrollY);
    if (y >= zone.startY - 800) break;
    await driver.pulse(400);
  }
  await sleep(1500); // let any native fling settle
  const entry = await page.evaluate(() => ({
    scrollY: window.scrollY,
    virtualY: window.__sg.virtualY,
    capActive: window.__sg.capActive,
  }));
  console.log(
    `  approach settled at scrollY ${fmt(entry.scrollY, 1)} ` +
      `(zone start ${fmt(zone.startY, 1)}, capActive ${entry.capActive})`,
  );

  // Make sure the soft pin is engaged before the discrete tests.
  for (let i = 0; i < 200; i += 1) {
    const armed = await page.evaluate(() => window.__sg.capActive);
    if (armed) break;
    await driver.pulse(400);
    await sleep(40);
  }
  const armed = await page.evaluate(() => window.__sg.capActive);
  if (!armed) failures.push(`${profile.name}: the video zone never took ownership`);

  // Momentum entry: the document must sit on the virtual position, not past it.
  const afterEntry = await page.evaluate(() => ({
    scrollY: window.scrollY,
    virtualY: window.__sg.virtualY,
  }));
  console.log(
    `  zone entry: scrollY ${fmt(afterEntry.scrollY, 1)} vs virtualY ` +
      `${fmt(afterEntry.virtualY, 1)} (Δ ${fmt(Math.abs(afterEntry.scrollY - afterEntry.virtualY), 2)} px)`,
  );

  // ── (iv) one reverse input lowers the published sp within two ticks ───────
  await sleep(400);
  const spBefore = await page.evaluate(() => window.__sg.sp);
  await driver.reverseOnce();
  await sleep(Math.ceil((2 * 1000) / 60) + 20);
  const spAfter = await page.evaluate(() => window.__sg.sp);
  const reverseDelta = spBefore - spAfter;
  if (!(spAfter < spBefore)) {
    failures.push(
      `${profile.name} (iv): one reverse input did not lower sp within 2 ticks ` +
        `(${spBefore} → ${spAfter})`,
    );
  }
  console.log(
    `    (iv)  one reverse input lowered sp by ${reverseDelta.toExponential(2)} ` +
      `within 2 ticks (${spAfter < spBefore ? "PASS" : "FAIL"})`,
  );

  // ── the hard forward flick ────────────────────────────────────────────────
  await sleep(300);
  await page.evaluate(INSTALL_SAMPLER);
  const forwardStart = Date.now();
  let pinned = false;
  while (Date.now() - forwardStart < 90000 && !pinned) {
    await driver.drive(2000, 500);
    pinned = await page.evaluate(() =>
      ["gallery-idle", "gallery-transitioning"].includes(window.__sg.galleryMode),
    );
  }
  const forwardSeconds = (Date.now() - forwardStart) / 1000;
  await sleep(8000); // 8 s of quiet, still sampling
  const forwardSamples = await page.evaluate(() => window.__syncSamples.slice());
  const forward = analyse(forwardSamples, `${profile.name} forward`);
  failures.push(...forward.failures);
  if (!pinned) {
    failures.push(`${profile.name}: the forward flick never reached the pinned gallery`);
  }
  console.log(
    `  forward flick: requested ~unbounded, took ${fmt(forwardSeconds)} s to ` +
      `cross the ${fmt(zone.endY - zone.startY, 0)} px zone ` +
      `(clip runtime ${fmt(FRAME_SPAN / NATIVE_FPS)} s), reached the pin: ${pinned}`,
  );
  report("forward", forward);

  // How quickly the page stops when the input stops (the "no coasting" claim).
  const quietFrom = forwardSamples.findIndex(
    (s) => s.ms > forwardSamples[forwardSamples.length - 1].ms - 7800,
  );
  if (quietFrom > 0) {
    const tail = forwardSamples.slice(quietFrom);
    const moved = Math.abs(tail[tail.length - 1].displayed - tail[0].displayed);
    console.log(`    after input stopped, the clip moved ${fmt(moved, 2)} more frames in 7.8 s`);
  }

  // ── the hard flick back ───────────────────────────────────────────────────
  await page.evaluate(INSTALL_SAMPLER);
  const backStart = Date.now();
  let escaped = false;
  while (Date.now() - backStart < 90000 && !escaped) {
    await driver.drive(-2000, 500);
    escaped = await page.evaluate(
      (startY) => window.scrollY < startY - 10 && !window.__sg.capActive,
      zone.startY,
    );
  }
  const backSeconds = (Date.now() - backStart) / 1000;
  await sleep(3000);
  const backSamples = await page.evaluate(() => window.__syncSamples.slice());
  const backward = analyse(backSamples, `${profile.name} reverse`);
  failures.push(...backward.failures);
  if (!escaped) {
    failures.push(`${profile.name}: the reverse flick never rewound out of the zone`);
  }
  console.log(
    `  reverse flick: took ${fmt(backSeconds)} s to rewind the zone, left it: ${escaped}`,
  );
  report("reverse", backward);

  await page.close();
  return failures;
}

// ── Main ────────────────────────────────────────────────────────────────────
const IPHONE = {
  name: "iPhone 390x844",
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  viewport: {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    isLandscape: false,
  },
};

const profiles = [
  {
    key: "desktop",
    name: "desktop wheel 1280x800",
    viewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
  },
  { key: "touch", name: "mobile touch 390x844", emulate: IPHONE },
].filter((p) => !only || p.key === only);

let server = null;
let browser = null;
const allFailures = [];
try {
  server = await startDevServer();
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      "--enable-unsafe-swiftshader",
      "--use-angle=swiftshader-webgl",
      "--window-size=1280,800",
    ],
    defaultViewport: null,
  });
  for (const profile of profiles) {
    allFailures.push(...(await runProfile(browser, profile)));
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  stopDevServer(server);
}

console.log("");
if (allFailures.length > 0) {
  for (const failure of allFailures) console.log(`FAIL ${failure}`);
  console.log(`\nFAIL — ${allFailures.length} assertion(s) broke`);
  process.exitCode = 1;
} else {
  console.log(
    "PASS — the page never outran the clip, the picture never lagged the " +
      "progress, and every phase stayed coherent",
  );
}
if (flag("keep-open")) await sleep(600000);
