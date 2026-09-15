// Pure-function assertions for the PORTRAIT phone frame tier. No test runner in
// this project — run manually with:  npx tsx scripts/check-portrait-tier.ts
//
// The claim being proved: on every phone aspect that selects the portrait tier,
// in EVERY phase of the video's life (full-bleed reveal → three-step card morph
// → hold → fly-up), the source-u the plane samples stays inside the cropped
// pixels the tier actually contains — and the remapped window is the SAME
// picture the uncropped tiers would have shown. Plus: a window that escapes the
// crop (a phone rotated to landscape after load — the tier is chosen once and
// never swapped) is clamped inside it instead of sampling pixels that do not
// exist.
import { readFileSync } from "node:fs";
import {
  frameTierFor,
  frameUrl,
  frameLoaderBudgetFor,
  isPortraitTier,
  coverSourceWindow,
  applyPortraitCrop,
  FRAME_SOURCE_ASPECT,
  PORTRAIT_TIER_MAX_ASPECT,
  SMALL_SCREEN_MAX,
  FRAME_COUNT,
} from "../src/frames";
import type { SourceWindow } from "../src/frames";
import { FRAME_MANIFEST, PORTRAIT_TIER } from "../src/frameManifest";
import { videoCardMorphFor } from "../src/gallery";
import { VID_MORPH_END, VID_HOLD_END, VID_FLY_END } from "../src/constants";

let failures = 0;
function ok(cond: boolean, label: string) {
  if (!cond) {
    failures++;
    console.error("✗", label);
  }
}
function eq(actual: number | string, expected: number | string, label: string, tol = 0) {
  const good =
    typeof actual === "number" && typeof expected === "number"
      ? Math.abs(actual - expected) <= tol
      : actual === expected;
  if (!good) {
    failures++;
    console.error(`✗ ${label}: got ${actual}, expected ${expected}`);
  }
}

const { cropX0, cropX1, dir: PORTRAIT_DIR } = PORTRAIT_TIER;
const SPAN = cropX1 - cropX0;

// ── The crop definition + its two mirrors ───────────────────────────────────
{
  ok(cropX0 >= 0 && cropX1 <= 1 && cropX1 > cropX0, "crop window lies inside the source frame");
  eq(SPAN, 0.4, "crop spans 40% of the source width", 1e-12);
  // The crop is exactly the window a viewport of PORTRAIT_TIER aspect asks for.
  eq(
    PORTRAIT_TIER.width / PORTRAIT_TIER.height,
    (SPAN * FRAME_SOURCE_ASPECT) / 1,
    "crop pixel aspect = the source-u span it covers (no squash baked in)",
    1e-9,
  );
  // 1920×1080 source → the committed tier size.
  eq(Math.round(1920 * SPAN), PORTRAIT_TIER.width, "768px = 40% of the 1920 tier width");
  eq(1080, PORTRAIT_TIER.height, "crop keeps the full source height");
  // Mirrored into the SERVED manifest the way sourceFps/stride are.
  const served = JSON.parse(
    readFileSync(new URL("../public/frames/manifest.json", import.meta.url), "utf8"),
  ) as { count: number; tiers: number[]; portraitTier?: Record<string, unknown> };
  ok(served.portraitTier !== undefined, "public/frames/manifest.json mirrors portraitTier");
  for (const key of ["dir", "cropX0", "cropX1", "width", "height"] as const) {
    eq(
      String(served.portraitTier?.[key]),
      String(PORTRAIT_TIER[key]),
      `manifest.json portraitTier.${key} matches src/frameManifest.ts`,
    );
  }
  eq(served.count, FRAME_MANIFEST.count, "manifest frame count is untouched");
  eq(served.count, 295, "the sequence is still 295 frames");
  eq(served.tiers.join(","), "1280,1920", "the existing width tiers are untouched");
  eq(FRAME_COUNT, 295, "the runtime still sees 295 frames");
  // The crop script and extract-frames.mjs must PARSE the literal, never restate it.
  const cropScript = readFileSync(new URL("./crop-portrait-tier.mjs", import.meta.url), "utf8");
  ok(
    /readPortraitTier\(/.test(cropScript) && !/cropX0\s*[:=]\s*0\.25/.test(cropScript),
    "crop-portrait-tier.mjs reads the shared literal instead of restating the numbers",
  );
  const extract = readFileSync(new URL("./extract-frames.mjs", import.meta.url), "utf8");
  ok(
    /readPortraitTier\(/.test(extract) && /portraitTier: \{ \.\.\.portraitTier \}/.test(extract),
    "extract-frames.mjs round-trips the shared literal into both manifests",
  );
}

// ── Tier selection: width < 900 AND aspect ≤ 0.67 ───────────────────────────
{
  eq(frameTierFor(390, 844), PORTRAIT_DIR, "iPhone 14/15 portrait (0.462) → portrait tier");
  eq(frameTierFor(430, 932), PORTRAIT_DIR, "iPhone Pro Max portrait (0.461) → portrait tier");
  eq(frameTierFor(360, 640), PORTRAIT_DIR, "small Android portrait (0.5625) → portrait tier");
  eq(frameTierFor(412, 915), PORTRAIT_DIR, "Pixel portrait (0.450) → portrait tier");
  eq(frameTierFor(670, 1000), PORTRAIT_DIR, "exactly 0.67 is inclusive → portrait tier");
  eq(frameTierFor(671, 1000), 1280, "just wider than 0.67 → the 1280 tier");
  eq(frameTierFor(768, 1024), 1280, "iPad portrait (0.75) keeps the 1280 tier");
  eq(frameTierFor(834, 1194), 1280, "iPad Air portrait (0.699) keeps the 1280 tier");
  eq(frameTierFor(844, 390), 1280, "a phone LOADED in landscape (2.16) keeps the 1280 tier");
  eq(frameTierFor(899.98, 1600), PORTRAIT_DIR, "the 899.98px breakpoint still admits a portrait phone");
  eq(frameTierFor(900, 1600), 1920, "900px wide is a desktop/tablet → 1920 regardless of aspect");
  eq(frameTierFor(1280, 800), 1920, "desktop → 1920");
  // Width-only callers (the historical signature) must never be read as portrait.
  eq(frameTierFor(390), 1280, "width-only call stays on the 1280 tier (aspect unknown)");
  eq(frameTierFor(899.98), 1280, "width-only call at the breakpoint stays on 1280");
  eq(frameTierFor(900), 1920, "width-only call above the breakpoint stays on 1920");
  eq(PORTRAIT_TIER_MAX_ASPECT, 0.67, "the portrait aspect gate is 0.67");
  eq(SMALL_SCREEN_MAX, 899.98, "the width breakpoint is unchanged");
  ok(isPortraitTier(PORTRAIT_DIR) && !isPortraitTier(1280) && !isPortraitTier(1920), "isPortraitTier");
  eq(frameUrl(PORTRAIT_DIR, 0), `/frames/${PORTRAIT_DIR}/0001.webp`, "portrait frame URL");
  eq(frameUrl(PORTRAIT_DIR, 294), `/frames/${PORTRAIT_DIR}/0295.webp`, "portrait last-frame URL");
  // Phone tier ⇒ phone request budget (4 concurrent, not the desktop 6).
  eq(
    frameLoaderBudgetFor(PORTRAIT_DIR).concurrency,
    frameLoaderBudgetFor(1280).concurrency,
    "portrait tier rides the mobile request budget",
  );
  ok(frameLoaderBudgetFor(PORTRAIT_DIR).concurrency < frameLoaderBudgetFor(1920).concurrency,
    "…which is tighter than the desktop budget");
}

// ── Sampled source-u, every aspect × every phase ────────────────────────────
// Replays VideoPlane's two consumers of the window:
//   screenClip (gp ∈ (0, VID_MORPH_END)) → repeat/offset as computed
//   card mesh  (otherwise)               → composed with the morph crop rect
// and converts the result BACK to source-u so it can be compared with the crop.
const NARROW_PAN_CENTER_X = 0.45; // must match VideoPlane's constant

interface Sample {
  u0: number;
  u1: number;
}

function sampledSourceU(aspect: number, gp: number, portrait: boolean): Sample {
  const win: SourceWindow = { repeatX: 1, repeatY: 1, offsetX: 0, offsetY: 0 };
  coverSourceWindow(aspect, NARROW_PAN_CENTER_X, win);
  if (portrait) applyPortraitCrop(win);
  const { l, r } = videoCardMorphFor(gp, aspect).crop;
  const screenClip = gp > 0 && gp < VID_MORPH_END;
  // Texture-space window actually handed to three.js.
  const repeatX = screenClip ? win.repeatX : win.repeatX * (r - l);
  const offsetX = screenClip ? win.offsetX : win.offsetX + win.repeatX * l;
  // Back to SOURCE-u: the portrait tier's u' = (u − cropX0) / span.
  const toSource = (u: number) => (portrait ? cropX0 + u * SPAN : u);
  return { u0: toSource(offsetX), u1: toSource(offsetX + repeatX) };
}

{
  // Every phase boundary plus interior points of all three morph steps, the
  // hold and the fly-up.
  const phases: [string, number][] = [
    ["full-bleed reveal", 0],
    ["morph step 1 (top crops)", 0.03],
    ["morph step 2 (bottom crops)", 0.1],
    ["morph step 3 (sides crop in)", 0.145],
    ["morph complete", VID_MORPH_END],
    ["mid hold", (VID_MORPH_END + VID_HOLD_END) / 2],
    ["hold end", VID_HOLD_END],
    ["mid fly-up", (VID_HOLD_END + VID_FLY_END) / 2],
    ["flown", VID_FLY_END],
  ];
  let min = Infinity;
  let max = -Infinity;
  let aspects = 0;
  for (let a = 0.42; a <= PORTRAIT_TIER_MAX_ASPECT + 1e-9; a += 0.0025) {
    const aspect = Math.min(a, PORTRAIT_TIER_MAX_ASPECT);
    aspects++;
    for (const [label, gp] of phases) {
      const p = sampledSourceU(aspect, gp, true);
      min = Math.min(min, p.u0);
      max = Math.max(max, p.u1);
      ok(
        p.u0 >= cropX0 - 1e-9 && p.u1 <= cropX1 + 1e-9,
        `sampled u ⊂ crop @aspect=${aspect.toFixed(4)} ${label}: [${p.u0.toFixed(5)}, ${p.u1.toFixed(5)}]`,
      );
      // …and it is the SAME window the uncropped tier would sample: framing is
      // unchanged, only the texel density under it.
      const full = sampledSourceU(aspect, gp, false);
      eq(p.u0, full.u0, `portrait framing == 1280 framing (left) @${aspect.toFixed(4)} ${label}`, 1e-9);
      eq(p.u1, full.u1, `portrait framing == 1280 framing (right) @${aspect.toFixed(4)} ${label}`, 1e-9);
    }
  }
  console.log(
    `  sampled source-u over ${aspects} aspects × ${phases.length} phases: ` +
      `[${min.toFixed(5)}, ${max.toFixed(5)}] ⊂ [${cropX0}, ${cropX1}]`,
  );
  ok(min >= cropX0 && max <= cropX1, "the union of every sampled window lies inside the crop");
  // The gate aspect is the tight case; the crop must not be loose enough to be
  // wasting pixels, nor tight enough to clip at it.
  const tight = sampledSourceU(PORTRAIT_TIER_MAX_ASPECT, 0, true);
  ok(cropX1 - tight.u1 < 0.02 && tight.u0 - cropX0 < 0.02, "the crop is snug around the widest gated window");
}

// ── Rotation after load: CLAMP inside the crop, never sample outside ────────
{
  // The tier is picked once. If the phone is then rotated, the plane asks for a
  // landscape window (repeatX = 1) that the crop cannot serve.
  for (const aspect of [0.8, 1, 16 / 9, 2.16, 3]) {
    const win: SourceWindow = { repeatX: 1, repeatY: 1, offsetX: 0, offsetY: 0 };
    coverSourceWindow(aspect, NARROW_PAN_CENTER_X, win);
    const beforeRatio = win.repeatX / win.repeatY;
    applyPortraitCrop(win);
    ok(win.offsetX >= -1e-12, `rotated ${aspect.toFixed(2)}: window starts inside the texture`);
    ok(win.offsetX + win.repeatX <= 1 + 1e-9, `rotated ${aspect.toFixed(2)}: window ends inside the texture`);
    ok(win.offsetY >= -1e-12 && win.offsetY + win.repeatY <= 1 + 1e-9, `rotated ${aspect.toFixed(2)}: v stays in [0,1]`);
    // Clamping is an aspect-preserving ZOOM, not a horizontal squash: the
    // source-space width:height ratio of the window is unchanged.
    eq(
      (win.repeatX * SPAN) / win.repeatY,
      beforeRatio,
      `rotated ${aspect.toFixed(2)}: clamp preserves the window aspect (zoom, not squash)`,
      1e-9,
    );
    ok(win.repeatY <= 1 + 1e-9 && win.repeatY > 0, `rotated ${aspect.toFixed(2)}: v window is a real sub-range`);
  }
  // A window still inside the crop must pass through untouched (pure remap).
  const inside: SourceWindow = { repeatX: 0.26, repeatY: 1, offsetX: 0.32, offsetY: 0 };
  applyPortraitCrop(inside);
  eq(inside.repeatX, 0.26 / SPAN, "in-crop window: repeatX is a pure rescale", 1e-12);
  eq(inside.offsetX, (0.32 - cropX0) / SPAN, "in-crop window: offsetX is a pure rebase", 1e-12);
  eq(inside.repeatY, 1, "in-crop window: v untouched");
  eq(inside.offsetY, 0, "in-crop window: v offset untouched");
}

// ── The remap point is single, and the mask is NOT remapped ─────────────────
{
  const videoPlane = readFileSync(
    new URL("../src/components/VideoPlane.tsx", import.meta.url),
    "utf8",
  );
  ok(
    /coverSourceWindow\(aspect, NARROW_PAN_CENTER_X, SOURCE_WINDOW\)/.test(videoPlane) &&
      /if \(portraitTierRef\.current\) applyPortraitCrop\(win\)/.test(videoPlane),
    "VideoPlane remaps the window once, before either texture-window branch",
  );
  ok(/const NARROW_PAN_CENTER_X = 0\.45;/.test(videoPlane), "the pan centre is unchanged");
  ok(
    (videoPlane.match(/texture\.repeat\.set\(/g) ?? []).length === 2 &&
      (videoPlane.match(/texture\.offset\.set\(/g) ?? []).length === 2,
    "there are exactly two texture-window writers, both downstream of the remap",
  );
  // The SDF mask reads the raw geometry UV in PLANE space — the crop must not
  // touch it, or the rounded card corners would shift.
  const maskBody = videoPlane.slice(
    videoPlane.indexOf("const installMask"),
    videoPlane.indexOf("}, []);", videoPlane.indexOf("const installMask")),
  );
  ok(maskBody.length > 500, "found the installMask shader patch");
  ok(
    /vMaskUv = uv;/.test(maskBody) &&
      !/(applyPortraitCrop|PORTRAIT|cropX0|cropX1|texture\.(repeat|offset))/.test(maskBody),
    "the rounded-corner SDF mask stays in plane space (vMaskUv = raw uv, no crop term)",
  );
  ok(
    /uAspect\.value = aspect;/.test(videoPlane),
    "uAspect stays the VIEWPORT aspect, not a source aspect",
  );
  // The frame texture has exactly one consumer: no other module builds a UV or
  // aspect window from it (the gallery image cards use their own coverCropWindowFor
  // over public/gallery/*.jpeg, which this tier does not touch).
  const gallery = readFileSync(new URL("../src/gallery.ts", import.meta.url), "utf8");
  const card = readFileSync(new URL("../src/components/GalleryCard.tsx", import.meta.url), "utf8");
  const stack = readFileSync(new URL("../src/components/CardStack.tsx", import.meta.url), "utf8");
  for (const [name, src] of [["gallery.ts", gallery], ["GalleryCard.tsx", card], ["CardStack.tsx", stack]] as const) {
    ok(!/frameUrl|FrameSequenceLoader|frames\//.test(src), `${name} does not consume the frame sequence`);
  }
}

// ── index.html preloads are mutually exclusive ─────────────────────────────
{
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const links = [...html.matchAll(/<link rel="preload"[^>]*href="\.\/frames\/([^/]+)\/0001\.webp"[^>]*media="([^"]+)"[^>]*>/g)];
  eq(links.length, 3, "three frame preloads: portrait, 1280, 1920");
  const byTier = Object.fromEntries(links.map((m) => [m[1], m[2]]));
  ok(byTier[PORTRAIT_DIR] !== undefined, "the portrait tier is preloaded");
  ok(
    /max-width:\s*899\.98px/.test(byTier[PORTRAIT_DIR]) && /max-aspect-ratio:\s*67\/100/.test(byTier[PORTRAIT_DIR]),
    "the portrait preload is gated on width AND aspect",
  );
  ok(
    /max-width:\s*899\.98px/.test(byTier["1280"]) && /min-aspect-ratio:/.test(byTier["1280"]),
    "the 1280 preload now also carries an aspect floor, so a phone never fetches both",
  );
  ok(/min-width:\s*900px/.test(byTier["1920"]), "the 1920 preload is unchanged");
  // No href may resolve to a real file from the project root, or Vite copies a
  // hashed duplicate of the frame into dist/assets.
  ok(
    [...html.matchAll(/href="([^"]*frames[^"]*)"/g)].every((m) => m[1].startsWith("./frames/")),
    "frame preload hrefs keep the ./frames/… form Vite cannot resolve",
  );
}

if (failures > 0) {
  console.error(`check-portrait-tier: ${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log("check-portrait-tier: all assertions passed");
