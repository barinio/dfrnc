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
  frameIndexFor,
  frameTierForScreen,
  FRAME_COUNT,
} from "../frames";
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
// scrubbing the whole time (videoMasterTimeFor → frameIndexFor). The crop is a
// true texture sub-window of the full-bleed cover image (no squash). While the
// crop is actively forming a full-screen screen-space clip is used; once the card
// is formed, the real card mesh takes over. The black GalleryBackdrop sits behind
// it (z = −3.6) so the vacated area reads black.

const PLANE_Z = -3.5;

interface VideoPlaneProps {
  scrollRef: MutableRefObject<number>;
  galleryRef: MutableRefObject<number>;
  phase: Phase;
  // Fired once the first frame is decodable (or on error) — lets Scene hold the
  // intro loader until the clip can render at its sp=0.63 reveal, so the user
  // never scrolls into an empty screen. Called on error too so a failed/slow
  // sequence can never deadlock the loader (Scene also has a timeout).
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
  // True once the first frame is loaded (the sequence can render).
  const readyRef = useRef(false);
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

    const loader = new FrameSequenceLoader(frameTierForScreen(), FRAME_COUNT, {
      onFirstReady: () => {
        readyRef.current = true;
        notifyReady(); // first frame decodable → let the loader release
      },
    });
    loaderRef.current = loader;

    // Safety net: if the very first frame fails to load, still release the loader
    // so a stuck sequence can never deadlock the intro (Scene also has a timeout).
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

  useFrame(() => {
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

    // Pick + upload the scroll-indexed frame. get() returns the nearest loaded
    // frame, so a fast scroll that outruns the download holds a near frame
    // instead of going blank; once decoded the exact frame lands next tick.
    const idx = frameIndexFor(t);
    const img = readyRef.current ? loader.get(idx) : null;
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

    // Full-bleed cover-crop: maps the 16:9 source frame onto the WHOLE screen,
    // always CENTERED (no pan — the clip is framed center).
    const frameAspect = 16 / 9;
    let repeatX: number, repeatY: number, offsetX: number, offsetY: number;
    if (aspect < frameAspect) {
      // Viewport narrower than the frame (portrait phones): crop sides, centered.
      repeatX = aspect / frameAspect;
      repeatY = 1;
      offsetX = (1 - repeatX) * 0.5;
      offsetY = 0;
    } else {
      // Viewport wider/flatter (landscape): crop top/bottom, centered.
      repeatX = 1;
      repeatY = frameAspect / aspect;
      offsetX = 0;
      offsetY = (1 - repeatY) / 2;
    }

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
