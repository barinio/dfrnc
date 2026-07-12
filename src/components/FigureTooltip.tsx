import { useEffect, useRef } from "react";
import { figureRectsLive } from "../figureHover";

// Award tooltip for the flying glass figures (supervisor brief): hovering a
// figure (tapping on touch) shows its award name pinned to the cursor, ABOVE-
// LEFT of the point. 0.25s fade-in / 1.5s opacity fade-out (see index.css).
// Pure DOM overlay driven by rAF — hit-tests the live NDC rects the ArcModels
// publish each frame (figureRectsLive), so a figure flying UNDER a still
// cursor still triggers it. No React state: the figures are scroll-driven and
// the tooltip follows at frame rate.

// How long a TAP keeps the tooltip readable before the fade-out starts (touch
// has no hover life; fade-in 0.25s + this + 1.5s fade-out ≈ 3s on screen).
const TAP_HOLD_MS = 1200;
// Gap between the pointer position and the tooltip's bottom-right corner.
const GAP_PX = 12;
// Keep the tooltip inside the viewport when the pointer is near an edge.
const EDGE_PX = 4;

export default function FigureTooltip() {
  const elRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    // Pre-warm the brand font: @font-face only loads on first USE, and the
    // tooltip holds no text until the first hover — without this the very
    // first caption would flash the fallback grotesque.
    document.fonts?.load('16px "Founders Grotesk"').catch(() => {});

    // The figures' rects are NDC of the canvas layer (100svh tall — can differ
    // from innerHeight once the mobile URL bar hides), so convert pointer
    // coords against the layer's own box, not the window.
    const layer = document.querySelector(".canvas-layer");

    const ptr = { x: 0, y: 0, has: false };
    let shownLabel: string | null = null;
    let followCursor = true;
    let tapTimer = 0;

    const hitLabel = (clientX: number, clientY: number): string | null => {
      const r = layer?.getBoundingClientRect();
      const left = r?.left ?? 0;
      const top = r?.top ?? 0;
      const w = r?.width || window.innerWidth;
      const h = r?.height || window.innerHeight;
      const x = ((clientX - left) / w) * 2 - 1;
      const y = -(((clientY - top) / h) * 2 - 1);
      for (const rect of figureRectsLive.values()) {
        if (!rect.visible) continue;
        if (x >= rect.minX && x <= rect.maxX && y >= rect.minY && y <= rect.maxY)
          return rect.label;
      }
      return null;
    };

    const show = (label: string) => {
      if (shownLabel !== label) el.textContent = label;
      shownLabel = label;
      el.classList.add("figure-tooltip--show");
    };
    const hide = () => {
      shownLabel = null;
      el.classList.remove("figure-tooltip--show");
    };

    // Pin the tooltip's bottom-right corner just above-left of the pointer.
    const place = (cx: number, cy: number) => {
      const x = Math.max(EDGE_PX, cx - el.offsetWidth - GAP_PX);
      const y = Math.max(EDGE_PX, cy - el.offsetHeight - GAP_PX);
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      ptr.x = e.clientX;
      ptr.y = e.clientY;
      ptr.has = true;
    };
    // Touch: a tap on a figure anchors the tooltip at the tap point, holds it
    // readable, then lets the 1.5s fade run. A tap elsewhere dismisses early.
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      window.clearTimeout(tapTimer);
      const label = hitLabel(e.clientX, e.clientY);
      if (label) {
        followCursor = false;
        show(label);
        place(e.clientX, e.clientY);
        tapTimer = window.setTimeout(() => {
          followCursor = true;
          hide();
        }, 250 + TAP_HOLD_MS);
      } else if (shownLabel !== null) {
        followCursor = true;
        hide();
      }
    };

    let raf = 0;
    const tick = () => {
      // Re-test every frame (not only on pointermove): the figures fly, so a
      // rect can enter/leave a STILL cursor.
      if (ptr.has && followCursor) {
        const label = hitLabel(ptr.x, ptr.y);
        if (label) show(label);
        else if (shownLabel !== null) hide();
        // Keep following the cursor while visible AND during the fade-out —
        // the caption stays pinned to the cursor for its whole life.
        place(ptr.x, ptr.y);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(tapTimer);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
    };
  }, []);

  return <div ref={elRef} className="figure-tooltip" aria-hidden="true" />;
}
