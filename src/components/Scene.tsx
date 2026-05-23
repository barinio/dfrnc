import { useState, useCallback, useRef, useEffect, Suspense } from "react";
import type { ComponentProps } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Environment, useProgress } from "@react-three/drei";
import {
  EffectComposer,
  Bloom,
  SMAA,
  ToneMapping,
} from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { ACESFilmicToneMapping } from "three";
import { Leva, useControls, folder } from "@debug/controls";
import ArcModel, { DURATION } from "./ArcModel";
import LottiePlane from "./LottiePlane";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";

function RendererConfig({ exposure }: { exposure: number }) {
  const { gl } = useThree();
  useEffect(() => {
    gl.toneMappingExposure = exposure;
  }, [gl, exposure]);
  return null;
}

// Paints exactly one frame after frameloop flips to "demand" so the final
// static state is rendered before the loop stops.
function InvalidateOnce({ active }: { active: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (active) invalidate();
  }, [active, invalidate]);
  return null;
}

function Preloader({ visible }: { visible: boolean }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0a0a0a",
        opacity: visible ? 1 : 0,
        transition: "opacity 0.5s ease-in-out",
        pointerEvents: visible ? "auto" : "none",
      }}
      aria-hidden={!visible}
    >
      <div className="dfrnc-spinner" />
    </div>
  );
}

export default function Scene() {
  const reducedMotion = usePrefersReducedMotion();
  const [visible, setVisible] = useState(false);
  const [animationStarted, setAnimationStarted] = useState(false);
  const [lottieDone, setLottieDone] = useState(false);
  const [modelDone, setModelDone] = useState(false);
  // Drive the fade through the DOM directly so it never re-renders the React
  // tree (and the EffectComposer) every frame.
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Preloader: hide once the GLTF/Draco assets are loaded and Lottie has started.
  // In reduced-motion mode the 3D model is never mounted, so nothing loads
  // through the GLTF manager — gate only on Lottie having started there.
  const { active, progress } = useProgress();
  const [hidePreloader, setHidePreloader] = useState(false);
  useEffect(() => {
    const assetsReady = reducedMotion || (!active && progress >= 100);
    if (assetsReady && animationStarted) setHidePreloader(true);
  }, [active, progress, animationStarted, reducedMotion]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === "l") {
        e.preventDefault();
        setVisible((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Shared playback controls — drive both the 3D model and the Lottie text so
  // pause/scrub/speed affect them together. Function form returns [values, set]
  // so the model can push its elapsed time back into the slider as it plays.
  const [{ paused, time, speed }, setAnim] = useControls("Animation", () => ({
    paused: false,
    time: { value: 0, min: 0, max: DURATION, step: 0.01 },
    speed: { value: 0.8, min: 0.1, max: 3, step: 0.05 },
  }));
  const handleTime = useCallback(
    (t: number) => setAnim({ time: t }),
    [setAnim],
  );

  const {
    ambientIntensity,
    toneMappingExposure,
    dir1Color,
    dir1Intensity,
    dir2Color,
    dir2Intensity,
    pt1Color,
    pt1Intensity,
    pt1Distance,
    pt2Color,
    pt2Intensity,
    pt2Distance,
  } = useControls(
    "Lighting",
    {
      ambientIntensity: { value: 0.5, min: 0, max: 3, step: 0.01 },
      toneMappingExposure: { value: 1.1, min: 0, max: 3, step: 0.01 },
      "Directional 1": folder({
        dir1Color: { label: "color", value: "#ffffff" },
        dir1Intensity: {
          label: "intensity",
          value: 3,
          min: 0,
          max: 10,
          step: 0.1,
        },
      }),
      "Directional 2": folder({
        dir2Color: { label: "color", value: "#ccddff" },
        dir2Intensity: {
          label: "intensity",
          value: 2,
          min: 0,
          max: 10,
          step: 0.1,
        },
      }),
      "Point 1": folder({
        pt1Color: { label: "color", value: "#ffffff" },
        pt1Intensity: {
          label: "intensity",
          value: 30,
          min: 0,
          max: 100,
          step: 1,
        },
        pt1Distance: {
          label: "distance",
          value: 20,
          min: 0,
          max: 50,
          step: 0.5,
        },
      }),
      "Point 2": folder({
        pt2Color: { label: "color", value: "#aaccff" },
        pt2Intensity: {
          label: "intensity",
          value: 20,
          min: 0,
          max: 100,
          step: 1,
        },
        pt2Distance: {
          label: "distance",
          value: 20,
          min: 0,
          max: 50,
          step: 0.5,
        },
      }),
    },
    { collapsed: true },
  );

  const { envPreset, envIntensity } = useControls("Environment", {
    envPreset: {
      value: "studio",
      options: [
        "studio",
        "city",
        "sunset",
        "dawn",
        "warehouse",
        "apartment",
        "lobby",
        "park",
      ],
    },
    envIntensity: { value: 0.65, min: 0, max: 3, step: 0.05 },
  });

  const handleFadeOut = useCallback((ft: number) => {
    const el = wrapperRef.current;
    if (el) el.style.opacity = String(1 - ft);
    if (ft >= 1) setModelDone(true);
  }, []);

  const handleAnimationStart = useCallback(() => {
    setAnimationStarted(true);
  }, []);

  const handleLottieComplete = useCallback(() => {
    setLottieDone(true);
  }, []);

  // Once everything has settled into its final static state, stop the render
  // loop entirely (demand) — nothing is animating, so there is nothing to redraw.
  const settled = reducedMotion ? lottieDone : lottieDone && modelDone;

  return (
    <>
      <Leva hidden={!visible} />
      <Preloader visible={!hidePreloader} />
      <div
        ref={wrapperRef}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1,
          pointerEvents: "none",
          opacity: 1,
        }}
      >
        <Canvas
          frameloop={settled ? "demand" : "always"}
          gl={{
            // AA is handled by SMAA in the composer. stencil:false avoids the
            // packed DEPTH_STENCIL buffer that three's MSAA transmission target
            // blits — the source of the glBlitFramebuffer error.
            antialias: false,
            stencil: false,
            toneMapping: ACESFilmicToneMapping,
            toneMappingExposure: 1.1,
          }}
          camera={{ fov: 60, near: 0.1, far: 100, position: [0, 0, 8] }}
          style={{ width: "100%", height: "100%" }}
        >
          <color attach="background" args={["#000000"]} />
          <RendererConfig exposure={toneMappingExposure} />
          <InvalidateOnce active={settled} />
          <ambientLight color={0xffffff} intensity={ambientIntensity} />
          <directionalLight
            color={dir1Color}
            intensity={dir1Intensity}
            position={[-3, 4, 5]}
          />
          <directionalLight
            color={dir2Color}
            intensity={dir2Intensity}
            position={[4, -2, 5]}
          />
          <pointLight
            color={pt1Color}
            intensity={pt1Intensity}
            distance={pt1Distance}
            position={[-2, 3, 4]}
          />
          <pointLight
            color={pt2Color}
            intensity={pt2Intensity}
            distance={pt2Distance}
            position={[3, -1, 4]}
          />
          <Environment
            preset={envPreset as ComponentProps<typeof Environment>["preset"]}
            environmentIntensity={envIntensity}
          />
          <Suspense fallback={null}>
            <LottiePlane
              reducedMotion={reducedMotion}
              onAnimationStart={handleAnimationStart}
              onComplete={handleLottieComplete}
              paused={paused}
              time={time}
              speed={1}
            />
            {!reducedMotion && (
              <ArcModel
                shouldStart={animationStarted}
                onFadeOut={handleFadeOut}
                onTimeChange={handleTime}
                paused={paused}
                time={time}
                speed={speed}
              />
            )}
          </Suspense>
          {/* multisampling={0}: the composer's MSAA resolve clashes with the
              transmission material's depth-stencil buffer (glBlitFramebuffer
              error). SMAA restores anti-aliasing as a cheap fullscreen pass. */}
          <EffectComposer multisampling={0}>
            {/* HDR-threshold bloom: the scene renders to a HalfFloat buffer, so
                the glass model's specular highlights exceed 1.0 while the (unlit)
                white Lottie text sits at exactly 1.0. threshold 1.0 blooms only
                the glass, never the text. Values are fixed — live-editing them in
                Leva re-instantiated the effect and dropped the glow until reload. */}
            <Bloom
              intensity={0.9}
              luminanceThreshold={1.0}
              luminanceSmoothing={0.2}
              mipmapBlur
            />
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
            <SMAA />
          </EffectComposer>
        </Canvas>
      </div>
    </>
  );
}
