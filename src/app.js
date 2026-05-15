import { playLottie } from './lottie-player.js';
import { ThreeScene } from './three-scene.js';
import { flyArc } from './arc-animation.js';

async function main() {
  const scene = new ThreeScene('three-layer');

  // Load model first (10KB — fast)
  await scene.loadModel('assets/model.glb');

  // Position at arc start and show canvas before Lottie begins
  const { width, height } = scene.getViewportBounds();
  scene.model.position.set(-width / 2, -height / 2, 0);
  scene.showModel();

  // Lottie and 3D arc run simultaneously — same ~8.6s duration
  try {
    await Promise.all([
      playLottie('lottie-layer', 'assets/animation.json'),
      flyArc(scene, 8.6),
    ]);
  } finally {
    scene.stopRenderLoop();
  }
}

main().catch(console.error);
