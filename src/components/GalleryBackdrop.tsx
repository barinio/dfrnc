import { useRef } from "react";
import type { MutableRefObject } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { galleryBackdropFor } from "../gallery";

// Flat black gallery background. Sits BEHIND the video (z = −3.5), just in front
// of the gradient (z = −4): the FPV video morphs/shrinks into slide #1 and the
// vacated area reveals THIS black; the image cards (z = 0) later sit on it. The
// Lottie final frame (z = −3) is transparent, so it doesn't occlude the video
// card. Opaque for essentially the whole gallery (galleryBackdropFor). Fills the
// camera frustum at its depth.
const PLANE_Z = -3.6;

interface Props {
  galleryRef: MutableRefObject<number>;
}

export default function GalleryBackdrop({ galleryRef }: Props) {
  const { camera, viewport } = useThree();
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(() => {
    const mat = matRef.current;
    const mesh = meshRef.current;
    if (!mat || !mesh) return;
    const op = galleryBackdropFor(galleryRef.current);
    mat.opacity = op;
    mesh.visible = op > 0.001;
    if (!mesh.visible) return;
    const cam = camera as THREE.PerspectiveCamera;
    const distance = cam.position.z - PLANE_Z;
    const h = 2 * distance * Math.tan((cam.fov * Math.PI) / 360);
    const w = h * (viewport.width / viewport.height);
    mesh.scale.set(w, h, 1);
  });

  return (
    <mesh ref={meshRef} position={[0, 0, PLANE_Z]} visible={false}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        ref={matRef}
        color={0x000000}
        toneMapped={false}
        transparent
        depthWrite={false}
        opacity={0}
      />
    </mesh>
  );
}
