// Scroll-position screenshot harness for headless visual verification.
// Usage:
//   node scripts/verify/shot.mjs --url http://localhost:5173 --sp 0,0.3,0.5 \
//     --out /tmp/shots --viewport 1280x800 --track 800 --wait 9000
//   (requires: npm i puppeteer-core --no-save)
// Notes:
//   - Drives SYSTEM Chrome with SwiftShader so WebGL works headlessly.
//   - After the fixed wait it also waits for body.scroll-locked to be absent
//     (no-op before the loader exists; waits for loader release after).
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
const sps = opt("sp", "0").split(",").map(Number);
if (sps.some(Number.isNaN)) {
  console.error("Bad --sp value:", opt("sp", "0"));
  process.exit(1);
}
const gpsRaw = opt("gp", null);
const gps = gpsRaw ? gpsRaw.split(",").map(Number) : [];
if (gps.some(Number.isNaN)) {
  console.error("Bad --gp value:", gpsRaw);
  process.exit(1);
}
const out = opt("out", "/tmp/shots");
const [w, h] = opt("viewport", "1280x800").split("x").map(Number);
const track = Number(opt("track", "800")); // keep in sync with SCROLL_TRACK_VH
const wait = Number(opt("wait", "9000"));

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
const page = await browser.newPage();
await page.setViewport({ width: w, height: h });
page.on("console", (m) => {
  if (m.text().includes("[DBG]")) console.log("page:", m.text());
});
await page.goto(url, { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, wait)); // Suspense: GLB + Lottie mount
await page.waitForFunction(
  () => !document.body.classList.contains("scroll-locked"),
  { timeout: 30000 },
);
// Scroll to a GALLERY progress position (gp ∈ [0,1]) — i.e. scroll BEYOND the
// animation track. `track` is SCROLL_TRACK_VH (default 800).
async function scrollToGp(page, gp, track) {
  await page.evaluate(
    ({ gp, track }) => {
      const ih = window.innerHeight;
      const animY = ((track - 100) / 100) * ih;
      const maxY = document.documentElement.scrollHeight - ih;
      window.scrollTo(0, animY + gp * (maxY - animY));
    },
    { gp, track },
  );
}

try {
  for (const sp of sps) {
    await page.evaluate(
      (sp, track) => {
        const trackMax = ((track - 100) / 100) * window.innerHeight;
        window.scrollTo(0, sp * trackMax);
      },
      sp,
      track,
    );
    await new Promise((r) => setTimeout(r, 600)); // scrub + settle
    const file = `${out}/sp${String(sp).replace(".", "_")}.png`;
    await page.screenshot({ path: file });
    console.log("wrote", file);
  }
  for (const gp of gps) {
    await scrollToGp(page, gp, track);
    await new Promise((r) => setTimeout(r, 600)); // scrub + settle
    const file = `${out}/gp${String(gp).replace(".", "_")}.png`;
    await page.screenshot({ path: file });
    console.log("wrote", file);
  }
} finally {
  await browser.close();
}
