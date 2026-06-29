import { useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import lottie from "lottie-web";
import type { AnimationItem } from "lottie-web";
import titlesData from "../assets/titles.json";
import {
  galleryTitleFrameFor,
  isGalleryTitleHoldFrame,
  GUTTER,
  MAX_ASPECT,
} from "../gallery";

// titles.json scrubbed by the UNIFIED card progress `cp` (galleryCardProgressFor):
// the 5 title texts squish in over BOTH the video card (slide #1) and the image
// cards — each text appears while ITS card is showing. The 1000×1000 comp encodes
// the title frames at the top(≈8%)/bottom(≈16%) positions, so a full-frame
// stretched render (preserveAspectRatio:"none"), inset by the 3% vmin gutter,
// reproduces the layout. The middle of the comp is transparent — the card stack
// renders there (a separate component). Titles never tilt.
//
// The comp is rendered as TWO half-height planes (top band v∈[0.5,1] = the top
// title line, bottom band v∈[0,0.5] = the bottom title block) so that on the
// card-9 exit the TOP slides UP and the BOTTOM slides DOWN out of frame. The
// comp's middle (v≈0.5) is transparent, so the split never cuts a glyph.
const PLANE_Z = -1;
const TITLE_SPLIT_GUARD = 0.004;
const TITLE_EXIT_OVERSCAN = 0.04;

// Remap a PlaneGeometry's UV v-range (default 0..1, bottom→top) to [v0, v1] so
// the plane samples only that horizontal band of the shared title texture.
function remapV(geo: THREE.PlaneGeometry, v0: number, v1: number) {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    uv.setY(i, v0 + (v1 - v0) * uv.getY(i));
  }
  uv.needsUpdate = true;
}

interface Props {
  galleryRef: MutableRefObject<number>;
  cardExitRef: MutableRefObject<number>;
  reducedMotion?: boolean;
  maxTextureDpr?: number;
  textureFrameRate?: number;
}

export default function GalleryTitles({
  galleryRef,
  cardExitRef,
  reducedMotion = false,
  maxTextureDpr = Infinity,
  textureFrameRate = Infinity,
}: Props) {
  const { viewport, camera, size, gl } = useThree();
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);
  const animRef = useRef<AnimationItem | null>(null);
  const texRef = useRef<THREE.CanvasTexture | null>(null);
  const lastFrameRef = useRef<number>(-1);
  const smoothRef = useRef<number>(-1);
  const matTopRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const matBottomRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const meshTopRef = useRef<THREE.Mesh | null>(null);
  const meshBottomRef = useRef<THREE.Mesh | null>(null);

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
        maxTextureDpr,
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
    lastUploadAtRef.current = -Infinity;

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
  }, [size.width, size.height, gl, maxTextureDpr]);

  const lastUploadAtRef = useRef<number>(-Infinity);

  useFrame((state, delta) => {
    const anim = animRef.current;
    if (!anim || !texRef.current) return;
    // Drive the title FRAME directly from gallery progress: the opening titles
    // settle step-by-step with the video card's top/bottom crops, and the image-
    // card title groups change only inside card HOLD windows (galleryTitleFrameFor).
    const gp = galleryRef.current;
    const target = galleryTitleFrameFor(gp); // 0..1
    let frac: number;
    if (reducedMotion || isGalleryTitleHoldFrame(target)) {
      frac = target; // discrete holds: never freeze on a fractional transition frame
      smoothRef.current = target;
    } else {
      if (smoothRef.current < 0) smoothRef.current = target;
      smoothRef.current += (target - smoothRef.current) * (1 - Math.exp(-delta * 10));
      if (Math.abs(target - smoothRef.current) < 1 / 120) smoothRef.current = target;
      frac = smoothRef.current;
    }
    const frame = frac * Math.max(anim.totalFrames - 1, 0);

    // Visible for the whole gallery (gp > 0) — including the video card phase.
    // The titles no longer FADE out at the end; instead they SLIDE off (below).
    const visible = gp > 1e-4 ? 1 : 0;
    if (matTopRef.current) matTopRef.current.opacity = visible;
    if (matBottomRef.current) matBottomRef.current.opacity = visible;

    // Exit at card 9: as the last image card flies up (cardExitRef → 1, i.e. the
    // unified cp climbs 8→9), the TOP title slides UP off the top and the BOTTOM
    // title slides DOWN off the bottom, in lockstep with the leaving card. Driven
    // every frame (the slide moves while the held last frame is static).
    const exit = THREE.MathUtils.clamp(cardExitRef.current, 0, 1);
    const off = exit * fullHeight * (1 + TITLE_EXIT_OVERSCAN);
    if (meshTopRef.current) {
      meshTopRef.current.renderOrder = 2;
      meshTopRef.current.position.y = planeHeight / 4 + off;
    }
    if (meshBottomRef.current) {
      meshBottomRef.current.renderOrder = 2;
      meshBottomRef.current.position.y = -planeHeight / 4 - off;
    }

    if (frame === lastFrameRef.current) return;
    const minUploadGap =
      Number.isFinite(textureFrameRate) && textureFrameRate > 0
        ? 1 / textureFrameRate
        : 0;
    if (
      minUploadGap > 0 &&
      state.clock.elapsedTime - lastUploadAtRef.current < minUploadGap
    ) {
      return;
    }
    lastUploadAtRef.current = state.clock.elapsedTime;
    lastFrameRef.current = frame;
    anim.goToAndStop(frame, true);
    if (texRef.current) texRef.current.needsUpdate = true;
  });

  const { planeHeight, fullHeight, topGeometry, bottomGeometry } = useMemo(() => {
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
    const halfH = innerH / 2;
    // Top plane: upper half of the comp (top title line); bottom plane: lower half
    // (bottom title block). Together they exactly reproduce the full title plane.
    const topGeometry = new THREE.PlaneGeometry(innerW, halfH);
    remapV(topGeometry, 0.5 + TITLE_SPLIT_GUARD, 1);
    const bottomGeometry = new THREE.PlaneGeometry(innerW, halfH);
    remapV(bottomGeometry, 0, 0.5 - TITLE_SPLIT_GUARD);
    return { planeHeight: innerH, fullHeight, topGeometry, bottomGeometry };
  }, [camera, viewport.width, viewport.height]);

  // Dispose the split geometries when they are rebuilt (viewport resize) or on
  // unmount so the GPU buffers are released.
  useEffect(
    () => () => {
      topGeometry.dispose();
      bottomGeometry.dispose();
    },
    [topGeometry, bottomGeometry],
  );

  if (!texture) return null;

  return (
    <group>
      <mesh ref={meshTopRef} geometry={topGeometry} position={[0, planeHeight / 4, PLANE_Z]}>
        <meshBasicMaterial
          ref={matTopRef}
          map={texture}
          toneMapped={false}
          transparent
          alphaTest={0.1}
        />
      </mesh>
      <mesh ref={meshBottomRef} geometry={bottomGeometry} position={[0, -planeHeight / 4, PLANE_Z]}>
        <meshBasicMaterial
          ref={matBottomRef}
          map={texture}
          toneMapped={false}
          transparent
          alphaTest={0.1}
        />
      </mesh>
    </group>
  );
}
