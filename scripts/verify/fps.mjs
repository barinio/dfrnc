// Rough FPS smoke check: counts rAF callbacks over a window at a given scroll
// position. SwiftShader (software WebGL) is far slower than a real GPU — the
// absolute number is meaningless; ONLY compare before vs after a change at
// the same viewport/sp on the same machine.
// Usage: node scripts/verify/fps.mjs --url http://localhost:5173 --sp 0.1 \
//          --viewport 390x844 --track 800 --wait 9000 --ms 3000
// Always pass --track matching src/constants.ts SCROLL_TRACK_VH.
//   (requires: npm i puppeteer-core --no-save)
import puppeteer from "puppeteer-core";

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};

const CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const url = opt("url", "http://localhost:5173");
const sp = Number(opt("sp", "0.1"));
const [w, h] = opt("viewport", "390x844").split("x").map(Number);
const track = Number(opt("track", "800"));
const wait = Number(opt("wait", "9000"));
const windowMs = Number(opt("ms", "3000"));

if (Number.isNaN(sp) || Number.isNaN(w) || Number.isNaN(h) || Number.isNaN(track) || Number.isNaN(wait) || Number.isNaN(windowMs)) {
  console.error("Bad numeric argument — check --sp, --viewport, --track, --wait, --ms");
  process.exit(1);
}

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
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await new Promise((r) => setTimeout(r, wait));
  await page.waitForFunction(
    () => !document.body.classList.contains("scroll-locked"),
    { timeout: 30000 },
  );
  await page.evaluate(
    (sp, track) => {
      const trackMax = ((track - 100) / 100) * window.innerHeight;
      window.scrollTo(0, sp * trackMax);
    },
    sp,
    track,
  );
  await new Promise((r) => setTimeout(r, 800));
  const fps = await page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        let frames = 0;
        const t0 = performance.now();
        const tick = () => {
          frames++;
          if (performance.now() - t0 < ms) requestAnimationFrame(tick);
          else resolve((frames * 1000) / (performance.now() - t0));
        };
        requestAnimationFrame(tick);
      }),
    windowMs,
  );
  console.log(`fps ≈ ${fps.toFixed(1)} @ sp=${sp} ${w}x${h}`);
} finally {
  await browser.close();
}
