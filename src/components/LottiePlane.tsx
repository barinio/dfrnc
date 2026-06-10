import { useEffect, useState, useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import lottie from "lottie-web";
import type { AnimationItem } from "lottie-web";
import animationData from "../assets/animation.json";
import { LOTTIE_TOTAL_S } from "../constants";
import { lottieTimeFor } from "../playback";
import type { Phase } from "../playback";

const PLANE_Z = -1;
// Uniform transparent inset on all four sides (2% of the smaller dimension) so
// the dark page background frames the Lottie. Always applied — the margins are
// a deliberate design choice and must stay consistent on every pass/device.
const PADDING_RATIO = 0.02;

interface LottiePlaneProps {
  onComplete?: () => void;
  onAnimationStart?: () => void;
  reducedMotion?: boolean;
  scrollRef: MutableRefObject<number>;
  phase: Phase;
}

export default function LottiePlane({
  onComplete,
  onAnimationStart,
  reducedMotion = false,
  scrollRef,
  phase,
}: LottiePlaneProps) {
  const { viewport, camera, size, gl } = useThree();
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);
  // Once the animation is finished the canvas no longer changes, so we stop
  // uploading the texture to the GPU every frame.
  const doneRef = useRef<boolean>(false);
  const animRef = useRef<AnimationItem | null>(null);
  const texRef = useRef<THREE.CanvasTexture | null>(null);

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

    let tex: THREE.CanvasTexture | null = null;
    doneRef.current = false;

    const handleComplete = () => {
      doneRef.current = true;
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
  useFrame(() => {
    const anim = animRef.current;
    if (!anim || !texture) return;
    const tSec = lottieTimeFor(scrollRef.current, phase);
    if (tSec === lastTimeRef.current) return;
    lastTimeRef.current = tSec;
    const frac =
      LOTTIE_TOTAL_S > 0 ? Math.min(Math.max(tSec / LOTTIE_TOTAL_S, 0), 1) : 0;
    anim.goToAndStop(frac * Math.max(anim.totalFrames - 1, 0), true);
    if (texRef.current) texRef.current.needsUpdate = true;
  });

  const { planeWidth, planeHeight } = useMemo(() => {
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
    };
  }, [camera, viewport.width, viewport.height]);

  if (!texture) return null;

  return (
    <mesh position={[0, 0, PLANE_Z]}>
      <planeGeometry args={[planeWidth, planeHeight]} />
      {/* Small alphaTest discards only the near-zero-alpha letter gaps so the
          in-scene GradientBackground shows through, while keeping the material
          OPAQUE — transmissive materials only refract opaque objects, so the
          glass still refracts the text (on the dark gradient backdrop). */}
      <meshBasicMaterial map={texture} toneMapped={false} alphaTest={0.1} />
    </mesh>
  );
}
