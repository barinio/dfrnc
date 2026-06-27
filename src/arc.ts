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
  // the thin vertical text logo (tokyo) gets a little extra height to match the
  // visual weight of the squarish icons (and/gba). ArcModel caps the resulting
  // width at 85% of the viewport width on narrow screens.
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

// Launch order: and → tokyo → gba, alternating entry sides, with OVERLAPPING
// windows so the sequence reads as one continuous cascade:
//   • and starts at the very top of the figures phase — already airborne while
//     AUSGEZEICHNETES is still animating in (the phase begins inside the
//     Lottie reveal, see FIGURES_START).
//   • tokyo launches after `and` has passed its apex. It still overlaps the
//     tail of the first flight, but it is pushed forward in depth with
//     perspective-compensated size/spread so the two meshes no longer enter
//     each other while crossing the same screen area.
//     gba launches at 0.30 — the EARLIEST possible without a third figure in the
//     air: `and` lands at 0.30, so any earlier overlaps and+tokyo+gba (the design
//     keeps ≤2 airborne). It launches while tokyo is still descending, flying a
//     HIGHER dome left-to-right on the opposite side at a different depth (z) so
//     the two paths never collide. (The removed `awwwards` figure used to fill
//     this slot; when it went, gba was left launching only as tokyo LANDED, which
//     read as a late, detached final flight.) gba is the LAST figure and lands at
//     0.85 → sp ≈0.51, just AFTER the Lottie scrub / video reveal begins
//     (LOTTIE_SCRUB_START 0.5): it is ≈95% down by then (was ¾ at the slower
//     0.95 end), so the arc is ~13% snappier and the background continuation
//     resumes right as the last icon finishes — no dead air, no lingering tail.
// Icons (and/gba) spin AGAINST their travel at distinct rates; the text logo
// (tokyo) spins with it. NO opacity fades (FIGURE_FADE = 0): every figure
// enters/exits below the frame (rootDepth ≈ 1.4 sinks the entry/exit roots
// fully off-screen), so flights read as motion, never a dissolve.
// Sizes keep every figure INSIDE the Lottie frame at its apex. All values are
// live-tunable via Leva.
export const FIGURES: FigureDef[] = [
  {
    name: "and",
    url: "figures/and.glb",
    targetHeight: 3.4,
    arc: {
      legSpreadLandscape: 0.5,
      legSpreadPortrait: 0.95,
      // Deep enough that the entry/exit roots sit fully below the visible frame
      // (so the figure flies in/out instead of fading — FIGURE_FADE is 0).
      rootDepth: 1.4,
      peakHeight: 0.42,
      side: 1,
      spinTurns: -0.6,
      rollPeak: 0.3,
      swingAmount: 0.5,
      window: [0, 0.3],
    },
  },
  {
    name: "tokyo",
    url: "figures/tokyo.glb",
    // Flies well in front of `and` (z=+2.6) to keep the first two meshes from
    // intersecting. Size/spread/height are perspective-compensated so the
    // projected read stays close to the earlier z=+0.9 pass.
    targetHeight: 2.58,
    arc: {
      legSpreadLandscape: 0.29,
      legSpreadPortrait: 0.55,
      rootDepth: 1.06,
      peakHeight: 0.25,
      side: -1,
      spinTurns: -0.5,
      rollPeak: 0.38,
      // Calmer pitch during the crossing — swing is what drives the figure's
      // z-reach (height × sin), and the crossing pair's depth gap must stay
      // larger than both reaches combined.
      swingAmount: 0.28,
      z: 2.6,
      // Starts after `and` is past its apex, while still overlapping the first
      // flight's tail. The shorter 0.32 span keeps gba's handoff from drifting.
      window: [0.22, 0.54],
    },
    // Tokyo's stacked thin DoubleSide letters compound the attenuation tint
    // surface after surface, so its blue saturates far faster than the
    // boxier figures' (supervisor flagged it twice). #eef3ff read too blue,
    // pure white too gray next to the others — this midpoint keeps it in the
    // same cool family without the cast.
    material: { attenuationDistance: 20, attenuationColor: "#f6f9ff" },
  },
  {
    name: "gba",
    url: "figures/gba.glb",
    // Flies at z=−0.7 (perspective ×0.92). Shrunk ~13% (3.5 → 3.05) so it no
    // longer pokes past the frame at its apex (supervisor: "V" breaks the
    // bounds) — reads as ≈2.8 on screen.
    targetHeight: 3.05,
    arc: {
      legSpreadLandscape: 0.66,
      legSpreadPortrait: 1.0,
      rootDepth: 1.4,
      // Nudged below the 0.5 cap for extra top clearance now that it is the
      // tallest-apex figure flagged for overflow.
      peakHeight: 0.46,
      side: 1,
      spinTurns: -0.85,
      rollPeak: -0.25,
      swingAmount: 0.45,
      z: -0.7,
      // Launches at 0.30 — the EARLIEST it can without three figures airborne at
      // once (`and` lands at 0.30; any earlier overlaps and+tokyo+gba). The window
      // is **0.36 wide** so gba TRAVELS at roughly the same angular speed as `and`
      // (0.30) and tokyo (0.32): it used to span 0.55 (0.30→0.85), nearly double
      // the others, which read as a slow, floaty final flight (supervisor: "третя
      // іконка летить довго"). With the shorter window it lands at sp ≈0.425, so
      // LOTTIE_SCRUB_START was pulled in from 0.5 → 0.41 to keep the background
      // continuation resuming right as gba touches down (no dead air, no detached
      // launch). gba is ≈90% down at the (new) scrub start — see check-playback's
      // lastTatScrub assertion. Launch must stay < tokyo's window end (0.54).
      window: [0.3, 0.66],
    },
    // gba's chunky, thick body has the longest internal light paths of the set,
    // so the Beer-Lambert tint saturates blue hardest. Kept the WEAKEST of the
    // non-tokyo figures, but with a little blue back (round 2: #eef2f8 / 8 read
    // too gray) so it no longer looks plain glass.
    material: { attenuationDistance: 5.7, attenuationColor: "#dae4f5" },
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
