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
  // (1 ≈ the top edge). The path drives the figure's visual CENTER and the
  // model itself is up to ~1.25 world units tall around it, so peaks stay
  // ≈0.5 and below — the figure rises to about the middle of the screen and
  // never clips off the top.
  peakHeight: number;
  // Entry side: 1 enters bottom-LEFT (exits right), -1 mirrors the dome so it
  // enters bottom-RIGHT. Alternating sides is what makes the waves criss-cross.
  side: 1 | -1;
  // Total scroll-driven Y turn across the flight (sign = direction). The spin
  // is apex-centred: frontal exactly at t = 0.5. Text figures spin WITH their
  // travel direction (sign matches `side`); icon figures spin AGAINST it
  // (sign opposite to `side`) so the two kinds of figure read differently.
  spinTurns: number;
  // Screen-space roll at the apex (radians; sign flips the lean direction).
  rollPeak: number;
  // Pitch oscillation amplitude across the flight (radians).
  swingAmount: number;
  // Constant depth offset of the whole curve (world units, camera at z = 8).
  // Used to layer figures whose windows overlap so they pass in FRONT/BEHIND
  // each other instead of intersecting — the crossing pair needs a gap larger
  // than the sum of the figures' rotated z-reaches (~0.8 each with the calmer
  // swing). Offsets change projected size by 8/(8−z); compensate targetHeight
  // and spreads so the on-screen look stays put. The Lottie plane sits at
  // z = -3 and must stay behind every figure's rotated extent.
  z?: number;
  // This figure's sub-window of the figures phase, in normalized phase units
  // [0, 1]. Windows may OVERLAP (up to two figures airborne at once) — the
  // sequence reads as a continuous cascade rather than four solo flights.
  window: readonly [number, number];
}

export interface FigureDef {
  name: string;
  // Relative to BASE_URL; files under public/figures/ are drop-in — swapping
  // a GLB needs no code change.
  url: string;
  // Desired on-screen height in world units (the world viewport is ~9.24 units
  // tall at z = 0 regardless of aspect). Normalizing the VERTICAL extent — not
  // the max bbox dimension — is what makes the mixed set read similar in size:
  // the thin vertical text logos (tokyo/awwwards) get a little extra height to
  // match the visual weight of the squarish icons (and/gba). ArcModel caps the
  // resulting width at 85% of the viewport width on narrow screens.
  targetHeight: number;
  arc: ArcConfig;
  // Optional per-figure deviations from the shared glass material, applied on
  // top of the Leva-synced base values. Thin/elongated geometry (long internal
  // light paths) saturates the Beer-Lambert attenuation tint — weaken it here.
  material?: {
    attenuationColor?: string;
    attenuationDistance?: number;
    thickness?: number;
  };
}

// Launch order: and → tokyo → gba → awwwards, alternating entry sides, with
// OVERLAPPING windows so the sequence reads as one continuous cascade:
//   • and starts at the very top of the figures phase — already airborne while
//     AUSGEZEICHNETES is still animating in (the phase begins inside the
//     Lottie reveal, see FIGURES_START).
//   • tokyo launches as and exits, flying a LOWER dome right-to-left while…
//   • gba launches at 25% of tokyo's flight, flying a HIGHER dome left-to-
//     right — they cross mid-air at different heights and depths (z) so the
//     paths never collide.
//   • awwwards follows on gba's exit.
// Icons (and/gba) spin AGAINST their travel at distinct rates; text logos
// (tokyo/awwwards) spin with it. Sizes keep every figure INSIDE the Lottie
// frame at its apex (rotated extent ≤ ~87% of the half-viewport, vs the
// Lottie's 2% inset). All values are live-tunable via Leva.
export const FIGURES: FigureDef[] = [
  {
    name: "and",
    url: "figures/and.glb",
    targetHeight: 3.4,
    arc: {
      legSpreadLandscape: 0.5,
      legSpreadPortrait: 0.95,
      rootDepth: 0.95,
      peakHeight: 0.42,
      side: 1,
      spinTurns: -0.6,
      rollPeak: 0.3,
      swingAmount: 0.5,
      window: [0, 0.34],
    },
  },
  {
    name: "tokyo",
    url: "figures/tokyo.glb",
    // Flies at z=+0.9 (perspective ×1.13) — 3.4 reads as ≈3.8 on screen.
    targetHeight: 3.4,
    arc: {
      legSpreadLandscape: 0.38,
      legSpreadPortrait: 0.72,
      rootDepth: 0.95,
      peakHeight: 0.33,
      side: -1,
      spinTurns: -0.5,
      rollPeak: 0.38,
      // Calmer pitch during the crossing — swing is what drives the figure's
      // z-reach (height × sin), and the crossing pair's depth gap must stay
      // larger than both reaches combined.
      swingAmount: 0.4,
      z: 0.9,
      window: [0.3, 0.64],
    },
    // Tokyo's stacked thin DoubleSide letters compound the attenuation tint
    // surface after surface, so its blue saturates far faster than the
    // boxier figures' (supervisor flagged it twice). #eef3ff read too blue,
    // pure white too gray next to the others — this midpoint keeps it in the
    // same cool family without the cast.
    material: { attenuationDistance: 16, attenuationColor: "#f6f9ff" },
  },
  {
    name: "gba",
    url: "figures/gba.glb",
    // Flies at z=−0.7 (perspective ×0.92) — 3.5 reads as ≈3.2 on screen.
    targetHeight: 3.5,
    arc: {
      legSpreadLandscape: 0.66,
      legSpreadPortrait: 1.0,
      rootDepth: 0.95,
      peakHeight: 0.5,
      side: 1,
      spinTurns: -0.85,
      rollPeak: -0.25,
      swingAmount: 0.45,
      z: -0.7,
      window: [0.385, 0.725],
    },
  },
  {
    name: "awwwards",
    url: "figures/awwwards.glb",
    targetHeight: 4.0,
    arc: {
      legSpreadLandscape: 0.5,
      legSpreadPortrait: 0.88,
      rootDepth: 0.95,
      peakHeight: 0.3,
      side: -1,
      spinTurns: -0.55,
      rollPeak: 0.35,
      swingAmount: 0.5,
      window: [0.66, 1],
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
  const z = cfg.z ?? 0;

  const start = new THREE.Vector3(-a, -root, z);
  const end = new THREE.Vector3(a, -root, z);

  // For a quadratic Bézier the midpoint is 0.25·start + 0.5·control + 0.25·end,
  // so its y is -0.5·root + 0.5·controlY. Solve controlY so the apex lands
  // exactly at `peak`:  controlY = 2·peak + root.
  const control = new THREE.Vector3(0, 2 * peak + root, z);

  return new THREE.QuadraticBezierCurve3(start, control, end);
}

