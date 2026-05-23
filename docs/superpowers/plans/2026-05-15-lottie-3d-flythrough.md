# Lottie + 3D Flythrough Site — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-page visual experience where a Lottie typography animation plays, freezes as a dark background, then a glassmorphism 3D model flies across the screen in a semicircular arc.

**Architecture:** Static HTML site with no build tool. Three separate JS modules handle Lottie playback, Three.js scene setup, and arc animation. A top-level `app.js` orchestrates the four phases: Lottie → freeze → flythrough → exit.

**Tech Stack:** Lottie Web (CDN), Three.js + GLTFLoader (CDN), GSAP (CDN), vanilla JS ES modules

---

## File Map

| File | Responsibility |
|------|---------------|
| `index.html` | HTML structure, CDN imports, CSS stacking layers |
| `src/lottie-player.js` | Load and play Lottie JSON, freeze last frame, return Promise on complete |
| `src/three-scene.js` | WebGLRenderer, camera, lights, GLB loading, model show/hide |
| `src/arc-animation.js` | QuadraticBezierCurve3 arc + GSAP t-value animation, model Y-rotation |
| `src/app.js` | Phase orchestrator: connects lottie-player → three-scene → arc-animation |
| `assets/animation.json` | Copy of `Untitled file.json` (Lottie animation) |
| `assets/model.glb` | Copy of `glasmorphizm-3d.glb` |

---

## Task 1: Project Scaffold

**Files:**
- Create: `index.html`
- Create: `assets/` directory with copied asset files

- [ ] **Step 1: Copy assets into project**

```bash
mkdir -p /Users/ivan/Downloads/DFRNC/assets
mkdir -p /Users/ivan/Downloads/DFRNC/src
cp "/Users/ivan/Downloads/DFRNC/Untitled file.json" /Users/ivan/Downloads/DFRNC/assets/animation.json
cp /Users/ivan/Downloads/DFRNC/glasmorphizm-3d.glb /Users/ivan/Downloads/DFRNC/assets/model.glb
```

- [ ] **Step 2: Create `index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DFRNC</title>
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

    html, body {
      width: 100%; height: 100%;
      background: #0a0a0a;
      overflow: hidden;
    }

    #lottie-layer, #three-layer {
      position: fixed;
      inset: 0;
      width: 100%;
      height: 100%;
    }

    #lottie-layer { z-index: 1; }

    #three-layer {
      z-index: 2;
      pointer-events: none;
      opacity: 0;
    }
  </style>
</head>
<body>
  <div id="lottie-layer"></div>
  <canvas id="three-layer"></canvas>

  <!-- CDN dependencies -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js"></script>
  <script async src="https://unpkg.com/es-module-shims@1.8.0/dist/es-module-shims.js"></script>
  <script type="importmap">
  {
    "imports": {
      "three": "https://unpkg.com/three@0.165.0/build/three.module.js",
      "three/addons/": "https://unpkg.com/three@0.165.0/examples/jsm/"
    }
  }
  </script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>

  <script type="module" src="src/app.js"></script>
</body>
</html>
```

- [ ] **Step 3: Verify scaffold in browser**

Open `index.html` in a browser (via a local server — e.g. `npx serve .` or VS Code Live Server).

Expected: solid black screen, no console errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/ivan/Downloads/DFRNC
git init
git add index.html assets/animation.json assets/model.glb
git commit -m "feat: project scaffold with assets and HTML structure"
```

---

## Task 2: Lottie Player Module

**Files:**
- Create: `src/lottie-player.js`

- [ ] **Step 1: Create `src/lottie-player.js`**

```js
// Plays the Lottie animation once and resolves when it completes.
// After complete, the last frame stays visible at reduced opacity.
export function playLottie(containerId, animationPath) {
  return new Promise((resolve) => {
    const container = document.getElementById(containerId);

    const anim = lottie.loadAnimation({
      container,
      renderer: 'canvas',
      loop: false,
      autoplay: true,
      path: animationPath,
      rendererSettings: {
        preserveAspectRatio: 'xMidYMid meet',
        clearCanvas: false,
      },
    });

    anim.addEventListener('complete', () => {
      // Freeze last frame — fade container to low opacity
      gsap.to(container, {
        opacity: 0.15,
        duration: 0.6,
        ease: 'power2.inOut',
        onComplete: resolve,
      });
    });
  });
}
```

- [ ] **Step 2: Create placeholder `src/app.js` to test Lottie**

```js
import { playLottie } from './lottie-player.js';

async function main() {
  await playLottie('lottie-layer', 'assets/animation.json');
  console.log('Lottie complete');
}

main();
```

- [ ] **Step 3: Verify Lottie in browser**

Open via local server. Expected:
- Typography animation plays for ~8.6 seconds
- After completion, text fades to ~15% opacity
- Console logs "Lottie complete"

- [ ] **Step 4: Commit**

```bash
git add src/lottie-player.js src/app.js
git commit -m "feat: lottie player with freeze-on-complete"
```

---

## Task 3: Three.js Scene Setup

**Files:**
- Create: `src/three-scene.js`

- [ ] **Step 1: Create `src/three-scene.js`**

```js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class ThreeScene {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    this.camera.position.set(0, 0, 8);

    // Lights — ambient + directional for glass chromatics
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    const directional = new THREE.DirectionalLight(0xffffff, 2.5);
    directional.position.set(3, 5, 3);
    this.scene.add(ambient, directional);

    this.model = null;
    this._animFrameId = null;

    window.addEventListener('resize', () => this._onResize());
  }

  // Preload GLB — call this during Lottie phase so it's ready immediately
  loadModel(path) {
    return new Promise((resolve, reject) => {
      const loader = new GLTFLoader();
      loader.load(
        path,
        (gltf) => {
          this.model = gltf.scene;
          this.model.visible = false;
          // Scale to fit nicely in scene
          const box = new THREE.Box3().setFromObject(this.model);
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          const scale = 1.5 / maxDim;
          this.model.scale.setScalar(scale);
          this.scene.add(this.model);
          resolve(this.model);
        },
        undefined,
        reject
      );
    });
  }

  // Calculate world-space viewport bounds at z=0 plane
  getViewportBounds() {
    const dist = this.camera.position.z;
    const vFov = (this.camera.fov * Math.PI) / 180;
    const height = 2 * Math.tan(vFov / 2) * dist;
    const width = height * this.camera.aspect;
    return { width, height };
  }

  showModel() {
    if (this.model) this.model.visible = true;
    this.canvas.style.opacity = '1';
    this._startRenderLoop();
  }

  hideModel() {
    if (this.model) this.model.visible = false;
  }

  _startRenderLoop() {
    const tick = () => {
      this._animFrameId = requestAnimationFrame(tick);
      this.renderer.render(this.scene, this.camera);
    };
    tick();
  }

  stopRenderLoop() {
    if (this._animFrameId) cancelAnimationFrame(this._animFrameId);
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
```

- [ ] **Step 2: Update `src/app.js` to verify model loads**

```js
import { playLottie } from './lottie-player.js';
import { ThreeScene } from './three-scene.js';

async function main() {
  const scene = new ThreeScene('three-layer');

  // Preload model while Lottie plays
  const modelPromise = scene.loadModel('assets/model.glb');

  await playLottie('lottie-layer', 'assets/animation.json');
  await modelPromise;

  // Temporarily show model at center to verify it loaded
  scene.model.position.set(0, 0, 0);
  scene.showModel();
  console.log('Model visible at center');
}

main();
```

- [ ] **Step 3: Verify Three.js scene in browser**

Open via local server. Expected:
- Lottie plays and fades
- 3D model appears at screen center over the frozen text
- Model is visible, no console errors about GLB loading

- [ ] **Step 4: Commit**

```bash
git add src/three-scene.js src/app.js
git commit -m "feat: three.js scene with GLB loader and resize handler"
```

---

## Task 4: Arc Animation

**Files:**
- Create: `src/arc-animation.js`

- [ ] **Step 1: Create `src/arc-animation.js`**

```js
import * as THREE from 'three';

// Animates model along a quadratic bezier arc:
// bottom-left → center-top → bottom-right
// Also rotates model around Y-axis during flight.
// Returns a Promise that resolves when animation + fade-out complete.
export function flyArc(scene, duration = 3.5) {
  return new Promise((resolve) => {
    const { model, canvas } = scene;
    const { width, height } = scene.getViewportBounds();

    const start  = new THREE.Vector3(-width / 2,  -height / 2, 0);
    const peak   = new THREE.Vector3(0,             height * 0.4, 0);
    const end    = new THREE.Vector3( width / 2,  -height / 2, 0);

    const curve = new THREE.QuadraticBezierCurve3(start, peak, end);

    const proxy = { t: 0, rotY: 0 };

    gsap.to(proxy, {
      t: 1,
      rotY: Math.PI * 1.5,   // 1.5 full rotations during flight
      duration,
      ease: 'power2.inOut',
      onUpdate() {
        const pos = curve.getPoint(proxy.t);
        model.position.copy(pos);
        model.rotation.y = proxy.rotY;
      },
      onComplete() {
        // Fade out canvas after reaching end point
        gsap.to(canvas, {
          opacity: 0,
          duration: 0.4,
          ease: 'power1.in',
          onComplete: resolve,
        });
      },
    });
  });
}
```

- [ ] **Step 2: Update `src/app.js` with full phase sequence**

```js
import { playLottie } from './lottie-player.js';
import { ThreeScene } from './three-scene.js';
import { flyArc } from './arc-animation.js';

async function main() {
  const scene = new ThreeScene('three-layer');

  // Phase 1: Lottie plays; preload model concurrently
  const modelPromise = scene.loadModel('assets/model.glb');
  await playLottie('lottie-layer', 'assets/animation.json');

  // Phase 2: Ensure model is ready, position at arc start (hidden)
  await modelPromise;
  const { width, height } = scene.getViewportBounds();
  scene.model.position.set(-width / 2, -height / 2, 0);

  // Phase 3: Show Three.js canvas and fly the arc
  scene.showModel();
  await flyArc(scene, 3.5);

  // Phase 4: Done — canvas faded out, Lottie background remains
  scene.stopRenderLoop();
}

main();
```

- [ ] **Step 3: Verify full sequence in browser**

Open via local server. Expected:
- Lottie plays (~8.6s) then freezes at low opacity
- 3D model appears at bottom-left
- Model flies a smooth semicircular arc over the text
- Model slowly rotates during flight
- Model fades out on reaching bottom-right
- Frozen Lottie text remains on black background
- No console errors

- [ ] **Step 4: Commit**

```bash
git add src/arc-animation.js src/app.js
git commit -m "feat: arc animation with quadratic bezier and model rotation"
```

---

## Task 5: Polish

**Files:**
- Modify: `src/three-scene.js` — add extra point light for chromatic highlights
- Modify: `index.html` — add `.gitignore` for node_modules if needed

- [ ] **Step 1: Add a second light to enhance glassmorphism effect**

In `src/three-scene.js`, after the `directional` light setup, add:

```js
const rimLight = new THREE.PointLight(0x8ab4f8, 3, 20);
rimLight.position.set(-4, 2, 4);
this.scene.add(rimLight);
```

- [ ] **Step 2: Add `tone mapping` for better glass rendering**

In the `ThreeScene` constructor, after `this.renderer.setSize(...)`:

```js
this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
this.renderer.toneMappingExposure = 1.2;
this.renderer.outputColorSpace = THREE.SRGBColorSpace;
```

- [ ] **Step 3: Verify polish in browser**

Open via local server. Check:
- Glass model shows iridescent/chromatic highlights
- No visible color banding
- Looks similar in quality to `ref_1.jpeg` reference

- [ ] **Step 4: Commit**

```bash
git add src/three-scene.js
git commit -m "feat: enhanced lighting for glassmorphism chromatic effect"
```

---

## Self-Review Notes

- All four phases from the spec are covered: Tasks 2 (Lottie) → 3 (Three.js) → 4 (Arc) → 4 (Exit)
- `getViewportBounds()` is defined in Task 3 and used in Tasks 4 and 4 app.js — names match
- `scene.canvas` is referenced in `arc-animation.js` — it is a public property set in Task 3's constructor ✓
- `scene.model` is set after `loadModel()` resolves — `app.js` awaits `modelPromise` before accessing it ✓
- Responsive resize handled in `ThreeScene._onResize()` — arc bounds recalculated per `getViewportBounds()` which reads live camera state ✓
- No TBD or TODO placeholders
