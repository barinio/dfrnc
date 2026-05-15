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
