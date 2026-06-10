import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { videoStateFor } from "../playback";
import type { Phase } from "../playback";

// VideoPlane renders the FPV video as an in-scene mesh at z = −1.5, between
// the Lottie plane (z = −1) and the gradient background (z = −2). Because it
// is inside the scene the Noise/SMAA postprocessing covers it (consistent film
// grain), and the white Lottie letters (opaque, alphaTest) occlude it while
// the alphaTest gaps reveal the bright video behind the typography.

const PLANE_Z = -1.5;

// (videoTime seconds → object-position-x %) keyframes for the portrait crop.
// The 16:9 frame is cover-cropped on phones; the baked-in taglines drift away
// from frame-center during parts of the clip, so the crop window pans to keep
// them centered.
// Tuned from portrait screenshots (390×844) at sp 0.82-0.98:
//   t≈2.6-5.2s  "WIR SIND EIN INTERNATIONALES KREATIVSTUDIO" sits right-of-center
//   t≈8-12s     "ZUHAUSE IM HERZEN DER SCHWEIZ" is heavily right-clipped
// Increasing % shifts the visible window rightward (shows more right side of source).
const PAN_KEYFRAMES: ReadonlyArray<readonly [number, number]> = [
  [0, 50],
  [2.0, 50],
  [2.6, 52],   // "WIR SIND..." right-of-center; gentle rightward shift
  [5.5, 51],   // tagline still slightly right; taper
  [7.5, 50],   // no tagline (aerial bridge); return to center
  [9.5, 50],   // transition into second tagline segment
  [10.0, 72],  // "ZUHAUSE IM HERZEN DER SCHWEIZ" — right-of-center
  [11.5, 78],  // text grows as drone flies into sign; keep shifting right
  [12.5, 72],  // taper as text begins to fade
  [13.0, 50],  // tagline fades; ease back to center
  [14.24, 50],
];

function panXFor(time: number): number {
  const k = PAN_KEYFRAMES;
  if (time <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) {
    if (time <= k[i][0]) {
      const f = (time - k[i - 1][0]) / (k[i][0] - k[i - 1][0]);
      return k[i - 1][1] + f * (k[i][1] - k[i - 1][1]);
    }
  }
  return k[k.length - 1][1];
}

interface VideoPlaneProps {
  scrollRef: MutableRefObject<number>;
  phase: Phase;
}

export default function VideoPlane({ scrollRef, phase }: VideoPlaneProps) {
  const { camera, viewport } = useThree();
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const textureRef = useRef<THREE.VideoTexture | null>(null);
  const lastTime = useRef<number>(-1);

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
    const onLoaded = () => { texture.needsUpdate = true; };
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("loadeddata", onLoaded);

    textureRef.current = texture;
    if (matRef.current) matRef.current.map = texture;

    // Start loading (no append to document needed).
    video.load();

    return () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("loadeddata", onLoaded);
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

    const { t, opacity } = videoStateFor(scrollRef.current, phase);
    mat.opacity = opacity;
    mesh.visible = opacity > 0.001;

    if (!mesh.visible) return;

    const video = texture.image as HTMLVideoElement;
    const dur = video.duration;
    if (Number.isFinite(dur) && dur > 0) {
      // Clamp short of the end so the held last frame never flickers black.
      const target = Math.min(t * dur, dur - 0.05);

      // Update texture transform (cover-crop + pan).
      const planeAspect = viewport.width / viewport.height;
      const videoAspect = 16 / 9;
      if (planeAspect < videoAspect) {
        // Viewport narrower than video (portrait): crop sides.
        // panX=50 → centered; panX=78 → shows more right side.
        // Equivalent to CSS object-position X% for a cover-cropped frame.
        texture.repeat.set(planeAspect / videoAspect, 1);
        texture.offset.set((1 - texture.repeat.x) * (panXFor(target) / 100), 0);
      } else {
        // Viewport wider/flatter (landscape): crop top/bottom, centered.
        texture.repeat.set(1, videoAspect / planeAspect);
        texture.offset.set(0, (1 - texture.repeat.y) / 2);
      }

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

    // Recompute plane size every frame (cheap; handles resize/orientation changes).
    const cam = camera as THREE.PerspectiveCamera;
    const distance = cam.position.z - PLANE_Z;
    const h = 2 * distance * Math.tan((cam.fov * Math.PI) / 360);
    const w = h * (viewport.width / viewport.height);
    const geo = mesh.geometry as THREE.PlaneGeometry;
    // Only rebuild geometry when the size actually changes.
    const params = geo.parameters;
    if (Math.abs(params.width - w) > 0.001 || Math.abs(params.height - h) > 0.001) {
      mesh.geometry.dispose();
      mesh.geometry = new THREE.PlaneGeometry(w, h);
    }
  });

  // Compute initial plane dimensions for the first render.
  const cam = camera as THREE.PerspectiveCamera;
  const distance = cam.position.z - PLANE_Z;
  const initH = 2 * distance * Math.tan((cam.fov * Math.PI) / 360);
  const initW = initH * (viewport.width / viewport.height);

  return (
    <mesh ref={meshRef} position={[0, 0, PLANE_Z]} visible={false}>
      <planeGeometry args={[initW, initH]} />
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
