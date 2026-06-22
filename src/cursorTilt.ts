// Shared cursor-reaction helpers for the gallery (cards + CTA). Mirrors the
// glass figures' mouse parallax (lerp toward pointer × max), plus a small
// always-on idle drift so the subject moves when the cursor is still / on
// mobile (the radiance.family feel). Pure — unit-asserted in check-playback.

export const TILT_MAX = 0.07; // ~4° max pointer tilt (matches the figures)
export const TILT_RATE = 4; // exponential lerp rate toward the target
export const IDLE_AMP_X = 0.025; // idle pitch amplitude (radians)
export const IDLE_AMP_Y = 0.04; // idle yaw amplitude (radians)
export const IDLE_FREQ_X = 0.13; // idle pitch frequency (cycles/sec)
export const IDLE_FREQ_Y = 0.09; // idle yaw frequency (cycles/sec)

// Framerate-independent exponential approach of `current` toward `target`.
export function approach(current: number, target: number, delta: number, rate: number): number {
  return current + (target - current) * (1 - Math.exp(-delta * rate));
}

// Pointer (−1..1 device coords) → target tilt. Reduced motion ⇒ no tilt.
export function tiltTarget(pointerX: number, pointerY: number, reducedMotion: boolean): { x: number; y: number } {
  if (reducedMotion) return { x: 0, y: 0 };
  return { x: -pointerY * TILT_MAX, y: pointerX * TILT_MAX };
}

// Always-on idle drift (added on top of the pointer tilt). Reduced motion ⇒ 0.
export function idleTilt(elapsed: number, reducedMotion: boolean): { x: number; y: number } {
  if (reducedMotion) return { x: 0, y: 0 };
  return {
    x: IDLE_AMP_X * Math.sin(elapsed * IDLE_FREQ_X * Math.PI * 2),
    y: IDLE_AMP_Y * Math.sin(elapsed * IDLE_FREQ_Y * Math.PI * 2 + 1.3),
  };
}
