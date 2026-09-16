// A PICTURE of what one flick does, because "it scrolls by itself for 2-4 s"
// is a complaint about a feeling and the only honest answer is a filmstrip.
//
// Drives a real headless Chrome at 390x844 with trusted touch input only (CDP
// Input.dispatchTouchEvent — never window.scrollTo), performs ONE 400 px /
// ~250 ms flick from the middle of the video zone, then shoots the page every
// 150 ms for 2.4 s and composes the 16 shots into a 4x4 contact sheet. Each
// tile is labelled with the ms since touchend, the document scrollY and the
// frame VideoPlane actually painted (window.__fp), so the sheet shows both that
// the page stops and that the clip never outran it.
//
//   node scripts/verify/flicksheet.mjs
//   node scripts/verify/flicksheet.mjs --url http://127.0.0.1:5183
//   node scripts/verify/flicksheet.mjs --out /some/dir
//
// No new dependencies: the sheet is composed in a <canvas> inside the same
// headless Chrome (sharp is not in node_modules).
import puppeteer from "puppeteer-core";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
};

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = Number(opt("port", "5184"));
const externalUrl = opt("url", null);
const url = externalUrl ?? `http://127.0.0.1:${PORT}`;
const OUT_DIR = opt(
  "out",
  "/private/tmp/claude-501/-Users-ivan-Downloads-DFRNC/" +
    "7cede5ca-3e73-4bbf-8dff-28cd1be0f576/scratchpad",
);
const CHROME =
  process.env.CHROME ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const WIDTH = 390;
const HEIGHT = 844;
const TILES = 16;
const TILE_MS = 150;
const FLICK_PX = 400;
const START_CLIP_T = 0.4;

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

// ── The composer (runs inside the page, so no image library is needed) ──────
const COMPOSE = async ({ tiles, cols, tileW, tileH, labelH, title }) => {
  const rows = Math.ceil(tiles.length / cols);
  const canvas = document.createElement("canvas");
  canvas.width = cols * tileW;
  canvas.height = rows * (tileH + labelH) + labelH;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#101014";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#f4f4f6";
  ctx.font = "600 15px ui-monospace, Menlo, monospace";
  ctx.textBaseline = "middle";
  ctx.fillText(title, 8, labelH / 2);

  const load = (src) =>
    new Promise((done, fail) => {
      const image = new Image();
      image.onload = () => done(image);
      image.onerror = () => fail(new Error("tile decode failed"));
      image.src = src;
    });

  for (let i = 0; i < tiles.length; i += 1) {
    const image = await load(tiles[i].dataUrl);
    const x = (i % cols) * tileW;
    const y = labelH + Math.floor(i / cols) * (tileH + labelH);
    ctx.drawImage(image, x, y, tileW, tileH);
    ctx.strokeStyle = "#2c2c33";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, tileW - 1, tileH - 1);
    ctx.fillStyle = "#101014";
    ctx.fillRect(x, y + tileH, tileW, labelH);
    ctx.fillStyle = "#f4f4f6";
    ctx.font = "600 12px ui-monospace, Menlo, monospace";
    ctx.fillText(tiles[i].label, x + 6, y + tileH + labelH / 2);
  }
  return canvas.toDataURL("image/png");
};

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
      `--window-size=${WIDTH},${HEIGHT}`,
    ],
    defaultViewport: null,
  });

  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log(`  PAGEERROR ${e.message}`));
  await page.emulate({
    name: "iPhone 390x844",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
      "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    // deviceScaleFactor 1 on purpose: the sheet wants 16 legible tiles, not
    // 16 three-times-oversampled megabyte PNGs travelling over CDP.
    viewport: {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
      isLandscape: false,
    },
  });
  const cdp = await page.createCDPSession();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => !document.body.classList.contains("scroll-locked"),
    { timeout: 90000 },
  );
  await page.waitForFunction(() => Boolean(window.__fp && window.__sg), {
    timeout: 30000,
  });

  const x = Math.round(WIDTH / 2);
  const sendTouch = (type, points) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });

  // A gentle, non-throwing nudge: the finger rests on the glass before it
  // lifts, so the zone's idle guard queues no synthetic fling.
  async function nudge(px = 160) {
    const from = Math.round(HEIGHT * 0.8);
    await sendTouch("touchStart", [{ x, y: from }]);
    for (let i = 1; i <= 4; i += 1) {
      await sendTouch("touchMove", [{ x, y: Math.round(from - (px * i) / 4) }]);
      await sleep(16);
    }
    await sleep(220);
    await sendTouch("touchEnd", []);
  }

  // One controlled thumb FLICK, released while still moving. Pipelined: awaiting
  // each CDP ack would stretch a 250 ms flick over a second.
  async function flick(px, steps, stepMs) {
    const from = Math.round(HEIGHT * 0.9);
    await sendTouch("touchStart", [{ x, y: from }]);
    const startedAt = Date.now();
    const inFlight = [];
    for (let i = 1; i <= steps; i += 1) {
      inFlight.push(
        sendTouch("touchMove", [
          { x, y: Math.round(from - (px * i) / steps) },
        ]).catch(() => {}),
      );
      if (inFlight.length >= 16) await Promise.all(inFlight.splice(0));
      await sleep(stepMs);
    }
    await Promise.all(inFlight);
    await sendTouch("touchEnd", []);
    return { px, ms: Date.now() - startedAt };
  }

  const atRest = async (maxMs = 6000) => {
    const until = Date.now() + maxMs;
    while (Date.now() < until) {
      const bank = await page.evaluate(() =>
        window.__sg.capActive ? window.__sg.bankPx : 0,
      );
      if (Math.abs(bank) < 0.01) return true;
      await sleep(80);
    }
    return false;
  };

  // Ride into the zone and up to the flick's seat.
  for (let i = 0; i < 400; i += 1) {
    const state = await page.evaluate(() => ({
      t: window.__sg.clipT,
      cap: window.__sg.capActive,
    }));
    if (state.cap && state.t >= START_CLIP_T) break;
    await nudge(state.cap ? 160 : 600);
    if (state.cap) await atRest(2000);
  }
  await atRest();
  const seat = await page.evaluate(() => ({
    t: window.__sg.clipT,
    y: window.scrollY,
    cap: window.__sg.capActive,
    dials: window.__sg.dials,
  }));
  console.log(
    `seat: clip t ${fmt(seat.t, 3)}, scrollY ${fmt(seat.y, 0)}, ` +
      `capActive ${seat.cap}, dials ${JSON.stringify(seat.dials)}`,
  );

  // THE FLICK. 400 px in ~250 ms — the gesture the client described.
  const stroke = await flick(FLICK_PX, 10, 16);
  const flickEnd = await page.evaluate(() => ({
    now: performance.now(),
    scrollY: window.scrollY,
    frame: window.__fp ? window.__fp.displayed : null,
    t: window.__sg.clipT,
  }));
  console.log(
    `flick: ${stroke.px} px in ${stroke.ms} ms ` +
      `(${fmt(stroke.px / stroke.ms, 2)} px/ms), touchend at scrollY ` +
      `${fmt(flickEnd.scrollY, 0)} / frame ${fmt(flickEnd.frame, 1)}`,
  );

  // 16 shots, one every 150 ms.
  const shots = [];
  for (let i = 0; i < TILES; i += 1) {
    const target = flickEnd.now + i * TILE_MS;
    for (let guard = 0; guard < 200; guard += 1) {
      const now = await page.evaluate(() => performance.now());
      if (now >= target) break;
      await sleep(Math.min(Math.max(target - now, 1), 40));
    }
    const state = await page.evaluate(() => ({
      ms: performance.now(),
      scrollY: window.scrollY,
      virtualY: window.__sg.virtualY,
      bankPx: window.__sg.bankPx,
      clipT: window.__sg.clipT,
      frame: window.__fp ? window.__fp.displayed : null,
      painted: window.__fp ? window.__fp.idx : null,
    }));
    const { data } = await cdp.send("Page.captureScreenshot", {
      format: "jpeg",
      quality: 72,
    });
    shots.push({
      index: i,
      msSinceTouchend: Math.round(state.ms - flickEnd.now),
      scrollY: Math.round(state.scrollY * 10) / 10,
      virtualY: Math.round(state.virtualY * 10) / 10,
      bankPx: Math.round(state.bankPx * 10) / 10,
      clipT: Math.round(state.clipT * 10000) / 10000,
      frame: state.frame,
      painted: state.painted,
      dataUrl: `data:image/jpeg;base64,${data}`,
    });
  }

  // Compose in a blank page of the same browser: data: URLs never taint a
  // canvas, so toDataURL works without any native image library.
  const sheetPage = await browser.newPage();
  await sheetPage.setViewport({ width: 1000, height: 800, deviceScaleFactor: 1 });
  await sheetPage.goto("about:blank");
  const tileW = 240;
  const tileH = Math.round((HEIGHT / WIDTH) * tileW);
  const sheetDataUrl = await sheetPage.evaluate(COMPOSE, {
    tiles: shots.map((s) => ({
      dataUrl: s.dataUrl,
      label:
        `+${s.msSinceTouchend}ms  y${Math.round(s.scrollY)}  ` +
        `f${fmt(s.frame, 1)}`,
    })),
    cols: 4,
    tileW,
    tileH,
    labelH: 22,
    title:
      `one 400 px / ${stroke.ms} ms flick from clip t ${fmt(seat.t, 3)} — ` +
      `390x844 — ms since touchend / scrollY / painted frame`,
  });
  await sheetPage.close();

  mkdirSync(OUT_DIR, { recursive: true });
  const pngPath = join(OUT_DIR, "flicksheet.png");
  const jsonPath = join(OUT_DIR, "flicksheet.json");
  writeFileSync(
    pngPath,
    Buffer.from(sheetDataUrl.slice("data:image/png;base64,".length), "base64"),
  );
  const totalPx = shots[shots.length - 1].scrollY - flickEnd.scrollY;
  let stoppedAt = 0;
  for (let i = 1; i < shots.length; i += 1) {
    if (Math.abs(shots[i].scrollY - shots[i - 1].scrollY) > 0.5) {
      stoppedAt = shots[i].msSinceTouchend;
    }
  }
  writeFileSync(
    jsonPath,
    `${JSON.stringify(
      {
        url,
        viewport: { width: WIDTH, height: HEIGHT },
        seat,
        stroke,
        touchend: flickEnd,
        stoppedAfterMs: stoppedAt,
        movedPxAfterTouchend: Math.round(totalPx * 10) / 10,
        movedFramesAfterTouchend:
          shots[shots.length - 1].frame === null || flickEnd.frame === null
            ? null
            : Math.round((shots[shots.length - 1].frame - flickEnd.frame) * 100) / 100,
        tiles: shots.map(({ dataUrl, ...rest }) => rest),
      },
      null,
      2,
    )}\n`,
  );

  console.log(`\ncontact sheet: ${pngPath}`);
  console.log(`numbers:       ${jsonPath}`);
  console.log("  ms      scrollY   frame");
  for (const s of shots) {
    console.log(
      `  +${String(s.msSinceTouchend).padStart(4)}  ${String(s.scrollY).padStart(9)}  ${fmt(s.frame, 1)}`,
    );
  }
  console.log(
    `the page moved ${fmt(totalPx, 1)} px after touchend and last moved at ` +
      `+${stoppedAt} ms`,
  );
} finally {
  if (browser) await browser.close().catch(() => {});
  stopDevServer(server);
}
