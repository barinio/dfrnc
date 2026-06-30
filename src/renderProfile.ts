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
      // Render at up to 2× (phones) / 1.5× (desktop Safari/FF) — capped well below
      // the phone's native 3× to stay light, but far above 1× so the Lottie
      // typography + glass figures aren't staircased on a high-DPR screen. The
      // range is ADAPTIVE: R3F + PerformanceRegressor scale it down toward 1×
      // on a struggling device, so capable phones get the crisp pass for free
      // while weaker ones self-optimize.
      dpr: [1, narrow ? 2 : 1.5],
      performanceMin: 0.45,
      performanceDebounce: 700,
      // Tolerant regressor: only scale the DPR down after SUSTAINED slowness, not
      // on a brief dip — so a weaker phone HOLDS the crisp 2× pass (far nicer than
      // a jagged 1×) instead of twitching down. R3F still drops it if a device
      // genuinely can't keep up over time.
      slowFrameMs: 28,
      slowFrameLimit: 10,
      enablePostFx: false,
      // Antialiasing comes from the 2× supersampling (DPR above) — that already
      // smooths both the typography and the glass-figure edges. MSAA is left OFF:
      // it added the most GPU cost for the least extra gain, so dropping it keeps
      // the higher DPR affordable on weaker phones without changing the look.
      antialias: false,
      precision: "mediump",
      // Render the Lottie/title canvas at the same higher DPR so the text SOURCE
      // is crisp (otherwise a low-res texture just gets magnified on the 2× canvas).
      maxCanvasTextureDpr: narrow ? 2 : 1.5,
      textureFrameRate: 30,
      figureMaterialMode: "full",
      enableEnvironment: false,
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
  };
}
