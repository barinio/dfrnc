import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import { galleryCtaFromExit } from "../gallery";
import { approach, idleTilt } from "../cursorTilt";
// Inline the wordmark as raw SVG markup so it stays crisp vector and keeps its
// baked-in white (#fff) fills. `?raw` is typed by vite/client. Strip the XML
// prolog/comment so only the <svg> element is injected into the DOM.
import ctaWordmarkRaw from "../assets/cta.svg?raw";

const RAD2DEG = 180 / Math.PI;
// Accentuated, deliberately stronger than the subtle card/figure hover
// (cursorTilt's TILT_MAX is ~4°). This is the final "slide" — make it feel
// alive with a pronounced parallax tilt toward the cursor.
const CTA_TILT_MAX_DEG = 16; // peak pitch/yaw at the screen edges
const CTA_SHIFT_PX = 16; // peak parallax translate toward the cursor
const CTA_LIFT_PX = 30; // constant translateZ depth (perspective parallax)
const CTA_TILT_RATE = 5; // exponential easing rate toward the target

const ctaWordmark = ctaWordmarkRaw.slice(ctaWordmarkRaw.indexOf("<svg"));

interface Props {
  cardExitRef: MutableRefObject<number>;
  reducedMotion?: boolean;
}

export default function GalleryCTA({ cardExitRef, reducedMotion = false }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLAnchorElement>(null);
  const rotX = useRef(0);
  const rotY = useRef(0);
  const shiftX = useRef(0);
  const shiftY = useRef(0);
  const ptr = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      ptr.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      ptr.current.y = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    // Ease back to neutral when the cursor leaves the window or it loses focus.
    const recenter = () => {
      ptr.current.x = 0;
      ptr.current.y = 0;
    };
    const onOut = (e: PointerEvent) => {
      if (e.relatedTarget === null) recenter();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerout", onOut);
    window.addEventListener("blur", recenter);

    let raf = 0;
    let last = performance.now();
    let elapsed = 0;
    const tick = (now: number) => {
      const delta = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      elapsed += delta;
      const op = galleryCtaFromExit(cardExitRef.current);
      const wrap = wrapRef.current;
      const inner = innerRef.current;
      if (wrap) {
        wrap.style.opacity = String(op);
        wrap.style.pointerEvents = op > 0.5 ? "auto" : "none";
        wrap.setAttribute("aria-hidden", op > 0.5 ? "false" : "true");
      }
      if (inner) {
        if (reducedMotion) {
          inner.style.transform = "none";
        } else {
          // Idle drift keeps the wordmark breathing when the cursor is still.
          const it = idleTilt(elapsed, false);
          const targetRX = -ptr.current.y * CTA_TILT_MAX_DEG + it.x * RAD2DEG;
          const targetRY = ptr.current.x * CTA_TILT_MAX_DEG + it.y * RAD2DEG;
          const targetSX = ptr.current.x * CTA_SHIFT_PX;
          const targetSY = -ptr.current.y * CTA_SHIFT_PX;
          rotX.current = approach(rotX.current, targetRX, delta, CTA_TILT_RATE);
          rotY.current = approach(rotY.current, targetRY, delta, CTA_TILT_RATE);
          shiftX.current = approach(shiftX.current, targetSX, delta, CTA_TILT_RATE);
          shiftY.current = approach(shiftY.current, targetSY, delta, CTA_TILT_RATE);
          inner.style.transform =
            `translate3d(${shiftX.current.toFixed(2)}px, ${shiftY.current.toFixed(2)}px, ${CTA_LIFT_PX}px) ` +
            `rotateX(${rotX.current.toFixed(2)}deg) rotateY(${rotY.current.toFixed(2)}deg)`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerout", onOut);
      window.removeEventListener("blur", recenter);
      cancelAnimationFrame(raf);
    };
  }, [cardExitRef, reducedMotion]);

  return (
    <div ref={wrapRef} className="gallery-cta">
      <a
        ref={innerRef}
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
