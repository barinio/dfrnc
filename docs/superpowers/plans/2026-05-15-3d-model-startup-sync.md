# 3D Model Startup Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synchronize the 3D model animation start with the Lottie animation using event-driven coordination so they begin at exactly the same time.

**Architecture:** LottiePlane emits an `onAnimationStart` callback when its animation is ready. Scene coordinates by passing this signal to ArcModel via a `shouldStart` prop. ArcModel waits for the signal before rendering and animating.

**Tech Stack:** React, Three.js, Lottie, @react-three/fiber

---

## File Structure

- **Modify:** `src/components/LottiePlane.tsx` — Add `onAnimationStart` prop and callback invocation
- **Modify:** `src/components/ArcModel.tsx` — Add `shouldStart` prop and conditional rendering
- **Modify:** `src/components/Scene.tsx` — Add state and callbacks to coordinate both components

---

### Task 1: Update LottiePlane to emit animation start signal

**Files:**
- Modify: `src/components/LottiePlane.tsx:9-11`

- [ ] **Step 1: Add `onAnimationStart` callback prop to LottiePlane interface**

Update the props interface to accept the callback:

```typescript
interface LottiePlaneProps {
  onComplete?: () => void
  onAnimationStart?: () => void
}
```

- [ ] **Step 2: Call `onAnimationStart()` when Lottie animation is ready**

Update the `handleLoaded` function to invoke the callback:

```typescript
const handleLoaded = () => {
  const cnv = wrapper.querySelector('canvas') as HTMLCanvasElement | null
  if (!cnv) return
  tex = new THREE.CanvasTexture(cnv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  setTexture(tex)
  onAnimationStart?.()
}
```

- [ ] **Step 3: Commit the change**

```bash
git add src/components/LottiePlane.tsx
git commit -m "feat: add onAnimationStart callback to LottiePlane"
```

---

### Task 2: Update ArcModel to accept and use `shouldStart` prop

**Files:**
- Modify: `src/components/ArcModel.tsx:37-40`

- [ ] **Step 1: Add `shouldStart` prop to ArcModel interface**

Update the props interface with a default value:

```typescript
interface ArcModelProps {
  onFadeOut?: (ft: number) => void
  shouldStart?: boolean
}
```

- [ ] **Step 2: Extract `shouldStart` from props (default to true for backwards compatibility)**

Update the component function signature:

```typescript
export default function ArcModel({ onFadeOut, shouldStart = true }: ArcModelProps) {
```

- [ ] **Step 3: Return null if model is not ready to start**

Add this early return after the `useGLTF` call and before any effects:

```typescript
export default function ArcModel({ onFadeOut, shouldStart = true }: ArcModelProps) {
  const { scene: modelScene } = useGLTF("/model.glb");
  
  if (!shouldStart) {
    return null;
  }
  
  const { viewport } = useThree();
  // ... rest of component
```

- [ ] **Step 4: Commit the change**

```bash
git add src/components/ArcModel.tsx
git commit -m "feat: add shouldStart prop to ArcModel for synchronized startup"
```

---

### Task 3: Update Scene to coordinate animation synchronization

**Files:**
- Modify: `src/components/Scene.tsx:17-108`

- [ ] **Step 1: Add animationStarted state**

Add this state after the existing `canvasOpacity` state (around line 19):

```typescript
const [animationStarted, setAnimationStarted] = useState(false)
```

- [ ] **Step 2: Create handleAnimationStart callback**

Add this callback after the `handleFadeOut` callback (around line 73):

```typescript
const handleAnimationStart = useCallback(() => {
  setAnimationStarted(true)
}, [])
```

- [ ] **Step 3: Pass onAnimationStart callback to LottiePlane**

Update the LottiePlane component render (around line 103):

```typescript
<LottiePlane onAnimationStart={handleAnimationStart} />
```

- [ ] **Step 4: Pass shouldStart prop to ArcModel**

Update the ArcModel component render (around line 104):

```typescript
<ArcModel shouldStart={animationStarted} onFadeOut={handleFadeOut} />
```

- [ ] **Step 5: Commit the changes**

```bash
git add src/components/Scene.tsx
git commit -m "feat: synchronize 3D model and Lottie animation startup"
```

---

### Task 4: Test the synchronization in browser

**Files:**
- Test manually in browser (no code changes)

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

Expected: Development server starts on `http://localhost:5173` (or similar)

- [ ] **Step 2: Open the application in browser**

Navigate to the dev server URL and observe:
- The Lottie animation should start immediately
- The 3D model should appear and begin animating at the exact same time as the Lottie animation
- No visual gap or delay between the two animations starting

- [ ] **Step 3: Verify no console errors**

Open browser DevTools (F12) and check the Console tab. Should see no errors.

- [ ] **Step 4: Test edge cases**

- Refresh the page multiple times to ensure consistency
- The animation should always start in sync
- No flickering or delayed appearance of the 3D model

---

## Plan Review

**Spec Coverage:**
- ✓ LottiePlane emits `onAnimationStart` callback (Task 1)
- ✓ ArcModel accepts `shouldStart` prop and waits for signal (Task 2)
- ✓ Scene coordinates both components (Task 3)
- ✓ Manual testing to verify synchronization (Task 4)

**Placeholder Scan:** None found. All code is complete and exact.

**Type Consistency:** 
- `shouldStart` is consistent across ArcModel
- `onAnimationStart` callback is properly typed
- No naming mismatches

**Backwards Compatibility:** ArcModel defaults `shouldStart = true`, so existing code continues to work.
