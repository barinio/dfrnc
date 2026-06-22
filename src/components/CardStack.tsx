import { useMemo, useRef } from "react";
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
} from "../gallery";
import { approach, tiltTarget, idleTilt, TILT_RATE } from "../cursorTilt";

const PLANE_Z = 0; // center of the frustum → pronounced perspective for the tilt

// Per-slot resting offsets (world-unit fractions of card size). Slot 0 = front;
// 1 and 2 peek up and to the right (matches the PDF stack). Repeats every 3.
const SLOT_OFFSETS = [
  { x: 0.0, y: 0.0, s: 1.0, z: 0.0 },
  { x: 0.035, y: 0.045, s: 0.985, z: -0.15 },
  { x: 0.07, y: 0.09, s: 0.97, z: -0.3 },
];

// Discrete-step swiper (radiance.family portfolio-slider feel). The deck holds
// still within each slide's scroll band; the target slide is the ROUNDED conveyor
// position, so crossing a band midpoint flips to the next slide with a quick eased
// fly-up. A big scroll jumps the target several slides and the deck glides through
// the intermediates at a capped even speed, easing to a stop on the target.
// Reversible. See 2026-06-23-gallery-card-swiper-design.md. Both are tuning dials.
const STEP_RATE = 18; // single-step ease rate (higher = snappier; ~0.2s per slide)
const MAX_STEP_PER_SEC = 6; // cascade glide-speed cap (slides/sec) on big scrolls

interface Props {
  galleryRef: MutableRefObject<number>;
  reducedMotion?: boolean;
}

export default function CardStack({ galleryRef, reducedMotion = false }: Props) {
  const { viewport, pointer } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const slotRef0 = useRef<THREE.Group>(null);
  const slotRef1 = useRef<THREE.Group>(null);
  const slotRef2 = useRef<THREE.Group>(null);
  const slotRefs = [slotRef0, slotRef1, slotRef2];
  const rotX = useRef(0);
  const rotY = useRef(0);
  const elapsed = useRef(0);
  // The live displayed slide position (float) that steps toward the rounded
  // target slide; drives lead/local. null until the first frame initializes it.
  const displayedRef = useRef<number | null>(null);

  // Card world size. ≥1:1: 64vh tall, 3:2 (96vh wide). Portrait: 64vh tall,
  // width tracks 86vw. Viewport is in world units (height ≈ 9.24 at z=0).
  const { cardW, cardH } = useMemo(() => {
    const vw = viewport.width;
    const vh = viewport.height;
    const aspect = vw / vh;
    const h = CARDS_VH * vh;
    let w = h * CARD_ASPECT; // landscape/square: keep 3:2
    if (aspect < 1) w = CARDS_WIDTH_VW_PORTRAIT * vw; // portrait: stretch to 86vw
    // 16:9 cap: beyond it the section letterboxes — cards keep their vh-based
    // size (they never grow past 64vh / 96vh), so wide viewports leave empty
    // space left/right automatically.
    return { cardW: w, cardH: h };
  }, [viewport.width, viewport.height]);

  useFrame((_s, delta) => {
    const group = groupRef.current;
    if (!group) return;
    elapsed.current += delta;

    const gp = galleryRef.current;
    const { span } = cardConveyorFor(gp);
    const n = GALLERY_IMAGES.length;
    // Discrete target: the ROUNDED conveyor position, so the deck holds still
    // within a band and flips at the midpoint. Range 0..n (n = all gone → CTA).
    const target = Math.round(span * n);

    // Step the displayed position toward the integer target with a speed-capped
    // exponential ease: a single-slide step eases quickly (~STEP_RATE); a multi-
    // slide jump glides through the intermediates at MAX_STEP_PER_SEC (each
    // briefly visible, one-after-another) and eases to a stop on the target.
    // Reduced motion: jump straight to the target (no animation).
    if (displayedRef.current === null) displayedRef.current = target;
    if (reducedMotion) {
      displayedRef.current = target;
    } else {
      const cur = displayedRef.current;
      const eased = approach(cur, target, delta, STEP_RATE);
      const maxStep = MAX_STEP_PER_SEC * delta;
      let next = eased;
      if (Math.abs(eased - cur) > maxStep)
        next = cur + Math.sign(target - cur) * maxStep; // cap cascade speed
      if (Math.abs(target - next) < 1e-3) next = target; // settle exactly
      displayedRef.current = next;
    }

    const displayed = THREE.MathUtils.clamp(displayedRef.current, 0, n);
    const lead = Math.floor(displayed);
    const local = displayed - lead;

    for (let slot = 0; slot < 3; slot++) {
      const ref = slotRefs[slot].current;
      if (!ref) continue;
      const idx = lead + slot;
      ref.visible = idx < n;
      if (idx >= n) continue;

      // Continuous depth: slot 0 (front) eases to −local as it flies out; the
      // cards behind ease one slot forward as `local` advances 0→1.
      const d = slot - local;
      if (d < 0) {
        // Front card flying up and out of frame (no fade — flies out like the
        // glass figures; clears the top by ≈1.5× the card height).
        const a = SLOT_OFFSETS[0];
        ref.position.set(a.x * cardW, a.y * cardH + -d * cardH * 1.5, a.z);
        ref.scale.setScalar(a.s);
      } else {
        // lo === hi when d >= 2: the back card holds at SLOT_OFFSETS[2] (lerp is identity).
        const lo = Math.min(2, Math.floor(d));
        const hi = Math.min(2, lo + 1);
        const f = d - Math.floor(d);
        const a = SLOT_OFFSETS[lo];
        const b = SLOT_OFFSETS[hi];
        ref.position.set(
          THREE.MathUtils.lerp(a.x, b.x, f) * cardW,
          THREE.MathUtils.lerp(a.y, b.y, f) * cardH,
          THREE.MathUtils.lerp(a.z, b.z, f),
        );
        ref.scale.setScalar(THREE.MathUtils.lerp(a.s, b.s, f));
      }
    }

    // Entrance: the whole stack rises from below as the gallery opens.
    const entrance = THREE.MathUtils.clamp(span / 0.04, 0, 1);
    group.position.y = (1 - entrance) * -cardH * 1.6;

    // Cursor tilt + idle on the whole stack (group rotation).
    const tt = tiltTarget(pointer.x, pointer.y, reducedMotion);
    const it = idleTilt(elapsed.current, reducedMotion);
    rotX.current = approach(rotX.current, tt.x + it.x, delta, TILT_RATE);
    rotY.current = approach(rotY.current, tt.y + it.y, delta, TILT_RATE);
    group.rotation.x = rotX.current;
    group.rotation.y = rotY.current;
  });

  return (
    <group ref={groupRef} position={[0, 0, PLANE_Z]}>
      {[0, 1, 2].map((slot) => (
        <group key={slot} ref={slotRefs[slot]}>
          {/* index is assigned per-frame via the conveyor; the card itself only
              needs a stable slot. Use slot as the placeholder index so each slot
              shows a consistent gray; real images key off the live conveyor idx
              below. */}
          <SlotCard slot={slot} galleryRef={galleryRef} cardW={cardW} cardH={cardH} />
        </group>
      ))}
    </group>
  );
}

// Resolves the live image index for a slot each render-ish; the conveyor lead is
// read from galleryRef. Kept as a tiny child so GalleryCard's texture swaps only
// when the resolved index changes (not every frame).
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
