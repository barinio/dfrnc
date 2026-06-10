// Time-offset screenshots after page load (no scrolling) — for the loader's
// time-based (not scroll-based) sequence.
// Usage: node scripts/verify/timed.mjs --url http://localhost:5173 \
//          --t 1000,3000,4500,6500,9000 --out /tmp/loader --viewport 1280x800
// (requires: npm i puppeteer-core --no-save)
import puppeteer from "puppeteer-core";
import { mkdirSync } from "fs";

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};

const CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const url = opt("url", "http://localhost:5173");
const rawTimes = opt("t", "1000,3000,4500,6500,9000");
const out = opt("out", "/tmp/loader");
const [w, h] = opt("viewport", "1280x800").split("x").map(Number);

// NaN guard: exit before launch if any arg is unparseable.
if (isNaN(w) || isNaN(h)) {
  console.error("ERROR: --viewport must be WxH (e.g. 1280x800)");
  process.exit(1);
}
const times = rawTimes
  .split(",")
  .map(Number)
  .sort((a, b) => a - b);
if (times.some(isNaN)) {
  console.error("ERROR: --t must be comma-separated numbers (e.g. 1000,3000)");
  process.exit(1);
}

mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader-webgl",
    `--window-size=${w},${h}`,
  ],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h });
  page.on("console", (m) => {
    if (m.text().includes("[DBG]")) console.log("page:", m.text());
  });
  const t0 = Date.now();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  for (const t of times) {
    const wait = t - (Date.now() - t0);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const file = `${out}/t${t}.png`;
    await page.screenshot({ path: file });
    const locked = await page.evaluate(() =>
      document.body.classList.contains("scroll-locked"),
    );
    console.log("wrote", file, `locked=${locked}`);
  }
} finally {
  await browser.close();
}
