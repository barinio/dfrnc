import { playLottie } from './lottie-player.js';

async function main() {
  await playLottie('lottie-layer', 'assets/animation.json');
  console.log('Lottie complete');
}

main();
