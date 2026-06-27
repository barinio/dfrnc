import type { ForwardRefExoticComponent, RefAttributes } from "react";
import { Effect } from "postprocessing";
import { Uniform } from "three";
import { wrapEffect } from "@react-three/postprocessing";

// Scroll-driven ACES tone mapping.
//
// Why a custom effect instead of postprocessing's <ToneMapping>: postprocessing
// renders the scene with NO renderer tone mapping and applies ACES ONLY as this
// final post pass, globally — so a material's `toneMapped={false}` cannot exempt
// it, and the pass over-brightens the already-graded FPV footage + gallery photos
// into a milky, lifted look (supervisor: "висвітляючий фільтр"). The glass
// figures, however, are TUNED under ACES and must keep it.
//
// The figures and the video/photos never share the screen (the last figure has
// landed by ~sp 0.51; the video reveals at sp 0.63; the gallery is all past
// sp = 1), so a single scroll-driven `strength` cleanly serves both: strength 1
// over the figures/typography → ACES exactly as before (this replicates three's
// ACESFilmicToneMapping verbatim — same coefficients + exposure — so at
// strength 1 the figures are byte-identical to the old pass); strength → 0 by
// the video reveal → the footage/photos pass through at their true grade.
const fragmentShader = /* glsl */ `
uniform float strength;

const mat3 ACESInputMat = mat3(
  0.59719, 0.07600, 0.02840,
  0.35458, 0.90834, 0.13383,
  0.04823, 0.01566, 0.83777
);
const mat3 ACESOutputMat = mat3(
  1.60475, -0.10208, -0.00327,
  -0.53108, 1.10813, -0.07276,
  -0.07367, -0.00605, 1.07602
);

vec3 RRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}

// Verbatim three.js ACESFilmicToneMapping at toneMappingExposure = 1.0 (the value
// postprocessing's ToneMapping effect runs at — the renderer's 1.1 never reaches
// the post pass).
vec3 acesFilmic(vec3 color) {
  color *= 1.0 / 0.6;
  color = ACESInputMat * color;
  color = RRTAndODTFit(color);
  color = ACESOutputMat * color;
  return clamp(color, 0.0, 1.0);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 toned = acesFilmic(inputColor.rgb);
  outputColor = vec4(mix(inputColor.rgb, toned, strength), inputColor.a);
}
`;

export class ScrollToneMappingEffect extends Effect {
  constructor() {
    super("ScrollToneMappingEffect", fragmentShader, {
      uniforms: new Map([["strength", new Uniform(1)]]),
    });
  }
}

// wrapEffect gives a JSX component whose ref is the effect instance, so a
// useFrame driver can set uniforms.get("strength").value allocation-free. The
// helper's prop inference collapses to `never` for a no-arg constructor, so type
// the export explicitly as a ref-forwarding component.
export const ScrollToneMapping = wrapEffect(
  ScrollToneMappingEffect,
) as unknown as ForwardRefExoticComponent<
  RefAttributes<ScrollToneMappingEffect>
>;
