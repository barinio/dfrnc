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
} from "./constants";

// Single source of truth for the scroll-driven timeline. LottiePlane, the
// ArcModels and VideoPlane all derive their per-frame state from these pure
// functions (read inside useFrame/rAF), so the experience is a function of
// scroll progress alone and never requires a React re-render to advance.
export type Phase = "scroll" | "done";

function smoothstep(x: number): number {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
}

function clamp01(x: number): number {
  return Math.min(Math.max(x, 0), 1);
}

// Lottie timeline (seconds). The reveal starts at DEFT_DROP_S — the loader has
// already auto-played [0, DEFT_DROP_S], and because the mapping never returns
// less than DEFT_DROP_S, scrolling back to the top can never re-enter the drop.
// Reduced-motion ("done") phase: hold the readable intro frame until the video
// is FULLY opaque (VIDEO_START + VIDEO_FADE), then snap to the final frame
// (an empty zoom-through) which the video now covers completely. The video
// fades in BEHIND the typography, so the readable frame stays on top through
// the fade and the swap itself is invisible. The discrete swap is intentional —
// no animation plays for these users.
export function lottieTimeFor(sp: number, phase: Phase): number {
  if (phase === "done")
    return sp < VIDEO_START + VIDEO_FADE ? LOTTIE_INTRO_S : LOTTIE_TOTAL_S;
  if (sp <= REVEAL_END)
    return DEFT_DROP_S + (sp / REVEAL_END) * (LOTTIE_INTRO_S - DEFT_DROP_S);
  // Hold ends at LOTTIE_SCRUB_START (not FIGURES_END): the typography starts
  // appearing again while the tail of the figure sequence is still exiting.
  if (sp <= LOTTIE_SCRUB_START) return LOTTIE_INTRO_S;
  const t = clamp01((sp - LOTTIE_SCRUB_START) / (LOTTIE_END - LOTTIE_SCRUB_START));
  return LOTTIE_INTRO_S + t * (LOTTIE_TOTAL_S - LOTTIE_INTRO_S);
}

export interface FigureState {
  // Local flight progress through this figure's window, 0..1 (clamped).
  t: number;
  opacity: number;
}

// Per-figure flight state. `window` is the figure's sub-range of the figures
// phase, in normalized phase units [0,1]; windows may OVERLAP (up to two
// figures airborne at once) so the sequence reads as a continuous cascade.
// The phase itself starts at FIGURES_START — inside the Lottie reveal — so the
// first figure is flying before the last word settles. The fade is SYMMETRIC
// within the window (first/last FIGURE_FADE of local t), so each flight reads
// as a balanced dome and is fully reversible on reverse scroll.
export function figureStateFor(
  sp: number,
  window: readonly [number, number],
  phase: Phase,
): FigureState {
  if (phase === "done") return { t: 1, opacity: 0 };
  const phaseT = (sp - FIGURES_START) / (FIGURES_END - FIGURES_START);
  const [w0, w1] = window;
  const t = clamp01((phaseT - w0) / (w1 - w0));
  let opacity = 0;
  if (phaseT > w0 && phaseT < w1) {
    if (t < FIGURE_FADE) opacity = smoothstep(t / FIGURE_FADE);
    else if (t > 1 - FIGURE_FADE) opacity = smoothstep((1 - t) / FIGURE_FADE);
    else opacity = 1;
  }
  return { t, opacity };
}

// Extra phase-units of mount life beyond the window on each side. ArcModel
// smooths its opacity over time (so fast scroll-jumps fade instead of pop);
// the grace keeps the component MOUNTED slightly past its window so the
// temporal fade-out can finish before React unmounts it. The grace is a
// SCROLL-distance budget while the fade decays in TIME, so it only suffices
// at moderate scroll speeds — Scene additionally keeps a figure mounted while
// its live smoothed opacity is still nonzero (see figureOpacityLive), which
// covers flicks and single-event jumps at any speed.
const MOUNT_GRACE = 0.04;

// Discrete visibility — used by Scene to mount/unmount each figure, flipped
// only when the threshold is crossed (never per frame).
export function figureVisibleFor(
  sp: number,
  window: readonly [number, number],
  phase: Phase,
): boolean {
  if (phase === "done") return false;
  const phaseT = (sp - FIGURES_START) / (FIGURES_END - FIGURES_START);
  return phaseT > window[0] - MOUNT_GRACE && phaseT < window[1] + MOUNT_GRACE;
}

export interface VideoState {
  // Normalized video time 0..1 across [VIDEO_START, 1].
  t: number;
  opacity: number;
}

// Video phase: fades in over VIDEO_FADE starting at VIDEO_START — while the
// typography is still zooming, BEHIND the letters — and scrubs linearly from
// VIDEO_START to the clip's last frame at sp = 1.
// "done" (reduced motion): never scrubs — static final frame — but the fade
// still follows scroll so the typography isn't covered before the tail.
export function videoStateFor(sp: number, phase: Phase): VideoState {
  const opacity = smoothstep((sp - VIDEO_START) / VIDEO_FADE);
  if (phase === "done") return { t: 1, opacity };
  return {
    t: clamp01((sp - VIDEO_START) / (1 - VIDEO_START)),
    opacity,
  };
}

// 0 → the Lottie keeps its framed inset margin; 1 → full-bleed. The frame
// dissolves over the same ramp that brings the video in behind the text, so
// the zoom-through reads edge-to-edge. Phase-independent: under reduced
// motion the swap still follows scroll (no animation plays).
export function lottieBleedFor(sp: number): number {
  return smoothstep((sp - VIDEO_START) / VIDEO_FADE);
}
