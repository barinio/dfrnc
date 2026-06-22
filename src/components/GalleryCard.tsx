import { useEffect, useMemo, useState } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { CARD_RADIUS_VH, CARDS_VH, CARD_ASPECT } from "../gallery";

// Build a centered rounded-rectangle path (width w, height h, corner radius r).
export function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  const rr = Math.min(r, w / 2, h / 2);
  s.moveTo(x + rr, y);
  s.lineTo(x + w - rr, y);
  s.quadraticCurveTo(x + w, y, x + w, y + rr);
  s.lineTo(x + w, y + h - rr);
  s.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  s.lineTo(x + rr, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - rr);
  s.lineTo(x, y + rr);
  s.quadraticCurveTo(x, y, x + rr, y);
  return s;
}

// Module-scope cache: placeholder textures are permanent for the session (fixed, small index set) — never disposed.
const placeholderCache = new Map<number, THREE.CanvasTexture>();
export function placeholderTexture(index: number): THREE.CanvasTexture {
  const cached = placeholderCache.get(index);
  if (cached) return cached;
  const c = document.createElement("canvas");
  c.width = 600;
  c.height = 400; // 3:2
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#8a8a8a";
  ctx.fillRect(0, 0, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  placeholderCache.set(index, tex);
  return tex;
}

// Remap ShapeGeometry UVs to 0..1 over the shape's bounding box, then cover-fit
// the texture's aspect into the card's 3:2 (center crop).
function fitUVs(geom: THREE.ShapeGeometry, w: number, h: number, texAspect: number) {
  geom.computeBoundingBox();
  const bb = geom.boundingBox!;
  const uv = geom.attributes.uv as THREE.BufferAttribute;
  const cardAspect = w / h;
  // cover-fit scale: shrink the longer texture axis' UV span.
  let su = 1;
  let sv = 1;
  if (texAspect > cardAspect) su = cardAspect / texAspect; // wider texture → crop sides
  else sv = texAspect / cardAspect; // taller texture → crop top/bottom
  const bw = bb.max.x - bb.min.x;
  const bh = bb.max.y - bb.min.y;
  for (let i = 0; i < uv.count; i++) {
    const x = (geom.attributes.position.getX(i) - bb.min.x) / bw; // 0..1
    const y = (geom.attributes.position.getY(i) - bb.min.y) / bh; // 0..1
    uv.setXY(i, 0.5 + (x - 0.5) * su, 0.5 + (y - 0.5) * sv);
  }
  uv.needsUpdate = true;
}

interface Props {
  src: string | null;
  index: number;
  // World-space card size (the parent sizes these to 64vh / 3:2).
  width: number;
  height: number;
}

export default function GalleryCard({ src, index, width, height }: Props) {
  const { gl } = useThree();
  const [texture, setTexture] = useState<THREE.Texture>(() => placeholderTexture(index));

  // Load the real image when src is provided; fall back to the placeholder.
  useEffect(() => {
    if (!src) {
      setTexture(placeholderTexture(index));
      return;
    }
    let cancelled = false;
    new THREE.TextureLoader().load(
      import.meta.env.BASE_URL + src,
      (tex) => {
        if (cancelled) return;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
        setTexture(tex);
      },
      undefined,
      () => { if (!cancelled) setTexture(placeholderTexture(index)); }, // error → placeholder
    );
    return () => { cancelled = true; };
  }, [src, index, gl]);

  const geometry = useMemo(() => {
    // Corner radius is 2.5% vh; as a fraction of the card height that is
    // CARD_RADIUS_VH / CARDS_VH (0.025 / 0.64 ≈ 0.039 of the card height).
    const radius = height * (CARD_RADIUS_VH / CARDS_VH);
    const shape = roundedRectShape(width, height, radius);
    const geom = new THREE.ShapeGeometry(shape, 24);
    const img = texture.image as { width?: number; height?: number } | undefined;
    const texAspect = img && img.width && img.height ? img.width / img.height : CARD_ASPECT;
    fitUVs(geom, width, height, texAspect);
    return geom;
  }, [width, height, texture]);

  useEffect(() => {
    return () => { geometry.dispose(); };
  }, [geometry]);

  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}
