import { Component, useState, useCallback, useEffect, Suspense } from "react";
import type { ComponentProps, ReactNode } from "react";
import Loader from "./Loader";
import { Canvas, useThree } from "@react-three/fiber";
import { Environment, useProgress } from "@react-three/drei";
import {
  EffectComposer,
  ToneMapping,
  Noise,
  SMAA,
} from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { ACESFilmicToneMapping } from "three";
import { Leva, useControls, folder } from "@debug/controls";
import ArcModel from "./ArcModel";
import LottiePlane from "./LottiePlane";
import GradientBackground from "./GradientBackground";
import VideoPlane from "./VideoPlane";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { useScrollProgressRef } from "../hooks/useScrollProgress";
import { figureVisibleFor } from "../playback";
import type { Phase } from "../playback";
import { SCROLL_TRACK_VH } from "../constants";
import { FIGURES } from "../arc";

class FigureBoundary extends Component<
  { name: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.error(`[figure:${this.props.name}] failed to load`, err);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function RendererConfig({ exposure }: { exposure: number }) {
  const { gl } = useThree();
  useEffect(() => {
    gl.toneMappingExposure = exposure;
  }, [gl, exposure]);
  return null;
}


export default function Scene() {
  const reducedMotion = usePrefersReducedMotion();
  const [levaVisible, setLevaVisible] = useState(false);
  const [animationStarted, setAnimationStarted] = useState(false);
  const [phase, setPhase] = useState<Phase>("scroll");
  // Scroll progress is a ref (no per-frame React renders); LottiePlane/ArcModel
  // read it inside useFrame. Only discrete transitions below use state.
  const scrollRef = useScrollProgressRef();
  const [figuresVisible, setFiguresVisible] = useState<boolean[]>(() =>
    FIGURES.map(() => false),
  );
  // Intro sequence: loader (balls) → drop (auto-played DEFT fall, Task 11) →
  // free (scroll-driven experience). Scroll stays locked until "free".
  type IntroStage = "loader" | "drop" | "free";
  const [introStage, setIntroStage] = useState<IntroStage>("loader");

  const { active, progress } = useProgress();
  const assetsReady =
    animationStarted && (reducedMotion || (!active && progress >= 100));

  const handleSettled = useCallback(() => {
    // Reduced motion skips the drop (the Lottie sits on its final frame).
    setIntroStage((s) =>
      s === "loader" ? (reducedMotion ? "free" : "drop") : s,
    );
  }, [reducedMotion]);

  const handleDropDone = useCallback(() => {
    setIntroStage("free");
  }, []);

  // Scroll lock for the whole intro: the page must not scroll under the
  // loader or the DEFT drop.
  useEffect(() => {
    const locked = introStage !== "free";
    document.body.classList.toggle("scroll-locked", locked);
    if (locked) window.scrollTo(0, 0);
    return () => document.body.classList.remove("scroll-locked");
  }, [introStage]);

  // Reduced motion: skip the whole scroll flow — Lottie jumps straight to the
  // last frame inside LottiePlane, nothing to animate.
  useEffect(() => {
    if (reducedMotion) setPhase("done");
  }, [reducedMotion]);

  // Discrete state derived from scroll — flips only when a threshold is crossed,
  // so scrolling itself causes no per-frame React renders (the setState calls
  // bail out when the value is unchanged).
  useEffect(() => {
    const update = () => {
      const sp = scrollRef.current;
      const fv = FIGURES.map(
        (f) => !reducedMotion && figureVisibleFor(sp, f.arc.window, phase),
      );
      setFiguresVisible((p) =>
        fv.length === p.length && fv.every((v, i) => v === p[i]) ? p : fv,
      );
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [scrollRef, reducedMotion, phase]);

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
          value: 0,
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

  return (
    <>
      <Leva hidden={!levaVisible} />
      <Loader
        assetsReady={assetsReady}
        reducedMotion={reducedMotion}
        hidden={introStage !== "loader"}
        onSettled={handleSettled}
      />
      <div className="canvas-layer">
        <Canvas
          frameloop="always"
          dpr={[1, 2]}
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
          <GradientBackground />
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
              scrollRef={scrollRef}
              phase={phase}
              introStage={introStage}
              onDropDone={handleDropDone}
            />
            {FIGURES.map(
              (f, i) =>
                !reducedMotion &&
                figuresVisible[i] && (
                  <FigureBoundary key={f.name} name={f.name}>
                    <Suspense fallback={null}>
                      <ArcModel figure={f} scrollRef={scrollRef} phase={phase} />
                    </Suspense>
                  </FigureBoundary>
                ),
            )}
          </Suspense>
          <VideoPlane scrollRef={scrollRef} phase={phase} />
          <EffectComposer multisampling={0} stencilBuffer={false}>
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
            <SMAA />
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
    </>
  );
}
