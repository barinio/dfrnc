import { useEffect, useMemo, useReducer } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  CARD_RADIUS_VH,
  CARDS_VH,
  CARD_ASPECT,
  coverCropWindowFor,
  galleryImageFocusFor,
} from "../gallery";

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

// Real-image texture cache, keyed by resolved URL. The card conveyor reuses only
// 4 slots, so every slot's `src` shifts each time `lead` advances. Without a
// cache that re-fired a fresh async TextureLoader on every step and held the
// result in React state, so the card kept showing the PREVIOUS image until the
// new one decoded, then snapped — the visible jerk "when a new picture arrives".
// Cached textures are session-permanent (small, fixed set) and never disposed.
const realCache = new Map<string, THREE.Texture>();
const realPending = new Map<string, Promise<THREE.Texture>>();

function configureRealTexture(tex: THREE.Texture, maxAniso: number) {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = Math.min(8, maxAniso);
}

// Load (or join an in-flight load of) a real image into the cache. Deduped by
// URL so concurrent slots + the preloader never decode the same file twice.
function loadRealTexture(url: string, maxAniso: number): Promise<THREE.Texture> {
  const ready = realCache.get(url);
  if (ready) return Promise.resolve(ready);
  const inflight = realPending.get(url);
  if (inflight) return inflight;
  const p = new Promise<THREE.Texture>((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (tex) => {
        configureRealTexture(tex, maxAniso);
        realCache.set(url, tex);
        realPending.delete(url);
        resolve(tex);
      },
      undefined,
      (err) => {
        realPending.delete(url);
        reject(err);
      },
    );
  });
  realPending.set(url, p);
  return p;
}

// Eagerly decode every gallery image into the cache (call once on mount) so the
// textures are GPU-ready long before the cards scroll into view — the first
// appearance of each image then has no placeholder flash either.
export function preloadGalleryTextures(srcs: (string | null)[], maxAniso: number) {
  for (const src of srcs) {
    if (!src) continue;
    loadRealTexture(import.meta.env.BASE_URL + src, maxAniso).catch(() => {});
  }
}

// Remap ShapeGeometry UVs to the source crop window over the shape's bounding
// box. The crop window is still cover-fit, but can use per-image focal points on
// narrow mobile cards so subjects are not cut off by a centered side crop.
function fitUVs(
  geom: THREE.ShapeGeometry,
  w: number,
  h: number,
  texAspect: number,
  src: string | null,
) {
  geom.computeBoundingBox();
  const bb = geom.boundingBox!;
  const uv = geom.attributes.uv as THREE.BufferAttribute;
  const cardAspect = w / h;
  const crop = coverCropWindowFor(cardAspect, texAspect, galleryImageFocusFor(src));
  const bw = bb.max.x - bb.min.x;
  const bh = bb.max.y - bb.min.y;
  for (let i = 0; i < uv.count; i++) {
    const x = (geom.attributes.position.getX(i) - bb.min.x) / bw; // 0..1
    const y = (geom.attributes.position.getY(i) - bb.min.y) / bh; // 0..1
    uv.setXY(
      i,
      crop.u0 + x * (crop.u1 - crop.u0),
      crop.v0 + y * (crop.v1 - crop.v0),
    );
  }
  uv.needsUpdate = true;
}

interface Props {
  src: string | null;
  index: number;
  // World-space card size (the parent sizes these to the card band / 3:2).
  width: number;
  height: number;
}

export default function GalleryCard({ src, index, width, height }: Props) {
  const { gl } = useThree();
  const url = src ? import.meta.env.BASE_URL + src : null;
  const [, bump] = useReducer((x: number) => x + 1, 0);

  // Resolve the texture at RENDER time straight from the cache — NOT from state
  // holding the previously-loaded image. On a cache hit (the normal case once the
  // preloader has run) the correct image is shown on the very frame `src` changes
  // as the conveyor advances, so there is no stale-frame pop. On a miss we show
  // the placeholder and re-render once the async load lands.
  const texture = (url && realCache.get(url)) || placeholderTexture(index);

  useEffect(() => {
    if (!url || realCache.has(url)) return; // null src, or already cached → nothing to load
    let cancelled = false;
    loadRealTexture(url, gl.capabilities.getMaxAnisotropy())
      .then(() => { if (!cancelled) bump(); }) // swap placeholder → real once decoded
      .catch(() => {}); // error → keep placeholder
    return () => { cancelled = true; };
  }, [url, gl]);

  const geometry = useMemo(() => {
    // Corner radius is 2.5% vh; as a fraction of the card height that is
    // CARD_RADIUS_VH / CARDS_VH (0.025 / 0.64 ≈ 0.039 of the card height).
    const radius = height * (CARD_RADIUS_VH / CARDS_VH);
    const shape = roundedRectShape(width, height, radius);
    const geom = new THREE.ShapeGeometry(shape, 24);
    const img = texture.image as { width?: number; height?: number } | undefined;
    const texAspect = img && img.width && img.height ? img.width / img.height : CARD_ASPECT;
    fitUVs(geom, width, height, texAspect, src);
    return geom;
  }, [width, height, texture, src]);

  useEffect(() => {
    return () => { geometry.dispose(); };
  }, [geometry]);

  return (
    <mesh geometry={geometry}>
      {/* transparent + depthWrite:false so the stack's cards crossfade and sort
          back-to-front by z (front over back); CardStack drives `opacity` per
          frame for the rise-out / fade-in transition. */}
      <meshBasicMaterial map={texture} toneMapped={false} transparent depthWrite={false} />
    </mesh>
  );
}
