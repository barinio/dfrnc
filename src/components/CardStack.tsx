import { useEffect, useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import GalleryCard, { preloadGalleryTextures } from "./GalleryCard";
import {
  cardFlyProgressFor,
  galleryCardPositionFor,
  imageGalleryProgress,
  imageStackRevealFor,
  imageStackVisibleFor,
  GALLERY_IMAGES,
  CARDS_VH,
  CARD_FILL,
  CARD_ASPECT,
  CARDS_WIDTH_VW_PORTRAIT,
  GUTTER,
  TOP_TITLE_VH,
} from "../gallery";
import { VID_FLY_END } from "../constants";
import { approach } from "../cursorTilt";

const PLANE_Z = 0; // centre of the frustum → pronounced perspective for the tilt

// Hover (radiance.family): parallax + scale apply ONLY while the cursor is over
// the card. No always-on tilt or idle drift.
const HOVER_SCALE = 1.03; // front card grows 1 → 1.03 on hover (small — full-size card)
const HOVER_TILT_MAX = 0.06; // ~3.4° max parallax tilt on hover (radians)
const HOVER_RATE = 9; // ease rate for the hover scale/tilt
const HOVER_PAD = 1.06; // hover hit-region padding (reduces edge flicker)

// Depth stack by AGE (continuous depth d, 0 = front): the front card (next to
// leave) has the HIGHEST z + largest scale; each card behind is deeper + a touch
// smaller; new cards enter at the BACK. Per direction: card 1 has the highest z,
// then 2, then 3; when 1 leaves up, 2 is frontmost and the new card 4 enters at
// 1's spot at the LOWEST z.
const DEPTH = [
  { z: 0.0, scale: 1.0 }, // d0 — front
  { z: -0.16, scale: 0.96 }, // d1
  { z: -0.32, scale: 0.93 }, // d2
  { z: -0.48, scale: 0.9 }, // d3 — back (entering)
];

// The leaving (front) card flies straight UP and off the top — NO opacity fade
// (per direction: "слайди без опасіті улітають"). Distance in card-heights, big
// enough to clear the frame before the next card settles.
const RISE_OFF = 1.9;

function depthAt(d: number): { z: number; scale: number } {
  const i = Math.min(Math.floor(d), DEPTH.length - 2);
  const f = THREE.MathUtils.clamp(d - i, 0, 1);
  return {
    z: THREE.MathUtils.lerp(DEPTH[i].z, DEPTH[i + 1].z, f),
    scale: THREE.MathUtils.lerp(DEPTH[i].scale, DEPTH[i + 1].scale, f),
  };
}

interface Props {
  galleryRef: MutableRefObject<number>;
  cardExitRef: MutableRefObject<number>;
  reducedMotion?: boolean;
}

export default function CardStack({ galleryRef, cardExitRef, reducedMotion = false }: Props) {
  const { viewport, gl } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  // One PERSISTENT mesh per image card. Each card keeps its own fixed texture for
  // the whole session and is positioned imperatively below by its absolute index.
  // (The old design recycled 4 slots and swapped their `src` via React state — but
  // position is updated here in useFrame while the swapped content only landed on
  // the NEXT React commit, 1–several frames later. That desync made the front card
  // snap to its new spot still showing the previous image, then pop — the visible
  // "jump when a new picture arrives". Fixed by never changing any card's content.)
  const cardRefs = useRef<(THREE.Group | null)[]>([]);
  const rotX = useRef(0);
  const rotY = useRef(0);
  const hover = useRef(0); // eased 0..1 hover amount

  // Pointer in normalized device coords, tracked on window so it works despite
  // the canvas layer being pointer-events:none. Used for the hover hit-test +
  // parallax direction (no R3F raycasting needed).
  const ptr = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      ptr.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      ptr.current.y = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  // Decode every gallery image up front (on mount) so the textures are GPU-ready
  // long before the cards scroll in — the conveyor then recycles slots without
  // any async texture pop ("jerk when a new picture arrives").
  useEffect(() => {
    preloadGalleryTextures(GALLERY_IMAGES, gl.capabilities.getMaxAnisotropy());
  }, [gl]);

  // Card world size (smaller via CARD_FILL) + content-band centring + hover
  // hit-region in NDC. Viewport is world units (height ≈ 9.24 at z = 0).
  const { cardW, cardH, bandOffsetY, hoverHalfX, hoverHalfY, hoverCenterY, maxHoverScale } = useMemo(() => {
    const vw = viewport.width;
    const vh = viewport.height;
    const aspect = vw / vh;
    const h = CARDS_VH * CARD_FILL * vh;
    let w = h * CARD_ASPECT; // landscape/square: keep 3:2
    if (aspect < 1) w = CARDS_WIDTH_VW_PORTRAIT * CARD_FILL * vw; // portrait → 86vw band, scaled
    // Centre in the (asymmetric) content band, not the screen.
    const bandCenterFromTop = 2 * GUTTER + TOP_TITLE_VH + CARDS_VH / 2; // 0.46
    const bandOffsetY = (0.5 - bandCenterFromTop) * vh;
    // Hover region (NDC), padded a touch to avoid edge flicker.
    const hoverHalfX = (w / vw) * HOVER_PAD;
    const hoverHalfY = (h / vh) * HOVER_PAD;
    const hoverCenterY = (2 * bandOffsetY) / vh;
    // Max hover scale that keeps the (centre-scaled) front card clear of BOTH
    // title bands: its half-height may grow only into the 3vmin gutter, never to
    // the title text. (Tilt is kept small separately via HOVER_TILT_MAX.)
    const vmin = Math.min(vw, vh);
    const gutterWorld = GUTTER * vmin;
    const maxHoverScale = 1 + gutterWorld / (h / 2);
    return { cardW: w, cardH: h, bandOffsetY, hoverHalfX, hoverHalfY, hoverCenterY, maxHoverScale };
  }, [viewport.width, viewport.height]);

  useFrame((_s, delta) => {
    const group = groupRef.current;
    if (!group) return;

    const gp = galleryRef.current;
    // The image cards stay hidden during the vertical crop, then slide out from
    // the video-card centre into their staged positions. Their own conveyor
    // still runs in the remapped image-gallery sub-range, so card 2 does not fly
    // until after the video card has cleared.
    const igp = imageGalleryProgress(gp);
    const stackReveal = imageStackRevealFor(gp);
    const stackOpacity = imageStackVisibleFor(gp);

    group.visible = stackOpacity > 0;
    if (!group.visible) {
      cardExitRef.current = 0; // titles stay fully opaque before the card phase
      return;
    }
    group.renderOrder = 0;

    const n = GALLERY_IMAGES.length;
    // Continuous, scroll-scrubbed flip progress through the cards: card `lead` is
    // mid-flip-OUT (local 0→1) and the next card of the same position enters
    // behind it. No discrete swiper — the flips scrub alongside the other anims.
    const displayed = THREE.MathUtils.clamp(cardFlyProgressFor(igp) * n, 0, n);
    const lead = Math.floor(displayed);
    const local = displayed - lead;

    // Last-card exit progress for the synchronized finale: 0 until the last card
    // begins flipping out, 1 once it is gone. GalleryTitles fades by (1 − cardExit).
    cardExitRef.current = THREE.MathUtils.clamp(displayed - (n - 1), 0, 1);

    // Hover amount (eased) — applied to the FRONT/settled card only. The resting
    // Position slot cycles centre / upper-left / right, so the hit-region must
    // FOLLOW the front card to its actual on-screen spot; testing against
    // screen-centre let only the centred cards (idx 0,3,6) react, so it looked
    // like only the first card had parallax.
    // its resting NDC centre = the band centre plus the card's P.x/P.y offset.
    const Pfront = galleryCardPositionFor(lead + 1);
    const frontCenterX = (2 * Pfront.x * cardW) / viewport.width;
    const frontCenterY = hoverCenterY + (2 * Pfront.y * cardH) / viewport.height;
    const px = ptr.current.x;
    const py = ptr.current.y;
    const relX = px - frontCenterX;
    const relY = py - frontCenterY;
    const over =
      !reducedMotion &&
      gp >= VID_FLY_END &&
      Math.abs(relX) < hoverHalfX &&
      Math.abs(relY) < hoverHalfY;
    hover.current = approach(hover.current, over ? 1 : 0, delta, HOVER_RATE);
    rotX.current = approach(rotX.current, -relY * HOVER_TILT_MAX * hover.current, delta, HOVER_RATE);
    rotY.current = approach(rotY.current, relX * HOVER_TILT_MAX * hover.current, delta, HOVER_RATE);
    group.rotation.set(0, 0, 0);
    group.scale.setScalar(1);

    // Walk all cards; each card's "slot" is its distance behind the front =
    // i − lead. Four are live at a time: slot 0 = the front card flying UP and off
    // the top (NO opacity fade), slots 1–2 = the cards behind it, slot 3 = the next
    // card entering at the BACK directly behind slot 0. Cards already gone (slot < 0)
    // or not yet entered (slot > 3) are hidden. X/Y are fixed per card, with a
    // centre-out reveal while the video finishes becoming a card; z + scale come
    // from the age-ordered DEPTH stack via the continuous depth d = i − displayed.
    for (let i = 0; i < n; i++) {
      const ref = cardRefs.current[i];
      if (!ref) continue;
      const slot = i - lead;
      if (slot < 0 || slot > 3) {
        ref.visible = false;
        continue;
      }
      const P = galleryCardPositionFor(i + 1);
      const x = P.x * stackReveal;
      let y = P.y * stackReveal;
      let z: number;
      let scale: number;
      const d = i - displayed; // = slot − local: continuous depth as the stack advances

      if (slot === 0) {
        // The FRONT card (slot 0 is the only slot with d = −local ≤ 0). It is
        // settled at local 0 and flies straight UP off the top as local → 1
        // (opaque, no fade). Hover tilt + scale apply while it is settled and
        // fade out as it starts to leave (settle over local 0 → 0.2). Applying
        // them HERE — not only at the exact local 0 — is what makes EVERY front
        // card react in turn: the old `d < 0` guard dropped the card into a
        // no-hover "leaving" path the instant local rose above 0, so only the
        // very first card (before any swap) ever tilted.
        const settle = 1 - THREE.MathUtils.clamp(local / 0.2, 0, 1);
        const amt = hover.current * settle;
        z = DEPTH[0].z;
        scale = DEPTH[0].scale * Math.min(1 + (HOVER_SCALE - 1) * amt, maxHoverScale);
        y = P.y * stackReveal + local * RISE_OFF; // local = −d: 0 when settled, rises as it leaves
        ref.rotation.set(rotX.current * settle, rotY.current * settle, 0);
      } else {
        // Cards behind (d > 0 always for slot ≥ 1): age-ordered depth, no hover.
        const ds = depthAt(d);
        z = ds.z;
        scale = ds.scale;
        ref.rotation.set(0, 0, 0);
      }

      ref.visible = true;
      ref.position.set(x * cardW, y * cardH, z);
      ref.scale.setScalar(scale);
      const mesh = ref.children[0] as THREE.Mesh | undefined;
      if (mesh) mesh.renderOrder = 0;
      const mat = mesh?.material as THREE.MeshBasicMaterial | undefined;
      if (mat) mat.opacity = stackOpacity;
    }

    // No entrance lift: image cards are already parked behind the video card.
    group.position.y = bandOffsetY;
  });

  return (
    <group ref={groupRef} position={[0, 0, PLANE_Z]}>
      {GALLERY_IMAGES.map((src, i) => (
        <group
          key={i}
          ref={(el) => {
            cardRefs.current[i] = el;
          }}
        >
          {/* Fixed content per card — never re-keyed/swapped, so the texture is
              loaded once and the image can never lag the imperative position. */}
          <GalleryCard src={src} index={i} width={cardW} height={cardH} />
        </group>
      ))}
    </group>
  );
}
