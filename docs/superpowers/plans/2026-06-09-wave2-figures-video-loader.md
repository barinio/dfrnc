# Wave 2: Multi-Figure Flights, Video Tail, Ball Loader — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four glass figures flying overlapping scroll-driven dome arcs (frontal at each apex), antialiased edges, a scroll-scrubbed FPV video tail replacing the Lorem section, and a bouncing-balls loader that settles and hands off to an auto-played "DEFT drop" Lottie intro.

**Architecture:** Everything scroll-driven stays a pure function of a scroll-progress ref (`src/playback.ts`), read per-frame inside `useFrame`/rAF — no React re-renders per frame. The loader is the one time-based piece: a self-contained DOM-canvas state machine that gates scroll until release. Figures are data-driven from a manifest in `src/arc.ts`; assets are drop-in files under `public/`.

**Tech Stack:** React 18, @react-three/fiber 8, drei, @react-three/postprocessing (SMAA), three 0.170, lottie-web (canvas renderer), Vite 5, TypeScript. No test runner — verification is `npm run typecheck`, `npm run build`, plus headless system Chrome (puppeteer-core + SwiftShader WebGL) screenshots, per `docs/superpowers/specs/2026-06-09-wave2-figures-video-loader-design.md`.

**Spec:** `docs/superpowers/specs/2026-06-09-wave2-figures-video-loader-design.md` (approved 2026-06-09).

---

## Environment facts (verified)

- macOS, system Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. No ffmpeg, no Blender, no AE.
- Node v22.22.3. Bare `node` cannot run the project's TS (extensionless relative imports) — use `npx tsx` (install with `npm i tsx --no-save`).
- `gsap` is imported ONLY by `src/components/LoremSection.tsx` (verified by grep) — removable with the section.
- `SMAA` is exported by the installed `@react-three/postprocessing`.
- Reference assets in `/Users/ivan/Downloads/Нова папка з елементами 5/`: `260203_fpv_graphics.mp4` (1920×1080, 14.24 s, H.264, taglines baked in), `load_loop.html`, `load_final.html` (ball-physics sources, ported verbatim in Task 10).
- Real figure GLBs / new Lottie JSON do not exist yet (user exports later). All wiring is built against stand-ins: `public/model.glb` copied 4× into `public/figures/`, and the first second of the current `animation.json` standing in for the DEFT drop.
- Dev server: `npm run dev` (Vite picks a free port — read it from the output; examples below assume 5173). `waitUntil: "networkidle2"` hangs on the HMR socket — use `"domcontentloaded"` + explicit waits.
- The scene has animated noise + a `uTime` gradient: **raw pixel diffs always differ**. Compare structure (silhouettes, text bounding boxes), not pixels.

## File map

| File | Status | Responsibility |
|---|---|---|
| `scripts/verify/shot.mjs` | create (Task 0) | Scroll-position screenshot harness |
| `scripts/verify/fps.mjs` | create (Task 2) | rAF frame-rate smoke check (before/after comparisons) |
| `scripts/verify/timed.mjs` | create (Task 10) | Time-offset screenshot harness (loader) |
| `scripts/check-playback.ts` | create (Task 3) | Pure-function sanity assertions for playback.ts |
| `src/constants.ts` | rewrite (Task 3) | New scroll partition + Lottie/video constants |
| `src/playback.ts` | rewrite (Task 3) | `lottieTimeFor`, `figureStateFor`, `videoStateFor` |
| `src/arc.ts` | extend (Task 4) | `ArcConfig` + `side`/`spinTurns`/`window`; `FIGURES` manifest; mirroring |
| `src/components/ArcModel.tsx` | modify (Tasks 1, 3, 5) | Parameterized per-figure flight; apex-centred spin; per-figure material clone |
| `src/components/Scene.tsx` | modify (Tasks 2, 3, 6, 7, 8, 10, 11) | SMAA; 4 figures; Loader; VideoSection; intro stage machine |
| `src/components/LottiePlane.tsx` | modify (Tasks 2, 11) | Supersampled canvas; DEFT-drop autoplay |
| `src/components/Loader.tsx` | create (Task 10) | Ball-canvas overlay + loop→settle state machine |
| `src/components/loaderPhysics.ts` | create (Task 10) | Pure ports of load_loop / load_final ball physics |
| `src/components/VideoSection.tsx` | create (Task 8) | Scroll-scrubbed `<video>`, crossfade, portrait pan |
| `src/components/LoremSection.tsx` | delete (Task 7) | — |
| `src/index.css` | modify (Tasks 8, 10) | `.video-layer`, loader overlay styles |
| `public/figures/{and,tokyo,gba,awwwards}.glb` | create (Task 4) | Stand-in copies of `model.glb` (user swaps later) |
| `public/fpv.mp4`, `public/fpv-poster.jpg` | create (Task 8) | Video asset + poster frame |

## Asset drop-in contract (user-provided later, no code change)

- `public/figures/and.glb`, `tokyo.glb`, `gba.glb`, `awwwards.glb` — GLB, small hierarchy, no materials needed, roughly unit scale.
- `src/assets/animation.json` — new Lottie replacing current; first ~2 s = DEFT drop. Re-measure `DEFT_DROP_S`, `LOTTIE_INTRO_S`, `LOTTIE_TOTAL_S` when it lands.
- `public/fpv.mp4` — if scrubbing stutters, request re-encode (GOP 0.25–0.5 s, `+faststart`).

---

### Task 0: Verification harness + baseline

**Files:**
- Create: `scripts/verify/shot.mjs`

- [ ] **Step 0.1: Install puppeteer-core (not saved) and create the screenshot harness**

Run: `npm i puppeteer-core --no-save`

Create `scripts/verify/shot.mjs`:

```js
// Scroll-position screenshot harness for headless visual verification.
// Usage:
//   node scripts/verify/shot.mjs --url http://localhost:5173 --sp 0,0.3,0.5 \
//     --out /tmp/shots --viewport 1280x800 --track 600 --wait 9000
// Notes:
//   - Drives SYSTEM Chrome with SwiftShader so WebGL works headlessly.
//   - After the fixed wait it also waits for body.scroll-locked to be absent
//     (no-op before the loader exists; waits for loader release after).
import puppeteer from "puppeteer-core";
import { mkdirSync } from "fs";

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};

const CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const url = opt("url", "http://localhost:5173");
const sps = opt("sp", "0").split(",").map(Number);
const out = opt("out", "/tmp/shots");
const [w, h] = opt("viewport", "1280x800").split("x").map(Number);
const track = Number(opt("track", "600")); // keep in sync with SCROLL_TRACK_VH
const wait = Number(opt("wait", "9000"));

mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader-webgl",
    `--window-size=${w},${h}`,
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: w, height: h });
page.on("console", (m) => {
  if (m.text().includes("[DBG]")) console.log("page:", m.text());
});
await page.goto(url, { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, wait)); // Suspense: GLB + Lottie mount
await page.waitForFunction(
  () => !document.body.classList.contains("scroll-locked"),
  { timeout: 30000 },
);
for (const sp of sps) {
  await page.evaluate(
    (sp, track) => {
      const trackMax = ((track - 100) / 100) * window.innerHeight;
      window.scrollTo(0, sp * trackMax);
    },
    sp,
    track,
  );
  await new Promise((r) => setTimeout(r, 600)); // scrub + settle
  const file = `${out}/sp${String(sp).replace(".", "_")}.png`;
  await page.screenshot({ path: file });
  console.log("wrote", file);
}
await browser.close();
```

- [ ] **Step 0.2: Capture a pre-change baseline**

Run (two terminals or background the dev server):

```bash
npm run dev   # note the port it prints
node scripts/verify/shot.mjs --sp 0,0.1,0.3,0.4125,0.5,0.8,1 --out /tmp/wave2-baseline --track 600
```

Expected: 7 PNGs. At `sp=0.4125` (current model-phase midpoint) the glass figure is at the dome apex — note it reads **side-on** (the Item-1 bug). At `sp=1` the Lorem text section is visible.

- [ ] **Step 0.3: Commit**

```bash
git add scripts/verify/shot.mjs
git commit -m "chore: add headless screenshot harness for visual verification"
```

---

### Task 1: Apex-frontal spin fix (Item 1)

**Files:**
- Modify: `src/components/ArcModel.tsx:338` (the `spinY` line)

Commit `5b54bc1` changed the spin phasing so the figure is face-on at the END of the flight (`(1 - t)`) instead of at the APEX. One line restores apex-centred phasing.

- [ ] **Step 1.1: Fix the spin phase**

In `src/components/ArcModel.tsx`, replace:

```ts
    const spinY = (1 - t) * spinTurnsRef.current * Math.PI * 2;
```

with:

```ts
    // Apex-centred spin: zero (frontal) exactly at t = 0.5 — the dome apex —
    // edge-on entering and leaving. spinTurns is the total turn across the
    // flight; the sign flips direction.
    const spinY = (0.5 - t) * spinTurnsRef.current * Math.PI * 2;
```

Also update the now-stale comment block directly above the `Spin` `useControls` (lines ~190–193): replace "ending face-on at t=1 (the apex sits at half the turn)" with "face-on at the apex (t = 0.5), symmetric edge-on at both ends".

- [ ] **Step 1.2: Typecheck and visually verify the apex pose**

```bash
npm run typecheck
node scripts/verify/shot.mjs --sp 0.3,0.4125,0.5 --out /tmp/wave2-task1 --track 600
```

Expected: at `sp=0.4125` the figure now reads **frontal** (widest silhouette, the "С"/& face toward camera, with the rollPeak tilt). At 0.3/0.5 it is partially rotated. Compare against `/tmp/wave2-baseline/sp0_4125.png`.

- [ ] **Step 1.3: Commit**

```bash
git add src/components/ArcModel.tsx
git commit -m "fix: face the figure frontally at the arc apex, not the flight end"
```

---

### Task 2: Edge smoothing — SMAA + supersampled Lottie (Item 2)

**Files:**
- Create: `scripts/verify/fps.mjs`
- Modify: `src/components/Scene.tsx` (EffectComposer block, ~line 265)
- Modify: `src/components/LottiePlane.tsx` (lottie init + texture setup)

`multisampling={0}` on the EffectComposer disables MSAA, so the glass silhouette and the Lottie's `alphaTest` cutout render unantialiased. SMAA antialiases both in screen space; supersampling the offscreen Lottie canvas resolves the letter edges at the texture level. The Lottie material MUST stay opaque + `alphaTest` (transmission only refracts opaque objects).

The spec's acceptance criterion has TWO halves: smoother edges AND no noticeable mobile frame-rate regression (SMAA is a full-screen pass; the supersampled canvas rasterizes ~2.25× the pixels per scrubbed Lottie frame — and this project has a history of mobile perf sensitivity, commit `054779b`). So measure FPS before and after.

- [ ] **Step 2.1: FPS harness + baseline (BEFORE any change)**

Create `scripts/verify/fps.mjs`:

```js
// Rough FPS smoke check: counts rAF callbacks over a window at a given scroll
// position. SwiftShader (software WebGL) is far slower than a real GPU — the
// absolute number is meaningless; ONLY compare before vs after a change at
// the same viewport/sp on the same machine.
// Usage: node scripts/verify/fps.mjs --url http://localhost:5173 --sp 0.1 \
//          --viewport 390x844 --track 800 --wait 9000 --ms 3000
import puppeteer from "puppeteer-core";

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};

const CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const url = opt("url", "http://localhost:5173");
const sp = Number(opt("sp", "0.1"));
const [w, h] = opt("viewport", "390x844").split("x").map(Number);
const track = Number(opt("track", "600"));
const wait = Number(opt("wait", "9000"));
const windowMs = Number(opt("ms", "3000"));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader-webgl",
    `--window-size=${w},${h}`,
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: w, height: h });
await page.goto(url, { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, wait));
await page.waitForFunction(
  () => !document.body.classList.contains("scroll-locked"),
  { timeout: 30000 },
);
await page.evaluate(
  (sp, track) => {
    const trackMax = ((track - 100) / 100) * window.innerHeight;
    window.scrollTo(0, sp * trackMax);
  },
  sp,
  track,
);
await new Promise((r) => setTimeout(r, 800));
const fps = await page.evaluate(
  (ms) =>
    new Promise((resolve) => {
      let frames = 0;
      const t0 = performance.now();
      const tick = () => {
        frames++;
        if (performance.now() - t0 < ms) requestAnimationFrame(tick);
        else resolve((frames * 1000) / (performance.now() - t0));
      };
      requestAnimationFrame(tick);
    }),
  windowMs,
);
console.log(`fps ≈ ${fps.toFixed(1)} @ sp=${sp} ${w}x${h}`);
await browser.close();
```

Record the baseline (dev server running, BEFORE touching Scene/LottiePlane):

```bash
node scripts/verify/fps.mjs --sp 0.1 --viewport 390x844 --track 600
node scripts/verify/fps.mjs --sp 0.4125 --viewport 390x844 --track 600
```

Write both numbers down — they're the comparison points for Step 2.4.

- [ ] **Step 2.2: Add SMAA to the post chain**

In `src/components/Scene.tsx`, extend the postprocessing import:

```ts
import {
  EffectComposer,
  ToneMapping,
  Noise,
  SMAA,
} from "@react-three/postprocessing";
```

and change the composer block (SMAA before Noise, so the film grain isn't blurred by the AA pass):

```tsx
          <EffectComposer multisampling={0} stencilBuffer={false}>
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
            <SMAA />
            <Noise opacity={0.1} />
          </EffectComposer>
```

- [ ] **Step 2.3: Supersample the Lottie canvas + anisotropy**

In `src/components/LottiePlane.tsx`:

Add `gl` to the `useThree()` destructure:

```ts
  const { viewport, camera, size, gl } = useThree();
```

In the lottie `useEffect`, compute a capped supersample DPR and pass it to the renderer (above the `lottie.loadAnimation` call):

```ts
    // Supersample the offscreen canvas: render the typography at up to 1.5×
    // the device DPR (hard-capped so the texture never exceeds 4096px) so the
    // alphaTest letter edges resolve crisply after linear filtering.
    const ssDpr = Math.max(
      1,
      Math.min(
        (window.devicePixelRatio || 1) * 1.5,
        4096 / Math.max(size.width, size.height),
      ),
    );
```

and add `dpr: ssDpr` to `rendererSettings`:

```ts
      rendererSettings: {
        preserveAspectRatio: "none",
        clearCanvas: true,
        dpr: ssDpr,
      },
```

In `handleLoaded`, after `tex.magFilter = THREE.LinearFilter;` add:

```ts
      tex.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
```

and add `gl` to that effect's dependency array (`[size.width, size.height, onComplete, onAnimationStart, reducedMotion, gl]`).

- [ ] **Step 2.4: Verify edges AND frame rate**

```bash
npm run typecheck
node scripts/verify/shot.mjs --sp 0.1,0.4125 --out /tmp/wave2-task2 --track 600
node scripts/verify/fps.mjs --sp 0.1 --viewport 390x844 --track 600
node scripts/verify/fps.mjs --sp 0.4125 --viewport 390x844 --track 600
```

Expected:
- Open `/tmp/wave2-task2/sp0_1.png` and compare letter edges against `/tmp/wave2-baseline/sp0_1.png` (zoom in): stair-stepping on letter diagonals/curves must be visibly reduced. Same for the glass silhouette at `sp0_4125`. The film grain must still be visible (Noise runs after SMAA).
- FPS at both sp points within ~20% of the Step 2.1 baselines. If it dropped more, lower the supersample factor (1.5 → 1.25 in `ssDpr`) and/or cap it harder on small viewports before proceeding — do NOT accept a big regression silently. (SwiftShader is a coarse proxy; the post-plan notes also call for a real-phone hand test.)

- [ ] **Step 2.5: Commit**

```bash
git add src/components/Scene.tsx src/components/LottiePlane.tsx scripts/verify/fps.mjs
git commit -m "feat: SMAA pass + supersampled Lottie canvas to smooth chopped edges"
```

---

### Task 3: New scroll timeline — constants + playback rewrite

**Files:**
- Rewrite: `src/constants.ts`
- Rewrite: `src/playback.ts`
- Modify: `src/components/ArcModel.tsx` (consume `figureStateFor`)
- Modify: `src/components/Scene.tsx` (consume `figureVisibleFor`)
- Create: `scripts/check-playback.ts`

New partition: `[0, REVEAL_END]` Lottie reveal → `[REVEAL_END, FIGURES_END]` figures → `[FIGURES_END, LOTTIE_END]` Lottie finish → `[LOTTIE_END, 1]` video. `DEFT_DROP_S` starts at `0` (the mapping code is final now; the value flips to the stand-in `1.0` in Task 11, so nothing visible changes until then). The old `DURATION` seconds indirection for the arc is dropped — figures use local progress `t ∈ [0,1]` directly.

- [ ] **Step 3.1: Rewrite `src/constants.ts`**

```ts
// ── Lottie timeline (seconds) ────────────────────────────────────────────────
// The loader auto-plays [0, DEFT_DROP_S] (the "DEFT drop"); scroll then drives
// [DEFT_DROP_S, LOTTIE_TOTAL_S]. 0 until the loader lands (Task 11 sets the
// stand-in 1.0); re-measure all three when the real Lottie export arrives.
export const DEFT_DROP_S = 0;
// End of the intro typography reveal — the frame the Lottie holds while the
// figures fly.
export const LOTTIE_INTRO_S = 3;
export const LOTTIE_TOTAL_S = 8.6;

// ── Scroll-progress partition (0..1) ─────────────────────────────────────────
// Nothing autoplays after the loader releases:
//   [0, REVEAL_END]              Lottie reveal (DEFT_DROP_S → LOTTIE_INTRO_S)
//   [REVEAL_END, FIGURES_END]    4 figures fly overlapping domes; Lottie held
//   [FIGURES_END, LOTTIE_END]    Lottie scrubs to the end
//   [LOTTIE_END, 1]              video crossfades in and scrubs to its last frame
export const REVEAL_END = 0.17;
export const FIGURES_END = 0.55;
export const LOTTIE_END = 0.78;

// Scroll-progress width of the video crossfade after LOTTIE_END.
export const VIDEO_FADE = 0.05;

// Fraction of a figure's own flight window spent fading in (and, mirrored,
// fading out) — windows overlap by 0.2, so 0.18 keeps any two concurrent
// figures from both being mid-fade at once.
export const FIGURE_FADE = 0.18;

// Total scrollable track height (vh). 800 gives the video phase ~175vh.
export const SCROLL_TRACK_VH = 800;
```

(Removed: `LOTTIE_INTRO_END`, `MODEL_PHASE_END`, `DURATION`, `FADE_RANGE`.)

- [ ] **Step 3.2: Rewrite `src/playback.ts`**

```ts
import {
  DEFT_DROP_S,
  LOTTIE_INTRO_S,
  LOTTIE_TOTAL_S,
  REVEAL_END,
  FIGURES_END,
  LOTTIE_END,
  VIDEO_FADE,
  FIGURE_FADE,
} from "./constants";

// Single source of truth for the scroll-driven timeline. LottiePlane, the
// ArcModels and VideoSection all derive their per-frame state from these pure
// functions (read inside useFrame/rAF), so the experience is a function of
// scroll progress alone and never requires a React re-render to advance.
export type Phase = "scroll" | "done";

function smoothstep(x: number): number {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
}

function clamp01(x: number): number {
  return Math.min(Math.max(x, 0), 1);
}

// Lottie timeline (seconds). The reveal starts at DEFT_DROP_S — the loader has
// already auto-played [0, DEFT_DROP_S], and because the mapping never returns
// less than DEFT_DROP_S, scrolling back to the top can never re-enter the drop.
export function lottieTimeFor(sp: number, phase: Phase): number {
  if (phase === "done") return LOTTIE_TOTAL_S;
  if (sp <= REVEAL_END)
    return DEFT_DROP_S + (sp / REVEAL_END) * (LOTTIE_INTRO_S - DEFT_DROP_S);
  if (sp <= FIGURES_END) return LOTTIE_INTRO_S;
  const t = clamp01((sp - FIGURES_END) / (LOTTIE_END - FIGURES_END));
  return LOTTIE_INTRO_S + t * (LOTTIE_TOTAL_S - LOTTIE_INTRO_S);
}

export interface FigureState {
  // Local flight progress through this figure's window, 0..1 (clamped).
  t: number;
  opacity: number;
}

// Per-figure flight state. `window` is the figure's sub-range of the figures
// phase, in normalized phase units [0,1]; windows overlap so ~2 figures are
// airborne at once. The fade is SYMMETRIC within the window (first/last
// FIGURE_FADE of local t), so each flight reads as a balanced dome and is
// fully reversible on reverse scroll.
export function figureStateFor(
  sp: number,
  window: readonly [number, number],
  phase: Phase,
): FigureState {
  if (phase === "done") return { t: 1, opacity: 0 };
  const phaseT = (sp - REVEAL_END) / (FIGURES_END - REVEAL_END);
  const [w0, w1] = window;
  const t = clamp01((phaseT - w0) / (w1 - w0));
  let opacity = 0;
  if (phaseT > w0 && phaseT < w1) {
    if (t < FIGURE_FADE) opacity = smoothstep(t / FIGURE_FADE);
    else if (t > 1 - FIGURE_FADE) opacity = smoothstep((1 - t) / FIGURE_FADE);
    else opacity = 1;
  }
  return { t, opacity };
}

// Discrete visibility — used by Scene to mount/unmount each figure, flipped
// only when the threshold is crossed (never per frame).
export function figureVisibleFor(
  sp: number,
  window: readonly [number, number],
  phase: Phase,
): boolean {
  return figureStateFor(sp, window, phase).opacity > 0.001;
}

export interface VideoState {
  // Normalized video time 0..1 across [LOTTIE_END, 1].
  t: number;
  opacity: number;
}

// Video phase: fades in over VIDEO_FADE after LOTTIE_END (covering the held
// Lottie final frame) and scrubs linearly to the clip's last frame at sp = 1.
// "done" (reduced motion): the clip never scrubs — it sits statically on its
// final frame — but the crossfade still follows scroll, so the typography
// isn't covered before the page tail.
export function videoStateFor(sp: number, phase: Phase): VideoState {
  const opacity = smoothstep((sp - LOTTIE_END) / VIDEO_FADE);
  if (phase === "done") return { t: 1, opacity };
  return {
    t: clamp01((sp - LOTTIE_END) / (1 - LOTTIE_END)),
    opacity,
  };
}
```

- [ ] **Step 3.3: Migrate `ArcModel` to `figureStateFor` (full window for now)**

In `src/components/ArcModel.tsx`:

- Replace the playback/constants imports:

```ts
import { figureStateFor } from "../playback";
import type { Phase } from "../playback";
```

(drop `import { DURATION } from "../constants"` and the `export { DURATION };` re-export, and delete the `elapsed` ref.)

- In `useFrame`, replace the state read and `t` computation:

```ts
    // Drive playback straight from scroll progress (read via ref — no React
    // re-render). The full-window [0, 1] config is temporary until the figure
    // manifest lands (Task 5).
    const { t: rawT, opacity } = figureStateFor(
      scrollRef.current,
      [0, 1],
      phase,
    );
    opacityRef.current = opacity;

    const t = easeInOutSine(rawT);
```

(The old code computed `t = easeInOutSine(elapsed.current / DURATION)` — the seconds round-trip is gone; everything below that line is unchanged.)

- [ ] **Step 3.4: Migrate `Scene` to `figureVisibleFor`**

In `src/components/Scene.tsx`, replace the `modelVisibleFor` import with `figureVisibleFor` and in the `update` callback:

```ts
      const mv = !reducedMotion && figureVisibleFor(sp, [0, 1], phase);
```

- [ ] **Step 3.5: Sanity-check the pure functions**

Create `scripts/check-playback.ts`:

```ts
// Pure-function sanity assertions for the scroll timeline. No test runner in
// this project — run manually with:  npx tsx scripts/check-playback.ts
import {
  lottieTimeFor,
  figureStateFor,
  videoStateFor,
} from "../src/playback";
import {
  DEFT_DROP_S,
  LOTTIE_INTRO_S,
  LOTTIE_TOTAL_S,
  REVEAL_END,
  FIGURES_END,
  LOTTIE_END,
} from "../src/constants";

function eq(actual: number, expected: number, label: string, eps = 1e-9) {
  if (Math.abs(actual - expected) > eps)
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
}
function ok(cond: boolean, label: string) {
  if (!cond) throw new Error(label);
}

// lottieTimeFor: anchors and monotonicity
eq(lottieTimeFor(0, "scroll"), DEFT_DROP_S, "lottie @0");
eq(lottieTimeFor(REVEAL_END, "scroll"), LOTTIE_INTRO_S, "lottie @REVEAL_END");
eq(lottieTimeFor(FIGURES_END, "scroll"), LOTTIE_INTRO_S, "lottie hold");
eq(lottieTimeFor(LOTTIE_END, "scroll"), LOTTIE_TOTAL_S, "lottie @LOTTIE_END");
eq(lottieTimeFor(1, "scroll"), LOTTIE_TOTAL_S, "lottie clamped after end");
eq(lottieTimeFor(0.5, "done"), LOTTIE_TOTAL_S, "lottie done");
let prev = -1;
for (let sp = 0; sp <= 1.0001; sp += 0.001) {
  const t = lottieTimeFor(sp, "scroll");
  ok(t >= prev - 1e-9, `lottie monotonic @${sp}`);
  ok(t >= DEFT_DROP_S, `lottie floored at DEFT_DROP_S @${sp}`);
  prev = t;
}

// figureStateFor: window mapping, apex, fades
const win: [number, number] = [0.2, 0.6];
const spFor = (phaseT: number) =>
  REVEAL_END + phaseT * (FIGURES_END - REVEAL_END);
eq(figureStateFor(spFor(0.2), win, "scroll").t, 0, "fig t@start");
eq(figureStateFor(spFor(0.4), win, "scroll").t, 0.5, "fig t@apex");
eq(figureStateFor(spFor(0.6), win, "scroll").t, 1, "fig t@end");
eq(figureStateFor(spFor(0.1), win, "scroll").opacity, 0, "fig hidden before");
eq(figureStateFor(spFor(0.7), win, "scroll").opacity, 0, "fig hidden after");
eq(figureStateFor(spFor(0.4), win, "scroll").opacity, 1, "fig opaque @apex");
ok(
  figureStateFor(spFor(0.22), win, "scroll").opacity > 0 &&
    figureStateFor(spFor(0.22), win, "scroll").opacity < 1,
  "fig fading in",
);
eq(figureStateFor(0.3, win, "done").opacity, 0, "fig done hidden");

// Overlap invariant: with windows offset by 0.2 and FIGURE_FADE 0.18, no two
// figures are mid-fade at the same phaseT.
const winA: [number, number] = [0, 0.4];
const winB: [number, number] = [0.2, 0.6];
for (let p = 0; p <= 1.0001; p += 0.001) {
  const a = figureStateFor(spFor(p), winA, "scroll").opacity;
  const b = figureStateFor(spFor(p), winB, "scroll").opacity;
  const mid = (o: number) => o > 0.001 && o < 0.999;
  ok(!(mid(a) && mid(b)), `both figures mid-fade @phaseT=${p}`);
}

// videoStateFor
eq(videoStateFor(LOTTIE_END, "scroll").t, 0, "video t@start");
eq(videoStateFor(1, "scroll").t, 1, "video t@end");
eq(videoStateFor(LOTTIE_END, "scroll").opacity, 0, "video hidden at start");
eq(videoStateFor(1, "scroll").opacity, 1, "video opaque at end");
eq(videoStateFor(0.3, "scroll").opacity, 0, "video hidden mid-page");
eq(videoStateFor(0.1, "done").opacity, 0, "video done: hidden before tail");
eq(videoStateFor(1, "done").t, 1, "video done: held on final frame");
eq(videoStateFor(1, "done").opacity, 1, "video done: visible at tail");

console.log("check-playback: all assertions passed");
```

Run:

```bash
npm i tsx --no-save
npx tsx scripts/check-playback.ts
```

Expected: `check-playback: all assertions passed`. If an assertion throws, fix `playback.ts` — do not weaken the assertion.

- [ ] **Step 3.6: Typecheck + visual spot-check of the repartition**

```bash
npm run typecheck
node scripts/verify/shot.mjs --sp 0,0.17,0.36,0.55,0.78,1 --out /tmp/wave2-task3 --track 800
```

Expected (note `--track 800` from here on): `sp=0` first Lottie frame; `sp=0.17` held intro frame; `sp=0.36` figure at the dome apex, frontal; `sp=0.55` figure gone, intro frame still held; `sp=0.78` Lottie final frame; `sp=1` unchanged final frame (video phase — nothing there yet) with the Lorem section visible.

- [ ] **Step 3.7: Commit**

```bash
git add src/constants.ts src/playback.ts src/components/ArcModel.tsx src/components/Scene.tsx scripts/check-playback.ts
git commit -m "feat: repartition the scroll timeline for figures + video phases"
```

---

### Task 4: Figure manifest + mirrored arcs (`arc.ts`)

**Files:**
- Modify: `src/arc.ts`
- Create: `public/figures/{and,tokyo,gba,awwwards}.glb` (stand-in copies)

- [ ] **Step 4.1: Create the stand-in GLBs**

```bash
mkdir -p public/figures
cp public/model.glb public/figures/and.glb
cp public/model.glb public/figures/tokyo.glb
cp public/model.glb public/figures/gba.glb
cp public/model.glb public/figures/awwwards.glb
```

(`public/model.glb` stays for now — Task 5 removes the last reference, then it can be deleted.)

- [ ] **Step 4.2: Extend `ArcConfig` and add the manifest**

Rewrite `src/arc.ts`:

```ts
import * as THREE from "three";

// A figure's flight path is a symmetric quadratic dome: it enters near one
// bottom corner, peaks at top-center (the apex is hit exactly at the curve
// midpoint, t = 0.5), and exits near the mirrored bottom corner. Each figure
// gets its own ArcConfig — distinct heights, spreads, sides and spins so the
// overlapping waves read dynamic rather than cloned.
export interface ArcConfig {
  // Horizontal reach of the legs, as a fraction of half the viewport width.
  // Aspect-dependent: wide desktop layouts keep the dome in the MIDDLE of the
  // screen (0.5 ⇒ feet at 25% / 75% width), while narrow phone layouts let it
  // span corner-to-corner (≈0.95 ⇒ feet at the bottom corners).
  legSpreadLandscape: number;
  legSpreadPortrait: number;
  // How far down the entry/exit roots sit, as a fraction of half the viewport
  // height (1 ≈ the bottom edge).
  rootDepth: number;
  // Apex height at t = 0.5, as a fraction of half the viewport height
  // (1 ≈ the top edge). Kept below 1 so the figure doesn't clip off the top.
  peakHeight: number;
  // Entry side: 1 enters bottom-LEFT (exits right), -1 mirrors the dome so it
  // enters bottom-RIGHT. Alternating sides is what makes the waves criss-cross.
  side: 1 | -1;
  // Total scroll-driven Y turn across the flight (sign = direction). The spin
  // is apex-centred: frontal exactly at t = 0.5.
  spinTurns: number;
  // This figure's sub-window of the figures phase, in normalized phase units
  // [0, 1]. Windows overlap by 0.2 so ~2 figures are airborne at once.
  window: readonly [number, number];
}

export interface FigureDef {
  name: string;
  // Relative to BASE_URL; the files under public/figures/ are drop-in — the
  // user's real exports replace the stand-in copies with no code change.
  url: string;
  arc: ArcConfig;
}

// Launch order: and → tokyo → gba → awwwards, alternating entry sides.
// Shape values are starting points — every one is live-tunable via Leva.
export const FIGURES: FigureDef[] = [
  {
    name: "and",
    url: "figures/and.glb",
    arc: {
      legSpreadLandscape: 0.5,
      legSpreadPortrait: 0.95,
      rootDepth: 0.95,
      peakHeight: 0.72,
      side: 1,
      spinTurns: 0.55,
      window: [0, 0.4],
    },
  },
  {
    name: "tokyo",
    url: "figures/tokyo.glb",
    arc: {
      legSpreadLandscape: 0.62,
      legSpreadPortrait: 0.95,
      rootDepth: 0.95,
      peakHeight: 0.6,
      side: -1,
      spinTurns: -0.5,
      window: [0.2, 0.6],
    },
  },
  {
    name: "gba",
    url: "figures/gba.glb",
    arc: {
      legSpreadLandscape: 0.44,
      legSpreadPortrait: 0.9,
      rootDepth: 0.95,
      peakHeight: 0.82,
      side: 1,
      spinTurns: 0.6,
      window: [0.4, 0.8],
    },
  },
  {
    name: "awwwards",
    url: "figures/awwwards.glb",
    arc: {
      legSpreadLandscape: 0.56,
      legSpreadPortrait: 0.95,
      rootDepth: 0.95,
      peakHeight: 0.66,
      side: -1,
      spinTurns: -0.55,
      window: [0.6, 1],
    },
  },
];

// Build the world-space curve for a given viewport and config. The control
// point sits at top-center, so the quadratic Bézier is left/right symmetric and
// its midpoint (t = 0.5) lands exactly on the apex. `side` mirrors the travel
// direction (the dome shape itself is symmetric). The leg spread is chosen
// from the viewport orientation.
export function makeArc(
  width: number,
  height: number,
  cfg: ArcConfig,
): THREE.QuadraticBezierCurve3 {
  const legSpread =
    width >= height ? cfg.legSpreadLandscape : cfg.legSpreadPortrait;
  const a = (width / 2) * legSpread * cfg.side;
  const root = (height / 2) * cfg.rootDepth;
  const peak = (height / 2) * cfg.peakHeight;

  const start = new THREE.Vector3(-a, -root, 0);
  const end = new THREE.Vector3(a, -root, 0);

  // For a quadratic Bézier the midpoint is 0.25·start + 0.5·control + 0.25·end,
  // so its y is -0.5·root + 0.5·controlY. Solve controlY so the apex lands
  // exactly at `peak`:  controlY = 2·peak + root.
  const control = new THREE.Vector3(0, 2 * peak + root, 0);

  return new THREE.QuadraticBezierCurve3(start, control, end);
}

// Temporary back-compat for ArcModel until Task 5 parameterizes it.
export const BLUE_ARC: ArcConfig = FIGURES[0].arc;
```

- [ ] **Step 4.3: Sanity-check the geometry**

Append to `scripts/check-playback.ts` (before the final `console.log`):

```ts
// arc.ts: apex at midpoint, mirroring flips travel direction only
import { makeArc, FIGURES } from "../src/arc";
const W = 12;
const H = 7;
for (const f of FIGURES) {
  const c = makeArc(W, H, f.arc);
  const apex = c.getPoint(0.5);
  eq(apex.x, 0, `${f.name} apex centered`);
  eq(apex.y, (H / 2) * f.arc.peakHeight, `${f.name} apex height`, 1e-6);
  const p0 = c.getPoint(0);
  ok(
    Math.sign(p0.x) === -f.arc.side,
    `${f.name} enters on the configured side`,
  );
  eq(Math.abs(p0.x), (W / 2) * f.arc.legSpreadLandscape, `${f.name} spread`, 1e-6);
}
// windows are ordered and overlap by 0.2
for (let i = 1; i < FIGURES.length; i++) {
  eq(
    FIGURES[i].arc.window[0],
    FIGURES[i - 1].arc.window[0] + 0.2,
    `window stagger ${i}`,
    1e-9,
  );
}
```

Run: `npx tsx scripts/check-playback.ts`
Expected: `check-playback: all assertions passed`

- [ ] **Step 4.4: Typecheck and commit**

```bash
npm run typecheck
git add src/arc.ts scripts/check-playback.ts public/figures
git commit -m "feat: four-figure arc manifest with mirrored entry sides and windows"
```

---

### Task 5: Parameterize ArcModel per figure

**Files:**
- Modify: `src/components/ArcModel.tsx`
- Modify: `src/components/Scene.tsx` (pass `FIGURES[0]` through the new API)

`ArcModel` takes a `FigureDef`, loads its own GLB, clones the shared glass material (overlapping figures must fade independently — a shared material can't hold two opacities), and gets one per-figure Leva folder for arc/spin/tilt. The Material Leva folder keeps identical keys across instances — leva shares values through its global store, so all clones stay in sync in dev; the prod stub returns the same defaults per call.

- [ ] **Step 5.1: Rework `ArcModel.tsx`**

Full new component (replaces the file; the material-`useControls` block, lighting-independent logic, centering and parallax are carried over):

```tsx
import { useRef, useEffect, useMemo } from "react";
import type { MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { useControls, folder } from "@debug/controls";
import { figureStateFor } from "../playback";
import type { Phase } from "../playback";
import { makeArc, FIGURES } from "../arc";
import type { FigureDef } from "../arc";

useGLTF.setDecoderPath(
  "https://www.gstatic.com/draco/versioned/decoders/1.5.6/",
);

function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

// One template material; each figure clones it so overlapping figures can fade
// with independent opacities while sharing the same tuned look.
const baseGlassMaterial = new THREE.MeshPhysicalMaterial({
  color: new THREE.Color(0xffffff),
  metalness: 0.0,
  roughness: 0.15,
  transmission: 1.0,
  thickness: 1.2,
  ior: 1.45,
  dispersion: 1.5,
  attenuationColor: new THREE.Color(0xdde6ff),
  attenuationDistance: 4,
  clearcoat: 1.0,
  clearcoatRoughness: 0.05,
  iridescence: 0.6,
  iridescenceIOR: 1.7,
  iridescenceThicknessRange: [200, 600],
  envMapIntensity: 1.2,
  side: THREE.DoubleSide,
});

interface ArcModelProps {
  figure: FigureDef;
  scrollRef: MutableRefObject<number>;
  phase: Phase;
}

export default function ArcModel({ figure, scrollRef, phase }: ArcModelProps) {
  const { scene: modelScene } = useGLTF(
    import.meta.env.BASE_URL + figure.url,
  );
  const { viewport, pointer } = useThree();
  const modelRef = useRef<THREE.Group>(null);
  // Outer group: carries the curve position + a screen-space roll applied
  // OUTSIDE the spin (so the roll rotates the projected image, not local Z).
  const rollGroupRef = useRef<THREE.Group>(null);
  // Scaled bounding-box center, used to make the figure rotate about its
  // visual center instead of the GLB's (possibly off-center) origin.
  const centerRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const opacityRef = useRef<number>(1);
  const mouseRotX = useRef<number>(0);
  const mouseRotY = useRef<number>(0);

  // Per-figure clone of the shared glass template. The Material controls below
  // use identical keys in every instance, so leva's global store keeps all
  // clones in sync in dev; the prod stub returns the same defaults per call.
  const material = useMemo(() => baseGlassMaterial.clone(), []);
  useEffect(() => () => material.dispose(), [material]);

  const {
    color,
    metalness,
    roughness,
    transmission,
    thickness,
    ior,
    envMapIntensity,
    dispersion,
    attenuationColor,
    attenuationDistance,
    clearcoat,
    clearcoatRoughness,
    iridescence,
    iridescenceIOR,
    thicknessMin,
    thicknessMax,
  } = useControls(
    "Material",
    {
      Core: folder({
        color: "#a2a2a2",
        metalness: { value: 0.0, min: 0, max: 1, step: 0.01 },
        roughness: { value: 0.15, min: 0, max: 1, step: 0.01 },
        transmission: { value: 1.0, min: 0, max: 1, step: 0.01 },
        thickness: { value: 1.2, min: 0, max: 5, step: 0.05 },
        ior: { value: 1.45, min: 1.0, max: 2.5, step: 0.01 },
        envMapIntensity: { value: 1.2, min: 0, max: 5, step: 0.05 },
      }),
      Glass: folder({
        dispersion: { value: 1.5, min: 0, max: 10, step: 0.1 },
        attenuationColor: "#dde6ff",
        attenuationDistance: { value: 4, min: 0, max: 20, step: 0.1 },
      }),
      Clearcoat: folder({
        clearcoat: { value: 1.0, min: 0, max: 1, step: 0.01 },
        clearcoatRoughness: { value: 0.05, min: 0, max: 1, step: 0.01 },
      }),
      Iridescence: folder({
        iridescence: { value: 0.6, min: 0, max: 1, step: 0.01 },
        iridescenceIOR: { value: 1.7, min: 1.0, max: 2.5, step: 0.01 },
        thicknessMin: { value: 200, min: 50, max: 1000, step: 1 },
        thicknessMax: { value: 600, min: 50, max: 1000, step: 1 },
      }),
    },
    { collapsed: true },
  );

  useEffect(() => {
    material.color.set(color);
    material.metalness = metalness;
    material.roughness = roughness;
    material.transmission = transmission;
    material.thickness = thickness;
    material.ior = ior;
    material.envMapIntensity = envMapIntensity;
    material.dispersion = dispersion;
    material.attenuationColor.set(attenuationColor);
    material.attenuationDistance = attenuationDistance;
    material.clearcoat = clearcoat;
    material.clearcoatRoughness = clearcoatRoughness;
    material.iridescence = iridescence;
    material.iridescenceIOR = iridescenceIOR;
    material.iridescenceThicknessRange = [thicknessMin, thicknessMax];
    material.needsUpdate = true;
  }, [
    material,
    color,
    metalness,
    roughness,
    transmission,
    thickness,
    ior,
    envMapIntensity,
    dispersion,
    attenuationColor,
    attenuationDistance,
    clearcoat,
    clearcoatRoughness,
    iridescence,
    iridescenceIOR,
    thicknessMin,
    thicknessMax,
  ]);

  // Per-figure flight tuning, one Leva folder per figure. Defaults come from
  // the manifest; tweak live (Cmd+L), then write keepers back into arc.ts.
  const {
    peakHeight,
    legSpreadLandscape,
    legSpreadPortrait,
    spinTurns,
    rollPeak,
    swingAmount,
    swingCycles,
  } = useControls(`Figure ${figure.name}`, {
    peakHeight: {
      value: figure.arc.peakHeight,
      min: 0,
      max: 1.2,
      step: 0.01,
      label: "Peak Height",
    },
    legSpreadLandscape: {
      value: figure.arc.legSpreadLandscape,
      min: 0.2,
      max: 1.2,
      step: 0.01,
      label: "Spread (desktop)",
    },
    legSpreadPortrait: {
      value: figure.arc.legSpreadPortrait,
      min: 0.2,
      max: 1.2,
      step: 0.01,
      label: "Spread (mobile)",
    },
    spinTurns: {
      value: figure.arc.spinTurns,
      min: -3,
      max: 3,
      step: 0.05,
      label: "Spin Turns",
    },
    rollPeak: {
      value: 0.52,
      min: -1.5,
      max: 1.5,
      step: 0.01,
      label: "Roll @ peak",
    },
    swingAmount: {
      value: 0.56,
      min: 0,
      max: 1.0,
      step: 0.01,
      label: "Swing Amount",
    },
    swingCycles: {
      value: 1,
      min: 1,
      max: 10,
      step: 0.5,
      label: "Swing Cycles",
    },
  });

  // Keep refs in sync so useFrame always reads current values without stale
  // closures.
  const spinTurnsRef = useRef(spinTurns);
  const rollPeakRef = useRef(rollPeak);
  const swingAmountRef = useRef(swingAmount);
  const swingCyclesRef = useRef(swingCycles);
  useEffect(() => {
    spinTurnsRef.current = spinTurns;
    rollPeakRef.current = rollPeak;
    swingAmountRef.current = swingAmount;
    swingCyclesRef.current = swingCycles;
  }, [spinTurns, rollPeak, swingAmount, swingCycles]);

  // Assign this figure's material to every mesh once the model is loaded.
  useEffect(() => {
    if (!modelScene) return;
    modelScene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.material = material;
      }
    });
  }, [modelScene, material]);

  // Responsive scale: keep the figure from dominating narrow/portrait
  // viewports. Reset scale before measuring so repeated runs don't compound.
  useEffect(() => {
    if (!modelScene) return;
    modelScene.position.set(0, 0, 0);
    modelScene.scale.setScalar(1);
    const box = new THREE.Box3().setFromObject(modelScene);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const targetSize = Math.max(1.2, Math.min(2.5, viewport.width * 0.4));
    const s = targetSize / maxDim;
    modelScene.scale.setScalar(s);
    // Offset the geometry so its bounding-box center lands on the parent
    // group's origin; the parent's position is then compensated by the same
    // center (Y/Z only — see useFrame) so rotation pivots about the visual
    // center without dragging the dome horizontally.
    const center = box.getCenter(new THREE.Vector3()).multiplyScalar(s);
    centerRef.current.copy(center);
    modelScene.position.set(-center.x, -center.y, -center.z);
  }, [modelScene, viewport.width, viewport.height]);

  // This figure's dome. side mirrors travel; the apex lands at the curve
  // midpoint (t = 0.5) — which is where the apex-centred spin reads frontal.
  const curve = useMemo(
    () =>
      makeArc(viewport.width, viewport.height, {
        ...figure.arc,
        peakHeight,
        legSpreadLandscape,
        legSpreadPortrait,
      }),
    [
      viewport.width,
      viewport.height,
      figure.arc,
      peakHeight,
      legSpreadLandscape,
      legSpreadPortrait,
    ],
  );

  useFrame((_state, delta: number) => {
    if (!modelRef.current) return;

    // Drive playback straight from scroll progress (read via ref — no React
    // re-render). Each figure maps its own window of the figures phase.
    const { t: rawT, opacity } = figureStateFor(
      scrollRef.current,
      figure.arc.window,
      phase,
    );
    opacityRef.current = opacity;

    const t = easeInOutSine(rawT);
    const pos = curve.getPoint(t);
    // The GLB's bounding-box center can be offset from its origin (centerRef).
    // Apply that compensation on Y/Z only, NOT X — the figure's visual center
    // then tracks the curve horizontally, so the dome stays centered on screen
    // (an X offset would drag the whole dome sideways).
    if (rollGroupRef.current) {
      rollGroupRef.current.position.set(
        pos.x,
        pos.y + centerRef.current.y,
        pos.z + centerRef.current.z,
      );
      // Screen-space roll: applied outside the spin, so it rotates the
      // projected image. Peaks at the apex (zero at both ends).
      rollGroupRef.current.rotation.z =
        rollPeakRef.current * Math.sin(t * Math.PI);
    }

    // Smooth mouse parallax — ~4° max, framerate-independent lerp
    const MOUSE_MAX = 0.07;
    const lerpK = 1 - Math.exp(-delta * 4);
    mouseRotY.current += (pointer.x * MOUSE_MAX - mouseRotY.current) * lerpK;
    mouseRotX.current += (-pointer.y * MOUSE_MAX - mouseRotX.current) * lerpK;

    // Apex-centred spin: zero (frontal) exactly at t = 0.5 — the dome apex —
    // edge-on entering and leaving. spinTurns is the total turn across the
    // flight; the sign flips direction. Reverses on scroll-up (t tracks scroll).
    const spinY = (0.5 - t) * spinTurnsRef.current * Math.PI * 2;
    modelRef.current.rotation.y = spinY + mouseRotY.current;
    // Pitch oscillation: top forward → top back, swingCycles times per flight.
    modelRef.current.rotation.x =
      swingAmountRef.current *
        Math.sin(t * swingCyclesRef.current * -Math.PI * -0.9) +
      mouseRotX.current;

    // Scroll-driven opacity — bidirectional so the figure fades back in when
    // the user scrolls upward through its window.
    const op = Math.min(Math.max(opacityRef.current, 0), 1);
    const visible = op > 0.001;
    if (modelRef.current.visible !== visible)
      modelRef.current.visible = visible;
    material.transparent = op < 1;
    material.opacity = op;
  });

  return (
    <group ref={rollGroupRef}>
      <group ref={modelRef}>
        <primitive object={modelScene} />
      </group>
    </group>
  );
}

FIGURES.forEach((f) => {
  useGLTF.preload(import.meta.env.BASE_URL + f.url);
});
```

Notes for the implementer:
- The `shouldStart` prop is gone (Scene mounts/unmounts per figure instead).
- `useGLTF` caches by URL — four ArcModels with four URLs each get their own scene graph; the stand-ins are identical content but distinct cache entries.
- Remove the `BLUE_ARC` re-export from `arc.ts` in this task (delete the last two lines added in Task 4) — nothing references it after this rewrite.

- [ ] **Step 5.2: Render figure 0 through the new API in Scene**

In `src/components/Scene.tsx`:

```ts
import { FIGURES } from "../arc";
```

and replace the `<ArcModel … />` usage:

```tsx
            {!reducedMotion && modelVisible && (
              <ArcModel figure={FIGURES[0]} scrollRef={scrollRef} phase={phase} />
            )}
```

and in the `update` callback, scope visibility to figure 0's window:

```ts
      const mv =
        !reducedMotion && figureVisibleFor(sp, FIGURES[0].arc.window, phase);
```

- [ ] **Step 5.3: Typecheck + verify single figure via new path**

```bash
npm run typecheck
npx tsx scripts/check-playback.ts
node scripts/verify/shot.mjs --sp 0.17,0.246,0.322 --out /tmp/wave2-task5 --track 800
```

Expected: figure 0's window is `[0, 0.4]` ⇒ sp range `[0.17, 0.322]`, apex at `sp=0.246` — frontal there, gone by `sp=0.322` (hand-off point to tokyo's wave; nothing else flies yet).

- [ ] **Step 5.4: Commit**

```bash
git add src/components/ArcModel.tsx src/components/Scene.tsx src/arc.ts
git commit -m "feat: parameterize ArcModel per figure with cloned glass material"
```

---

### Task 6: All four figures in Scene

**Files:**
- Modify: `src/components/Scene.tsx`

- [ ] **Step 6.1: Per-figure discrete visibility + render loop + error isolation**

In `src/components/Scene.tsx`:

Add imports:

```ts
import { Component, Suspense } from "react"; // merge with the existing react import
import type { ReactNode } from "react";
```

Add an error boundary above the `Scene` component (one bad GLB export must degrade to "that figure absent", never block the others or the loader):

```tsx
class FigureBoundary extends Component<
  { name: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.error(`[figure:${this.props.name}] failed to load`, err);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
```

Replace the single `modelVisible` state with a per-figure array:

```ts
  const [figuresVisible, setFiguresVisible] = useState<boolean[]>(() =>
    FIGURES.map(() => false),
  );
```

In the `update` callback replace the `mv`/`setModelVisible` lines:

```ts
      const fv = FIGURES.map(
        (f) => !reducedMotion && figureVisibleFor(sp, f.arc.window, phase),
      );
      setFiguresVisible((p) =>
        fv.length === p.length && fv.every((v, i) => v === p[i]) ? p : fv,
      );
```

Replace the ArcModel render block (per-figure Suspense nested inside the main one keeps each GLB's loading independent):

```tsx
            {FIGURES.map(
              (f, i) =>
                !reducedMotion &&
                figuresVisible[i] && (
                  <FigureBoundary key={f.name} name={f.name}>
                    <Suspense fallback={null}>
                      <ArcModel figure={f} scrollRef={scrollRef} phase={phase} />
                    </Suspense>
                  </FigureBoundary>
                ),
            )}
```

- [ ] **Step 6.2: Verify the wave choreography**

```bash
npm run typecheck
node scripts/verify/shot.mjs --sp 0.246,0.30,0.322,0.36,0.398,0.44,0.474,0.55 --out /tmp/wave2-task6 --track 800
```

Expected:
- `sp=0.246` — and@apex (frontal, center-top), alone.
- `sp=0.30` — and descending right + tokyo airborne from the RIGHT side (criss-cross) — **two figures at once**.
- `sp=0.322` — tokyo@apex frontal; and just gone.
- `sp=0.398` — gba@apex (higher dome, narrower spread); tokyo gone.
- `sp=0.474` — awwwards@apex; entered from the right.
- `sp=0.55` — empty sky, Lottie still on the held intro frame.

Also re-run `node scripts/verify/shot.mjs --sp 0.246 --viewport 390x844 --out /tmp/wave2-task6-mobile --track 800` — portrait spread ≈ corner-to-corner, nothing clipped.

- [ ] **Step 6.3: Commit**

```bash
git add src/components/Scene.tsx
git commit -m "feat: fly all four figures on staggered criss-cross waves"
```

---

### Task 7: Remove LoremSection + gsap

**Files:**
- Delete: `src/components/LoremSection.tsx`
- Modify: `src/components/Scene.tsx`
- Modify: `package.json` (via `npm uninstall gsap`)

- [ ] **Step 7.1: Remove the section and its state**

In `src/components/Scene.tsx` remove:
- `import LoremSection from "./LoremSection";`
- the `loremVisible` state line,
- the `lv` / `setLoremVisible` lines inside `update`,
- the `<LoremSection visible={loremVisible} />` element.

Delete the file:

```bash
rm src/components/LoremSection.tsx
```

- [ ] **Step 7.2: Drop gsap (verified Lorem-only by grep)**

```bash
grep -rn "gsap" src/ ; npm uninstall gsap
```

Expected: grep returns nothing after the deletion; `package.json` loses the dependency.

- [ ] **Step 7.3: Verify and commit**

```bash
npm run typecheck && npm run build
node scripts/verify/shot.mjs --sp 0.9,1 --out /tmp/wave2-task7 --track 800
```

Expected: build passes; at `sp=0.9` and `sp=1` the page holds the Lottie's final frame — no Lorem text anywhere; the page bottom is the end of the scroll track.

```bash
git add -A
git commit -m "feat: remove Lorem placeholder section (video tail replaces it)"
```

---

### Task 8: Scroll-scrubbed FPV video tail

**Files:**
- Create: `src/components/VideoSection.tsx`
- Create: `public/fpv.mp4`, `public/fpv-poster.jpg`
- Modify: `src/components/Scene.tsx`, `src/index.css`

The video is a DOM layer **above** `.canvas-layer` (the in-canvas gradient is opaque — nothing shows "through" the canvas from behind). It fades in over `VIDEO_FADE` right as the Lottie's final zoom-through completes, then `sp` maps linearly to `currentTime`. Scrubbing uses precise `currentTime` seeks (NOT `fastSeek` — that snaps to keyframes and reads as jumps when scrubbing).

- [ ] **Step 8.1: Copy the asset and generate a poster frame**

```bash
cp "/Users/ivan/Downloads/Нова папка з елементами 5/260203_fpv_graphics.mp4" public/fpv.mp4
```

Generate the poster (first frame) with AVFoundation — no ffmpeg on this machine. Create `/tmp/poster.swift`:

```swift
import AVFoundation
import AppKit

let asset = AVURLAsset(url: URL(fileURLWithPath: CommandLine.arguments[1]))
let gen = AVAssetImageGenerator(asset: asset)
gen.appliesPreferredTrackTransform = true
gen.requestedTimeToleranceBefore = .zero
gen.requestedTimeToleranceAfter = .zero
let cg = try gen.copyCGImage(at: CMTime(seconds: 0.0, preferredTimescale: 600), actualTime: nil)
let rep = NSBitmapImageRep(cgImage: cg)
let data = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.82])!
try data.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
print("wrote \(CommandLine.arguments[2]) \(cg.width)x\(cg.height)")
```

```bash
swiftc -O /tmp/poster.swift -o /tmp/poster
/tmp/poster public/fpv.mp4 public/fpv-poster.jpg
```

Expected: `wrote public/fpv-poster.jpg 1920x1080` (a deprecation warning from swiftc is fine).

Note: `public/fpv.mp4` is ~46 MB and goes into git — acceptable for this repo; flag to the user that they can re-encode/LFS it later.

- [ ] **Step 8.2: Create `src/components/VideoSection.tsx`**

```tsx
import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import { videoStateFor } from "../playback";
import type { Phase } from "../playback";

// (videoTime seconds → object-position-x %) keyframes for the portrait crop.
// The 16:9 frame is cover-cropped on phones; the baked-in taglines drift away
// from frame-center during parts of the clip, so the crop window pans to keep
// them centered. Tuned visually in the mobile task; identity (50%) until then.
const PAN_KEYFRAMES: ReadonlyArray<readonly [number, number]> = [
  [0, 50],
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

interface VideoSectionProps {
  scrollRef: MutableRefObject<number>;
  phase: Phase;
}

// Scroll-scrubbed FPV background video for the page tail. A DOM layer above
// the WebGL canvas; opacity (the crossfade) and currentTime both derive from
// scroll progress inside one rAF loop — same no-React-per-frame discipline as
// the in-scene layers. The clip's taglines are baked in; there are no overlays.
export default function VideoSection({ scrollRef, phase }: VideoSectionProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastTime = useRef<number>(-1);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const v = videoRef.current;
      if (!v) return;
      const { t, opacity } = videoStateFor(scrollRef.current, phase);
      v.style.opacity = opacity.toFixed(3);
      if (opacity <= 0.001) return; // off-phase: skip seeking entirely
      const dur = v.duration;
      if (!Number.isFinite(dur) || dur <= 0) return; // metadata not ready: poster shows
      // Clamp short of the end so the held last frame never flickers black.
      const target = Math.min(t * dur, dur - 0.05);
      // Re-seek only when the target moved by more than ~a frame.
      if (Math.abs(target - lastTime.current) < 1 / 30) return;
      lastTime.current = target;
      try {
        v.currentTime = target;
      } catch {
        // Seek failed (decoder hiccup / data-saver): poster or last decoded
        // frame stays up; scroll timeline is unaffected.
      }
      const portrait = window.innerHeight > window.innerWidth;
      v.style.objectPosition = portrait
        ? `${panXFor(target).toFixed(1)}% 50%`
        : "50% 50%";
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [scrollRef, phase]);

  return (
    <video
      ref={videoRef}
      className="video-layer"
      src={import.meta.env.BASE_URL + "fpv.mp4"}
      poster={import.meta.env.BASE_URL + "fpv-poster.jpg"}
      muted
      playsInline
      preload="auto"
      aria-hidden
    />
  );
}
```

- [ ] **Step 8.3: Styles**

Append to `src/index.css`:

```css
/* Scroll-scrubbed FPV video tail. Sits ABOVE the WebGL layer (the in-canvas
   gradient is opaque) and crossfades in via its own opacity, driven from the
   scroll rAF loop. lvh for the same URL-bar stability as .canvas-layer. */
.video-layer {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh; /* fallback */
    height: 100lvh;
    object-fit: cover;
    z-index: 2;
    opacity: 0;
    pointer-events: none;
}
```

- [ ] **Step 8.4: Mount it in Scene**

In `src/components/Scene.tsx`: `import VideoSection from "./VideoSection";` and render it right after the closing `</div>` of `.canvas-layer` (before the scroll-track div):

```tsx
      <VideoSection scrollRef={scrollRef} phase={phase} />
```

- [ ] **Step 8.5: Verify the crossfade and scrub**

```bash
npm run typecheck
node scripts/verify/shot.mjs --sp 0.76,0.79,0.83,0.85,0.92,1 --out /tmp/wave2-task8 --track 800 --wait 12000
```

Expected: `sp=0.76` Lottie only — late in its scrub (~8.1 s of 8.6), no video; `sp=0.79` mid-crossfade (video at ≈10% opacity ghosting over the typography); `sp=0.83` fade complete — full video, no typography (with `VIDEO_FADE = 0.05` the fade ends exactly at sp 0.83); `sp=0.85` full video, early-clip frame (clouds); `sp=0.92` mid-clip (FPV over the city, "WIR SIND EIN…" tagline); `sp=1` final frames ("ZUHAUSE IM HERZEN DER SCHWEIZ"). Frames at different sp values MUST show different video content — if they're identical, seeking is broken. If frames lag far behind the requested time in real interactive use (test by hand-scrolling `npm run dev` in a real browser), note it and tell the user a scrub-optimized re-encode is needed (per the spec's risk note).

- [ ] **Step 8.6: Commit**

```bash
git add src/components/VideoSection.tsx src/components/Scene.tsx src/index.css public/fpv.mp4 public/fpv-poster.jpg
git commit -m "feat: scroll-scrubbed FPV video tail with Lottie crossfade"
```

---

### Task 9: Mobile video crop + pan tuning

**Files:**
- Modify: `src/components/VideoSection.tsx` (PAN_KEYFRAMES values only)

- [ ] **Step 9.1: Survey where the baked text sits across the clip**

```bash
node scripts/verify/shot.mjs --sp 0.82,0.86,0.90,0.94,0.98 --viewport 390x844 --out /tmp/wave2-task9-before --track 800 --wait 12000
```

Inspect each portrait shot: the baked tagline should sit within the middle ~60% of the portrait width. Note the sp values where it drifts off-center and in which direction.

- [ ] **Step 9.2: Tune PAN_KEYFRAMES**

Convert each problem sp to video time (`time = (sp - LOTTIE_END) / (1 - LOTTIE_END) * 14.24`) and add keyframes. Example shape (real values come from the screenshots — these are NOT final):

```ts
const PAN_KEYFRAMES: ReadonlyArray<readonly [number, number]> = [
  [0, 50],
  [6.0, 50],
  [8.5, 42], // tagline sits right-of-center here — pull the crop window left
  [11.0, 46],
  [14.24, 50],
];
```

Re-shoot `--out /tmp/wave2-task9-after` with the same sp list and confirm the tagline is centered in every frame. Desktop shots (default viewport) must be unaffected (pan only applies in portrait).

- [ ] **Step 9.3: Commit**

```bash
git add src/components/VideoSection.tsx
git commit -m "tune: pan the portrait video crop to keep baked taglines centered"
```

---

### Task 10: Bouncing-balls loader (loop → settle)

**Files:**
- Create: `src/components/loaderPhysics.ts`
- Create: `src/components/Loader.tsx`
- Create: `scripts/verify/timed.mjs`
- Modify: `src/components/Scene.tsx` (replace Preloader; intro stage machine; scroll lock)
- Modify: `src/index.css` (loader overlay styles; drop the spinner)

The physics is a 1:1 port of the reference HTML files (same constants, squash/stretch, motion blur, momentum integrals). The state machine: `loop` runs while assets load (minimum one full ball pass), switches to `settle` only in a window where the screen is empty (so the hand-off is seamless), `settle` ends when every ball has rolled off the right edge.

- [ ] **Step 10.1: Create `src/components/loaderPhysics.ts`**

```ts
// 1:1 port of the reference loader animations:
//   load_loop.html  → drawLoopFrame   (endless bouncing traverse)
//   load_final.html → drawSettleFrame (momentum decays, balls roll off)
// Pure functions of elapsed time — the Loader component owns the rAF loop.

export const TRAVEL_DURATION = 2500;
export const PAUSE_DURATION = 1500;
export const TOTAL_CYCLE = TRAVEL_DURATION + PAUSE_DURATION;
const BALL_COLOR = "#FFFFFF";

// bounceSpeed sets bounce frequency (= 4 * bounceSpeed). Spread these out and
// keep them mutually un-synced so no pair appears to bounce in unison. Higher
// frequency = lower arc, so frequency stays inversely tied to bounceHeight.
const LOOP_BALLS = [
  { phase: 0, entryPhase: 0.5, bounceHeight: 0.25, bounceSpeed: 1.175 },
  { phase: 0.084, entryPhase: 0.72, bounceHeight: 0.3, bounceSpeed: 0.675 },
  { phase: 0.1596, entryPhase: 0.33, bounceHeight: 0.2, bounceSpeed: 1.475 },
  { phase: 0.273, entryPhase: 0.58, bounceHeight: 0.27, bounceSpeed: 0.975 },
];

const SETTLE_BALLS = [
  { finalPhase: 0, bounceHeight: 0.25, bounceSpeed: 1.0 },
  { finalPhase: 0.18, bounceHeight: 0.3, bounceSpeed: 0.9 },
  { finalPhase: 0.4, bounceHeight: 0.2, bounceSpeed: 1.1 },
  { finalPhase: 0.66, bounceHeight: 0.27, bounceSpeed: 0.95 },
];

const INITIAL_MOMENTUM = 0.6;
const ROLL_START = 0.47; // where bounces go small and friction begins
const ROLL_FLOOR = 0.6; // speed (fraction of cruise) at the end of the roll
const ROLL_TERMINAL = 0.3; // speed the tail keeps easing toward rolling off
const ROLL_TAIL_K = 1.0; // how quickly the tail bleeds toward terminal
const PURE_ROLL_WIDTH = 0.08; // last ~8% of travel is pure rolling

function ballRadius(w: number, h: number): number {
  return w > h ? h * 0.02 : w * 0.02;
}

// Squash/stretch at ground contact, computed BEFORE the ground position so the
// contact point can account for the compressed half-height.
function squash(
  bounceArc: number,
  momentum: number,
): { scaleX: number; scaleY: number; isCompressed: boolean } {
  let scaleX = 1;
  let scaleY = 1;
  let isCompressed = false;
  if (bounceArc < 0.15 && momentum > 0.2) {
    const deformAmount = 1 - bounceArc / 0.15;
    const compressionScale = Math.min(momentum / 0.4, 1);
    scaleY = 1 - deformAmount * 0.4 * compressionScale;
    const horizontalStretch = deformAmount < 0.5 ? 0.15 : 0.3;
    scaleX = 1 + deformAmount * horizontalStretch * compressionScale;
    isCompressed = true;
  }
  return { scaleX, scaleY, isCompressed };
}

// Draw one ball, optionally with the 3-ghost motion-blur trail.
function renderBall(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scaleX: number,
  scaleY: number,
  r: number,
  blur: { vx: number; vy: number } | null,
): void {
  if (blur) {
    const mag = Math.sqrt(blur.vx * blur.vx + blur.vy * blur.vy);
    const blurLength = mag * 0.4;
    const dirX = blur.vx / mag;
    const dirY = blur.vy / mag;
    for (let i = 2; i >= 0; i--) {
      const off = (i / 3) * blurLength;
      ctx.save();
      ctx.globalAlpha = 0.1 + 0.9 * (i / 2);
      ctx.translate(x - dirX * off, y - dirY * off);
      ctx.scale(scaleX, scaleY);
      ctx.fillStyle = BALL_COLOR;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  } else {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scaleX, scaleY);
    ctx.fillStyle = BALL_COLOR;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ── loop phase ────────────────────────────────────────────────────────────────

export function drawLoopFrame(
  ctx: CanvasRenderingContext2D,
  elapsedMs: number,
  w: number,
  h: number,
): void {
  const r = ballRadius(w, h);
  for (const ball of LOOP_BALLS) {
    const cycleTime = (elapsedMs + ball.phase * TOTAL_CYCLE) % TOTAL_CYCLE;
    if (cycleTime >= TRAVEL_DURATION) continue;
    const progress = cycleTime / TRAVEL_DURATION;
    const x = -r + progress * (w + r * 2);

    const momentumLoss = 1 - progress * 0.25;
    const bounceFrequency = 4 * ball.bounceSpeed;
    // Per-ball entry offset: each ball enters at a different point in its arc,
    // so they don't all materialise at the apex.
    const bounceProgress = (progress * bounceFrequency + ball.entryPhase) % 1;
    const bounceArc = Math.sin(bounceProgress * Math.PI);
    const easedArc = 1 - Math.pow(1 - bounceArc, 2);
    const bounceHeight = h * ball.bounceHeight * momentumLoss;

    const { scaleX, scaleY, isCompressed } = squash(bounceArc, momentumLoss);

    // Rest the BOTTOM edge on the floor (not the center), so the ball can't
    // sink half-below the bottom edge at contact.
    const groundY = h - r * scaleY;
    const y = groundY - easedArc * bounceHeight;

    const vx = ((w + r * 2) / TRAVEL_DURATION) * 16.67;
    const vy = Math.cos(bounceProgress * Math.PI) * bounceHeight * 0.05;
    const shouldBlur = !isCompressed && bounceArc < 0.4 && momentumLoss > 0.2;
    renderBall(ctx, x, y, scaleX, scaleY, r, shouldBlur ? { vx, vy } : null);
  }
}

// True when no loop ball is on screen (all are in their pause segment) — the
// seamless moment to switch from loop to settle.
export function loopScreenEmpty(elapsedMs: number): boolean {
  return LOOP_BALLS.every(
    (b) =>
      (elapsedMs + b.phase * TOTAL_CYCLE) % TOTAL_CYCLE >= TRAVEL_DURATION,
  );
}

// ── settle phase ─────────────────────────────────────────────────────────────

// Remaining bounce energy at a given point across the screen (drives bounce
// height, squash and blur). Decay completes at 60% across, so the ball loses
// momentum fast and the low-energy rolling phase begins early.
function momentumAt(progress: number): number {
  const lossProgress = Math.min(progress / 0.6, 1);
  return INITIAL_MOMENTUM * (1 - Math.pow(lossProgress, 1.5) * 0.98);
}

// Horizontal speed: balls arrive at full cruise speed, decelerate steadily
// through the roll to ROLL_FLOOR of cruise, then keep gently slowing toward
// ROLL_TERMINAL as they roll off the right edge — never zero, so the trailing
// balls never catch and overlap the lead ball.
function speedFactor(progress: number): number {
  if (progress <= ROLL_START) return 1;
  const s = (progress - ROLL_START) / (1 - ROLL_START);
  if (s <= 1) return 1 - (1 - ROLL_FLOOR) * s;
  return (
    ROLL_TERMINAL +
    (ROLL_FLOOR - ROLL_TERMINAL) * Math.exp(-(s - 1) * ROLL_TAIL_K)
  );
}

// Distance travelled (integral of speed) by a given progress. Drives the
// horizontal position directly; cruise speed equals the loop's.
function horizontalDistance(progress: number): number {
  const steps = 240;
  const dp = progress / steps;
  let dist = 0;
  let prev = speedFactor(0);
  for (let i = 1; i <= steps; i++) {
    const s = speedFactor(dp * i);
    dist += (prev + s) * 0.5 * dp;
    prev = s;
  }
  return dist;
}

const FINAL_TRAVEL = horizontalDistance(1);
const PURE_ROLL_TRAVEL = FINAL_TRAVEL - PURE_ROLL_WIDTH;

// Flutter amplitude vs. travelled distance: full while bouncing, fading to
// zero so the last ~8% of the path is pure rolling — flat, no vertical motion.
function flutterDamp(travel: number): number {
  if (travel <= ROLL_START) return 1;
  if (travel >= PURE_ROLL_TRAVEL) return 0;
  return 1 - (travel - ROLL_START) / (PURE_ROLL_TRAVEL - ROLL_START);
}

// Number of completed bounces by a given progress. Real physics: time between
// bounces ∝ sqrt(bounce height), so instantaneous frequency ∝ 1/sqrt(energy).
// Phase is the time-INTEGRAL of that frequency, accumulated by trapezoidal
// integration so the cadence stays physically consistent as the ball decays.
function bouncePhase(progress: number, bounceSpeed: number): number {
  const baseFrequency = 4 * bounceSpeed;
  const steps = 240;
  const dp = progress / steps;
  let phase = 0;
  let prevRate = 1;
  for (let i = 1; i <= steps; i++) {
    const rate = Math.sqrt(INITIAL_MOMENTUM / momentumAt(dp * i));
    phase += (prevRate + rate) * 0.5 * dp;
    prevRate = rate;
  }
  return baseFrequency * phase;
}

// Draw the settle frame. Returns true once EVERY ball has rolled fully off the
// right edge — the loader's completion signal.
export function drawSettleFrame(
  ctx: CanvasRenderingContext2D,
  elapsedMs: number,
  w: number,
  h: number,
): boolean {
  const r = ballRadius(w, h);
  let allDone = true;
  for (const ball of SETTLE_BALLS) {
    const cycleTime = elapsedMs - ball.finalPhase * PAUSE_DURATION;
    if (cycleTime < 0) {
      allDone = false;
      continue;
    }
    const progress = cycleTime / TRAVEL_DURATION;
    const travel = horizontalDistance(progress);
    if (travel > 1) continue; // rolled fully off — done
    allDone = false;
    const x = -r + travel * (w + r * 2);

    const momentumLoss = momentumAt(progress);
    // +0.5 so the ball enters at the apex of its arc, not the ground.
    const phase = bouncePhase(progress, ball.bounceSpeed);
    const bounceProgress = (phase + 0.5) % 1;
    const bounceArc = Math.sin(bounceProgress * Math.PI);
    const easedArc = 1 - Math.pow(1 - bounceArc, 2);
    const bounceHeight =
      h * ball.bounceHeight * momentumLoss * flutterDamp(travel) * 1.1;

    const { scaleX, scaleY, isCompressed } = squash(bounceArc, momentumLoss);

    const groundY = h - r * scaleY;
    const y = groundY - easedArc * bounceHeight;

    const vx = ((w + r * 2) / TRAVEL_DURATION) * 16.67;
    const vy = Math.cos(bounceProgress * Math.PI) * bounceHeight * 0.05;
    const shouldBlur = !isCompressed && bounceArc < 0.4 && momentumLoss > 0.2;
    renderBall(ctx, x, y, scaleX, scaleY, r, shouldBlur ? { vx, vy } : null);
  }
  return allDone;
}
```

- [ ] **Step 10.2: Create `src/components/Loader.tsx`**

```tsx
import { useEffect, useRef } from "react";
import {
  drawLoopFrame,
  drawSettleFrame,
  loopScreenEmpty,
  TRAVEL_DURATION,
} from "./loaderPhysics";

interface LoaderProps {
  // GLTF/Draco/Lottie all ready (Scene's useProgress + animationStarted).
  assetsReady: boolean;
  reducedMotion: boolean;
  // Faded out (stage advanced past the loader). Kept mounted, like the old
  // Preloader, so the 0.5s opacity transition can play.
  hidden: boolean;
  // Fired exactly once, when the settle wave has fully rolled off (or
  // immediately on assetsReady under reduced motion).
  onSettled: () => void;
}

// Full-screen dark overlay with the bouncing-balls canvas. Loop runs while
// assets load — minimum one full ball pass — then switches to the settle
// physics at a moment when the screen is empty, so the hand-off is invisible.
export default function Loader({
  assetsReady,
  reducedMotion,
  hidden,
  onSettled,
}: LoaderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const assetsReadyRef = useRef(assetsReady);
  useEffect(() => {
    assetsReadyRef.current = assetsReady;
  }, [assetsReady]);
  const onSettledRef = useRef(onSettled);
  useEffect(() => {
    onSettledRef.current = onSettled;
  }, [onSettled]);
  const firedRef = useRef(false);

  useEffect(() => {
    if (reducedMotion) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", resize);
    resize();

    let raf = 0;
    let stage: "loop" | "settle" = "loop";
    let settleStart = 0;
    const start = performance.now();

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      if (stage === "loop") {
        const elapsed = now - start;
        drawLoopFrame(ctx, elapsed, w, h);
        // Gate (spec: minimum one full cycle even if assets load instantly):
        // loopScreenEmpty only turns true once every ball — including the
        // phase-offset stragglers — has finished a full travel pass, i.e. one
        // complete bounce iteration has played. Switching inside the empty
        // window makes the hand-off invisible. If the pacing feels rushed,
        // raise TRAVEL_DURATION here to TOTAL_CYCLE.
        if (
          assetsReadyRef.current &&
          elapsed >= TRAVEL_DURATION &&
          loopScreenEmpty(elapsed)
        ) {
          stage = "settle";
          settleStart = now;
        }
      } else {
        const done = drawSettleFrame(ctx, now - settleStart, w, h);
        if (done && !firedRef.current) {
          firedRef.current = true;
          cancelAnimationFrame(raf);
          onSettledRef.current();
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [reducedMotion]);

  // Reduced motion: no ball animation — release as soon as assets are ready.
  useEffect(() => {
    if (reducedMotion && assetsReady && !firedRef.current) {
      firedRef.current = true;
      onSettledRef.current();
    }
  }, [reducedMotion, assetsReady]);

  return (
    <div
      className={`loader-overlay${hidden ? " loader-overlay--hidden" : ""}`}
      aria-hidden
    >
      {!reducedMotion && <canvas ref={canvasRef} className="loader-canvas" />}
    </div>
  );
}
```

- [ ] **Step 10.3: Styles — add loader, drop the spinner**

In `src/index.css`: DELETE the `.dfrnc-spinner` rule, its `@keyframes dfrnc-spin`, and the `prefers-reduced-motion` block that references it. ADD:

```css
/* Bouncing-balls loader overlay. Mirrors the old preloader's fade-out: stays
   mounted, opacity transitions to 0 once the intro releases. */
.loader-overlay {
    position: fixed;
    inset: 0;
    z-index: 3;
    background: #0a0a0a;
    opacity: 1;
    transition: opacity 0.5s ease-in-out;
    pointer-events: auto;
}

.loader-overlay--hidden {
    opacity: 0;
    pointer-events: none;
}

.loader-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
}
```

- [ ] **Step 10.4: Wire the intro stage machine into Scene**

In `src/components/Scene.tsx`:

- Delete the whole `Preloader` function component, the `hidePreloader` state and its effect.
- `import Loader from "./Loader";`
- Add the stage state and scroll lock:

```ts
  // Intro sequence: loader (balls) → drop (auto-played DEFT fall, Task 11) →
  // free (scroll-driven experience). Scroll stays locked until "free".
  type IntroStage = "loader" | "drop" | "free";
  const [introStage, setIntroStage] = useState<IntroStage>("loader");

  const assetsReady =
    animationStarted && (reducedMotion || (!active && progress >= 100));

  const handleSettled = useCallback(() => {
    // Task 11 inserts the "drop" stage here; until then release directly.
    setIntroStage("free");
  }, []);

  // Scroll lock for the whole intro: the page must not scroll under the
  // loader or the DEFT drop.
  useEffect(() => {
    const locked = introStage !== "free";
    document.body.classList.toggle("scroll-locked", locked);
    if (locked) window.scrollTo(0, 0);
    return () => document.body.classList.remove("scroll-locked");
  }, [introStage]);
```

- Replace `<Preloader visible={!hidePreloader} />` with:

```tsx
      <Loader
        assetsReady={assetsReady}
        reducedMotion={reducedMotion}
        hidden={introStage !== "loader"}
        onSettled={handleSettled}
      />
```

(The `useProgress` destructure and `animationStarted` stay — they now feed `assetsReady`.)

- [ ] **Step 10.5: Timed verification harness**

Create `scripts/verify/timed.mjs`:

```js
// Time-offset screenshots after page load (no scrolling) — for the loader's
// time-based (not scroll-based) sequence.
// Usage: node scripts/verify/timed.mjs --url http://localhost:5173 \
//          --t 1000,3000,4500,6500,9000 --out /tmp/loader --viewport 1280x800
import puppeteer from "puppeteer-core";
import { mkdirSync } from "fs";

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};

const CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const url = opt("url", "http://localhost:5173");
const times = opt("t", "1000,3000,4500,6500,9000")
  .split(",")
  .map(Number)
  .sort((a, b) => a - b);
const out = opt("out", "/tmp/loader");
const [w, h] = opt("viewport", "1280x800").split("x").map(Number);

mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader-webgl",
    `--window-size=${w},${h}`,
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: w, height: h });
const t0 = Date.now();
await page.goto(url, { waitUntil: "domcontentloaded" });
for (const t of times) {
  const wait = t - (Date.now() - t0);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const file = `${out}/t${t}.png`;
  await page.screenshot({ path: file });
  console.log("wrote", file, `locked=${await page.evaluate(() => document.body.classList.contains("scroll-locked"))}`);
}
await browser.close();
```

- [ ] **Step 10.6: Verify the loader sequence**

```bash
npm run typecheck
node scripts/verify/timed.mjs --t 800,1800,3500,5000,7000,9500 --out /tmp/wave2-task10
```

Expected: `t=800/1800` white balls mid-bounce on dark (`locked=true`); `t=3500/5000` settle wave — balls low, rolling right, decreasing bounce; `t=7000+` overlay faded out, scene visible at the first Lottie frame, `locked=false`. (Headless asset loads are local-fast; if `locked=true` persists at 9500, the settle never completed — debug `drawSettleFrame`'s done condition before proceeding.) Also re-run `node scripts/verify/shot.mjs --sp 0,0.246 --out /tmp/wave2-task10-scroll --track 800 --wait 12000` — it must still produce scrolled shots (the harness waits for lock release).

- [ ] **Step 10.7: Commit**

```bash
git add src/components/loaderPhysics.ts src/components/Loader.tsx src/components/Scene.tsx src/index.css scripts/verify/timed.mjs
git commit -m "feat: bouncing-balls loader with settle hand-off replacing the spinner"
```

---

### Task 11: DEFT-drop autoplay + release

**Files:**
- Modify: `src/constants.ts` (`DEFT_DROP_S` → stand-in `1.0`)
- Modify: `src/components/LottiePlane.tsx` (drop autoplay window)
- Modify: `src/components/Scene.tsx` (loader → drop → free)

The one scroll-independent Lottie segment: after the balls settle, the first `DEFT_DROP_S` seconds auto-play (DEFT falls top→bottom in the real export), then scroll takes over from exactly that frame. `lottieTimeFor` already floors at `DEFT_DROP_S`, so scrolling back up can never replay the drop.

- [ ] **Step 11.1: Flip the constant**

In `src/constants.ts`:

```ts
// The loader auto-plays [0, DEFT_DROP_S] (the "DEFT drop"); scroll then drives
// [DEFT_DROP_S, LOTTIE_TOTAL_S]. STAND-IN: the real Lottie export isn't in yet,
// so the first 1.0s of the current animation plays the drop's role. Re-measure
// (with LOTTIE_INTRO_S / LOTTIE_TOTAL_S) when the export lands.
export const DEFT_DROP_S = 1.0;
```

- [ ] **Step 11.2: Add the drop window to LottiePlane**

In `src/components/LottiePlane.tsx`:

- Extend the imports/props:

```ts
import { LOTTIE_TOTAL_S, DEFT_DROP_S } from "../constants";
```

```ts
export type IntroStage = "loader" | "drop" | "free";

interface LottiePlaneProps {
  onComplete?: () => void;
  onAnimationStart?: () => void;
  // Fired once when the auto-played drop reaches DEFT_DROP_S.
  onDropDone?: () => void;
  reducedMotion?: boolean;
  scrollRef: MutableRefObject<number>;
  phase: Phase;
  introStage: IntroStage;
}
```

(and add `introStage`, `onDropDone` to the destructured props)

- Add refs near `lastTimeRef`:

```ts
  const dropClockRef = useRef<number>(0);
  const dropFiredRef = useRef<boolean>(false);
  const onDropDoneRef = useRef(onDropDone);
  useEffect(() => {
    onDropDoneRef.current = onDropDone;
  }, [onDropDone]);
```

- Replace the `useFrame` body:

```ts
  useFrame((_state, delta) => {
    const anim = animRef.current;
    if (!anim || !texture) return;
    let tSec: number;
    if (introStage === "loader") {
      // Behind the loader overlay: hold the very first frame.
      tSec = 0;
    } else if (introStage === "drop") {
      // The one scroll-independent segment: auto-play 0 → DEFT_DROP_S.
      dropClockRef.current += delta;
      tSec = Math.min(dropClockRef.current, DEFT_DROP_S);
      if (tSec >= DEFT_DROP_S && !dropFiredRef.current) {
        dropFiredRef.current = true;
        onDropDoneRef.current?.();
      }
    } else {
      // Scroll-driven; lottieTimeFor never returns less than DEFT_DROP_S, so
      // the drop can't replay on scroll-up.
      tSec = lottieTimeFor(scrollRef.current, phase);
    }
    if (tSec === lastTimeRef.current) return;
    lastTimeRef.current = tSec;
    const frac =
      LOTTIE_TOTAL_S > 0 ? Math.min(Math.max(tSec / LOTTIE_TOTAL_S, 0), 1) : 0;
    anim.goToAndStop(frac * Math.max(anim.totalFrames - 1, 0), true);
    if (texRef.current) texRef.current.needsUpdate = true;
  });
```

- [ ] **Step 11.3: Insert the drop stage in Scene**

In `src/components/Scene.tsx`:

```ts
  const handleSettled = useCallback(() => {
    // Reduced motion skips the drop (the Lottie sits on its final frame).
    setIntroStage((s) =>
      s === "loader" ? (reducedMotion ? "free" : "drop") : s,
    );
  }, [reducedMotion]);

  const handleDropDone = useCallback(() => {
    setIntroStage("free");
  }, []);
```

and pass the new props:

```tsx
            <LottiePlane
              reducedMotion={reducedMotion}
              onAnimationStart={handleAnimationStart}
              scrollRef={scrollRef}
              phase={phase}
              introStage={introStage}
              onDropDone={handleDropDone}
            />
```

- [ ] **Step 11.4: Verify the full intro flow**

```bash
npm run typecheck && npx tsx scripts/check-playback.ts
node scripts/verify/timed.mjs --t 800,3500,5000,6500,7500,9000 --out /tmp/wave2-task11
```

Expected: balls → settle → overlay fades and during ~1s after the fade the Lottie ADVANCES on its own (the drop; consecutive shots differ) with `locked=true` → then `locked=false` holding the `DEFT_DROP_S` frame.

Scroll-back floor check:

```bash
node scripts/verify/shot.mjs --sp 0.1,0 --out /tmp/wave2-task11-floor --track 800 --wait 14000
```

Expected: the `sp=0` shot (taken AFTER visiting 0.1) shows the `DEFT_DROP_S`-frame typography — NOT the animation's very first frame.

- [ ] **Step 11.5: Commit**

```bash
git add src/constants.ts src/components/LottiePlane.tsx src/components/Scene.tsx
git commit -m "feat: auto-played DEFT-drop intro between loader settle and scroll release"
```

---

### Task 12: Final sweep

**Files:**
- Delete: `public/model.glb` (superseded by `public/figures/`)

- [ ] **Step 12.1: Remove the orphaned GLB**

```bash
grep -rn "model.glb" src/ index.html
```

Expected: no matches (ArcModel now loads `figures/*.glb`). Then:

```bash
git rm public/model.glb
```

(If grep DOES match something, fix that reference first — do not delete.)

- [ ] **Step 12.2: Full verification pass**

```bash
npm run typecheck && npm run build
npx tsx scripts/check-playback.ts
npm run preview   # serves dist/ — note the port
node scripts/verify/shot.mjs --url http://localhost:4173 --sp 0,0.17,0.246,0.30,0.398,0.55,0.79,0.92,1 --out /tmp/wave2-final --track 800 --wait 14000
node scripts/verify/shot.mjs --url http://localhost:4173 --sp 0,0.246,0.92 --viewport 390x844 --out /tmp/wave2-final-mobile --track 800 --wait 14000
node scripts/verify/timed.mjs --url http://localhost:4173 --t 1000,4000,6500,9000 --out /tmp/wave2-final-loader
node scripts/verify/fps.mjs --url http://localhost:4173 --sp 0.3 --viewport 390x844 --track 800 --wait 14000
```

The FPS number (figures phase, mobile viewport, production build) should be in the same ballpark as the Task 2 measurements — a collapse here means one of the later tasks (4 transmissive figures, video layer) regressed rendering, not the AA work.

Walk every frame against the per-task expectations (Tasks 6, 8, 10, 11). The production build must behave identically to dev (Leva is stubbed out — confirm no Leva panel and no console errors in the `page:` output).

- [ ] **Step 12.3: Commit**

```bash
git add -A
git commit -m "chore: drop orphaned model.glb after figure manifest migration"
```

---

## Post-plan notes for the user (not tasks)

- **Pacing/shape constants** (`REVEAL_END`, `FIGURES_END`, `LOTTIE_END`, windows, per-figure arc values) are first-pass values — tune live via Leva (Cmd+L) and `constants.ts` after seeing it.
- **When the real exports land:** overwrite `public/figures/*.glb`; replace `src/assets/animation.json`; re-measure `DEFT_DROP_S` / `LOTTIE_INTRO_S` / `LOTTIE_TOTAL_S` (seconds = frame / `fr` from the JSON). No code changes expected.
- **If video scrubbing stutters on real devices:** request a re-encode (GOP 0.25–0.5 s, `+faststart`, optionally a 720p mobile variant).
- **Hand-test on a real phone** after Tasks 2 and 12: headless SwiftShader FPS is only a before/after proxy — the spec's "mobile frame rate does not regress noticeably" criterion is ultimately judged on-device (scroll through the figures phase and the video tail).
