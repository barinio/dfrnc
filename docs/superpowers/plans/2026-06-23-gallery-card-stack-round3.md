# Gallery Card Stack — Round 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-align the gallery card stack to the PDF mockups (full size + top-right peek), scope the hover effect to the front card only (clamped clear of the titles), and re-phase the card exits so a card leaves at the *end* of each title text display, ending on a synchronized title fade-out → CTA.

**Architecture:** Pure timing/layout functions live in `src/gallery.ts` (unit-asserted in `scripts/check-playback.ts`); the per-frame R3F behavior lives in `src/components/CardStack.tsx` and `src/components/GalleryTitles.tsx` (verified by typecheck + build + headless screenshots). The discrete-step swiper from round 1 and the `gp` partition are unchanged; only the conveyor's *input window*, the per-depth card placement, the hover scope, and a new title-opacity envelope change.

**Tech Stack:** React + @react-three/fiber + three.js, lottie-web (titles), TypeScript, Vite. No unit-test runner — verification is `npm run typecheck`, `npm run build`, `npx tsx scripts/check-playback.ts` (pure-function asserts), and `scripts/verify/shot.mjs` headless screenshots.

## Global Constraints

Copied verbatim from `docs/superpowers/specs/2026-06-23-gallery-card-swiper-design.md` (round 3). Every task's requirements implicitly include these.

- **Size:** front card is full **64vh tall**, 3:2 → **96vh wide** at aspect ≥ 1:1; at aspect < 1:1 it stays 64vh tall and tracks the viewport at **86vw**; capped at **16:9** (letterbox beyond). Corner radius **2.5vh**. Band anchor (`bandOffsetY`, band centre at 46vh from top) is **unchanged**.
- **Peek:** back cards offset **right and up** (top-right peek), slightly smaller; 3 cards visible, distribution repeats every 3. The topmost back card must stay within the **3vmin** top gutter (never touch the top title).
- **Hover:** parallax tilt + a **small** scale (`HOVER_SCALE ≈ 1.03`) on the **front card only** (slot 0). Hovering a back card does nothing. The front card's excursion is **clamped** so even at max tilt/scale it cannot enter either title band.
- **Exits:** mechanic unchanged — **1 scroll step = one front card flies up** (discrete swiper); image count stays flexible/drop-in. The conveyor **trails** the title scrub so a card leaves at the **end** of each text display. The **first** card lingers through the title grow-in. The **last** card flies up together with a new title **fade-out** (opacity 1→0), finishing by `CTA_START`; the CTA then fades in.
- **Reduced motion:** no hover tilt/scale; titles/cards still scrub with scroll; title opacity is a direct function of `gp` (no smoothing needed). Everything reachable by scroll.
- **Verification:** `npm run typecheck` + `npm run build` pass; `npx tsx scripts/check-playback.ts` prints `check-playback: all assertions passed`; headless screenshots judged by **structure** (the scene has animated noise/gradient — never pixel-diff).

### Screenshot preconditions (used by Tasks 2–5)

Visual steps drive a running dev server with the committed harness. Once per session:

```bash
cd /Users/ivan/Downloads/DFRNC
npm i puppeteer-core tsx --no-save          # deliberately NOT in package.json
npm run dev                                  # note the port (e.g. 5173); leave running
lsof -nP -iTCP:5173-5180 -sTCP:LISTEN        # later: find & kill stray servers
```

`shot.mjs` reaches **gallery** positions with `--gp` (scrolls beyond the 800vh animation track). Headless software rendering is slow — use `--wait 14000`. Example:

```bash
node scripts/verify/shot.mjs --url http://localhost:5173 --gp 0.4,0.78,0.85 \
  --out /tmp/r3 --track 800 --wait 14000 --viewport 1280x800
```

Output files are named `gp0_4.png`, `gp0_78.png`, etc. View them with the Read tool.

---

### Task 1: Retimed fly window + title fade-out (pure functions in `gallery.ts`)

**Files:**
- Modify: `src/gallery.ts` (add 4 constants + 2 functions after the existing `gp` partition / functions)
- Test: `scripts/check-playback.ts` (add asserts inside the existing `// ── Gallery timeline ──` block, ~line 274, before `console.log("✓ gallery timeline")`)

**Interfaces:**
- Produces:
  - `CARDS_FLY_START: number`, `CARDS_FLY_END: number` — the retimed conveyor window (gp).
  - `TITLES_FADE_START: number`, `TITLES_FADE_END: number` — the title fade-out window (gp).
  - `cardFlyProgressFor(gp: number): number` — 0 at `CARDS_FLY_START`, 1 at `CARDS_FLY_END`, clamped. Drives the discrete swiper's `target = Math.round(cardFlyProgressFor(gp) * N)` (Task 4).
  - `galleryTitleOpacityFor(gp: number): number` — 1 until `TITLES_FADE_START`, smooth to 0 by `TITLES_FADE_END` (Task 2).
- Consumes: existing `clamp01`, `smoothstep`, `BACKDROP_FADE_END`, `TITLES_END`, `CTA_START` from the same file.

- [ ] **Step 1: Write the failing asserts** in `scripts/check-playback.ts`.

First extend the import from `../src/gallery` (the existing block at lines 23–33) to add the new symbols:

```ts
import {
  galleryProgressFrom,
  galleryBackdropFor,
  galleryTitleFracFor,
  galleryTitleOpacityFor,
  cardConveyorFor,
  cardFlyProgressFor,
  galleryCtaFor,
  GALLERY_IMAGES,
  BACKDROP_FADE_END,
  TITLES_END,
  CARDS_FLY_START,
  CARDS_FLY_END,
  TITLES_FADE_START,
  TITLES_FADE_END,
  CTA_START,
} from "../src/gallery";
```

Then add these asserts just before `console.log("✓ gallery timeline");` (inside the same `{ … }` block, so `N` is in scope):

```ts
  // Round 3 — retimed fly window: 0 through the first-card linger, 1 by fly end.
  eq(cardFlyProgressFor(CARDS_FLY_START), 0, "fly progress 0 at fly start");
  eq(cardFlyProgressFor(0.15), 0, "fly progress 0 during the first-card linger");
  eq(cardFlyProgressFor(CARDS_FLY_END), 1, "fly progress 1 by fly end");
  ok(cardFlyProgressFor(0.5) > cardFlyProgressFor(0.35), "fly progress monotonic");
  // First card has flown by the time text 1 is readable (title frac ≈ 0.5).
  {
    const gpText1 = BACKDROP_FADE_END + 0.5 * (TITLES_END - BACKDROP_FADE_END);
    ok(Math.round(cardFlyProgressFor(gpText1) * N) >= 1, "first card gone once text 1 readable");
  }
  // Round 3 — title fade-out: opaque while read, fully faded by the CTA.
  eq(galleryTitleOpacityFor(TITLES_FADE_START), 1, "titles opaque until fade start");
  eq(galleryTitleOpacityFor(TITLES_FADE_END), 0, "titles fully faded by fade end");
  eq(galleryTitleOpacityFor(CTA_START), 0, "titles gone by CTA start");
  ok(galleryTitleOpacityFor(0.79) < galleryTitleOpacityFor(0.77), "title opacity fades monotonically");
  // Ordering of the round-3 windows.
  ok(BACKDROP_FADE_END < CARDS_FLY_START && CARDS_FLY_START < TITLES_END, "fly start sits inside the card phase");
  ok(TITLES_END <= TITLES_FADE_START && TITLES_FADE_START < TITLES_FADE_END, "title fade comes after the scrub");
  ok(TITLES_FADE_END <= CTA_START && CARDS_FLY_END <= CTA_START, "title fade + last card finish by the CTA");
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx scripts/check-playback.ts`
Expected: FAIL — `cardFlyProgressFor`/`galleryTitleOpacityFor` are not exported yet (TypeError / import error before the success line prints).

- [ ] **Step 3: Implement the constants + functions** in `src/gallery.ts`.

Add the constants next to the existing partition constants (after the `CTA_FADE` line, ~line 43):

```ts
// ── Round 3 retiming ─────────────────────────────────────────────────────────
// The card conveyor TRAILS the title scrub so a card leaves at the END of each
// text display. The first card lingers through the title grow-in; the last card
// flies up together with the title fade-out, finishing by CTA_START. Tuning
// dials — feel is judged in-browser.
export const CARDS_FLY_START = 0.22; // first card holds until here (title still growing in)
export const CARDS_FLY_END = CTA_START; // last card gone by the CTA
export const TITLES_FADE_START = 0.76; // last text holds [TITLES_END, here], then fades
export const TITLES_FADE_END = CTA_START; // titles fully gone as the CTA takes over
```

Add the two functions next to the other `gp` functions (e.g. after `cardConveyorFor`, ~line 83):

```ts
// Retimed fly progress for the discrete-step swiper (round 3). 0 through the
// first-card linger window, 1 by CARDS_FLY_END — so the swiper's rounded target
// (= round(this · N)) advances later than the continuous title scrub.
export function cardFlyProgressFor(gp: number): number {
  return clamp01((gp - CARDS_FLY_START) / (CARDS_FLY_END - CARDS_FLY_START));
}

// Title-plane opacity: 1 while the final text is read, then fades to 0 over
// [TITLES_FADE_START, TITLES_FADE_END] — coincident with the last card flying
// up. The CTA then owns the frame (the titles must not show behind it).
export function galleryTitleOpacityFor(gp: number): number {
  return 1 - smoothstep(clamp01((gp - TITLES_FADE_START) / (TITLES_FADE_END - TITLES_FADE_START)));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx scripts/check-playback.ts`
Expected: PASS — prints `✓ gallery timeline` and finally `check-playback: all assertions passed`.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/gallery.ts scripts/check-playback.ts
git commit -m "feat(gallery): retimed card-fly window + title fade-out (round 3)"
```

---

### Task 2: Title fade-out in `GalleryTitles.tsx`

**Files:**
- Modify: `src/components/GalleryTitles.tsx` (import the new function; add a material ref; drive opacity per frame; make the material transparent)

**Interfaces:**
- Consumes: `galleryTitleOpacityFor(gp: number): number` from Task 1.
- Produces: nothing for later tasks (purely visual).

- [ ] **Step 1: Import the function** — extend the existing import on line 8:

```ts
import { galleryTitleFracFor, galleryTitleOpacityFor, GUTTER, MAX_ASPECT } from "../gallery";
```

- [ ] **Step 2: Add a material ref** — next to the other refs (after `const smoothRef = useRef<number>(-1);`, ~line 28):

```ts
  const matRef = useRef<THREE.MeshBasicMaterial | null>(null);
```

- [ ] **Step 3: Drive opacity each frame** — at the end of the `useFrame` callback (after the `anim.goToAndStop(...)` / `needsUpdate` block, ~line 104, still inside `useFrame`):

```ts
    if (matRef.current) matRef.current.opacity = galleryTitleOpacityFor(galleryRef.current);
```

- [ ] **Step 4: Make the material transparent + wire the ref** — replace the returned mesh's material (line 125):

```tsx
      <meshBasicMaterial ref={matRef} map={texture} toneMapped={false} transparent alphaTest={0.1} />
```

- [ ] **Step 5: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: both succeed, no errors.

- [ ] **Step 6: Screenshot-verify the fade** (dev server running — see preconditions)

Run:
```bash
node scripts/verify/shot.mjs --url http://localhost:5173 --gp 0.70,0.79,0.86 \
  --out /tmp/r3-titles --track 800 --wait 14000 --viewport 1280x800
```
Expected (judge structure): `gp0_7.png` shows the `UND DIE / GANZ GROSSEN BILDER` title fully visible; `gp0_79.png` shows it partially faded (dimmer); `gp0_86.png` shows the titles gone and the centered `«small call to action…»` CTA visible on black.

- [ ] **Step 7: Commit**

```bash
git add src/components/GalleryTitles.tsx
git commit -m "feat(gallery): fade the titles out into the CTA (round 3)"
```

---

### Task 3: Full-size cards + top-right peek in `CardStack.tsx`

**Files:**
- Modify: `src/components/CardStack.tsx` (`CARD_FILL`, `STOPS`, `depthState`, the slot-placement line)

**Interfaces:**
- Consumes: existing `cardW`, `cardH` (the per-card world size already computed in the `useMemo`); `GALLERY_IMAGES`, `CARDS_VH`, etc.
- Produces: a `depthState(d)` that now returns `{ x, y, scale, z, opacity }` (adds `x`) — used only within this file.

- [ ] **Step 1: Full size** — set `CARD_FILL` to 1.0 (line 22). Update the comment to match:

```ts
// The card now fills its full 64vh layout band (no shrink): hover stays clear of
// the titles via the clamp in this file, not by rendering smaller. Tuning dial.
const CARD_FILL = 1.0;
```

- [ ] **Step 2: Top-right peek `STOPS`** — replace the `STOPS` array (lines 41–46). `x` is a fraction of card width (right), `y` a fraction of card height (up):

```ts
// Per-depth resting placement. Cards peek UP and to the RIGHT (the PDF stack):
// each one behind is a touch smaller and offset +x/+y so its top-right corner
// shows behind the front. d = 3 is the entering card that fades in.
const STOPS = [
  { x: 0.0, y: 0.0, scale: 1.0, z: 0.0 }, // d0 — front
  { x: 0.035, y: 0.03, scale: 0.97, z: -0.15 }, // d1 — back, peeks top-right
  { x: 0.07, y: 0.06, scale: 0.94, z: -0.3 }, // d2 — back, peeks more
  { x: 0.09, y: 0.075, scale: 0.92, z: -0.45 }, // d3 — entering (fades in)
];
```

- [ ] **Step 3: Add `x` to `depthState`** — replace the function (lines 53–68):

```ts
function depthState(d: number): { x: number; y: number; scale: number; z: number; opacity: number } {
  if (d < 0) {
    // Leaving front card rises straight up (x = 0) and fades out.
    return { x: 0, y: -d * RISE, scale: 1, z: 0, opacity: THREE.MathUtils.clamp(1 + d, 0, 1) };
  }
  const i = Math.min(Math.floor(d), STOPS.length - 2);
  const a = STOPS[i];
  const b = STOPS[i + 1];
  const f = THREE.MathUtils.clamp(d - i, 0, 1);
  const opacity = d <= 2 ? 1 : THREE.MathUtils.clamp(3 - d, 0, 1);
  return {
    x: THREE.MathUtils.lerp(a.x, b.x, f),
    y: THREE.MathUtils.lerp(a.y, b.y, f),
    scale: THREE.MathUtils.lerp(a.scale, b.scale, f),
    z: THREE.MathUtils.lerp(a.z, b.z, f),
    opacity,
  };
}
```

- [ ] **Step 4: Apply `x` when placing the slot** — replace the placement line (line 167) inside the slot loop:

```ts
      ref.position.set(st.x * cardW, st.y * cardH, st.z);
```

- [ ] **Step 5: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: both succeed.

- [ ] **Step 6: Screenshot-verify the layout** (dev server running)

Run:
```bash
node scripts/verify/shot.mjs --url http://localhost:5173 --gp 0.4 \
  --out /tmp/r3-layout --track 800 --wait 14000 --viewport 1280x800
```
Expected (`gp0_4.png`, judge structure): the front card fills the band (much larger than before — ~64vh tall, ~96vh wide, 3:2), back card(s) peek out at the **top-right**, and there is a clear gap between the card top and the `WIR LIEFERN` title (back card stays within the gutter, not touching the text).

- [ ] **Step 7: Commit**

```bash
git add src/components/CardStack.tsx
git commit -m "feat(gallery): full-size cards + top-right peek per the PDF (round 3)"
```

---

### Task 4: Re-time the swiper to the delayed fly window

**Files:**
- Modify: `src/components/CardStack.tsx` (import `cardFlyProgressFor`; change the `target` source — keep `span` for visibility/entrance)

**Interfaces:**
- Consumes: `cardFlyProgressFor(gp: number): number` from Task 1.
- Produces: nothing for later tasks.

Note: `cardConveyorFor(gp).span` still gates `group.visible` and the entrance lift (the phase window `[BACKDROP_FADE_END, CTA_START]`), so the first card is **visible** from the start of the gallery and simply does not fly until `CARDS_FLY_START`. Only the discrete `target` moves to the retimed window. `SlotCard`'s placeholder image index stays on `cardConveyorFor` — invisible for identical gray placeholders (real images would lift the lead to state, per the file's existing note).

- [ ] **Step 1: Import the function** — extend the import from `../gallery` (lines 6–14) by adding `cardFlyProgressFor`:

```ts
import {
  cardConveyorFor,
  cardFlyProgressFor,
  GALLERY_IMAGES,
  CARDS_VH,
  CARD_ASPECT,
  CARDS_WIDTH_VW_PORTRAIT,
  GUTTER,
  TOP_TITLE_VH,
} from "../gallery";
```

- [ ] **Step 2: Retime the target** — in `useFrame`, replace the target line (line 135). It currently reads `const target = Math.round(span * n);`:

```ts
    // Discrete slide index from the RETIMED fly window (round 3): the deck trails
    // the title scrub so a card leaves at the END of each text display. `span`
    // (above) still drives visibility + entrance over the full card phase.
    const target = Math.round(cardFlyProgressFor(gp) * n);
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: both succeed.

- [ ] **Step 4: Screenshot-verify the retiming** (dev server running; relies on Task 2's title fade for the finale)

Run:
```bash
node scripts/verify/shot.mjs --url http://localhost:5173 --gp 0.12,0.40,0.78,0.86 \
  --out /tmp/r3-retime --track 800 --wait 14000 --viewport 1280x800
```
Expected (judge structure):
- `gp0_12.png`: the stack is visible with the **first** card still on top (it has not flown — there is little/no title text yet).
- `gp0_4.png`: a later card is now on top (the deck has advanced as the text appeared).
- `gp0_78.png`: the **last** card is rising/leaving **while** the title fades (both exiting together).
- `gp0_86.png`: stack empty + CTA visible.

- [ ] **Step 5: Commit**

```bash
git add src/components/CardStack.tsx
git commit -m "feat(gallery): retime card exits to trail the title text (round 3)"
```

---

### Task 5: Hover parallax + small scale on the front card only, clamped clear of the titles

**Files:**
- Modify: `src/components/CardStack.tsx` (`HOVER_SCALE`, `HOVER_TILT_MAX`; compute `maxHoverScale` in the `useMemo`; move the hover transform from the whole group onto slot 0 with a settle factor + clamp)

**Interfaces:**
- Consumes: existing `bandOffsetY`, `cardH`, `viewport`, `hover`/`rotX`/`rotY` refs, `depthState`, `GUTTER`.
- Produces: nothing for later tasks.

- [ ] **Step 1: Smaller hover dials** — the card is now full-size, so the effect must be small. Replace lines 26–27:

```ts
const HOVER_SCALE = 1.03; // front card grows 1 → 1.03 on hover (small — full-size card)
const HOVER_TILT_MAX = 0.06; // ~3.4° max parallax tilt on hover (radians)
```

- [ ] **Step 2: Compute the title-clear scale clamp** in the `useMemo` (the block returning `{ cardW, cardH, bandOffsetY, ... }`, lines 103–118). Add the clamp and return it:

```ts
    // Max hover scale that keeps the (centre-scaled) front card clear of BOTH
    // title bands: its half-height may grow only into the 3vmin gutter, never to
    // the title text. (Tilt is kept small separately via HOVER_TILT_MAX.)
    const vmin = Math.min(vw, vh);
    const gutterWorld = GUTTER * vmin;
    const maxHoverScale = 1 + gutterWorld / (h / 2);
```

Then add `maxHoverScale` to the returned object and the destructure:

```ts
    return { cardW: w, cardH: h, bandOffsetY, hoverHalfX, hoverHalfY, hoverCenterY, maxHoverScale };
```
```ts
  const { cardW, cardH, bandOffsetY, hoverHalfX, hoverHalfY, hoverCenterY, maxHoverScale } = useMemo(() => {
```

- [ ] **Step 3: Move hover onto slot 0 (front card only), with a settle factor + clamp.** In `useFrame`, the hover math (compute `over`, ease `hover.current`, `rotX`/`rotY`) currently lives *after* the slot loop and applies to `group`. Restructure so the hover *amount* is computed **before** the slot loop and applied **inside** it for slot 0 only.

First, replace the post-loop hover block (lines 181–194 — from the `// Hover only:` comment through `group.rotation.y = rotY.current;`) with **amount-only** easing (no group transform):

```ts
    // Hover (front card only): ease the parallax tilt + scale AMOUNT here; it is
    // applied to slot 0 inside the loop. Back cards never react. The group keeps
    // only its entrance/position transform (set above).
    const px = ptr.current.x;
    const py = ptr.current.y;
    const over =
      !reducedMotion &&
      Math.abs(px) < hoverHalfX &&
      Math.abs(py - hoverCenterY) < hoverHalfY;
    hover.current = approach(hover.current, over ? 1 : 0, delta, HOVER_RATE);
    const relY = py - hoverCenterY;
    rotX.current = approach(rotX.current, -relY * HOVER_TILT_MAX * hover.current, delta, HOVER_RATE);
    rotY.current = approach(rotY.current, px * HOVER_TILT_MAX * hover.current, delta, HOVER_RATE);
    group.rotation.set(0, 0, 0);
    group.scale.setScalar(1);
```

This block must run **before** the slot loop (move it up so `hover.current`/`rotX`/`rotY` are ready when the loop places slot 0). Keep the existing entrance block (`group.position.y = …`) where it is.

- [ ] **Step 4: Apply the hover to slot 0 in the loop.** Replace the slot-placement body (lines 167–172, the `ref.position.set` / `ref.scale.setScalar` / opacity assignment) with:

```ts
      // Front card (slot 0) gets the hover tilt + small scale, faded out during a
      // swipe via `settle` so a leaving card isn't tilted. Back cards stay put.
      let hoverScale = 1;
      if (slot === 0) {
        const settle = 1 - THREE.MathUtils.clamp(local, 0, 1);
        const amt = hover.current * settle;
        hoverScale = Math.min(1 + (HOVER_SCALE - 1) * amt, maxHoverScale);
        ref.rotation.set(rotX.current * settle, rotY.current * settle, 0);
      } else {
        ref.rotation.set(0, 0, 0);
      }
      ref.position.set(st.x * cardW, st.y * cardH, st.z);
      ref.scale.setScalar(st.scale * hoverScale);
      const mesh = ref.children[0] as THREE.Mesh | undefined;
      const mat = mesh?.material as THREE.MeshBasicMaterial | undefined;
      if (mat) mat.opacity = st.opacity;
```

- [ ] **Step 5: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: both succeed.

- [ ] **Step 6: Verify the pure-function asserts still pass** (no regressions to the timeline)

Run: `npx tsx scripts/check-playback.ts`
Expected: `check-playback: all assertions passed`.

- [ ] **Step 7: Screenshot-verify hover scope + clamp.** The harness moves the pointer with `--mouse` if available; if not, verify the *resting/back-card* invariants and the geometry, which is what matters here (the clamp is a hard bound, not pointer-dependent).

Run:
```bash
node scripts/verify/shot.mjs --url http://localhost:5173 --gp 0.40 \
  --out /tmp/r3-hover --track 800 --wait 14000 --viewport 1280x800
node scripts/verify/shot.mjs --url http://localhost:5173 --gp 0.40 --reduced-motion \
  --out /tmp/r3-hover-rm --track 800 --wait 14000 --viewport 1280x800
```
Expected (judge structure): in both shots the front card sits in its band, back cards peek top-right and are **not** scaled/tilted, and the card does not overlap either title. (The reduced-motion shot must look identical w.r.t. layout — no tilt/scale applied.) Hover-on-pointer is judged live in `npm run dev` by hovering the front card (it tilts + grows slightly, never touching the titles) and a back card (nothing happens).

- [ ] **Step 8: Commit**

```bash
git add src/components/CardStack.tsx
git commit -m "feat(gallery): hover parallax + small scale on the front card only, clamped clear of the titles (round 3)"
```

---

## Self-Review

**1. Spec coverage** (round-3 spec → task):
- A. Full size (CARD_FILL→1.0, 64vh/96vh/86vw, radius 2.5vh, anchor unchanged) → Task 3 (radius is already proportional in `GalleryCard`, so unchanged). ✔
- A. Top-right peek (STOPS +x/+y, repeats every 3, within top gutter) → Task 3. ✔
- B+C. Hover front-card-only, small scale, clamp clear of both titles → Task 5. ✔
- D. Phase lag / leave at end of text display → Task 4 (`cardFlyProgressFor`). ✔
- D. First card lingers → Task 1 window + Task 4 (verified at gp 0.12). ✔
- D. Finale: last card up + title fade-out → CTA → Task 1 (`galleryTitleOpacityFor`) + Task 2 + Task 4. ✔
- Reduced motion (no hover; scrubbable) → Task 5 gates hover on `!reducedMotion` (existing `over` guard); title opacity is direct `gp` function. ✔
- Verification (typecheck/build/check-playback/screenshots) → every task. ✔
- Future N=3 note → explicitly out of scope; not a task. ✔

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". Every code step shows the actual code. ✔

**3. Type consistency:** `cardFlyProgressFor`/`galleryTitleOpacityFor` signatures match between Task 1 (definition), check-playback (Task 1), Task 2, and Task 4. `depthState` returns `{ x, y, scale, z, opacity }` in Task 3 and is read with `st.x`/`st.y`/`st.z`/`st.scale`/`st.opacity` in Tasks 3 & 5. `maxHoverScale` is added to the `useMemo` return and destructure together (Task 5). `CARDS_FLY_END`/`TITLES_FADE_END` reference `CTA_START` defined earlier in `gallery.ts`. ✔
