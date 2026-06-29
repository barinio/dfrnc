import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  videoStateFor,
  videoMasterTimeFor,
  VIDEO_SEEK_SETTLE_EPS,
  VIDEO_SEEK_STALL_MS,
  videoSeekCommandFor,
  videoSeekSettled,
} from "../playback";
import { videoCardMorphFor, videoCardExitProgressFor, CARD_RADIUS_VH } from "../gallery";
import { VID_FLY_END } from "../constants";
import { approach } from "../cursorTilt";
import type { Phase } from "../playback";

// VideoPlane renders the FPV video as an in-scene mesh at z = −3.5, between
// the Lottie plane (z = −3) and the gradient background (z = −4). Because it
// is inside the scene the Noise/SMAA postprocessing covers it (consistent film
// grain), and the white Lottie letters (opaque, alphaTest) occlude it while
// the alphaTest gaps reveal the bright video behind the typography.
//
// In the gallery (gp > 0) the same plane MORPHS into slide #1: it crops from
// the top, then horizontally, down to an image-card rect (gaining rounded
// corners via a fragment SDF mask), holds, then flies straight UP off the top
// FULLY OPAQUE (no dissolve — matching the image cards) — scrubbing the whole
// time (videoMasterTimeFor). The crop is a true texture sub-window of the
// full-bleed cover image (no squash); the black GalleryBackdrop sits behind it
// (z = −3.6) so the vacated area reads black.

const PLANE_Z = -3.5;

// Hover parallax for the FPV once it has MORPHED into card form (slide #1), so it
// reacts to the cursor just like the image cards. Tilt is a touch stronger than
// the image cards (0.16) because the card sits deeper in the frustum (z = −3.5 vs
// z = 0), which foreshortens the same rotation less.
const HOVER_TILT_MAX = 0.18; // ~10° max parallax tilt on hover (radians)
const HOVER_RATE = 9; // ease rate for the tilt
const HOVER_PAD = 1.08; // hit-region padding (matches CardStack)

// Scrub robustness: the paused video is seeked every frame. Issue at most ONE
// seek at a time (browsers silently DROP coalesced seeks, and the last one can
// be lost → the frame freezes) and always re-converge to the latest target once
// the previous seek settles.
const SEEK_EPS = VIDEO_SEEK_SETTLE_EPS; // ~half a 25 fps frame; above seek jitter
const SEEK_STALL_MS = VIDEO_SEEK_STALL_MS; // a seek whose `seeked` never fires is treated as dropped

// Responsive source: phones get the lighter 720p (16.5 MB — plenty sharp on a
// small screen, far easier on mobile data), wide screens the crisp full-bleed
// 1080p (30.5 MB). MUST match the media-scoped <link rel=preload> in index.html
// so the preloaded file is reused, not fetched twice.
const SMALL_SCREEN_MQ = "(max-width: 899.98px)";
function videoSrcForScreen(): string {
  const small =
    typeof window !== "undefined" && window.matchMedia(SMALL_SCREEN_MQ).matches;
  return import.meta.env.BASE_URL + (small ? "fpv-720.mp4" : "fpv.mp4");
}

interface VideoPlaneProps {
  scrollRef: MutableRefObject<number>;
  galleryRef: MutableRefObject<number>;
  phase: Phase;
  // Fired once the first decodable frame is ready (or on error) — lets Scene hold
  // the intro loader until the video can actually render at its sp=0.63 reveal,
  // so the user never scrolls into an empty screen. Called on error too so a
  // failed/slow video can never deadlock the loader (Scene also has a timeout).
  onReady?: () => void;
}

export default function VideoPlane({ scrollRef, galleryRef, phase, onReady }: VideoPlaneProps) {
  const { camera, viewport } = useThree();
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const textureRef = useRef<THREE.VideoTexture | null>(null);
  // Scrub state: latest desired time (from scroll), the time we last ISSUED a
  // seek to, whether a seek is in flight, and when it started (stall watchdog).
  const desiredRef = useRef<number>(-1);
  const issuedRef = useRef<number>(-1);
  const seekingRef = useRef(false);
  const seekStartRef = useRef(0);
  // True once the video has a decodable first frame (loadeddata fired).
  // Buffering starts at page load (component always mounted, preload=auto);
  // this gate is the slow-network fallback so the plane never shows black.
  const readyRef = useRef(false);
  // Degraded mode per the spec's error handling: latched on 404/decode/data-saver.
  const failedRef = useRef(false);
  // Latest onReady, kept in a ref so the video-creating effect (below) never
  // re-runs — and never recreates the element — when the callback identity changes.
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
  // uSize = the card's world W/H (the mesh scale); uRadius = corner radius in the
  // same world units (0 = square full-bleed → card radius once morphed).
  const maskUniforms = useRef({
    uRadius: { value: 0 },
    uSize: { value: new THREE.Vector2(1, 1) },
  });

  // Pointer (NDC) for the card-form parallax hit-test + tilt direction, tracked
  // on window (the canvas layer is pointer-events:none). Eased tilt in refs so
  // the scrub stays React-render-free.
  const ptr = useRef({ x: 0, y: 0 });
  const rotX = useRef(0);
  const rotY = useRef(0);
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      ptr.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      ptr.current.y = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  // meshBasicMaterial has no corner radius, so inject a rounded-rect signed-
  // distance alpha mask into the fragment. A dedicated vMaskUv = uv carries the
  // raw [0,1] geometry UV (vMapUv is warped by the texture sub-window transform,
  // so it can't be used here). fwidth gives a crisp ~1px antialiased edge; the
  // discard keeps fully-outside fragments from writing anything.
  const installMask = useCallback((shader: THREE.WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uRadius = maskUniforms.current.uRadius;
    shader.uniforms.uSize = maskUniforms.current.uSize;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vMaskUv;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\n\tvMaskUv = uv;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec2 vMaskUv;\nuniform float uRadius;\nuniform vec2 uSize;",
      )
      .replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>
	{
		vec2 b = uSize * 0.5;
		float rr = min(uRadius, min(b.x, b.y));
		vec2 p = (vMaskUv - 0.5) * uSize;
		vec2 q = abs(p) - b + rr;
		float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rr;
		float aa = fwidth(d);
		float mask = 1.0 - smoothstep(-aa, aa, d);
		if (mask < 0.001) discard;
		gl_FragColor.a *= mask;
	}`,
      );
  }, []);

  // Issue a seek toward the latest desired time, but only when no seek is in
  // flight — coalesced seeks get dropped by the browser and the final one can be
  // lost, freezing the frame. The `seeked` handler and the stall watchdog re-call
  // this so we always converge to the newest target. Allocation-free; safe to
  // call every frame.
  const issueSeekIfIdle = useCallback((video: HTMLVideoElement) => {
    const now = performance.now();
    const want = desiredRef.current;
    const command = videoSeekCommandFor({
      desiredTime: want,
      issuedTime: issuedRef.current,
      seeking: seekingRef.current,
      elapsedMs: now - seekStartRef.current,
      eps: SEEK_EPS,
      stallMs: SEEK_STALL_MS,
    });
    if (command.stalled) seekingRef.current = false;
    if (!command.issue) return;
    try {
      video.currentTime = want;
      issuedRef.current = want;
      seekingRef.current = true;
      seekStartRef.current = now;
    } catch {
      issuedRef.current = -1;
      seekingRef.current = false; // decoder hiccup: the next frame retries
    }
  }, []);

  // Create a detached video element imperatively (NOT in the DOM render path).
  // A detached element loads and seeks fine in all modern browsers.
  useEffect(() => {
    const video = document.createElement("video");
    video.src = videoSrcForScreen();
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";

    const texture = new THREE.VideoTexture(video);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;

    // VideoTexture auto-updates only while playing. Since we scrub a paused
    // video we push needsUpdate manually: on `seeked` (and re-converge to the
    // latest target) and, more robustly, whenever the decoder presents a frame.
    const onSeeked = () => {
      seekingRef.current = false;
      texture.needsUpdate = true;
      issueSeekIfIdle(video); // chase the newest target if scroll moved meanwhile
    };
    const onLoaded = () => {
      readyRef.current = true;
      texture.needsUpdate = true;
      notifyReady(); // first frame decodable → let the loader release
    };
    const onError = () => {
      failedRef.current = true;
      notifyReady(); // don't deadlock the loader on a failed video
    };
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("loadeddata", onLoaded);
    video.addEventListener("error", onError);

    // requestVideoFrameCallback fires when a frame is actually composited — a
    // reliable "the new frame is ready" signal even when `seeked` is flaky
    // (same-decoded-frame seeks or low readyState don't always fire `seeked`).
    let rvfcHandle = 0;
    const rvfc = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (
        cb: (now: number, metadata: { mediaTime: number }) => void,
      ) => number;
      cancelVideoFrameCallback?: (h: number) => void;
    };
    const onVideoFrame = (_now: number, metadata: { mediaTime: number }) => {
      texture.needsUpdate = true;
      if (
        seekingRef.current &&
        videoSeekSettled(metadata.mediaTime, issuedRef.current)
      ) {
        seekingRef.current = false;
        issueSeekIfIdle(video); // `seeked` can be late/missing; rVFC proves the frame arrived
      }
      if (rvfc.requestVideoFrameCallback)
        rvfcHandle = rvfc.requestVideoFrameCallback(onVideoFrame);
    };
    if (rvfc.requestVideoFrameCallback)
      rvfcHandle = rvfc.requestVideoFrameCallback(onVideoFrame);

    textureRef.current = texture;
    if (matRef.current) matRef.current.map = texture;

    // Start loading (no append to document needed).
    video.load();

    return () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("loadeddata", onLoaded);
      video.removeEventListener("error", onError);
      if (rvfc.cancelVideoFrameCallback && rvfcHandle)
        rvfc.cancelVideoFrameCallback(rvfcHandle);
      texture.dispose();
      textureRef.current = null;
      // Detach source to release network/decoder resources.
      video.src = "";
      video.load();
    };
  }, [issueSeekIfIdle, notifyReady]);

  useFrame((_s, delta) => {
    const texture = textureRef.current;
    const mat = matRef.current;
    const mesh = meshRef.current;
    if (!texture || !mat || !mesh) return;

    // Degraded mode: video failed to load (404/decode/data-saver).
    // Force the mesh invisible before any opacity write so the dark
    // GradientBackground owns the frame; scroll timeline is unaffected.
    if (failedRef.current) {
      mesh.visible = false;
      return;
    }

    const sp = scrollRef.current;
    const gp = galleryRef.current;
    const aspect = viewport.width / viewport.height;
    // Scrub time spans the whole clip life (past sp = 1 into the gallery), so
    // the frame never freezes while the card morphs / holds / flies.
    const t = videoMasterTimeFor(sp, gp, phase);
    const morph = videoCardMorphFor(gp, aspect);
    mesh.renderOrder = gp > 1e-4 && gp < VID_FLY_END ? 1 : 0;
    // sp-based reveal fade-in (behind the typography). morph.opacity is always 1
    // now — the card flies up OPAQUE (no dissolve), so it is hidden off `visible`
    // (flown / gp ≥ VID_FLY_END), NOT off opacity.
    const opacity = videoStateFor(sp, phase).opacity * morph.opacity;
    mat.opacity = opacity;
    // Never show the plane before the video has a decodable first frame —
    // sampling a not-yet-ready VideoTexture yields black. readyRef flips true
    // in the loadeddata listener (early on fast connections; slow-network fallback
    // keeps the GradientBackground visible until the first frame is decoded).
    // morph.visible drops false once the card has flown off the top.
    mesh.visible = readyRef.current && morph.visible && opacity > 0.001;

    if (!mesh.visible) return;

    // Camera frustum size at PLANE_Z — the full-bleed reference rect.
    const cam = camera as THREE.PerspectiveCamera;
    const distance = cam.position.z - PLANE_Z;
    const fullH = 2 * distance * Math.tan((cam.fov * Math.PI) / 360);
    const fullW = fullH * aspect;

    // morph.crop is the on-screen rect (screen fractions) the card occupies —
    // full [0,1,0,1] at gp ≤ 0, collapsing to the image-card rect over the morph.
    const { l, r, b, t: cropTop } = morph.crop;

    const video = texture.image as HTMLVideoElement;
    const dur = video.duration;
    if (Number.isFinite(dur) && dur > 0) {
      // Clamp short of the end so the held last frame never flickers black.
      let target = Math.min(t * dur, dur - 0.05);

      // Buffer-aware clamp: on a slow connection a fast scroll can outrun the
      // download. Don't seek past what's actually buffered — hold on the latest
      // available frame (the scrub then catches up as more arrives) instead of
      // stalling on a doomed seek into an un-downloaded region. Progressive
      // download means the range covering us starts at/near 0; leave a small
      // margin so the seek lands on a frame that is definitely decoded.
      const buffered = video.buffered;
      if (buffered.length > 0) {
        let end = 0;
        for (let i = 0; i < buffered.length; i++) {
          if (buffered.start(i) <= target) end = Math.max(end, buffered.end(i));
        }
        if (end > 0) target = Math.min(target, Math.max(end - 0.1, 0));
      }

      // Full-bleed cover-crop: maps the 16:9 source onto the WHOLE screen,
      // always CENTERED (no pan — the clip is framed center).
      const videoAspect = 16 / 9;
      let repeatX: number, repeatY: number, offsetX: number, offsetY: number;
      if (aspect < videoAspect) {
        // Viewport narrower than video (portrait phones): crop sides, centered.
        repeatX = aspect / videoAspect;
        repeatY = 1;
        offsetX = (1 - repeatX) * 0.5;
        offsetY = 0;
      } else {
        // Viewport wider/flatter (landscape): crop top/bottom, centered.
        repeatX = 1;
        repeatY = videoAspect / aspect;
        offsetX = 0;
        offsetY = (1 - repeatY) / 2;
      }

      // Morph crop: show only the SUB-window of the full-bleed cover image that
      // lies under the crop rect (linear in screen fractions) — a true crop, no
      // squash. At gp ≤ 0 (rect = full screen) this is the identity mapping.
      texture.repeat.set(repeatX * (r - l), repeatY * (cropTop - b));
      texture.offset.set(offsetX + repeatX * l, offsetY + repeatY * b);

      // Robust converging scrub: record the desired time and issue a seek only
      // when idle; the `seeked` / stall paths converge to the latest target, so a
      // dropped coalesced seek can never leave the frame frozen.
      desiredRef.current = target;
      issueSeekIfIdle(video);
    }

    // Placement: the crop rect, translated up by `rise` during the fly-out (the
    // texture window stays frozen at the card crop, so the card keeps its content
    // and just rises off-screen). Allocation-free.
    const placeB = b + morph.rise;
    const placeT = cropTop + morph.rise;
    const cx = (l + r) / 2;
    const cy = (placeB + placeT) / 2;
    const scaleX = (r - l) * fullW;
    const scaleY = (cropTop - b) * fullH; // = (placeT - placeB): rise is a translation
    mesh.scale.set(scaleX, scaleY, 1);
    mesh.position.set((cx * 2 - 1) * (fullW / 2), (cy * 2 - 1) * (fullH / 2), PLANE_Z);

    // Drive the rounded-corner mask: uSize = the card's world dimensions, uRadius
    // grows with morph.radius to the SAME fraction of the card height the image
    // cards use (CARD_RADIUS_VH / CARDS_VH applied to the card-format height
    // CARDS_VH · fullH ⇒ CARD_RADIUS_VH · fullH). Square (0) at full-bleed.
    maskUniforms.current.uSize.value.set(scaleX, scaleY);
    maskUniforms.current.uRadius.value = morph.radius * CARD_RADIUS_VH * fullH;

    // Card-form parallax: tilt the card toward the cursor while it is in card
    // shape, mirroring the image cards. `tiltEnv` ramps in with how card-shaped it
    // is (morph.radius: 0 full-bleed → 1 once morphed) and fades out as it flies
    // off (videoCardExitProgressFor) so it never leaves the frame still skewed.
    // The hit-region is the card's CURRENT on-screen rect (it follows the rise),
    // in NDC. Skipped under reduced motion (phase "done").
    const tiltEnv = phase === "scroll" ? morph.radius * (1 - videoCardExitProgressFor(gp)) : 0;
    const cxNdc = l + r - 1; // ((l + r) / 2) · 2 − 1
    const cyNdc = placeB + placeT - 1; // ((placeB + placeT) / 2) · 2 − 1 (rise included)
    const relX = ptr.current.x - cxNdc;
    const relY = ptr.current.y - cyNdc;
    const over =
      tiltEnv > 0.001 &&
      Math.abs(relX) < (r - l) * HOVER_PAD &&
      Math.abs(relY) < (cropTop - b) * HOVER_PAD;
    const amt = over ? tiltEnv : 0; // scale the tilt by how "card" it is right now
    rotX.current = approach(rotX.current, -relY * HOVER_TILT_MAX * amt, delta, HOVER_RATE);
    rotY.current = approach(rotY.current, relX * HOVER_TILT_MAX * amt, delta, HOVER_RATE);
    mesh.rotation.set(rotX.current, rotY.current, 0);
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
