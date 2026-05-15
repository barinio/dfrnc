# Leva Material Controls Design

**Date:** 2026-05-15  
**Status:** Approved

## Overview

Add Leva GUI panel to the DFRNC Three.js scene for interactive tweaking of material properties, lighting, and animation. The panel is hidden by default and toggled with `Cmd+L`.

## Architecture

Two existing files are modified — `ArcModel.tsx` and `Scene.tsx` — plus the `leva` package is installed.

```
Scene.tsx
 ├── <Leva hidden={!visible} />          — single panel mount
 ├── window keydown listener (Cmd+L)    — toggles visible state
 ├── useControls('Lighting', ...)        — controls ambient + tone mapping
 ├── useControls('Lighting / Dir 1', ...)
 ├── useControls('Lighting / Dir 2', ...)
 ├── useControls('Lighting / Point 1', ...)
 └── useControls('Lighting / Point 2', ...)

ArcModel.tsx
 ├── useControls('Material / Core', ...)
 ├── useControls('Material / Glass', ...)
 ├── useControls('Material / Clearcoat', ...)
 ├── useControls('Material / Iridescence', ...)
 └── useControls('Animation', ...)
```

No context, no extra props between components. Leva's `useControls` is called directly where the values are consumed.

## Material Controls (ArcModel.tsx)

The `glassMaterial` singleton stays as a module-level object. Leva values are applied to it in a `useEffect` that watches all control values. Three.js picks up mutations automatically via `needsUpdate = true` where required.

### Material / Core

| Property | Type | Range | Default |
|---|---|---|---|
| `color` | color | — | `#ffffff` |
| `metalness` | slider | 0 – 1 | 0.0 |
| `roughness` | slider | 0 – 1 | 0.15 |
| `transmission` | slider | 0 – 1 | 1.0 |
| `thickness` | slider | 0 – 5 | 1.2 |
| `ior` | slider | 1.0 – 2.5 | 1.45 |
| `envMapIntensity` | slider | 0 – 5 | 1.2 |

### Material / Glass

| Property | Type | Range | Default |
|---|---|---|---|
| `dispersion` | slider | 0 – 10 | 1.5 |
| `attenuationColor` | color | — | `#dde6ff` |
| `attenuationDistance` | slider | 0 – 20 | 4.0 |

### Material / Clearcoat

| Property | Type | Range | Default |
|---|---|---|---|
| `clearcoat` | slider | 0 – 1 | 1.0 |
| `clearcoatRoughness` | slider | 0 – 1 | 0.05 |

### Material / Iridescence

| Property | Type | Range | Default |
|---|---|---|---|
| `iridescence` | slider | 0 – 1 | 0.6 |
| `iridescenceIOR` | slider | 1.0 – 2.5 | 1.7 |
| `thicknessMin` | slider | 50 – 1000 | 200 |
| `thicknessMax` | slider | 50 – 1000 | 600 |

`iridescenceThicknessRange` is written as `[thicknessMin, thicknessMax]`.

## Lighting Controls (Scene.tsx)

Values feed directly into JSX light props as controlled values. `toneMappingExposure` writes to `gl.toneMappingExposure` via `useThree()` inside a `useEffect`.

### Lighting (top-level)

| Property | Type | Range | Default |
|---|---|---|---|
| `ambientIntensity` | slider | 0 – 3 | 0.5 |
| `toneMappingExposure` | slider | 0 – 3 | 1.1 |

### Lighting / Directional 1

| Property | Type | Range | Default |
|---|---|---|---|
| `color` | color | — | `#ffffff` |
| `intensity` | slider | 0 – 10 | 3.0 |

### Lighting / Directional 2

| Property | Type | Range | Default |
|---|---|---|---|
| `color` | color | — | `#ccddff` |
| `intensity` | slider | 0 – 10 | 2.0 |

### Lighting / Point 1

| Property | Type | Range | Default |
|---|---|---|---|
| `color` | color | — | `#ffffff` |
| `intensity` | slider | 0 – 100 | 30 |
| `distance` | slider | 0 – 50 | 20 |

### Lighting / Point 2

| Property | Type | Range | Default |
|---|---|---|---|
| `color` | color | — | `#aaccff` |
| `intensity` | slider | 0 – 100 | 20 |
| `distance` | slider | 0 – 50 | 20 |

## Animation Controls (ArcModel.tsx)

Controls the existing bezier animation loop in `useFrame`.

### Animation folder

| Property | Type | Range | Default |
|---|---|---|---|
| `paused` | boolean | — | `false` |
| `time` | slider | 0 – 8.6 | 0 |
| `speed` | slider | 0.1 – 3 | 1.0 |

**Behavior:**
- `paused = false`: `useFrame` advances `elapsed.current` normally, multiplied by `speed`. The `time` slider is display-only, updated each frame to reflect current position.
- `paused = true`: `useFrame` skips advancing `elapsed`. The `time` slider drives `elapsed.current` directly, scrubbing the model along the bezier curve and updating rotation.
- The scrub slider steps at `0.01` for smooth visual feedback.

## Toggle Mechanism

A single `visible` boolean state in `Scene.tsx` (default: `false`) controls `<Leva hidden={!visible} />`. A `useEffect` attaches a `keydown` listener on `window`:

```ts
if (e.metaKey && e.key === 'l') {
  e.preventDefault()
  setVisible(v => !v)
}
```

The `<Leva />` component is rendered as a sibling of `<Canvas>` inside the outer `div`, outside the R3F tree.

## Package

```
npm install leva
```

No other dependencies required.
