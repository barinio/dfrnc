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
