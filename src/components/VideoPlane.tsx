import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { videoStateFor, videoMasterTimeFor } from "../playback";
import { videoCardMorphFor } from "../gallery";
import type { Phase } from "../playback";

// VideoPlane renders the FPV video as an in-scene mesh at z = −3.5, between
// the Lottie plane (z = −3) and the gradient background (z = −4). Because it
// is inside the scene the Noise/SMAA postprocessing covers it (consistent film
// grain), and the white Lottie letters (opaque, alphaTest) occlude it while
// the alphaTest gaps reveal the bright video behind the typography.
//
// In the gallery (gp > 0) the same plane MORPHS into slide #1: it crops from
// the top, then horizontally, down to an image-card rect, holds, then rises and
// fades — scrubbing the whole time (videoMasterTimeFor). The crop is a true
// texture sub-window of the full-bleed cover image (no squash); the black
// GalleryBackdrop sits behind it (z = −3.6) so the vacated area reads black.

const PLANE_Z = -3.5;

interface VideoPlaneProps {
  scrollRef: MutableRefObject<number>;
  galleryRef: MutableRefObject<number>;
  phase: Phase;
}

export default function VideoPlane({ scrollRef, galleryRef, phase }: VideoPlaneProps) {
  const { camera, viewport } = useThree();
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const textureRef = useRef<THREE.VideoTexture | null>(null);
  const lastTime = useRef<number>(-1);
  // True once the video has a decodable first frame (loadeddata fired).
  // Buffering starts at page load (component always mounted, preload=auto);
  // this gate is the slow-network fallback so the plane never shows black.
  const readyRef = useRef(false);
  // Degraded mode per the spec's error handling: latched on 404/decode/data-saver.
  const failedRef = useRef(false);

  // Create a detached video element imperatively (NOT in the DOM render path).
  // A detached element loads and seeks fine in all modern browsers.
  useEffect(() => {
    const video = document.createElement("video");
    video.src = import.meta.env.BASE_URL + "fpv.mp4";
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
    // video we must push needsUpdate manually after each seek settles.
    const onSeeked = () => { texture.needsUpdate = true; };
    const onLoaded = () => { readyRef.current = true; texture.needsUpdate = true; };
    const onError = () => { failedRef.current = true; };
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("loadeddata", onLoaded);
    video.addEventListener("error", onError);

    textureRef.current = texture;
    if (matRef.current) matRef.current.map = texture;

    // Start loading (no append to document needed).
    video.load();

    return () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("loadeddata", onLoaded);
      video.removeEventListener("error", onError);
      texture.dispose();
      textureRef.current = null;
      // Detach source to release network/decoder resources.
      video.src = "";
      video.load();
    };
  }, []);

  useFrame(() => {
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
    // sp-based reveal fade-in (behind the typography) × gp-based fly-out fade.
    const opacity = videoStateFor(sp, phase).opacity * morph.opacity;
    mat.opacity = opacity;
    // Never show the plane before the video has a decodable first frame —
    // sampling a not-yet-ready VideoTexture yields black. readyRef flips true
    // in the loadeddata listener (early on fast connections; slow-network fallback
    // keeps the GradientBackground visible until the first frame is decoded).
    mesh.visible = readyRef.current && opacity > 0.001;

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
      const target = Math.min(t * dur, dur - 0.05);

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

      // Re-seek only when the target moved by more than ~a frame (1/30 s).
      if (Math.abs(target - lastTime.current) >= 1 / 30) {
        lastTime.current = target;
        try {
          video.currentTime = target;
        } catch {
          // Seek failed (decoder hiccup / data-saver): last decoded frame stays.
        }
      }
    }

    // Placement: the crop rect, translated up by `rise` during the fly-out (the
    // texture window stays frozen at the card crop, so the card keeps its content
    // and just rises off-screen). Allocation-free.
    const placeB = b + morph.rise;
    const placeT = cropTop + morph.rise;
    const cx = (l + r) / 2;
    const cy = (placeB + placeT) / 2;
    mesh.scale.set((r - l) * fullW, (placeT - placeB) * fullH, 1);
    mesh.position.set((cx * 2 - 1) * (fullW / 2), (cy * 2 - 1) * (fullH / 2), PLANE_Z);
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
      />
    </mesh>
  );
}
