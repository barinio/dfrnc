# Leva Material Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Leva GUI panel (toggled with Cmd+L) for live-tweaking material properties, lighting, and animation on the 3D arc model.

**Architecture:** `Scene.tsx` owns the Leva panel mount and all lighting controls; `ArcModel.tsx` owns material and animation controls. No context or extra props between components — each uses `useControls` directly. A small `RendererConfig` component inside `<Canvas>` handles `toneMappingExposure` via `useThree`.

**Tech Stack:** React 18, React Three Fiber 8, Three.js 0.170, leva (to install), TypeScript 6, Vite

---

## Task 1: Install leva

**Files:**
- Modify: `package.json` (via npm install)

- [ ] **Step 1: Install the package**

```bash
npm install leva
```

Expected output: `added N packages` with no errors. `leva` appears in `package.json` dependencies.

- [ ] **Step 2: Verify TypeScript can see the types**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors about `leva` module not found. (There may be pre-existing errors — ignore those for now.)

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install leva for material controls GUI"
```

---

## Task 2: Update Scene.tsx — Leva panel, Cmd+L toggle, lighting controls

**Files:**
- Modify: `src/components/Scene.tsx`

Replace the entire file with the following:

- [ ] **Step 1: Write the new Scene.tsx**

```tsx
import { useState, useCallback, useRef, useEffect } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Environment } from '@react-three/drei'
import { ACESFilmicToneMapping } from 'three'
import { Leva, useControls, folder } from 'leva'
import ArcModel from './ArcModel'
import LottiePlane from './LottiePlane'

function RendererConfig({ exposure }: { exposure: number }) {
  const { gl } = useThree()
  useEffect(() => {
    gl.toneMappingExposure = exposure
  }, [gl, exposure])
  return null
}

export default function Scene() {
  const [visible, setVisible] = useState(false)
  const [canvasOpacity, setCanvasOpacity] = useState<number>(1)
  const fadingRef = useRef<boolean>(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === 'l') {
        e.preventDefault()
        setVisible(v => !v)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const {
    ambientIntensity,
    toneMappingExposure,
    dir1Color,
    dir1Intensity,
    dir2Color,
    dir2Intensity,
    pt1Color,
    pt1Intensity,
    pt1Distance,
    pt2Color,
    pt2Intensity,
    pt2Distance,
  } = useControls('Lighting', {
    ambientIntensity: { value: 0.5, min: 0, max: 3, step: 0.01 },
    toneMappingExposure: { value: 1.1, min: 0, max: 3, step: 0.01 },
    'Directional 1': folder({
      dir1Color: { label: 'color', value: '#ffffff' },
      dir1Intensity: { label: 'intensity', value: 3, min: 0, max: 10, step: 0.1 },
    }),
    'Directional 2': folder({
      dir2Color: { label: 'color', value: '#ccddff' },
      dir2Intensity: { label: 'intensity', value: 2, min: 0, max: 10, step: 0.1 },
    }),
    'Point 1': folder({
      pt1Color: { label: 'color', value: '#ffffff' },
      pt1Intensity: { label: 'intensity', value: 30, min: 0, max: 100, step: 1 },
      pt1Distance: { label: 'distance', value: 20, min: 0, max: 50, step: 0.5 },
    }),
    'Point 2': folder({
      pt2Color: { label: 'color', value: '#aaccff' },
      pt2Intensity: { label: 'intensity', value: 20, min: 0, max: 100, step: 1 },
      pt2Distance: { label: 'distance', value: 20, min: 0, max: 50, step: 0.5 },
    }),
  })

  const handleFadeOut = useCallback((ft: number) => {
    if (!fadingRef.current) fadingRef.current = true
    setCanvasOpacity(1 - ft)
  }, [])

  return (
    <>
      <Leva hidden={!visible} />
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1,
          pointerEvents: 'none',
          opacity: canvasOpacity,
        }}
      >
        <Canvas
          gl={{
            antialias: true,
            toneMapping: ACESFilmicToneMapping,
            toneMappingExposure: 1.1,
          }}
          camera={{ fov: 60, near: 0.1, far: 100, position: [0, 0, 8] }}
          style={{ width: '100%', height: '100%' }}
        >
          <color attach="background" args={['#000000']} />
          <RendererConfig exposure={toneMappingExposure} />
          <ambientLight color={0xffffff} intensity={ambientIntensity} />
          <directionalLight color={dir1Color} intensity={dir1Intensity} position={[-3, 4, 5]} />
          <directionalLight color={dir2Color} intensity={dir2Intensity} position={[4, -2, 5]} />
          <pointLight color={pt1Color} intensity={pt1Intensity} distance={pt1Distance} position={[-2, 3, 4]} />
          <pointLight color={pt2Color} intensity={pt2Intensity} distance={pt2Distance} position={[3, -1, 4]} />
          <Environment preset="studio" />
          <LottiePlane />
          <ArcModel onFadeOut={handleFadeOut} />
        </Canvas>
      </div>
    </>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1
```

Expected: no new errors related to `Scene.tsx` or `leva`.

- [ ] **Step 3: Run dev server and verify toggle**

```bash
npm run dev
```

Open the browser. Press `Cmd+L` — the Leva panel should appear in the top-right corner with a "Lighting" section. Press again to hide it. Verify that adjusting `ambientIntensity` visibly changes scene brightness.

- [ ] **Step 4: Commit**

```bash
git add src/components/Scene.tsx
git commit -m "feat: add Leva panel with Cmd+L toggle and lighting controls"
```

---

## Task 3: Add material controls to ArcModel.tsx

**Files:**
- Modify: `src/components/ArcModel.tsx`

- [ ] **Step 1: Write the new ArcModel.tsx**

Replace the entire file with the following:

```tsx
import { useRef, useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { useControls, folder } from 'leva'

useGLTF.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/')

function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2
}

const DURATION = 8.6
const FADE_DURATION = 0.4

const glassMaterial = new THREE.MeshPhysicalMaterial({
  color: new THREE.Color(0xffffff),
  metalness: 0.0,
  roughness: 0.15,
  transmission: 1.0,
  thickness: 1.2,
  ior: 1.45,
  dispersion: 1.5,
  attenuationColor: new THREE.Color(0xdde6ff),
  attenuationDistance: 4.0,
  clearcoat: 1.0,
  clearcoatRoughness: 0.05,
  iridescence: 0.6,
  iridescenceIOR: 1.7,
  iridescenceThicknessRange: [200, 600],
  envMapIntensity: 1.2,
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
  } = useControls('Material', {
    Core: folder({
      color: '#ffffff',
      metalness: { value: 0.0, min: 0, max: 1, step: 0.01 },
      roughness: { value: 0.15, min: 0, max: 1, step: 0.01 },
      transmission: { value: 1.0, min: 0, max: 1, step: 0.01 },
      thickness: { value: 1.2, min: 0, max: 5, step: 0.05 },
      ior: { value: 1.45, min: 1.0, max: 2.5, step: 0.01 },
      envMapIntensity: { value: 1.2, min: 0, max: 5, step: 0.05 },
    }),
    Glass: folder({
      dispersion: { value: 1.5, min: 0, max: 10, step: 0.1 },
      attenuationColor: '#dde6ff',
      attenuationDistance: { value: 4.0, min: 0, max: 20, step: 0.1 },
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
  })

  useEffect(() => {
    glassMaterial.color.set(color)
    glassMaterial.metalness = metalness
    glassMaterial.roughness = roughness
    glassMaterial.transmission = transmission
    glassMaterial.thickness = thickness
    glassMaterial.ior = ior
    glassMaterial.envMapIntensity = envMapIntensity
    glassMaterial.dispersion = dispersion
    glassMaterial.attenuationColor.set(attenuationColor)
    glassMaterial.attenuationDistance = attenuationDistance
    glassMaterial.clearcoat = clearcoat
    glassMaterial.clearcoatRoughness = clearcoatRoughness
    glassMaterial.iridescence = iridescence
    glassMaterial.iridescenceIOR = iridescenceIOR
    glassMaterial.iridescenceThicknessRange = [thicknessMin, thicknessMax]
    glassMaterial.needsUpdate = true
  }, [
    color, metalness, roughness, transmission, thickness, ior, envMapIntensity,
    dispersion, attenuationColor, attenuationDistance,
    clearcoat, clearcoatRoughness,
    iridescence, iridescenceIOR, thicknessMin, thicknessMax,
  ])

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

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1
```

Expected: no new errors from `ArcModel.tsx`.

- [ ] **Step 3: Verify material controls in browser**

Open the browser with `npm run dev` still running. Press `Cmd+L` to open the panel. Expand the "Material" section. Drag the `roughness` slider — the model's surface should visibly change. Drag `iridescence` — the color shimmer should change.

- [ ] **Step 4: Commit**

```bash
git add src/components/ArcModel.tsx
git commit -m "feat: add Leva material controls for glass properties"
```

---

## Task 4: Add animation controls to ArcModel.tsx

**Files:**
- Modify: `src/components/ArcModel.tsx`

Replace the placeholder animation section and `useFrame` with the full animation controls implementation.

- [ ] **Step 1: Write the final ArcModel.tsx**

Replace the entire file:

```tsx
import { useRef, useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { useControls, folder } from 'leva'

useGLTF.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/')

function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2
}

const DURATION = 8.6
const FADE_DURATION = 0.4

const glassMaterial = new THREE.MeshPhysicalMaterial({
  color: new THREE.Color(0xffffff),
  metalness: 0.0,
  roughness: 0.15,
  transmission: 1.0,
  thickness: 1.2,
  ior: 1.45,
  dispersion: 1.5,
  attenuationColor: new THREE.Color(0xdde6ff),
  attenuationDistance: 4.0,
  clearcoat: 1.0,
  clearcoatRoughness: 0.05,
  iridescence: 0.6,
  iridescenceIOR: 1.7,
  iridescenceThicknessRange: [200, 600],
  envMapIntensity: 1.2,
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
  const pausedRef = useRef<boolean>(false)
  const speedRef = useRef<number>(1.0)

  // Material controls
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
  } = useControls('Material', {
    Core: folder({
      color: '#ffffff',
      metalness: { value: 0.0, min: 0, max: 1, step: 0.01 },
      roughness: { value: 0.15, min: 0, max: 1, step: 0.01 },
      transmission: { value: 1.0, min: 0, max: 1, step: 0.01 },
      thickness: { value: 1.2, min: 0, max: 5, step: 0.05 },
      ior: { value: 1.45, min: 1.0, max: 2.5, step: 0.01 },
      envMapIntensity: { value: 1.2, min: 0, max: 5, step: 0.05 },
    }),
    Glass: folder({
      dispersion: { value: 1.5, min: 0, max: 10, step: 0.1 },
      attenuationColor: '#dde6ff',
      attenuationDistance: { value: 4.0, min: 0, max: 20, step: 0.1 },
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
  })

  useEffect(() => {
    glassMaterial.color.set(color)
    glassMaterial.metalness = metalness
    glassMaterial.roughness = roughness
    glassMaterial.transmission = transmission
    glassMaterial.thickness = thickness
    glassMaterial.ior = ior
    glassMaterial.envMapIntensity = envMapIntensity
    glassMaterial.dispersion = dispersion
    glassMaterial.attenuationColor.set(attenuationColor)
    glassMaterial.attenuationDistance = attenuationDistance
    glassMaterial.clearcoat = clearcoat
    glassMaterial.clearcoatRoughness = clearcoatRoughness
    glassMaterial.iridescence = iridescence
    glassMaterial.iridescenceIOR = iridescenceIOR
    glassMaterial.iridescenceThicknessRange = [thicknessMin, thicknessMax]
    glassMaterial.needsUpdate = true
  }, [
    color, metalness, roughness, transmission, thickness, ior, envMapIntensity,
    dispersion, attenuationColor, attenuationDistance,
    clearcoat, clearcoatRoughness,
    iridescence, iridescenceIOR, thicknessMin, thicknessMax,
  ])

  // Animation controls — function form returns [values, set] for programmatic updates
  const [{ paused, time, speed }, setAnim] = useControls('Animation', () => ({
    paused: false,
    time: { value: 0, min: 0, max: DURATION, step: 0.01 },
    speed: { value: 1.0, min: 0.1, max: 3, step: 0.05 },
  }))

  // Keep refs in sync so useFrame always reads current values without stale closures
  useEffect(() => { pausedRef.current = paused }, [paused])
  useEffect(() => { speedRef.current = speed }, [speed])

  // When paused, time slider scrubs the animation position
  useEffect(() => {
    if (pausedRef.current) elapsed.current = time
  }, [time])

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
      if (!pausedRef.current) {
        elapsed.current = Math.min(elapsed.current + delta * speedRef.current, DURATION)
        setAnim({ time: elapsed.current })
        if (elapsed.current >= DURATION) {
          isFading.current = true
        }
      }

      const t = easeInOutSine(elapsed.current / DURATION)
      const pos = curve.getPoint(t)
      modelRef.current.position.copy(pos)
      modelRef.current.rotation.y = t * Math.PI * 1.5
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

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1
```

Expected: no errors from `ArcModel.tsx`.

- [ ] **Step 3: Verify animation controls in browser**

Press `Cmd+L`. Open the "Animation" section in the Leva panel.

1. Toggle `paused` to `true` — model stops moving.
2. Drag the `time` slider — model scrubs along its arc path and rotation updates.
3. Toggle `paused` back to `false` — model resumes from current position.
4. Set `speed` to `2` — model moves at double speed.

- [ ] **Step 4: Commit**

```bash
git add src/components/ArcModel.tsx
git commit -m "feat: add Leva animation controls with pause, scrub, and speed"
```
