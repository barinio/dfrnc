// Pure-function sanity assertions for the scroll timeline. No test runner in
// this project — run manually with:  npx tsx scripts/check-playback.ts
import {
  lottieTimeFor,
  figureStateFor,
  figureVisibleFor,
  videoStateFor,
  lottieBleedFor,
} from "../src/playback";
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
  cardConveyorFor,
  cardFlyProgressFor,
  galleryCtaFromExit,
  CTA_REVEAL_FROM,
  GALLERY_IMAGES,
  BACKDROP_FADE_END,
  TITLES_END,
  CARDS_FLY_START,
  CARDS_FLY_END,
  CTA_START,
} from "../src/gallery";
import { SCROLL_TRACK_VH, GALLERY_TRACK_VH } from "../src/constants";
import {
  approach,
  tiltTarget,
  idleTilt,
  TILT_MAX,
  IDLE_AMP_X,
  IDLE_AMP_Y,
} from "../src/cursorTilt";

function eq(actual: number, expected: number, label: string, eps = 1e-9) {
  if (Math.abs(actual - expected) > eps)
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
}
function ok(cond: boolean, label: string) {
  if (!cond) throw new Error(label);
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
// The last figure's local t at LOTTIE_SCRUB_START should be ≈0.75 (¾ done).
const lastTatScrub =
  (((LOTTIE_SCRUB_START - FIGURES_START) / (FIGURES_END - FIGURES_START)) -
    last[0]) /
  (last[1] - last[0]);
ok(
  Math.abs(lastTatScrub - 0.75) < 0.06,
  `last figure ≈¾ done when scrub starts (got ${lastTatScrub.toFixed(3)})`,
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
// Cascade layout: ordered overlapping windows. Order is and → awwwards →
// tokyo → gba; the first starts at the phase top and the last lands within it.
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
// awwwards launches the moment `and` reaches its apex (and's window midpoint).
const and = byName("and");
eq(
  byName("awwwards").arc.window[0],
  (and.arc.window[0] + and.arc.window[1]) / 2,
  "awwwards launches at and's apex",
  1e-9,
);
// The crossing pair: gba launches at 25% of tokyo's flight, on the opposite
// side and on a HIGHER dome at a different depth — they pass without
// colliding (per the design direction).
const tokyo = byName("tokyo");
const gba = byName("gba");
eq(
  gba.arc.window[0],
  tokyo.arc.window[0] +
    0.25 * (tokyo.arc.window[1] - tokyo.arc.window[0]),
  "gba launches at 25% of tokyo's window",
  1e-9,
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
for (const name of ["tokyo", "awwwards"]) {
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

  // gp is 0 at/under the animation track end, 1 at the document bottom.
  eq(galleryProgressFrom(animY, H), 0, "gp = 0 at anim track end");
  eq(galleryProgressFrom(animY - 500, H), 0, "gp clamps to 0 above gallery");
  eq(galleryProgressFrom(animY + galleryPx, H), 1, "gp = 1 at document bottom");
  eq(galleryProgressFrom(animY + galleryPx / 2, H), 0.5, "gp = 0.5 at gallery midpoint");

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
  eq(cardFlyProgressFor(0.15), 0, "fly progress 0 during the first-card linger");
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

  console.log("✓ gallery timeline");
}

// ── Cursor tilt ──────────────────────────────────────────────────────────────
{
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
