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
// Mirrored from src/scrollGovernor.ts / src/scrollTimelineController.ts: how
// much playback one gesture may bank, and how long the zone absorbs a crossing.
// TWO ceilings since 2026-09-16, one per input source. A FINGER delivers one
// burst and nothing after (inside the zone its touchmoves are all cancelled, so
// the backlog IS the coast) — 1.2 s of clip. A TRACKPAD keeps being fed OS
// momentum wheel events for another 1-2 s after the hand lifts, so a long
// backlog underneath that tail is paid out at a user who stopped scrolling ages
// ago — 0.4 s. Each profile below is measured against its own ceiling.
const SCROLL_BANK_MAX_CLIP_S_TOUCH = 1.2;
const SCROLL_BANK_MAX_CLIP_S_WHEEL = 0.4;
const WHEEL_ENTRY_GRACE_MS = 250;
// UNIFORM since 2026-09-16: two knots, one linear ramp over the anim track.
// The five caption-dwell knots are gone — under the 12.5 f/s cap the captions
// could not be fast-forwarded anyway, and their 9x slope contrast was what made
// one flick worth 5.7 s of clip in one place and 0.6 s in another.
const VIDEO_TIME_KNOTS = [
  [VIDEO_START, 0],
  [1, VIDEO_SPLIT],
];
// Mirrored from src/scrollTimelineController.ts: what a finger release buys.
const TOUCH_FLING_TAU_MS = 300;
// Mirrored from src/scrollGovernor.ts: the coast's ease-out, now SHIPPED OFF.
// A 0.3 s window stretched the last 0.3 s of clip over ~0.87 s of wall time,
// which read as the page creeping on after the gesture ended, so the window is
// 0: constant capped speed, then a stop. The formula stays because ?ease= can
// still switch the ramp back on — with the window at 0 it contributes nothing.
const BANK_EASE_OUT_CLIP_S = 0;
const BANK_EASE_OUT_FLOOR = 0.15;
// ramp W→W·floor takes W·ln(1/floor); the floor phase then spends W·floor of
// clip at floor rate, i.e. exactly W of wall — so the whole excess is the ramp.
const EASE_TAIL_EXCESS_MS =
  BANK_EASE_OUT_CLIP_S * Math.log(1 / BANK_EASE_OUT_FLOOR) * 1000;

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

// Wall seconds it takes to play the clip interval [a, b] AT THE CAP. One rate
// everywhere now, so this is a straight conversion — plus the ease-out tail,
// which is 0 while the ease is off.
function wallSecondsForClipSpan(a, b) {
  return (Math.abs(b - a) * FRAME_SPAN) / NATIVE_FPS + EASE_TAIL_EXCESS_MS / 1000;
}

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
    // well under one event per animation frame, so an un-pipelined probe
    // measures its own round-trip latency instead of the cap. A real trackpad
    // delivers 60-120 events per second during a flick.
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
    // A small, fine-grained step, for positioning the page without flinging it.
    async nudge() {
      await send(200);
    },
    // A BURST: ten notches inside ~100 ms and then silence. This is the gesture
    // the client complained about — under the old drop-the-excess rule 98.5 px
    // of every 100 px notch evaporated, so the zone demanded ~150 of these.
    // PIPELINED like drive(): awaiting each CDP ack would stretch ten notches
    // over a second, and the page would spend most of the bank while the
    // "burst" was still being typed.
    async burst(deltaY = 120, count = 10, gapMs = 10) {
      const inFlight = [];
      for (let i = 0; i < count; i += 1) {
        inFlight.push(send(deltaY).catch(() => {}));
        await sleep(gapMs);
      }
      await Promise.all(inFlight);
      return deltaY * count;
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
    // POSITIONING, never a throw: the finger rests on the glass before it
    // lifts, so the zone's idle guard queues no synthetic fling and this stays
    // the fine-grained step it has always been.
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
    // Exactly `px` of finger travel, slowly, with a rest before the lift: the
    // page must move that far and not one pixel further.
    async creep(px = 120, steps = 6, stepMs = 50) {
      const from = Math.round(viewport.height * 0.8);
      await send("touchStart", [{ x, y: from }]);
      for (let i = 1; i <= steps; i += 1) {
        await send("touchMove", [
          { x, y: Math.round(from - (px * i) / steps) },
        ]);
        await sleep(stepMs);
      }
      await sleep(200);
      await send("touchEnd", []);
      return px;
    },
    // One controlled thumb FLICK: `px` of travel in `steps` samples `stepMs`
    // apart, released while still moving. Pipelined like swipe() — awaiting
    // each CDP ack would stretch a 250 ms flick over a second and measure the
    // probe's own round-trip instead of the gesture.
    async flick(px = 500, steps = 10, stepMs = 8) {
      const from = Math.round(viewport.height * 0.85);
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
    // One thumb flick, finger up, then silence: ~0.3 s of swipe used to buy
    // ~20 px of page.
    async burst() {
      await swipe(1, 12, 6);
      return Math.abs(bottom - top);
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
      // The painter's OWN unrounded target-minus-displayed, from the same
      // animation frame as `displayed`: fp.target is rounded to an integer, so
      // re-deriving the lag from it adds up to half a frame of pure noise.
      lag: fp.lag,
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
// `rateOnly` keeps the CLIP-RATE assertions — the client's actual contract —
// and demotes the picture-coherence ones to printed figures. It exists for the
// short BURST phase only: __sg and __fp are written by different animation-frame
// callbacks, so a sample can pair a governor position with a painter snapshot
// one or two frames older, which inflates a published-vs-painted gap by the page
// speed times that skew (~1.4 frames at the cap under SwiftShader). Over the
// tens of seconds of the flick phases that averages out and every assertion
// below is enforced; over a 6 s burst one skewed sample would decide the run.
function analyse(samples, label, { rateOnly = false } = {}) {
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
    maxLag = Math.max(
      maxLag,
      Math.abs(Number.isFinite(s.lag) ? s.lag : s.target - s.displayed),
    );
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

  if (!rateOnly) {
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

  // ── BURST THEN SILENCE: a flick BUYS playback ─────────────────────────────
  // The client's complaint in one phase. Input used to be dropped every tick,
  // so the page only moved while the user kept cranking (~150 notches for the
  // 23.5 s zone). One burst must now keep the page running ON ITS OWN — at the
  // very same 12.5 f/s — and one reverse event must still be felt immediately.
  //
  // FOR HOW LONG depends on the device. This profile's burst is a trackpad
  // burst on desktop (ceiling 0.4 s of clip ≈ 5 frames, so the page carries
  // roughly 0.4 s) and a thumb swipe on the phone (1.2 s ≈ 15 frames, ≈1.2 s).
  const bankCeilingClipS = profile.emulate
    ? SCROLL_BANK_MAX_CLIP_S_TOUCH
    : SCROLL_BANK_MAX_CLIP_S_WHEEL;
  // How long the page must still be moving after the input stops for the burst
  // to count as BANKED rather than dropped. Scaled to the ceiling that applies:
  // half of it, floored well above the 50 ms sampler grid.
  const bankCarryMinMs = Math.max(bankCeilingClipS * 1000 * 0.5, 200);
  const rearm = async () => {
    for (let i = 0; i < 200; i += 1) {
      if (await page.evaluate(() => window.__sg.capActive)) return true;
      await driver.pulse(400);
      await sleep(40);
    }
    return page.evaluate(() => window.__sg.capActive);
  };

  // How far past `from` the page kept moving, and when it last moved.
  const motionTail = (samples, fromMs) => {
    let lastMoveMs = fromMs;
    let movedFrames = 0;
    let movedPx = 0;
    let base = null;
    for (let i = 1; i < samples.length; i += 1) {
      if (samples[i].ms < fromMs) continue;
      if (base === null) base = samples[i - 1];
      const dy = Math.abs(samples[i].virtualY - samples[i - 1].virtualY);
      if (dy > 0.25) lastMoveMs = samples[i].ms;
    }
    const last = samples[samples.length - 1];
    if (base) {
      movedFrames = Math.abs(last.clipT - base.clipT) * FRAME_SPAN;
      movedPx = Math.abs(last.virtualY - base.virtualY);
    }
    return {
      coastMs: lastMoveMs - fromMs,
      movedFrames,
      movedPx,
      fromT: base ? base.clipT : null,
      toT: last ? last.clipT : null,
    };
  };

  const waitForRest = async (maxMs = 9000) => {
    const until = Date.now() + maxMs;
    while (Date.now() < until) {
      const bank = await page.evaluate(() =>
        window.__sg.capActive ? window.__sg.bankPx : 0,
      );
      if (Math.abs(bank) < 0.01) return true;
      await sleep(100);
    }
    return false;
  };

  if (!(await rearm())) {
    failures.push(`${profile.name} (bank): the zone never re-took ownership`);
  }
  await sleep(WHEEL_ENTRY_GRACE_MS + 250);
  // Ride into the middle of the zone. Every part of it runs at the same
  // ~289 px/s now, so one place is as good as another — this one just leaves
  // room on both sides for the coast and the reversal probe below.
  for (let i = 0; i < 300; i += 1) {
    if ((await page.evaluate(() => window.__sg.clipT)) >= 0.26) break;
    await driver.nudge();
    await sleep(80);
  }
  if (!(await waitForRest())) {
    failures.push(`${profile.name} (bank): the approach never came to rest`);
  }
  const burstAt = await page.evaluate(() => ({
    t: window.__sg.clipT,
    y: window.scrollY,
  }));
  await page.evaluate(INSTALL_SAMPLER);
  const askedPx = await driver.burst();
  const burstEndMs = await page.evaluate(() => performance.now());
  await sleep(4500); // pure silence, still sampling
  const burstSamples = await page.evaluate(() => window.__syncSamples.slice());
  const burst = analyse(burstSamples, `${profile.name} burst`, { rateOnly: true });
  failures.push(...burst.failures);
  const tail = motionTail(burstSamples, burstEndMs);
  if (!(tail.coastMs >= bankCarryMinMs)) {
    failures.push(
      `${profile.name} (bank i): the page stopped ${fmt(tail.coastMs / 1000)} s ` +
        `after the input did — a flick must still carry (want >= ` +
        `${fmt(bankCarryMinMs / 1000)} s for a ${bankCeilingClipS} s ceiling)`,
    );
  }
  // The ceiling is in CLIP seconds, so it is checked in FRAMES; the wall-clock
  // bound is that same clip span played at the cap plus the ease-out tail
  // (which is 0 now that the ease is off).
  const BANK_CEILING_FRAMES = bankCeilingClipS * NATIVE_FPS;
  if (!(tail.movedFrames <= BANK_CEILING_FRAMES + 2)) {
    failures.push(
      `${profile.name} (bank ii): one burst bought ${fmt(tail.movedFrames, 1)} ` +
        `frames, past the ${BANK_CEILING_FRAMES}-frame ` +
        `(${bankCeilingClipS} s of clip) ceiling`,
    );
  }
  const coastCeilingMs =
    tail.fromT === null || tail.toT === null
      ? 2600
      : wallSecondsForClipSpan(tail.fromT, tail.toT) * 1000 + 600;
  if (!(tail.coastMs <= coastCeilingMs)) {
    failures.push(
      `${profile.name} (bank ii): the page coasted ${fmt(tail.coastMs / 1000)} s ` +
        `for ${fmt(tail.movedFrames, 1)} frames of clip (cap ` +
        `${fmt(coastCeilingMs / 1000)} s at the rate those frames run)`,
    );
  }
  const bankLeft = await page.evaluate(() => window.__sg.bankPx);
  if (Math.abs(bankLeft) > 0.01) {
    failures.push(`${profile.name} (bank): ${fmt(bankLeft, 3)} px still owed at rest`);
  }
  console.log(
    `  burst then silence (from a scenic stretch: clip t ${fmt(burstAt.t, 3)}, ` +
      `scrollY ${fmt(burstAt.y, 0)}):\n    ${fmt(askedPx, 0)} px asked in one burst → the page ` +
      `ran ${fmt(tail.coastMs / 1000)} s / ${fmt(tail.movedFrames, 1)} frames / ` +
      `${fmt(tail.movedPx, 0)} px on its own, then stopped (bank ${fmt(bankLeft, 3)} px; ` +
      `${profile.emulate ? "finger" : "trackpad"} ceiling ${bankCeilingClipS} s of ` +
      `clip = ${BANK_CEILING_FRAMES} frames = ${fmt(coastCeilingMs / 1000)} s here)`,
  );
  report("burst", burst);
  console.log(
    "          (ii)/(iii) above are printed for the record here — the flick " +
      "phases assert them over tens of seconds, where the sampler's frame-age " +
      "skew averages out",
  );

  // (iv) one reverse event, sent while a forward bank is still paying out,
  // lowers the document WITHIN TWO ANIMATION FRAMES — the backlog is discarded,
  // not netted off against. Counting FRAMES (not milliseconds) is the only
  // honest measurement here: a CDP round-trip and a page.evaluate are each tens
  // of milliseconds, and SwiftShader frames swing between 10 and 80 ms, so the
  // page itself times the gap between the event landing and scrollY falling.
  await waitForRest();
  await driver.burst();
  await sleep(700); // still coasting on the bank, and the queue has drained
  await page.evaluate((isTouch) => {
    window.__rev = { armed: performance.now(), at: null, frames: null, y0: null, dy: null };
    const start = () => {
      if (window.__rev.at !== null) return;
      window.__rev.at = performance.now();
      window.__rev.y0 = window.scrollY;
      let frames = 0;
      const watch = () => {
        frames += 1;
        const dy = window.scrollY - window.__rev.y0;
        if (dy < -0.05 || frames > 240) {
          window.__rev.frames = frames;
          window.__rev.dy = dy;
          return;
        }
        requestAnimationFrame(watch);
      };
      requestAnimationFrame(watch);
    };
    if (isTouch) window.addEventListener("touchmove", start, { passive: true });
    else
      window.addEventListener(
        "wheel",
        (e) => {
          if (e.deltaY < 0) start();
        },
        { passive: true },
      );
  }, Boolean(profile.emulate));
  await driver.reverseOnce();
  for (let i = 0; i < 100; i += 1) {
    if (await page.evaluate(() => window.__rev.frames !== null)) break;
    await sleep(50);
  }
  const rev = await page.evaluate(() => window.__rev);
  if (!(rev.frames !== null && rev.dy < 0 && rev.frames <= 2)) {
    failures.push(
      `${profile.name} (bank iv): a reverse event during a bank lowered scrollY ` +
        `by ${fmt(rev.dy, 2)} px only after ${rev.frames} frames`,
    );
  }
  console.log(
    `    (iv)  reverse during a bank: scrollY fell ${fmt(rev.dy, 2)} px ` +
      `${rev.frames} frame(s) after the event landed ` +
      `(${rev.frames !== null && rev.dy < 0 && rev.frames <= 2 ? "PASS" : "FAIL"})`,
  );
  // ── SINGLE FLICK (touch only) ─────────────────────────────────────────────
  // The phone complaint in one phase. Inside the zone every touchmove is
  // cancelled, so the browser's own fling never runs — the zone synthesizes it
  // (v × 300 ms) and banks it. One flick must move the page A BIT and STOP:
  // it may never outrun the clip, it must keep going for a beat after the
  // finger leaves (a flick that dies on touchend reads as a hang), and it must
  // be over in about 1.2 s — the finger's whole ceiling at the cap, with no
  // ease-out tail behind it (the client's "it scrolls by itself for 2-4 s").
  // The old caption dwells are gone, so the middle of the zone is the only
  // place worth measuring: it is the same slope everywhere now.
  if (profile.emulate) {
    const clipNow = () => page.evaluate(() => window.__sg.clipT);
    for (let i = 0; i < 120; i += 1) {
      if ((await clipNow()) >= 0.45) break;
      await driver.nudge();
      await waitForRest();
    }
    // The CDP touch pipeline is only as fast as the machine: under load a
    // ten-sample stroke can stretch from ~200 ms to over a second, which is no
    // longer a flick at all and would measure the probe rather than the page.
    // So the stroke is RETRIED until the velocity it actually delivered is a
    // real throw, and the probe says so if it never managed one.
    const FLICK_PROBE_PX_MS = 0.8; // comfortably above the product's 0.5
    let flickFrom = 0;
    let stroke = null;
    let delivered = 0;
    let flickEndMs = 0;
    let flickSamples = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await waitForRest();
      flickFrom = await clipNow();
      if (!(flickFrom > 0.35 && flickFrom < 0.75)) break;
      await page.evaluate(INSTALL_SAMPLER);
      stroke = await driver.flick(400, 10, 8);
      flickEndMs = await page.evaluate(() => performance.now());
      delivered = stroke.px / stroke.ms;
      if (delivered >= FLICK_PROBE_PX_MS) break;
    }
    if (!(flickFrom > 0.35 && flickFrom < 0.75)) {
      failures.push(
        `${profile.name} (flick): could not seat the flick mid-zone ` +
          `(clip t ${fmt(flickFrom, 3)})`,
      );
    }
    if (!(delivered >= FLICK_PROBE_PX_MS)) {
      failures.push(
        `${profile.name} (flick): the probe never delivered a flick — the ` +
          `fastest stroke was ${fmt(delivered, 2)} px/ms (need ` +
          `${FLICK_PROBE_PX_MS}); this measures the CDP pipeline, not the page`,
      );
    }
    await sleep(4500); // silence, still sampling — the coast must end inside it
    flickSamples = await page.evaluate(() => window.__syncSamples.slice());
    const flickTail = motionTail(flickSamples, flickEndMs);
    // (a) it keeps going after the finger leaves…
    if (!(flickTail.coastMs >= 600)) {
      failures.push(
        `${profile.name} (flick i): the page stopped ${fmt(flickTail.coastMs / 1000)} s ` +
          `after touchend — a flick must still carry`,
      );
    }
    // (b) …and it STOPS. With the ease off there is no tail at all: the design
    // bound is the finger's whole 1.2 s of clip played at the cap, and nothing
    // after it. The allowance adds the 50 ms sampler grid and CDP's own
    // touchend latency.
    const FLICK_DESIGN_MS = SCROLL_BANK_MAX_CLIP_S_TOUCH * 1000;
    const FLICK_STOP_MS = 1400;
    if (!(flickTail.coastMs <= FLICK_STOP_MS)) {
      failures.push(
        `${profile.name} (flick ii): the page coasted ${fmt(flickTail.coastMs / 1000)} s ` +
          `after touchend (design ${fmt(FLICK_DESIGN_MS / 1000)} s, allowance ` +
          `${FLICK_STOP_MS / 1000} s)`,
      );
    }
    // (c) the hard client rule: no 1 s window of the coast may outrun the clip.
    let worstFlickRate = 0;
    let worstFlickSpan = 0;
    const from = flickSamples.findIndex((s) => s.ms >= flickEndMs);
    const coastSamples = from >= 0 ? flickSamples.slice(from) : [];
    for (let j = 1; j < coastSamples.length; j += 1) {
      for (let i = 0; i < j; i += 1) {
        const span = (coastSamples[j].ms - coastSamples[i].ms) / 1000;
        if (span < 1) continue;
        const rate =
          (Math.abs(coastSamples[j].clipT - coastSamples[i].clipT) * FRAME_SPAN) /
          span;
        if (rate > worstFlickRate) {
          worstFlickRate = rate;
          worstFlickSpan = span;
        }
      }
    }
    if (coastSamples.length < 20) {
      failures.push(
        `${profile.name} (flick iii): only ${coastSamples.length} samples of coast`,
      );
    }
    if (worstFlickRate > NATIVE_FPS + 0.4) {
      failures.push(
        `${profile.name} (flick iii): the coast ran ${fmt(worstFlickRate, 3)} ` +
          `frames/s over a ${fmt(worstFlickSpan)} s window (cap ${NATIVE_FPS})`,
      );
    }
    // (d) the ceiling, in the unit it is written in.
    if (!(flickTail.movedFrames <= SCROLL_BANK_MAX_CLIP_S_TOUCH * NATIVE_FPS + 3)) {
      failures.push(
        `${profile.name} (flick iv): one flick bought ${fmt(flickTail.movedFrames, 1)} ` +
          `frames, past the ${SCROLL_BANK_MAX_CLIP_S_TOUCH * NATIVE_FPS}-frame ` +
          `finger ceiling`,
      );
    }
    console.log(
      `  single flick (clip t ${fmt(flickFrom, 3)}, mid-zone):` +
        `\n    ${stroke ? stroke.px : 0} px of finger in ` +
        `${stroke ? stroke.ms : 0} ms (${fmt(delivered, 2)} px/ms) → the page ran ` +
        `${fmt(flickTail.coastMs / 1000)} s / ${fmt(flickTail.movedFrames, 1)} ` +
        `frames / ${fmt(flickTail.movedPx, 0)} px on its own, then stopped ` +
        `(fling budget ${TOUCH_FLING_TAU_MS} ms of release velocity, finger bank ` +
        `ceiling ${SCROLL_BANK_MAX_CLIP_S_TOUCH} s of clip = ` +
        `${SCROLL_BANK_MAX_CLIP_S_TOUCH * NATIVE_FPS} frames, ease off)` +
        `\n    max 1s-window clip rate during the coast: ` +
        `${fmt(worstFlickRate, 3)} f/s over ${coastSamples.length} samples ` +
        `(cap ${NATIVE_FPS})`,
    );

    // (e) a SLOW drag is "just a bit": it must move the finger's travel and
    // stop. No synthetic coast may be attached to it.
    await waitForRest();
    const dragBefore = await page.evaluate(() => window.scrollY);
    await driver.creep(120, 12, 50); // 120 px over 600 ms = 0.2 px/ms
    await waitForRest();
    await sleep(600);
    const dragAfter = await page.evaluate(() => window.scrollY);
    const dragMoved = dragAfter - dragBefore;
    if (!(dragMoved <= 125)) {
      failures.push(
        `${profile.name} (flick v): a 120 px drag moved the page ` +
          `${fmt(dragMoved, 1)} px — a light scroll must not carry on`,
      );
    }
    console.log(
      `    slow 120 px / 600 ms drag moved the page ${fmt(dragMoved, 1)} px ` +
        `(want <= 125)`,
    );
  }

  // Put the page back at the zone's front edge before the flick phases, so they
  // measure the same full-zone ride they always did instead of a shorter one
  // starting wherever the bursts left off.
  for (let i = 0; i < 200; i += 1) {
    const y = await page.evaluate(() => window.scrollY);
    if (y <= zone.startY + 20) break;
    await driver.drive(-2000, 300);
  }
  await sleep(2500); // let the last reverse bank drain

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
  // Uniform map: a full-demand ride IS the clip's runtime (23.52 s). Nothing
  // may make it shorter; the caption dwells used to make it ~35 s.
  if (forwardSeconds < FRAME_SPAN / NATIVE_FPS - 1) {
    failures.push(
      `${profile.name}: the forward ride crossed the zone in ${fmt(forwardSeconds)} s, ` +
        `faster than the clip's ${fmt(FRAME_SPAN / NATIVE_FPS)} s`,
    );
  }
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
