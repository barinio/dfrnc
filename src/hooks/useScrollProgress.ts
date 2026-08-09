import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import {
  createScrollTimelineController,
  writeScrollTimelineRefs,
} from "../scrollTimelineController";
import type {
  ScrollTimelineController,
  ScrollTimelineEventTarget,
  ScrollTimelinePublication,
} from "../scrollTimelineController";

export interface ScrollTimelineRefs {
  scrollRef: MutableRefObject<number>;
  galleryRef: MutableRefObject<number>;
  virtualYRef: MutableRefObject<number>;
}

interface ScrollGovernorDiagnostic {
  rawY: number;
  virtualY: number;
  sp: number;
  gp: number;
  clipT: number;
  gestureActive: boolean;
  gestureLocksGallery: boolean;
  discardedForwardPx: number;
}

declare global {
  interface Window {
    __sg?: ScrollGovernorDiagnostic;
  }
}

function validViewportHeight(value: number, fallback = 1): number {
  if (Number.isFinite(value) && value > 0) return value;
  if (Number.isFinite(fallback) && fallback > 0) return fallback;
  return 1;
}

function documentScrollEnd(): number {
  const root = document.documentElement;
  const body = document.body;
  const scrollHeight = Math.max(
    root.scrollHeight,
    root.offsetHeight,
    root.clientHeight,
    body?.scrollHeight ?? 0,
    body?.offsetHeight ?? 0,
    body?.clientHeight ?? 0,
  );
  const viewportHeight = validViewportHeight(
    window.innerHeight,
    root.clientHeight,
  );
  const end = scrollHeight - viewportHeight;
  return Number.isFinite(end) ? Math.max(end, 0) : 0;
}

export function useScrollTimelineRefs(
  reducedMotion: boolean,
): ScrollTimelineRefs {
  const scrollRef = useRef(0);
  const galleryRef = useRef(0);
  const virtualYRef = useRef(0);
  const reducedMotionRef = useRef(reducedMotion);
  const controllerRef = useRef<ScrollTimelineController | null>(null);
  reducedMotionRef.current = reducedMotion;

  useEffect(() => {
    let diagnostic: ScrollGovernorDiagnostic | undefined;
    const timelineRefs = { scrollRef, galleryRef, virtualYRef };
    const controller = createScrollTimelineController({
      environment: {
        windowTarget: window as unknown as ScrollTimelineEventTarget,
        documentTarget: document as unknown as ScrollTimelineEventTarget,
        readScrollY: () => window.scrollY,
        readInnerHeight: () => window.innerHeight,
        readInnerWidth: () => window.innerWidth,
        readDocumentEnd: documentScrollEnd,
        readRootScrollEnabled: () =>
          !document.body.classList.contains("scroll-locked"),
        readVisibilityState: () => document.visibilityState,
        setTimeout: (callback, delayMs) =>
          window.setTimeout(callback, delayMs),
        clearTimeout: (id) => window.clearTimeout(id),
        scrollTo: (options) => window.scrollTo(options),
      },
      reducedMotion: () => reducedMotionRef.current,
      onPublish: (publication: ScrollTimelinePublication) => {
        writeScrollTimelineRefs(timelineRefs, publication);
        if (!import.meta.env.DEV) return;
        diagnostic = {
          rawY: publication.rawY,
          virtualY: publication.virtualY,
          sp: publication.sp,
          gp: publication.gp,
          clipT: publication.clipT,
          gestureActive: publication.gestureActive,
          gestureLocksGallery: publication.gestureLocksGallery,
          discardedForwardPx: publication.discardedForwardPx,
        };
        window.__sg = diagnostic;
      },
    });
    controllerRef.current = controller;

    return () => {
      if (controllerRef.current === controller) controllerRef.current = null;
      controller.dispose();
      if (window.__sg === diagnostic) delete window.__sg;
    };
  }, []);

  useEffect(() => {
    controllerRef.current?.syncReducedMotion();
  }, [reducedMotion]);

  return { scrollRef, galleryRef, virtualYRef };
}
