import { useEffect, useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import GalleryCard, { preloadGalleryTextures } from "./GalleryCard";
import {
  galleryStackDisplayedFor,
  cardStackPlacementFor,
  imageStackRevealFor,
  imageStackVisibleFor,
  GALLERY_IMAGES,
  CARDS_VH,
  CARD_FILL,
  CARD_ASPECT,
  CARDS_WIDTH_VW_PORTRAIT,
  STACK_VISIBLE,
  GUTTER,
  TOP_TITLE_VH,
} from "../gallery";
import { VID_FLY_END } from "../constants";
import { approach } from "../cursorTilt";

const PLANE_Z = 0; // centre of the frustum → pronounced perspective for the tilt

// Hover (radiance.family): parallax + scale apply while the cursor is over the
// front card. The ONE interactive card is the front-most ON-SCREEN card; it
// reacts for its whole on-screen life and hands off to the next when it flies up.
const HOVER_SCALE = 1.05; // front card grows 1 → 1.05 on hover
const HOVER_TILT_MAX = 0.16; // ~9° max parallax tilt on hover (radians)
const HOVER_RATE = 9; // ease rate for the hover scale/tilt
const HOVER_PAD = 1.08; // hover hit-region padding (forgiving)
// Where the interactive role HANDS OFF: once the front card has risen this far
// (local) it has cleared the frame, so the NEXT card (now front-most on screen)
// becomes interactive. Per-card eased tilt → no pop at the swap.
const CARD_LEAVE_AT = 0.6;

// The leaving (front) card flies straight UP and off the top — NO opacity fade
// (direction: "слайди без опасіті улітають"). Distance in card-heights, big
// enough to clear the frame before the next card settles.
const RISE_OFF = 1.9;

// Depth band over which the just-entering card fades in (so the 3-spot cycle
// never pops a card into the back corner). Keeps the 3 settled cards opaque.
const ENTER_FADE = 0.4;

interface Props {
  galleryRef: MutableRefObject<number>;
  cardExitRef: MutableRefObject<number>;
  reducedMotion?: boolean;
}

export default function CardStack({ galleryRef, cardExitRef, reducedMotion = false }: Props) {
  const { viewport, gl } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  // One PERSISTENT mesh per image card. Each keeps its own fixed texture for the
  // whole session and is positioned imperatively by absolute index (no React
  // state in the conveyor — a setState in useFrame lands a frame late and desyncs
  // the content from the imperative position, which read as the cards "jumping").
  const cardRefs = useRef<(THREE.Group | null)[]>([]);
  // Per-card eased parallax state (one entry per image card). Easing EACH card's
  // tilt/scale independently lets the leaving card relax to flat while the
  // incoming one tilts up, with no snap at the hand-off.
  const cardRotX = useRef<number[]>([]);
  const cardRotY = useRef<number[]>([]);
  const cardAmt = useRef<number[]>([]); // eased 0..1 hover amount per card

  // Pointer in normalized device coords, tracked on window so it works despite
  // the canvas layer being pointer-events:none.
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
  // long before the cards scroll in — no async texture pop as the conveyor runs.
  useEffect(() => {
    preloadGalleryTextures(GALLERY_IMAGES, gl.capabilities.getMaxAnisotropy());
  }, [gl]);

  // Outer gallery frame is the PDF's 96vh × 64vh block. The visible cards fill
  // CARD_FILL of that frame and are placed in three slots inside it.
  const { cardW, cardH, bandOffsetY, hoverHalfX, hoverHalfY, hoverCenterY, maxHoverScale } = useMemo(() => {
    const vw = viewport.width;
    const vh = viewport.height;
    const aspect = vw / vh;
    const frameH = CARDS_VH * vh; // 64vh outer frame
    let frameW = frameH * CARD_ASPECT; // landscape/square: 96vh outer frame
    if (aspect < 1) frameW = CARDS_WIDTH_VW_PORTRAIT * vw; // portrait outer frame fallback
    const h = frameH * CARD_FILL;
    const w = frameW * CARD_FILL;
    const frameCenterFromTop = 2 * GUTTER + TOP_TITLE_VH + CARDS_VH / 2; // 0.46
    const bandOffsetY = (0.5 - frameCenterFromTop) * vh;
    const hoverHalfX = (w / vw) * HOVER_PAD;
    const hoverHalfY = (h / vh) * HOVER_PAD;
    const hoverCenterY = (2 * bandOffsetY) / vh;
    // Max hover scale that keeps the centre-scaled front card clear of BOTH title
    // bands: its half-height may grow only into the 3vmin gutter.
    const vmin = Math.min(vw, vh);
    const gutterWorld = GUTTER * vmin;
    const maxHoverScale = 1 + gutterWorld / (h / 2);
    return { cardW: w, cardH: h, bandOffsetY, hoverHalfX, hoverHalfY, hoverCenterY, maxHoverScale };
  }, [viewport.width, viewport.height]);

  useFrame((_s, delta) => {
    const group = groupRef.current;
    if (!group) return;

    const gp = galleryRef.current;
    // The image cards stay hidden during the vertical video crop, then slide out
    // from the video-card centre into their fanned positions. Their conveyor runs
    // in the remapped image-gallery sub-range (card 2 only flies after the video
    // card has cleared).
    const stackReveal = imageStackRevealFor(gp);
    const stackOpacity = imageStackVisibleFor(gp);

    group.visible = stackOpacity > 0;
    if (!group.visible) {
      cardExitRef.current = 0; // titles stay fully opaque before the card phase
      return;
    }
    group.renderOrder = 0;

    const n = GALLERY_IMAGES.length;
    // STEPPED scroll-scrubbed conveyor: each card SETTLES (holds) then FLIES, so a
    // text change (scheduled into the holds — see galleryTitleFrameFor) and a card
    // fly-away never coincide. The video card is virtual card 0, so `displayed`
    // starts at −1 (image card 0 staged one slot back at d1, the upper-left
    // position #2) and ramps −1→0 as the video flies away — image card 0 slides
    // d1→d0 into the front, exactly like every other card hand-off. After the
    // video has cleared it holds at integer k while card k is settled, then ramps
    // k→k+1 as it flies; the stack behind slides forward.
    const displayed = THREE.MathUtils.clamp(galleryStackDisplayedFor(gp), -1, n);
    const lead = Math.floor(displayed);
    const local = displayed - lead;

    // Last-card exit progress for the synchronized finale: 0 until the last card
    // begins leaving, 1 once it is gone. GalleryTitles fades by (1 − cardExit).
    cardExitRef.current = THREE.MathUtils.clamp(displayed - (n - 1), 0, 1);

    // The ONE interactive card = the front-most still on screen: index `lead`
    // until it has risen off (local ≥ CARD_LEAVE_AT), then `lead + 1` takes over.
    const activeIdx = Math.min(local >= CARD_LEAVE_AT ? lead + 1 : lead, n - 1);

    // Continuous depth of the active card → its live on-screen centre (NDC). The
    // hit-region FOLLOWS it: a leaving front card rises; a settled/ incoming card
    // sits at its fanned spot. Testing against this moving centre keeps parallax
    // tracking the card across its whole life.
    const activeD = activeIdx - displayed;
    const aRise = activeD < 0 ? -activeD * RISE_OFF : 0;
    const aPlace = cardStackPlacementFor(activeD);
    const activeCenterX = (2 * aPlace.x * stackReveal * cardW) / viewport.width;
    const activeCenterY =
      hoverCenterY + (2 * (aPlace.y * stackReveal + aRise) * cardH) / viewport.height;
    const relX = ptr.current.x - activeCenterX;
    const relY = ptr.current.y - activeCenterY;
    const over =
      !reducedMotion &&
      gp >= VID_FLY_END &&
      Math.abs(relX) < hoverHalfX &&
      Math.abs(relY) < hoverHalfY;
    const tiltTargetX = over ? -relY * HOVER_TILT_MAX : 0;
    const tiltTargetY = over ? relX * HOVER_TILT_MAX : 0;
    const ampTarget = over ? 1 : 0;
    group.rotation.set(0, 0, 0);
    group.scale.setScalar(1);

    // Walk all cards; each card's continuous depth d = i − displayed drives its
    // fanned placement: d ≤ 0 = the front card (rising up off the top as it
    // leaves); d > 0 = behind, fanned up-right and receding. Cards already gone
    // (d ≤ −1) or beyond the visible fan (d > STACK_VISIBLE) are hidden.
    for (let i = 0; i < n; i++) {
      const ref = cardRefs.current[i];
      if (!ref) continue;

      const isActive = i === activeIdx;
      cardRotX.current[i] = approach(cardRotX.current[i] ?? 0, isActive ? tiltTargetX : 0, delta, HOVER_RATE);
      cardRotY.current[i] = approach(cardRotY.current[i] ?? 0, isActive ? tiltTargetY : 0, delta, HOVER_RATE);
      cardAmt.current[i] = approach(cardAmt.current[i] ?? 0, isActive ? ampTarget : 0, delta, HOVER_RATE);

      const d = i - displayed;
      // Visible: the leaving front card (d > −1, rising) through the back of the
      // 3-spot cycle. The card just ENTERING (d just past STACK_VISIBLE) fades in
      // over ENTER_FADE so the cycle never pops a card into the corner.
      if (d <= -1 || d >= STACK_VISIBLE + ENTER_FADE) {
        ref.visible = false;
        continue;
      }
      const place = cardStackPlacementFor(d);
      const rise = d < 0 ? -d * RISE_OFF : 0; // leaving front card rises straight up
      const x = place.x * stackReveal;
      const y = place.y * stackReveal + rise;
      const hoverScale = Math.min(1 + (HOVER_SCALE - 1) * cardAmt.current[i], maxHoverScale);
      const scale = place.scale * hoverScale;
      // Fade in only the entering card (d in (STACK_VISIBLE, +ENTER_FADE)); the
      // front + the two settled neighbours stay fully opaque, and the leaving
      // front card (d < 0) flies up opaque too.
      const enterFade = THREE.MathUtils.clamp((STACK_VISIBLE + ENTER_FADE - d) / ENTER_FADE, 0, 1);

      ref.rotation.set(cardRotX.current[i], cardRotY.current[i], 0);
      ref.visible = true;
      ref.position.set(x * cardW, y * cardH, place.z);
      ref.scale.setScalar(scale);
      const mesh = ref.children[0] as THREE.Mesh | undefined;
      if (mesh) mesh.renderOrder = 0;
      const mat = mesh?.material as THREE.MeshBasicMaterial | undefined;
      if (mat) mat.opacity = stackOpacity * enterFade;
    }

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
