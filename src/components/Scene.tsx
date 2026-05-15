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
            radialModulation={false}
            modulationOffset={0}
          />
        </EffectComposer>
      </Canvas>
    </div>
  )
}
