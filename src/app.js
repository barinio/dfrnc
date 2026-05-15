import { playLottie } from './lottie-player.js';
import { ThreeScene } from './three-scene.js';
import { flyArc } from './arc-animation.js';

async function main() {
  const scene = new ThreeScene('three-layer');

  // Phase 1: Lottie plays; preload model concurrently
  const modelPromise = scene.loadModel('assets/model.glb');
  await playLottie('lottie-layer', 'assets/animation.json');

  // Phase 2: Ensure model is ready, position at arc start (hidden)
  await modelPromise;
  const { width, height } = scene.getViewportBounds();
  scene.model.position.set(-width / 2, -height / 2, 0);

  // Phase 3: Show Three.js canvas and fly the arc
  scene.showModel();
  await flyArc(scene, 3.5);

  // Phase 4: Done — canvas faded out, Lottie background remains
  scene.stopRenderLoop();
}

main().catch(console.error);
