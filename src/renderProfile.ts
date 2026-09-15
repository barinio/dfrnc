export type FigureMaterialMode = "full" | "light";

export interface RenderProfile {
  dpr: [number, number];
  // Whether R3F's quality-regression loop (<AdaptiveDpr /> + the frame-time
  // regressor) is allowed to move the canvas DPR at runtime. False = the dpr
  // range's max is simply what the device renders at, forever.
  adaptiveDpr: boolean;
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
  // Android Chrome reports a DESKTOP-shaped UA ("Chrome/… Safari/537.36"), so it
  // used to fall through to the full desktop budget — EffectComposer (SMAA +
  // Noise + tone-mapping passes) plus a PMREM-convolved studio HDR pulled from a
  // CDN — on a phone GPU that also has to carry the transmission glass. Routing
  // every Android browser (Chrome, Samsung Internet, the WebViews all carry
  // "Android") to the same lightened profile iOS already uses is the point: the
  // conservative branch is a MOBILE profile, not a Safari/Firefox quirk list.
  const isAndroid = /Android/.test(userAgent);
  return isFirefox || isSafari || isIOS || isAndroid;
}

export function createRenderProfile(input: RenderProfileInput = {}): RenderProfile {
  const width = input.width ?? currentWidth();
  const narrow = width < 900;
  const conservative = browserNeedsConservativeRenderProfile(input.userAgent);
  // Adreno GPUs run mediump as REAL fp16: the glass shader's iridescence /
  // dispersion math overflows half-float range into NaN — big black blotches
  // with dithered edges that shimmer frame to frame (seen on a Redmi Note 8;
  // invisible on desktop where mediump ≥ fp32, and iOS GPUs clamp gracefully).
  // So Android keeps the lightened profile but computes in highp.
  const android = /Android/.test(input.userAgent ?? currentUserAgent());

  if (conservative) {
    return {
      // Render at a FIXED 2× (phones) / 1.5× (desktop Safari/FF) — capped well
      // below the phone's native 3× to stay light, but far above 1× so the Lottie
      // typography + glass figures aren't staircased on a high-DPR screen. The
      // range is NOT adaptive on mobile: with adaptiveDpr false the max below is
      // what the phone renders at for the whole session.
      dpr: [1, narrow ? 2 : 1.5],
      // The regression loop is OFF here. It was the phone bug, not the cure: the
      // transmission glass trips the slow-frame counter, R3F clamps
      // performance.current to performanceMin, and <AdaptiveDpr /> multiplies it
      // into the dpr — 0.45 × 2 = 0.9 device pixels, a ~351×684 backbuffer
      // smeared ×3.3 across an iPhone panel (pixelated Lottie type, pixelated
      // glass, pixelated video stills, all at once). Worse, it restores after the
      // debounce, re-trips, and oscillates — and every flip reallocates the
      // drawing buffer, which is a hitch of its own. A phone that can't hold 60
      // should drop FRAMES, not RESOLUTION.
      adaptiveDpr: false,
      // Inert while adaptiveDpr is false (nothing calls regress(), nothing reads
      // performance.current) — kept so every profile has the same shape.
      performanceMin: 0.45,
      performanceDebounce: 700,
      slowFrameMs: 28,
      slowFrameLimit: 10,
      enablePostFx: false,
      // MSAA ON — on mobile it is the ONLY edge antialiasing in the pipeline.
      // The title planes must stay OPAQUE + alphaTest (a transmissive material
      // only refracts opaque geometry, and the glass has to refract the type), so
      // their letterforms end at a hard alpha cut. alphaToCoverage turns that cut
      // into coverage — but coverage needs samples, and with enablePostFx false
      // there is no SMAA to fall back on. Without MSAA every letter is a binary
      // staircase at any DPR; 2× supersampling alone never fixed it. The cost is
      // affordable now that the DPR no longer thrashes.
      // (No transmission-RT relief to pair with it: three 0.170's WebGLRenderer
      // has no transmissionResolutionScale — that knob landed in r171 — so the
      // transmission pass keeps rendering at full drawing-buffer size.)
      antialias: true,
      precision: android ? "highp" : "mediump",
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
    // Desktop keeps the adaptive loop: the DPR ceiling is low (1.25–1.5), so a
    // regression costs far less visually than it does on a 3× phone panel.
    adaptiveDpr: true,
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
