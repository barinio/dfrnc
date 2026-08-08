// Pure-function sanity assertions for the scroll timeline. No test runner in
// this project — run manually with:  npx tsx scripts/check-playback.ts
import "./check-scroll-lifecycle";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  lottieFrameForTime,
  lottieTimeFor,
  figureStateFor,
  figureVisibleFor,
  videoStateFor,
  videoMasterTimeFor,
  lottieBleedFor,
  lottiePlaneVisibleFor,
} from "../src/playback";
import { frameIndexFor, frameTierFor, frameUrl, FRAME_COUNT, buildCoarseToFineOrder } from "../src/frames";
import {
  DEFT_DROP_S,
  LOTTIE_INTRO_S,
  LOTTIE_TOTAL_S,
  REVEAL_END,
  LOTTIE_SCRUB_START,
  FIGURES_START,
  FIGURES_END,
  LOTTIE_END,
  VIDEO_START,
  VIDEO_FADE,
  FIGURE_FADE,
} from "../src/constants";
import {
  galleryProgressFrom,
  galleryBackdropFor,
  galleryTitleFracFor,
  galleryCardProgressFor,
  galleryTitleFrameFracForCard,
  galleryTitleFrameFor,
  galleryTitlesVisibleFor,
  galleryEndLayoutFor,
  isGalleryTitleHoldFrame,
  cardConveyorDisplayedFor,
  galleryStackDisplayedFor,
  cardConveyorFor,
  cardFlyProgressFor,
  galleryCtaFromExit,
  imageGalleryProgress,
  imageStackRevealFor,
  imageStackVisibleFor,
  videoCardExitProgressFor,
  cardStackPlacementFor,
  coverCropWindowFor,
  videoUsesScreenClipFor,
  STACK_VISIBLE,
  cardScreenRect,
  galleryImageFocusFor,
  videoCardMorphFor,
  CTA_REVEAL_FROM,
  CTA_REVEAL_TO,
  STEP_HOLD_FRAC,
  GALLERY_IMAGES,
  CARD_FILL,
  CARDS_VH,
  CARD_ASPECT,
  CARDS_WIDTH_VW_PORTRAIT,
  GUTTER,
  TOP_TITLE_VH,
  BACKDROP_FADE_END,
  TITLES_END,
  CARDS_FLY_START,
  CARDS_FLY_END,
  CTA_START,
  galleryCtaClipForProjectedCorners,
} from "../src/gallery";
import {
  SCROLL_TRACK_VH,
  GALLERY_TRACK_VH,
  VIDEO_CARD_TRACK_VH,
  IMAGE_GALLERY_TRACK_VH,
  VIDEO_SPLIT,
  VID_MORPH_END,
  VID_HOLD_END,
  VID_FLY_END,
  IMAGE_GALLERY_START,
} from "../src/constants";
import {
  approach,
  tiltTarget,
  idleTilt,
  TILT_MAX,
  IDLE_AMP_X,
  IDLE_AMP_Y,
} from "../src/cursorTilt";
import {
  browserNeedsConservativeRenderProfile,
  createRenderProfile,
} from "../src/renderProfile";

function eq(actual: unknown, expected: unknown, label: string, eps = 1e-9) {
  if (typeof actual !== "number" || !Number.isFinite(actual))
    throw new Error(`${label}: actual value must be a finite number, got ${String(actual)}`);
  if (typeof expected !== "number" || !Number.isFinite(expected))
    throw new Error(
      `${label}: expected value must be a finite number, got ${String(expected)}`,
    );
  if (Math.abs(actual - expected) > eps)
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
}
function ok(cond: unknown, label: string): asserts cond {
  if (!cond) throw new Error(label);
}

function expectEqRejection(value: unknown, label: string) {
  let rejected = false;
  try {
    eq(value, 0, `intentional invalid value for ${label}`);
  } catch {
    rejected = true;
  }
  ok(rejected, `eq rejects ${label}`);
}
expectEqRejection(Number.NaN, "NaN");
expectEqRejection("0", "numeric strings");

function cssRuleBody(css: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
  ok(match, `${selector} CSS rule exists`);
  return match[1];
}

function sourceBlock(
  source: string,
  marker: string,
  label: string,
  fromEnd = false,
): string {
  const markerIndex = fromEnd
    ? source.lastIndexOf(marker)
    : source.indexOf(marker);
  ok(markerIndex >= 0, `${label}: marker exists`);
  const openingBrace = source.indexOf("{", markerIndex);
  ok(openingBrace >= 0, `${label}: opening brace exists`);

  let depth = 0;
  for (let i = openingBrace; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] !== "}") continue;
    depth -= 1;
    if (depth === 0) return source.slice(openingBrace + 1, i);
  }
  throw new Error(`${label}: closing brace exists`);
}

function ordered(source: string, markers: string[], label: string) {
  let cursor = -1;
  for (const marker of markers) {
    const index = source.indexOf(marker, cursor + 1);
    ok(index > cursor, `${label}: ${marker} appears in order`);
    cursor = index;
  }
}

const indexCss = readFileSync(
  new URL("../src/index.css", import.meta.url),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");
const canvasLayerRule = cssRuleBody(indexCss, ".canvas-layer");
const galleryCtaRule = cssRuleBody(indexCss, ".gallery-cta");
ok(
  /height:\s*100svh\s*;/.test(canvasLayerRule),
  "canvas layer keeps the stable 100svh height",
);
ok(/position:\s*fixed\s*;/.test(galleryCtaRule), "gallery CTA stays fixed");
ok(/inset:\s*0\s*;/.test(galleryCtaRule), "gallery CTA covers the viewport");
ok(
  /background-color:\s*#(?:000|000000)\s*;/i.test(galleryCtaRule),
  "gallery CTA coverage is pure black",
);
ok(
  /clip-path:\s*inset\([^;]+\)\s*;/.test(galleryCtaRule),
  "gallery CTA coverage stays clip-revealed",
);

const shotHarnessSource = readFileSync(
  new URL("./verify/shot.mjs", import.meta.url),
  "utf8",
);
ok(
  /Number\.isFinite\(canvasHeight\)[\s\S]*canvasHeight\s*<=\s*0[\s\S]*--canvas-height must be a positive pixel value/.test(
    shotHarnessSource,
  ),
  "shot harness rejects non-positive and non-finite canvas heights",
);
ok(
  /style\.setProperty\(\s*["']height["'],\s*`\$\{height\}px`,\s*["']important["']\s*\)/.test(
    shotHarnessSource,
  ),
  "shot harness can override the canvas height with important priority",
);

eq(
  galleryCtaClipForProjectedCorners([0.25, -0.4, 0.1, -0.2], 800),
  0.7025,
  "CTA clip follows the lowest projected corner and adds a 2px guard",
);
eq(
  galleryCtaClipForProjectedCorners([0.25, -0.4, 0.1, -0.2], 400),
  0.705,
  "CTA clip scales the CSS-pixel guard by viewport height",
);
eq(
  galleryCtaClipForProjectedCorners([3, 2.5, 2.8, 2.6], 400),
  0,
  "CTA clip clamps above the viewport",
);
eq(
  galleryCtaClipForProjectedCorners([-2, -1.5, -1.8, -1.6], 400),
  1,
  "CTA clip clamps below the viewport",
);
eq(
  galleryCtaClipForProjectedCorners([], 800),
  1,
  "CTA clip safely hides the overlay without projected corners",
);
eq(
  galleryCtaClipForProjectedCorners(
    [Number.NaN, Infinity, -Infinity, Number.NaN],
    800,
  ),
  1,
  "CTA clip safely hides the overlay when every corner is invalid",
);
eq(
  galleryCtaClipForProjectedCorners(
    [Number.NaN, -0.25, 0.5, Infinity],
    1000,
  ),
  1,
  "CTA clip fails closed when any projected corner is invalid",
);
for (const ndcYs of [[-0.25], [-0.25, 0, 0.25], [-0.5, -0.25, 0, 0.25, 0.5]]) {
  eq(
    galleryCtaClipForProjectedCorners(ndcYs, 1000),
    1,
    `CTA clip requires exactly four corners (got ${ndcYs.length})`,
  );
}
eq(
  galleryCtaClipForProjectedCorners([-0.25], 0),
  1,
  "CTA clip safely hides the overlay for an invalid viewport height",
);

const cardStackProjectionSource = readFileSync(
  new URL("../src/components/CardStack.tsx", import.meta.url),
  "utf8",
);
ok(
  /for\s*\(let cornerIndex\s*=\s*0;\s*cornerIndex\s*<\s*4;[\s\S]*?\.applyMatrix4\(ref\.matrixWorld\)[\s\S]*?\.project\(camera\)[\s\S]*?galleryCtaClipForProjectedCorners\(/.test(
    cardStackProjectionSource,
  ) &&
    /CTA_CARD_CORNER_SIGNS\s*=\s*\[-1,\s*-1,\s*1,\s*-1,\s*-1,\s*1,\s*1,\s*1\]/.test(
      cardStackProjectionSource,
    ) &&
    /const\s*\{[^}]*camera[^}]*\}\s*=\s*useThree\(\)/.test(
      cardStackProjectionSource,
    ) &&
    /ref\.updateWorldMatrix\(true,\s*false\)/.test(cardStackProjectionSource) &&
    /applyMatrix4\(camera\.matrixWorldInverse\)[\s\S]*?Number\.isFinite\(CTA_CAMERA_SPACE_CORNER\.z\)[\s\S]*?CTA_CAMERA_SPACE_CORNER\.z\s*>=\s*0[\s\S]*?Number\.NaN/.test(
      cardStackProjectionSource,
    ) &&
    !/bottomWorld/.test(cardStackProjectionSource),
  "CardStack clips below all four corners projected through the live camera",
);

function findNamedObject(
  value: unknown,
  name: string,
): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object") return undefined;

  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findNamedObject(child, name);
      if (found) return found;
    }
    return undefined;
  }

  const object = value as Record<string, unknown>;
  if (object.nm === name) return object;
  for (const child of Object.values(object)) {
    const found = findNamedObject(child, name);
    if (found) return found;
  }
  return undefined;
}

function valueAtPath(
  value: unknown,
  path: readonly (string | number)[],
): unknown {
  let current = value;
  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Array.isArray(current)) return undefined;
      current = current[segment];
      continue;
    }
    if (current === null || typeof current !== "object" || Array.isArray(current))
      return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

const titleBytes = readFileSync(
  new URL("../src/assets/titles.json", import.meta.url),
);
const titleData = JSON.parse(
  titleBytes.toString("utf8"),
) as { ip: number; op: number };
const approvedTitleHash =
  "1ec3df8fee4662bebe35c491a7f3d6e289ecec0b04d477df0ed8cb6571fe7462";
const titleHash = createHash("sha256").update(titleBytes).digest("hex");
ok(
  titleHash === approvedTitleHash,
  `corrected gallery-title export hash: expected ${approvedTitleHash}, got ${titleHash}`,
);
const finalGalleryTitle = findNamedObject(
  titleData,
  "multidisziplinaere_gestaltung Outlines",
);
ok(Boolean(finalGalleryTitle), "corrected final gallery-title layer exists");
const finalTitlePosition = valueAtPath(finalGalleryTitle, ["ks", "p", "k"]);
const finalTitleScaleKeys = valueAtPath(finalGalleryTitle, ["ks", "s", "k"]);
ok(Array.isArray(finalTitlePosition), "final gallery-title position is an array");
ok(Array.isArray(finalTitleScaleKeys), "final gallery-title scale keys are an array");
eq(finalTitlePosition[1], 998.5, "final gallery-title position y");
eq(finalTitleScaleKeys.length, 14, "final gallery-title scale keyframe count");
eq(
  valueAtPath(finalTitleScaleKeys.at(-1), ["t"]),
  73,
  "final gallery-title last scale keyframe",
);

const introData = JSON.parse(
  readFileSync(new URL("../src/assets/animation.json", import.meta.url), "utf8"),
);
const introFrameRate = valueAtPath(introData, ["fr"]);
const introInPoint = valueAtPath(introData, ["ip"]);
const introOutPoint = valueAtPath(introData, ["op"]);
ok(
  typeof introFrameRate === "number" && Number.isFinite(introFrameRate),
  "intro export frame rate is finite",
);
ok(
  typeof introInPoint === "number" && Number.isFinite(introInPoint),
  "intro export in point is finite",
);
ok(
  typeof introOutPoint === "number" && Number.isFinite(introOutPoint),
  "intro export out point is finite",
);
const introTotalFrames = introOutPoint - introInPoint;
eq(introTotalFrames, 266, "intro export total frames");
const undLayer = findNamedObject(introData, "5_UND Outlines");
const entwickeltLayer = findNamedObject(introData, "6_ENTWICKELT Outlines");
const ausgezeichnetesLayer = findNamedObject(
  introData,
  "AUSGEZEICHNETES Outlines",
);
ok(Boolean(undLayer), "UND intro layer exists");
ok(Boolean(entwickeltLayer), "ENTWICKELT intro layer exists");
ok(Boolean(ausgezeichnetesLayer), "AUSGEZEICHNETES intro layer exists");
eq(
  valueAtPath(undLayer, ["ks", "p", "k", 0, "s", 0]),
  -260,
  "UND initial position x",
);
eq(
  valueAtPath(entwickeltLayer, ["ks", "p", "k", 0, "s", 0]),
  1745,
  "ENTWICKELT initial position x",
);
const ausgezeichnetesScaleKeys = valueAtPath(ausgezeichnetesLayer, [
  "ks",
  "s",
  "k",
]);
ok(
  Array.isArray(ausgezeichnetesScaleKeys),
  "AUSGEZEICHNETES scale keys are an array",
);
ok(
  ausgezeichnetesScaleKeys.length > 0,
  "AUSGEZEICHNETES has authored scale keys",
);
const ausgezeichnetesSettleFrame = Math.max(
  ...ausgezeichnetesScaleKeys.map((key, index) => {
    const frame = valueAtPath(key, ["t"]);
    ok(
      typeof frame === "number" && Number.isFinite(frame),
      `AUSGEZEICHNETES scale key ${index} has a finite frame`,
    );
    return frame;
  }),
);
const introHoldFrame = lottieFrameForTime(
  LOTTIE_INTRO_S,
  introTotalFrames,
  introFrameRate,
);
eq(introHoldFrame, 103, "intro hold frame");
ok(
  introHoldFrame >= ausgezeichnetesSettleFrame,
  `intro hold covers AUSGEZEICHNETES settle frame ${ausgezeichnetesSettleFrame}`,
);
eq(
  lottieFrameForTime(LOTTIE_TOTAL_S, introTotalFrames, introFrameRate),
  265,
  "Lottie total time clamps to the final authored frame",
);
eq(
  lottieFrameForTime(-1, introTotalFrames, introFrameRate),
  0,
  "negative Lottie time clamps to frame zero",
);
eq(
  lottieFrameForTime(Number.NaN, introTotalFrames, introFrameRate),
  0,
  "invalid Lottie time falls back to frame zero",
);
eq(
  lottieFrameForTime(LOTTIE_INTRO_S, 0, introFrameRate),
  0,
  "empty Lottie export falls back to frame zero",
);
eq(
  lottieFrameForTime(LOTTIE_INTRO_S, introTotalFrames, 0),
  0,
  "invalid Lottie frame rate falls back to frame zero",
);

const titleLastFrame = titleData.op - titleData.ip - 1;
function titleFrame(frac: number): number {
  return frac * titleLastFrame;
}

// lottieTimeFor: anchors and monotonicity
eq(lottieTimeFor(0, "scroll"), DEFT_DROP_S, "lottie @0");
eq(lottieTimeFor(REVEAL_END, "scroll"), LOTTIE_INTRO_S, "lottie @REVEAL_END");
eq(lottieTimeFor(LOTTIE_SCRUB_START, "scroll"), LOTTIE_INTRO_S, "lottie hold");
eq(lottieTimeFor(LOTTIE_END, "scroll"), LOTTIE_TOTAL_S, "lottie @LOTTIE_END");
eq(lottieTimeFor(1, "scroll"), LOTTIE_TOTAL_S, "lottie clamped after end");
eq(lottieTimeFor(500 / SCROLL_TRACK_VH, "done"), LOTTIE_INTRO_S, "lottie done: readable frame held");
eq(lottieTimeFor(0.9, "done"), LOTTIE_TOTAL_S, "lottie done: final frame at tail");
// Reduced-motion handoff: the readable frame may only swap to the (empty)
// final frame once the video is FULLY opaque — otherwise these users see the
// typography vanish over a bare background.
for (let sp = 0; sp <= 1.0001; sp += 0.001) {
  if (lottieTimeFor(sp, "done") === LOTTIE_TOTAL_S)
    ok(
      videoStateFor(sp, "done").opacity >= 1 - 1e-9,
      `done handoff uncovered @sp=${sp}`,
    );
}
let prev = -1;
for (let sp = 0; sp <= 1.0001; sp += 0.001) {
  const t = lottieTimeFor(sp, "scroll");
  ok(t >= prev - 1e-9, `lottie monotonic @${sp}`);
  ok(t >= DEFT_DROP_S, `lottie floored at DEFT_DROP_S @${sp}`);
  prev = t;
}

// figureStateFor: window mapping, apex, fades
const win: [number, number] = [0.2, 0.6];
const spFor = (phaseT: number) =>
  FIGURES_START + phaseT * (FIGURES_END - FIGURES_START);
eq(figureStateFor(spFor(0.2), win, "scroll").t, 0, "fig t@start");
eq(figureStateFor(spFor(0.4), win, "scroll").t, 0.5, "fig t@apex");
eq(figureStateFor(spFor(0.6), win, "scroll").t, 1, "fig t@end");
eq(figureStateFor(spFor(0.1), win, "scroll").opacity, 0, "fig hidden before");
eq(figureStateFor(spFor(0.7), win, "scroll").opacity, 0, "fig hidden after");
eq(figureStateFor(spFor(0.4), win, "scroll").opacity, 1, "fig opaque @apex");
// FIGURE_FADE === 0: opacity is BINARY — figures never dissolve, they fly in/out
// off-screen. Anywhere strictly inside the window it is exactly 1 (no partials).
ok(FIGURE_FADE === 0, "FIGURE_FADE is 0 (no opacity fades, per direction)");
eq(figureStateFor(spFor(0.22), win, "scroll").opacity, 1, "fig opaque just inside window");
eq(figureStateFor(spFor(0.58), win, "scroll").opacity, 1, "fig opaque just before exit");
eq(figureStateFor(0.3, win, "done").opacity, 0, "fig done hidden");

// Cascade invariant: windows overlap (the sequence reads continuous), but
// never more than TWO figures are airborne at once — and the overlap really
// exists (two airborne somewhere), or the cascade has silently decayed back
// to solo flights.
let maxAirborne = 0;
for (let p = 0; p <= 1.0001; p += 0.001) {
  const visible = FIGURES.filter(
    (f) => figureStateFor(spFor(p), f.arc.window, "scroll").opacity > 0.001,
  );
  ok(visible.length <= 2, `${visible.length} figures visible @phaseT=${p}`);
  maxAirborne = Math.max(maxAirborne, visible.length);
}
ok(maxAirborne === 2, "two figures airborne somewhere in the cascade");

// Mount grace: figureVisibleFor keeps a figure mounted slightly OUTSIDE its
// window (so ArcModel's temporal fade-out can finish), but not far outside.
ok(figureVisibleFor(spFor(0.21), win, "scroll"), "mounted inside window");
ok(figureVisibleFor(spFor(0.18), win, "scroll"), "mounted in grace before");
ok(figureVisibleFor(spFor(0.62), win, "scroll"), "mounted in grace after");
ok(!figureVisibleFor(spFor(0.1), win, "scroll"), "unmounted far before");
ok(!figureVisibleFor(spFor(0.72), win, "scroll"), "unmounted far after");
ok(!figureVisibleFor(spFor(0.4), win, "done"), "done: never mounted");

// Timing invariant: the intro settles before the figures begin, every flight
// ends before the video fades in, and the Lottie stays held until the final
// figure has landed.
eq(REVEAL_END * SCROLL_TRACK_VH, 136, "reveal ends at 136vh");
eq(FIGURES_START * SCROLL_TRACK_VH, 144, "figures begin at 144vh");
eq(
  (FIGURES_START - REVEAL_END) * SCROLL_TRACK_VH,
  8,
  "8vh clean beat before figures",
);
ok(FIGURES_START > REVEAL_END, "figures begin after the reveal settles");
ok(FIGURES_END < VIDEO_START, "figures end before the video starts");
const last = FIGURES[FIGURES.length - 1].arc.window;
const lastLandingSp =
  FIGURES_START + last[1] * (FIGURES_END - FIGURES_START);
ok(lastLandingSp <= FIGURES_END + 1e-9, "last flight ends within the figures phase");
ok(lastLandingSp < VIDEO_START, "last flight ends before the video starts");
eq(
  lastLandingSp * SCROLL_TRACK_VH,
  355.2,
  "last GBA window ends at 355.2vh",
);
eq(
  LOTTIE_SCRUB_START * SCROLL_TRACK_VH,
  356,
  "Lottie resumes at 356vh",
);
ok(
  lastLandingSp <= LOTTIE_SCRUB_START,
  "last figure lands before the Lottie resumes",
);
eq(
  lottieTimeFor(lastLandingSp, "scroll"),
  LOTTIE_INTRO_S,
  "Lottie holds the settled intro through the last landing",
);

// videoStateFor — anchored at VIDEO_START (video fades in behind the typography)
eq(videoStateFor(VIDEO_START, "scroll").t, 0, "video t@VIDEO_START");
eq(videoStateFor(VIDEO_START, "scroll").opacity, 0, "video hidden at VIDEO_START");
ok(videoStateFor(VIDEO_START + VIDEO_FADE, "scroll").opacity >= 1 - 1e-9, "video opaque at VIDEO_START+VIDEO_FADE");
eq(videoStateFor(1, "scroll").t, 1, "video t@end");
eq(videoStateFor(1, "scroll").opacity, 1, "video opaque at end");
eq(videoStateFor(0.3, "scroll").opacity, 0, "video hidden mid-page");
eq(videoStateFor(VIDEO_START - 0.01, "done").opacity, 0, "video done: hidden before VIDEO_START");
eq(videoStateFor(1, "done").t, 1, "video done: held on final frame");
eq(videoStateFor(1, "done").opacity, 1, "video done: visible at tail");

// lottieBleedFor — framed before VIDEO_START, full-bleed after ramp
eq(lottieBleedFor(0.3), 0, "bleed: framed mid-page");
eq(lottieBleedFor(VIDEO_START), 0, "bleed: framed before zoom");
eq(lottieBleedFor(VIDEO_START + VIDEO_FADE), 1, "bleed: full-bleed after ramp");
ok(lottiePlaneVisibleFor(LOTTIE_TOTAL_S - 1 / 60), "main Lottie remains visible before the transparent tail");
ok(!lottiePlaneVisibleFor(LOTTIE_TOTAL_S), "main Lottie stops drawing on the transparent final frame");

// arc.ts: apex at midpoint, mirroring flips travel direction only
import { makeArc, FIGURES } from "../src/arc";
const W = 12;
const H = 7;
for (const f of FIGURES) {
  const c = makeArc(W, H, f.arc);
  const apex = c.getPoint(0.5);
  eq(apex.x, 0, `${f.name} apex centered`);
  eq(apex.y, (H / 2) * f.arc.peakHeight, `${f.name} apex height`, 1e-6);
  eq(apex.z, f.arc.z ?? 0, `${f.name} depth offset`, 1e-9);
  const p0 = c.getPoint(0);
  ok(
    Math.sign(p0.x) === -f.arc.side,
    `${f.name} enters on the configured side`,
  );
  eq(Math.abs(p0.x), (W / 2) * f.arc.legSpreadLandscape, `${f.name} spread`, 1e-6);
}
// Cascade layout: ordered overlapping windows. Order is and → tokyo → gba;
// the first starts at the phase top and the last lands within it.
eq(FIGURES[0].arc.window[0], 0, "first window starts at 0");
ok(
  FIGURES[FIGURES.length - 1].arc.window[1] <= 1 + 1e-9,
  "last window ends within the phase",
);
for (let i = 1; i < FIGURES.length; i++) {
  const [prevStart, prevEnd] = FIGURES[i - 1].arc.window;
  const [start, end] = FIGURES[i].arc.window;
  ok(start > prevStart && end > prevEnd, `window ${i} ordered after ${i - 1}`);
}
const byName = (n: string) => FIGURES.find((f) => f.name === n)!;
// tokyo launches after `and` has passed its apex, while still overlapping the
// first flight's tail. It is also pushed forward in z so the two meshes cross as
// separate depth layers instead of entering each other.
const and = byName("and");
const andApex = (and.arc.window[0] + and.arc.window[1]) / 2;
const tokyo = byName("tokyo");
ok(tokyo.arc.window[0] >= andApex + 0.05, "tokyo launches after and's apex");
ok(tokyo.arc.window[0] < and.arc.window[1], "and/tokyo windows still overlap");
ok(
  Math.abs((tokyo.arc.z ?? 0) - (and.arc.z ?? 0)) >= 2.2,
  "and/tokyo have enough depth separation to avoid entering each other",
);
// The crossing pair: gba launches while tokyo is still airborne (their windows
// OVERLAP at the handoff, so two figures fly at once), on the opposite side and
// on a HIGHER dome at a different depth — they pass without colliding (per the
// design direction).
const gba = byName("gba");
ok(
  gba.arc.window[0] > tokyo.arc.window[0] &&
    gba.arc.window[0] < tokyo.arc.window[1],
  "gba launches during tokyo's flight (crossing pair windows overlap)",
);
ok(gba.arc.side !== tokyo.arc.side, "crossing pair flies opposite sides");
ok(gba.arc.peakHeight > tokyo.arc.peakHeight, "gba flies higher than tokyo");
ok((gba.arc.z ?? 0) !== (tokyo.arc.z ?? 0), "crossing pair layered in depth");
// Icons spin AGAINST their travel direction (sign opposite to side); text
// logos spin with it.
for (const name of ["and", "gba"]) {
  const f = FIGURES.find((x) => x.name === name)!;
  ok(
    Math.sign(f.arc.spinTurns) === -f.arc.side,
    `${name} (icon) spins against its travel`,
  );
}
for (const name of ["tokyo"]) {
  const f = FIGURES.find((x) => x.name === name)!;
  ok(
    Math.sign(f.arc.spinTurns) === f.arc.side,
    `${name} (text) spins with its travel`,
  );
}
// peaks stay at or below ~half the viewport (0.5 of the upper half) so the
// figure — whose body extends above its center — never clips off the top edge
for (const f of FIGURES) {
  ok(f.arc.peakHeight <= 0.5 + 1e-9, `${f.name} peak ≤ 0.5`);
}

// ── Gallery timeline ─────────────────────────────────────────────────────────
{
  const H = 1000; // arbitrary innerHeight for the pure mapping
  const animY = ((SCROLL_TRACK_VH - 100) / 100) * H;
  const galleryPx = (GALLERY_TRACK_VH / 100) * H;

  // gp is 0 at/under the animation track end, 1 at the document bottom. The
  // scrollY → gp mapping is PIECEWISE: the video-card phase gp[0, VID_FLY_END]
  // rides its own short track (so the morph isn't sluggish), the image gallery
  // gp[VID_FLY_END, 1] rides the rest. Continuous (gp = VID_FLY_END) at the seam.
  const videoCardPx = (VIDEO_CARD_TRACK_VH / 100) * H;
  const imagePx = (IMAGE_GALLERY_TRACK_VH / 100) * H;
  eq(galleryProgressFrom(animY, H), 0, "gp = 0 at anim track end");
  eq(galleryProgressFrom(animY - 500, H), 0, "gp clamps to 0 above gallery");
  eq(galleryProgressFrom(animY + galleryPx, H), 1, "gp = 1 at document bottom");
  ok(Math.abs(videoCardPx + imagePx - galleryPx) < 1e-6, "the two sub-tracks sum to the gallery track");
  eq(galleryProgressFrom(animY + videoCardPx, H), VID_FLY_END, "gp = VID_FLY_END at the video-card/image seam");
  eq(galleryProgressFrom(animY + videoCardPx / 2, H), VID_FLY_END / 2, "gp linear within the video-card track");
  eq(
    galleryProgressFrom(animY + videoCardPx + imagePx / 2, H),
    VID_FLY_END + 0.5 * (1 - VID_FLY_END),
    "gp linear within the image track",
  );
  ok(
    galleryProgressFrom(animY + galleryPx * 0.9, H) >
      galleryProgressFrom(animY + galleryPx * 0.1, H),
    "gp monotonic across the gallery",
  );

  // Backdrop: 0 at gp 0, 1 by BACKDROP_FADE_END, stays opaque after.
  eq(galleryBackdropFor(0), 0, "backdrop 0 at gp 0");
  eq(galleryBackdropFor(BACKDROP_FADE_END), 1, "backdrop fully in by fade end");
  eq(galleryBackdropFor(1), 1, "backdrop stays opaque after fade");

  // Title frac: 0 before titles start, reaches 1 at TITLES_END, holds at 1 after.
  eq(galleryTitleFracFor(BACKDROP_FADE_END), 0, "title frac 0 at titles start");
  eq(galleryTitleFracFor(TITLES_END), 1, "title frac 1 at TITLES_END");
  eq(galleryTitleFracFor(0.95), 1, "title frac holds at 1 after TITLES_END");
  ok(galleryTitleFracFor(0.4) > galleryTitleFracFor(0.2), "title frac is monotonic");

  // Conveyor: span 0→1 over [BACKDROP_FADE_END, CTA_START]; lead reaches N (empty) at CTA_START.
  const N = GALLERY_IMAGES.length;
  eq(cardConveyorFor(BACKDROP_FADE_END).lead, 0, "conveyor starts at lead 0");
  ok(cardConveyorFor(CTA_START).lead >= N, "conveyor empty (lead ≥ N) at CTA_START");
  ok(cardConveyorFor(0.4).span > cardConveyorFor(0.2).span, "conveyor span is monotonic");
  ok(
    cardConveyorFor(0.4).local >= 0 && cardConveyorFor(0.4).local < 1,
    "conveyor local in [0,1)",
  );

  // CTA: the wordmark hides UNDER the last card and is UNCOVERED as the card
  // flies up. The VISIBLE reveal is a clip line following the card's lowest
  // projected corner (CardStack → ctaClipRef → GalleryCTA's clip-path).
  // galleryCtaFromExit is only the overlay's opacity gate:
  // it snaps 0→1 over the tiny onset window [CTA_REVEAL_FROM, CTA_REVEAL_TO],
  // while the text is still fully clipped behind the card (first uncover is at
  // exit ≈0.16), so the text is already at FULL opacity when the edge reaches
  // it — never a translucent fade.
  {
    const gpForLin = (lin: number) => {
      const igp =
        CARDS_FLY_START + (lin / N) * (CARDS_FLY_END - CARDS_FLY_START);
      return IMAGE_GALLERY_START + igp * (1 - IMAGE_GALLERY_START);
    };
    // cardExit exactly as CardStack derives it each frame.
    const exitAt = (gp: number) =>
      Math.min(Math.max(galleryStackDisplayedFor(gp) - (N - 1), 0), 1);
    eq(galleryCtaFromExit(0), 0, "CTA hidden while cards present");
    eq(galleryCtaFromExit(CTA_REVEAL_FROM), 0, "CTA hidden until the reveal window");
    eq(galleryCtaFromExit(CTA_REVEAL_TO), 1, "CTA fully in by the end of the reveal window");
    eq(galleryCtaFromExit(1), 1, "CTA fully in once last card has flown");
    ok(
      galleryCtaFromExit(CTA_REVEAL_FROM + 0.75 * (CTA_REVEAL_TO - CTA_REVEAL_FROM)) >
        galleryCtaFromExit(CTA_REVEAL_FROM + 0.25 * (CTA_REVEAL_TO - CTA_REVEAL_FROM)),
      "CTA fades in across the reveal window",
    );
    // Integration through gp: hidden while the last card settles and holds,
    // fully in by the time it has flown, monotonic throughout.
    eq(
      galleryCtaFromExit(exitAt(gpForLin(N - 1))), 0,
      "CTA still hidden as the last card settles",
    );
    eq(
      galleryCtaFromExit(exitAt(gpForLin(N - 1 + STEP_HOLD_FRAC))), 0,
      "CTA still hidden through the last card's hold (covered by the card)",
    );
    ok(
      galleryCtaFromExit(exitAt(gpForLin(N))) >= 1 - 1e-9,
      "CTA fully in once the last card has flown",
    );
    eq(galleryCtaFromExit(exitAt(1)), 1, "CTA fully in at the document bottom");
    {
      let prevOp = -1;
      for (let gp = 0; gp <= 1.0001; gp += 0.002) {
        const op = galleryCtaFromExit(exitAt(gp));
        ok(op >= prevOp - 1e-9, `CTA reveal monotonic @gp=${gp.toFixed(3)}`);
        prevOp = op;
      }
    }
  }

  // Round 3 — retimed fly window: 0 through the first-card linger, 1 by fly end.
  eq(cardFlyProgressFor(CARDS_FLY_START), 0, "fly progress 0 at fly start");
  eq(cardFlyProgressFor(0.05), 0, "fly progress 0 during the first-card linger");
  eq(cardFlyProgressFor(CARDS_FLY_END), 1, "fly progress 1 by fly end");
  ok(cardFlyProgressFor(0.5) > cardFlyProgressFor(0.35), "fly progress monotonic");
  // First card has flown by the time text 1 is readable (title frac ≈ 0.5).
  {
    const gpText1 = BACKDROP_FADE_END + 0.5 * (TITLES_END - BACKDROP_FADE_END);
    ok(Math.round(cardFlyProgressFor(gpText1) * N) >= 1, "first card gone once text 1 readable");
  }
  // Round 3 — title fade is now driven by the last card's exit progress (a
  // stateful, eased value in CardStack), so the title and card leave in exact
  // lockstep. That coupling is verified visually, not here. Ordering invariants:
  ok(BACKDROP_FADE_END < CARDS_FLY_START && CARDS_FLY_START < TITLES_END, "fly start sits inside the card phase");
  ok(CARDS_FLY_END <= CTA_START, "last card finishes by the CTA");

  // Piece B — title sequence by unified card progress `cp ∈ [0,9]` (card 1 =
  // video, cards 2..9 = image cards). Continuous at the video→image handoff:
  // both branches give cp = 1 at gp = VID_FLY_END.
  eq(galleryCardProgressFor(0), 0, "cp = 0 at gallery start");
  eq(galleryCardProgressFor(VID_FLY_END), 1, "cp = 1 at the video-card handoff");
  ok(
    Math.abs(galleryCardProgressFor(VID_FLY_END - 1e-6) - galleryCardProgressFor(VID_FLY_END)) < 1e-3,
    "cp continuous across gp = VID_FLY_END",
  );
  eq(galleryCardProgressFor(1), 1 + GALLERY_IMAGES.length, "cp = 1 + N at the document bottom");
  {
    let prev = -1;
    for (let gp = 0; gp <= 1.0001; gp += 0.002) {
      const cp = galleryCardProgressFor(gp);
      ok(cp >= prev - 1e-9, `cp monotonic @gp=${gp.toFixed(3)}`);
      prev = cp;
    }
  }

  // galleryTitleFrameFracForCard: the per-card frac mapping. Holds land on the
  // comp's CLEAN frames (50 = settled pair, 90 = static finale) so the texts
  // never sit in a half-overlapped state. Anchors + holds + monotonic.
  eq(galleryTitleFrameFracForCard(0), 0, "title frac 0 at cp 0");
  eq(titleFrame(galleryTitleFrameFracForCard(1)), 50, "title frame = clean STRATEGISCHE once card 1 is in");
  eq(titleFrame(galleryTitleFrameFracForCard(3)), 50, "title frame holds clean STRATEGISCHE over cards 2,3");
  eq(titleFrame(galleryTitleFrameFracForCard(4)), 90, "title frame = clean MULTIDISZIPLINÄRE finale once card 4 is in");
  eq(titleFrame(galleryTitleFrameFracForCard(9)), 90, "title frame holds the finale to the end");
  {
    let prev = -1;
    for (let cp = -0.5; cp <= 9.5; cp += 0.01) {
      const f = galleryTitleFrameFracForCard(cp);
      ok(f >= prev - 1e-9, `title frac monotonic @cp=${cp.toFixed(2)}`);
      prev = f;
    }
  }

  console.log("✓ gallery timeline");
}

// ── Video-card morph (slide #1 is the morphing FPV video) ────────────────────
{
  // videoMasterTimeFor: continuous + monotonic across the sp → gp boundary.
  eq(videoMasterTimeFor(VIDEO_START, 0, "scroll"), 0, "vmt 0 at VIDEO_START");
  eq(videoMasterTimeFor(1, 0, "scroll"), VIDEO_SPLIT, "vmt = VIDEO_SPLIT at sp=1 / gp=0");
  eq(videoMasterTimeFor(1, VID_FLY_END, "scroll"), 1, "vmt = 1 when the card flies out");
  ok(videoMasterTimeFor(1, VID_FLY_END + 0.2, "scroll") === 1, "vmt clamps at 1 after fly");
  eq(videoMasterTimeFor(1, 1, "done"), 1, "vmt done: frozen last frame");
  ok(
    Math.abs(videoMasterTimeFor(1, 0, "scroll") - videoMasterTimeFor(1, 1e-9, "scroll")) < 1e-3,
    "vmt continuous across the seam",
  );
  {
    let prev = -1;
    for (let sp = VIDEO_START; sp <= 1.0001; sp += 0.001) {
      const t = videoMasterTimeFor(sp, 0, "scroll");
      ok(t >= prev - 1e-9, `vmt monotonic (anim) @sp=${sp}`);
      prev = t;
    }
    for (let gp = 0; gp <= VID_FLY_END + 1e-9; gp += 0.001) {
      const t = videoMasterTimeFor(1, gp, "scroll");
      ok(t >= prev - 1e-9, `vmt monotonic (gallery) @gp=${gp}`);
      prev = t;
    }
  }

  // Caption dwell (anim track is piecewise, not linear): the dwells cover ONLY
  // the READABLE text windows (2026-07-29 round — no brake while caption 1 is
  // still behind the clouds, none once either caption is too close to read),
  // and inside them the slope is 0.5 clip-frac per 1000vh of scroll (0.3 read
  // as jerky — ≈11vh per source frame) — vs the ≈4.7 scenic pace, an ≈9×
  // contrast. Caption 1's onset stays pinned AFTER the Lottie zoom-through has
  // cleared (LOTTIE_END).
  {
    const vh = (v: number) => v / SCROLL_TRACK_VH; // physical scroll → sp
    const slope = (sp: number, h = 0.005) =>
      (videoMasterTimeFor(sp + h, 0, "scroll") - videoMasterTimeFor(sp, 0, "scroll")) / h;
    // Slope in clip-frac per 1000vh (the units of the dwell "0.5" dial).
    const slopePerKvh = (sp: number, h?: number) =>
      slope(sp, h) * (1000 / SCROLL_TRACK_VH);
    const clouds = slopePerKvh(vh(546.5), 0.002); // caption 1 on screen but still IN the clouds
    const cap1 = slopePerKvh(vh(650)); // inside caption-1's readable dwell [551.8, 769.8]vh
    const scenic = slopePerKvh(vh(800)); // scenic run [769.8, 843.1]vh
    const cap2 = slopePerKvh(vh(1000)); // inside caption-2's readable dwell [843.1, 1228.5]vh
    ok(Math.abs(cap1 - 0.5) < 0.02, `caption-1 dwell slope ≈0.5 per 1000vh (got ${cap1.toFixed(3)})`);
    ok(Math.abs(cap2 - 0.5) < 0.02, `caption-2 dwell slope ≈0.5 per 1000vh (got ${cap2.toFixed(3)})`);
    ok(cap1 < scenic * 0.15, "caption 1 scrubs ≥6× slower than the scenic run");
    ok(cap2 < scenic * 0.15, "caption 2 scrubs ≥6× slower than the scenic run");
    ok(clouds > cap1 * 3, "NO dwell while caption 1 is still behind the clouds");
    const cap1OnsetSp = 545.6 / SCROLL_TRACK_VH; // knot: clip frac 0.11 (caption 1 fades in, in clouds)
    ok(cap1OnsetSp >= LOTTIE_END, "caption 1 onset after the zoom-through clears");
    eq(videoMasterTimeFor(cap1OnsetSp, 0, "scroll"), 0.11, "caption-1 onset knot anchored");
    // Readable-window anchors (measured on the frame sequence, see playback.ts).
    eq(videoMasterTimeFor(vh(551.8), 0, "scroll"), 0.139, "caption-1 dwell starts out of the clouds");
    eq(videoMasterTimeFor(vh(769.8), 0, "scroll"), 0.248, "caption-1 dwell releases at the camera dive");
    eq(videoMasterTimeFor(vh(843.1), 0, "scroll"), 0.592, "caption-2 dwell starts when the text is readable");
    eq(videoMasterTimeFor(vh(1228.5), 0, "scroll"), 0.786, "caption-2 dwell releases when too close to read");
  }

  // imageGalleryProgress: 0 through the morph + hold, opens at IMAGE_GALLERY_START
  // (before the video card finishes flying, so slide #2 rises in with no black gap).
  eq(imageGalleryProgress(0), 0, "igp 0 at gallery start");
  eq(imageGalleryProgress(IMAGE_GALLERY_START), 0, "igp 0 until the image gallery opens");
  ok(imageGalleryProgress(IMAGE_GALLERY_START - 0.01) === 0, "igp still 0 during the hold");
  ok(IMAGE_GALLERY_START < VID_FLY_END, "image gallery opens before the video card finishes flying");
  ok(imageGalleryProgress(VID_FLY_END) > 0, "image gallery has begun by fly end (no black gap)");
  eq(imageGalleryProgress(1), 1, "igp 1 at document bottom");
  ok(imageGalleryProgress(0.7) > imageGalleryProgress(0.5), "igp monotonic");

  // The image-card stack stays hidden during the vertical video crop, then
  // reveals by sliding out from the centre under the almost-card-shaped video.
  eq(imageStackVisibleFor(0), 0, "image stack hidden at exact gallery start");
  eq(imageStackVisibleFor(0.05), 0, "image stack hidden during vertical crop");
  eq(imageStackRevealFor(0.1), 0, "image stack reveal starts after vertical crop");
  ok(
    imageStackRevealFor((0.1 + VID_MORPH_END) / 2) > 0 &&
      imageStackRevealFor((0.1 + VID_MORPH_END) / 2) < 1,
    "image stack slides out from centre during late morph",
  );
  eq(imageStackRevealFor(VID_MORPH_END), 1, "image stack fully placed by morph end");
  eq(imageStackVisibleFor(VID_MORPH_END), 1, "image stack visible once reveal completes");

  // Video-card handoff: the video is virtual card 0 at centre; image cards are
  // already staged behind it with virtual indices 1..N, so the first image card
  // takes the upper-left slot after the video flies away.
  eq(videoCardExitProgressFor(0), 0, "video card exit 0 at gallery start");
  eq(videoCardExitProgressFor(VID_HOLD_END), 0, "video card exit 0 through hold");
  eq(videoCardExitProgressFor(VID_FLY_END), 1, "video card exit 1 at fly end");
  ok(
    videoCardExitProgressFor((VID_HOLD_END + VID_FLY_END) / 2) > 0,
    "video card exit progresses during fly",
  );

  // galleryStackDisplayedFor: the video is virtual card 0. While it forms/holds at
  // d0 the front-card position is −1, so image card 0 (d = 0 − (−1) = 1) sits one
  // slot back at d1 (upper-left "position #2") — NOT directly behind the video.
  // As the video flies away it ramps −1→0, sliding image card 0 into the front d0.
  eq(galleryStackDisplayedFor(VID_MORPH_END), -1, "image card 0 staged at d1 while the video holds (morph end)");
  eq(galleryStackDisplayedFor(VID_HOLD_END), -1, "image card 0 still at d1 through the hold");
  eq(galleryStackDisplayedFor(VID_FLY_END), 0, "image card 0 has reached the front d0 once the video has flown");
  ok(
    galleryStackDisplayedFor((VID_HOLD_END + VID_FLY_END) / 2) > -1 &&
      galleryStackDisplayedFor((VID_HOLD_END + VID_FLY_END) / 2) < 0,
    "image card 0 slides d1→d0 as the video flies",
  );
  ok(
    Math.abs(galleryStackDisplayedFor(VID_FLY_END - 1e-6) - galleryStackDisplayedFor(VID_FLY_END)) < 1e-3,
    "galleryStackDisplayedFor continuous across gp = VID_FLY_END",
  );
  {
    let prev = -2;
    for (let gp = 0; gp <= 1.0001; gp += 0.001) {
      const d = galleryStackDisplayedFor(gp);
      ok(d >= prev - 1e-9, `galleryStackDisplayedFor monotonic @gp=${gp.toFixed(3)}`);
      prev = d;
    }
  }
  // Gallery layout: the PDF's 96vh × 64vh block is the OUTER frame. The actual
  // visible cards sit inside that frame with a >=6% reveal gap, so all three
  // layered slots read as separate cards inside the red reference rectangle.
  {
    const expectedFill = 0.94;
    const slotEdgeOffset = (1 - expectedFill) / (2 * expectedFill);
    eq(CARD_FILL, expectedFill, "image/video cards leave a visible reveal gap inside the outer gallery frame");

    const front = cardStackPlacementFor(0);
    eq(front.x, 0, "front/green card is centered horizontally inside the outer frame");
    eq(front.y, -slotEdgeOffset, "front/green card aligns to the bottom edge");
    eq(front.z, 0, "front card at z 0");
    eq(front.scale, 1, "front card full scale");
    const back1 = cardStackPlacementFor(1);
    eq(back1.x, -slotEdgeOffset, "2nd/blue card aligns to the left edge");
    eq(back1.y, slotEdgeOffset, "2nd/blue card aligns to the top edge");
    ok(back1.z < 0, "2nd card recedes in z");
    eq(back1.scale, 1, "2nd/blue card keeps the same size inside the frame");
    const back2 = cardStackPlacementFor(2);
    eq(back2.x, slotEdgeOffset, "3rd/yellow card aligns to the right edge");
    eq(back2.y, slotEdgeOffset / 2, "3rd/yellow card sits slightly above midpoint toward the 2nd card");
    ok(back2.z < back1.z, "3rd card recedes further than the 2nd");
    eq(back2.scale, 1, "3rd/yellow card keeps the same size inside the frame");
    ok(back2.x > front.x, "3rd/yellow card extends past the front card on the right");
    ok(back2.y > front.y, "3rd/yellow card sits above the front card");
    eq(
      back2.x + back2.scale / 2 - (front.x + front.scale / 2),
      slotEdgeOffset,
      "3rd/yellow right side remains visible beyond the front card",
    );
    eq(front.x - back1.x, slotEdgeOffset, "2nd/blue left side remains visible beyond the front card");
    ok(STACK_VISIBLE >= 1 && STACK_VISIBLE <= 3, "only a few background cards visible");
    const outerHalfInCardUnits = 1 / (2 * expectedFill);
    for (const [label, p] of [
      ["front", front],
      ["back1", back1],
      ["back2", back2],
    ] as const) {
      const half = 0.5 * p.scale;
      ok(p.x - half >= -outerHalfInCardUnits - 1e-9, `${label} left edge stays inside outer frame`);
      ok(p.x + half <= outerHalfInCardUnits + 1e-9, `${label} right edge stays inside outer frame`);
      ok(p.y - half >= -outerHalfInCardUnits - 1e-9, `${label} bottom edge stays inside outer frame`);
      ok(p.y + half <= outerHalfInCardUnits + 1e-9, `${label} top edge stays inside outer frame`);
    }
    // Leaving front card (negative depth) clamps to the front placement here;
    // CardStack adds the upward rise on top.
    eq(cardStackPlacementFor(-0.5).x, front.x, "leaving card keeps the front-slot x");
    eq(cardStackPlacementFor(-0.5).y, front.y, "leaving card keeps the front-slot y");

    const phoneAspect = 390 / 844;
    const portraitCardAspect = (CARDS_WIDTH_VW_PORTRAIT * phoneAspect) / CARDS_VH;
    const climberFocus = galleryImageFocusFor("gallery/bilder_1_rs.jpeg");
    const climberCrop = coverCropWindowFor(portraitCardAspect, CARD_ASPECT, climberFocus);
    ok(climberFocus.x > 0.65, "climber photo has a right-biased mobile focal point");
    ok(climberCrop.u0 > 0.45, "mobile climber crop shifts right instead of staying centered");
    ok(climberCrop.u1 <= 1, "mobile climber crop remains inside the image");
  }

  // videoCardMorphFor: endpoints + crop collapses full → card, top-first.
  const aspect = 0.5; // portrait phone
  const card = cardScreenRect(aspect);
  eq(card.t - card.b, CARDS_VH * CARD_FILL, "video card rect height matches inner card height");
  eq(card.r - card.l, CARDS_WIDTH_VW_PORTRAIT * CARD_FILL, "portrait video card rect width matches inner card width");
  {
    const landscapeAspect = 16 / 9;
    const landscape = cardScreenRect(landscapeAspect);
    eq(
      landscape.r - landscape.l,
      (CARDS_VH * CARD_FILL * CARD_ASPECT) / landscapeAspect,
      "landscape video card rect width matches inner card width",
    );
    const outerCy = 1 - (2 * GUTTER + TOP_TITLE_VH + CARDS_VH / 2);
    const outerW = (CARDS_VH * CARD_ASPECT) / landscapeAspect;
    const outerLeft = 0.5 - outerW / 2;
    const outerRight = 0.5 + outerW / 2;
    const outerBottom = outerCy - CARDS_VH / 2;
    const outerTop = outerCy + CARDS_VH / 2;
    ok(landscape.r < outerRight, "video/front card leaves room for the 3rd card on the right");
    eq(landscape.b, outerBottom, "video/front card bottom edge aligns with the outer frame");
    ok(landscape.l > outerLeft, "video/front card leaves visible inset on the left");
    ok(landscape.t < outerTop, "video/front card leaves visible inset on top");
  }
  const m0 = videoCardMorphFor(0, aspect);
  eq(m0.crop.l, 0, "morph full-bleed left @gp0");
  eq(m0.crop.t, 1, "morph full-bleed top @gp0");
  eq(m0.opacity, 1, "morph opaque @gp0");
  // Morph completes (crop == card rect) by VID_MORPH_END, and holds there.
  for (const gp of [VID_MORPH_END, VID_HOLD_END]) {
    const m = videoCardMorphFor(gp, aspect);
    eq(m.crop.l, card.l, `morph crop = card left @gp=${gp}`, 1e-9);
    eq(m.crop.r, card.r, `morph crop = card right @gp=${gp}`, 1e-9);
    eq(m.crop.b, card.b, `morph crop = card bottom @gp=${gp}`, 1e-9);
    eq(m.crop.t, card.t, `morph crop = card top @gp=${gp}`, 1e-9);
  }
  const mHold = videoCardMorphFor(VID_HOLD_END, aspect);
  eq(mHold.rise, 0, "no rise during the hold");
  eq(mHold.opacity, 1, "opaque during the hold");
  eq(mHold.radius, 1, "fully rounded by the hold");
  // THREE discrete crop steps (top → bottom → sides), matching the reference:
  {
    // Step 1 (gp 0.03): only the TOP crops; bottom + sides still full.
    const s1 = videoCardMorphFor(0.03, aspect);
    ok(1 - s1.crop.t > 0, "step 1: top edge cropping");
    eq(s1.crop.b, 0, "step 1: bottom still full");
    ok(s1.crop.l === 0 && s1.crop.r === 1, "step 1: width still full");
    // Step 2 (gp 0.10): top done, BOTTOM crops, sides STILL full (letterbox band).
    const s2 = videoCardMorphFor(0.1, aspect);
    eq(s2.crop.t, card.t, "step 2: top edge fully at card top", 1e-6);
    ok(s2.crop.b > 0 && s2.crop.b < card.b, "step 2: bottom mid-crop");
    ok(s2.crop.l === 0 && s2.crop.r === 1, "step 2: width STILL full during the bottom crop");
    // Step 3 (gp 0.145): bottom done, SIDES crop in.
    const s3 = videoCardMorphFor(0.145, aspect);
    eq(s3.crop.b, card.b, "step 3: bottom edge fully at card bottom", 1e-6);
    ok(s3.crop.l > 0, "step 3: left side cropping in");
    ok(s3.crop.r < 1, "step 3: right side cropping in");
    ok(s3.radius > 0, "step 3: corners rounding");
  }
  // Fly-out: the card flies straight UP off the top, staying FULLY OPAQUE (no
  // dissolve — matches the image cards); the clip reaches its last frame as it
  // flies. It is hidden off `visible` (flown), not off opacity.
  const mMidFly = videoCardMorphFor((VID_HOLD_END + VID_FLY_END) / 2, aspect);
  eq(mMidFly.opacity, 1, "opaque mid-fly (no dissolve)");
  ok(mMidFly.rise > 0, "rising mid-fly");
  const mFly = videoCardMorphFor(VID_FLY_END, aspect);
  eq(mFly.opacity, 1, "morph stays opaque through the fly-out (no fade)");
  ok(mFly.rise > mMidFly.rise, "morph still rising to fly end");
  // Risen far enough that the card's bottom edge has cleared the top of frame.
  ok(mFly.rise + card.b > 1, "risen card has fully cleared the top of the frame");
  ok(!mFly.visible, "morph invisible once flown (gp ≥ VID_FLY_END)");

  // Morph crop is a screen-space mask over the full-screen video only while the
  // rect is actively changing. Once the card is formed, the real card mesh takes
  // over to avoid full-screen shader overdraw during the hold/fly.
  ok(!videoUsesScreenClipFor(0), "screen clip is off before the gallery morph starts");
  ok(videoUsesScreenClipFor(0.03), "screen clip drives the top-crop morph");
  ok(!videoUsesScreenClipFor(0.03, true), "conservative browsers avoid full-screen screen clip during top-crop");
  ok(!videoUsesScreenClipFor(VID_MORPH_END), "screen clip turns off once card-shaped");
  ok(!videoUsesScreenClipFor(VID_MORPH_END, true), "conservative browsers keep the video crop on the real mesh once card-shaped");
  ok(!videoUsesScreenClipFor((VID_MORPH_END + VID_HOLD_END) / 2), "screen clip stays off while the formed video card holds");
  ok(!videoUsesScreenClipFor(VID_HOLD_END), "screen clip stays off at the fly-up trigger");
  ok(!videoUsesScreenClipFor((VID_HOLD_END + VID_FLY_END) / 2), "screen clip stays off while the video card flies");
  ok(!videoUsesScreenClipFor(VID_FLY_END), "screen clip turns off only after the video card is gone");

  console.log("✓ video-card morph");
}

// ── Stepped conveyor + hold-aligned titles ("never a text change AND a card
//    fly-away at once") ───────────────────────────────────────────────────────
{
  // The opening titles settle with the morph steps, then HOLD through the fly.
  eq(galleryTitleFrameFor(0), 0, "title 0 at gallery start");
  ok(!galleryTitlesVisibleFor(0, 0), "gallery titles do not draw before the gallery starts");
  ok(galleryTitlesVisibleFor(0.001, 0), "gallery titles draw during the video-card title phase");
  ok(galleryTitlesVisibleFor(0.9, 0.5), "gallery titles stay visible while exiting");
  ok(!galleryTitlesVisibleFor(0.9, 1), "gallery titles stop drawing once they are fully off-screen");
  ok(galleryTitleFrameFor(0.05) > 0, "WIR LIEFERN animating in during the top crop");
  ok(
    galleryTitleFrameFor(VID_MORPH_END) > galleryTitleFrameFor(0.05),
    "STRATEGISCHE settles by the morph end",
  );
  // Held flat across the video card's hold + fly (no text change while it flies).
  const tHold = galleryTitleFrameFor(VID_MORPH_END);
  eq(titleFrame(tHold), 50, "opening title freezes on clean frame 50");
  for (const gp of [VID_HOLD_END, (VID_HOLD_END + VID_FLY_END) / 2, VID_FLY_END - 1e-4]) {
    eq(galleryTitleFrameFor(gp), tHold, `title held flat through hold+fly @gp=${gp}`, 1e-6);
  }

  // The conveyor holds at integers (settled) then ramps (flies).
  const dispMono = (() => {
    let prev = -1;
    for (let i = 0; i <= 1000; i++) {
      const d = cardConveyorDisplayedFor(i / 1000);
      if (d < prev - 1e-9) return false;
      prev = d;
    }
    return true;
  })();
  ok(dispMono, "stepped conveyor is monotonic non-decreasing");

  // THE invariant: wherever a card is mid-fly (conveyor local in (0.1, 0.9)), the
  // title frac must be FLAT — a text change and a fly-away never coincide.
  {
    let maxFlipDelta = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const gp = VID_FLY_END + (i / N) * (1 - VID_FLY_END);
      const igp = imageGalleryProgress(gp);
      const disp = cardConveyorDisplayedFor(igp);
      const local = disp - Math.floor(disp);
      if (local > 0.1 && local < 0.9) {
        const d = Math.abs(galleryTitleFrameFor(gp + 5e-4) - galleryTitleFrameFor(gp));
        if (d > maxFlipDelta) maxFlipDelta = d;
      }
    }
    ok(
      maxFlipDelta < 1e-4,
      `title frac flat while any card flies (max Δ ${maxFlipDelta.toExponential(2)})`,
    );
  }
  {
    const gpForLin = (lin: number) => {
      const igp =
        CARDS_FLY_START +
        (lin / GALLERY_IMAGES.length) * (CARDS_FLY_END - CARDS_FLY_START);
      return IMAGE_GALLERY_START + igp * (1 - IMAGE_GALLERY_START);
    };
    // The SINGLE mid-gallery swap (pair → bottom-only finale) plays inside
    // image card 2's hold window and lands on the comp's static finale (f90).
    eq(titleFrame(galleryTitleFrameFor(gpForLin(2))), 50, "pair still clean at the swap card's settle");
    eq(titleFrame(galleryTitleFrameFor(gpForLin(3))), 90, "finale title freezes on clean frame 90");
    eq(titleFrame(galleryTitleFrameFor(gpForLin(6))), 90, "finale title held to the end");
    ok(isGalleryTitleHoldFrame(galleryTitleFrameFor(gpForLin(3))), "finale clean frame is detected as a hold");
    ok(
      !isGalleryTitleHoldFrame(galleryTitleFrameFor(gpForLin(2.25))),
      "transition frames are not detected as holds",
    );

    // End layout (cards ease up + scale 15% for the bottom-only finale): rides
    // EXACTLY the title-swap hold window, then persists to the end.
    eq(galleryEndLayoutFor(0), 0, "end layout off at gallery start");
    eq(galleryEndLayoutFor(gpForLin(2)), 0, "end layout off until the swap");
    ok(
      galleryEndLayoutFor(gpForLin(2.25)) > 0 && galleryEndLayoutFor(gpForLin(2.25)) < 1,
      "end layout ramps during the swap hold",
    );
    eq(galleryEndLayoutFor(gpForLin(2.5)), 1, "end layout settled once the finale text is in");
    eq(galleryEndLayoutFor(1), 1, "end layout persists to the document bottom");
    {
      let prevE = -1;
      for (let gp = 0; gp <= 1.0001; gp += 0.002) {
        const e = galleryEndLayoutFor(gp);
        ok(e >= prevE - 1e-9, `end layout monotonic @gp=${gp.toFixed(3)}`);
        prevE = e;
      }
    }
  }
  {
    const galleryTitlesSource = readFileSync(new URL("../src/components/GalleryTitles.tsx", import.meta.url), "utf8");
    ok(/TITLE_SPLIT_GUARD/.test(galleryTitlesSource), "GalleryTitles guards the split UV seam");
    ok(
      !/remapV\(topGeometry,\s*0\.5,\s*1\)/.test(galleryTitlesSource) &&
        !/remapV\(bottomGeometry,\s*0,\s*0\.5\)/.test(galleryTitlesSource),
      "GalleryTitles does not sample exactly on the v=0.5 split seam",
    );
    ok(/TITLE_EXIT_OVERSCAN/.test(galleryTitlesSource), "GalleryTitles pushes exiting title planes past the viewport edge");
  }
  console.log("✓ stepped conveyor + hold-aligned titles");
}

// ── Frame-sequence scrub ─────────────────────────────────────────────────
{
  const videoPlaneParallaxSource = readFileSync(new URL("../src/components/VideoPlane.tsx", import.meta.url), "utf8");
  ok(!/addEventListener\("pointermove"/.test(videoPlaneParallaxSource), "VideoPlane has no pointer parallax listener");
  ok(!/Card-form parallax/.test(videoPlaneParallaxSource), "video card does not run hover parallax");

  // ── Frame-sequence scrub (replaces the HTMLVideoElement; see src/frames.ts) ──
  eq(frameIndexFor(0, 295), 0, "frame index: clip start → frame 0");
  eq(frameIndexFor(1, 295), 294, "frame index: clip end → last frame");
  eq(frameIndexFor(0.5, 295), 147, "frame index: midpoint rounds to the middle frame");
  eq(frameIndexFor(-1, 295), 0, "frame index clamps below 0");
  eq(frameIndexFor(2, 295), 294, "frame index clamps above the last frame");
  eq(frameIndexFor(0.5, 1), 0, "degenerate single-frame sequence stays on frame 0");
  eq(frameTierFor(390), 1280, "narrow phones get the lighter 1280px frame tier");
  eq(frameTierFor(899.98), 1280, "the 899.98px breakpoint is inclusive of the mobile tier");
  eq(frameTierFor(900), 1920, "wider screens get the crisp 1920px frame tier");
  ok(
    frameUrl(1280, 0) === "/frames/1280/0001.webp",
    "frame URL is 1-indexed + zero-padded",
  );
  ok(
    frameUrl(1920, 294) === "/frames/1920/0295.webp",
    "frame URL maps the last index to the last file",
  );
  ok(FRAME_COUNT > 1, "frame manifest reports a real frame count");

  // Coarse-to-fine load order (spreads coverage across the whole clip first, so a
  // scroll that outruns the download never sticks on a single load frontier).
  {
    const order = buildCoarseToFineOrder(295);
    eq(order.length, 295, "coarse-to-fine order is a full permutation (length = count)");
    eq(new Set(order).size, 295, "coarse-to-fine order has no duplicates");
    eq(Math.min(...order), 0, "coarse-to-fine covers frame 0");
    eq(Math.max(...order), 294, "coarse-to-fine covers the last frame");
    eq(order[0], 0, "coarse-to-fine starts at frame 0 (the reveal start / loader gate)");
    eq(order[1], 294, "coarse-to-fine loads the far end second (spread the ends first)");
    const early = order.slice(0, 40).sort((a, b) => a - b);
    let maxGap = 0;
    for (let i = 1; i < early.length; i++) maxGap = Math.max(maxGap, early[i] - early[i - 1]);
    ok(maxGap <= 16, "first 40 frames are spread across the clip (max gap ≤16, not a sequential front)");
  }

  const videoPlaneSource = readFileSync(new URL("../src/components/VideoPlane.tsx", import.meta.url), "utf8");
  ok(
    /FrameSequenceLoader/.test(videoPlaneSource) &&
      /frameIndexFor\(/.test(videoPlaneSource) &&
      !/document\.createElement\("video"\)/.test(videoPlaneSource) &&
      !/\.currentTime\s*=/.test(videoPlaneSource),
    "VideoPlane scrubs the frame sequence (no <video> element / currentTime seeking)",
  );
  const scrollHookSrc = readFileSync(
    new URL("../src/hooks/useScrollProgress.ts", import.meta.url),
    "utf8",
  );
  const scrollHookCode = scrollHookSrc
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  ok(
    /createScrollTimelineController\s*\(/.test(scrollHookCode) &&
      /writeScrollTimelineRefs\s*\(/.test(scrollHookCode) &&
      !/addEventListener\s*\(/.test(scrollHookCode),
    "React hook delegates the event lifecycle to the executable controller",
  );
  const scrollControllerCode = readFileSync(
    new URL("../src/scrollTimelineController.ts", import.meta.url),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const sceneScrollCode = readFileSync(
    new URL("../src/components/Scene.tsx", import.meta.url),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  ok(
    /export\s+interface\s+ScrollTimelineRefs/.test(scrollHookCode) &&
      /export\s+function\s+useScrollTimelineRefs\s*\(\s*reducedMotion\s*:\s*boolean/.test(
        scrollHookCode,
      ),
    "one shared hook owns the scroll and gallery timeline refs",
  );
  ok(
    /virtualYRef/.test(scrollHookCode) &&
      /scrollRef/.test(scrollHookCode) &&
      /galleryRef/.test(scrollHookCode),
    "the shared hook publishes sp, gp, and its virtual cursor",
  );
  ok(
    /const\s+reducedMotionRef\s*=\s*useRef\(reducedMotion\)/.test(
      scrollHookCode,
    ) &&
      /reducedMotionRef\.current\s*=\s*reducedMotion/.test(scrollHookCode) &&
      /useEffect\(\(\)\s*=>\s*\{[\s\S]*\}\s*,\s*\[\]\s*\);/.test(
        scrollHookCode,
      ),
    "reduced-motion updates use a ref without rebuilding the event lifecycle",
  );
  const mainScrollEffect = sourceBlock(
    scrollHookCode,
    "useEffect(() => {",
    "shared scroll effect",
  );
  ok(
    /reducedMotion:\s*\(\)\s*=>\s*reducedMotionRef\.current/.test(
      mainScrollEffect,
    ),
    "controller reads the latest reduced-motion ref without listener churn",
  );
  ok(
    (scrollControllerCode.match(
      /\.addEventListener\(\s*["']scroll["']/g,
    ) ?? [])
      .length === 1 &&
      /PASSIVE_EVENT_OPTIONS\s*=\s*\{\s*passive:\s*true\s*\}/.test(
        scrollControllerCode,
      ) &&
      /windowTarget\.addEventListener\(\s*["']scroll["']\s*,\s*onScroll\s*,\s*PASSIVE_EVENT_OPTIONS/.test(
        scrollControllerCode,
      ),
    "one passive scroll listener atomically publishes both timelines",
  );
  const resizeBody = sourceBlock(
    scrollControllerCode,
    "const onResize:",
    "resize handler",
  );
  ok(
    /let\s+innerHeight\s*=\s*validViewportHeight\(\s*environment\.readInnerHeight\(\)/.test(
      scrollControllerCode,
    ) &&
      /let\s+logicalMaxY\s*=\s*scrollYForTimelineProgress\(\s*\{\s*sp:\s*1\s*,\s*gp:\s*1\s*\}\s*,\s*innerHeight\s*,?\s*\)/.test(
        scrollControllerCode,
      ) &&
      /let\s+lastWidth\s*=\s*environment\.readInnerWidth\(\)/.test(
        scrollControllerCode,
      ),
    "one cached logical timeline end follows the width-stable viewport height",
  );
  ordered(
    resizeBody,
    [
      "const currentWidth = environment.readInnerWidth()",
      "if (currentWidth === lastWidth)",
      "syncRawScrollPosition(state, environment.readScrollY())",
      "publishState()",
      "return",
      "lastWidth = currentWidth",
      "innerHeight = validViewportHeight(",
      "logicalMaxY = scrollYForTimelineProgress(",
    ],
    "height-only resize syncs physical bookkeeping before width recache",
  );
  ok(
    !/export\s+function\s+useScrollProgressRef/.test(scrollHookCode) &&
      !/export\s+function\s+useGalleryProgressRef/.test(scrollHookCode),
    "independent raw-scroll hooks are removed",
  );
  ok(
    /const\s*\{\s*scrollRef\s*,\s*galleryRef\s*\}\s*=\s*useScrollTimelineRefs\s*\(\s*reducedMotion\s*\)/.test(
      sceneScrollCode,
    ) &&
      (sceneScrollCode.match(/useScrollTimelineRefs\s*\(/g) ?? []).length === 1 &&
      /scrollRef=\{scrollRef\}/.test(sceneScrollCode) &&
      /galleryRef=\{galleryRef\}/.test(sceneScrollCode) &&
      !/useScrollProgressRef|useGalleryProgressRef/.test(sceneScrollCode),
    "Scene consumes the shared scroll hook exactly once",
  );

  const scrollingKeyBody = sourceBlock(
    scrollControllerCode,
    "function isScrollingKey",
    "scrolling-key filter",
  );
  const scrollingKeyArray = scrollingKeyBody.match(
    /return\s*\[([\s\S]*?)\]\.includes\(String\(event\.key\)\)/,
  );
  ok(scrollingKeyArray, "scrolling-key filter has an explicit key list");
  const scrollingKeys = [
    ...scrollingKeyArray[1].matchAll(/["']([^"']*)["']/g),
  ].map((match) => match[1]);
  ok(
    JSON.stringify(scrollingKeys) ===
      JSON.stringify([
        "ArrowUp",
        "ArrowDown",
        "PageUp",
        "PageDown",
        " ",
        "Spacebar",
        "Home",
        "End",
      ]),
    "scroll controller recognizes exactly the intended scrolling keys",
  );
  ok(
    /event\.defaultPrevented/.test(scrollingKeyBody) &&
      /event\.metaKey/.test(scrollingKeyBody) &&
      /event\.ctrlKey/.test(scrollingKeyBody) &&
      /event\.altKey/.test(scrollingKeyBody) &&
      /event\.shiftKey/.test(scrollingKeyBody) &&
      /isEditableTarget\(event\.target\)/.test(scrollingKeyBody) &&
      /isContentEditable/.test(scrollControllerCode) &&
      /input, textarea, select/.test(scrollControllerCode),
    "scrolling-key attribution rejects modified shortcuts and editable targets",
  );

  const burstQuietBody = sourceBlock(
    scrollControllerCode,
    "const endBurstAfterQuiet =",
    "burst quiet timer",
  );
  const wheelBody = sourceBlock(
    scrollControllerCode,
    "const onWheel:",
    "wheel burst",
  );
  const keyDownBody = sourceBlock(
    scrollControllerCode,
    "const onKeyDown:",
    "key burst",
  );
  ok(
    /(?:export\s+)?const\s+INPUT_QUIET_MS\s*=\s*120\s*;/.test(
      scrollControllerCode,
    ) &&
      /environment\.setTimeout\([\s\S]*INPUT_QUIET_MS\)/.test(
        burstQuietBody,
      ) &&
      /endBurstAfterQuiet\(\)/.test(wheelBody) &&
      /endBurstAfterQuiet\(\)/.test(keyDownBody),
    "wheel and key bursts finish after exactly 120ms of input quiet",
  );

  const refWriterBody = sourceBlock(
    scrollControllerCode,
    "export function writeScrollTimelineRefs",
    "timeline ref writer",
  );
  const publishStepBody = sourceBlock(
    scrollControllerCode,
    "const publishStep =",
    "reducer-step publish",
  );
  ok(
    /refs\.scrollRef\.current\s*=\s*values\.sp/.test(refWriterBody) &&
      /refs\.galleryRef\.current\s*=\s*values\.gp/.test(refWriterBody) &&
      /refs\.virtualYRef\.current\s*=\s*values\.virtualY/.test(refWriterBody) &&
      /const\s+timelineRefs\s*=\s*\{\s*scrollRef\s*,\s*galleryRef\s*,\s*virtualYRef\s*\}/.test(
        mainScrollEffect,
      ) &&
      /writeScrollTimelineRefs\(\s*timelineRefs\s*,\s*publication\s*\)/.test(
        mainScrollEffect,
      ),
    "one atomic publish path writes sp, gp, and virtualY",
  );
  ordered(
    publishStepBody,
    ["state = step.state", "publish(step.progress, step.discardedForwardPx)"],
    "reducer-step publication",
  );

  const onScrollBody = sourceBlock(
    scrollControllerCode,
    "const onScroll:",
    "scroll handler",
  );
  ok(
    /const\s+bypass\s*=\s*!hasExplicitAttribution\s*&&\s*!state\.suppressForward/.test(
      onScrollBody,
    ) &&
      /innerHeight\s*,/.test(onScrollBody) &&
      /maxScrollY:\s*safeDocumentEnd\(environment\)/.test(onScrollBody) &&
      /maxVirtualY:\s*logicalMaxY/.test(onScrollBody) &&
      /preserveVirtualOffset:\s*true/.test(onScrollBody) &&
      !/innerHeight:\s*environment\.readInnerHeight\(\)/.test(onScrollBody),
    "unattributed scrolls preserve the logical/physical offset within separate bounds",
  );
  ordered(
    onScrollBody,
    ["const bypass =", "applyScrollSample(", "publishStep(step)"],
    "scroll reducer flow",
  );
  ok(
    /if\s*\(\s*!state\.suppressForward\s*\)\s*return\s*;[\s\S]*armSuppressionQuiet\(\)\s*;[\s\S]*if\s*\(\s*step\.needsReanchor\s*\)\s*reanchor\(\)/.test(
      onScrollBody,
    ),
    "suppressed residual scroll rearms quiet and conditionally reanchors",
  );

  const finishBody = sourceBlock(
    scrollControllerCode,
    "const finishGesture =",
    "gesture finish",
  );
  const finishIfIdleBody = sourceBlock(
    scrollControllerCode,
    "const finishGestureIfIdle =",
    "idle gesture finish",
  );
  const reducedFinishBody = sourceBlock(
    scrollControllerCode,
    "const finishReducedMotionLifecycle =",
    "reduced-motion lifecycle finish",
  );
  const interruptedFinishBody = sourceBlock(
    scrollControllerCode,
    "const resetInterruptedGesture =",
    "interrupted gesture finish",
  );
  ok(
    /if\s*\(\s*touchActive\s*\|\|\s*burstActive\s*\|\|\s*!state\.gestureActive\s*\)\s*return/.test(
      finishIfIdleBody,
    ) &&
      /finishGesture\(quarantineRealGesture\)/.test(finishIfIdleBody) &&
      !/touchActive\s*=\s*false/.test(finishBody) &&
      !/burstActive\s*=\s*false/.test(finishBody),
    "touch and wheel/key modalities must both be idle before the gesture finishes",
  );
  ok(
    /if\s*\(\s*reducedMotion\(\)\s*\)\s*\{\s*finishReducedMotionLifecycle\(\)\s*;\s*return/.test(
      finishBody,
    ) &&
      /if\s*\(\s*reducedMotion\(\)\s*\)\s*\{\s*finishReducedMotionLifecycle\(\)\s*;\s*return/.test(
        interruptedFinishBody,
      ) &&
      /clearBurstEndTimer\(\)/.test(reducedFinishBody) &&
      /clearSuppressionQuietTimer\(\)/.test(reducedFinishBody) &&
      /clearExpectedReanchor\(\)/.test(reducedFinishBody) &&
      /touchActive\s*=\s*false/.test(reducedFinishBody) &&
      /burstActive\s*=\s*false/.test(reducedFinishBody) &&
      /rawY:\s*environment\.readScrollY\(\)/.test(reducedFinishBody) &&
      /maxScrollY:\s*safeDocumentEnd\(environment\)/.test(
        reducedFinishBody,
      ) &&
      /maxVirtualY:\s*logicalMaxY/.test(reducedFinishBody) &&
      /reducedMotion:\s*true/.test(reducedFinishBody) &&
      /bypass:\s*true/.test(reducedFinishBody) &&
      !/reanchor\(/.test(reducedFinishBody),
    "all reduced-motion terminals share a timer-free direct current-raw sync",
  );
  ok(
    /quarantineRealGesture\s*&&\s*!reducedMotion\(\)/.test(finishBody) &&
      /state\s*=\s*\{\s*\.\.\.state\s*,\s*suppressForward:\s*true\s*\}/.test(
        finishBody,
      ),
    "every real gesture receives an aligned-end forward quarantine",
  );
  ordered(
    finishBody,
    [
      "endScrollGesture(state, innerHeight)",
      "suppressForward: true",
      "publish(step.progress, step.discardedForwardPx)",
      "if (step.needsReanchor) reanchor()",
      "armSuppressionQuiet()",
    ],
    "gesture finish flow",
  );

  const reanchorBody = sourceBlock(
    scrollControllerCode,
    "const reanchor =",
    "reanchor",
  );
  ordered(
    reanchorBody,
    [
      "syncRawScrollPosition(state, targetY)",
      "setExpectedReanchor(targetY)",
      'environment.scrollTo({ top: targetY, behavior: "auto" })',
    ],
    "guarded reanchor flow",
  );
  ok(
    /if\s*\(\s*guardExpectedEvent\s*\)\s*setExpectedReanchor\(targetY\)/.test(
      reanchorBody,
    ) &&
      /expectedReanchorY\s*!==\s*null/.test(onScrollBody) &&
      /Math\.abs\(rawY\s*-\s*expectedY\)\s*<=\s*REANCHOR_TOLERANCE_PX/.test(
        onScrollBody,
      ),
    "the expected reanchor event is ignored only at its guarded target",
  );
  const scrollEndBody = sourceBlock(
    scrollControllerCode,
    "const onScrollEnd:",
    "scrollend guard",
  );
  ok(
    /selfReanchorPending/.test(scrollEndBody) &&
      /armSuppressionQuiet\(\)/.test(scrollEndBody) &&
      !/releaseSuppression\(\)/.test(scrollEndBody),
    "self-authored scrollend cannot synchronously release quarantine",
  );

  const registeredEvents = [
    ["windowTarget", "scroll", "onScroll"],
    ["windowTarget", "touchstart", "onTouchStart"],
    ["windowTarget", "touchend", "onTouchEnd"],
    ["windowTarget", "touchcancel", "onTouchEnd"],
    ["windowTarget", "wheel", "onWheel"],
    ["windowTarget", "keydown", "onKeyDown"],
    ["windowTarget", "scrollend", "onScrollEnd"],
    ["windowTarget", "resize", "onResize"],
    ["windowTarget", "blur", "resetInterruptedGesture"],
    ["documentTarget", "visibilitychange", "onVisibilityChange"],
  ] as const;
  const controllerBody = sourceBlock(
    scrollControllerCode,
    "export function createScrollTimelineController",
    "scroll controller factory",
  );
  const cleanupBody = sourceBlock(
    controllerBody,
    "dispose() {",
    "scroll controller disposal",
    true,
  );
  for (const [target, eventName, handler] of registeredEvents) {
    ok(
      new RegExp(
        `environment\\.${target}\\.addEventListener\\(\\s*["']${eventName}["']\\s*,\\s*${handler}`,
      ).test(controllerBody),
      `scroll controller registers ${target}.${eventName}`,
    );
    ok(
      new RegExp(
        `environment\\.${target}\\.removeEventListener\\(\\s*["']${eventName}["']\\s*,\\s*${handler}`,
      ).test(cleanupBody),
      `scroll controller removes ${target}.${eventName}`,
    );
  }
  const listenerPattern =
    /environment\.(windowTarget|documentTarget)\.(add|remove)EventListener\(\s*["']([^"']+)["']\s*,\s*(\w+)/g;
  const addedListeners: string[] = [];
  const removedListeners: string[] = [];
  for (const match of controllerBody.matchAll(listenerPattern)) {
    const listener = `${match[1]}.${match[3]}:${match[4]}`;
    (match[2] === "add" ? addedListeners : removedListeners).push(listener);
  }
  ok(
    JSON.stringify([...addedListeners].sort()) ===
      JSON.stringify([...removedListeners].sort()),
    "cleanup removes every listener registered by the shared effect",
  );
  for (const clearTimer of [
    "clearBurstEndTimer()",
    "clearSuppressionQuietTimer()",
    "clearExpectedReanchor()",
  ]) {
    ok(cleanupBody.includes(clearTimer), `cleanup calls ${clearTimer}`);
  }
  for (const [clearMarker, timerName] of [
    ["const clearBurstEndTimer =", "burstEndTimer"],
    ["const clearSuppressionQuietTimer =", "suppressionQuietTimer"],
    ["const clearExpectedReanchor =", "expectedReanchorTimer"],
  ] as const) {
    const clearBody = sourceBlock(
      scrollControllerCode,
      clearMarker,
      `${timerName} cleanup`,
    );
    ok(
      new RegExp(`clearTimeout\\(${timerName}\\)`).test(clearBody) &&
        new RegExp(`${timerName}\\s*=\\s*null`).test(clearBody),
      `${timerName} is cancelled and cleared`,
    );
  }
  const expectedGuardCleanup = sourceBlock(
    scrollControllerCode,
    "const clearExpectedReanchor =",
    "expected-reanchor cleanup",
  );
  ok(
    /clearTimeout\(expectedReanchorTimer\)/.test(expectedGuardCleanup) &&
      /expectedReanchorTimer\s*=\s*null/.test(expectedGuardCleanup) &&
      /expectedReanchorY\s*=\s*null/.test(expectedGuardCleanup),
    "expected-target timer and guard are both cleared",
  );

  for (const reducerCall of [
    "createScrollGovernorState",
    "beginScrollGesture",
    "applyScrollSample",
    "endScrollGesture",
    "releaseScrollSuppression",
    "syncRawScrollPosition",
  ]) {
    ok(
      new RegExp(`\\b${reducerCall}\\s*\\(`).test(scrollControllerCode),
      `scroll controller uses ${reducerCall}`,
    );
  }

  const hookPublishBody = sourceBlock(
    mainScrollEffect,
    "onPublish: (publication:",
    "hook publication adapter",
  );
  const hookCleanupBody = sourceBlock(
    mainScrollEffect,
    "return () => {",
    "hook cleanup",
    true,
  );
  const diagnosticBody = sourceBlock(
    hookPublishBody,
    "diagnostic = {",
    "DEV governor diagnostic",
  );
  const diagnosticFields = [
    ...diagnosticBody.matchAll(/^\s*(\w+)\s*(?::|,)\s*/gm),
  ].map((match) => match[1]);
  ok(
    /import\.meta\.env\.DEV/.test(hookPublishBody) &&
      JSON.stringify(diagnosticFields) ===
        JSON.stringify([
          "rawY",
          "virtualY",
          "sp",
          "gp",
          "clipT",
          "gestureActive",
          "gestureLocksGallery",
          "discardedForwardPx",
        ]) &&
      /window\.__sg\s*=\s*diagnostic/.test(hookPublishBody) &&
      /controller\.dispose\(\)/.test(hookCleanupBody) &&
      /if\s*\(\s*window\.__sg\s*===\s*diagnostic\s*\)\s*delete\s+window\.__sg/.test(
        hookCleanupBody,
      ),
    "DEV diagnostic has the exact contract and ownership-safe cleanup",
  );
  ok(
    !/preventDefault\s*\(/.test(scrollHookCode + scrollControllerCode) &&
      !/requestAnimationFrame\s*\(/.test(
        scrollHookCode + scrollControllerCode,
      ) &&
      !/\b(?:targetY|backlog|tokenBalance|debt)\b/.test(
        sourceBlock(scrollControllerCode, "const onScroll:", "scroll path"),
      ),
    "the controller preserves native scrolling without a queued animation loop",
  );
  ok(
    /shader\.uniforms\.uScreenClip\s*=/.test(videoPlaneSource) &&
      /shader\.uniforms\.uClipRect\s*=/.test(videoPlaneSource) &&
      /shader\.uniforms\.uClipRadius\s*=/.test(videoPlaneSource) &&
      /shader\.uniforms\.uAspect\s*=/.test(videoPlaneSource),
    "VideoPlane registers every screen-clip uniform with the compiled shader",
  );
  ok(
    /gl_FragColor\.rgb\s*=\s*mix\(vec3\(0\.0\),\s*gl_FragColor\.rgb,\s*mask\)/.test(videoPlaneSource) &&
      /gl_FragColor\.a\s*=\s*1\.0/.test(videoPlaneSource),
    "VideoPlane draws black blocks outside the screen clip instead of leaving video visible",
  );

  console.log("✓ frame-sequence scrub");
}

// ── Browser-safe render profile ─────────────────────────────────────────────
{
  const safariIOS =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const chromeDesktop =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
  ok(
    browserNeedsConservativeRenderProfile(safariIOS),
    "iOS Safari gets the conservative render profile",
  );
  ok(
    !browserNeedsConservativeRenderProfile(chromeDesktop),
    "desktop Chrome keeps the full render profile",
  );
  const safariProfile = createRenderProfile({ userAgent: safariIOS, width: 390 });
  eq(safariProfile.dpr[1], 2, "iOS Safari renders up to 2x (crisp typography/figures); adaptive floor still 1x");
  eq(safariProfile.dpr[0], 1, "iOS Safari can drop to 1x under load");
  eq(safariProfile.enablePostFx ? 1 : 0, 0, "Safari skips postprocessing");
  eq(safariProfile.antialias ? 1 : 0, 0, "Safari relies on 2x supersampling (not MSAA) for AA — lighter on weaker phones");
  ok(safariProfile.precision === "mediump", "Safari uses the lightweight shader precision");
  eq(safariProfile.maxCanvasTextureDpr, 2, "Safari renders the Lottie text canvas at 2x for crisp letters");
  eq(safariProfile.textureFrameRate, 30, "Safari caps texture upload rate");
  ok(
    safariProfile.figureMaterialMode === "full",
    "Safari keeps color-preserving figure materials",
  );
  eq(safariProfile.enableEnvironment ? 1 : 0, 0, "Safari skips PMREM environment setup");

  const sceneSource = readFileSync(new URL("../src/components/Scene.tsx", import.meta.url), "utf8");
  const lottiePlaneSource = readFileSync(new URL("../src/components/LottiePlane.tsx", import.meta.url), "utf8");
  const galleryTitlesSource = readFileSync(new URL("../src/components/GalleryTitles.tsx", import.meta.url), "utf8");
  ok(/dpr=\{renderProfile\.dpr\}/.test(sceneSource), "Scene uses an adaptive DPR profile");
  ok(!/dpr=\{\[1,\s*2\]\}/.test(sceneSource), "Scene no longer hard-caps DPR at 2 for every browser");
  ok(/antialias:\s*renderProfile\.antialias/.test(sceneSource), "Scene uses profile-controlled WebGL antialiasing");
  ok(/precision:\s*renderProfile\.precision/.test(sceneSource), "Scene uses profile-controlled shader precision");
  ok(/alpha:\s*false/.test(sceneSource), "Scene uses an opaque WebGL buffer to avoid fixed-layer compositor flicker");
  ok(/postToneMapping=\{renderProfile\.enablePostFx\}/.test(sceneSource), "GradientBackground matches the active tone-mapping path");
  ok(/renderProfile\.enablePostFx\s*&&\s*\(/.test(sceneSource), "Scene skips the EffectComposer on conservative browser profiles");
  ok(/renderProfile\.enableEnvironment\s*&&\s*\(/.test(sceneSource), "Scene skips the PMREM environment on conservative browser profiles");
  ok(/maxTextureDpr=\{renderProfile\.maxCanvasTextureDpr\}/.test(sceneSource), "Scene passes the texture DPR cap to Lottie canvases");
  ok(/textureFrameRate=\{renderProfile\.textureFrameRate\}/.test(sceneSource), "Scene passes the texture upload rate cap to Lottie canvases");
  ok(/materialMode=\{renderProfile\.figureMaterialMode\}/.test(sceneSource), "Scene passes the figure material profile to ArcModel");
  ok(/alphaToCoverage/.test(lottiePlaneSource), "LottiePlane uses alpha-to-coverage for smoother alphaTest text edges");
  ok(/alphaToCoverage/.test(galleryTitlesSource), "GalleryTitles uses alpha-to-coverage for smoother alphaTest title edges");
  ok(
    /performance=\{\{\s*min:\s*renderProfile\.performanceMin/.test(sceneSource),
    "Scene lets R3F regress quality under sustained frame pressure",
  );
  const gradientSource = readFileSync(new URL("../src/components/GradientBackground.tsx", import.meta.url), "utf8");
  ok(/uniform float uPostToneMapping/.test(gradientSource), "GradientBackground can render with or without post tone mapping");
  ok(
    /mesh\.visible\s*=\s*videoOpacity\s*<\s*0\.999/.test(gradientSource),
    "GradientBackground stops drawing once opaque video owns the frame",
  );
  console.log("✓ browser-safe render profile");
}

// ── Cursor tilt ──────────────────────────────────────────────────────────────
{
  const cardStackSource = readFileSync(new URL("../src/components/CardStack.tsx", import.meta.url), "utf8");
  ok(!/\bIDLE_TILT\b|\bIDLE_SPEED\b|\bclockRef\b|Math\.sin\(clockRef/.test(cardStackSource), "CardStack has no automatic idle card motion");

  // approach converges toward target and is a no-op at delta 0.
  let v = 0;
  for (let i = 0; i < 1000; i++) v = approach(v, 1, 1 / 60, 4);
  ok(Math.abs(v - 1) < 1e-3, "approach converges to target");
  eq(approach(0, 1, 0, 4), 0, "approach with delta 0 is a no-op");

  // tiltTarget maps pointer to rotation, zero under reduced motion.
  const t = tiltTarget(1, 1, false);
  eq(t.y, TILT_MAX, "pointer.x → rotY = +TILT_MAX");
  eq(t.x, -TILT_MAX, "pointer.y → rotX = −TILT_MAX");
  const tr = tiltTarget(1, 1, true);
  ok(tr.x === 0 && tr.y === 0, "reduced motion ⇒ no pointer tilt");

  // idleTilt is bounded by its amplitudes and zero under reduced motion.
  for (const e of [0, 1.3, 5.7, 12.4]) {
    const it = idleTilt(e, false);
    ok(Math.abs(it.x) <= IDLE_AMP_X + 1e-9, "idle x within amplitude");
    ok(Math.abs(it.y) <= IDLE_AMP_Y + 1e-9, "idle y within amplitude");
  }
  const ir = idleTilt(5.7, true);
  ok(ir.x === 0 && ir.y === 0, "reduced motion ⇒ no idle drift");

  console.log("✓ cursor tilt");
}

console.log("check-playback: all assertions passed");
