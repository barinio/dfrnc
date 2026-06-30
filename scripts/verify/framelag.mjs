// Reproduce/measure the frame-scrub "stuck range": throttle the network, scroll
// gradually through the reveal+morph, and sample window.__fp (the app-side
// {idx, resolved, loadedCount} exposed by VideoPlane in DEV). Reports the worst
// gap = idx − resolved (how many frames the displayed frame lags the scroll) and
// where it happened — i.e. whether the user outruns the download.
//   node scripts/verify/framelag.mjs --url http://localhost:5173 --mbps 6 --track 800 --viewport 390x844
import puppeteer from "puppeteer-core";
const opt = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const url = opt("url", "http://localhost:5173");
const mbps = Number(opt("mbps", "6"));
const track = Number(opt("track", "800"));
const [w, h] = opt("viewport", "390x844").split("x").map(Number);
const VCARD = 140, FLY = 0.4;

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader-webgl", `--window-size=${w},${h}`],
  defaultViewport: { width: w, height: h, deviceScaleFactor: 2 },
});
try {
  const page = await browser.newPage();
  const client = await page.target().createCDPSession();
  await client.send("Network.enable");
  await client.send("Network.emulateNetworkConditions", {
    offline: false, latency: 40,
    downloadThroughput: (mbps * 1024 * 1024) / 8,
    uploadThroughput: (mbps * 1024 * 1024) / 8,
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  // wait for the loader to release (scroll unlocked)
  await page.waitForFunction(() => !document.body.classList.contains("scroll-locked"), { timeout: 45000 });

  // scroll gradually from sp≈0.60 (pre-reveal) through gp≈0.20 (into the morph),
  // sampling the app-side frame state at each step.
  const steps = Number(opt("steps", "48"));
  const stepms = Number(opt("stepms", "8")); // total sweep ≈ steps*stepms (default ≈0.4s = a fast flick)
  const samples = await page.evaluate(async ({ track, VCARD, FLY, steps, stepms }) => {
    const ih = window.innerHeight;
    const animMax = ((track - 100) / 100) * ih;
    const startY = 0.63 * animMax; // start at the reveal (idx begins climbing)
    const endY = animMax + (VCARD / 100) * ih * (0.20 / FLY);
    const out = [];
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let s = 0; s <= steps; s++) {
      window.scrollTo(0, startY + ((endY - startY) * s) / steps);
      await new Promise((r) => requestAnimationFrame(() => r())); // let useFrame run
      await sleep(stepms);
      const f = window.__fp;
      if (f) out.push({ idx: f.idx, resolved: f.resolved, loaded: f.loadedCount, sp: f.sp, gp: f.gp });
    }
    // dwell briefly so any catch-up is visible in the tail
    for (let k = 0; k < 30; k++) {
      await sleep(40);
      const f = window.__fp;
      if (f) out.push({ idx: f.idx, resolved: f.resolved, loaded: f.loadedCount, sp: f.sp, gp: f.gp, dwell: true });
    }
    return out;
  }, { track, VCARD, FLY, steps, stepms });

  let maxGap = 0, at = null;
  for (const s of samples) {
    const gap = s.resolved < 0 ? 999 : s.idx - s.resolved;
    if (gap > maxGap) { maxGap = gap; at = s; }
  }
  const last = samples[samples.length - 1] || {};
  console.log(`mbps=${mbps} samples=${samples.length} finalLoaded=${last.loaded}/295`);
  console.log(`MAX GAP idx−resolved = ${maxGap} frames` + (at ? ` @ idx=${at.idx} resolved=${at.resolved} loaded=${at.loaded} sp=${at.sp} gp=${at.gp}` : ""));
  // show a few worst samples
  const worst = [...samples].sort((a, b) => (b.idx - b.resolved) - (a.idx - a.resolved)).slice(0, 6);
  for (const s of worst) console.log(`  idx=${s.idx} resolved=${s.resolved} gap=${s.idx - s.resolved} loaded=${s.loaded} sp=${s.sp} gp=${s.gp}`);
} finally {
  await browser.close();
}
