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
