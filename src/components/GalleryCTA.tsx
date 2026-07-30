import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
// Inline the wordmark as raw SVG markup so the link's hit-box keeps the exact
// aspect the visual has. The VISUAL itself moved into the canvas (CtaWordmark)
// so the last card can genuinely dissolve ON TOP of it — this DOM overlay is
// now only the invisible mailto hit-area (and focus ring) above the canvas.
import ctaWordmarkRaw from "../assets/cta.svg?raw";

const ctaWordmark = ctaWordmarkRaw.slice(ctaWordmarkRaw.indexOf("<svg"));

interface Props {
  // Card-exit ramp, written by CardStack (galleryCtaRevealFor): 0 through the
  // last card's hold, 1 once it has fully dissolved. Gates interactivity.
  ctaRevealRef: MutableRefObject<number>;
}

export default function GalleryCTA({ ctaRevealRef }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const op = ctaRevealRef.current;
      const wrap = wrapRef.current;
      if (wrap) {
        // Opacity only affects the focus ring (the wordmark span is opacity:0);
        // hit-testing ignores opacity, so the gate is pointer-events.
        wrap.style.opacity = String(op);
        wrap.style.pointerEvents = op > 0.5 ? "auto" : "none";
        wrap.setAttribute("aria-hidden", op > 0.5 ? "false" : "true");
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ctaRevealRef]);

  return (
    <div ref={wrapRef} className="gallery-cta">
      <a
        className="gallery-cta__link"
        href="mailto:hi@deft.ch"
        aria-label="Get in touch"
      >
        <span
          className="gallery-cta__wordmark"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: ctaWordmark }}
        />
      </a>
    </div>
  );
}
