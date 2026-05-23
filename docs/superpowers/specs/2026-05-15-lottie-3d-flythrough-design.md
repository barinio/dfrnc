# Lottie + 3D Flythrough Site — Design Spec
**Date:** 2026-05-15

## Overview

A single-page visual experience: a Lottie typography animation plays to completion, its last frame remains frozen as a dark background, then a glassmorphism 3D model flies across the screen in a semicircular arc from bottom-left to bottom-right.

---

## File Structure

```
/
├── index.html
└── assets/
    ├── Untitled file.json   ← Lottie animation (TYPO layer, 30fps, ~8.6s)
    └── glasmorphizm-3d.glb  ← 3D glassmorphism model
```

No build tool. No framework. Opens directly in a browser or deploys to any static host.

**CDN dependencies:**
- `lottie-web` — Lottie player
- `three.js` — WebGL renderer
- `GLTFLoader` (Three.js addon) — loads the GLB
- `gsap` + `MotionPathPlugin` — arc animation

---

## Visual Design

- **Background:** `#0a0a0a` (near-black)
- **Lottie layer:** full-screen, white typography on black
- **After Lottie:** last frame stays, opacity drops to ~0.15 (readable but not dominant)
- **3D layer:** transparent canvas layered on top, glassmorphism model with iridescent chrome material

---

## Sequence & Timing

| Phase | Duration | Description |
|-------|----------|-------------|
| 1. Lottie | ~8.6s | Animation plays once, full-screen |
| 2. Transition | 0.6s | Lottie fades to 0.15 opacity, Three.js canvas appears |
| 3. Flythrough | ~3.5s | Model flies the arc, slowly rotating |
| 4. Exit | 0.4s | Model fades out at bottom-right, Lottie background remains |

GLB is preloaded during Phase 1 to avoid any delay at Phase 2.

---

## Architecture

### CSS Stacking (z-index)

```
position: fixed; inset: 0
├── #lottie-layer   z-index: 1   — Lottie canvas
└── #three-layer    z-index: 2   — Three.js canvas, pointer-events: none
```

### Three.js Scene

- `WebGLRenderer({ alpha: true, antialias: true })`
- `PerspectiveCamera` — fixed, looking straight at the scene
- `AmbientLight` (low intensity) + `DirectionalLight` (angled) — makes the glass chromatics play
- Model loaded via `GLTFLoader`, hidden (`visible: false`) until Phase 3

### GSAP Arc Trajectory

Quadratic Bezier from bottom-left to bottom-right with peak at center-top:

```js
gsap.to(model.position, {
  motionPath: {
    path: [
      { x: -viewportWidth/2,  y: -viewportHeight/2 },
      { x: 0,                  y: viewportHeight * 0.3 },
      { x: viewportWidth/2,   y: -viewportHeight/2 }
    ],
    type: "quadratic"
  },
  duration: 3.5,
  ease: "power2.inOut"
})
```

Model also rotates slowly around its Y-axis during the flight.

### Responsiveness

`window.resize` handler updates renderer size and camera aspect ratio. Same logic applies on mobile — viewport dimensions drive all positioning.

---

## End State

After the model exits bottom-right and fades out, the page rests: frozen Lottie text at low opacity on black. No loop. No restart. Static.
