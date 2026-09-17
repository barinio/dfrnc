// Does the PICTURE keep up with the PAGE when frames arrive late?
//
// The bug this exists for: on a loaded machine / slow link, a flick inside the
// video zone makes the page coast on — and right at the END of the coast the
// picture JUMPS several frames at once. `?ease=0` and `?ease=1` alike, so it is
// not the coast ramp.
//
// The claim under test is narrow and mechanical: VideoPlane reports the CHASE
// index as the "painted" frame (setLastPaintedScrubFrame in useFrame), and the
// scroll governor's decode backpressure (decodeBackpressuredY) trusts it. When
// the loader is starved the chase index and the page keep advancing while the
// texture HOLDS the last decoded image, so the gap between what the page says
// and what the eye sees grows silently, and is paid off in one step when the
// images finally land.
//
// So this probe measures THREE numbers over one flick:
//   max(target − textureFrame)  how far the page ran ahead of the picture
//   longest hold                ms with textureFrame frozen while target moved
//   max step                    biggest single-sample change of textureFrame
// textureFrame is DEV-only instrumentation in VideoPlane (__fp.textureFrame):
// the index of the image ACTUALLY bound to the texture, which is not __fp.idx
// (what the chase asked for) nor __fp.resolved (which is −1 on a hold).
//
// Starvation is emulated by delaying only the /frames/ requests (CDP Fetch), so
// the app itself still boots at full speed — Network.emulateNetworkConditions
// cannot be aimed at a URL, and throttling the whole dev server would stall the
// ES-module graph for minutes. --mode net applies the plain network profile
// instead, for comparison; it only bites if the sequence has not finished
// downloading yet (the loader never evicts).
//
//   node scripts/verify/starve.mjs
//   node scripts/verify/starve.mjs --delay 700 --only throttled
//   node scripts/verify/starve.mjs --url http://127.0.0.1:5184   (reuse a server)
import puppeteer from "puppeteer-core";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = Number(opt("port", "5184"));
const externalUrl = opt("url", null);
const url = externalUrl ?? `http://127.0.0.1:${PORT}`;
const only = opt("only", null);
const CHROME =
  process.env.CHROME ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Per-frame-request stall, ms. Foreground concurrency on a phone tier is 4 and
// background 2, so ~6/delay frames per second reach the decoder; 700 ms leaves
// roughly 8.5 f/s against the clip's 12.5 f/s — starved while the page moves,
// able to catch up within about a second once it stops. That is the shape of
// the reported bug, not an artificial freeze.
const FRAME_DELAY_MS = Number(opt("delay", "700"));
const MODE = opt("mode", "frames"); // frames | net
// Start sampling at ZONE ENTRY rather than at the flick, and print every row.
const VERBOSE = flag("verbose");
const NET_KBPS = Number(opt("kbps", "400"));
const NET_LATENCY_MS = Number(opt("latency", "300"));

// Mirrored from src/constants.ts (plain node cannot import the TS sources) —
// same constants the other scripts/verify probes copy.
const SCROLL_TRACK_VH = 1240;
const VIDEO_CARD_TRACK_VH = 140;
const VIDEO_START = 504 / SCROLL_TRACK_VH;
const FRAME_COUNT = 295;
const FRAME_SPAN = FRAME_COUNT - 1;
const NATIVE_FPS = 12.5;

// Where in the clip the flick is thrown from, and the flick itself.
const ENTRY_CLIP_T = Number(opt("t", "0.40"));
const FLICK_PX = Number(opt("flickpx", "400"));
const FLICK_MS = Number(opt("flickms", "220"));
const WATCH_MS = Number(opt("watchms", "5000"));
const SAMPLE_MS = 50;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : String(x));

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

const bounds = (innerHeight) => {
  const animY = ((SCROLL_TRACK_VH - 100) / 100) * innerHeight;
  const videoCardPx = (VIDEO_CARD_TRACK_VH / 100) * innerHeight;
  return { animY, startY: VIDEO_START * animY, endY: animY + videoCardPx };
};

// ── Dev server ──────────────────────────────────────────────────────────────
function listeners(port) {
  try {
    return execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf8",
    })
      .split("\n")
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

// ── Touch driver (same shape as scripts/verify/sync.mjs) ────────────────────
function touchDriver(cdp, viewport) {
  const x = Math.round(viewport.width / 2);
  const top = Math.round(viewport.height * 0.15);
  const bottom = Math.round(viewport.height * 0.85);
  const send = (type, points) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });

  async function swipe(direction, steps = 44, stepMs = 8) {
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
    // POSITIONING, never a throw: the finger rests before it lifts, so no
    // synthetic fling is queued and the page stops where it was put.
    async nudge() {
      const from = Math.round(viewport.height * 0.6);
      await send("touchStart", [{ x, y: from }]);
      for (let i = 1; i <= 4; i += 1) {
        await send("touchMove", [{ x, y: from - i * 40 }]);
        await sleep(8);
      }
      await sleep(200);
      await send("touchEnd", []);
    },
    // ONE flick: `px` of travel in `ms`, released while still moving.
    async flick(px, ms, steps = 11) {
      const from = Math.round(viewport.height * 0.85);
      const stepMs = Math.max(Math.round(ms / steps), 1);
      await send("touchStart", [{ x, y: from }]);
      const startedAt = Date.now();
      const inFlight = [];
      for (let i = 1; i <= steps; i += 1) {
        inFlight.push(
          send("touchMove", [
            { x, y: Math.round(from - (px * i) / steps) },
          ]).catch(() => {}),
        );
        if (inFlight.length >= 16) await Promise.all(inFlight.splice(0));
        await sleep(stepMs);
      }
      await Promise.all(inFlight);
      await send("touchEnd", []);
      return { px, ms: Date.now() - startedAt };
    },
  };
}

// ── Sampler ─────────────────────────────────────────────────────────────────
const INSTALL_SAMPLER = (everyMs) => {
  window.__starveSamples = [];
  if (window.__starveRaf) cancelAnimationFrame(window.__starveRaf);
  let last = -1e9;
  const tick = (now) => {
    window.__starveRaf = requestAnimationFrame(tick);
    if (now - last < everyMs) return;
    last = now;
    const fp = window.__fp;
    const sg = window.__sg;
    if (!fp || !sg) return;
    window.__starveSamples.push({
      ms: now,
      target: fp.target,
      displayed: fp.displayed,
      idx: fp.idx,
      textureFrame: fp.textureFrame,
      resolved: fp.resolved,
      imgNull: Boolean(fp.imgNull),
      loaded: fp.loadedCount,
      inFlight: fp.inFlight,
      clipT: sg.clipT,
      virtualY: sg.virtualY,
      bankPx: sg.bankPx,
      capActive: sg.capActive,
      scrollY: window.scrollY,
    });
  };
  window.__starveRaf = requestAnimationFrame(tick);
};

// ── Analysis ────────────────────────────────────────────────────────────────
function analyse(samples) {
  const usable = samples.filter(
    (s) => Number.isFinite(s.textureFrame) && s.textureFrame >= 0,
  );
  let maxLead = Number.NEGATIVE_INFINITY;
  let maxLeadAt = null;
  let maxChaseLead = Number.NEGATIVE_INFINITY;
  for (const s of usable) {
    const lead = s.target - s.textureFrame;
    if (lead > maxLead) {
      maxLead = lead;
      maxLeadAt = s;
    }
    const chase = s.displayed - s.textureFrame;
    if (chase > maxChaseLead) maxChaseLead = chase;
  }

  // Longest run of samples with textureFrame frozen WHILE the scroll target
  // moved. A frozen picture on a stopped page is not a hold, it is a rest.
  let longestHoldMs = 0;
  let holdAt = null;
  let runStart = null;
  for (let i = 1; i < usable.length; i += 1) {
    const a = usable[i - 1];
    const b = usable[i];
    if (b.textureFrame === a.textureFrame) {
      if (runStart === null) runStart = a;
      const moved = Math.abs(b.target - runStart.target) >= 1;
      if (moved) {
        const ms = b.ms - runStart.ms;
        if (ms > longestHoldMs) {
          longestHoldMs = ms;
          holdAt = { from: runStart, to: b };
        }
      }
    } else {
      runStart = null;
    }
  }

  // Biggest single-sample change of the bound image.
  let maxStep = 0;
  let stepAt = null;
  for (let i = 1; i < usable.length; i += 1) {
    const step = Math.abs(usable[i].textureFrame - usable[i - 1].textureFrame);
    if (step > maxStep) {
      maxStep = step;
      stepAt = { from: usable[i - 1], to: usable[i] };
    }
  }

  const holds = samples.filter((s) => s.imgNull).length;
  const first = samples[0] ?? null;
  const last = samples[samples.length - 1] ?? null;
  return {
    n: samples.length,
    usable: usable.length,
    holds,
    maxLead,
    maxLeadAt,
    maxChaseLead,
    longestHoldMs,
    holdAt,
    maxStep,
    stepAt,
    first,
    last,
    movedFrames:
      first && last ? Math.abs(last.clipT - first.clipT) * FRAME_SPAN : 0,
  };
}

function report(label, a, extra) {
  console.log(`\n== ${label} ==`);
  console.log(
    `  ${extra}\n` +
      `  samples ${a.n} (bound ${a.usable}, holds where get() returned null ${a.holds})`,
  );
  console.log(
    `  page travelled ${fmt(a.movedFrames, 1)} frames ` +
      `(clipT ${fmt(a.first?.clipT, 4)} → ${fmt(a.last?.clipT, 4)}), ` +
      `loaded ${a.first?.loaded} → ${a.last?.loaded}/295`,
  );
  console.log(
    `  MAX LEAD  target − textureFrame = ${fmt(a.maxLead, 0)} frames` +
      (a.maxLeadAt
        ? ` @ target=${a.maxLeadAt.target} displayed=${fmt(a.maxLeadAt.displayed, 1)} ` +
          `texture=${a.maxLeadAt.textureFrame} loaded=${a.maxLeadAt.loaded}`
        : ""),
  );
  console.log(
    `  MAX LEAD  displayed − textureFrame = ${fmt(a.maxChaseLead, 1)} frames ` +
      `(the chase's own view of the picture)`,
  );
  console.log(
    `  LONGEST HOLD (texture frozen while target moved) = ${fmt(a.longestHoldMs, 0)} ms` +
      (a.holdAt
        ? ` @ texture=${a.holdAt.from.textureFrame}, target ${a.holdAt.from.target} → ${a.holdAt.to.target}`
        : ""),
  );
  console.log(
    `  MAX STEP of textureFrame between two samples = ${a.maxStep} frames` +
      (a.stepAt
        ? ` (${a.stepAt.from.textureFrame} → ${a.stepAt.to.textureFrame} in ` +
          `${fmt(a.stepAt.to.ms - a.stepAt.from.ms, 0)} ms, target ${a.stepAt.to.target})`
        : ""),
  );
}

// ── One run ─────────────────────────────────────────────────────────────────
async function run(browser, { throttled, label }) {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log(`  PAGEERROR ${e.message}`));
  await page.emulate(IPHONE);
  const cdp = await page.createCDPSession();
  await cdp.send("Network.enable");

  let delayed = 0;
  if (throttled && MODE === "frames") {
    // Starve ONLY the frame sequence, from the very first request: the app's
    // own module graph still loads at full speed, so this is frame starvation
    // and not a slow boot.
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Fetch.enable", {
      patterns: [{ urlPattern: "*/frames/*", requestStage: "Request" }],
    });
    cdp.on("Fetch.requestPaused", (event) => {
      delayed += 1;
      setTimeout(() => {
        cdp
          .send("Fetch.continueRequest", { requestId: event.requestId })
          .catch(() => {});
      }, FRAME_DELAY_MS);
    });
  }

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => !document.body.classList.contains("scroll-locked"),
    { timeout: 120000 },
  );
  await page.waitForFunction(() => Boolean(window.__fp && window.__sg), {
    timeout: 30000,
  });

  if (throttled && MODE === "net") {
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: NET_LATENCY_MS,
      downloadThroughput: (NET_KBPS * 1000) / 8,
      uploadThroughput: (NET_KBPS * 1000) / 8,
    });
  }

  const innerHeight = await page.evaluate(() => window.innerHeight);
  const zone = bounds(innerHeight);
  const driver = touchDriver(cdp, IPHONE.viewport);

  // Approach: ordinary native scrolling up to just before the zone.
  for (let i = 0; i < 200; i += 1) {
    const y = await page.evaluate(() => window.scrollY);
    if (y >= zone.startY - 800) break;
    await driver.pulse(400);
  }
  await sleep(1500);
  // Arm the soft pin.
  for (let i = 0; i < 200; i += 1) {
    if (await page.evaluate(() => window.__sg.capActive)) break;
    await driver.pulse(400);
    await sleep(40);
  }
  const armed = await page.evaluate(() => window.__sg.capActive);
  if (!armed) {
    await page.close();
    throw new Error(`${label}: the video zone never took ownership`);
  }

  // Ride to mid-zone with nudges (positioning, not throws), then let the bank
  // drain so the flick starts from rest.
  if (VERBOSE) await page.evaluate(INSTALL_SAMPLER, SAMPLE_MS);
  for (let i = 0; i < 400; i += 1) {
    if ((await page.evaluate(() => window.__sg.clipT)) >= ENTRY_CLIP_T) break;
    await driver.nudge();
    await sleep(60);
  }
  for (let i = 0; i < 120; i += 1) {
    const bank = await page.evaluate(() =>
      window.__sg.capActive ? window.__sg.bankPx : 0,
    );
    if (Math.abs(bank) < 0.01) break;
    await sleep(100);
  }
  await sleep(600);

  const before = await page.evaluate(() => ({
    clipT: window.__sg.clipT,
    loaded: window.__fp.loadedCount,
    texture: window.__fp.textureFrame,
    target: window.__fp.target,
    capActive: window.__sg.capActive,
  }));

  if (!VERBOSE) await page.evaluate(INSTALL_SAMPLER, SAMPLE_MS);
  const flickAtMs = await page.evaluate(() => performance.now());
  const flick = await driver.flick(FLICK_PX, FLICK_MS);
  await sleep(WATCH_MS);
  const samples = await page.evaluate(() => window.__starveSamples.slice());
  await page.evaluate(() => {
    if (window.__starveRaf) cancelAnimationFrame(window.__starveRaf);
  });
  await page.close();

  return {
    samples,
    before,
    flick,
    flickAtMs,
    delayed,
    label,
  };
}

// ── Main ────────────────────────────────────────────────────────────────────
let server = null;
let browser = null;
try {
  server = await startDevServer();
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      "--enable-unsafe-swiftshader",
      "--use-angle=swiftshader-webgl",
      "--window-size=390,844",
    ],
    defaultViewport: null,
  });

  console.log(
    `starve.mjs — ${IPHONE.name}, flick ${FLICK_PX} px / ${FLICK_MS} ms at ` +
      `clipT ≈ ${ENTRY_CLIP_T}, sampling every ${SAMPLE_MS} ms for ${WATCH_MS} ms\n` +
      `mode=${MODE}` +
      (MODE === "frames"
        ? ` (each /frames/ request stalled ${FRAME_DELAY_MS} ms)`
        : ` (${NET_KBPS} kbit/s, ${NET_LATENCY_MS} ms latency, applied after boot)`) +
      `, clip cap ${NATIVE_FPS} f/s`,
  );

  const runs = [];
  // Throttled FIRST, on a cold cache; the control then runs warm, which is
  // exactly the healthy case it is meant to represent.
  if (!only || only === "throttled") {
    runs.push(await run(browser, { throttled: true, label: "THROTTLED" }));
  }
  if (!only || only === "control") {
    runs.push(await run(browser, { throttled: false, label: "CONTROL (no throttle)" }));
  }

  for (const r of runs) {
    const a = analyse(r.samples);
    report(
      r.label,
      a,
      `flick ${r.flick.px} px in ${r.flick.ms} ms from clipT ${fmt(r.before.clipT, 4)} ` +
        `(loaded ${r.before.loaded}/295 at the throw` +
        (r.delayed ? `, ${r.delayed} frame requests stalled` : "") +
        `)`,
    );
    if (VERBOSE) {
      console.log("  every sample (| = the flick):");
      for (const s of r.samples) {
        console.log(
          `    ${s.ms < r.flickAtMs ? " " : "|"} t=${fmt(s.ms, 0)} ` +
            `target=${s.target} displayed=${fmt(s.displayed, 1)} ` +
            `texture=${s.textureFrame} lead=${s.target - s.textureFrame} ` +
            `cap=${s.capActive ? 1 : 0} bank=${fmt(s.bankPx, 1)} ` +
            `vy=${fmt(s.virtualY, 0)} sy=${fmt(s.scrollY, 0)} ` +
            `loaded=${s.loaded} inFlight=${s.inFlight}`,
        );
      }
    }
    // The tail: what the picture did over the last second of the window.
    const tail = r.samples.slice(-12);
    console.log("  tail (last ~600 ms):");
    for (const s of tail) {
      console.log(
        `    t=${fmt(s.ms, 0)} target=${s.target} displayed=${fmt(s.displayed, 1)} ` +
          `texture=${s.textureFrame} lead=${s.target - s.textureFrame} ` +
          `bank=${fmt(s.bankPx, 1)} loaded=${s.loaded} inFlight=${s.inFlight}`,
      );
    }
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  stopDevServer(server);
}
