import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { galleryCtaPlaneOpacityFor } from "../gallery";
import { approach, idleTilt } from "../cursorTilt";
// Same raw-SVG import the DOM overlay used — one source of truth for the
// wordmark artwork (white fills baked in).
import ctaWordmarkRaw from "../assets/cta.svg?raw";

// The CTA wordmark rendered INSIDE the canvas, so the LAST card genuinely
// dissolves ON TOP of it (supervisor: "потрібно аби карточка була попереду
// тексту, і типу карточка в опасіті - а там текст"). renderOrder −1 slots it
// between the black GalleryBackdrop (−2) and the cards (0): where the card is
// still semi-opaque the glyphs read TINTED THROUGH the photo, not painted over
// it (the old DOM overlay sat above the opaque canvas and could only fake
// this). The DOM .gallery-cta remains as the invisible mailto hit-area.

// Tilt feel carried over 1:1 from the retired DOM transform (GalleryCTA):
const CTA_TILT_MAX = (16 * Math.PI) / 180; // peak pitch/yaw at screen edges
const CTA_SHIFT_PX = 16; // peak parallax translate toward the cursor
const CTA_TILT_RATE = 5; // exponential easing rate toward the target
// The DOM version had a constant translateZ(30px) under perspective(800px).
// The camera sits 8 world units back and the viewport is ~800–900 CSS px tall,
// so ~100px ≙ 1 world unit: a +0.3 lift reproduces the same ~4% magnification
// and rotation parallax (the plane is SIZED with the z=0 mapping on purpose).
const PLANE_Z = 0.3;

// DOM sizing replicated: link width was min(86vw, 70rem) with the wordmark
// scaled (0.5, 0.65) — deliberately non-uniform (see the old CSS note).
const CTA_MAX_WIDTH_PX = 1120; // 70rem at the default 16px root font
const CTA_VW_FRACTION = 0.86;
const CTA_SCALE_X = 0.5;
const CTA_SCALE_Y = 0.65;

// Aspect from the SVG's own viewBox so an artwork swap can't desync the plane.
const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(ctaWordmarkRaw);
const SVG_ASPECT = vb ? Number(vb[1]) / Number(vb[2]) : 577.87 / 93.32;

interface WordmarkTexture {
  tex: THREE.CanvasTexture;
  cssW: number; // displayed CSS px (post-scale)
  cssH: number;
}

interface Props {
  galleryRef: MutableRefObject<number>;
  reducedMotion?: boolean;
  maxTextureDpr?: number;
}

export default function CtaWordmark({
  galleryRef,
  reducedMotion = false,
  maxTextureDpr = Infinity,
}: Props) {
  const { viewport, size, gl } = useThree();
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const [wordmark, setWordmark] = useState<WordmarkTexture | null>(null);

  const rotX = useRef(0);
  const rotY = useRef(0);
  const shiftX = useRef(0);
  const shiftY = useRef(0);
  const elapsed = useRef(0);
  const ptr = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      ptr.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      ptr.current.y = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    // Ease back to neutral when the cursor leaves the window or it loses focus.
    const recenter = () => {
      ptr.current.x = 0;
      ptr.current.y = 0;
    };
    const onOut = (e: PointerEvent) => {
      if (e.relatedTarget === null) recenter();
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerout", onOut);
    window.addEventListener("blur", recenter);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerout", onOut);
      window.removeEventListener("blur", recenter);
    };
  }, []);

  // Rasterize the SVG to a texture at the DISPLAYED pixel size (× supersample,
  // same formula as GalleryTitles). The non-uniform (0.5, 0.65) squeeze is baked
  // into the raster via preserveAspectRatio:"none", so texels map ~1:1 to device
  // pixels and the glyphs stay as crisp as the DOM <svg> was.
  useEffect(() => {
    const base = Math.min(CTA_VW_FRACTION * size.width, CTA_MAX_WIDTH_PX);
    const cssW = CTA_SCALE_X * base;
    const cssH = (CTA_SCALE_Y * base) / SVG_ASPECT;
    const ssMax = Math.min(size.width, size.height) <= 480 ? 1.0 : 1.25;
    const dpr = Math.max(
      1,
      Math.min(
        (window.devicePixelRatio || 1) * ssMax,
        maxTextureDpr,
        4096 / Math.max(cssW, cssH),
      ),
    );
    const texW = Math.round(cssW * dpr);
    const texH = Math.round(cssH * dpr);
    const svg = ctaWordmarkRaw.replace(
      "<svg",
      `<svg width="${texW}" height="${texH}" preserveAspectRatio="none"`,
    );
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const img = new Image();
    let cancelled = false;
    let tex: THREE.CanvasTexture | null = null;
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (cancelled) return;
      const cnv = document.createElement("canvas");
      cnv.width = texW;
      cnv.height = texH;
      cnv.getContext("2d")!.drawImage(img, 0, 0, texW, texH);
      tex = new THREE.CanvasTexture(cnv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
      setWordmark({ tex, cssW, cssH });
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
    return () => {
      cancelled = true;
      if (tex) tex.dispose();
    };
  }, [size.width, size.height, gl, maxTextureDpr]);

  useFrame((_s, delta) => {
    const mesh = meshRef.current;
    const mat = matRef.current;
    if (!mesh || !mat || !wordmark) return;
    const op = galleryCtaPlaneOpacityFor(galleryRef.current);
    mat.opacity = op;
    mesh.visible = op > 0.001;
    if (!mesh.visible) return;

    // CSS px → world units via the z=0 frustum. The plane actually sits at
    // PLANE_Z=+0.3, so it renders ~4% larger — that IS the DOM translateZ lift
    // (see PLANE_Z note above), not an error to compensate.
    const pxToWorld = viewport.height / size.height;
    mesh.scale.set(wordmark.cssW * pxToWorld, wordmark.cssH * pxToWorld, 1);

    elapsed.current += delta;
    if (reducedMotion) {
      mesh.rotation.set(0, 0, 0);
      mesh.position.set(0, 0, PLANE_Z);
      return;
    }
    // Sign mapping from the retired CSS transform: CSS rotateX(θ) ≡ three
    // rotation.x = −θ (the CSS y-axis points DOWN), CSS rotateY(θ) ≡ rotation.y
    // = +θ. The DOM targets (−ptr.y, +ptr.x in CSS degrees) become:
    const it = idleTilt(elapsed.current, false);
    const targetRX = ptr.current.y * CTA_TILT_MAX - it.x;
    const targetRY = ptr.current.x * CTA_TILT_MAX + it.y;
    const targetSX = ptr.current.x * CTA_SHIFT_PX;
    const targetSY = ptr.current.y * CTA_SHIFT_PX; // world y is UP (CSS was down)
    rotX.current = approach(rotX.current, targetRX, delta, CTA_TILT_RATE);
    rotY.current = approach(rotY.current, targetRY, delta, CTA_TILT_RATE);
    shiftX.current = approach(shiftX.current, targetSX, delta, CTA_TILT_RATE);
    shiftY.current = approach(shiftY.current, targetSY, delta, CTA_TILT_RATE);
    mesh.rotation.set(rotX.current, rotY.current, 0);
    mesh.position.set(
      shiftX.current * pxToWorld,
      shiftY.current * pxToWorld,
      PLANE_Z,
    );
  });

  if (!wordmark) return null;

  return (
    <mesh
      ref={meshRef}
      renderOrder={-1}
      position={[0, 0, PLANE_Z]}
      visible={false}
    >
      <planeGeometry args={[1, 1]} />
      {/* transparent + depthWrite:false like the cards — layering is by
          renderOrder alone (backdrop −2 → wordmark −1 → cards 0). */}
      <meshBasicMaterial
        ref={matRef}
        map={wordmark.tex}
        toneMapped={false}
        transparent
        depthWrite={false}
        opacity={0}
      />
    </mesh>
  );
}
