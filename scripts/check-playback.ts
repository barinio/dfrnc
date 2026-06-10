// Pure-function sanity assertions for the scroll timeline. No test runner in
// this project — run manually with:  npx tsx scripts/check-playback.ts
import {
  lottieTimeFor,
  figureStateFor,
  videoStateFor,
} from "../src/playback";
import {
  DEFT_DROP_S,
  LOTTIE_INTRO_S,
  LOTTIE_TOTAL_S,
  REVEAL_END,
  LOTTIE_SCRUB_START,
  FIGURES_END,
  LOTTIE_END,
  VIDEO_START,
  VIDEO_FADE,
  FIGURE_FADE,
} from "../src/constants";

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
  REVEAL_END + phaseT * (FIGURES_END - REVEAL_END);
eq(figureStateFor(spFor(0.2), win, "scroll").t, 0, "fig t@start");
eq(figureStateFor(spFor(0.4), win, "scroll").t, 0.5, "fig t@apex");
eq(figureStateFor(spFor(0.6), win, "scroll").t, 1, "fig t@end");
eq(figureStateFor(spFor(0.1), win, "scroll").opacity, 0, "fig hidden before");
eq(figureStateFor(spFor(0.7), win, "scroll").opacity, 0, "fig hidden after");
eq(figureStateFor(spFor(0.4), win, "scroll").opacity, 1, "fig opaque @apex");
ok(
  figureStateFor(spFor(0.22), win, "scroll").opacity > 0 &&
    figureStateFor(spFor(0.22), win, "scroll").opacity < 1,
  "fig fading in",
);
eq(figureStateFor(0.3, win, "done").opacity, 0, "fig done hidden");

// Sequential invariant: windows don't overlap, so at most ONE figure is
// visible at any phaseT — each flies its full solo dome like the first one.
for (let p = 0; p <= 1.0001; p += 0.001) {
  const visible = FIGURES.filter(
    (f) => figureStateFor(spFor(p), f.arc.window, "scroll").opacity > 0.001,
  );
  ok(visible.length <= 1, `${visible.length} figures visible @phaseT=${p}`);
}

// Timing invariant: every flight ends before the video fades in, and the
// LAST figure's exit happens while the Lottie typography is appearing
// (scrubbing, not holding).
ok(FIGURES_END < VIDEO_START, "figures end before the video starts");
const last = FIGURES[FIGURES.length - 1].arc.window;
const exitStartSp = spFor(last[0] + (1 - FIGURE_FADE) * (last[1] - last[0]));
ok(
  lottieTimeFor(exitStartSp, "scroll") > LOTTIE_INTRO_S + 1e-9,
  "lottie is scrubbing during the last figure's exit",
);
eq(spFor(last[1]), FIGURES_END, "last window ends exactly at FIGURES_END", 1e-9);

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

// arc.ts: apex at midpoint, mirroring flips travel direction only
import { makeArc, FIGURES } from "../src/arc";
const W = 12;
const H = 7;
for (const f of FIGURES) {
  const c = makeArc(W, H, f.arc);
  const apex = c.getPoint(0.5);
  eq(apex.x, 0, `${f.name} apex centered`);
  eq(apex.y, (H / 2) * f.arc.peakHeight, `${f.name} apex height`, 1e-6);
  const p0 = c.getPoint(0);
  ok(
    Math.sign(p0.x) === -f.arc.side,
    `${f.name} enters on the configured side`,
  );
  eq(Math.abs(p0.x), (W / 2) * f.arc.legSpreadLandscape, `${f.name} spread`, 1e-6);
}
// windows are sequential and contiguous, spanning the whole figures phase
eq(FIGURES[0].arc.window[0], 0, "first window starts at 0");
eq(FIGURES[FIGURES.length - 1].arc.window[1], 1, "last window ends at 1");
for (let i = 1; i < FIGURES.length; i++) {
  eq(
    FIGURES[i].arc.window[0],
    FIGURES[i - 1].arc.window[1],
    `window ${i} starts where window ${i - 1} ends`,
    1e-9,
  );
}
// peaks stay at or below ~half the viewport (0.5 of the upper half) so the
// figure — whose body extends above its center — never clips off the top edge
for (const f of FIGURES) {
  ok(f.arc.peakHeight <= 0.5 + 1e-9, `${f.name} peak ≤ 0.5`);
}

console.log("check-playback: all assertions passed");
