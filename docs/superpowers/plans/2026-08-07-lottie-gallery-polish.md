# Lottie and Gallery Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply approved fixes 1–4: install the corrected gallery-title export, keep the next intro rows outside the comp until entry, finish the `AUSGEZEICHNETES` settle before 3D, resume Lottie only after the final figure, and cover the mobile finale with uniform black.

**Architecture:** Static Lottie exports remain the source of truth for authored glyph motion. Pure timeline constants in `src/constants.ts` control the Lottie/figure handoff and are asserted by `scripts/check-playback.ts`; the CTA coverage is a CSS change verified both by a source assertion and browser screenshots.

**Tech Stack:** TypeScript, React, @react-three/fiber, lottie-web, Vite, `npx tsx` assertion scripts, Puppeteer screenshot harness.

---

## File map

- `src/assets/titles.json` — byte-identical supplied gallery-title export.
- `src/assets/animation.json` — two corrected pre-entry X positions only.
- `src/constants.ts` — frame-103 intro hold plus revised figure/start-resume anchors.
- `src/playback.ts`, `src/arc.ts` — choreography comments kept consistent with the new non-overlap.
- `scripts/check-playback.ts` — semantic and asset regression assertions.
- `src/index.css` — black CTA coverage behind the existing clip reveal.
- `scripts/verify/shot.mjs` — optional short-canvas probe for the mobile toolbar strip.

### Task 1: Lock and install the corrected authored assets

**Files:**
- Modify: `scripts/check-playback.ts`
- Replace: `src/assets/titles.json`
- Modify mechanically: `src/assets/animation.json`

- [ ] **Step 1: Write failing asset assertions**

Add the hash import and helpers near the top of `scripts/check-playback.ts`:

```ts
import { createHash } from "node:crypto";

type JsonObject = Record<string, unknown>;

function findNamedObject(value: unknown, name: string): JsonObject {
  if (Array.isArray(value)) {
    for (const child of value) {
      try { return findNamedObject(child, name); } catch { /* keep walking */ }
    }
  } else if (value && typeof value === "object") {
    const object = value as JsonObject;
    if (object.nm === name) return object;
    for (const child of Object.values(object)) {
      try { return findNamedObject(child, name); } catch { /* keep walking */ }
    }
  }
  throw new Error(`named object not found: ${name}`);
}
```

Immediately after reading `titles.json`, assert the approved export and semantic anchors:

```ts
const titleRaw = readFileSync(
  new URL("../src/assets/titles.json", import.meta.url),
);
const titleHash = createHash("sha256").update(titleRaw).digest("hex");
ok(
  titleHash === "1ec3df8fee4662bebe35c491a7f3d6e289ecec0b04d477df0ed8cb6571fe7462",
  "gallery title asset is the supplied titles_2.0 export",
);
const correctedTitle = JSON.parse(titleRaw.toString("utf8")) as {
  layers: Array<{ nm: string; ks: { p: { k: number[] }; s: { k: Array<{ t: number; s: number[] }> } } }>;
};
const finalTitle = correctedTitle.layers.find(
  (layer) => layer.nm === "multidisziplinaere_gestaltung Outlines",
)!;
eq(finalTitle.ks.p.k[1], 998.5, "corrected final title Y");
eq(finalTitle.ks.s.k.length, 14, "corrected final title scale samples");
eq(finalTitle.ks.s.k.at(-1)!.t, 73, "corrected final title settle frame");

const introData = JSON.parse(
  readFileSync(new URL("../src/assets/animation.json", import.meta.url), "utf8"),
);
const und = findNamedObject(introData, "5_UND Outlines") as {
  ks: { p: { k: Array<{ s?: number[] }> } };
};
const entwickelt = findNamedObject(introData, "6_ENTWICKELT Outlines") as {
  ks: { p: { k: Array<{ s?: number[] }> } };
};
eq(und.ks.p.k[0].s![0], -260, "UND starts beyond the left comp edge");
eq(entwickelt.ks.p.k[0].s![0], 1745, "ENTWICKELT starts beyond the right comp edge");
```

- [ ] **Step 2: Run the assertion script and confirm RED**

Run:

```bash
npx tsx scripts/check-playback.ts
```

Expected: FAIL at the gallery-title hash (`6679…` is still installed) and, after that is corrected, at the old `-248`/`1709` intro positions.

- [ ] **Step 3: Replace `titles.json` mechanically and verify identity**

Run:

```bash
cp /Users/ivan/Downloads/titles_2.0.json src/assets/titles.json
shasum -a 256 /Users/ivan/Downloads/titles_2.0.json src/assets/titles.json
```

Expected: both lines start with `1ec3df8fee4662bebe35c491a7f3d6e289ecec0b04d477df0ed8cb6571fe7462`.

- [ ] **Step 4: Move only the two authored pre-entry positions**

First prove each source token is unique:

```bash
rg -o '"s":\[-248,425,0\]|"s":\[1709,425,0\]' src/assets/animation.json
```

Expected: exactly two matches, one for each token. Then perform the two mechanical replacements:

```bash
perl -0pi -e 's/"s":\[-248,425,0\]/"s":[-260,425,0]/; s/"s":\[1709,425,0\]/"s":[1745,425,0]/' src/assets/animation.json
```

Confirm the old values are gone and both new values occur once:

```bash
rg -o '"s":\[-260,425,0\]|"s":\[1745,425,0\]' src/assets/animation.json
```

- [ ] **Step 5: Run tests and confirm GREEN**

Run:

```bash
npx tsx scripts/check-playback.ts
npm run typecheck
```

Expected: `check-playback: all assertions passed`; TypeScript exits 0.

- [ ] **Step 6: Commit the asset correction**

```bash
git add scripts/check-playback.ts src/assets/titles.json src/assets/animation.json
git commit -m "fix(assets): install corrected title and intro exports"
```

### Task 2: Retiming the settled intro and 3D handoff

**Files:**
- Modify: `scripts/check-playback.ts`
- Modify: `src/constants.ts`
- Modify comments: `src/playback.ts`, `src/arc.ts`

- [ ] **Step 1: Replace the obsolete overlap assertions with the approved invariants**

After locating `AUSGEZEICHNETES Outlines` through `findNamedObject`, add:

```ts
const ausgezeichnetes = findNamedObject(introData, "AUSGEZEICHNETES Outlines") as {
  ks: { s: { k: Array<{ t: number }> } };
};
const ausgezeichnetesSettle = Math.max(
  ...ausgezeichnetes.ks.s.k.map((keyframe) => keyframe.t),
);
eq(LOTTIE_INTRO_S * 30, 103, "intro hold uses authored frame 103");
ok(
  LOTTIE_INTRO_S * 30 >= ausgezeichnetesSettle,
  "intro hold is after the AUSGEZEICHNETES settle",
);
ok(FIGURES_START > REVEAL_END, "3D begins after the complete text reveal");
const lastLandingSp =
  FIGURES_START + last[1] * (FIGURES_END - FIGURES_START);
ok(
  lastLandingSp <= LOTTIE_SCRUB_START,
  "last figure lands before the Lottie resumes",
);
eq(
  lottieTimeFor(lastLandingSp, "scroll"),
  LOTTIE_INTRO_S,
  "Lottie remains held through the last figure landing",
);
```

Delete the old assertion that requires the Lottie to be scrubbing during the final figure exit, and update its surrounding comment to the new no-overlap rule.

- [ ] **Step 2: Run and confirm RED**

Run: `npx tsx scripts/check-playback.ts`

Expected: FAIL because `LOTTIE_INTRO_S * 30` is `90`, `FIGURES_START` is before `REVEAL_END`, and the old scrub resumes before the last landing.

- [ ] **Step 3: Apply the approved physical anchors**

In `src/constants.ts`, use:

```ts
export const LOTTIE_INTRO_S = 103 / 30;
export const REVEAL_END = 136 / SCROLL_TRACK_VH;
export const FIGURES_START = 144 / SCROLL_TRACK_VH;
export const LOTTIE_SCRUB_START = 356 / SCROLL_TRACK_VH;
export const FIGURES_END = 464 / SCROLL_TRACK_VH;
```

Update the adjacent comments to say that frame 103 is the completed settle, figures launch after an 8vh clean beat, and GBA lands at `355.2vh` immediately before the `356vh` resume. Do not change `VIDEO_START`, `LOTTIE_ZOOM_S`, `LOTTIE_END`, or any video-time knot.

Update stale comments in `src/playback.ts` and `src/arc.ts` so they no longer claim that figures launch during the reveal or that the Lottie resumes during the final figure exit. Do not change executable behavior in those two files.

- [ ] **Step 4: Run timeline tests, typecheck, and build**

```bash
npx tsx scripts/check-playback.ts
npm run typecheck
npm run build
```

Expected: all assertions pass, TypeScript exits 0, and Vite prints a successful production build.

- [ ] **Step 5: Commit the choreography correction**

```bash
git add scripts/check-playback.ts src/constants.ts src/playback.ts src/arc.ts
git commit -m "fix(timeline): settle intro before the 3d sequence"
```

### Task 3: Cover the dynamic mobile viewport at the CTA finale

**Files:**
- Modify: `scripts/check-playback.ts`
- Modify: `src/index.css`
- Modify: `scripts/verify/shot.mjs`

- [ ] **Step 1: Add a failing CSS regression assertion**

Add near the other source-level checks:

```ts
const indexCss = readFileSync(
  new URL("../src/index.css", import.meta.url),
  "utf8",
);
const ctaRule = indexCss.match(/\.gallery-cta\s*\{[\s\S]*?\}/)?.[0] ?? "";
ok(
  /background-color:\s*#000(?:000)?\s*;/.test(ctaRule),
  "gallery CTA supplies black coverage beyond the 100svh canvas",
);
ok(/clip-path:\s*inset\(/.test(ctaRule), "CTA black coverage stays clip-revealed");
```

- [ ] **Step 2: Run and confirm RED**

Run: `npx tsx scripts/check-playback.ts`

Expected: FAIL because `.gallery-cta` still uses `background-color: transparent`.

- [ ] **Step 3: Make the clipped CTA background black**

In `src/index.css`, replace only `background-color: transparent` inside the existing CTA rule with `background-color: #000000`, and update its explanatory comment:

```css
.gallery-cta {
    /* The same clip that uncovers the wordmark also uncovers black coverage
       below the rising card, including visual-viewport space beyond 100svh. */
    background-color: #000000;
}
```

Keep the existing fixed `inset: 0`, z-index, opacity, and `clip-path` behavior. Update the preceding explanatory comment so it no longer claims the wrapper is transparent.

- [ ] **Step 4: Add a short-canvas verification option**

In `scripts/verify/shot.mjs`, parse an optional positive pixel height:

```js
const canvasHeightRaw = opt("canvas-height", null);
const canvasHeight = canvasHeightRaw === null ? null : Number(canvasHeightRaw);
if (canvasHeight !== null && (!Number.isFinite(canvasHeight) || canvasHeight <= 0)) {
  throw new Error("--canvas-height must be a positive pixel value");
}
```

After the loader unlocks and before screenshots are taken, apply it only when supplied:

```js
if (canvasHeight !== null) {
  await page.evaluate((height) => {
    const layer = document.querySelector(".canvas-layer");
    if (!layer) throw new Error("missing .canvas-layer");
    layer.style.setProperty("height", `${height}px`, "important");
  }, canvasHeight);
}
```

- [ ] **Step 5: Run assertions and build**

```bash
npx tsx scripts/check-playback.ts
npm run build
```

Expected: assertions pass and the production build succeeds.

- [ ] **Step 6: Commit the finale coverage**

```bash
git add scripts/check-playback.ts src/index.css scripts/verify/shot.mjs
git commit -m "fix(mobile): cover the full CTA viewport"
```

### Task 4: Browser verification for fixes 1–4

**Files:**
- No production changes expected.
- Evidence: `/private/tmp/dfrnc-polish-*`

- [ ] **Step 1: Start the dev server**

```bash
npm run dev -- --host 127.0.0.1
```

Record the actual port and use it below.

- [ ] **Step 2: Capture intro checkpoints on phone and desktop**

Use `scripts/verify/shot.mjs` with the current `--track 1240` and a warm wait:

```bash
node scripts/verify/shot.mjs --url http://127.0.0.1:5173 \
  --sp 0.1097,0.1129,0.1162,0.2865,0.2871,0.2967,0.3141 \
  --out /private/tmp/dfrnc-polish-phone --track 1240 --wait 9000 --viewport 390x690
node scripts/verify/shot.mjs --url http://127.0.0.1:5173 \
  --sp 0.1097,0.2865,0.2967,0.3141 \
  --out /private/tmp/dfrnc-polish-desktop --track 1240 --wait 9000 --viewport 1280x740
```

Expected by visual inspection: no early pixels from `UND` or `ENTWICKELT`; `AUSGEZEICHNETES` is fully settled before the first 3D figure; no final text jerk is visible after GBA leaves.

- [ ] **Step 3: Verify the taller visual viewport finale**

Run the existing seam/viewport-height harness and capture the CTA end before and after a height increase:

```bash
node scripts/verify/seam.mjs --url http://127.0.0.1:5173 --track 1240 --viewport 390x690
node scripts/verify/shot.mjs --url http://127.0.0.1:5173 --gp 1 \
  --canvas-height 690 --out /private/tmp/dfrnc-polish-cta \
  --track 1240 --wait 9000 --viewport 390x844
```

Expected: seam script prints `PASS`; the full final viewport is uniform black behind the white CTA with no `#0a0a0a` strip.

- [ ] **Step 4: Run the final automated gate for this plan**

```bash
npx tsx scripts/check-playback.ts
npm run typecheck
npm run build
git status --short
```

Expected: all commands pass; status contains no uncommitted files from fixes 1–4.
