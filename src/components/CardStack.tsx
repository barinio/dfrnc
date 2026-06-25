import { useEffect, useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import GalleryCard from "./GalleryCard";
import {
  cardConveyorFor,
  cardFlyProgressFor,
  imageGalleryProgress,
  GALLERY_IMAGES,
  CARDS_VH,
  CARD_ASPECT,
  CARDS_WIDTH_VW_PORTRAIT,
  GUTTER,
  TOP_TITLE_VH,
} from "../gallery";
import { approach } from "../cursorTilt";

const PLANE_Z = 0; // centre of the frustum → pronounced perspective for the tilt

// Cards render at a FRACTION of the 64vh band so the front card (and the peeked
// neighbours offset up/down) stay clear of the top/bottom title text with margin.
const CARD_FILL = 0.72;

// Hover (radiance.family): parallax + scale apply ONLY while the cursor is over
// the card. No always-on tilt or idle drift.
const HOVER_SCALE = 1.03; // front card grows 1 → 1.03 on hover (small — full-size card)
const HOVER_TILT_MAX = 0.06; // ~3.4° max parallax tilt on hover (radians)
const HOVER_RATE = 9; // ease rate for the hover scale/tilt
const HOVER_PAD = 1.06; // hover hit-region padding (reduces edge flicker)

// Resting X/Y positions (image #5), FIXED per card index (cycles every 3): centre
// = cards 1·4·7, upper-left = 2·5·8, right = 3·6·9. (Fractions of card W/H.)
const POSITIONS = [
  { x: 0.0, y: 0.0 }, // 0 — centre
  { x: -0.15, y: 0.1 }, // 1 — upper-left
  { x: 0.16, y: -0.02 }, // 2 — right
];

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
  const { viewport } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const slotRef0 = useRef<THREE.Group>(null);
  const slotRef1 = useRef<THREE.Group>(null);
  const slotRef2 = useRef<THREE.Group>(null);
  const slotRef3 = useRef<THREE.Group>(null);
  const slotRefs = [slotRef0, slotRef1, slotRef2, slotRef3];
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

    // The image conveyor (slides 2..N) runs in the IMAGE-gallery sub-range, which
    // opens only AFTER the video card (slide #1) has flown away (igp > 0 ⟺ gp >
    // VID_FLY_END). All card timing below is in this remapped space.
    const igp = imageGalleryProgress(galleryRef.current);
    const { span } = cardConveyorFor(igp);

    // Show the stack only once the image-card phase begins — i.e. after the
    // video card has flown and the black backdrop is up (span > 0 ⟺ igp >
    // BACKDROP_FADE_END). During the intro/figures/video/video-card phase
    // (igp = 0) the whole stack is hidden, so it can't peek up from the bottom.
    group.visible = span > 1e-4;
    if (!group.visible) {
      cardExitRef.current = 0; // titles stay fully opaque before the card phase
      return;
    }

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

    // Hover amount (eased) — applied to the front/centre resting card only.
    const px = ptr.current.x;
    const py = ptr.current.y;
    const over =
      !reducedMotion &&
      Math.abs(px) < hoverHalfX &&
      Math.abs(py - hoverCenterY) < hoverHalfY;
    hover.current = approach(hover.current, over ? 1 : 0, delta, HOVER_RATE);
    const relY = py - hoverCenterY;
    rotX.current = approach(rotX.current, -relY * HOVER_TILT_MAX * hover.current, delta, HOVER_RATE);
    rotY.current = approach(rotY.current, px * HOVER_TILT_MAX * hover.current, delta, HOVER_RATE);
    group.rotation.set(0, 0, 0);
    group.scale.setScalar(1);

    // Four live slots: slot 0 = the front card flying UP and off the top (NO
    // opacity fade), slots 1–2 = the cards behind it, slot 3 = the next card
    // entering at the BACK directly behind slot 0 (same X/Y, since (lead+3) % 3 ===
    // lead % 3 — revealed as slot 0 rises). X/Y are fixed per card
    // (POSITIONS[idx % 3]); z + scale come from the age-ordered DEPTH stack via the
    // continuous depth d = slot − local.
    for (let slot = 0; slot < 4; slot++) {
      const ref = slotRefs[slot].current;
      if (!ref) continue;
      const idx = lead + slot;
      if (idx >= n) {
        ref.visible = false;
        continue;
      }
      const P = POSITIONS[idx % 3];
      let x = P.x;
      let y = P.y;
      let z: number;
      let scale: number;
      const d = slot - local;

      if (d < 0) {
        // Leaving: fly straight UP off the top — opaque the whole way (no fade).
        z = DEPTH[0].z;
        scale = DEPTH[0].scale;
        y = P.y + -d * RISE_OFF;
        ref.rotation.set(0, 0, 0);
      } else {
        const ds = depthAt(d);
        z = ds.z;
        scale = ds.scale;
        if (slot === 0) {
          // Hover tilt + scale on the front/centre card while it is settled.
          const settle = 1 - THREE.MathUtils.clamp(local / 0.2, 0, 1);
          const amt = hover.current * settle;
          scale = ds.scale * Math.min(1 + (HOVER_SCALE - 1) * amt, maxHoverScale);
          ref.rotation.set(rotX.current * settle, rotY.current * settle, 0);
        } else {
          ref.rotation.set(0, 0, 0);
        }
      }

      ref.visible = true;
      ref.position.set(x * cardW, y * cardH, z);
      ref.scale.setScalar(scale);
      const mesh = ref.children[0] as THREE.Mesh | undefined;
      const mat = mesh?.material as THREE.MeshBasicMaterial | undefined;
      if (mat) mat.opacity = 1;
    }

    // Entrance: the whole group rises from below to its band centre as the
    // gallery opens.
    // Entrance lift deep enough that at entrance=0 the whole stack starts fully
    // below the screen (no sliver peeking) and rises into its band centre.
    const entrance = THREE.MathUtils.clamp(span / 0.04, 0, 1);
    group.position.y = bandOffsetY - (1 - entrance) * cardH * 2.3;
  });

  return (
    <group ref={groupRef} position={[0, 0, PLANE_Z]}>
      {[0, 1, 2, 3].map((slot) => (
        <group key={slot} ref={slotRefs[slot]}>
          <SlotCard slot={slot} galleryRef={galleryRef} cardW={cardW} cardH={cardH} />
        </group>
      ))}
    </group>
  );
}

// Resolves the live image index for a slot at render time (placeholders are
// identical, so the stale read is invisible; for real images, lift the conveyor
// lead to state — see the plan's "real images" note). Opacity/position/scale are
// driven imperatively by the parent each frame.
function SlotCard({
  slot,
  galleryRef,
  cardW,
  cardH,
}: {
  slot: number;
  galleryRef: MutableRefObject<number>;
  cardW: number;
  cardH: number;
}) {
  const { lead } = cardConveyorFor(imageGalleryProgress(galleryRef.current));
  const idx = lead + slot;
  const n = GALLERY_IMAGES.length;
  if (idx >= n) return null;
  const realIdx = idx % n;
  return <GalleryCard src={GALLERY_IMAGES[realIdx]} index={realIdx} width={cardW} height={cardH} />;
}
