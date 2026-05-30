import { useRef, useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { useControls, folder } from "@debug/controls";

useGLTF.setDecoderPath(
  "https://www.gstatic.com/draco/versioned/decoders/1.5.6/",
);

function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

export const DURATION = 8.6;

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
  onTimeChange?: (time: number) => void;
  shouldStart?: boolean;
  paused?: boolean;
  time?: number;
  speed?: number;
  opacity?: number;
}

export default function ArcModel({
  onTimeChange,
  shouldStart = true,
  paused = false,
  time = 0,
  speed = 0.8,
  opacity = 1,
}: ArcModelProps) {
  const { scene: modelScene } = useGLTF(import.meta.env.BASE_URL + "model.glb");
  const { viewport, pointer } = useThree();
  const modelRef = useRef<THREE.Group>(null);
  const elapsed = useRef<number>(0);
  const pausedRef = useRef<boolean>(false);
  const speedRef = useRef<number>(1.0);
  const opacityRef = useRef<number>(1);
  const swingAmountRef = useRef<number>(0.25);
  const swingCyclesRef = useRef<number>(1);
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

  const { swingAmount, swingCycles } = useControls("Tilt", {
    swingAmount: {
      value: 0.12,
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

  // Keep refs in sync so useFrame always reads current values without stale closures
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  useEffect(() => {
    opacityRef.current = opacity;
  }, [opacity]);
  useEffect(() => {
    swingAmountRef.current = swingAmount;
  }, [swingAmount]);
  useEffect(() => {
    swingCyclesRef.current = swingCycles;
  }, [swingCycles]);

  // When paused, time slider scrubs the animation position
  useEffect(() => {
    if (paused) elapsed.current = time;
  }, [time, paused]);

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
    modelScene.scale.setScalar(1);
    const box = new THREE.Box3().setFromObject(modelScene);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const targetSize = Math.max(1.2, Math.min(2.5, viewport.width * 0.4));
    modelScene.scale.setScalar(targetSize / maxDim);
  }, [modelScene, viewport.width, viewport.height]);

  // Contained arc: bottom-left corner → screen center → bottom-right corner.
  // The control point sits at top-center so the quadratic Bézier passes exactly
  // through (0,0) at its midpoint (t=0.5) and stays within y ∈ [-b, 0] — the
  // model never flies off the top, on any aspect ratio.
  const curve = useMemo(() => {
    const { width, height } = viewport;

    const a = (width / 2) * 0.95;
    const b = (height / 2) * 0.95;

    const aspect = width / height;
    const isPortrait = aspect < 1;

    // START
    const offsetX = isPortrait ? width * 0.35 : width * 0.15;
    const offsetY = height * 0.25;
    const start = new THREE.Vector3(-a + offsetX, -b + offsetY, 0);

    // CONTROL
    const control = new THREE.Vector3(
      width * (isPortrait ? 0.75 : 0.25),
      b + offsetY,
      0,
    );

    // END
    const endX = isPortrait ? a + width * 0.75 : a + width * 0.2;
    const endY = isPortrait ? -b - height * 0.05 : -b + height * 0.1;
    const end = new THREE.Vector3(endX, endY, 0);

    return new THREE.QuadraticBezierCurve3(start, control, end);
  }, [viewport.width, viewport.height]);

  useEffect(() => {
    if (modelRef.current) {
      const pos = curve.getPoint(0);
      modelRef.current.position.copy(pos);
    }
  }, [curve]);

  useEffect(() => {
    if (modelRef.current) {
      const pos = curve.getPoint(0);
      modelRef.current.position.copy(pos);
    }
  }, [curve]);

  useFrame((_state, delta: number) => {
    if (!modelRef.current) return;

    if (!pausedRef.current) {
      elapsed.current = Math.min(
        elapsed.current + delta * speedRef.current,
        DURATION,
      );
      onTimeChange?.(elapsed.current);
    }

    const t = easeInOutSine(elapsed.current / DURATION);
    const pos = curve.getPoint(t);
    modelRef.current.position.copy(pos);

    // Smooth mouse parallax — ~4° max, framerate-independent lerp
    const MOUSE_MAX = 0.07;
    const lerpK = 1 - Math.exp(-delta * 4);
    mouseRotY.current += (pointer.x * MOUSE_MAX - mouseRotY.current) * lerpK;
    mouseRotX.current += (-pointer.y * MOUSE_MAX - mouseRotX.current) * lerpK;

    modelRef.current.rotation.y = mouseRotY.current;
    modelRef.current.rotation.z = 0;
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

  return <primitive ref={modelRef} object={modelScene} />;
}

useGLTF.preload(import.meta.env.BASE_URL + "model.glb");
