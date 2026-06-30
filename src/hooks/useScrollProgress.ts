import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import { SCROLL_TRACK_VH } from "../constants";
import { galleryProgressFrom } from "../gallery";

// Use the animation scroll-track height as the denominator so that content
// placed after the track (e.g. the text section) doesn't dilute progress.
function computeTrackMax(): number {
  if (typeof window === "undefined") return 0;
  return ((SCROLL_TRACK_VH - 100) / 100) * window.innerHeight;
}

// Latest scroll progress (0..1) exposed as a ref — updated on scroll WITHOUT a
// React state update, so the animation can be driven imperatively from useFrame
// instead of re-rendering the whole scene on every scroll tick.
export function useScrollProgressRef(): MutableRefObject<number> {
  const progress = useRef<number>(0);

  useEffect(() => {
    // Cache the track height and only refresh it when the viewport WIDTH changes
    // (orientation / desktop resize). On mobile the URL bar collapsing changes
    // innerHeight mid-scroll — recomputing then would jump progress and stutter.
    let trackMax = computeTrackMax();
    let lastWidth = window.innerWidth;

    const read = () => {
      progress.current =
        trackMax > 0 ? Math.min(Math.max(window.scrollY / trackMax, 0), 1) : 0;
    };

    const onResize = () => {
      if (window.innerWidth !== lastWidth) {
        lastWidth = window.innerWidth;
        trackMax = computeTrackMax();
      }
      read();
    };

    window.addEventListener("scroll", read, { passive: true });
    window.addEventListener("resize", onResize);
    read();

    return () => {
      window.removeEventListener("scroll", read);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return progress;
}

// Latest GALLERY progress (0..1) as a ref — scroll BEYOND the animation track.
// Separate from useScrollProgressRef so the animation timeline (sp) is wholly
// unchanged; both read window.scrollY in their own passive listener (cheap).
export function useGalleryProgressRef(): MutableRefObject<number> {
  const progress = useRef<number>(0);

  useEffect(() => {
    // Cache innerHeight the SAME way useScrollProgressRef caches trackMax
    // (recompute only on WIDTH change). This is LOAD-BEARING: galleryProgressFrom
    // derives the anim-track boundary (animY) from this height, and sp saturates to
    // 1 at scrollY = ((SCROLL_TRACK_VH-100)/100)·trackMax-height. If gp used LIVE
    // innerHeight while sp uses the cached one, the two boundaries diverge whenever
    // the mobile URL bar collapses (innerHeight grows): sp caps at 1 while gp is
    // still 0 → a DEAD ZONE at the sp→gp seam where the scrub freezes on the
    // boundary frame (~247) until the user scrolls past it, and scrolling back
    // jumps. One shared, stable height keeps the seam continuous.
    let ih = window.innerHeight;
    let lastWidth = window.innerWidth;

    const read = () => {
      progress.current = galleryProgressFrom(window.scrollY, ih);
    };
    const onResize = () => {
      if (window.innerWidth !== lastWidth) {
        lastWidth = window.innerWidth;
        ih = window.innerHeight;
      }
      read();
    };

    window.addEventListener("scroll", read, { passive: true });
    window.addEventListener("resize", onResize);
    read();
    return () => {
      window.removeEventListener("scroll", read);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return progress;
}
