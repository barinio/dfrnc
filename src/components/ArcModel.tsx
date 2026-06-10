import { useRef, useEffect, useMemo } from "react";
import type { MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { useControls, folder } from "@debug/controls";
import { DURATION } from "../constants";
import { modelStateFor } from "../playback";
import type { Phase } from "../playback";
import { makeArc, BLUE_ARC } from "../arc";

useGLTF.setDecoderPath(
  "https://www.gstatic.com/draco/versioned/decoders/1.5.6/",
);

function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

export { DURATION };

const glassMaterial = new THREE.MeshPhysicalMaterial({
  color: new THREE.Color(0xffffff),
  metalness: 0.0,
  roughness: 0.15,
  transmission: 1.0,
  thickness: 1.2,
  ior: 1.45,
  dispersion: 1.5,
  attenuationColor: new THREE.Color(0xdde6ff),
  attenuationDistance: 4,
  clearcoat: 1.0,
  clearcoatRoughness: 0.05,
  iridescence: 0.6,
  iridescenceIOR: 1.7,
  iridescenceThicknessRange: [200, 600],
  envMapIntensity: 1.2,
  side: THREE.DoubleSide,
});

interface ArcModelProps {
  shouldStart?: boolean;
  scrollRef: MutableRefObject<number>;
  phase: Phase;
}

export default function ArcModel({
  shouldStart = true,
  scrollRef,
  phase,
}: ArcModelProps) {
  const { scene: modelScene } = useGLTF(import.meta.env.BASE_URL + "model.glb");
  const { viewport, pointer } = useThree();
  const modelRef = useRef<THREE.Group>(null);
  // Outer group: carries the curve position + a screen-space roll applied OUTSIDE
  // the spin (so the roll rotates the projected image, not the model's local Z).
  const rollGroupRef = useRef<THREE.Group>(null);
  // Scaled bounding-box center, used to make the model rotate about its visual
  // center (cursor parallax) instead of the GLB's off-center origin.
  const centerRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const elapsed = useRef<number>(0);
  const opacityRef = useRef<number>(1);
  const swingAmountRef = useRef<number>(0.56);
  const swingCyclesRef = useRef<number>(1);
  const rollPeakRef = useRef<number>(0.52);
  const spinTurnsRef = useRef<number>(0.55);
  const mouseRotX = useRef<number>(0);
  const mouseRotY = useRef<number>(0);

  // Material controls
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
        attenuationColor: "#dde6ff",
        attenuationDistance: { value: 4, min: 0, max: 20, step: 0.1 },
      }),
      Clearcoat: folder({
        clearcoat: { value: 1.0, min: 0, max: 1, step: 0.01 },
        clearcoatRoughness: { value: 0.05, min: 0, max: 1, step: 0.01 },
      }),
      Iridescence: folder({
        iridescence: { value: 0.6, min: 0, max: 1, step: 0.01 },
        iridescenceIOR: { value: 1.7, min: 1.0, max: 2.5, step: 0.01 },
        thicknessMin: { value: 200, min: 50, max: 1000, step: 1 },
        thicknessMax: { value: 600, min: 50, max: 1000, step: 1 },
      }),
    },
    { collapsed: true },
  );

  useEffect(() => {
    glassMaterial.color.set(color);
    glassMaterial.metalness = metalness;
    glassMaterial.roughness = roughness;
    glassMaterial.transmission = transmission;
    glassMaterial.thickness = thickness;
    glassMaterial.ior = ior;
    glassMaterial.envMapIntensity = envMapIntensity;
    glassMaterial.dispersion = dispersion;
    glassMaterial.attenuationColor.set(attenuationColor);
    glassMaterial.attenuationDistance = attenuationDistance;
    glassMaterial.clearcoat = clearcoat;
    glassMaterial.clearcoatRoughness = clearcoatRoughness;
    glassMaterial.iridescence = iridescence;
    glassMaterial.iridescenceIOR = iridescenceIOR;
    glassMaterial.iridescenceThicknessRange = [thicknessMin, thicknessMax];
    glassMaterial.needsUpdate = true;
  }, [
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
  ]);

  const { swingAmount, swingCycles, rollPeak } = useControls("Tilt", {
    swingAmount: {
      value: 0.56,
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
    rollPeak: {
      value: 0.52,
      min: -1.5,
      max: 1.5,
      step: 0.01,
      label: "Roll @ peak",
    },
  });

  // Keep refs in sync so useFrame always reads current values without stale closures
  useEffect(() => {
    swingAmountRef.current = swingAmount;
  }, [swingAmount]);
  useEffect(() => {
    swingCyclesRef.current = swingCycles;
  }, [swingCycles]);
  useEffect(() => {
    rollPeakRef.current = rollPeak;
  }, [rollPeak]);

  // Scroll-driven spin: total turn swept across the flight, face-on at the apex
  // (t = 0.5) and symmetric edge-on at both ends (t = 0 and t = 1). The model
  // counter-rotates as it flies; pair it with "Roll @ peak" for the 11→5 o'clock
  // tilt at the apex. Negative flips the spin direction.
  const { spinTurns } = useControls("Spin", {
    spinTurns: {
      value: 0.55,
      min: -3,
      max: 3,
      step: 0.05,
      label: "Turns",
    },
  });
  useEffect(() => {
    spinTurnsRef.current = spinTurns;
  }, [spinTurns]);

  // Blue-dome trajectory shape (live-tunable so the arc can be matched to the
  // reference precisely). Future models supply their own ArcConfig.
  const { peakHeight, legSpreadLandscape, legSpreadPortrait } = useControls(
    "Arc",
    {
      peakHeight: {
        value: BLUE_ARC.peakHeight,
        min: 0,
        max: 1.2,
        step: 0.01,
        label: "Peak Height",
      },
      legSpreadLandscape: {
        value: BLUE_ARC.legSpreadLandscape,
        min: 0.2,
        max: 1.2,
        step: 0.01,
        label: "Spread (desktop)",
      },
      legSpreadPortrait: {
        value: BLUE_ARC.legSpreadPortrait,
        min: 0.2,
        max: 1.2,
        step: 0.01,
        label: "Spread (mobile)",
      },
    },
  );

  // Assign the glass material to every mesh once the model is loaded.
  useEffect(() => {
    if (!modelScene) return;
    modelScene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.material = glassMaterial;
      }
    });
  }, [modelScene]);

  // Responsive scale: keep the model from dominating narrow/portrait viewports.
  // Reset scale before measuring so repeated runs don't compound. The target
  // size scales with viewport width (capped on desktop, floored on tiny phones)
  // so the model shrinks noticeably on narrow screens.
  useEffect(() => {
    if (!modelScene) return;
    modelScene.position.set(0, 0, 0);
    modelScene.scale.setScalar(1);
    const box = new THREE.Box3().setFromObject(modelScene);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const targetSize = Math.max(1.2, Math.min(2.5, viewport.width * 0.4));
    const s = targetSize / maxDim;
    modelScene.scale.setScalar(s);
    // Offset the geometry so its bounding-box center lands on the parent group's
    // origin; the parent's position is then compensated by the same center so
    // the composition is unchanged but rotation pivots about the visual center.
    const center = box.getCenter(new THREE.Vector3()).multiplyScalar(s);
    centerRef.current.copy(center);
    modelScene.position.set(-center.x, -center.y, -center.z);
  }, [modelScene, viewport.width, viewport.height]);

  // Symmetric blue dome: enters bottom-left, peaks top-center, exits
  // bottom-right (see makeArc). The apex lands exactly at the curve midpoint
  // (t = 0.5) — which is where the scroll-driven spin reaches face-on.
  const curve = useMemo(
    () =>
      makeArc(viewport.width, viewport.height, {
        ...BLUE_ARC,
        peakHeight,
        legSpreadLandscape,
        legSpreadPortrait,
      }),
    [
      viewport.width,
      viewport.height,
      peakHeight,
      legSpreadLandscape,
      legSpreadPortrait,
    ],
  );

  useEffect(() => {
    if (rollGroupRef.current) {
      const p0 = curve.getPoint(0);
      rollGroupRef.current.position.set(
        p0.x,
        p0.y + centerRef.current.y,
        p0.z + centerRef.current.z,
      );
    }
  }, [curve]);

  useFrame((_state, delta: number) => {
    if (!modelRef.current) return;

    // Drive playback straight from scroll progress (read via ref — no React
    // re-render). Position eased below; opacity applied at the end.
    const { time, opacity } = modelStateFor(scrollRef.current, phase);
    elapsed.current = time;
    opacityRef.current = opacity;

    const t = easeInOutSine(elapsed.current / DURATION);
    const pos = curve.getPoint(t);
    // The GLB's bounding-box center is offset from its origin (centerRef). Apply
    // that compensation on Y/Z to keep the tuned composition, but NOT on X — the
    // model's visual center then tracks the curve horizontally, so the dome
    // stays centered on screen (otherwise the large X offset drags it left).
    // Position lives on the outer group so the roll below pivots about it.
    if (rollGroupRef.current) {
      rollGroupRef.current.position.set(
        pos.x,
        pos.y + centerRef.current.y,
        pos.z + centerRef.current.z,
      );
      // Screen-space roll: applied outside the spin, so it rotates the projected
      // image. Peaks at the apex (zero at both ends); positive is counter-
      // clockwise, tipping the model's top toward ~11 o'clock (bottom → 5).
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
    // flight; the sign flips direction.
    const spinY = (0.5 - t) * spinTurnsRef.current * Math.PI * 2;
    modelRef.current.rotation.y = spinY + mouseRotY.current;
    // Pitch oscillation: top forward → top back, swingCycles times across the flight.
    modelRef.current.rotation.x =
      swingAmountRef.current *
        Math.sin(t * swingCyclesRef.current * -Math.PI * -0.9) +
      mouseRotX.current;

    // Scroll-driven opacity: 0 hides, 1 is fully opaque. Bidirectional so the
    // model fades back in if the user scrolls upward through the fade range.
    const op = Math.min(Math.max(opacityRef.current, 0), 1);
    const visible = op > 0.001;
    if (modelRef.current.visible !== visible)
      modelRef.current.visible = visible;
    glassMaterial.transparent = op < 1;
    glassMaterial.opacity = op;
  });

  if (!shouldStart) {
    return null;
  }

  return (
    <group ref={rollGroupRef}>
      <group ref={modelRef}>
        <primitive object={modelScene} />
      </group>
    </group>
  );
}

useGLTF.preload(import.meta.env.BASE_URL + "model.glb");
