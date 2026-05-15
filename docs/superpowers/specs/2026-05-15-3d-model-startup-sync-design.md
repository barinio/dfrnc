# 3D Model Startup Synchronization Design

## Overview
Synchronize the 3D model animation start with the Lottie animation using event-driven coordination. The 3D model should appear and start animating at the exact moment the Lottie animation begins playing.

## Problem
Currently, the 3D model has a delay of ~2 seconds before appearing and starting its animation, while the Lottie animation starts immediately. This creates a visual disconnect between the two animations.

## Solution: Event-Driven Synchronization

### Architecture

**Three components work together:**

1. **LottiePlane** — Detects when Lottie animation is ready and emits `onAnimationStart` callback
2. **Scene** — Acts as coordinator, receives the animation start signal and passes it to ArcModel
3. **ArcModel** — Waits for the start signal before rendering and animating

### Data Flow

```
LottiePlane
  ↓ (when animation is loaded and ready)
  ├→ emits onAnimationStart()
  
Scene (receives callback)
  ↓
  ├→ passes to ArcModel via shouldStart prop
  
ArcModel
  ↓ (when shouldStart = true)
  ├→ begins rendering the model
  ├→ starts animation immediately
```

### Component Changes

**LottiePlane:**
- Add `onAnimationStart?: () => void` prop
- Call `onAnimationStart()` in the `DOMLoaded` event handler (when Lottie canvas is ready)
- This ensures both the Lottie canvas texture and animation are initialized before signaling

**Scene:**
- Add state: `const [animationStarted, setAnimationStarted] = useState(false)`
- Add callback: `const handleAnimationStart = () => setAnimationStarted(true)`
- Pass callback to LottiePlane: `<LottiePlane onAnimationStart={handleAnimationStart} />`
- Pass state to ArcModel: `<ArcModel shouldStart={animationStarted} ... />`

**ArcModel:**
- Add `shouldStart?: boolean` prop (default `true` for backwards compatibility)
- Return `null` if `!shouldStart` (don't render until signal received)
- Once `shouldStart = true`, start rendering and animation immediately

### Backwards Compatibility
ArcModel defaults `shouldStart = true`, so existing uses work without changes.

## Benefits
- Clean separation of concerns: each component owns its initialization
- No hacky delays or setTimeout workarounds
- Animations are guaranteed to start in sync
- Easy to debug: can trace the event flow in React DevTools

## Testing
- Verify LottiePlane calls callback when animation starts
- Verify ArcModel appears immediately when shouldStart becomes true
- Check visual sync between Lottie and 3D animations in browser
