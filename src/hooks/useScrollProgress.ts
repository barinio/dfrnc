import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import {
  createScrollTimelineController,
  writeScrollTimelineRefs,
} from "../scrollTimelineController";
import type {
  GalleryMode,
  ScrollTimelineController,
  ScrollTimelineEventTarget,
  ScrollTimelinePublication,
} from "../scrollTimelineController";

export interface ScrollTimelineRefs {
  scrollRef: MutableRefObject<number>;
  galleryRef: MutableRefObject<number>;
}

interface ScrollTimelineDiagnostic {
  scrollY: number;
  sp: number;
  gp: number;
  clipT: number;
  galleryMode: GalleryMode;
  galleryStep: number;
}

declare global {
  interface Window {
    __sg?: ScrollTimelineDiagnostic;
  }
}

export function useScrollTimelineRefs(
  reducedMotion: boolean,
): ScrollTimelineRefs {
  const scrollRef = useRef(0);
  const galleryRef = useRef(0);
  const reducedMotionRef = useRef(reducedMotion);
  const controllerRef = useRef<ScrollTimelineController | null>(null);
  reducedMotionRef.current = reducedMotion;

  useEffect(() => {
    let diagnostic: ScrollTimelineDiagnostic | undefined;
    const timelineRefs = { scrollRef, galleryRef };
    const controller = createScrollTimelineController({
      environment: {
        windowTarget: window as unknown as ScrollTimelineEventTarget,
        documentTarget: document as unknown as ScrollTimelineEventTarget,
        readScrollY: () => window.scrollY,
        readInnerHeight: () => window.innerHeight,
        readInnerWidth: () => window.innerWidth,
        readVisibilityState: () => document.visibilityState,
        readNow: () => performance.now(),
        setTimeout: (callback, delayMs) =>
          window.setTimeout(callback, delayMs),
        clearTimeout: (id) => window.clearTimeout(id),
        requestFrame: (callback) => window.requestAnimationFrame(callback),
        cancelFrame: (id) => window.cancelAnimationFrame(id),
        scrollTo: (options) => window.scrollTo(options),
      },
      reducedMotion: () => reducedMotionRef.current,
      onPublish: (publication: ScrollTimelinePublication) => {
        writeScrollTimelineRefs(timelineRefs, publication);
        if (!import.meta.env.DEV) return;
        diagnostic = {
          scrollY: publication.scrollY,
          sp: publication.sp,
          gp: publication.gp,
          clipT: publication.clipT,
          galleryMode: publication.galleryMode,
          galleryStep: publication.galleryStep,
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

  return { scrollRef, galleryRef };
}
