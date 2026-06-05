import * as THREE from "three";

// A model's flight path is a symmetric quadratic dome: it enters near one bottom
// corner, peaks at top-center (the apex is hit exactly at the curve midpoint,
// t = 0.5), and exits near the mirrored bottom corner. Each future model gets its
// own ArcConfig (the colored trajectories in the reference); only the blue arc
// exists today, but adding red/green/yellow later is a one-line addition.
export interface ArcConfig {
  // Horizontal reach of the legs, as a fraction of half the viewport width.
  // Aspect-dependent: wide desktop layouts keep the dome in the MIDDLE of the
  // screen (0.5 ⇒ feet at 25% / 75% width), while narrow phone layouts let it
  // span corner-to-corner (≈0.95 ⇒ feet at the bottom corners).
  legSpreadLandscape: number;
  legSpreadPortrait: number;
  // How far down the entry/exit roots sit, as a fraction of half the viewport
  // height (1 ≈ the bottom edge).
  rootDepth: number;
  // Apex height at t = 0.5, as a fraction of half the viewport height
  // (1 ≈ the top edge). Kept below 1 so the model doesn't clip off the top.
  peakHeight: number;
}

// The blue trajectory: a symmetric dome, narrower on desktop, full-width on phones.
export const BLUE_ARC: ArcConfig = {
  legSpreadLandscape: 0.5,
  legSpreadPortrait: 0.95,
  rootDepth: 0.95,
  peakHeight: 0.72,
};

// Build the world-space curve for a given viewport and config. The control
// point sits at top-center, so the quadratic Bézier is left/right symmetric and
// its midpoint (t = 0.5) lands exactly on the apex. The leg spread is chosen
// from the viewport orientation.
export function makeArc(
  width: number,
  height: number,
  cfg: ArcConfig,
): THREE.QuadraticBezierCurve3 {
  const legSpread =
    width >= height ? cfg.legSpreadLandscape : cfg.legSpreadPortrait;
  const a = (width / 2) * legSpread;
  const root = (height / 2) * cfg.rootDepth;
  const peak = (height / 2) * cfg.peakHeight;

  const start = new THREE.Vector3(-a, -root, 0);
  const end = new THREE.Vector3(a, -root, 0);

  // For a quadratic Bézier the midpoint is 0.25·start + 0.5·control + 0.25·end,
  // so its y is -0.5·root + 0.5·controlY. Solve controlY so the apex lands
  // exactly at `peak`:  controlY = 2·peak + root.
  const control = new THREE.Vector3(0, 2 * peak + root, 0);

  return new THREE.QuadraticBezierCurve3(start, control, end);
}
