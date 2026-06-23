# Gallery Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Append a pinned, scroll-scrubbed "gallery" section after the FPV video — `titles.json`-driven title frames over a cursor-reactive 3-card image stack that flies up on scroll, ending on a `mailto` CTA.

**Architecture:** The existing animation timeline is untouched. A second scroll progress `gp ∈ [0,1]` measures scroll *beyond* the 800vh animation track (the scroll hook already excludes trailing content). The video holds its last frame at `sp = 1`; a black `GalleryBackdrop` fades over it, then `titles.json` scrubs (3 title frames) while a card conveyor cycles, ending on a DOM CTA. All `gp`→state mapping lives in pure functions in `src/gallery.ts`, mirroring the existing `playback.ts`/`arc.ts` pattern; React/R3F components read `gp` from a ref inside `useFrame` (no per-frame re-renders).

**Tech Stack:** React 18 + TypeScript, `@react-three/fiber` (R3F) + `@react-three/drei`, `three` 0.170, `lottie-web` 5.13, Vite. No test runner — verification is `npm run typecheck`, `npm run build`, pure-function assertions in `scripts/check-playback.ts` (run via `npx tsx`), and headless screenshots via `scripts/verify/shot.mjs`.

## Global Constraints

- **Existing timeline is read-only.** Do NOT change `sp` semantics, `constants.ts` intro/figure/video values, `playback.ts`, `arc.ts`, `ArcModel`, `LottiePlane` scrub logic, or `VideoPlane`. The gallery is purely additive.
- **Intro Lottie inset stays at 2%** (`PADDING_RATIO = 0.02` in `LottiePlane.tsx`, unchanged). Only the gallery uses **3% vmin** gutters.
- **No per-frame React re-renders.** Gallery components read `galleryRef.current` inside `useFrame` (R3F) or an imperative rAF/scroll handler (DOM CTA), exactly like the existing scene. Discrete mount/unmount may use state flipped only on threshold crossings.
- **Gallery backdrop is flat black** (fade from the held video last frame). Cards/titles/CTA render in front of the video (z > −3.5).
- **Card images are placeholders, drop-in later.** `GALLERY_IMAGES` is a data array; `null` entries render a procedural gray placeholder. Swapping in real images = edit the array + drop files in `public/gallery/`, zero other code changes.
- **Layout (landscape, sums to 100vh):** 3vh gutter · 8vh top title · 3vh · 64vh cards (3:2 → 96vh wide) · 3vh · 16vh bottom title · 3vh. Gutter = 3% vmin. Card corner radius 2.5vh. Portrait (<1:1): cards stay 64vh tall, width → 86vw. Cap aspect at 16:9 (letterbox beyond).
- **CTA:** centered, 50vmin wide, `mailto:hi@deft.ch`, placeholder wording. Same cursor reactiveness as cards.
- **Reduced motion:** gallery content still scrubs with scroll (user-driven), but idle drift + pointer tilt are disabled and per-frame smoothing is skipped.
- **Commit** after each task with the message shown in its final step.

---

## File Structure

**Create:**
- `src/gallery.ts` — pure data + `gp`→state functions + layout constants (no React/Three).
- `src/cursorTilt.ts` — pure tilt/idle helpers (no React/Three).
- `src/components/GalleryBackdrop.tsx` — black plane, opacity from `galleryBackdropFor(gp)`.
- `src/components/GalleryTitles.tsx` — `titles.json` Lottie plane, scrubbed by `gp`.
- `src/components/GalleryCard.tsx` — one rounded-rect textured card (image or procedural placeholder).
- `src/components/CardStack.tsx` — 3-card conveyor + cursor tilt + idle.
- `src/components/GalleryCTA.tsx` — DOM overlay CTA (fade + CSS tilt + mailto).
- `src/assets/titles.json` — copied from `~/Downloads/titles.json`.

**Modify:**
- `src/constants.ts` — add `GALLERY_TRACK_VH`.
- `src/hooks/useScrollProgress.ts` — add `useGalleryProgressRef()`.
- `src/components/Scene.tsx` — mount gallery components, extend the scroll-track spacer, render the DOM CTA.
- `src/index.css` — CTA overlay styles.
- `scripts/check-playback.ts` — add gallery + cursorTilt assertions.
- `scripts/verify/shot.mjs` — add `--gp` option to screenshot gallery scroll positions.

---

## Task 1: Gallery timeline foundation (`gallery.ts` + constants + assertions)

**Files:**
- Create: `src/gallery.ts`
- Modify: `src/constants.ts` (append `GALLERY_TRACK_VH`)
- Test: `scripts/check-playback.ts` (append a gallery assertion block)

**Interfaces:**
- Consumes: `SCROLL_TRACK_VH` from `src/constants.ts`.
- Produces:
  - `GALLERY_TRACK_VH: number` (in `constants.ts`)
  - `GALLERY_IMAGES: (string | null)[]`
  - layout consts `GUTTER, TOP_TITLE_VH, CARDS_VH, BOTTOM_TITLE_VH, CARD_RADIUS_VH, CARD_ASPECT, CARDS_WIDTH_VW_PORTRAIT, MAX_ASPECT`
  - partition consts `BACKDROP_FADE_END, TITLES_END, CTA_START, CTA_FADE`
  - `galleryProgressFrom(scrollY: number, innerHeight: number): number`
  - `galleryBackdropFor(gp: number): number`
  - `galleryTitleFracFor(gp: number): number`
  - `cardConveyorFor(gp: number): { lead: number; local: number; span: number }`
  - `galleryCtaFor(gp: number): number`

- [ ] **Step 1: Add the track-height constant**

In `src/constants.ts`, append after the `SCROLL_TRACK_VH` declaration:

```ts
// Additional scrollable track (vh) appended AFTER the animation track for the
// gallery section. The animation timeline (sp) is unchanged — it stays clamped
// at 1 through the whole gallery; only `gp` (gallery progress) advances here.
export const GALLERY_TRACK_VH = 600;
```

- [ ] **Step 2: Write the failing assertions**

In `scripts/check-playback.ts`, add an import at the top alongside the existing imports:

```ts
import {
  galleryProgressFrom,
  galleryBackdropFor,
  galleryTitleFracFor,
  cardConveyorFor,
  galleryCtaFor,
  GALLERY_IMAGES,
  BACKDROP_FADE_END,
  TITLES_END,
  CTA_START,
} from "../src/gallery";
import { SCROLL_TRACK_VH, GALLERY_TRACK_VH } from "../src/constants";
```

Append this block at the end of the file. It uses the file's existing `eq(actual, expected, label)` and `ok(cond, label)` helpers (defined near the top of `check-playback.ts`):

```ts
// ── Gallery timeline ─────────────────────────────────────────────────────────
{
  const H = 1000; // arbitrary innerHeight for the pure mapping
  const animY = ((SCROLL_TRACK_VH - 100) / 100) * H;
  const galleryPx = (GALLERY_TRACK_VH / 100) * H;

  // gp is 0 at/under the animation track end, 1 at the document bottom.
  eq(galleryProgressFrom(animY, H), 0, "gp = 0 at anim track end");
  eq(galleryProgressFrom(animY - 500, H), 0, "gp clamps to 0 above gallery");
  eq(galleryProgressFrom(animY + galleryPx, H), 1, "gp = 1 at document bottom");
  eq(galleryProgressFrom(animY + galleryPx / 2, H), 0.5, "gp = 0.5 at gallery midpoint");

  // Backdrop: 0 at gp 0, 1 by BACKDROP_FADE_END, stays opaque after.
  eq(galleryBackdropFor(0), 0, "backdrop 0 at gp 0");
  eq(galleryBackdropFor(BACKDROP_FADE_END), 1, "backdrop fully in by fade end");
  eq(galleryBackdropFor(1), 1, "backdrop stays opaque after fade");

  // Title frac: 0 before titles start, reaches 1 at TITLES_END, holds at 1 after.
  eq(galleryTitleFracFor(BACKDROP_FADE_END), 0, "title frac 0 at titles start");
  eq(galleryTitleFracFor(TITLES_END), 1, "title frac 1 at TITLES_END");
  eq(galleryTitleFracFor(0.95), 1, "title frac holds at 1 after TITLES_END");
  ok(galleryTitleFracFor(0.4) > galleryTitleFracFor(0.2), "title frac is monotonic");

  // Conveyor: span 0→1 over [BACKDROP_FADE_END, CTA_START]; lead reaches N (empty) at CTA_START.
  const N = GALLERY_IMAGES.length;
  eq(cardConveyorFor(BACKDROP_FADE_END).lead, 0, "conveyor starts at lead 0");
  ok(cardConveyorFor(CTA_START).lead >= N, "conveyor empty (lead ≥ N) at CTA_START");
  ok(cardConveyorFor(0.4).span > cardConveyorFor(0.2).span, "conveyor span is monotonic");
  ok(
    cardConveyorFor(0.4).local >= 0 && cardConveyorFor(0.4).local < 1,
    "conveyor local in [0,1)",
  );

  // CTA: 0 before CTA_START, fades to 1 by the end.
  eq(galleryCtaFor(CTA_START), 0, "CTA hidden before CTA_START");
  eq(galleryCtaFor(1), 1, "CTA fully in at gp 1");

  console.log("✓ gallery timeline");
}
```

- [ ] **Step 3: Run the assertions to verify they fail**

Run: `npx tsx scripts/check-playback.ts`
Expected: FAIL — `Cannot find module '../src/gallery'` (the file does not exist yet).

- [ ] **Step 4: Implement `src/gallery.ts`**

```ts
import { SCROLL_TRACK_VH, GALLERY_TRACK_VH } from "./constants";

// Pure data + scroll→state functions for the gallery section (the scroll
// section appended AFTER the video). Mirrors playback.ts/arc.ts: no React, no
// Three — every per-frame value is a pure function of gallery progress `gp`,
// read inside useFrame so the section never needs a React re-render to advance.

function clamp01(x: number): number {
  return Math.min(Math.max(x, 0), 1);
}
function smoothstep(x: number): number {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
}

// ── Card images (drop-in) ────────────────────────────────────────────────────
// `null` ⇒ render a procedural gray placeholder (see GalleryCard). To ship real
// imagery: drop files in public/gallery/ and replace the nulls with their URLs
// (relative to BASE_URL), e.g. "gallery/photo-1.jpg". Any length ≥ 3 works; more
// images keep the 3-card stack full for longer before it empties into the CTA.
export const GALLERY_IMAGES: (string | null)[] = [
  null, null, null, null, null, null,
];

// ── Layout (fractions of viewport; vmin where noted) ─────────────────────────
export const GUTTER = 0.03; // 3% vmin gutter around/between typo and cards
export const TOP_TITLE_VH = 0.08; // top title line height
export const CARDS_VH = 0.64; // card-stack height (landscape & portrait)
export const BOTTOM_TITLE_VH = 0.16; // bottom title block (two lines)
export const CARD_RADIUS_VH = 0.025; // 2.5% vh corner radius
export const CARD_ASPECT = 3 / 2; // card width:height
export const CARDS_WIDTH_VW_PORTRAIT = 0.86; // portrait card width as vw
export const MAX_ASPECT = 16 / 9; // cap; letterbox beyond

// ── gp partition ─────────────────────────────────────────────────────────────
// [0, BACKDROP_FADE_END]   held video last frame fades to black
// [BACKDROP_FADE_END, TITLES_END]  titles scrub 0→1 (the 3 title frames)
// [TITLES_END, CTA_START]  titles hold on frame 3 while the last card flies out
// [CTA_START, 1]           CTA fades in (titles + cards gone)
export const BACKDROP_FADE_END = 0.06;
export const TITLES_END = 0.72;
export const CTA_START = 0.82;
export const CTA_FADE = 0.1;

// scrollY → gp. The animation track owns scroll up to its end (sp = 1 there);
// the gallery owns the GALLERY_TRACK_VH appended beyond it. innerHeight makes
// the vh-based track heights concrete. Mirrors useScrollProgress' anim mapping.
export function galleryProgressFrom(scrollY: number, innerHeight: number): number {
  const animY = ((SCROLL_TRACK_VH - 100) / 100) * innerHeight;
  const galleryPx = (GALLERY_TRACK_VH / 100) * innerHeight;
  return galleryPx > 0 ? clamp01((scrollY - animY) / galleryPx) : 0;
}

// Black backdrop opacity: the held video fades to flat black for the gallery.
export function galleryBackdropFor(gp: number): number {
  return smoothstep(clamp01(gp / BACKDROP_FADE_END));
}

// Normalized title scrub fraction (0→1) → maps to the titles.json frame range.
// Holds at 1 from TITLES_END so frame 3 is readable before the CTA takes over.
export function galleryTitleFracFor(gp: number): number {
  return clamp01((gp - BACKDROP_FADE_END) / (TITLES_END - BACKDROP_FADE_END));
}

export interface ConveyorState {
  // Index of the front card currently flying up (integer); ≥ length ⇒ empty.
  lead: number;
  // Fly-up progress of the front card, 0..1.
  local: number;
  // Raw 0..1 progress across the card phase (for callers that want it).
  span: number;
}

// Card conveyor: as `span` runs 0→1 over [BACKDROP_FADE_END, CTA_START], the
// front card flies up & out, the stack advances, and a new card enters behind.
// Visible cards are indices [lead, lead+1, lead+2] that are < GALLERY_IMAGES
// .length; near the end the stack naturally empties (so the frame is clear for
// the CTA). The 3-slot stacking offsets repeat every 3 (see CardStack).
export function cardConveyorFor(gp: number): ConveyorState {
  const span = clamp01((gp - BACKDROP_FADE_END) / (CTA_START - BACKDROP_FADE_END));
  const total = span * GALLERY_IMAGES.length;
  return { lead: Math.floor(total), local: total - Math.floor(total), span };
}

// CTA overlay opacity: 0 until CTA_START, smooth to 1 over CTA_FADE.
export function galleryCtaFor(gp: number): number {
  return smoothstep(clamp01((gp - CTA_START) / CTA_FADE));
}
```

- [ ] **Step 5: Run the assertions to verify they pass**

Run: `npx tsx scripts/check-playback.ts`
Expected: PASS — the existing checks still pass and a new `✓ gallery timeline` line prints.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/gallery.ts src/constants.ts scripts/check-playback.ts
git commit -m "feat(gallery): pure timeline foundation (gp partition, layout, conveyor)"
```

---

## Task 2: Gallery scroll progress + Scene spacer + screenshot harness `--gp`

**Files:**
- Modify: `src/hooks/useScrollProgress.ts` (add `useGalleryProgressRef`)
- Modify: `src/components/Scene.tsx` (call the hook; extend the spacer height)
- Modify: `scripts/verify/shot.mjs` (add `--gp` option)

**Interfaces:**
- Consumes: `galleryProgressFrom` from `src/gallery.ts`.
- Produces: `useGalleryProgressRef(): MutableRefObject<number>` (latest `gp`, ref, no re-renders).

- [ ] **Step 1: Add the gallery progress hook**

In `src/hooks/useScrollProgress.ts`, add the import and a sibling hook (leave `useScrollProgressRef` exactly as-is):

```ts
import { galleryProgressFrom } from "../gallery";

// Latest GALLERY progress (0..1) as a ref — scroll BEYOND the animation track.
// Separate from useScrollProgressRef so the animation timeline (sp) is wholly
// unchanged; both read window.scrollY in their own passive listener (cheap).
export function useGalleryProgressRef(): MutableRefObject<number> {
  const progress = useRef<number>(0);

  useEffect(() => {
    const read = () => {
      progress.current = galleryProgressFrom(window.scrollY, window.innerHeight);
    };
    window.addEventListener("scroll", read, { passive: true });
    window.addEventListener("resize", read);
    read();
    return () => {
      window.removeEventListener("scroll", read);
      window.removeEventListener("resize", read);
    };
  }, []);

  return progress;
}
```

- [ ] **Step 2: Extend the scroll-track spacer in Scene**

In `src/components/Scene.tsx`:

1. Update the constants import to include the gallery track:

```ts
import { SCROLL_TRACK_VH, GALLERY_TRACK_VH } from "../constants";
```

2. Add the gallery progress ref next to `scrollRef` (near the top of the component body, after `const scrollRef = useScrollProgressRef();`):

```ts
const galleryRef = useGalleryProgressRef();
```

and update the import:

```ts
import { useScrollProgressRef, useGalleryProgressRef } from "../hooks/useScrollProgress";
```

3. Change the spacer div height from `${SCROLL_TRACK_VH}vh` to include the gallery track:

```tsx
<div
  style={{
    height: `${SCROLL_TRACK_VH + GALLERY_TRACK_VH}vh`,
    width: "100%",
    pointerEvents: "none",
  }}
  aria-hidden
/>
```

(`galleryRef` is unused until Task 3 mounts gallery components — that is expected this task; it will be passed down next.)

- [ ] **Step 3: Add `--gp` to the screenshot harness**

In `scripts/verify/shot.mjs`, read the existing arg-parsing + scroll logic first, then add support for a `--gp <comma list>` option that scrolls to gallery positions. The scroll target for a given `gp` is `animY + gp * (maxScrollY - animY)`, where `animY = ((track-100)/100) * innerHeight` and `maxScrollY = scrollHeight - innerHeight`. Add a helper used in place of the `--sp` scroll when `--gp` is provided:

```js
// Scroll to a GALLERY progress position (gp ∈ [0,1]) — i.e. scroll BEYOND the
// animation track. `track` is SCROLL_TRACK_VH (default 800).
async function scrollToGp(page, gp, track) {
  await page.evaluate(
    ({ gp, track }) => {
      const ih = window.innerHeight;
      const animY = ((track - 100) / 100) * ih;
      const maxY = document.documentElement.scrollHeight - ih;
      window.scrollTo(0, animY + gp * (maxY - animY));
    },
    { gp, track },
  );
}
```

Wire `--gp` parsing to mirror `--sp` (comma-separated list → one screenshot each, filename suffix `gp<value>`), calling `scrollToGp` instead of the `--sp` scroll. Keep `--sp` behavior unchanged.

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: both succeed (no type errors; bundle builds).

- [ ] **Step 5: Verify gp advances (headless)**

Run the dev server in one shell: `npm run dev` (note the port, e.g. 5173).
Then install harness deps if needed and probe gp at the document bottom:

```bash
npm i puppeteer-core tsx --no-save
node -e "(async()=>{const p=require('puppeteer-core');const b=await p.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader-webgl']});const pg=await b.newPage();await pg.goto('http://localhost:5173',{waitUntil:'load'});await new Promise(r=>setTimeout(r,15000));await pg.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));const y=await pg.evaluate(()=>({sy:window.scrollY,max:document.documentElement.scrollHeight-window.innerHeight}));console.log(y);await b.close();})()"
```

Expected: `sy ≈ max` (the page scrolls into the appended gallery track; document height grew by ~600vh).

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useScrollProgress.ts src/components/Scene.tsx scripts/verify/shot.mjs
git commit -m "feat(gallery): append gallery scroll track + gp progress + shot --gp"
```

---

## Task 3: GalleryBackdrop (black fade plane)

**Files:**
- Create: `src/components/GalleryBackdrop.tsx`
- Modify: `src/components/Scene.tsx` (mount it inside the Canvas)
- Test: headless screenshot

**Interfaces:**
- Consumes: `galleryBackdropFor` from `src/gallery.ts`; `galleryRef` from Scene.
- Produces: `<GalleryBackdrop galleryRef={...} />` (default export).

- [ ] **Step 1: Implement the backdrop plane**

```tsx
import { useRef } from "react";
import type { MutableRefObject } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { galleryBackdropFor } from "../gallery";

// Flat black plane that fades in over the held video last frame as the gallery
// begins (gp ∈ [0, BACKDROP_FADE_END]). Sits in FRONT of the video (z = −3.5)
// and the intro Lottie (z = −3) so it cleanly covers both; the gallery titles,
// cards and CTA render in front of THIS. Fills the camera frustum at its depth.
const PLANE_Z = -2.9;

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
```

- [ ] **Step 2: Mount it in Scene**

In `src/components/Scene.tsx`, import and render it inside the `<Canvas>` (after `<VideoPlane ... />` so it draws on top; transparent + `depthWrite={false}` keeps ordering by render order):

```tsx
import GalleryBackdrop from "./GalleryBackdrop";
```

```tsx
<VideoPlane scrollRef={scrollRef} phase={phase} />
<GalleryBackdrop galleryRef={galleryRef} />
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: both succeed.

- [ ] **Step 4: Screenshot — video frame at gp 0, black at gp 0.1**

With `npm run dev` running (port 5173):

```bash
node scripts/verify/shot.mjs --url http://localhost:5173 --gp 0,0.1 --out /tmp/gallery-bg --track 800 --wait 15000
```

Expected: `gp0` shows the video's last frame (sp pinned at 1); `gp0.1` is flat black. Open both and confirm visually.

- [ ] **Step 5: Commit**

```bash
git add src/components/GalleryBackdrop.tsx src/components/Scene.tsx
git commit -m "feat(gallery): black backdrop fades over held video frame"
```

---

## Task 4: GalleryTitles (titles.json scrub plane)

**Files:**
- Create: `src/assets/titles.json` (copy of `~/Downloads/titles.json`)
- Create: `src/components/GalleryTitles.tsx`
- Modify: `src/components/Scene.tsx` (mount inside Canvas, inside the existing `<Suspense>`)
- Test: headless screenshots of the 3 title frames

**Interfaces:**
- Consumes: `galleryTitleFracFor`, `GUTTER` from `src/gallery.ts`; `galleryRef`, `reducedMotion` from Scene.
- Produces: `<GalleryTitles galleryRef={...} reducedMotion={...} />`.

- [ ] **Step 1: Copy the Lottie asset into the repo**

```bash
cp ~/Downloads/titles.json src/assets/titles.json
```

- [ ] **Step 2: Implement the titles plane**

Modeled on `LottiePlane` (offscreen lottie-web canvas → `CanvasTexture`, scrubbed via `goToAndStop`), but driven by `gp` and sized to the gutter-inset region with `preserveAspectRatio:"none"` (the comp already places the top line in the top ~8% and the bottom lines in the bottom ~16%). No intro/drop logic.

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import lottie from "lottie-web";
import type { AnimationItem } from "lottie-web";
import titlesData from "../assets/titles.json";
import { galleryTitleFracFor, GUTTER, MAX_ASPECT } from "../gallery";

// titles.json scrubbed by gallery progress. The 1000×1000 comp encodes the 3
// title frames at the right top(≈8%)/bottom(≈16%) positions, so a full-frame
// stretched render (preserveAspectRatio:"none"), inset by the 3% vmin gutter,
// reproduces the layout. The middle of the comp is transparent — the card stack
// renders there (a separate component). Titles never tilt.
const PLANE_Z = -1;

interface Props {
  galleryRef: MutableRefObject<number>;
  reducedMotion?: boolean;
}

export default function GalleryTitles({ galleryRef, reducedMotion = false }: Props) {
  const { viewport, camera, size, gl } = useThree();
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);
  const animRef = useRef<AnimationItem | null>(null);
  const texRef = useRef<THREE.CanvasTexture | null>(null);
  const lastFrameRef = useRef<number>(-1);
  const smoothRef = useRef<number>(-1);

  useEffect(() => {
    const wrapper = document.createElement("div");
    wrapper.style.position = "absolute";
    wrapper.style.left = "-99999px";
    wrapper.style.top = "0";
    wrapper.style.width = `${size.width}px`;
    wrapper.style.height = `${size.height}px`;
    document.body.appendChild(wrapper);

    const ssMax = Math.min(size.width, size.height) <= 480 ? 1.0 : 1.25;
    const ssDpr = Math.max(
      1,
      Math.min(
        (window.devicePixelRatio || 1) * ssMax,
        4096 / Math.max(size.width, size.height),
      ),
    );

    const anim = lottie.loadAnimation({
      container: wrapper,
      renderer: "canvas",
      loop: false,
      autoplay: false,
      animationData: titlesData,
      rendererSettings: { preserveAspectRatio: "none", clearCanvas: true, dpr: ssDpr },
    });
    animRef.current = anim;
    anim.setSubframe(true);
    lastFrameRef.current = -1;
    smoothRef.current = -1;

    let tex: THREE.CanvasTexture | null = null;
    const handleLoaded = () => {
      const cnv = wrapper.querySelector("canvas") as HTMLCanvasElement | null;
      if (!cnv) return;
      tex = new THREE.CanvasTexture(cnv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
      texRef.current = tex;
      setTexture(tex);
      anim.goToAndStop(0, true);
    };
    anim.addEventListener("DOMLoaded", handleLoaded);

    return () => {
      anim.destroy();
      animRef.current = null;
      wrapper.remove();
      if (tex) tex.dispose();
      texRef.current = null;
    };
  }, [size.width, size.height, gl]);

  useFrame((_s, delta) => {
    const anim = animRef.current;
    if (!anim || !texture) return;
    const target = galleryTitleFracFor(galleryRef.current); // 0..1
    let frac: number;
    if (reducedMotion) {
      frac = target; // discrete, no smoothing
    } else {
      if (smoothRef.current < 0) smoothRef.current = target;
      smoothRef.current += (target - smoothRef.current) * (1 - Math.exp(-delta * 10));
      if (Math.abs(target - smoothRef.current) < 1 / 600) smoothRef.current = target;
      frac = smoothRef.current;
    }
    const frame = frac * Math.max(anim.totalFrames - 1, 0);
    if (frame === lastFrameRef.current) return;
    lastFrameRef.current = frame;
    anim.goToAndStop(frame, true);
    if (texRef.current) texRef.current.needsUpdate = true;
  });

  const { planeWidth, planeHeight } = useMemo(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const aspect = viewport.width / viewport.height;
    const distance = cam.position.z - PLANE_Z;
    const fullHeight = 2 * distance * Math.tan((cam.fov * Math.PI) / 360);
    const fullWidth = fullHeight * aspect;
    const margin = GUTTER * Math.min(fullWidth, fullHeight); // 3% vmin gutter
    const innerH = fullHeight - margin * 2;
    // Cap content width at 16:9 (letterbox beyond) so titles don't over-stretch
    // on ultra-wide viewports.
    const innerW = Math.min(fullWidth - margin * 2, MAX_ASPECT * innerH);
    return { planeWidth: innerW, planeHeight: innerH };
  }, [camera, viewport.width, viewport.height]);

  if (!texture) return null;

  return (
    <mesh position={[0, 0, PLANE_Z]}>
      <planeGeometry args={[planeWidth, planeHeight]} />
      <meshBasicMaterial map={texture} toneMapped={false} transparent alphaTest={0.05} />
    </mesh>
  );
}
```

- [ ] **Step 3: Mount it in Scene**

In `src/components/Scene.tsx`, import and render inside the existing `<Suspense>` block (alongside `LottiePlane`):

```tsx
import GalleryTitles from "./GalleryTitles";
```

```tsx
<GalleryTitles galleryRef={galleryRef} reducedMotion={reducedMotion} />
```

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: both succeed. (If TS complains about importing `titles.json`, confirm `resolveJsonModule` is on — `animation.json` already imports fine, so it is.)

- [ ] **Step 5: Screenshot the three title frames**

With `npm run dev` running:

```bash
node scripts/verify/shot.mjs --url http://localhost:5173 --gp 0.39,0.52,0.76 --out /tmp/gallery-titles --track 800 --wait 15000
```

Expected (open and confirm): `gp0.39` ≈ `WIR LIEFERN` / `STRATEGISCHE KOMMUNIKATION`; `gp0.52` ≈ `WIR LIEFERN` / `DESIGN NACH MASS`; `gp0.76` ≈ `UND DIE` / `GANZ GROSSEN BILDER`. Top line in the top ~8%, bottom block in the bottom ~16%, text stretched full width, 3% gutter at the edges. (Exact gp values are approximate — adjust if a transition lands mid-frame.)

- [ ] **Step 6: Commit**

```bash
git add src/assets/titles.json src/components/GalleryTitles.tsx src/components/Scene.tsx
git commit -m "feat(gallery): titles.json scrub plane (3 title frames, 3% gutter)"
```

---

## Task 5: cursorTilt shared helpers

**Files:**
- Create: `src/cursorTilt.ts`
- Test: `scripts/check-playback.ts` (append assertions)

**Interfaces:**
- Produces:
  - consts `TILT_MAX, TILT_RATE, IDLE_AMP_X, IDLE_AMP_Y, IDLE_FREQ_X, IDLE_FREQ_Y`
  - `approach(current: number, target: number, delta: number, rate: number): number`
  - `tiltTarget(pointerX: number, pointerY: number, reducedMotion: boolean): { x: number; y: number }`
  - `idleTilt(elapsed: number, reducedMotion: boolean): { x: number; y: number }`

- [ ] **Step 1: Write the failing assertions**

Add to the imports in `scripts/check-playback.ts`:

```ts
import {
  approach,
  tiltTarget,
  idleTilt,
  TILT_MAX,
  IDLE_AMP_X,
  IDLE_AMP_Y,
} from "../src/cursorTilt";
```

Append at the end of the file (same `eq`/`ok` helpers):

```ts
// ── Cursor tilt ──────────────────────────────────────────────────────────────
{
  // approach converges toward target and is a no-op at delta 0.
  let v = 0;
  for (let i = 0; i < 1000; i++) v = approach(v, 1, 1 / 60, 4);
  ok(Math.abs(v - 1) < 1e-3, "approach converges to target");
  eq(approach(0, 1, 0, 4), 0, "approach with delta 0 is a no-op");

  // tiltTarget maps pointer to rotation, zero under reduced motion.
  const t = tiltTarget(1, 1, false);
  eq(t.y, TILT_MAX, "pointer.x → rotY = +TILT_MAX");
  eq(t.x, -TILT_MAX, "pointer.y → rotX = −TILT_MAX");
  const tr = tiltTarget(1, 1, true);
  ok(tr.x === 0 && tr.y === 0, "reduced motion ⇒ no pointer tilt");

  // idleTilt is bounded by its amplitudes and zero under reduced motion.
  for (const e of [0, 1.3, 5.7, 12.4]) {
    const it = idleTilt(e, false);
    ok(Math.abs(it.x) <= IDLE_AMP_X + 1e-9, "idle x within amplitude");
    ok(Math.abs(it.y) <= IDLE_AMP_Y + 1e-9, "idle y within amplitude");
  }
  const ir = idleTilt(5.7, true);
  ok(ir.x === 0 && ir.y === 0, "reduced motion ⇒ no idle drift");

  console.log("✓ cursor tilt");
}
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx scripts/check-playback.ts`
Expected: FAIL — `Cannot find module '../src/cursorTilt'`.

- [ ] **Step 3: Implement `src/cursorTilt.ts`**

```ts
// Shared cursor-reaction helpers for the gallery (cards + CTA). Mirrors the
// glass figures' mouse parallax (lerp toward pointer × max), plus a small
// always-on idle drift so the subject moves when the cursor is still / on
// mobile (the radiance.family feel). Pure — unit-asserted in check-playback.

export const TILT_MAX = 0.07; // ~4° max pointer tilt (matches the figures)
export const TILT_RATE = 4; // exponential lerp rate toward the target
export const IDLE_AMP_X = 0.025; // idle pitch amplitude (radians)
export const IDLE_AMP_Y = 0.04; // idle yaw amplitude (radians)
export const IDLE_FREQ_X = 0.13; // idle pitch frequency (cycles/sec)
export const IDLE_FREQ_Y = 0.09; // idle yaw frequency (cycles/sec)

// Framerate-independent exponential approach of `current` toward `target`.
export function approach(current: number, target: number, delta: number, rate: number): number {
  return current + (target - current) * (1 - Math.exp(-delta * rate));
}

// Pointer (−1..1 device coords) → target tilt. Reduced motion ⇒ no tilt.
export function tiltTarget(pointerX: number, pointerY: number, reducedMotion: boolean): { x: number; y: number } {
  if (reducedMotion) return { x: 0, y: 0 };
  return { x: -pointerY * TILT_MAX, y: pointerX * TILT_MAX };
}

// Always-on idle drift (added on top of the pointer tilt). Reduced motion ⇒ 0.
export function idleTilt(elapsed: number, reducedMotion: boolean): { x: number; y: number } {
  if (reducedMotion) return { x: 0, y: 0 };
  return {
    x: IDLE_AMP_X * Math.sin(elapsed * IDLE_FREQ_X * Math.PI * 2),
    y: IDLE_AMP_Y * Math.sin(elapsed * IDLE_FREQ_Y * Math.PI * 2 + 1.3),
  };
}
```

- [ ] **Step 4: Run to verify pass + typecheck**

Run: `npx tsx scripts/check-playback.ts && npm run typecheck`
Expected: PASS — `✓ cursor tilt` prints; no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/cursorTilt.ts scripts/check-playback.ts
git commit -m "feat(gallery): shared cursor tilt + idle drift helpers"
```

---

## Task 6: GalleryCard (rounded-rect textured card)

**Files:**
- Create: `src/components/GalleryCard.tsx`
- Test: headless screenshot of a single card (temporarily mounted, then reverted) — or first card visible via CardStack in Task 7

**Interfaces:**
- Consumes: `CARD_RADIUS_VH`, `CARD_ASPECT` from `src/gallery.ts`.
- Produces: `<GalleryCard src={string | null} index={number} width={number} height={number} />` — a forwardRef-free group placed/animated by its parent (CardStack). Renders a rounded-rect mesh; loads `src` as a texture or draws a procedural gray placeholder when `src` is null.
  - Exported helper: `roundedRectShape(w: number, h: number, r: number): THREE.Shape`
  - Exported helper: `placeholderTexture(index: number): THREE.CanvasTexture`

- [ ] **Step 1: Implement the card**

Rounded corners use a `THREE.Shape` → `ShapeGeometry` (true geometric rounding, anti-aliased by the scene's SMAA — no custom shader). `ShapeGeometry` UVs are in shape-space, so they are remapped to 0..1 and cover-fit to the card's 3:2.

```tsx
import { useEffect, useMemo, useState } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { CARD_RADIUS_VH, CARDS_VH, CARD_ASPECT } from "../gallery";

// Build a centered rounded-rectangle path (width w, height h, corner radius r).
export function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  const rr = Math.min(r, w / 2, h / 2);
  s.moveTo(x + rr, y);
  s.lineTo(x + w - rr, y);
  s.quadraticCurveTo(x + w, y, x + w, y + rr);
  s.lineTo(x + w, y + h - rr);
  s.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  s.lineTo(x + rr, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - rr);
  s.lineTo(x, y + rr);
  s.quadraticCurveTo(x, y, x + rr, y);
  return s;
}

// Procedural gray placeholder (matches the PDF mockups). Cached per index.
const placeholderCache = new Map<number, THREE.CanvasTexture>();
export function placeholderTexture(index: number): THREE.CanvasTexture {
  const cached = placeholderCache.get(index);
  if (cached) return cached;
  const c = document.createElement("canvas");
  c.width = 600;
  c.height = 400; // 3:2
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#8a8a8a";
  ctx.fillRect(0, 0, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  placeholderCache.set(index, tex);
  return tex;
}

// Remap ShapeGeometry UVs to 0..1 over the shape's bounding box, then cover-fit
// the texture's aspect into the card's 3:2 (center crop).
function fitUVs(geom: THREE.ShapeGeometry, w: number, h: number, texAspect: number) {
  geom.computeBoundingBox();
  const bb = geom.boundingBox!;
  const uv = geom.attributes.uv as THREE.BufferAttribute;
  const cardAspect = w / h;
  // cover-fit scale: shrink the longer texture axis' UV span.
  let su = 1;
  let sv = 1;
  if (texAspect > cardAspect) su = cardAspect / texAspect; // wider texture → crop sides
  else sv = texAspect / cardAspect; // taller texture → crop top/bottom
  for (let i = 0; i < uv.count; i++) {
    const x = (geom.attributes.position.getX(i) - bb.min.x) / w; // 0..1
    const y = (geom.attributes.position.getY(i) - bb.min.y) / h; // 0..1
    uv.setXY(i, 0.5 + (x - 0.5) * su, 0.5 + (y - 0.5) * sv);
  }
  uv.needsUpdate = true;
}

interface Props {
  src: string | null;
  index: number;
  // World-space card size (the parent sizes these to 64vh / 3:2).
  width: number;
  height: number;
}

export default function GalleryCard({ src, index, width, height }: Props) {
  const { gl } = useThree();
  const [texture, setTexture] = useState<THREE.Texture>(() => placeholderTexture(index));

  // Load the real image when src is provided; fall back to the placeholder.
  useEffect(() => {
    if (!src) {
      setTexture(placeholderTexture(index));
      return;
    }
    let cancelled = false;
    new THREE.TextureLoader().load(
      import.meta.env.BASE_URL + src,
      (tex) => {
        if (cancelled) return;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
        setTexture(tex);
      },
      undefined,
      () => { if (!cancelled) setTexture(placeholderTexture(index)); }, // error → placeholder
    );
    return () => { cancelled = true; };
  }, [src, index, gl]);

  const geometry = useMemo(() => {
    // Corner radius is 2.5% vh; as a fraction of the card height that is
    // CARD_RADIUS_VH / CARDS_VH (0.025 / 0.64 ≈ 0.039 of the card height).
    const radius = height * (CARD_RADIUS_VH / CARDS_VH);
    const shape = roundedRectShape(width, height, radius);
    const geom = new THREE.ShapeGeometry(shape, 24);
    const img = texture.image as { width?: number; height?: number } | undefined;
    const texAspect = img && img.width && img.height ? img.width / img.height : CARD_ASPECT;
    fitUVs(geom, width, height, texAspect);
    return geom;
  }, [width, height, texture]);

  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}
```

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: both succeed.

- [ ] **Step 3: Screenshot a single card (temporary mount)**

Temporarily add to Scene inside the Canvas (revert after):

```tsx
{/* TEMP card preview */}
<GalleryCard src={null} index={0} width={5.9 * 1.5} height={5.9} />
```

(5.9 ≈ 0.64 × 9.24 world-units viewport height; width = height × 1.5.) With `npm run dev`:

```bash
node scripts/verify/shot.mjs --url http://localhost:5173 --gp 0.1 --out /tmp/gallery-card --track 800 --wait 15000
```

Expected: a single gray rounded-corner card centered on black. Confirm the corners are rounded (~2.5vh) and edges crisp. Then **remove the TEMP mount**.

- [ ] **Step 4: Commit**

```bash
git add src/components/GalleryCard.tsx
git commit -m "feat(gallery): rounded-rect card with image/procedural placeholder"
```

---

## Task 7: CardStack (3-card conveyor + cursor tilt + idle)

**Files:**
- Create: `src/components/CardStack.tsx`
- Modify: `src/components/Scene.tsx` (mount inside Canvas)
- Test: headless screenshots across gp (stack + mid fly-up)

**Interfaces:**
- Consumes: `cardConveyorFor`, `GALLERY_IMAGES`, `CARDS_VH`, `CARD_ASPECT`, `CARDS_WIDTH_VW_PORTRAIT`, `MAX_ASPECT` from `src/gallery.ts`; `approach`, `tiltTarget`, `idleTilt`, `TILT_RATE` from `src/cursorTilt.ts`; `galleryRef`, `reducedMotion` from Scene; `GalleryCard`.
- Produces: `<CardStack galleryRef={...} reducedMotion={...} />`.

- [ ] **Step 1: Implement the stack**

The conveyor renders up to 3 cards (indices `lead`, `lead+1`, `lead+2` that are `< GALLERY_IMAGES.length`). Slot positions: slot 0 (front) flies up & out as `local` 0→1; slots 1 and 2 advance forward toward the front as `local` increases. Stacking offsets (back cards peek up-right, per the photo) repeat every 3. The whole group tilts toward the pointer (`tiltTarget` + `idleTilt`, lerped via `approach`).

```tsx
import { useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import GalleryCard from "./GalleryCard";
import {
  cardConveyorFor,
  GALLERY_IMAGES,
  CARDS_VH,
  CARD_ASPECT,
  CARDS_WIDTH_VW_PORTRAIT,
} from "../gallery";
import { approach, tiltTarget, idleTilt, TILT_RATE } from "../cursorTilt";

const PLANE_Z = 0; // center of the frustum → pronounced perspective for the tilt

// Per-slot resting offsets (world-unit fractions of card size). Slot 0 = front;
// 1 and 2 peek up and to the right (matches the PDF stack). Repeats every 3.
const SLOT_OFFSETS = [
  { x: 0.0, y: 0.0, s: 1.0, z: 0.0 },
  { x: 0.035, y: 0.045, s: 0.985, z: -0.15 },
  { x: 0.07, y: 0.09, s: 0.97, z: -0.3 },
];

interface Props {
  galleryRef: MutableRefObject<number>;
  reducedMotion?: boolean;
}

export default function CardStack({ galleryRef, reducedMotion = false }: Props) {
  const { viewport, pointer } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const slotRefs = [useRef<THREE.Group>(null), useRef<THREE.Group>(null), useRef<THREE.Group>(null)];
  const rotX = useRef(0);
  const rotY = useRef(0);
  const elapsed = useRef(0);

  // Card world size. ≥1:1: 64vh tall, 3:2 (96vh wide). Portrait: 64vh tall,
  // width tracks 86vw. Viewport is in world units (height ≈ 9.24 at z=0).
  const { cardW, cardH } = useMemo(() => {
    const vw = viewport.width;
    const vh = viewport.height;
    const aspect = vw / vh;
    const h = CARDS_VH * vh;
    let w = h * CARD_ASPECT; // landscape/square: keep 3:2
    if (aspect < 1) w = CARDS_WIDTH_VW_PORTRAIT * vw; // portrait: stretch to 86vw
    // 16:9 cap: beyond it the section letterboxes — cards keep their vh-based
    // size (they never grow past 64vh / 96vh), so wide viewports leave empty
    // space left/right automatically.
    return { cardW: w, cardH: h };
  }, [viewport.width, viewport.height]);

  useFrame((_s, delta) => {
    const group = groupRef.current;
    if (!group) return;
    elapsed.current += delta;

    const { lead, local, span } = cardConveyorFor(galleryRef.current);
    const n = GALLERY_IMAGES.length;

    for (let slot = 0; slot < 3; slot++) {
      const ref = slotRefs[slot].current;
      if (!ref) continue;
      const idx = lead + slot;
      ref.visible = idx < n;
      if (idx >= n) continue;

      // Continuous depth: slot 0 (front) eases to −local as it flies out; the
      // cards behind ease one slot forward as `local` advances 0→1.
      const d = slot - local;
      if (d < 0) {
        // Front card flying up and out of frame (no fade — flies out like the
        // glass figures; clears the top by ≈1.5× the card height).
        const a = SLOT_OFFSETS[0];
        ref.position.set(a.x * cardW, a.y * cardH + -d * cardH * 1.5, a.z);
        ref.scale.setScalar(a.s);
      } else {
        const lo = Math.min(2, Math.floor(d));
        const hi = Math.min(2, lo + 1);
        const f = d - Math.floor(d);
        const a = SLOT_OFFSETS[lo];
        const b = SLOT_OFFSETS[hi];
        ref.position.set(
          THREE.MathUtils.lerp(a.x, b.x, f) * cardW,
          THREE.MathUtils.lerp(a.y, b.y, f) * cardH,
          THREE.MathUtils.lerp(a.z, b.z, f),
        );
        ref.scale.setScalar(THREE.MathUtils.lerp(a.s, b.s, f));
      }
    }

    // Entrance: the whole stack rises from below as the gallery opens.
    const entrance = THREE.MathUtils.clamp(span / 0.04, 0, 1);
    group.position.y = (1 - entrance) * -cardH * 1.6;

    // Cursor tilt + idle on the whole stack (group rotation).
    const tt = tiltTarget(pointer.x, pointer.y, reducedMotion);
    const it = idleTilt(elapsed.current, reducedMotion);
    rotX.current = approach(rotX.current, tt.x + it.x, delta, TILT_RATE);
    rotY.current = approach(rotY.current, tt.y + it.y, delta, TILT_RATE);
    group.rotation.x = rotX.current;
    group.rotation.y = rotY.current;
  });

  return (
    <group ref={groupRef} position={[0, 0, PLANE_Z]}>
      {[0, 1, 2].map((slot) => (
        <group key={slot} ref={slotRefs[slot]}>
          {/* index is assigned per-frame via the conveyor; the card itself only
              needs a stable slot. Use slot as the placeholder index so each slot
              shows a consistent gray; real images key off the live conveyor idx
              below. */}
          <SlotCard slot={slot} galleryRef={galleryRef} cardW={cardW} cardH={cardH} />
        </group>
      ))}
    </group>
  );
}

// Resolves the live image index for a slot each render-ish; the conveyor lead is
// read from galleryRef. Kept as a tiny child so GalleryCard's texture swaps only
// when the resolved index changes (not every frame).
function SlotCard({
  slot,
  galleryRef,
  cardW,
  cardH,
}: {
  slot: number;
  galleryRef: MutableRefObject<number>;
  cardW: number;
  cardH: number;
}) {
  const { lead } = cardConveyorFor(galleryRef.current);
  const idx = lead + slot;
  const n = GALLERY_IMAGES.length;
  const realIdx = idx % n;
  return <GalleryCard src={GALLERY_IMAGES[realIdx]} index={realIdx} width={cardW} height={cardH} />;
}
```

NOTE: `SlotCard` reads `galleryRef.current` at render time only to pick which image/placeholder index a slot shows; the per-frame **position/scale/fly-up** is driven imperatively in the parent `useFrame` (no re-render). Because placeholders are all identical gray, image-index churn is invisible now; when real images are dropped in, wrap `SlotCard` in a threshold so it only re-renders when `lead` crosses an integer (e.g. lift `lead` to Scene-level state flipped on scroll, like `figuresVisible`). Add that threshold ONLY when real images exist (documented in Task 9).

- [ ] **Step 2: Mount in Scene**

```tsx
import CardStack from "./CardStack";
```

```tsx
<CardStack galleryRef={galleryRef} reducedMotion={reducedMotion} />
```

(Place it after `GalleryTitles` inside the Canvas; the titles occupy the top/bottom, the cards the center.)

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: both succeed.

- [ ] **Step 4: Screenshot the stack + a fly-up**

```bash
node scripts/verify/shot.mjs --url http://localhost:5173 --gp 0.1,0.3,0.45 --out /tmp/gallery-stack --track 800 --wait 15000
```

Expected: 3 stacked gray cards (back ones peeking up-right) at `gp0.1`; a card mid-flight upward at an intermediate gp; the stack advanced/emptier toward `gp0.45`. Confirm the stack is centered, 3:2, sized ~64vh. Also run a portrait pass:

```bash
node scripts/verify/shot.mjs --url http://localhost:5173 --gp 0.1 --out /tmp/gallery-stack-portrait --track 800 --viewport 390x844 --wait 15000
```

Expected: cards 64vh tall, ~86vw wide (squeezed from 3:2).

- [ ] **Step 5: Commit**

```bash
git add src/components/CardStack.tsx src/components/Scene.tsx
git commit -m "feat(gallery): 3-card conveyor stack with cursor tilt + idle"
```

---

## Task 8: GalleryCTA (DOM overlay)

**Files:**
- Create: `src/components/GalleryCTA.tsx`
- Modify: `src/components/Scene.tsx` (render OUTSIDE the Canvas, as a sibling)
- Modify: `src/index.css` (CTA styles)
- Test: headless screenshot at the CTA frame + click → mailto

**Interfaces:**
- Consumes: `galleryCtaFor` from `src/gallery.ts`; `tiltTarget`, `approach`, `TILT_RATE` from `src/cursorTilt.ts`; `galleryRef`, `reducedMotion` from Scene.
- Produces: `<GalleryCTA galleryRef={...} reducedMotion={...} />` (a DOM overlay; not in the Canvas).

- [ ] **Step 1: Implement the DOM CTA**

Imperative updates via rAF (opacity from `galleryCtaFor`, CSS tilt from pointer) so it never forces React re-renders. `pointer-events` is enabled only when visible so it doesn't block the page elsewhere.

```tsx
import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import { galleryCtaFor } from "../gallery";
import { tiltTarget, approach, TILT_RATE } from "../cursorTilt";

interface Props {
  galleryRef: MutableRefObject<number>;
  reducedMotion?: boolean;
}

export default function GalleryCTA({ galleryRef, reducedMotion = false }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLAnchorElement>(null);
  const rotX = useRef(0);
  const rotY = useRef(0);
  const ptr = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      ptr.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      ptr.current.y = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener("pointermove", onMove);

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const delta = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      const op = galleryCtaFor(galleryRef.current);
      const wrap = wrapRef.current;
      const inner = innerRef.current;
      if (wrap) {
        wrap.style.opacity = String(op);
        wrap.style.pointerEvents = op > 0.5 ? "auto" : "none";
      }
      if (inner) {
        const tt = tiltTarget(ptr.current.x, ptr.current.y, reducedMotion);
        rotX.current = approach(rotX.current, tt.x, delta, TILT_RATE);
        rotY.current = approach(rotY.current, tt.y, delta, TILT_RATE);
        // radians → small degrees for CSS; X tilt is rotateX (pitch).
        const rx = (rotX.current * 180) / Math.PI;
        const ry = (rotY.current * 180) / Math.PI;
        inner.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, [galleryRef, reducedMotion]);

  return (
    <div ref={wrapRef} className="gallery-cta" aria-hidden={false}>
      <a ref={innerRef} className="gallery-cta__link" href="mailto:hi@deft.ch">
        «small call to action, yet to be worded.»
      </a>
    </div>
  );
}
```

- [ ] **Step 2: Add CTA styles**

Append to `src/index.css`:

```css
/* Gallery CTA — DOM overlay above the fixed canvas, shown only on the final
   gallery frame (opacity driven imperatively from gallery progress). */
.gallery-cta {
    position: fixed;
    inset: 0;
    z-index: 2; /* above .canvas-layer (z-index 1), below the loader (3) */
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    pointer-events: none;
    perspective: 800px;
}

.gallery-cta__link {
    width: 50vmin;
    text-align: center;
    color: #ffffff;
    text-decoration: none;
    font-family: "Arial Narrow", "Helvetica Neue Condensed", Arial, sans-serif;
    font-weight: 700;
    font-size: 4vmin;
    line-height: 1.15;
    transform-style: preserve-3d;
    will-change: transform;
}
```

- [ ] **Step 3: Render it in Scene (outside the Canvas)**

In `src/components/Scene.tsx`, add the import and render `GalleryCTA` as a sibling of `.canvas-layer` (NOT inside `<Canvas>`), before the scroll-track spacer:

```tsx
import GalleryCTA from "./GalleryCTA";
```

```tsx
      </div>
      <GalleryCTA galleryRef={galleryRef} reducedMotion={reducedMotion} />
      {/* Scroll-track spacer ... */}
```

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: both succeed.

- [ ] **Step 5: Screenshot the CTA + confirm the link**

```bash
node scripts/verify/shot.mjs --url http://localhost:5173 --gp 0.95 --out /tmp/gallery-cta --track 800 --wait 15000
```

Expected: centered white CTA text (~50vmin wide) on black, cards/titles gone. Confirm the anchor's `href` is `mailto:hi@deft.ch`:

```bash
node -e "(async()=>{const p=require('puppeteer-core');const b=await p.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader-webgl']});const pg=await b.newPage();await pg.goto('http://localhost:5173',{waitUntil:'load'});await new Promise(r=>setTimeout(r,15000));const href=await pg.\$eval('.gallery-cta__link',a=>a.getAttribute('href'));console.log('href=',href);await b.close();})()"
```

Expected: `href= mailto:hi@deft.ch`.

- [ ] **Step 6: Commit**

```bash
git add src/components/GalleryCTA.tsx src/index.css src/components/Scene.tsx
git commit -m "feat(gallery): DOM CTA overlay (mailto, cursor tilt, fade-in)"
```

---

## Task 9: Reduced motion, full sweep, and verification

**Files:**
- Modify: `scripts/check-playback.ts` (no new code if Tasks 1/5 cover it — just confirm it passes)
- Verify only (no new components)

**Interfaces:** none new.

- [ ] **Step 1: Confirm reduced-motion behavior**

The gallery components already take `reducedMotion`: `GalleryTitles` skips smoothing; `CardStack` and `GalleryCTA` pass it to `tiltTarget`/`idleTilt` (⇒ no tilt/idle). Verify with an emulated reduced-motion screenshot sweep:

```bash
node scripts/verify/shot.mjs --url http://localhost:5173 --gp 0.1,0.45,0.76,0.95 --out /tmp/gallery-rm --track 800 --wait 15000 --reduced-motion
```

If `shot.mjs` lacks a `--reduced-motion` flag, add it (mirror the memory's `page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }])`). Expected: titles/cards/CTA all reachable and statically posed (no drift); content identical in structure to the normal pass.

- [ ] **Step 2: Full timeline regression — animation phase unchanged**

```bash
node scripts/verify/shot.mjs --url http://localhost:5173 --sp 0,0.17,0.3,0.5,0.63,0.8,1 --out /tmp/anim-regress --track 800 --wait 15000
```

Expected: the intro/figures/video frames look exactly as before this work (the gallery is additive; `sp=1` is the held video last frame). Compare against `git stash` + a baseline run if in doubt.

- [ ] **Step 3: Full gallery sweep**

```bash
node scripts/verify/shot.mjs --url http://localhost:5173 --gp 0,0.06,0.39,0.52,0.76,0.82,0.95,1 --out /tmp/gallery-sweep --track 800 --wait 15000
```

Expected progression: held video → black → frame 1 (cards) → frame 2 → frame 3 → cards emptying → CTA fading → CTA. Confirm 3% gutters, 8vh/16vh title bands, 64vh card stack throughout.

- [ ] **Step 4: Run all checks**

Run: `npx tsx scripts/check-playback.ts && npm run typecheck && npm run build`
Expected: `✓ gallery timeline`, `✓ cursor tilt`, all existing checks pass; typecheck clean; build succeeds.

- [ ] **Step 5: Stray dev-server cleanup**

Run: `lsof -nP -iTCP:5173-5180 -sTCP:LISTEN` and kill any stray `npm run dev` servers left by verification.

- [ ] **Step 6: Commit (if any harness flags were added)**

```bash
git add scripts/verify/shot.mjs
git commit -m "test(gallery): reduced-motion + full sweep harness flags"
```

---

## Notes for the implementer

- **When real gallery images arrive:** replace the `null`s in `GALLERY_IMAGES` (`src/gallery.ts`) with URLs relative to `BASE_URL` (e.g. `"gallery/photo-1.jpg"`) and drop the files in `public/gallery/`. If image-index churn becomes visible (distinct photos swapping per frame), lift the conveyor `lead` to Scene-level state flipped only on integer crossings (mirror `figuresVisible` in `Scene.tsx`) and pass the resolved index down, so `GalleryCard` re-renders only on a real swap. No other changes needed.
- **Tuning is expected:** `GALLERY_TRACK_VH` (scroll length), the gp partition (`BACKDROP_FADE_END`/`TITLES_END`/`CTA_START`/`CTA_FADE`), `SLOT_OFFSETS` (stack look), and the fly-up lift factor (`1.5`) are all visual dials — adjust against the screenshots, then re-run `check-playback.ts` (the assertions are written to tolerate retuning of values, not structure).
- **Do not** touch `playback.ts`, `arc.ts`, `ArcModel`, `LottiePlane`'s scrub/`PADDING_RATIO`, or `VideoPlane`.
```
