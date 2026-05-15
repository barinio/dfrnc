// Plays the Lottie animation once and resolves when it completes.
// After complete, the last frame stays visible at reduced opacity.
export function playLottie(containerId, animationPath) {
  return new Promise((resolve) => {
    const container = document.getElementById(containerId);

    const anim = lottie.loadAnimation({
      container,
      renderer: 'canvas',
      loop: false,
      autoplay: true,
      path: animationPath,
      rendererSettings: {
        preserveAspectRatio: 'xMidYMid meet',
        clearCanvas: false,
      },
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
