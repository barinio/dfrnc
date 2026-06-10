import { useEffect, useRef } from "react";
import {
  drawLoopFrame,
  drawSettleFrame,
  loopScreenEmpty,
  TRAVEL_DURATION,
} from "./loaderPhysics";

interface LoaderProps {
  // GLTF/Draco/Lottie all ready (Scene's useProgress + animationStarted).
  assetsReady: boolean;
  reducedMotion: boolean;
  // Faded out (stage advanced past the loader). Kept mounted, like the old
  // Preloader, so the 0.5s opacity transition can play.
  hidden: boolean;
  // Fired exactly once, when the settle wave has fully rolled off (or
  // immediately on assetsReady under reduced motion).
  onSettled: () => void;
}

// Full-screen dark overlay with the bouncing-balls canvas. Loop runs while
// assets load — minimum one full ball pass — then switches to the settle
// physics at a moment when the screen is empty, so the hand-off is invisible.
export default function Loader({
  assetsReady,
  reducedMotion,
  hidden,
  onSettled,
}: LoaderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const assetsReadyRef = useRef(assetsReady);
  useEffect(() => {
    assetsReadyRef.current = assetsReady;
  }, [assetsReady]);
  const onSettledRef = useRef(onSettled);
  useEffect(() => {
    onSettledRef.current = onSettled;
  }, [onSettled]);
  const firedRef = useRef(false);

  useEffect(() => {
    if (reducedMotion || hidden) return;
    if (firedRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
    };
    window.addEventListener("resize", resize);
    resize();

    let raf = 0;
    let stage: "loop" | "settle" = "loop";
    let settleStart = 0;
    const start = performance.now();

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      if (stage === "loop") {
        const elapsed = now - start;
        drawLoopFrame(ctx, elapsed, w, h);
        // Gate (spec: minimum one full cycle even if assets load instantly):
        // loopScreenEmpty only turns true once every ball — including the
        // phase-offset stragglers — has finished a full travel pass, i.e. one
        // complete bounce iteration has played. Switching inside the empty
        // window makes the hand-off invisible. If the pacing feels rushed,
        // raise TRAVEL_DURATION here to TOTAL_CYCLE.
        if (
          assetsReadyRef.current &&
          elapsed >= TRAVEL_DURATION &&
          loopScreenEmpty(elapsed)
        ) {
          stage = "settle";
          settleStart = now;
        }
      } else {
        const done = drawSettleFrame(ctx, now - settleStart, w, h);
        if (done) {
          cancelAnimationFrame(raf);
          if (!firedRef.current) {
            firedRef.current = true;
            onSettledRef.current();
          }
          return;
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [reducedMotion, hidden]);

  // Reduced motion: no ball animation — release as soon as assets are ready.
  useEffect(() => {
    if (reducedMotion && assetsReady && !firedRef.current) {
      firedRef.current = true;
      onSettledRef.current();
    }
  }, [reducedMotion, assetsReady]);

  return (
    <div
      className={`loader-overlay${hidden ? " loader-overlay--hidden" : ""}`}
      aria-hidden
    >
      {!reducedMotion && !hidden && <canvas ref={canvasRef} className="loader-canvas" />}
    </div>
  );
}
