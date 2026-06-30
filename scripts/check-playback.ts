// Pure-function sanity assertions for the scroll timeline. No test runner in
// this project — run manually with:  npx tsx scripts/check-playback.ts
import { readFileSync } from "node:fs";
import {
  lottieTimeFor,
  figureStateFor,
  figureVisibleFor,
  videoStateFor,
  videoMasterTimeFor,
  VIDEO_SEEK_SETTLE_EPS,
  videoSeekMinIntervalMsFor,
  videoSeekCommandFor,
  videoSeekSettled,
  videoBufferedSeekTargetFor,
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
  isGalleryTitleHoldFrame,
  cardConveyorDisplayedFor,
  galleryStackDisplayedFor,
  videoHiddenForSafeHandoff,
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
import { debugVideoNoCropFromSearch } from "../src/debug/videoFlags";

function eq(actual: number, expected: number, label: string, eps = 1e-9) {
  if (Math.abs(actual - expected) > eps)
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
}
function ok(cond: boolean, label: string) {
  if (!cond) throw new Error(label);
}

const titleData = JSON.parse(
  readFileSync(new URL("../src/assets/titles.json", import.meta.url), "utf8"),
) as { ip: number; op: number };
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
eq(lottieTimeFor(0.5, "done"), LOTTIE_INTRO_S, "lottie done: readable frame held");
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

// Timing invariant: every flight ends before the video fades in, and the
// LAST figure (gba) is ≈¾ through its arc when the Lottie scrub / video reveal
// begins — the background continuation only resumes once the last icon is
// almost down (supervisor direction).
ok(FIGURES_END < VIDEO_START, "figures end before the video starts");
const last = FIGURES[FIGURES.length - 1].arc.window;
ok(spFor(last[1]) <= FIGURES_END + 1e-9, "last flight ends within the figures phase");
ok(spFor(last[1]) < VIDEO_START, "last flight ends before the video starts");
// The last figure's local t at LOTTIE_SCRUB_START should be between ≈¾ done and
// just-landed: the supervisor wants the icon nearly/just down when the background
// continuation resumes — no dead air, no slow lingering tail. (Was pinned at ≈¾;
// gba's snappier 0.85 end lands it ~95% down at the scrub start.)
const lastTatScrub =
  (((LOTTIE_SCRUB_START - FIGURES_START) / (FIGURES_END - FIGURES_START)) -
    last[0]) /
  (last[1] - last[0]);
ok(
  lastTatScrub >= 0.7 && lastTatScrub <= 1.02,
  `last figure ≈¾-down…just-landed when scrub starts (got ${lastTatScrub.toFixed(3)})`,
);
ok(
  lottieTimeFor(spFor(last[1]), "scroll") > LOTTIE_INTRO_S + 1e-9,
  "lottie is scrubbing during the last figure's exit",
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
// The figures phase begins INSIDE the Lottie reveal: the first figure is
// already nearly opaque at sp 0.155, just before AUSGEZEICHNETES (the last
// word) settles at sp ≈ 0.158 (measured empirically from the real export).
ok(FIGURES_START < REVEAL_END, "figures launch during the reveal");
ok(
  figureStateFor(0.155, FIGURES[0].arc.window, "scroll").opacity > 0.9,
  "first figure airborne before AUSGEZEICHNETES settles",
);
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

  // CTA: coupled to the last card's exit — hidden while cards present, fades in
  // over the tail of the exit, full once the last card is gone.
  eq(galleryCtaFromExit(0), 0, "CTA hidden while cards present");
  eq(galleryCtaFromExit(CTA_REVEAL_FROM), 0, "CTA hidden until the exit tail");
  eq(galleryCtaFromExit(1), 1, "CTA fully in once last card has flown");
  ok(galleryCtaFromExit(0.95) > galleryCtaFromExit(0.85), "CTA reveal monotonic over the exit tail");

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
  // comp's CLEAN integer frames (50/75/99) so the texts never sit in a
  // half-overlapped state. Anchors + holds + monotonic non-decreasing.
  eq(galleryTitleFrameFracForCard(0), 0, "title frac 0 at cp 0");
  eq(titleFrame(galleryTitleFrameFracForCard(1)), 50, "title frame = clean STRATEGISCHE once card 1 is in");
  eq(titleFrame(galleryTitleFrameFracForCard(3)), 50, "title frame holds clean STRATEGISCHE over cards 2,3");
  eq(titleFrame(galleryTitleFrameFracForCard(4)), 75, "title frame = clean DESIGN NACH MASS once card 4 is in");
  eq(titleFrame(galleryTitleFrameFracForCard(6)), 75, "title frame holds clean DESIGN NACH MASS over cards 5,6");
  eq(titleFrame(galleryTitleFrameFracForCard(7)), 99, "title frame = clean GANZ GROSSEN BILDER once card 7 is in");
  eq(titleFrame(galleryTitleFrameFracForCard(9)), 99, "title frame holds clean over cards 8,9");
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
  ok(imageStackRevealFor(0.03, true) > 0, "safe handoff starts image stack reveal right after black fade");
  eq(imageStackVisibleFor(0.03, true), 1, "safe handoff shows the image stack during the early gallery");
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
  eq(galleryStackDisplayedFor(VID_MORPH_END, true), 0, "safe handoff puts image card 0 at the front immediately");
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
    eq(titleFrame(galleryTitleFrameFor(gpForLin(3))), 75, "design title freezes on clean frame 75");
    eq(titleFrame(galleryTitleFrameFor(gpForLin(6))), 99, "final title freezes on clean frame 99");
    ok(isGalleryTitleHoldFrame(galleryTitleFrameFor(gpForLin(3))), "design clean frame is detected as a hold");
    ok(
      !isGalleryTitleHoldFrame(
        (galleryTitleFrameFor(gpForLin(3)) + galleryTitleFrameFor(gpForLin(6))) / 2,
      ),
      "transition frames are not detected as holds",
    );
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

// ── Video scrub convergence ─────────────────────────────────────────────────
{
  const videoPlaneParallaxSource = readFileSync(new URL("../src/components/VideoPlane.tsx", import.meta.url), "utf8");
  ok(!/addEventListener\("pointermove"/.test(videoPlaneParallaxSource), "VideoPlane has no pointer parallax listener");
  ok(!/Card-form parallax/.test(videoPlaneParallaxSource), "video card does not run hover parallax");

  ok(debugVideoNoCropFromSearch("?debugVideoNoCrop=1"), "debug video no-crop flag can be enabled by query param");
  ok(debugVideoNoCropFromSearch("?videoCrop=off"), "debug video crop can be disabled by readable query param");
  ok(!debugVideoNoCropFromSearch("?videoCrop=on"), "video crop stays enabled by default");

  eq(videoSeekMinIntervalMsFor(false, 0), 44, "Chrome/base video seek interval");
  eq(videoSeekMinIntervalMsFor(true, 0), 64, "Safari/Firefox animation seek interval");
  eq(videoSeekMinIntervalMsFor(true, 0.03), 64, "Safari/Firefox keeps scrubbing the video through the gallery text handoff");
  ok(!videoHiddenForSafeHandoff(0, true), "safe video handoff keeps the video for the gallery boundary frame");
  ok(!videoHiddenForSafeHandoff(0.01, true), "safe video handoff keeps the frozen video during the black fade");
  ok(videoHiddenForSafeHandoff(0.02, true), "safe video handoff hides the video once black owns the frame");
  ok(!videoHiddenForSafeHandoff(0.02, false), "normal browsers keep the video morph visible");

  ok(videoSeekSettled(10, 10 + VIDEO_SEEK_SETTLE_EPS / 2), "video seek settles within tolerance");
  ok(!videoSeekSettled(10, 10 + VIDEO_SEEK_SETTLE_EPS * 2), "video seek remains pending outside tolerance");
  ok(
    videoSeekCommandFor({
      desiredTime: 12,
      issuedTime: 12,
      seeking: true,
      elapsedMs: 401,
    }).issue,
    "stalled video seek retries even when the latest desired time equals the previously issued time",
  );
  ok(
    !videoSeekCommandFor({
      desiredTime: 12,
      issuedTime: 12,
      seeking: true,
      elapsedMs: 399,
    }).issue,
    "in-flight video seek is not reissued before the stall watchdog expires",
  );
  ok(
    !videoSeekCommandFor({
      desiredTime: 12.5,
      issuedTime: 12,
      seeking: false,
      elapsedMs: 33,
      minIntervalMs: 90,
    }).issue,
    "video seek is rate-limited before the minimum interval has elapsed",
  );
  ok(
    videoSeekCommandFor({
      desiredTime: 12.5,
      issuedTime: 12,
      seeking: false,
      elapsedMs: 91,
      minIntervalMs: 90,
    }).issue,
    "video seek resumes after the minimum interval has elapsed",
  );
  ok(
    videoSeekCommandFor({
      desiredTime: 12.5,
      issuedTime: 12,
      seeking: true,
      elapsedMs: 401,
      minIntervalMs: 900,
    }).issue,
    "stalled video seek bypasses the rate limit",
  );
  const partialBuffer = {
    length: 1,
    start: () => 0,
    end: () => 8.4,
  };
  eq(
    videoBufferedSeekTargetFor(16, partialBuffer, true),
    8.3,
    "buffer clamp holds Chrome on the latest definitely decoded frame",
  );
  eq(
    videoBufferedSeekTargetFor(16, partialBuffer, false),
    16,
    "Safari/iOS bypasses the buffer clamp so it can range-seek past the church frame",
  );

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
  eq(frameUrl(1280, 0), "/frames/1280/0001.webp", "frame URL is 1-indexed + zero-padded");
  eq(frameUrl(1920, 294), "/frames/1920/0295.webp", "frame URL maps the last index to the last file");
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
  const scrollHookSrc = readFileSync(new URL("../src/hooks/useScrollProgress.ts", import.meta.url), "utf8");
  ok(
    /galleryProgressFrom\(window\.scrollY,\s*ih\)/.test(scrollHookSrc) &&
      !/galleryProgressFrom\([^)]*window\.innerHeight/.test(scrollHookSrc),
    "gallery progress uses a CACHED height (not live innerHeight) so the sp→gp seam stays aligned when the mobile URL bar collapses — no dead-zone freeze on the boundary frame",
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

  console.log("✓ frame-sequence scrub + seek helpers");
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
  eq(safariProfile.dpr[1], 1, "iOS Safari uses the lightweight canvas DPR");
  eq(safariProfile.enablePostFx ? 1 : 0, 0, "Safari skips postprocessing");
  eq(safariProfile.antialias ? 1 : 0, 0, "Safari skips MSAA");
  ok(safariProfile.precision === "mediump", "Safari uses the lightweight shader precision");
  eq(safariProfile.maxCanvasTextureDpr, 1, "Safari caps Lottie texture DPR");
  eq(safariProfile.textureFrameRate, 30, "Safari caps texture upload rate");
  ok(!safariProfile.safeVideoHandoff, "Safari keeps the video visible through the gallery text handoff");
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
  ok(
    /debugVideoNoCropFromSearch/.test(sceneSource) &&
      /safeVideoHandoff\s*=\s*renderProfile\.safeVideoHandoff\s*&&\s*!debugVideoNoCrop/.test(sceneSource),
    "Scene lets the diagnostic no-crop flag override Safari safe handoff globally",
  );
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
