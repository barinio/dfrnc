import {
  LOTTIE_INTRO_S,
  LOTTIE_INTRO_END,
  LOTTIE_TOTAL_S,
  MODEL_PHASE_END,
  FADE_RANGE,
  DURATION,
} from "./constants";

// Single source of truth for the scroll-driven timeline. Both LottiePlane and
// ArcModel derive their per-frame state from these pure functions (read inside
// useFrame), so the experience is a function of scroll progress alone and never
// requires a React re-render to advance.
export type Phase = "scroll" | "done";

function smoothstep(x: number): number {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
}

// Lottie timeline (seconds): scrub the intro (0 → LOTTIE_INTRO_S), hold on the
// intro frame while the arc plays, then scrub the remainder to the end. The arc
// has fully faded out by MODEL_PHASE_END, so the Lottie resumes exactly there.
export function lottieTimeFor(sp: number, phase: Phase): number {
  if (phase === "done") return LOTTIE_TOTAL_S;
  if (sp <= LOTTIE_INTRO_END) return (sp / LOTTIE_INTRO_END) * LOTTIE_INTRO_S;
  if (sp <= MODEL_PHASE_END) return LOTTIE_INTRO_S;
  const t = (sp - MODEL_PHASE_END) / (1 - MODEL_PHASE_END);
  return LOTTIE_INTRO_S + t * (LOTTIE_TOTAL_S - LOTTIE_INTRO_S);
}

export interface ModelState {
  time: number;
  opacity: number;
}

// 3D arc playback time + opacity. Arc position runs 0..DURATION across the model
// phase. The fade is SYMMETRIC within the phase: the model fades in over the
// first FADE_RANGE as it climbs out of the bottom-left corner, and fades out
// over the last FADE_RANGE as it descends into the bottom-right corner. So it
// appears and disappears at mirror-image points on the arc — the flight reads as
// a balanced dome instead of arriving at the clipped right corner fully opaque.
export function modelStateFor(sp: number, phase: Phase): ModelState {
  if (phase === "done") return { time: DURATION, opacity: 0 };

  const arcT = Math.min(
    Math.max((sp - LOTTIE_INTRO_END) / (MODEL_PHASE_END - LOTTIE_INTRO_END), 0),
    1,
  );

  let opacity: number;
  if (sp <= LOTTIE_INTRO_END || sp >= MODEL_PHASE_END) {
    opacity = 0;
  } else if (sp < LOTTIE_INTRO_END + FADE_RANGE) {
    opacity = smoothstep((sp - LOTTIE_INTRO_END) / FADE_RANGE);
  } else if (sp <= MODEL_PHASE_END - FADE_RANGE) {
    opacity = 1;
  } else {
    opacity = smoothstep((MODEL_PHASE_END - sp) / FADE_RANGE);
  }

  return { time: arcT * DURATION, opacity };
}

// Discrete states — used by Scene to mount/unmount and toggle DOM, flipped only
// when the threshold is crossed (never per frame).
export function modelVisibleFor(sp: number, phase: Phase): boolean {
  return modelStateFor(sp, phase).opacity > 0.001;
}
