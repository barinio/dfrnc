import { useState, useCallback, useEffect, Suspense } from "react";
import type { ComponentProps } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Environment, useProgress } from "@react-three/drei";
import {
  EffectComposer,
  ToneMapping,
  Noise,
} from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { ACESFilmicToneMapping } from "three";
import { Leva, useControls, folder } from "@debug/controls";
import ArcModel, { DURATION } from "./ArcModel";
import LottiePlane from "./LottiePlane";
import LoremSection from "./LoremSection";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { useScrollProgress } from "../hooks/useScrollProgress";
import {
  LOTTIE_INTRO_S,
  LOTTIE_INTRO_END,
  LOTTIE_TOTAL_S,
  MODEL_PHASE_END,
  SCROLL_TRACK_VH,
} from "../constants";

type Phase = "scroll" | "done";

// Width (in scroll-progress units) of the fade range used as the 3D model
// enters and leaves its phase. Symmetric so the transition is reversible on
// reverse scroll.
const FADE_RANGE = 0.05;
const FADE_END = MODEL_PHASE_END + FADE_RANGE;

function smoothstep(x: number): number {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
}

function RendererConfig({ exposure }: { exposure: number }) {
  const { gl } = useThree();
  useEffect(() => {
    gl.toneMappingExposure = exposure;
  }, [gl, exposure]);
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
  const [levaVisible, setLevaVisible] = useState(false);
  const [animationStarted, setAnimationStarted] = useState(false);
  const [phase, setPhase] = useState<Phase>("scroll");
  const scrollProgress = useScrollProgress();

  // Preloader: hide once GLTF/Draco assets are loaded and Lottie has started.
  const { active, progress } = useProgress();
  const [hidePreloader, setHidePreloader] = useState(false);
  useEffect(() => {
    const assetsReady = reducedMotion || (!active && progress >= 100);
    if (assetsReady && animationStarted) setHidePreloader(true);
  }, [active, progress, animationStarted, reducedMotion]);

  // Reduced motion: skip the whole scroll flow — Lottie jumps straight to the
  // last frame inside LottiePlane, nothing to animate.
  useEffect(() => {
    if (reducedMotion) setPhase("done");
  }, [reducedMotion]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === "l") {
        e.preventDefault();
        setLevaVisible((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

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
    envIntensity: { value: 0.05, min: 0, max: 3, step: 0.05 },
  });

  const handleAnimationStart = useCallback(() => {
    setAnimationStarted(true);
  }, []);

  // Everything is a pure function of scrollProgress — nothing autoplays — so
  // reverse scrolling rewinds every part of the experience (Lottie intro, arc,
  // fade, Lottie outro) symmetrically.
  let lottiePaused: boolean;
  let lottieTime: number;
  let modelMount: boolean;
  let modelTime: number;
  let modelOpacity: number;

  if (phase === "done") {
    lottiePaused = true;
    lottieTime = LOTTIE_TOTAL_S;
    modelMount = false;
    modelTime = DURATION;
    modelOpacity = 0;
  } else {
    lottiePaused = true;
    const sp = scrollProgress;

    // Lottie timeline: scrub the intro (0 → LOTTIE_INTRO_S), hold on the intro
    // frame while the arc plays, then scrub the remainder to the end.
    if (sp <= LOTTIE_INTRO_END) {
      lottieTime = (sp / LOTTIE_INTRO_END) * LOTTIE_INTRO_S;
    } else if (sp <= FADE_END) {
      lottieTime = LOTTIE_INTRO_S;
    } else {
      const t = (sp - FADE_END) / (1 - FADE_END);
      lottieTime = LOTTIE_INTRO_S + t * (LOTTIE_TOTAL_S - LOTTIE_INTRO_S);
    }

    // Arc position: 0..1 across the model phase, then pinned at the end.
    const arcT = Math.min(
      Math.max(
        (sp - LOTTIE_INTRO_END) / (MODEL_PHASE_END - LOTTIE_INTRO_END),
        0,
      ),
      1,
    );
    modelTime = arcT * DURATION;

    // Opacity: fade in as the arc enters its phase, fade out as it leaves.
    // Outside the phase the model is fully hidden.
    if (sp <= LOTTIE_INTRO_END || sp >= FADE_END) {
      modelOpacity = 0;
    } else if (sp < LOTTIE_INTRO_END + FADE_RANGE) {
      modelOpacity = smoothstep((sp - LOTTIE_INTRO_END) / FADE_RANGE);
    } else if (sp <= MODEL_PHASE_END) {
      modelOpacity = 1;
    } else {
      modelOpacity = smoothstep(1 - (sp - MODEL_PHASE_END) / FADE_RANGE);
    }

    // Mount only while it can be seen — cheap to remount since the model is
    // preloaded and elapsed is rewritten from `time` on each prop change.
    modelMount = modelOpacity > 0.001;
  }

  return (
    <>
      <Leva hidden={!levaVisible} />
      <Preloader visible={!hidePreloader} />
      {/* Animated gradient background (WebGL) rendered as the bottom layer.
          Everything above is transparent so this shows through. */}
      <iframe
        src="/bg_dunkel.html"
        title="background"
        style={{
          position: "fixed",
          inset: 0,
          width: "100%",
          height: "100%",
          border: "none",
          zIndex: 0,
          pointerEvents: "none",
        }}
        aria-hidden
      />
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1,
          pointerEvents: "none",
        }}
      >
        <Canvas
          frameloop="always"
          gl={{
            antialias: true,
            stencil: false,
            alpha: true,
            toneMapping: ACESFilmicToneMapping,
            toneMappingExposure: 1.1,
          }}
          camera={{ fov: 60, near: 0.1, far: 100, position: [0, 0, 8] }}
          style={{ width: "100%", height: "100%", background: "transparent" }}
        >
          <RendererConfig exposure={toneMappingExposure} />
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
              paused={lottiePaused}
              time={lottieTime}
              showPadding={lottieTime < LOTTIE_TOTAL_S - 0.001}
              speed={1}
            />
            {!reducedMotion && modelMount && (
              <ArcModel
                shouldStart
                paused
                time={modelTime}
                opacity={modelOpacity}
              />
            )}
          </Suspense>
          <EffectComposer multisampling={0} stencilBuffer={false}>
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
            <Noise opacity={0.1} />
          </EffectComposer>
        </Canvas>
      </div>
      {/* Scroll-track: provides the scrollable height that drives the model and
          Lottie phases. The Canvas itself is pinned via position: fixed above. */}
      <div
        style={{
          height: `${SCROLL_TRACK_VH}vh`,
          width: "100%",
          pointerEvents: "none",
        }}
        aria-hidden
      />
      <LoremSection visible={scrollProgress >= 1} />
    </>
  );
}
