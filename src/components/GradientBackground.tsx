import { useMemo, useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";

// Sits behind the Lottie plane (z = -1). Because it is an OPAQUE object it is
// included in the renderer's transmission buffer, so the glass model refracts it
// — it doubles as the dark backdrop the refraction needs while also being the
// visible animated background (a port of bg_dunkel.html into the scene).
const PLANE_Z = -2;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Animated dark iridescent gradient — straight port of the bg_dunkel.html
// fragment shader, with gl_FragCoord/resolution swapped for plane UVs.
const fragmentShader = /* glsl */ `
  varying vec2 vUv;
  uniform vec2 uResolution;
  uniform float uTime;

  float noise(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  vec3 srgbToLinear(vec3 c) {
    return mix(pow((c + 0.055) / 1.055, vec3(2.4)), c / 12.92, step(c, vec3(0.04045)));
  }

  // Inverse of the (Narkowicz) ACES filmic tonemap, solved per channel.
  vec3 inverseACES(vec3 y) {
    vec3 a = 2.43 * y - 2.51;
    vec3 b = 0.59 * y - 0.03;
    vec3 c = 0.14 * y;
    vec3 disc = sqrt(max(b * b - 4.0 * a * c, 0.0));
    return (-b - disc) / (2.0 * a);
  }

  void main() {
    vec2 fragCoord = vUv * uResolution;
    vec2 uv = vUv;
    vec2 pos = uv * 2.0 - 1.0;
    pos.x *= uResolution.x / uResolution.y;

    vec3 color = vec3(0.0);

    vec2 spot1 = vec2(sin(uTime * 0.15) * 1.3, cos(uTime * 0.12) * 1.2);
    color += vec3(0.064, 0.075, 0.107) * (1.0 - smoothstep(0.0, 1.5, length(pos - spot1)));

    vec2 spot2 = vec2(cos(uTime * 0.13 + 4.5) * 1.4, sin(uTime * 0.16 + 1.2) * 1.1);
    color += vec3(0.107, 0.086, 0.128) * (1.0 - smoothstep(0.0, 1.6, length(pos - spot2)));

    vec2 spot3 = vec2(sin(uTime * 0.11 + 3.14) * 1.2, cos(uTime * 0.14 + 5.5) * 1.3);
    color += vec3(0.064, 0.043, 0.054) * (1.0 - smoothstep(0.0, 1.4, length(pos - spot3)));

    vec2 spot4 = vec2(cos(uTime * 0.17 + 2.5) * 1.1, sin(uTime * 0.10 + 4.0) * 1.4);
    color += vec3(0.086, 0.118, 0.128) * (1.0 - smoothstep(0.0, 1.7, length(pos - spot4)));

    float grainSize = max(uResolution.x, uResolution.y) / 62.5;
    vec2 grainUV = fragCoord / grainSize;
    float grain = (noise(grainUV + uTime * 0.05) - 0.5) * 0.15;
    color += vec3(grain);

    float speckNoise = noise(grainUV + uTime * 0.2);
    if (speckNoise > 0.92) {
      float hueNoise = fract(noise(grainUV * 2.0) + uTime * 0.05);
      float hue = mix(0.5, 1.0, hueNoise);
      float brightness = (speckNoise - 0.92) * 10.0;
      color += hsv2rgb(vec3(hue, 1.0, brightness)) * 0.5;
    }

    vec3 contrasted = (color - 0.5) * 1.05 + 0.5;
    vec3 finalColor = contrasted / 2.0 + vec3(0.0107);
    // The shader was authored for direct display. Pre-invert the post pipeline
    // (ACES tonemap effect + sRGB output encode) so it round-trips to these
    // exact values on screen instead of being washed out or crushed.
    vec3 target = srgbToLinear(clamp(finalColor, 0.0, 1.0));
    gl_FragColor = vec4(clamp(inverseACES(target), 0.0, 1.0), 1.0);
  }
`;

export default function GradientBackground() {
  const { camera, viewport, size } = useThree();
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
    }),
    [],
  );

  // Size the plane to exactly fill the camera frustum at PLANE_Z.
  const { width, height } = useMemo(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const distance = cam.position.z - PLANE_Z;
    const h = 2 * distance * Math.tan((cam.fov * Math.PI) / 360);
    return { width: h * (viewport.width / viewport.height), height: h };
  }, [camera, viewport.width, viewport.height]);

  const matRef = useRef<THREE.ShaderMaterial>(null);
  useFrame((state) => {
    uniforms.uTime.value = state.clock.elapsedTime;
    uniforms.uResolution.value.set(size.width, size.height);
  });

  return (
    <mesh position={[0, 0, PLANE_Z]}>
      <planeGeometry args={[width, height]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        toneMapped={false}
        depthWrite={false}
      />
    </mesh>
  );
}
