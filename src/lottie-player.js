// Plays the Lottie animation once and resolves when it completes.
// After complete, the last frame stays visible at reduced opacity.
export function playLottie(containerId, animationPath) {
  return new Promise((resolve, reject) => {
    const container = document.getElementById(containerId);
    if (!container) {
      reject(new Error(`Container not found: ${containerId}`));
      return;
    }

    const anim = lottie.loadAnimation({
      container,
      renderer: 'svg',
      loop: false,
      autoplay: true,
      path: animationPath,
      rendererSettings: {
        preserveAspectRatio: 'xMidYMid meet',
      },
    });

    anim.addEventListener('error', () => {
      reject(new Error(`Failed to load animation: ${animationPath}`));
    });

    anim.addEventListener('complete', () => {
      // Freeze last frame — fade container to low opacity
      gsap.to(container, {
        opacity: 0.15,
        duration: 0.6,
        ease: 'power2.inOut',
        onComplete: resolve,
      });
    });
  });
}
