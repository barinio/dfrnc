// Derive the PORTRAIT phone frame tier (public/frames/portrait768/) from the
// already-extracted 1920 stills. The master clip (media/fpv.mp4) is not
// committed, so this is the tier's generator on any machine that only has the
// repo: 1920×1080 WebP → crop x ∈ [cropX0, cropX1] at full height → 768×1080
// WebP at the same quality extract-frames.mjs uses (--q, default 80).
//
//   node scripts/crop-portrait-tier.mjs [--q 80] [--jobs 8] [--force]
//
// The crop constants are NOT written here: they are parsed out of the single
// shared PORTRAIT_TIER literal in src/frameManifest.ts (readPortraitTier below,
// also imported by extract-frames.mjs). Change the crop there and re-run this.
//
// Requires cwebp + dwebp (libwebp). This machine's ffmpeg is WebP decode-only,
// so encoding goes through cwebp exactly like extract-frames.mjs does; dwebp
// handles the decode side. cwebp applies -crop BEFORE any resize, and the crop
// is already the final 768×1080, so no resampling happens at all — the only
// loss is the re-encode.
//
// Writes:
//   public/frames/portrait768/0001.webp …   (one per frame in the 1920 tier)
//   public/frames/manifest.json             portraitTier mirrored in
// It does NOT touch the 1280/1920 tiers, the frame count, or src/frameManifest.ts.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// ── the one shared definition ────────────────────────────────────────────────
// Parses `export const PORTRAIT_TIER = { … } as const;` out of the TS module the
// runtime imports, so the generator and the shader-side UV remap can never
// disagree about where the crop is. Deliberately strict: an unparseable literal
// is a hard error, never a silent default.
export function readPortraitTier(root = ROOT) {
  const file = join(root, "src/frameManifest.ts");
  const src = readFileSync(file, "utf8");
  const m = src.match(/export const PORTRAIT_TIER = \{([\s\S]*?)\} as const;/);
  if (!m) {
    throw new Error(`no PORTRAIT_TIER literal found in ${file}`);
  }
  const body = m[1];
  const field = (name, parse) => {
    const hit = body.match(new RegExp(`\\b${name}\\s*:\\s*("[^"]*"|[-\\d.]+)`));
    if (!hit) throw new Error(`PORTRAIT_TIER.${name} missing in ${file}`);
    const value = parse(hit[1]);
    if (value === null) throw new Error(`PORTRAIT_TIER.${name} unreadable in ${file}`);
    return value;
  };
  const str = (raw) => (raw.startsWith('"') ? raw.slice(1, -1) : null);
  const num = (raw) => {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const tier = {
    dir: field("dir", str),
    cropX0: field("cropX0", num),
    cropX1: field("cropX1", num),
    width: field("width", num),
    height: field("height", num),
  };
  if (!(tier.cropX0 >= 0 && tier.cropX1 <= 1 && tier.cropX1 > tier.cropX0)) {
    throw new Error(`PORTRAIT_TIER crop window [${tier.cropX0}, ${tier.cropX1}] is not inside [0, 1]`);
  }
  return tier;
}

// The PORTRAIT_TIER declaration with its doc comment, verbatim. extract-frames.mjs
// regenerates src/frameManifest.ts wholesale, so it round-trips this block rather
// than re-printing (and drifting from) a hand-maintained literal.
export function readPortraitTierBlock(root = ROOT) {
  const file = join(root, "src/frameManifest.ts");
  const src = readFileSync(file, "utf8");
  const m = src.match(
    /(?:^\/\/.*\n)*^export const PORTRAIT_TIER = \{[\s\S]*?^\} as const;\n/m,
  );
  if (!m) throw new Error(`no PORTRAIT_TIER block found in ${file}`);
  return m[0];
}

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function probeSize(file) {
  const out = execFileSync(
    "ffprobe",
    [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "csv=p=0",
      file,
    ],
    { encoding: "utf8" },
  ).trim();
  const [w, h] = out.split(",").map(Number);
  return { width: w, height: h };
}

async function main() {
  const tier = readPortraitTier();
  const quality = Number(arg("q", "80"));
  const jobs = Math.max(1, Number(arg("jobs", "8")));
  const force = process.argv.includes("--force");

  const framesRoot = join(ROOT, "public/frames");
  const manifestPath = join(framesRoot, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  // Source = the WIDEST width tier: the most source pixels available offline.
  const sourceTier = Math.max(...manifest.tiers);
  const srcDir = join(framesRoot, String(sourceTier));
  const outDir = join(framesRoot, tier.dir);

  const srcFiles = readdirSync(srcDir)
    .filter((f) => f.endsWith(`.${manifest.ext}`))
    .sort();
  if (srcFiles.length !== manifest.count) {
    throw new Error(
      `${srcDir} has ${srcFiles.length} frames but the manifest says ${manifest.count}`,
    );
  }

  const { width: srcW, height: srcH } = probeSize(join(srcDir, srcFiles[0]));
  const cropX = Math.round(srcW * tier.cropX0);
  const cropW = Math.round(srcW * (tier.cropX1 - tier.cropX0));
  if (cropW !== tier.width || srcH !== tier.height) {
    throw new Error(
      `crop of the ${srcW}×${srcH} source is ${cropW}×${srcH}, but PORTRAIT_TIER ` +
        `declares ${tier.width}×${tier.height} — fix src/frameManifest.ts`,
    );
  }

  if (existsSync(outDir) && !force) {
    const have = readdirSync(outDir).filter((f) => f.endsWith(".webp")).length;
    if (have === manifest.count) {
      console.log(`crop-portrait-tier: ${outDir} already has ${have} frames (use --force to rebuild)`);
      return;
    }
  }
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  console.log(
    `crop-portrait-tier: ${sourceTier} tier (${srcW}×${srcH}) → ${tier.dir} ` +
      `crop=${cropW}:${srcH}:${cropX}:0 q=${quality} jobs=${jobs} frames=${srcFiles.length}`,
  );

  const tmp = mkdtempSync(join(tmpdir(), "dfrnc-portrait-"));
  const started = Date.now();
  try {
    let next = 0;
    const worker = async (slot) => {
      const png = join(tmp, `w${slot}.png`);
      for (;;) {
        const i = next++;
        if (i >= srcFiles.length) return;
        const name = basename(srcFiles[i], `.${manifest.ext}`);
        // 1) WebP → PNG (ffmpeg here is decode-only for WebP; dwebp is the
        //    libwebp decoder that ships alongside cwebp).
        execFileSync("dwebp", ["-quiet", join(srcDir, srcFiles[i]), "-o", png]);
        // 2) PNG → cropped WebP. -crop runs before any scaling; the crop is
        //    already the target size, so nothing is resampled.
        execFileSync("cwebp", [
          "-quiet",
          "-q", String(quality),
          "-crop", String(cropX), "0", String(cropW), String(srcH),
          png,
          "-o", join(outDir, `${name}.webp`),
        ]);
        if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${srcFiles.length}`);
      }
    };
    await Promise.all(Array.from({ length: jobs }, (_, s) => worker(s)));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  // Mirror the crop into the served manifest, the way extract-frames.mjs mirrors
  // sourceFps/stride: the runtime imports src/frameManifest.ts, but anything
  // reading public/frames/manifest.json sees the same numbers.
  manifest.portraitTier = { ...tier };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `✓ wrote ${srcFiles.length} × ${tier.width}×${tier.height} frames to ` +
      `public/frames/${tier.dir} in ${secs}s + manifest.json portraitTier`,
  );
}

// Importable (extract-frames.mjs reuses readPortraitTier) without running.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
