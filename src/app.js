import { playLottie } from './lottie-player.js';
import { ThreeScene } from './three-scene.js';

async function main() {
  const scene = new ThreeScene('three-layer');

  // Preload model while Lottie plays
  const modelPromise = scene.loadModel('assets/model.glb');

  await playLottie('lottie-layer', 'assets/animation.json');
  await modelPromise;

  // Temporarily show model at center to verify it loaded
  scene.model.position.set(0, 0, 0);
  scene.showModel();
  console.log('Model visible at center');
}

main();
