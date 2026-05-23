import { useEffect, useState, useMemo, useRef } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import lottie from 'lottie-web'
import type { AnimationItem } from 'lottie-web'
import animationData from '../assets/animation.json'
import { LOTTIE_TOTAL_S } from '../constants'

const PLANE_Z = -1
const PADDING_PLANE_Z = PLANE_Z - 0.01
const WHITE_PADDING_RATIO = 0.02
const LOTTIE_EDGE_CROP_RATIO = 0.004

interface LottiePlaneProps {
  onComplete?: () => void
  onAnimationStart?: () => void
  reducedMotion?: boolean
  paused?: boolean
  time?: number
  showWhitePadding?: boolean
  speed?: number
}

export default function LottiePlane({
  onComplete,
  onAnimationStart,
  reducedMotion = false,
  paused = false,
  time = 0,
  showWhitePadding = false,
  speed = 1,
}: LottiePlaneProps) {
  const { viewport, camera, size } = useThree()
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null)
  // Once the animation is finished the canvas no longer changes, so we stop
  // uploading the texture to the GPU every frame.
  const doneRef = useRef<boolean>(false)
  const animRef = useRef<AnimationItem | null>(null)
  const texRef = useRef<THREE.CanvasTexture | null>(null)

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
      autoplay: !reducedMotion,
      animationData,
      rendererSettings: {
        preserveAspectRatio: 'none',
        clearCanvas: true,
      },
    })

    animRef.current = anim

    let tex: THREE.CanvasTexture | null = null
    doneRef.current = false

    const handleComplete = () => {
      doneRef.current = true
      if (tex) tex.needsUpdate = true // flush the final frame once
      onComplete?.()
    }

    const handleLoaded = () => {
      const cnv = wrapper.querySelector('canvas') as HTMLCanvasElement | null
      if (!cnv) return
      tex = new THREE.CanvasTexture(cnv)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.minFilter = THREE.LinearFilter
      tex.magFilter = THREE.LinearFilter
      texRef.current = tex
      setTexture(tex)
      onAnimationStart?.()

      if (reducedMotion) {
        // Skip the animated flythrough: jump straight to the final frame.
        anim.goToAndStop(Math.max(anim.totalFrames - 1, 0), true)
        handleComplete()
      }
    }

    anim.addEventListener('DOMLoaded', handleLoaded)
    anim.addEventListener('complete', handleComplete)

    return () => {
      anim.destroy()
      animRef.current = null
      wrapper.remove()
      if (tex) tex.dispose()
      texRef.current = null
    }
  }, [size.width, size.height, onComplete, onAnimationStart, reducedMotion])

  // Shared "speed" control. Re-applied when the texture (and thus the anim
  // instance) is recreated, e.g. after a resize.
  useEffect(() => {
    animRef.current?.setSpeed(speed)
  }, [speed, texture])

  // Shared "paused" control — pause/resume in lockstep with the 3D model.
  useEffect(() => {
    const anim = animRef.current
    if (!anim) return
    if (paused) anim.pause()
    else if (!doneRef.current) anim.play()
  }, [paused, texture])

  // While paused, the "time" prop (in seconds within the Lottie timeline) scrubs
  // the frame. Independent of the 3D model's timeline.
  useEffect(() => {
    if (!paused) return
    const anim = animRef.current
    if (!anim) return
    const frac =
      LOTTIE_TOTAL_S > 0 ? Math.min(Math.max(time / LOTTIE_TOTAL_S, 0), 1) : 0
    anim.goToAndStop(frac * Math.max(anim.totalFrames - 1, 0), true)
    if (texRef.current) texRef.current.needsUpdate = true
  }, [paused, time, texture])

  useFrame(() => {
    if (texture && !doneRef.current) texture.needsUpdate = true
  })

  useEffect(() => {
    if (!texture) return

    const aspect = viewport.width / viewport.height
    const isLandscape = aspect >= 1
    const cropX = showWhitePadding && !isLandscape ? LOTTIE_EDGE_CROP_RATIO : 0
    const cropY = showWhitePadding && isLandscape ? LOTTIE_EDGE_CROP_RATIO : 0

    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.offset.set(cropX, cropY)
    texture.repeat.set(1 - cropX * 2, 1 - cropY * 2)
    texture.needsUpdate = true
  }, [texture, showWhitePadding, viewport.width, viewport.height])

  const { planeWidth, planeHeight, paddingPlaneWidth, paddingPlaneHeight } =
    useMemo(() => {
      const cam = camera as THREE.PerspectiveCamera
      const aspect = viewport.width / viewport.height
      const getPlaneSize = (z: number) => {
        const distance = cam.position.z - z
        const h = 2 * distance * Math.tan((cam.fov * Math.PI) / 360)
        return { width: h * aspect, height: h }
      }

      const lottiePlane = getPlaneSize(PLANE_Z)
      const paddingPlane = getPlaneSize(PADDING_PLANE_Z)
      const isLandscape = aspect >= 1
      const insetScale = 1 - WHITE_PADDING_RATIO * 2

      return {
        planeWidth:
          showWhitePadding && !isLandscape
            ? lottiePlane.width * insetScale
            : lottiePlane.width,
        planeHeight:
          showWhitePadding && isLandscape
            ? lottiePlane.height * insetScale
            : lottiePlane.height,
        paddingPlaneWidth: paddingPlane.width,
        paddingPlaneHeight: paddingPlane.height,
      }
    }, [camera, viewport.width, viewport.height, showWhitePadding])

  if (!texture) return null

  return (
    <group>
      {showWhitePadding && (
        <mesh position={[0, 0, PADDING_PLANE_Z]}>
          <planeGeometry args={[paddingPlaneWidth, paddingPlaneHeight]} />
          <meshBasicMaterial color="#ffffff" toneMapped={false} />
        </mesh>
      )}
      <mesh position={[0, 0, PLANE_Z]}>
        <planeGeometry args={[planeWidth, planeHeight]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
    </group>
  )
}
