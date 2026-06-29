import { useRef, useEffect, useLayoutEffect, useMemo } from "react";
import type { MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { useControls, folder } from "@debug/controls";
import { figureStateFor } from "../playback";
import type { Phase } from "../playback";
import { makeArc, FIGURES } from "../arc";
import type { FigureDef } from "../arc";
import type { FigureMaterialMode } from "../renderProfile";

useGLTF.setDecoderPath(
  "https://www.gstatic.com/draco/versioned/decoders/1.5.6/",
);

function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

// One template material; each figure gets its own pool clone so overlapping
// figures can fade with independent opacities while sharing the same tuned look.
const baseGlassMaterial = new THREE.MeshPhysicalMaterial({
  color: new THREE.Color(0xffffff),
  metalness: 0.0,
  roughness: 0.15,
  transmission: 1.0,
  thickness: 1.2,
  ior: 1.45,
  dispersion: 1.5,
  // Cool tint kept LIGHT but with a touch of blue back (supervisor round 2:
  // #e6eaf2 read too gray). Sits between the original #dde6ff and the gray pass.
  attenuationColor: new THREE.Color(0xe1e7f6),
  attenuationDistance: 4.5,
  clearcoat: 1.0,
  clearcoatRoughness: 0.05,
  iridescence: 0.45,
  iridescenceIOR: 1.7,
  iridescenceThicknessRange: [200, 600],
  envMapIntensity: 1.2,
  side: THREE.DoubleSide,
});

const LIGHT_GLASS_OPACITY = 0.78;
const baseLightGlassMaterial = new THREE.MeshPhysicalMaterial({
  color: new THREE.Color(0xe7edf8),
  metalness: 0.0,
  roughness: 0.22,
  transmission: 0,
  thickness: 0,
  ior: 1.35,
  dispersion: 0,
  attenuationColor: new THREE.Color(0xe7edf8),
  attenuationDistance: 100,
  clearcoat: 0.35,
  clearcoatRoughness: 0.25,
  iridescence: 0.18,
  iridescenceIOR: 1.35,
  iridescenceThicknessRange: [180, 420],
  envMapIntensity: 0.25,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: LIGHT_GLASS_OPACITY,
  depthWrite: false,
});

// One clone per figure, created lazily and NEVER disposed: disposing on
// unmount would release the (very expensive) transmission shader program and
// force a recompile stall on every window-edge remount while scrolling. Four
// figures ⇒ at most four materials for the session.
const materialPool = new Map<string, THREE.MeshPhysicalMaterial>();

// Live smoothed opacity per figure, written every frame. Scene reads it on
// scroll events to keep a figure MOUNTED while its temporal fade-out is still
// decaying — the window-based mount grace alone is a scroll-distance budget
// and can't cover fast flicks (the fade decays in time, not scroll distance).
export const figureOpacityLive = new Map<string, number>();

function materialFor(
  name: string,
  mode: FigureMaterialMode,
): THREE.MeshPhysicalMaterial {
  const key = `${mode}:${name}`;
  let m = materialPool.get(key);
  if (!m) {
    m =
      mode === "light"
        ? baseLightGlassMaterial.clone()
        : baseGlassMaterial.clone();
    materialPool.set(key, m);
  }
  return m;
}

interface ArcModelProps {
  figure: FigureDef;
  scrollRef: MutableRefObject<number>;
  phase: Phase;
  materialMode?: FigureMaterialMode;
}

export default function ArcModel({
  figure,
  scrollRef,
  phase,
  materialMode = "full",
}: ArcModelProps) {
  const { scene: modelScene } = useGLTF(
    import.meta.env.BASE_URL + figure.url,
  );
  const { viewport, pointer } = useThree();
  const modelRef = useRef<THREE.Group>(null);
  // Outer group: carries the curve position + a screen-space roll applied
  // OUTSIDE the spin (so the roll rotates the projected image, not local Z).
  const rollGroupRef = useRef<THREE.Group>(null);
  const mouseRotX = useRef<number>(0);
  const mouseRotY = useRef<number>(0);

  // Per-figure clone of the shared glass template from the module-level pool.
  // The Material controls below use identical keys in every instance, so leva's
  // global store keeps all clones in sync in dev; the prod stub returns the same
  // defaults per call.
  const material = useMemo(
    () => materialFor(figure.name, materialMode),
    [figure.name, materialMode],
  );

  const {
    color,
    metalness,
    roughness,
    transmission,
    thickness,
    ior,
    envMapIntensity,
    dispersion,
    attenuationColor,
    attenuationDistance,
    clearcoat,
    clearcoatRoughness,
    iridescence,
    iridescenceIOR,
    thicknessMin,
    thicknessMax,
  } = useControls(
    "Material",
    {
      Core: folder({
        color: "#a2a2a2",
        metalness: { value: 0.0, min: 0, max: 1, step: 0.01 },
        roughness: { value: 0.15, min: 0, max: 1, step: 0.01 },
        transmission: { value: 1.0, min: 0, max: 1, step: 0.01 },
        thickness: { value: 1.2, min: 0, max: 5, step: 0.05 },
        ior: { value: 1.45, min: 1.0, max: 2.5, step: 0.01 },
        envMapIntensity: { value: 1.2, min: 0, max: 5, step: 0.05 },
      }),
      Glass: folder({
        dispersion: { value: 1.5, min: 0, max: 10, step: 0.1 },
        // A touch of blue restored (was #e6eaf2 / 5 — too gray) while staying
        // well short of the original #dde6ff cast. tokyo/gba override this.
        attenuationColor: "#e0e7f6",
        attenuationDistance: { value: 4.4, min: 0, max: 20, step: 0.1 },
      }),
      Clearcoat: folder({
        clearcoat: { value: 1.0, min: 0, max: 1, step: 0.01 },
        clearcoatRoughness: { value: 0.05, min: 0, max: 1, step: 0.01 },
      }),
      Iridescence: folder({
        iridescence: { value: 0.45, min: 0, max: 1, step: 0.01 },
        iridescenceIOR: { value: 1.7, min: 1.0, max: 2.5, step: 0.01 },
        thicknessMin: { value: 200, min: 50, max: 1000, step: 1 },
        thicknessMax: { value: 600, min: 50, max: 1000, step: 1 },
      }),
    },
    { collapsed: true },
  );

  useEffect(() => {
    if (materialMode === "light") {
      material.color.set(figure.material?.attenuationColor ?? "#e7edf8");
      material.metalness = 0;
      material.roughness = 0.22;
      material.transmission = 0;
      material.thickness = 0;
      material.ior = 1.35;
      material.envMapIntensity = 0.25;
      material.dispersion = 0;
      material.attenuationColor.set(
        figure.material?.attenuationColor ?? "#e7edf8",
      );
      material.attenuationDistance =
        figure.material?.attenuationDistance !== undefined
          ? Math.max(figure.material.attenuationDistance, 20)
          : 100;
      material.clearcoat = 0.35;
      material.clearcoatRoughness = 0.25;
      material.iridescence = 0.18;
      material.iridescenceIOR = 1.35;
      material.iridescenceThicknessRange = [180, 420];
      material.transparent = true;
      material.depthWrite = false;
      material.needsUpdate = true;
      return;
    }

    material.color.set(color);
    material.metalness = metalness;
    material.roughness = roughness;
    material.transmission = transmission;
    material.thickness = thickness;
    material.ior = ior;
    material.envMapIntensity = envMapIntensity;
    material.dispersion = dispersion;
    material.attenuationColor.set(attenuationColor);
    material.attenuationDistance = attenuationDistance;
    material.clearcoat = clearcoat;
    material.clearcoatRoughness = clearcoatRoughness;
    material.iridescence = iridescence;
    material.iridescenceIOR = iridescenceIOR;
    material.iridescenceThicknessRange = [thicknessMin, thicknessMax];
    // Per-figure overrides (manifest) win over the shared Leva values — thin
    // figures need weaker attenuation so edge-on views don't saturate blue.
    const ov = figure.material;
    if (ov?.attenuationColor) material.attenuationColor.set(ov.attenuationColor);
    if (ov?.attenuationDistance !== undefined)
      material.attenuationDistance = ov.attenuationDistance;
    if (ov?.thickness !== undefined) material.thickness = ov.thickness;
    material.needsUpdate = true;
  }, [
    material,
    color,
    metalness,
    roughness,
    transmission,
    thickness,
    ior,
    envMapIntensity,
    dispersion,
    attenuationColor,
    attenuationDistance,
    clearcoat,
    clearcoatRoughness,
    iridescence,
    iridescenceIOR,
    thicknessMin,
    thicknessMax,
    figure.material,
    materialMode,
  ]);

  // Per-figure flight tuning, one Leva folder per figure. Defaults come from
  // the manifest; tweak live (Cmd+L), then write keepers back into arc.ts.
  const {
    peakHeight,
    legSpreadLandscape,
    legSpreadPortrait,
    spinTurns,
    rollPeak,
    swingAmount,
    swingCycles,
  } = useControls(`Figure ${figure.name}`, {
    peakHeight: {
      value: figure.arc.peakHeight,
      min: 0,
      max: 1.2,
      step: 0.01,
      label: "Peak Height",
    },
    legSpreadLandscape: {
      value: figure.arc.legSpreadLandscape,
      min: 0.2,
      max: 1.2,
      step: 0.01,
      label: "Spread (desktop)",
    },
    legSpreadPortrait: {
      value: figure.arc.legSpreadPortrait,
      min: 0.2,
      max: 1.2,
      step: 0.01,
      label: "Spread (mobile)",
    },
    spinTurns: {
      value: figure.arc.spinTurns,
      min: -3,
      max: 3,
      step: 0.05,
      label: "Spin Turns",
    },
    rollPeak: {
      value: figure.arc.rollPeak,
      min: -1.5,
      max: 1.5,
      step: 0.01,
      label: "Roll @ peak",
    },
    swingAmount: {
      value: figure.arc.swingAmount,
      min: 0,
      max: 1.0,
      step: 0.01,
      label: "Swing Amount",
    },
    swingCycles: {
      value: 1,
      min: 1,
      max: 10,
      step: 0.5,
      label: "Swing Cycles",
    },
  });

  // Keep refs in sync so useFrame always reads current values without stale
  // closures.
  const spinTurnsRef = useRef(spinTurns);
  const rollPeakRef = useRef(rollPeak);
  const swingAmountRef = useRef(swingAmount);
  const swingCyclesRef = useRef(swingCycles);
  useEffect(() => {
    spinTurnsRef.current = spinTurns;
    rollPeakRef.current = rollPeak;
    swingAmountRef.current = swingAmount;
    swingCyclesRef.current = swingCycles;
  }, [spinTurns, rollPeak, swingAmount, swingCycles]);

  // Assign this figure's material to every mesh once the model is loaded.
  // useLayoutEffect commits synchronously before the next rendered frame,
  // preventing a one-frame flash of the wrong material on mount.
  useLayoutEffect(() => {
    if (!modelScene) return;
    modelScene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.material = material;
      }
    });
  }, [modelScene, material]);

  // Scale to the manifest's targetHeight: normalizing the VERTICAL extent
  // (not the max bbox dimension, which let depth/width shrink the thin text
  // logos to slivers) is what makes the mixed set read similar in size. The
  // width cap only engages on narrow/portrait viewports, where the world
  // viewport height is unchanged but the width shrinks. Reset scale before
  // measuring so repeated runs don't compound. useLayoutEffect commits
  // synchronously before the next rendered frame so scale and centering are
  // correct from the very first frame on mount.
  useLayoutEffect(() => {
    if (!modelScene) return;
    modelScene.position.set(0, 0, 0);
    modelScene.scale.setScalar(1);
    const box = new THREE.Box3().setFromObject(modelScene);
    const size = box.getSize(new THREE.Vector3());
    const s = Math.min(
      figure.targetHeight / Math.max(size.y, 1e-6),
      (viewport.width * 0.85) / Math.max(size.x, 1e-6),
    );
    modelScene.scale.setScalar(s);
    // Offset the geometry so its bounding-box center lands on the parent
    // group's origin; the group's position is then driven purely by the curve
    // point so rotation pivots about the visual center on all axes.
    const center = box.getCenter(new THREE.Vector3()).multiplyScalar(s);
    modelScene.position.set(-center.x, -center.y, -center.z);
  }, [modelScene, viewport.width, viewport.height, figure.targetHeight]);

  // This figure's dome. side mirrors travel; the apex lands at the curve
  // midpoint (t = 0.5) — which is where the apex-centred spin reads frontal.
  const curve = useMemo(
    () =>
      makeArc(viewport.width, viewport.height, {
        ...figure.arc,
        peakHeight,
        legSpreadLandscape,
        legSpreadPortrait,
      }),
    [
      viewport.width,
      viewport.height,
      figure.arc,
      peakHeight,
      legSpreadLandscape,
      legSpreadPortrait,
    ],
  );

  // Temporal smoothing of the scroll-derived state. Scroll input is DISCRETE
  // (a wheel tick can jump the progress far in one event), which used to make
  // figures pop in mid-flight and judder along the arc. The flight t and the
  // opacity each chase their scroll-driven target with a framerate-independent
  // exponential lerp: position glides, and the opacity — starting from 0 on
  // every mount — always FADES in/out even when the scroll lands inside the
  // window in a single jump. (figureVisibleFor's mount grace keeps the
  // component alive past its window so the fade-out can finish.)
  const smoothTRef = useRef<number | null>(null);
  const smoothOpacityRef = useRef<number>(0);

  // Zero the live-opacity report on unmount so a stale value can't keep
  // re-mounting the figure on later scroll events.
  useEffect(() => {
    return () => {
      figureOpacityLive.set(figure.name, 0);
    };
  }, [figure.name]);

  useFrame((_state, delta: number) => {
    if (!modelRef.current) return;

    // Drive playback straight from scroll progress (read via ref — no React
    // re-render). Each figure maps its own window of the figures phase.
    const { t: targetT, opacity: targetOpacity } = figureStateFor(
      scrollRef.current,
      figure.arc.window,
      phase,
    );

    // Position starts AT its target on mount (no drift-in from a stale spot);
    // opacity always starts at 0 so the entry is a fade no matter how the
    // scroll arrived. Snap when settled so an idle page stops changing state.
    if (smoothTRef.current === null) smoothTRef.current = targetT;
    const kPos = 1 - Math.exp(-delta * 10);
    const kOp = 1 - Math.exp(-delta * 9);
    smoothTRef.current += (targetT - smoothTRef.current) * kPos;
    if (Math.abs(targetT - smoothTRef.current) < 0.0005)
      smoothTRef.current = targetT;
    smoothOpacityRef.current +=
      (targetOpacity - smoothOpacityRef.current) * kOp;
    if (Math.abs(targetOpacity - smoothOpacityRef.current) < 0.001)
      smoothOpacityRef.current = targetOpacity;
    figureOpacityLive.set(figure.name, smoothOpacityRef.current);

    const t = easeInOutSine(smoothTRef.current);
    const pos = curve.getPoint(t);
    // The geometry is re-centered on its bounding-box center inside the group,
    // so the curve point IS the figure's visual center on every axis.
    // peakHeight therefore reads directly as the apex height of the visual center.
    if (rollGroupRef.current) {
      rollGroupRef.current.position.set(pos.x, pos.y, pos.z);
      // Screen-space roll: applied outside the spin, so it rotates the
      // projected image. Peaks at the apex (zero at both ends).
      rollGroupRef.current.rotation.z =
        rollPeakRef.current * Math.sin(t * Math.PI);
    }

    // Smooth mouse parallax — ~4° max, framerate-independent lerp
    const MOUSE_MAX = 0.07;
    const lerpK = 1 - Math.exp(-delta * 4);
    mouseRotY.current += (pointer.x * MOUSE_MAX - mouseRotY.current) * lerpK;
    mouseRotX.current += (-pointer.y * MOUSE_MAX - mouseRotX.current) * lerpK;

    // Apex-centred spin: zero (frontal) exactly at t = 0.5 — the dome apex —
    // edge-on entering and leaving. spinTurns is the total turn across the
    // flight; the sign flips direction. Reverses on scroll-up (t tracks scroll).
    const spinY = (0.5 - t) * spinTurnsRef.current * Math.PI * 2;
    modelRef.current.rotation.y = spinY + mouseRotY.current;
    // Pitch oscillation: top forward → top back, swingCycles times per flight.
    modelRef.current.rotation.x =
      swingAmountRef.current *
        Math.sin(t * swingCyclesRef.current * -Math.PI * -0.9) +
      mouseRotX.current;

    // Scroll-driven opacity — bidirectional so the figure fades back in when
    // the user scrolls upward through its window.
    const op = Math.min(Math.max(smoothOpacityRef.current, 0), 1);
    const visible = op > 0.001;
    if (modelRef.current.visible !== visible)
      modelRef.current.visible = visible;
    material.transparent = materialMode === "light" || op < 1;
    material.depthWrite = materialMode !== "light" && op >= 1;
    material.opacity = op * (materialMode === "light" ? LIGHT_GLASS_OPACITY : 1);
  });

  return (
    <group ref={rollGroupRef}>
      {/* Hidden until the first useFrame computes real position/opacity — the
          pooled material can carry stale opacity from a previous unmount. */}
      <group ref={modelRef} visible={false}>
        <primitive object={modelScene} />
      </group>
    </group>
  );
}

FIGURES.forEach((f) => {
  useGLTF.preload(import.meta.env.BASE_URL + f.url);
});
