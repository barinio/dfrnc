// Measure the PAINTED scrub rate in a real browser: jump the scroll instantly
// from the video start to the video end, then sample window.__fp every 100 ms.
// Reports max frames advanced per wall second and whether the chase kept going
// after the scroll stopped.
import puppeteer from "puppeteer-core";

const opt = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const CHROME =
  process.env.CHROME ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const url = opt("url", "http://localhost:5178");
const track = Number(opt("track", "1240"));
const videoStart = 504 / track;
const seconds = Number(opt("seconds", "6"));
const [w, h] = opt("viewport", "1280x800").split("x").map(Number);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader-webgl",
    `--window-size=${w},${h}`,
  ],
  defaultViewport: { width: w, height: h, deviceScaleFactor: 1 },
});
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => !document.body.classList.contains("scroll-locked"),
    { timeout: 60000 },
  );
  await page.waitForFunction(() => Boolean(window.__fp), { timeout: 30000 });

  const result = await page.evaluate(
    async ({ track, videoStart, seconds }) => {
      const ih = window.innerHeight;
      const animMax = ((track - 100) / 100) * ih;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      // Park at the video start and let the chase settle there.
      window.scrollTo(0, videoStart * animMax);
      await sleep(600);
      const before = { ...window.__fp, t0: performance.now() };
      // One instantaneous teleport to the end of the main track (clip end).
      window.scrollTo(0, animMax);
      const t0 = performance.now();
      const samples = [];
      while (performance.now() - t0 < seconds * 1000) {
        await sleep(100);
        const f = window.__fp;
        samples.push({
          ms: performance.now() - t0,
          displayed: f.displayed,
          idx: f.idx,
          target: f.target,
          resolved: f.resolved,
          loaded: f.loadedCount,
          sp: f.sp,
        });
      }
      // Keep watching after the scroll has long stopped.
      const tailStart = performance.now();
      const tail = [];
      while (performance.now() - tailStart < 3000) {
        await sleep(200);
        const f = window.__fp;
        tail.push({ ms: performance.now() - t0, displayed: f.displayed });
      }
      return { before, samples, tail, animMax, ih };
    },
    { track, videoStart, seconds },
  );

  const { before, samples, tail } = result;
  console.log(
    `parked: displayed=${before.displayed} target=${before.target} sp=${before.sp}`,
  );
  console.log(
    `teleport target: ${samples[0]?.target} (frames to walk ≈ ${
      (samples[0]?.target ?? 0) - before.displayed
    })`,
  );

  let maxRate = 0;
  let maxAt = null;
  for (let j = 1; j < samples.length; j++) {
    for (let i = 0; i < j; i++) {
      const span = (samples[j].ms - samples[i].ms) / 1000;
      if (span < 0.9) continue;
      const rate = (samples[j].displayed - samples[i].displayed) / span;
      if (rate > maxRate) {
        maxRate = rate;
        maxAt = [samples[i], samples[j], span];
      }
    }
  }
  const first = samples[0];
  const last = samples[samples.length - 1];
  const overall =
    (last.displayed - first.displayed) / ((last.ms - first.ms) / 1000);
  console.log(
    `samples=${samples.length} displayed ${first.displayed} → ${last.displayed} ` +
      `over ${((last.ms - first.ms) / 1000).toFixed(2)} s ⇒ ${overall.toFixed(3)} frames/s`,
  );
  console.log(
    `MAX 1s-window rate = ${maxRate.toFixed(3)} frames/wall-second` +
      (maxAt ? ` (span ${maxAt[2].toFixed(2)} s, ${maxAt[0].displayed} → ${maxAt[1].displayed})` : ""),
  );
  const tailFirst = tail[0];
  const tailLast = tail[tail.length - 1];
  console.log(
    `after the scroll stopped: displayed ${tailFirst.displayed} → ${tailLast.displayed} ` +
      `over ${((tailLast.ms - tailFirst.ms) / 1000).toFixed(2)} s ` +
      `(still chasing: ${tailLast.displayed > tailFirst.displayed})`,
  );
  console.log(
    `final: displayed=${last.displayed} target=${last.target} resolved=${last.resolved} loaded=${last.loaded}/295`,
  );
  console.log(maxRate <= 13.5 ? "PASS — never outran the native 12.5 f/s" : "FAIL — outran the clip");
} finally {
  await browser.close();
}
