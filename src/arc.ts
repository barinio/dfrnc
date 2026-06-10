import * as THREE from "three";

// A figure's flight path is a symmetric quadratic dome: it enters near one
// bottom corner, peaks at top-center (the apex is hit exactly at the curve
// midpoint, t = 0.5), and exits near the mirrored bottom corner. Each figure
// gets its own ArcConfig — distinct heights, spreads, sides and spins so the
// overlapping waves read dynamic rather than cloned.
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
  // (1 ≈ the top edge). Kept below 1 so the figure doesn't clip off the top.
  peakHeight: number;
  // Entry side: 1 enters bottom-LEFT (exits right), -1 mirrors the dome so it
  // enters bottom-RIGHT. Alternating sides is what makes the waves criss-cross.
  side: 1 | -1;
  // Total scroll-driven Y turn across the flight (sign = direction). The spin
  // is apex-centred: frontal exactly at t = 0.5.
  spinTurns: number;
  // This figure's sub-window of the figures phase, in normalized phase units
  // [0, 1]. Windows overlap by 0.2 so ~2 figures are airborne at once.
  window: readonly [number, number];
}

export interface FigureDef {
  name: string;
  // Relative to BASE_URL; files under public/figures/ are drop-in — swapping
  // a GLB needs no code change.
  url: string;
  arc: ArcConfig;
}

// Launch order: and → tokyo → gba → awwwards, alternating entry sides.
// Shape values are starting points — every one is live-tunable via Leva.
export const FIGURES: FigureDef[] = [
  {
    name: "and",
    url: "figures/and.glb",
    arc: {
      legSpreadLandscape: 0.5,
      legSpreadPortrait: 0.95,
      rootDepth: 0.95,
      peakHeight: 0.72,
      side: 1,
      spinTurns: 0.55,
      window: [0, 0.4],
    },
  },
  {
    name: "tokyo",
    url: "figures/tokyo.glb",
    arc: {
      legSpreadLandscape: 0.62,
      legSpreadPortrait: 0.95,
      rootDepth: 0.95,
      peakHeight: 0.6,
      side: -1,
      spinTurns: -0.5,
      window: [0.2, 0.6],
    },
  },
  {
    name: "gba",
    url: "figures/gba.glb",
    arc: {
      legSpreadLandscape: 0.44,
      legSpreadPortrait: 0.9,
      rootDepth: 0.95,
      peakHeight: 0.70,
      side: 1,
      spinTurns: 0.6,
      window: [0.4, 0.8],
    },
  },
  {
    name: "awwwards",
    url: "figures/awwwards.glb",
    arc: {
      legSpreadLandscape: 0.56,
      legSpreadPortrait: 0.95,
      rootDepth: 0.95,
      peakHeight: 0.66,
      side: -1,
      spinTurns: -0.55,
      window: [0.6, 1],
    },
  },
];

// Build the world-space curve for a given viewport and config. The control
// point sits at top-center, so the quadratic Bézier is left/right symmetric and
// its midpoint (t = 0.5) lands exactly on the apex. `side` mirrors the travel
// direction (the dome shape itself is symmetric). The leg spread is chosen
// from the viewport orientation.
export function makeArc(
  width: number,
  height: number,
  cfg: ArcConfig,
): THREE.QuadraticBezierCurve3 {
  const legSpread =
    width >= height ? cfg.legSpreadLandscape : cfg.legSpreadPortrait;
  const a = (width / 2) * legSpread * cfg.side;
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

