import * as THREE from 'three';

// Animates model along a quadratic bezier arc:
// bottom-left → center-top → bottom-right
// Also rotates model around Y-axis during flight.
// Returns a Promise that resolves when animation + fade-out complete.
export function flyArc(scene, duration = 3.5) {
  return new Promise((resolve) => {
    const { model, canvas } = scene;
    if (!model) throw new Error('flyArc: scene.model is null — loadModel must complete first');
    const { width, height } = scene.getViewportBounds();

    const start  = new THREE.Vector3(-width / 2,  -height / 2, 0);
    const peak   = new THREE.Vector3(0,             height * 0.4, 0);
    const end    = new THREE.Vector3( width / 2,  -height / 2, 0);

    const curve = new THREE.QuadraticBezierCurve3(start, peak, end);

    const proxy = { t: 0, rotY: 0 };

    gsap.to(proxy, {
      t: 1,
      rotY: Math.PI * 1.5,
      duration,
      ease: 'power2.inOut',
      onUpdate() {
        const pos = curve.getPoint(proxy.t);
        model.position.copy(pos);
        model.rotation.y = proxy.rotY;
      },
      onComplete() {
        // Fade out canvas after reaching end point
        gsap.to(canvas, {
          opacity: 0,
          duration: 0.4,
          ease: 'power1.in',
          onComplete: resolve,
        });
      },
    });
  });
}
