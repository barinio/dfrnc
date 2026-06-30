export type FigureMaterialMode = "full" | "light";

export interface RenderProfile {
  dpr: [number, number];
  performanceMin: number;
  performanceDebounce: number;
  slowFrameMs: number;
  slowFrameLimit: number;
  enablePostFx: boolean;
  antialias: boolean;
  precision: "highp" | "mediump" | "lowp";
  maxCanvasTextureDpr: number;
  textureFrameRate: number;
  figureMaterialMode: FigureMaterialMode;
  enableEnvironment: boolean;
  safeVideoHandoff: boolean;
}

export interface RenderProfileInput {
  userAgent?: string;
  width?: number;
}

function currentUserAgent(): string {
  return typeof navigator === "undefined" ? "" : navigator.userAgent;
}

function currentWidth(): number {
  return typeof window === "undefined" ? 1024 : window.innerWidth;
}

export function browserNeedsConservativeRenderProfile(
  userAgent = currentUserAgent(),
): boolean {
  const isFirefox = /Firefox\//.test(userAgent);
  const isSafari =
    /Safari\//.test(userAgent) &&
    !/Chrom(e|ium)\//.test(userAgent) &&
    !/CriOS\//.test(userAgent);
  const isIOS = /iP(ad|hone|od)/.test(userAgent);
  return isFirefox || isSafari || isIOS;
}

export function createRenderProfile(input: RenderProfileInput = {}): RenderProfile {
  const width = input.width ?? currentWidth();
  const narrow = width < 900;
  const conservative = browserNeedsConservativeRenderProfile(input.userAgent);

  if (conservative) {
    return {
      dpr: [1, narrow ? 1 : 1.15],
      performanceMin: 0.45,
      performanceDebounce: 700,
      slowFrameMs: 20,
      slowFrameLimit: 5,
      enablePostFx: false,
      antialias: false,
      precision: "mediump",
      maxCanvasTextureDpr: narrow ? 1 : 1.15,
      textureFrameRate: 30,
      figureMaterialMode: "full",
      enableEnvironment: false,
      safeVideoHandoff: false,
    };
  }

  return {
    dpr: [1, narrow ? 1.25 : 1.5],
    performanceMin: 0.65,
    performanceDebounce: 500,
    slowFrameMs: 24,
    slowFrameLimit: 8,
    enablePostFx: true,
    antialias: false,
    precision: "highp",
    maxCanvasTextureDpr: narrow ? 1.1 : 1.5,
    textureFrameRate: 30,
    figureMaterialMode: "full",
    enableEnvironment: true,
    safeVideoHandoff: false,
  };
}
