// Rough FPS smoke check: counts rAF callbacks over a window at a given scroll
// position. SwiftShader (software WebGL) is far slower than a real GPU — the
// absolute number is meaningless; ONLY compare before vs after a change at
// the same viewport/sp on the same machine.
// Usage: node scripts/verify/fps.mjs --url http://localhost:5173 --sp 0.1 \
//          --viewport 390x844 --track 800 --wait 9000 --ms 3000
//        node scripts/verify/fps.mjs --url http://localhost:5173 --gp 0.16 \
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
const gpRaw = opt("gp", null);
const gp = gpRaw === null ? null : Number(gpRaw);
const [w, h] = opt("viewport", "390x844").split("x").map(Number);
const track = Number(opt("track", "800"));
const wait = Number(opt("wait", "9000"));
const windowMs = Number(opt("ms", "3000"));

if (
  Number.isNaN(sp) ||
  (gp !== null && Number.isNaN(gp)) ||
  Number.isNaN(w) ||
  Number.isNaN(h) ||
  Number.isNaN(track) ||
  Number.isNaN(wait) ||
  Number.isNaN(windowMs)
) {
  console.error("Bad numeric argument — check --sp/--gp, --viewport, --track, --wait, --ms");
  process.exit(1);
}

const VID_FLY_END = 0.4;
const VIDEO_CARD_TRACK_VH = 140;
const IMAGE_GALLERY_TRACK_VH = 420;

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
    ({ sp, gp, track, VID_FLY_END, VIDEO_CARD_TRACK_VH, IMAGE_GALLERY_TRACK_VH }) => {
      const ih = window.innerHeight;
      if (gp !== null) {
        const animY = ((track - 100) / 100) * ih;
        const videoCardPx = (VIDEO_CARD_TRACK_VH / 100) * ih;
        const imagePx = (IMAGE_GALLERY_TRACK_VH / 100) * ih;
        const s =
          gp <= VID_FLY_END
            ? (gp / VID_FLY_END) * videoCardPx
            : videoCardPx + ((gp - VID_FLY_END) / (1 - VID_FLY_END)) * imagePx;
        window.scrollTo(0, animY + s);
        return;
      }
      const trackMax = ((track - 100) / 100) * ih;
      window.scrollTo(0, sp * trackMax);
    },
    { sp, gp, track, VID_FLY_END, VIDEO_CARD_TRACK_VH, IMAGE_GALLERY_TRACK_VH },
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
  console.log(`fps ≈ ${fps.toFixed(1)} @ ${gp === null ? `sp=${sp}` : `gp=${gp}`} ${w}x${h}`);
} finally {
  await browser.close();
}
