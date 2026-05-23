# TypeScript Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert all `.jsx`/`.js` source files to `.tsx`/`.ts` with full strict TypeScript coverage.

**Architecture:** Add TypeScript devDependencies + three tsconfig files (root / app / node), then rename and type each source file one at a time, verifying `tsc -b` passes after each task.

**Tech Stack:** TypeScript 5, `@types/react`, `@types/react-dom` — Three.js, R3F, drei, lottie-react all ship their own types.

---

## File Map

| Before | After | Change |
|--------|-------|--------|
| `vite.config.js` | `vite.config.ts` | rename only |
| `src/main.jsx` | `src/main.tsx` | rename + typed root call |
| `src/App.jsx` | `src/App.tsx` | rename only (no new types needed) |
| `src/components/LottieOverlay.jsx` | `src/components/LottieOverlay.tsx` | rename + `useState<number>` |
| `src/components/Scene.jsx` | `src/components/Scene.tsx` | rename + typed props/refs |
| `src/components/ArcModel.jsx` | `src/components/ArcModel.tsx` | rename + interface + typed refs/useFrame |
| *(new)* | `src/vite-env.d.ts` | Vite client type reference |
| *(new)* | `tsconfig.json` | root project references |
| *(new)* | `tsconfig.app.json` | app source config |
| *(new)* | `tsconfig.node.json` | vite.config.ts config |

---

## Task 1: Install TypeScript deps + create tsconfig files

**Files:**
- Modify: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.app.json`
- Create: `tsconfig.node.json`

- [ ] **Step 1: Install TypeScript and React type packages**

```bash
cd /Users/ivan/Downloads/DFRNC
npm install -D typescript @types/react @types/react-dom
```

Expected: packages added, no errors.

- [ ] **Step 2: Create `tsconfig.json` (root — references the other two)**

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

- [ ] **Step 3: Create `tsconfig.app.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 5: Update `package.json` scripts — add `typecheck`, update `build`**

```json
"scripts": {
  "dev": "vite",
  "build": "tsc -b && vite build",
  "typecheck": "tsc -b",
  "preview": "vite preview"
}
```

- [ ] **Step 6: Commit**

```bash
git add tsconfig.json tsconfig.app.json tsconfig.node.json package.json package-lock.json
git commit -m "chore: add TypeScript toolchain and tsconfig"
```

---

## Task 2: Add vite-env.d.ts + rename vite.config

**Files:**
- Create: `src/vite-env.d.ts`
- Rename: `vite.config.js` → `vite.config.ts`

- [ ] **Step 1: Create `src/vite-env.d.ts`**

```typescript
/// <reference types="vite/client" />
```

- [ ] **Step 2: Rename vite config**

```bash
mv /Users/ivan/Downloads/DFRNC/vite.config.js /Users/ivan/Downloads/DFRNC/vite.config.ts
```

Content of `vite.config.ts` stays identical:

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
```

- [ ] **Step 3: Verify node tsconfig type-checks the vite config**

```bash
cd /Users/ivan/Downloads/DFRNC && npx tsc -p tsconfig.node.json --noEmit
```

Expected: exits with code 0, no output.

- [ ] **Step 4: Commit**

```bash
git add src/vite-env.d.ts vite.config.ts
git rm vite.config.js
git commit -m "chore: add vite-env.d.ts, rename vite.config to .ts"
```

---

## Task 3: Convert main.tsx + App.tsx

**Files:**
- Rename: `src/main.jsx` → `src/main.tsx`
- Rename: `src/App.jsx` → `src/App.tsx`

- [ ] **Step 1: Rename and write `src/main.tsx`**

```bash
mv /Users/ivan/Downloads/DFRNC/src/main.jsx /Users/ivan/Downloads/DFRNC/src/main.tsx
```

Full content of `src/main.tsx` (unchanged except the cast on `getElementById`):

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

The `!` non-null assertion on `getElementById('root')` is safe — the element is guaranteed by `index.html`.

- [ ] **Step 2: Rename `src/App.jsx` → `src/App.tsx`**

```bash
mv /Users/ivan/Downloads/DFRNC/src/App.jsx /Users/ivan/Downloads/DFRNC/src/App.tsx
```

Content stays identical — no new types needed (no props, no state).

- [ ] **Step 3: Run type-check**

```bash
cd /Users/ivan/Downloads/DFRNC && npx tsc -b --noEmit
```

Expected: exits with code 0.

- [ ] **Step 4: Commit**

```bash
git add src/main.tsx src/App.tsx
git rm src/main.jsx src/App.jsx
git commit -m "chore: rename main + App to .tsx"
```

---

## Task 4: Convert LottieOverlay.tsx

**Files:**
- Rename: `src/components/LottieOverlay.jsx` → `src/components/LottieOverlay.tsx`

- [ ] **Step 1: Rename and write `src/components/LottieOverlay.tsx`**

```bash
mv /Users/ivan/Downloads/DFRNC/src/components/LottieOverlay.jsx \
   /Users/ivan/Downloads/DFRNC/src/components/LottieOverlay.tsx
```

Full content:

```tsx
import { useState } from 'react'
import Lottie from 'lottie-react'
import animationData from '../assets/animation.json'

export default function LottieOverlay() {
  const [opacity, setOpacity] = useState<number>(1)

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1,
        opacity,
        transition: 'opacity 0.6s ease-in-out',
      }}
    >
      <Lottie
        animationData={animationData}
        loop={false}
        onComplete={() => setOpacity(0.15)}
        style={{ width: '100%', height: '100%' }}
        rendererSettings={{ preserveAspectRatio: 'xMidYMid meet' }}
      />
    </div>
  )
}
```

- [ ] **Step 2: Run type-check**

```bash
cd /Users/ivan/Downloads/DFRNC && npx tsc -b --noEmit
```

Expected: exits with code 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/LottieOverlay.tsx
git rm src/components/LottieOverlay.jsx
git commit -m "chore: convert LottieOverlay to TypeScript"
```

---

## Task 5: Convert Scene.tsx

**Files:**
- Rename: `src/components/Scene.jsx` → `src/components/Scene.tsx`

- [ ] **Step 1: Rename and write `src/components/Scene.tsx`**

```bash
mv /Users/ivan/Downloads/DFRNC/src/components/Scene.jsx \
   /Users/ivan/Downloads/DFRNC/src/components/Scene.tsx
```

Full content:

```tsx
import { useState, useCallback, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { Environment } from '@react-three/drei'
import { EffectComposer, ChromaticAberration } from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'
import { Vector2, ACESFilmicToneMapping } from 'three'
import ArcModel from './ArcModel'

const ABERRATION_OFFSET = new Vector2(0.005, 0.005)

export default function Scene() {
  const [canvasOpacity, setCanvasOpacity] = useState<number>(1)
  const fadingRef = useRef<boolean>(false)

  const handleFadeOut = useCallback((ft: number) => {
    if (!fadingRef.current) fadingRef.current = true
    setCanvasOpacity(1 - ft)
  }, [])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2,
        pointerEvents: 'none',
        opacity: canvasOpacity,
        mixBlendMode: 'screen',
      }}
    >
      <Canvas
        gl={{
          antialias: true,
          toneMapping: ACESFilmicToneMapping,
          toneMappingExposure: 0.9,
        }}
        camera={{ fov: 60, near: 0.1, far: 100, position: [0, 0, 8] }}
        style={{ width: '100%', height: '100%' }}
      >
        <color attach="background" args={['#000000']} />

        <ambientLight color={0x0a0a1a} intensity={0.3} />
        <pointLight color={0x88aaff} intensity={12} distance={30} position={[-3, 4, 5]} />
        <pointLight color={0x2255ff} intensity={6} distance={25} position={[4, -1, 5]} />
        <pointLight color={0x9900ff} intensity={8} distance={20} position={[0, 3, -5]} />
        <pointLight color={0xaabbff} intensity={3} distance={15} position={[1, -4, 3]} />

        <Environment preset="studio" />

        <ArcModel onFadeOut={handleFadeOut} />

        <EffectComposer>
          <ChromaticAberration
            blendFunction={BlendFunction.NORMAL}
            offset={ABERRATION_OFFSET}
          />
        </EffectComposer>
      </Canvas>
    </div>
  )
}
```

- [ ] **Step 2: Run type-check**

```bash
cd /Users/ivan/Downloads/DFRNC && npx tsc -b --noEmit
```

Expected: exits with code 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/Scene.tsx
git rm src/components/Scene.jsx
git commit -m "chore: convert Scene to TypeScript"
```

---

## Task 6: Convert ArcModel.tsx

**Files:**
- Rename: `src/components/ArcModel.jsx` → `src/components/ArcModel.tsx`

- [ ] **Step 1: Rename and write `src/components/ArcModel.tsx`**

```bash
mv /Users/ivan/Downloads/DFRNC/src/components/ArcModel.jsx \
   /Users/ivan/Downloads/DFRNC/src/components/ArcModel.tsx
```

Full content:

```tsx
import { useRef, useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'

useGLTF.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/')

function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2
}

const DURATION = 8.6
const FADE_DURATION = 0.4

const glassMaterial = new THREE.MeshPhysicalMaterial({
  color: new THREE.Color(0x000000),
  metalness: 0.0,
  roughness: 0.1,
  iridescence: 1.0,
  iridescenceIOR: 1.5,
  iridescenceThicknessRange: [300, 700],
  envMapIntensity: 2.5,
  transmission: 1.0,
  ior: 1.2,
  thickness: 0.3,
  side: THREE.DoubleSide,
})

interface ArcModelProps {
  onFadeOut?: (ft: number) => void
}

export default function ArcModel({ onFadeOut }: ArcModelProps) {
  const { scene: modelScene } = useGLTF('/model.glb')
  const { viewport } = useThree()
  const modelRef = useRef<THREE.Group>(null)
  const elapsed = useRef<number>(0)
  const fadeElapsed = useRef<number>(0)
  const isFading = useRef<boolean>(false)
  const isDone = useRef<boolean>(false)

  useEffect(() => {
    if (!modelScene) return

    const box = new THREE.Box3().setFromObject(modelScene)
    const size = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)
    modelScene.scale.setScalar(1.5 / maxDim)

    modelScene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.material = glassMaterial
      }
    })
  }, [modelScene])

  const curve = useMemo(() => {
    const { width, height } = viewport
    const start = new THREE.Vector3(-width / 2, -height / 2, 0)
    const peak = new THREE.Vector3(0, height * 0.9, 0)
    const end = new THREE.Vector3(width / 1.5, -height / 2, 0)
    return new THREE.QuadraticBezierCurve3(start, peak, end)
  }, [viewport.width, viewport.height])

  useEffect(() => {
    if (modelRef.current) {
      const pos = curve.getPoint(0)
      modelRef.current.position.copy(pos)
    }
  }, [curve])

  useFrame((_state, delta: number) => {
    if (isDone.current || !modelRef.current) return

    if (!isFading.current) {
      elapsed.current = Math.min(elapsed.current + delta, DURATION)
      const t = easeInOutSine(elapsed.current / DURATION)
      const pos = curve.getPoint(t)
      modelRef.current.position.copy(pos)
      modelRef.current.rotation.y = t * Math.PI * 1.5

      if (elapsed.current >= DURATION) {
        isFading.current = true
      }
    } else {
      fadeElapsed.current = Math.min(fadeElapsed.current + delta, FADE_DURATION)
      const ft = fadeElapsed.current / FADE_DURATION
      onFadeOut?.(ft)

      if (fadeElapsed.current >= FADE_DURATION) {
        isDone.current = true
        modelRef.current.visible = false
      }
    }
  })

  return <primitive ref={modelRef} object={modelScene} />
}

useGLTF.preload('/model.glb')
```

Key changes vs JSX version:
- `easeInOutSine(t: number): number` — explicit param/return types
- `useRef<THREE.Group>(null)` — typed ref (null-initialized)
- `useRef<number>(0)`, `useRef<boolean>(false)` — explicit generics
- `child instanceof THREE.Mesh` — type-safe mesh check (replaces `child.isMesh`)
- `interface ArcModelProps` — explicit props type
- `useFrame((_state, delta: number)` — `_state` prefixed to satisfy `noUnusedParameters`

- [ ] **Step 2: Run type-check**

```bash
cd /Users/ivan/Downloads/DFRNC && npx tsc -b --noEmit
```

Expected: exits with code 0, no diagnostics.

If you see errors about `primitive` ref type mismatch (`THREE.Group` vs `THREE.Object3D`), change `useRef<THREE.Group>(null)` to `useRef<THREE.Object3D>(null)` — the `<primitive>` element in R3F types its ref as `THREE.Object3D`.

- [ ] **Step 3: Commit**

```bash
git add src/components/ArcModel.tsx
git rm src/components/ArcModel.jsx
git commit -m "chore: convert ArcModel to TypeScript"
```

---

## Task 7: Final verification — full build

**Files:** none (verification only)

- [ ] **Step 1: Run full type-check across all tsconfigs**

```bash
cd /Users/ivan/Downloads/DFRNC && npx tsc -b
```

Expected: exits with code 0.

- [ ] **Step 2: Run production build**

```bash
cd /Users/ivan/Downloads/DFRNC && npm run build
```

Expected:
```
✓ N modules transformed.
dist/index.html   ...
dist/assets/index-*.js  ...
✓ built in Xs
```

No TypeScript errors in output. The lottie-web `eval` warning is a known issue in that library — it is not a build failure.

- [ ] **Step 3: Smoke-test the dev server**

```bash
npm run dev
```

Open `http://localhost:5173` — verify Lottie plays + 3D model flies + ChromaticAberration visible, no console errors.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "chore: verify TypeScript migration complete"
```
