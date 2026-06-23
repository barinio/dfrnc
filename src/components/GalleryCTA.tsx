import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import { galleryCtaFor } from "../gallery";
import { tiltTarget, idleTilt, approach, TILT_RATE } from "../cursorTilt";

interface Props {
  galleryRef: MutableRefObject<number>;
  reducedMotion?: boolean;
}

export default function GalleryCTA({ galleryRef, reducedMotion = false }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLAnchorElement>(null);
  const rotX = useRef(0);
  const rotY = useRef(0);
  const ptr = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      ptr.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      ptr.current.y = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener("pointermove", onMove);

    let raf = 0;
    let last = performance.now();
    let elapsed = 0;
    const tick = (now: number) => {
      const delta = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      elapsed += delta;
      const op = galleryCtaFor(galleryRef.current);
      const wrap = wrapRef.current;
      const inner = innerRef.current;
      if (wrap) {
        wrap.style.opacity = String(op);
        wrap.style.pointerEvents = op > 0.5 ? "auto" : "none";
        wrap.setAttribute("aria-hidden", op > 0.5 ? "false" : "true");
      }
      if (inner) {
        const tt = tiltTarget(ptr.current.x, ptr.current.y, reducedMotion);
        const it = idleTilt(elapsed, reducedMotion);
        rotX.current = approach(rotX.current, tt.x + it.x, delta, TILT_RATE);
        rotY.current = approach(rotY.current, tt.y + it.y, delta, TILT_RATE);
        // radians → small degrees for CSS; X tilt is rotateX (pitch).
        const rx = (rotX.current * 180) / Math.PI;
        const ry = (rotY.current * 180) / Math.PI;
        inner.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, [galleryRef, reducedMotion]);

  return (
    <div ref={wrapRef} className="gallery-cta">
      <a ref={innerRef} className="gallery-cta__link" href="mailto:hi@deft.ch">
        «small call to action, yet to be worded.»
      </a>
    </div>
  );
}
