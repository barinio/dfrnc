import {
  DEFT_DROP_S,
  LOTTIE_INTRO_S,
  LOTTIE_TOTAL_S,
  REVEAL_END,
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
// Reduced-motion ("done") phase: hold the readable intro frame until the lottie
// phase ends (FIGURES_END), then snap to the final frame which the video tail
// covers. The discrete swap at FIGURES_END is intentional — no animation plays
// for these users; the typography stays readable through the figures phase.
export function lottieTimeFor(sp: number, phase: Phase): number {
  if (phase === "done")
    return sp < FIGURES_END ? LOTTIE_INTRO_S : LOTTIE_TOTAL_S;
  if (sp <= REVEAL_END)
    return DEFT_DROP_S + (sp / REVEAL_END) * (LOTTIE_INTRO_S - DEFT_DROP_S);
  if (sp <= FIGURES_END) return LOTTIE_INTRO_S;
  const t = clamp01((sp - FIGURES_END) / (LOTTIE_END - FIGURES_END));
  return LOTTIE_INTRO_S + t * (LOTTIE_TOTAL_S - LOTTIE_INTRO_S);
}

export interface FigureState {
  // Local flight progress through this figure's window, 0..1 (clamped).
  t: number;
  opacity: number;
}

// Per-figure flight state. `window` is the figure's sub-range of the figures
// phase, in normalized phase units [0,1]; windows overlap so ~2 figures are
// airborne at once. The fade is SYMMETRIC within the window (first/last
// FIGURE_FADE of local t), so each flight reads as a balanced dome and is
// fully reversible on reverse scroll.
export function figureStateFor(
  sp: number,
  window: readonly [number, number],
  phase: Phase,
): FigureState {
  if (phase === "done") return { t: 1, opacity: 0 };
  const phaseT = (sp - REVEAL_END) / (FIGURES_END - REVEAL_END);
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

// Discrete visibility — used by Scene to mount/unmount each figure, flipped
// only when the threshold is crossed (never per frame).
export function figureVisibleFor(
  sp: number,
  window: readonly [number, number],
  phase: Phase,
): boolean {
  return figureStateFor(sp, window, phase).opacity > 0.001;
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

export function videoVisibleFor(sp: number, phase: Phase): boolean {
  return videoStateFor(sp, phase).opacity > 0.001;
}
