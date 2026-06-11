import { useEffect, useState, useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import lottie from "lottie-web";
import type { AnimationItem } from "lottie-web";
import animationData from "../assets/animation.json";
import { LOTTIE_TOTAL_S, DEFT_DROP_S } from "../constants";
import { lottieTimeFor, lottieBleedFor } from "../playback";
import type { Phase } from "../playback";

export type IntroStage = "loader" | "drop" | "free";

// Deep enough that no rotated figure can reach it: the largest figure's
// rotated half-extent along z is ≈2.2 world units around arcs at z ∈
// [-0.7, +0.9], so everything clears z = -3 with margin. The plane sizes
// itself to fill the frustum at its depth, so the move is visually free —
// but letters no longer depth-clip the glass figures.
const PLANE_Z = -3;
// Uniform transparent inset on all four sides (2% of the smaller dimension) so
// the dark page background frames the Lottie. Always applied — the margins are
// a deliberate design choice and must stay consistent on every pass/device.
const PADDING_RATIO = 0.02;

interface LottiePlaneProps {
  onComplete?: () => void;
  onAnimationStart?: () => void;
  // Fired once when the auto-played drop reaches DEFT_DROP_S.
  onDropDone?: () => void;
  reducedMotion?: boolean;
  scrollRef: MutableRefObject<number>;
  phase: Phase;
  introStage: IntroStage;
}

export default function LottiePlane({
  onComplete,
  onAnimationStart,
  onDropDone,
  reducedMotion = false,
  scrollRef,
  phase,
  introStage,
}: LottiePlaneProps) {
  const { viewport, camera, size, gl } = useThree();
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);
  const animRef = useRef<AnimationItem | null>(null);
  const texRef = useRef<THREE.CanvasTexture | null>(null);
  const meshRef = useRef<THREE.Mesh>(null);

  useEffect(() => {
    const wrapper = document.createElement("div");
    wrapper.style.position = "absolute";
    wrapper.style.left = "-99999px";
    wrapper.style.top = "0";
    wrapper.style.width = `${size.width}px`;
    wrapper.style.height = `${size.height}px`;
    wrapper.style.background = "transparent";
    document.body.appendChild(wrapper);

    // Supersample the offscreen canvas: render the typography at up to 1.25×
    // the device DPR (hard-capped so the texture never exceeds 4096px) so the
    // alphaTest letter edges resolve crisply after linear filtering.
    // Phone-class viewports (short axis ≤ 480 CSS px, either orientation)
    // skip the extra supersampling — texture uploads on every scrubbed frame
    // are the mobile bottleneck (see 054779b).
    const ssMax = Math.min(size.width, size.height) <= 480 ? 1.0 : 1.25;
    const ssDpr = Math.max(
      1,
      Math.min(
        (window.devicePixelRatio || 1) * ssMax,
        4096 / Math.max(size.width, size.height),
      ),
    );

    const anim = lottie.loadAnimation({
      container: wrapper,
      renderer: "canvas",
      loop: false,
      // Never autoplay — the timeline is entirely scroll-driven (scrubbed via
      // the `time` prop). Reduced motion jumps straight to the final frame.
      autoplay: false,
      animationData,
      rendererSettings: {
        preserveAspectRatio: "none",
        clearCanvas: true,
        dpr: ssDpr,
      },
    });

    animRef.current = anim;
    // Fractional-frame rendering: goToAndStop receives non-integer frames from
    // the scroll scrub; without subframe rendering lottie-web floors them to
    // whole 30 fps steps. Explicit so playback smoothness never hinges on the
    // library default.
    anim.setSubframe(true);
    // Reset the scrub cache so the new instance isn't stuck on frame 0 until
    // the next scroll change (a resize destroys and recreates the lottie).
    lastTimeRef.current = -1;
    smoothSecRef.current = -1;

    let tex: THREE.CanvasTexture | null = null;

    const handleComplete = () => {
      if (tex) tex.needsUpdate = true; // flush the final frame once
      onComplete?.();
    };

    const handleLoaded = () => {
      const cnv = wrapper.querySelector("canvas") as HTMLCanvasElement | null;
      if (!cnv) return;
      tex = new THREE.CanvasTexture(cnv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      // No visual effect while minFilter is LinearFilter (no mipmaps) —
      // kept as preparation for a future mipmap upgrade.
      tex.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
      texRef.current = tex;
      setTexture(tex);
      onAnimationStart?.();

      if (reducedMotion) {
        // Skip the animated flythrough: jump straight to the final frame.
        anim.goToAndStop(Math.max(anim.totalFrames - 1, 0), true);
        handleComplete();
      }
    };

    anim.addEventListener("DOMLoaded", handleLoaded);
    anim.addEventListener("complete", handleComplete);

    return () => {
      anim.destroy();
      animRef.current = null;
      wrapper.remove();
      if (tex) tex.dispose();
      texRef.current = null;
    };
  }, [size.width, size.height, onComplete, onAnimationStart, reducedMotion, gl]);

  // Scrub the frame from scroll progress every frame, reading the scroll ref
  // (no React re-render involved). Only re-upload the texture when the target
  // frame actually changes, so an idle (non-scrolling) page does zero per-frame
  // GPU work.
  const lastTimeRef = useRef<number>(-1);
  // Temporally smoothed scrub time: wheel scrolling moves the page in coarse
  // discrete jumps, which used to skip whole stretches of the animation in a
  // single frame. The displayed time chases the scroll-derived target with a
  // framerate-independent lerp and snaps when settled (so the lastTimeRef
  // dedup resumes skipping idle work). -1 = uninitialized.
  const smoothSecRef = useRef<number>(-1);
  const dropClockRef = useRef<number>(0);
  const dropFiredRef = useRef<boolean>(false);
  const onDropDoneRef = useRef(onDropDone);
  useEffect(() => {
    onDropDoneRef.current = onDropDone;
  }, [onDropDone]);

  useFrame((_state, delta) => {
    const anim = animRef.current;
    if (!anim || !texture) return;

    // Frame dissolve: scale the padded plane up to full-bleed as the zoom +
    // video reveal begin (lottieBleedFor ramps over [VIDEO_START, +VIDEO_FADE]).
    // Applied every frame BEFORE the tSec dedup so the scale tracks scroll
    // even when the Lottie frame itself isn't changing.
    const bleed = lottieBleedFor(scrollRef.current);
    if (meshRef.current) {
      const sx = 1 + bleed * (bleedRatioXRef.current - 1);
      const sy = 1 + bleed * (bleedRatioYRef.current - 1);
      meshRef.current.scale.set(sx, sy, 1);
    }

    let tSec: number;
    if (introStage === "loader") {
      // Behind the loader overlay: hold the very first frame.
      tSec = 0;
    } else if (introStage === "drop") {
      // The one scroll-independent segment: auto-play 0 → DEFT_DROP_S.
      // Clamp delta so a background-tab resume (rAF halts while hidden, then
      // fires one huge delta on return) cannot skip past DEFT_DROP_S.
      dropClockRef.current += Math.min(delta, 1 / 30);
      tSec = Math.min(dropClockRef.current, DEFT_DROP_S);
      if (tSec >= DEFT_DROP_S && !dropFiredRef.current) {
        dropFiredRef.current = true;
        onDropDoneRef.current?.();
      }
    } else if (phase === "done") {
      // Reduced motion: the discrete frame swap is intentional — never animate
      // it, so the smoothing lerp must not run here.
      tSec = lottieTimeFor(scrollRef.current, phase);
    } else {
      // Scroll-driven; lottieTimeFor never returns less than DEFT_DROP_S, so
      // the drop can't replay on scroll-up. Smooth toward the target so coarse
      // wheel jumps glide through the timeline instead of skipping frames.
      const target = lottieTimeFor(scrollRef.current, phase);
      if (smoothSecRef.current < 0) smoothSecRef.current = target;
      smoothSecRef.current +=
        (target - smoothSecRef.current) * (1 - Math.exp(-delta * 10));
      // Snap within a quarter of a 30 fps frame so settling is invisible.
      if (Math.abs(target - smoothSecRef.current) < 1 / 120)
        smoothSecRef.current = target;
      tSec = smoothSecRef.current;
    }
    if (tSec === lastTimeRef.current) return;
    lastTimeRef.current = tSec;
    const frac =
      LOTTIE_TOTAL_S > 0 ? Math.min(Math.max(tSec / LOTTIE_TOTAL_S, 0), 1) : 0;
    anim.goToAndStop(frac * Math.max(anim.totalFrames - 1, 0), true);
    if (texRef.current) texRef.current.needsUpdate = true;
  });

  const { planeWidth, planeHeight, fullWidth, fullHeight } = useMemo(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const aspect = viewport.width / viewport.height;
    const distance = cam.position.z - PLANE_Z;
    const h = 2 * distance * Math.tan((cam.fov * Math.PI) / 360);
    const fullWidth = h * aspect;
    const fullHeight = h;
    // Same absolute inset on all four sides (based on the smaller dimension) so
    // the transparent margin reads as a uniform 2%. Unconditional, so it never
    // disappears between scroll passes.
    const margin = PADDING_RATIO * Math.min(fullWidth, fullHeight);
    return {
      planeWidth: fullWidth - margin * 2,
      planeHeight: fullHeight - margin * 2,
      fullWidth,
      fullHeight,
    };
  }, [camera, viewport.width, viewport.height]);

  // Stash the bleed-scale ratio in refs so the useFrame closure always sees the
  // freshest values after a resize re-render (R3F keeps the useFrame callback
  // current via its own mechanism, but memo values captured in a closure from a
  // previous render cycle would be stale on the first frame after resize).
  const bleedRatioXRef = useRef(1);
  const bleedRatioYRef = useRef(1);
  useEffect(() => {
    bleedRatioXRef.current = fullWidth / planeWidth;
    bleedRatioYRef.current = fullHeight / planeHeight;
  }, [fullWidth, planeWidth, fullHeight, planeHeight]);

  if (!texture) return null;

  return (
    <mesh ref={meshRef} position={[0, 0, PLANE_Z]}>
      <planeGeometry args={[planeWidth, planeHeight]} />
      {/* Small alphaTest discards only the near-zero-alpha letter gaps so the
          in-scene GradientBackground shows through, while keeping the material
          OPAQUE — transmissive materials only refract opaque objects, so the
          glass still refracts the text (on the dark gradient backdrop). */}
      <meshBasicMaterial map={texture} toneMapped={false} alphaTest={0.1} />
    </mesh>
  );
}
