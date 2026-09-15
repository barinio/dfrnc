import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { videoStateFor, videoMasterTimeFor } from "../playback";
import {
  videoCardMorphFor,
  videoUsesScreenClipFor,
  CARD_RADIUS_VH,
} from "../gallery";
import { VID_FLY_END } from "../constants";
import {
  FrameSequenceLoader,
  frameLoaderBudgetFor,
  frameTierForScreen,
  isPortraitTier,
  coverSourceWindow,
  applyPortraitCrop,
  FRAME_COUNT,
} from "../frames";
import type { SourceWindow } from "../frames";
import {
  advanceScrubFrame,
  getLastPaintedScrubFrame,
  setLastPaintedScrubFrame,
  scrubTargetFrameFor,
} from "../frameScrub";
import type { Phase } from "../playback";

// VideoPlane renders the FPV clip as an in-scene mesh at z = −3.5, between the
// Lottie plane (z = −3) and the gradient background (z = −4). It is scrubbed by
// scroll: the clip is a pre-extracted WebP FRAME SEQUENCE (public/frames/<tier>/,
// see scripts/extract-frames.mjs) and each scroll position paints its frame as a
// texture — NOT an HTMLVideoElement. Seeking/playing a <video> per scroll frame
// is unreliable on iOS/WebKit (offscreen muted-video decode suspends, paused
// seeks are throughput-limited → the "church frame" froze). An Image→texture
// upload is frame-accurate and rock-solid on every browser.
//
// In the gallery (gp > 0) the same plane MORPHS into slide #1: it crops from the
// top, then horizontally, down to an image-card rect (gaining rounded corners via
// a fragment SDF mask), holds, then flies straight UP off the top FULLY OPAQUE —
// scrubbing the whole time (videoMasterTimeFor → scrubTargetFrameFor). The crop is a
// true texture sub-window of the full-bleed cover image (no squash). While the
// crop is actively forming a full-screen screen-space clip is used; once the card
// is formed, the real card mesh takes over. The black GalleryBackdrop sits behind
// it (z = −3.6) so the vacated area reads black.

const PLANE_Z = -3.5;

// Horizontal centre of the cover-crop window when the viewport is NARROWER
// than the 16:9 frame (phones crop to the central ~26% of the source width).
// 0.5 = centered. Pulled LEFT to 0.45 — a STATIC shift applied from the very
// start (per supervisor: "зі старту відос змістити", no mid-clip pan) — which
// moves the whole picture RIGHT on screen so the second baked caption
// ("ZUHAUSE IM HERZEN DER SCHWEIZ", centred ≈39% of the frame width) stays in
// view on portrait screens. 0.45 is the floor that keeps the FIRST caption
// ("WIR SIND EIN KLEINES…", right edge ≈58%) fully inside the portrait window
// (window right edge = 0.45 + 0.13 = 0.58) — any further left clips it.
const NARROW_PAN_CENTER_X = 0.45;

// Scratch for the per-frame source-UV window (frames.ts writes into it) so the
// render loop allocates nothing. Module scope: there is only ever one VideoPlane.
const SOURCE_WINDOW: SourceWindow = {
  repeatX: 1,
  repeatY: 1,
  offsetX: 0,
  offsetY: 0,
};

// How far from the frame the chase is ASKING for the loader may substitute an
// already-decoded neighbour (frames.ts get()'s ±window fallback). Kept tiny: the
// whole point of the rate limit is that the painted frame advances at the clip's
// native pace, and a substitute 30 frames away paints a picture the chase never
// asked for — read on screen as a speed-up or a tear. If nothing within ±2 is
// decoded, get() returns null and the plane simply HOLDS its current texture.
const SCRUB_SUBSTITUTE_WINDOW = 2;

// How far ahead/behind the painted frame the loader keeps decoding. At the
// native 12.5 frames/s an 8-frame lead is ~0.64 s of runway, which is what keeps
// the ±2 substitution window populated instead of starving into holds.
const SCRUB_PREFETCH_RADIUS = 8;

// The float frame position last painted lives in frameScrub.ts (module scope,
// so a remount resumes the chase instead of snapping) — the scroll governor
// reads the same value for decode backpressure, and must not import three.

interface VideoPlaneProps {
  scrollRef: MutableRefObject<number>;
  galleryRef: MutableRefObject<number>;
  phase: Phase;
  // Fired once frame 0 is decoded (or terminally failed) and all nine startup
  // anchors have settled. This gives the first reveal a drawable frame plus
  // coarse whole-clip coverage; terminal errors still cannot deadlock Scene.
  onReady?: () => void;
}

export default function VideoPlane({
  scrollRef,
  galleryRef,
  phase,
  onReady,
}: VideoPlaneProps) {
  const { camera, viewport } = useThree();
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const textureRef = useRef<THREE.Texture | null>(null);
  const loaderRef = useRef<FrameSequenceLoader | null>(null);
  const currentImgRef = useRef<HTMLImageElement | null>(null);
  // Float position of the frame actually being PAINTED. The scroll target is
  // still an exact function of scroll position; this chases it at the clip's
  // native rate (see frameScrub.ts). null = nothing painted yet ⇒ adopt the
  // target. Seeded from the module-level survivor so a remount resumes.
  const displayedFrameRef = useRef<number | null>(getLastPaintedScrubFrame());
  // True once the staged startup barrier has settled (the sequence can render
  // frame 0 or the nearest successfully loaded startup anchor).
  const readyRef = useRef(false);
  // Whether this session is scrubbing the PORTRAIT crop tier. Decided ONCE with
  // the loader's tier (never swapped mid-session), so the UV remap below can
  // never disagree with the pixels actually being downloaded.
  const portraitTierRef = useRef(false);
  // Latest onReady kept in a ref so the loader effect never re-runs on identity
  // change (it would recreate the whole frame loader).
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const notifiedReadyRef = useRef(false);
  const notifyReady = useCallback(() => {
    if (notifiedReadyRef.current) return;
    notifiedReadyRef.current = true;
    onReadyRef.current?.();
  }, []);

  // Rounded-corner mask uniforms, shared by reference with the patched material
  // (set inside onBeforeCompile) so useFrame can drive them allocation-free.
  const maskUniforms = useRef({
    uRadius: { value: 0 },
    uSize: { value: new THREE.Vector2(1, 1) },
    uScreenClip: { value: 0 },
    uClipRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uClipRadius: { value: 0 },
    uAspect: { value: 1 },
  });

  // meshBasicMaterial has no corner radius, so inject a rounded-rect signed-
  // distance alpha mask into the fragment. A dedicated vMaskUv = uv carries the
  // raw [0,1] geometry UV (vMapUv is warped by the texture sub-window transform,
  // so it can't be used here). fwidth gives a crisp ~1px antialiased edge; the
  // discard keeps fully-outside fragments from writing anything.
  const installMask = useCallback((shader: THREE.WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uRadius = maskUniforms.current.uRadius;
    shader.uniforms.uSize = maskUniforms.current.uSize;
    shader.uniforms.uScreenClip = maskUniforms.current.uScreenClip;
    shader.uniforms.uClipRect = maskUniforms.current.uClipRect;
    shader.uniforms.uClipRadius = maskUniforms.current.uClipRadius;
    shader.uniforms.uAspect = maskUniforms.current.uAspect;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vMaskUv;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\n\tvMaskUv = uv;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec2 vMaskUv;\nuniform float uRadius;\nuniform vec2 uSize;\nuniform float uScreenClip;\nuniform vec4 uClipRect;\nuniform float uClipRadius;\nuniform float uAspect;",
      )
      .replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>
	{
		float mask = 1.0;
		if (uScreenClip > 0.5) {
			vec2 center = vec2((uClipRect.x + uClipRect.z) * 0.5, (uClipRect.y + uClipRect.w) * 0.5);
			vec2 b = vec2(max((uClipRect.z - uClipRect.x) * 0.5 * uAspect, 0.0), max((uClipRect.w - uClipRect.y) * 0.5, 0.0));
			float rr = min(max(uClipRadius, 0.0), min(b.x, b.y));
			vec2 p = vec2((vMaskUv.x - center.x) * uAspect, vMaskUv.y - center.y);
			vec2 q = abs(p) - b + rr;
			float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rr;
			float aa = max(fwidth(d), 0.0001);
			mask = 1.0 - smoothstep(-aa, aa, d);
			gl_FragColor.rgb = mix(vec3(0.0), gl_FragColor.rgb, mask);
			gl_FragColor.a = 1.0;
		} else {
			vec2 b = uSize * 0.5;
			float rr = min(uRadius, min(b.x, b.y));
			vec2 p = (vMaskUv - 0.5) * uSize;
			vec2 q = abs(p) - b + rr;
			float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rr;
			float aa = fwidth(d);
			mask = 1.0 - smoothstep(-aa, aa, d);
		}
		if (mask < 0.001) discard;
		gl_FragColor.a *= mask;
	}`,
      );
  }, []);

  // Create the frame texture + start preloading the sequence. The texture's
  // .image is swapped to the current frame each scroll tick (texImage2D upload).
  useEffect(() => {
    const texture = new THREE.Texture();
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    textureRef.current = texture;

    const tier = frameTierForScreen();
    portraitTierRef.current = isPortraitTier(tier);
    const loader = new FrameSequenceLoader(tier, FRAME_COUNT, {
      ...frameLoaderBudgetFor(tier),
      // Wider foreground neighbourhood than the loader default (2). Concurrency
      // stays on the per-tier budget — this widens the QUEUE, not the number of
      // simultaneous requests, so phones keep their 4-request ceiling.
      neighborRadius: SCRUB_PREFETCH_RADIUS,
      onStartupReady: () => {
        readyRef.current = true;
        notifyReady();
      },
    });
    loaderRef.current = loader;

    // Safety net for requests that never settle at all; ordinary terminal image
    // errors satisfy the startup barrier themselves. Scene has the same hard cap.
    const failSafe = window.setTimeout(() => notifyReady(), 8000);

    return () => {
      window.clearTimeout(failSafe);
      loader.dispose();
      loaderRef.current = null;
      texture.dispose();
      textureRef.current = null;
      currentImgRef.current = null;
    };
  }, [notifyReady]);

  useFrame((_state, delta) => {
    const texture = textureRef.current;
    const mat = matRef.current;
    const mesh = meshRef.current;
    const loader = loaderRef.current;
    if (!texture || !mat || !mesh || !loader) return;

    const sp = scrollRef.current;
    const gp = galleryRef.current;
    const aspect = viewport.width / viewport.height;
    // Scrub time spans the whole clip life (past sp = 1 into the gallery), so the
    // frame never freezes while the card morphs / holds / flies.
    const t = videoMasterTimeFor(sp, gp, phase);
    const morph = videoCardMorphFor(gp, aspect);
    // Full-screen screen-space clip only while the crop is actively forming; once
    // card-shaped the real card mesh takes over (avoids full-screen overdraw).
    const screenClip = videoUsesScreenClipFor(gp);
    mesh.renderOrder = gp > 1e-4 && gp < VID_FLY_END ? 1 : 0;
    // sp-based reveal fade-in (behind the typography). morph.opacity is always 1
    // (the card flies up OPAQUE), so the plane is hidden off `visible` once flown.
    const opacity = videoStateFor(sp, phase).opacity * morph.opacity;
    mat.opacity = opacity;

    // Pick + upload the frame. The scroll target stays an exact function of
    // scroll position, but the PAINTED frame chases it at the clip's NATIVE rate
    // (frameScrub.ts) — it can lag arbitrarily far behind a fast scroll and walk
    // the whole way back at 1×, which is the point: the clip never plays faster
    // than it was shot. "done" (reduced motion) never scrubs: it holds the
    // static last frame, so it snaps rather than animating there.
    const targetFrame = scrubTargetFrameFor(t);
    const displayed =
      phase === "done"
        ? targetFrame
        : advanceScrubFrame(displayedFrameRef.current, targetFrame, delta);
    displayedFrameRef.current = displayed;
    // Publish the painted position for the scroll governor's decode
    // backpressure (and for a future remount). The timestamp is what lets a
    // paused render loop be recognised as STALE instead of freezing the page.
    setLastPaintedScrubFrame(displayed, performance.now());
    // Request the DISPLAYED index — the slow, predictable chase — never the raw
    // scroll target: that keeps both the foreground decode priority and the
    // directional prefetch on frames that are actually about to be painted.
    // Substitution is capped at ±SCRUB_SUBSTITUTE_WINDOW; a null result means
    // nothing that close is decoded yet, and the plane holds its last texture
    // rather than jumping to a frame the chase never reached.
    const idx = Math.round(displayed);
    const img = readyRef.current
      ? loader.get(
          idx,
          SCRUB_SUBSTITUTE_WINDOW,
          Math.sign(targetFrame - displayed),
        )
      : null;
    if (import.meta.env.DEV) {
      (window as unknown as { __fp?: unknown }).__fp = {
        idx,
        target: Math.round(targetFrame),
        displayed: Math.round(displayed * 1000) / 1000,
        lag: Math.round((targetFrame - displayed) * 1000) / 1000,
        resolved: loader.lastResolved,
        loadedCount: loader.loadedCount,
        loadedHere: loader.isLoaded(idx),
        imgNull: img === null,
        startupReady: loader.startupReady,
        startupLoadedCount: loader.startupLoadedCount,
        inFlight: loader.inFlightCount,
        sp: Math.round(sp * 1000) / 1000,
        gp: Math.round(gp * 1000) / 1000,
        t: Math.round(t * 1000) / 1000,
      };
    }
    if (img && img !== currentImgRef.current) {
      currentImgRef.current = img;
      texture.image = img;
      texture.needsUpdate = true;
      if (mat.map !== texture) {
        mat.map = texture;
        mat.needsUpdate = true;
      }
    }

    // Never show the plane before a frame is ready (an empty texture is black).
    mesh.visible =
      readyRef.current &&
      currentImgRef.current !== null &&
      morph.visible &&
      opacity > 0.001;
    if (!mesh.visible) return;

    // Camera frustum size at PLANE_Z — the full-bleed reference rect.
    const cam = camera as THREE.PerspectiveCamera;
    const distance = cam.position.z - PLANE_Z;
    const fullH = 2 * distance * Math.tan((cam.fov * Math.PI) / 360);
    const fullW = fullH * aspect;

    // morph.crop is the on-screen rect (screen fractions) the card occupies —
    // full [0,1,0,1] at gp ≤ 0, collapsing to the image-card rect over the morph.
    const { l, r, b, t: cropTop } = morph.crop;
    const placeB = b + morph.rise;
    const placeT = cropTop + morph.rise;
    const cx = (l + r) / 2;
    const cy = (placeB + placeT) / 2;
    const cardScaleX = (r - l) * fullW;
    const cardScaleY = (cropTop - b) * fullH; // = (placeT - placeB): rise is a translation

    // Full-bleed cover-crop of the 16:9 SOURCE frame onto the whole screen
    // (coverSourceWindow in frames.ts — shared with the tier assertions so the
    // sampled range can be proved, not eyeballed). On the portrait tier the
    // texture only holds u ∈ [cropX0, cropX1] of that source, so the finished
    // window is rebased into the crop's own UV space (and clamped inside it, for
    // a phone rotated to landscape after load). Every consumer of the window
    // below — full-bleed, screen-clip morph, card-mesh fly-up — composes with
    // these numbers, so this is the single remap point. The SDF mask reads
    // vMaskUv (raw geometry uv, plane space) and is untouched by it.
    const win = coverSourceWindow(aspect, NARROW_PAN_CENTER_X, SOURCE_WINDOW);
    if (portraitTierRef.current) applyPortraitCrop(win);
    const { repeatX, repeatY, offsetX, offsetY } = win;

    if (screenClip) {
      // During the active morph, leave the frame full-screen and let the shader
      // reveal only the current screen rect.
      texture.repeat.set(repeatX, repeatY);
      texture.offset.set(offsetX, offsetY);
    } else {
      // Fly-up uses a real card mesh with the SUB-window frozen to the card, so
      // the frame content moves with the card as it leaves the frame.
      texture.repeat.set(repeatX * (r - l), repeatY * (cropTop - b));
      texture.offset.set(offsetX + repeatX * l, offsetY + repeatY * b);
    }

    // Placement: morph/hold is full-screen frame with a screen-space clip mask;
    // fly-up switches to the card mesh so its sampled content travels with it.
    const keepFullBleed = screenClip;
    const scaleX = keepFullBleed ? fullW : cardScaleX;
    const scaleY = keepFullBleed ? fullH : cardScaleY;
    mesh.scale.set(scaleX, scaleY, 1);
    mesh.position.set(
      keepFullBleed ? 0 : (cx * 2 - 1) * (fullW / 2),
      keepFullBleed ? 0 : (cy * 2 - 1) * (fullH / 2),
      PLANE_Z,
    );
    mesh.rotation.set(0, 0, 0);

    // Drive the masks. screenClip mode uses a full-screen mesh plus a screen-space
    // rounded rect; card mode uses the local rounded-rect mask.
    maskUniforms.current.uSize.value.set(scaleX, scaleY);
    maskUniforms.current.uRadius.value = keepFullBleed
      ? 0
      : morph.radius * CARD_RADIUS_VH * fullH;
    maskUniforms.current.uScreenClip.value = screenClip ? 1 : 0;
    maskUniforms.current.uClipRect.value.set(l, placeB, r, placeT);
    maskUniforms.current.uClipRadius.value = morph.radius * CARD_RADIUS_VH;
    maskUniforms.current.uAspect.value = aspect;
  });

  return (
    <mesh ref={meshRef} position={[0, 0, PLANE_Z]} visible={false}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        ref={matRef}
        toneMapped={false}
        transparent={true}
        depthWrite={false}
        opacity={0}
        onBeforeCompile={installMask}
      />
    </mesh>
  );
}
