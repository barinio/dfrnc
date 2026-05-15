import { useRef, useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { useControls, folder } from "leva";

useGLTF.setDecoderPath(
  "https://www.gstatic.com/draco/versioned/decoders/1.5.6/",
);

function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

const DURATION = 8.6;
const FADE_DURATION = 0.4;

const glassMaterial = new THREE.MeshPhysicalMaterial({
  color: new THREE.Color(0xffffff),
  metalness: 0.0,
  roughness: 0.15,
  transmission: 1.0,
  thickness: 1.2,
  ior: 1.45,
  dispersion: 1.5,
  attenuationColor: new THREE.Color(0xdde6ff),
  attenuationDistance: 4.0,
  clearcoat: 1.0,
  clearcoatRoughness: 0.05,
  iridescence: 0.6,
  iridescenceIOR: 1.7,
  iridescenceThicknessRange: [200, 600],
  envMapIntensity: 1.2,
  side: THREE.DoubleSide,
});

interface ArcModelProps {
  onFadeOut?: (ft: number) => void;
  shouldStart?: boolean;
}

export default function ArcModel({
  onFadeOut,
  shouldStart = true,
}: ArcModelProps) {
  const { scene: modelScene } = useGLTF("/model.glb");
  const { viewport } = useThree();
  const modelRef = useRef<THREE.Group>(null);
  const elapsed = useRef<number>(0);
  const fadeElapsed = useRef<number>(0);
  const isFading = useRef<boolean>(false);
  const isDone = useRef<boolean>(false);
  const pausedRef = useRef<boolean>(false);
  const speedRef = useRef<number>(1.0);
  const swingAmplitudeRef = useRef<number>(0.35);
  const swingFrequencyRef = useRef<number>(1.8);

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
  } = useControls("Material", {
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
      attenuationDistance: { value: 4.0, min: 0, max: 20, step: 0.1 },
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
  });

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

  // Animation controls — function form returns [values, set] for programmatic updates
  const [{ paused, time, speed }, setAnim] = useControls("Animation", () => ({
    paused: false,
    time: { value: 0, min: 0, max: DURATION, step: 0.01 },
    speed: { value: 0.8, min: 0.1, max: 3, step: 0.05 },
  }));

  const { swingAmplitude, swingFrequency } = useControls("Pendulum", {
    swingAmplitude: {
      value: 0.35,
      min: 0,
      max: 1.5,
      step: 0.01,
      label: "Amplitude",
    },
    swingFrequency: {
      value: 1.8,
      min: 0.1,
      max: 10,
      step: 0.05,
      label: "Frequency",
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
    swingAmplitudeRef.current = swingAmplitude;
  }, [swingAmplitude]);
  useEffect(() => {
    swingFrequencyRef.current = swingFrequency;
  }, [swingFrequency]);

  // When paused, time slider scrubs the animation position
  useEffect(() => {
    if (paused) elapsed.current = time;
  }, [time, paused]);

  useEffect(() => {
    if (!modelScene) return;
    const box = new THREE.Box3().setFromObject(modelScene);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    modelScene.scale.setScalar(2.5 / maxDim);
    modelScene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.material = glassMaterial;
      }
    });
  }, [modelScene]);

  const curve = useMemo(() => {
    const { width, height } = viewport;
    const start = new THREE.Vector3((-width / 2) * 0.5, (-height / 2) * 0.9, 0);
    const peak = new THREE.Vector3(0, height * 1.5, 0);
    const end = new THREE.Vector3((width / 1.5) * 0.8, (-height / 2) * 1.2, 0);
    return new THREE.QuadraticBezierCurve3(start, peak, end);
  }, [viewport.width, viewport.height]);

  useEffect(() => {
    if (modelRef.current) {
      const pos = curve.getPoint(0);
      modelRef.current.position.copy(pos);
    }
  }, [curve]);

  useFrame((_state, delta: number) => {
    if (isDone.current || !modelRef.current) return;

    if (!isFading.current) {
      if (!pausedRef.current) {
        elapsed.current = Math.min(
          elapsed.current + delta * speedRef.current,
          DURATION,
        );
        setAnim({ time: elapsed.current });
        if (elapsed.current >= DURATION) {
          isFading.current = true;
        }
      }

      const t = easeInOutSine(elapsed.current / DURATION);
      const pos = curve.getPoint(t);
      modelRef.current.position.copy(pos);
      modelRef.current.rotation.y = t * Math.PI * 0.3;
      modelRef.current.rotation.x =
        Math.sin(elapsed.current * swingFrequencyRef.current) *
        swingAmplitudeRef.current;
    } else {
      fadeElapsed.current = Math.min(
        fadeElapsed.current + delta,
        FADE_DURATION,
      );
      const ft = fadeElapsed.current / FADE_DURATION;
      onFadeOut?.(ft);
      if (fadeElapsed.current >= FADE_DURATION) {
        isDone.current = true;
        modelRef.current.visible = false;
      }
    }
  });

  if (!shouldStart) {
    return null;
  }

  return <primitive ref={modelRef} object={modelScene} />;
}

useGLTF.preload("/model.glb");
