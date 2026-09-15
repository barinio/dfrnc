// Extract the scrubbed FPV clip to a numbered WebP FRAME SEQUENCE (responsive
// tiers) so the scroll scrub paints decoded images instead of seeking an
// HTMLVideoElement. Seeking/playing a <video> per scroll frame is unreliable on
// iOS/WebKit (decode suspends for offscreen muted video, paused seeks are
// throughput-limited → the "church frame" freeze). An Image→texture upload is
// frame-accurate and rock-solid on every browser. This is the Apple-product-page
// technique (see the miso project).
//
// Requires ffmpeg (decode/scale) + cwebp (this machine's ffmpeg is webp
// DECODE-only, so we go video → PNG via ffmpeg, then PNG → WebP via cwebp).
//
//   node scripts/extract-frames.mjs [--in media/fpv.mp4] [--stride 2] [--q 80]
//                                   [--source-fps 25]
//
// The source master is NOT committed (the deployed site only needs the generated
// public/frames/ tiers). Drop the original clip at media/fpv.mp4 — gitignored —
// or pass --in <path> to it. --stride N keeps every Nth source frame (source is
// 25fps/589 frames; stride 2 ⇒ ~295 frames ≈ 12.5fps, the "~300 frames" choice).
// Writes:
//   public/frames/<W>/0001.webp …            (one dir per tier width)
//   public/frames/<PORTRAIT_TIER.dir>/0001.webp …   (the phone crop tier)
//   public/frames/manifest.json              { count, digits, ext, tiers, sourceFps, stride, portraitTier }
//   src/frameManifest.ts                      (bundled count/tiers/pace for the runtime)
// sourceFps + stride are recorded because the RUNTIME needs them: the scrub caps
// the painted frame at the clip's NATIVE pace, which is sourceFps / stride
// (25 / 2 = 12.5 sequence-frames/s here) — see src/frameScrub.ts. The master's
// rate is detected with ffprobe when available; override with --source-fps N.
// Tiers match VideoPlane's responsive source breakpoint (≤899.98px → mobile).
//
// PORTRAIT tier: phones in portrait only ever show a narrow vertical slice of
// the 16:9 frame, so they additionally get a cropped tier (PORTRAIT_TIER in
// src/frameManifest.ts — the ONE definition of the crop, parsed here and by
// scripts/crop-portrait-tier.mjs). It is cut straight from the full-res PNG, so
// it carries 1.5× the linear resolution (≈2.25× the source pixels) per screen
// pixel that the 1280 tier gives a phone, for a smaller decoded bitmap.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readPortraitTier, readPortraitTierBlock } from "./crop-portrait-tier.mjs";

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const input = join(ROOT, arg("in", "media/fpv.mp4"));
const stride = Number(arg("stride", "2"));
const quality = Number(arg("q", "80"));
// width tiers (16:9 source → height = width*9/16). 1280 matches the current
// mobile video (fpv-720 is 1280×720); 1920 matches the desktop master.
const TIERS = [1280, 1920];
const DIGITS = 4;
const outRoot = join(ROOT, "public/frames");
// Read BEFORE src/frameManifest.ts is regenerated below — the crop literal there
// is the single source of truth and this script only ever round-trips it.
const portraitTier = readPortraitTier(ROOT);
const portraitBlock = readPortraitTierBlock(ROOT);

// Frame rate of the MASTER clip. The sequence keeps every `stride`-th frame, so
// the native pace of the extracted sequence is sourceFps / stride — the runtime
// reads both out of the manifest and caps the scrub there.
function probeSourceFps(file) {
  try {
    const out = execFileSync(
      "ffprobe",
      [
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=r_frame_rate",
        "-of", "default=noprint_wrappers=1:nokey=1",
        file,
      ],
      { encoding: "utf8" },
    ).trim();
    const [num, den] = out.split("/");
    const fps = Number(den) ? Number(num) / Number(den) : Number(num);
    return Number.isFinite(fps) && fps > 0 ? fps : null;
  } catch {
    return null;
  }
}

if (!existsSync(input)) {
  console.error(
    `extract-frames: source video not found at ${input}\n` +
      `The master clip is not committed — drop the original at media/fpv.mp4 ` +
      `(gitignored) or pass --in <path-to-master>.`,
  );
  process.exit(1);
}

const sourceFpsArg = Number(arg("source-fps", "0"));
const sourceFps =
  Number.isFinite(sourceFpsArg) && sourceFpsArg > 0
    ? sourceFpsArg
    : (probeSourceFps(input) ?? 25);

console.log(
  `extract-frames: in=${input} stride=${stride} q=${quality} ` +
    `sourceFps=${sourceFps} (native ${sourceFps / stride} seq-fps) ` +
    `tiers=${TIERS.join(",")}`,
);

const tmp = mkdtempSync(join(tmpdir(), "dfrnc-frames-"));
try {
  // 1) video → full-res PNG, keeping every `stride`-th frame (deterministic, even).
  console.log("→ ffmpeg extracting PNG frames…");
  execFileSync(
    "ffmpeg",
    [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", input,
      "-vf", `select=not(mod(n\\,${stride}))`,
      "-vsync", "0",
      join(tmp, `f%0${DIGITS}d.png`),
    ],
    { stdio: "inherit" },
  );
  const pngs = readdirSync(tmp).filter((f) => f.endsWith(".png")).sort();
  const count = pngs.length;
  if (count === 0) throw new Error("no PNG frames extracted");
  console.log(`  extracted ${count} frames`);

  // 2) PNG → WebP per tier (cwebp resizes by width, height auto = -resize W 0).
  for (const w of TIERS) {
    const dir = join(outRoot, String(w));
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    console.log(`→ cwebp tier ${w}px …`);
    pngs.forEach((p, i) => {
      const name = String(i + 1).padStart(DIGITS, "0"); // 1-indexed file names
      execFileSync("cwebp", [
        "-quiet", "-q", String(quality), "-resize", String(w), "0",
        join(tmp, p), "-o", join(dir, `${name}.webp`),
      ]);
    });
    console.log(`  tier ${w}px done (${count} frames)`);
  }

  // 2b) PORTRAIT crop tier, cut from the SAME full-res PNGs (no intermediate
  //     re-encode). -crop runs before -resize, so the pixels land 1:1.
  {
    const probe = execFileSync(
      "ffprobe",
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", join(tmp, pngs[0])],
      { encoding: "utf8" },
    ).trim();
    const [srcW, srcH] = probe.split(",").map(Number);
    const cropX = Math.round(srcW * portraitTier.cropX0);
    const cropW = Math.round(srcW * (portraitTier.cropX1 - portraitTier.cropX0));
    const dir = join(outRoot, portraitTier.dir);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    console.log(
      `→ cwebp portrait tier ${portraitTier.dir} (crop ${cropW}×${srcH} @${cropX} → ` +
        `${portraitTier.width}×${portraitTier.height}) …`,
    );
    pngs.forEach((p, i) => {
      const name = String(i + 1).padStart(DIGITS, "0");
      execFileSync("cwebp", [
        "-quiet", "-q", String(quality),
        "-crop", String(cropX), "0", String(cropW), String(srcH),
        "-resize", String(portraitTier.width), String(portraitTier.height),
        join(tmp, p), "-o", join(dir, `${name}.webp`),
      ]);
    });
    console.log(`  tier ${portraitTier.dir} done (${count} frames)`);
  }

  // 3) manifest the runtime reads (frame count is data, not a hardcoded const).
  const manifest = {
    count,
    digits: DIGITS,
    ext: "webp",
    tiers: TIERS,
    sourceFps,
    stride,
    portraitTier: { ...portraitTier },
  };
  writeFileSync(join(outRoot, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  // Bundled, type-safe copy imported by src/frames.ts (no resolveJsonModule needed).
  const ts =
    `// AUTO-GENERATED by scripts/extract-frames.mjs — do not edit by hand.\n` +
    `// Describes the scrubbed FPV frame sequence under public/frames/<tier>/NNNN.webp.\n` +
    `// sourceFps/stride record how the sequence was sampled from the master clip, so\n` +
    `// the runtime can derive the clip's NATIVE pace (sourceFps / stride) instead of\n` +
    `// hardcoding it — see src/frameScrub.ts.\n` +
    `export const FRAME_MANIFEST = {\n` +
    `  count: ${count},\n  digits: ${DIGITS},\n  ext: "webp",\n  tiers: [${TIERS.join(", ")}],\n` +
    `  sourceFps: ${sourceFps},\n  stride: ${stride},\n} as const;\n\n` +
    // Round-tripped verbatim: the crop literal is hand-maintained (it is the ONE
    // definition both generators parse), so regenerating the sequence must never
    // silently drop or change it.
    portraitBlock;
  writeFileSync(join(ROOT, "src/frameManifest.ts"), ts);
  console.log(
    `✓ wrote ${count} frames × ${TIERS.length + 1} tiers (+${portraitTier.dir}) ` +
      `+ manifest.json + src/frameManifest.ts`,
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
