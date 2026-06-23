import { useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import lottie from "lottie-web";
import type { AnimationItem } from "lottie-web";
import titlesData from "../assets/titles.json";
import { galleryTitleFracFor, galleryTitleOpacityFor, GUTTER, MAX_ASPECT } from "../gallery";

// titles.json scrubbed by gallery progress. The 1000×1000 comp encodes the 3
// title frames at the right top(≈8%)/bottom(≈16%) positions, so a full-frame
// stretched render (preserveAspectRatio:"none"), inset by the 3% vmin gutter,
// reproduces the layout. The middle of the comp is transparent — the card stack
// renders there (a separate component). Titles never tilt.
const PLANE_Z = -1;

interface Props {
  galleryRef: MutableRefObject<number>;
  reducedMotion?: boolean;
}

export default function GalleryTitles({ galleryRef, reducedMotion = false }: Props) {
  const { viewport, camera, size, gl } = useThree();
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);
  const animRef = useRef<AnimationItem | null>(null);
  const texRef = useRef<THREE.CanvasTexture | null>(null);
  const lastFrameRef = useRef<number>(-1);
  const smoothRef = useRef<number>(-1);
  const matRef = useRef<THREE.MeshBasicMaterial | null>(null);

  useEffect(() => {
    const wrapper = document.createElement("div");
    wrapper.style.position = "absolute";
    wrapper.style.left = "-99999px";
    wrapper.style.top = "0";
    wrapper.style.width = `${size.width}px`;
    wrapper.style.height = `${size.height}px`;
    wrapper.style.background = "transparent";
    document.body.appendChild(wrapper);

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
      autoplay: false,
      animationData: titlesData,
      rendererSettings: { preserveAspectRatio: "none", clearCanvas: true, dpr: ssDpr },
    });
    animRef.current = anim;
    anim.setSubframe(true);
    lastFrameRef.current = -1;
    smoothRef.current = -1;

    let tex: THREE.CanvasTexture | null = null;
    const handleLoaded = () => {
      const cnv = wrapper.querySelector("canvas") as HTMLCanvasElement | null;
      if (!cnv) return;
      tex = new THREE.CanvasTexture(cnv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
      texRef.current = tex;
      setTexture(tex);
      anim.goToAndStop(0, true);
    };
    anim.addEventListener("DOMLoaded", handleLoaded);

    return () => {
      anim.destroy();
      animRef.current = null;
      wrapper.remove();
      if (tex) tex.dispose();
      texRef.current = null;
    };
  }, [size.width, size.height, gl]);

  useFrame((_s, delta) => {
    const anim = animRef.current;
    if (!anim || !texRef.current) return;
    const target = galleryTitleFracFor(galleryRef.current); // 0..1
    let frac: number;
    if (reducedMotion) {
      frac = target; // discrete, no smoothing
    } else {
      if (smoothRef.current < 0) smoothRef.current = target;
      smoothRef.current += (target - smoothRef.current) * (1 - Math.exp(-delta * 10));
      if (Math.abs(target - smoothRef.current) < 1 / 120) smoothRef.current = target;
      frac = smoothRef.current;
    }
    const frame = frac * Math.max(anim.totalFrames - 1, 0);
    if (frame === lastFrameRef.current) return;
    lastFrameRef.current = frame;
    anim.goToAndStop(frame, true);
    if (texRef.current) texRef.current.needsUpdate = true;
    if (matRef.current) matRef.current.opacity = galleryTitleOpacityFor(galleryRef.current);
  });

  const { planeWidth, planeHeight } = useMemo(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const aspect = viewport.width / viewport.height;
    const distance = cam.position.z - PLANE_Z;
    const fullHeight = 2 * distance * Math.tan((cam.fov * Math.PI) / 360);
    const fullWidth = fullHeight * aspect;
    const margin = GUTTER * Math.min(fullWidth, fullHeight); // 3% vmin gutter
    const innerH = fullHeight - margin * 2;
    // Cap content width at 16:9 (letterbox beyond) so titles don't over-stretch
    // on ultra-wide viewports.
    const innerW = Math.min(fullWidth - margin * 2, MAX_ASPECT * innerH);
    return { planeWidth: innerW, planeHeight: innerH };
  }, [camera, viewport.width, viewport.height]);

  if (!texture) return null;

  return (
    <mesh position={[0, 0, PLANE_Z]}>
      <planeGeometry args={[planeWidth, planeHeight]} />
      <meshBasicMaterial ref={matRef} map={texture} toneMapped={false} transparent alphaTest={0.1} />
    </mesh>
  );
}
