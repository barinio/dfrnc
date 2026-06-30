// Verify the sp→gp seam has NO dead zone when the viewport HEIGHT changes mid-
// scroll (the mobile URL-bar collapse). Loads at one height (caches trackMax),
// grows the height (URL bar "hides"), then scrolls across the seam reading the
// app-side frame index (window.__fp). A dead zone shows as a long run of identical
// idx (the boundary frame ~247 frozen) and/or a jump. With sp + gp sharing a
// stable cached height the index advances monotonically by ~1.
//   node scripts/verify/seam.mjs --url http://localhost:5173 --track 800
import puppeteer from "puppeteer-core";
const opt = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const url = opt("url", "http://localhost:5173");
const track = Number(opt("track", "800"));
const H1 = 750, H2 = 844, W = 390; // mount height (url bar visible) → grown (hidden)

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader-webgl"],
  defaultViewport: { width: W, height: H1, deviceScaleFactor: 2 },
});
try {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !document.body.classList.contains("scroll-locked"), { timeout: 45000 });
  // let the sequence load fully so this isolates the MAPPING, not loading
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise((r) => setTimeout(r, 1500));
  // URL bar "hides": viewport height grows. width unchanged.
  await page.setViewport({ width: W, height: H2, deviceScaleFactor: 2 });
  await new Promise((r) => setTimeout(r, 300));

  const res = await page.evaluate(async ({ track, H1, H2 }) => {
    // sp saturates at scrollY = ((track-100)/100)*<cached mount height H1>.
    const seam = ((track - 100) / 100) * H1;
    const from = seam - ((track - 100) / 100) * 40; // a little before
    const to = ((track - 100) / 100) * H2 + ((track - 100) / 100) * 40; // past where a live-gp seam would be
    const STEPS = 120;
    const out = [];
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let s = 0; s <= STEPS; s++) {
      window.scrollTo(0, from + ((to - from) * s) / STEPS);
      await new Promise((r) => requestAnimationFrame(() => r()));
      await sleep(20);
      const f = window.__fp;
      if (f) out.push(f.idx);
    }
    return { out, seam, from, to };
  }, { track, H1, H2 });

  const seq = res.out;
  // longest run of identical idx (the freeze) + any backward jumps
  let maxRun = 1, run = 1, maxJump = 0;
  for (let i = 1; i < seq.length; i++) {
    if (seq[i] === seq[i - 1]) { run++; maxRun = Math.max(maxRun, run); } else run = 1;
    maxJump = Math.max(maxJump, Math.abs(seq[i] - seq[i - 1]));
  }
  const span = seq.length ? seq[seq.length - 1] - seq[0] : 0;
  console.log(`seam test: ${seq.length} samples across the sp→gp boundary (height ${H1}→${H2})`);
  console.log(`  idx span ${seq[0]}→${seq[seq.length - 1]} (Δ${span}); longest frozen run=${maxRun}; max step jump=${maxJump}`);
  console.log(`  ${maxRun <= 8 && maxJump <= 6 ? "PASS — no dead zone / jump at the seam" : "FAIL — dead zone or jump at the seam"}`);
} finally {
  await browser.close();
}
