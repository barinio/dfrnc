import { useEffect, useState } from "react";
import { SCROLL_TRACK_VH } from "../constants";

// Use the animation scroll-track height as the denominator so that content
// placed after the track (e.g. a text section) doesn't dilute scrollProgress
// and cause the animation to never reach 1.0.
function readProgress(): number {
  if (typeof window === "undefined") return 0;
  const trackMax = ((SCROLL_TRACK_VH - 100) / 100) * window.innerHeight;
  if (trackMax <= 0) return 0;
  return Math.min(Math.max(window.scrollY / trackMax, 0), 1);
}

export function useScrollProgress(): number {
  const [progress, setProgress] = useState<number>(() => readProgress());

  useEffect(() => {
    let raf = 0;
    let queued = false;

    const tick = () => {
      queued = false;
      setProgress(readProgress());
    };

    const onScroll = () => {
      if (queued) return;
      queued = true;
      raf = window.requestAnimationFrame(tick);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    // Sync once on mount in case the document already scrolled before hydration.
    onScroll();

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, []);

  return progress;
}
