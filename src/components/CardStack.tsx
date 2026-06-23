import { useEffect, useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import GalleryCard from "./GalleryCard";
import {
  cardConveyorFor,
  GALLERY_IMAGES,
  CARDS_VH,
  CARD_ASPECT,
  CARDS_WIDTH_VW_PORTRAIT,
  GUTTER,
  TOP_TITLE_VH,
} from "../gallery";
import { approach } from "../cursorTilt";

const PLANE_Z = 0; // centre of the frustum → pronounced perspective for the tilt

// The card now fills its full 64vh layout band (no shrink): hover stays clear of
// the titles via the clamp in this file, not by rendering smaller. Tuning dial.
const CARD_FILL = 1.0;

// Hover (radiance.family): parallax + scale apply ONLY while the cursor is over
// the card. No always-on tilt or idle drift.
const HOVER_SCALE = 1.3; // card grows 1 → 1.3 on hover
const HOVER_TILT_MAX = 0.13; // ~7.5° max parallax tilt on hover (radians)
const HOVER_RATE = 9; // ease rate for the hover scale/tilt
const HOVER_PAD = 1.06; // hover hit-region padding (reduces edge flicker)

// Discrete-step swiper: the deck holds still within each slide's scroll band and
// the target is the ROUNDED conveyor position, so a swipe past the midpoint flips
// one slide; a big scroll cascades. See 2026-06-23-gallery-card-swiper-design.md.
const STEP_RATE = 9;
const MAX_STEP_PER_SEC = 3;

// Per-depth resting placement. Cards peek UP and to the RIGHT (the PDF stack):
// each one behind is a touch smaller and offset +x/+y so its top-right corner
// shows behind the front. d = 3 is the entering card that fades in.
const STOPS = [
  { x: 0.0, y: 0.0, scale: 1.0, z: 0.0 }, // d0 — front
  { x: 0.035, y: 0.03, scale: 0.97, z: -0.15 }, // d1 — back, peeks top-right
  { x: 0.07, y: 0.06, scale: 0.94, z: -0.3 }, // d2 — back, peeks more
  { x: 0.09, y: 0.075, scale: 0.92, z: -0.45 }, // d3 — entering (fades in)
];
// How far a leaving card rises (fraction of card height) per unit of depth above
// the front; it fades out as it rises, so it never reaches the top title.
const RISE = 0.6;

function depthState(d: number): { x: number; y: number; scale: number; z: number; opacity: number } {
  if (d < 0) {
    // Leaving front card rises straight up (x = 0) and fades out.
    return { x: 0, y: -d * RISE, scale: 1, z: 0, opacity: THREE.MathUtils.clamp(1 + d, 0, 1) };
  }
  const i = Math.min(Math.floor(d), STOPS.length - 2);
  const a = STOPS[i];
  const b = STOPS[i + 1];
  const f = THREE.MathUtils.clamp(d - i, 0, 1);
  const opacity = d <= 2 ? 1 : THREE.MathUtils.clamp(3 - d, 0, 1);
  return {
    x: THREE.MathUtils.lerp(a.x, b.x, f),
    y: THREE.MathUtils.lerp(a.y, b.y, f),
    scale: THREE.MathUtils.lerp(a.scale, b.scale, f),
    z: THREE.MathUtils.lerp(a.z, b.z, f),
    opacity,
  };
}

interface Props {
  galleryRef: MutableRefObject<number>;
  reducedMotion?: boolean;
}

export default function CardStack({ galleryRef, reducedMotion = false }: Props) {
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
  const displayedRef = useRef<number | null>(null);

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
  const { cardW, cardH, bandOffsetY, hoverHalfX, hoverHalfY, hoverCenterY } = useMemo(() => {
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
    return { cardW: w, cardH: h, bandOffsetY, hoverHalfX, hoverHalfY, hoverCenterY };
  }, [viewport.width, viewport.height]);

  useFrame((_s, delta) => {
    const group = groupRef.current;
    if (!group) return;

    const gp = galleryRef.current;
    const { span } = cardConveyorFor(gp);

    // Show the stack only once the gallery's card phase begins — i.e. after the
    // video AND the black backdrop fade (span > 0 ⟺ gp > BACKDROP_FADE_END).
    // During the intro/figures/video (gp = 0) the whole stack is hidden, so it
    // can't peek up from the bottom behind the intro typography.
    group.visible = span > 1e-4;
    if (!group.visible) return;

    const n = GALLERY_IMAGES.length;
    const target = Math.round(span * n); // discrete slide index (0..n)

    // Discrete-step displayed position: speed-capped exponential ease toward the
    // rounded target (single eased step; big scroll cascades). Reduced motion
    // jumps straight to the target.
    if (displayedRef.current === null) displayedRef.current = target;
    if (reducedMotion) {
      displayedRef.current = target;
    } else {
      const cur = displayedRef.current;
      const eased = approach(cur, target, delta, STEP_RATE);
      const maxStep = MAX_STEP_PER_SEC * delta;
      let next = eased;
      if (Math.abs(eased - cur) > maxStep) next = cur + Math.sign(target - cur) * maxStep;
      if (Math.abs(target - next) < 1e-3) next = target;
      displayedRef.current = next;
    }

    const displayed = THREE.MathUtils.clamp(displayedRef.current, 0, n);
    const lead = Math.floor(displayed);
    const local = displayed - lead;

    // Place the four slot cards by continuous depth (centred; back cards smaller
    // and peeking below; front rises + fades out; deepest fades in from below).
    for (let slot = 0; slot < 4; slot++) {
      const ref = slotRefs[slot].current;
      if (!ref) continue;
      const idx = lead + slot;
      const st = depthState(slot - local);
      const visible = idx < n && st.opacity > 0.001;
      ref.visible = visible;
      if (!visible) continue;
      ref.position.set(st.x * cardW, st.y * cardH, st.z);
      ref.scale.setScalar(st.scale);
      const mesh = ref.children[0] as THREE.Mesh | undefined;
      const mat = mesh?.material as THREE.MeshBasicMaterial | undefined;
      if (mat) mat.opacity = st.opacity;
    }

    // Entrance: the whole group rises from below to its band centre as the
    // gallery opens.
    // Entrance lift deep enough that at entrance=0 the whole stack starts fully
    // below the screen (no sliver peeking) and rises into its band centre.
    const entrance = THREE.MathUtils.clamp(span / 0.04, 0, 1);
    group.position.y = bandOffsetY - (1 - entrance) * cardH * 2.3;

    // Hover only: parallax tilt + scale-up while the cursor is over the card.
    const px = ptr.current.x;
    const py = ptr.current.y;
    const over =
      !reducedMotion &&
      Math.abs(px) < hoverHalfX &&
      Math.abs(py - hoverCenterY) < hoverHalfY;
    hover.current = approach(hover.current, over ? 1 : 0, delta, HOVER_RATE);
    group.scale.setScalar(1 + (HOVER_SCALE - 1) * hover.current);
    const relY = py - hoverCenterY;
    rotX.current = approach(rotX.current, -relY * HOVER_TILT_MAX * hover.current, delta, HOVER_RATE);
    rotY.current = approach(rotY.current, px * HOVER_TILT_MAX * hover.current, delta, HOVER_RATE);
    group.rotation.x = rotX.current;
    group.rotation.y = rotY.current;
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
  const { lead } = cardConveyorFor(galleryRef.current);
  const idx = lead + slot;
  const n = GALLERY_IMAGES.length;
  if (idx >= n) return null;
  const realIdx = idx % n;
  return <GalleryCard src={GALLERY_IMAGES[realIdx]} index={realIdx} width={cardW} height={cardH} />;
}
