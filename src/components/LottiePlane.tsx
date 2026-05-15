import { useEffect, useState, useMemo } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import lottie from 'lottie-web'
import animationData from '../assets/animation.json'

const PLANE_Z = -1

interface LottiePlaneProps {
  onComplete?: () => void
  onAnimationStart?: () => void
}

export default function LottiePlane({ onComplete, onAnimationStart }: LottiePlaneProps) {
  const { viewport, camera, size } = useThree()
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null)

  useEffect(() => {
    const wrapper = document.createElement('div')
    wrapper.style.position = 'absolute'
    wrapper.style.left = '-99999px'
    wrapper.style.top = '0'
    wrapper.style.width = `${size.width}px`
    wrapper.style.height = `${size.height}px`
    wrapper.style.background = '#000'
    document.body.appendChild(wrapper)

    const anim = lottie.loadAnimation({
      container: wrapper,
      renderer: 'canvas',
      loop: false,
      autoplay: true,
      animationData,
      rendererSettings: {
        preserveAspectRatio: 'xMidYMid meet',
        clearCanvas: true,
      },
    })

    let tex: THREE.CanvasTexture | null = null

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

    anim.addEventListener('DOMLoaded', handleLoaded)
    if (onComplete) anim.addEventListener('complete', onComplete)

    return () => {
      anim.destroy()
      wrapper.remove()
      if (tex) tex.dispose()
    }
  }, [size.width, size.height, onComplete, onAnimationStart])

  useFrame(() => {
    if (texture) texture.needsUpdate = true
  })

  const { planeWidth, planeHeight } = useMemo(() => {
    const cam = camera as THREE.PerspectiveCamera
    const distance = cam.position.z - PLANE_Z
    const h = 2 * distance * Math.tan((cam.fov * Math.PI) / 360)
    const aspect = viewport.width / viewport.height
    return { planeWidth: h * aspect, planeHeight: h }
  }, [camera, viewport.width, viewport.height])

  if (!texture) return null

  return (
    <mesh position={[0, 0, PLANE_Z]}>
      <planeGeometry args={[planeWidth, planeHeight]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  )
}
