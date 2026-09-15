// Render-profile assertions for browser-specific performance budgets.
// Run manually with: npx tsx scripts/check-render-profile.ts
import { readFileSync } from "node:fs";
import {
  browserNeedsConservativeRenderProfile,
  createRenderProfile,
} from "../src/renderProfile";

function eq<T>(actual: T, expected: T, label: string) {
  if (actual !== expected)
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}

function ok(cond: boolean, label: string) {
  if (!cond) throw new Error(label);
}

const safariIOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const safariDesktop =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const chromeDesktop =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const firefoxDesktop =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:127.0) Gecko/20100101 Firefox/127.0";
const chromeAndroid =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.71 Mobile Safari/537.36";
const chromeAndroidTablet =
  "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

ok(
  browserNeedsConservativeRenderProfile(safariIOS),
  "iOS Safari gets the conservative render profile",
);
ok(
  browserNeedsConservativeRenderProfile(safariDesktop),
  "desktop Safari gets the conservative render profile",
);
ok(
  !browserNeedsConservativeRenderProfile(chromeDesktop),
  "desktop Chrome keeps the full render profile",
);
ok(
  browserNeedsConservativeRenderProfile(firefoxDesktop),
  "desktop Firefox gets the conservative render profile",
);
// Android Chrome is a PHONE GPU with a desktop-Chrome user agent string: it used
// to fall through to the full desktop profile (EffectComposer + PMREM studio HDR
// + highp), which is exactly the budget a mid-range phone cannot pay while the
// transmission glass is on screen. Every mobile Android browser (Chrome, Samsung
// Internet, the WebViews) carries "Android" in the UA, so that single token
// routes them all to the same lightened profile iOS already gets.
ok(
  browserNeedsConservativeRenderProfile(chromeAndroid),
  "Android Chrome (phone) gets the conservative render profile",
);
ok(
  browserNeedsConservativeRenderProfile(chromeAndroidTablet),
  "Android Chrome (tablet, no Mobile token) gets the conservative render profile",
);

const safariPhone = createRenderProfile({ userAgent: safariIOS, width: 390 });
eq(safariPhone.dpr[1], 2, "iOS Safari renders at a FIXED 2x so the typography/figures aren't staircased");
eq(safariPhone.dpr[0], 1, "iOS Safari keeps 1x as the range floor (inert: nothing regresses the DPR on mobile)");
eq(safariPhone.adaptiveDpr, false, "iOS Safari never regresses the DPR — 0.45x2 = 0.9 device pixels on a 3x panel was the pixelated-phone bug");
eq(safariPhone.enablePostFx, false, "Safari skips postprocessing");
eq(safariPhone.antialias, true, "Safari turns MSAA on — with no post-FX it is the only thing that antialiases the alpha-tested title edges");
eq(safariPhone.precision, "mediump", "Safari uses the lightweight shader precision");
eq(safariPhone.figureMaterialMode, "full", "Safari keeps color-preserving figure materials");
eq(safariPhone.enableEnvironment, false, "Safari skips PMREM environment setup");
eq(safariPhone.maxCanvasTextureDpr, 2, "iOS Safari renders the Lottie text canvas at 2x so the letters are crisp");
eq(safariPhone.textureFrameRate, 30, "Safari caps canvas-texture upload rate");

const safariWide = createRenderProfile({ userAgent: safariDesktop, width: 1280 });
eq(safariWide.dpr[1], 1.5, "desktop Safari canvas DPR raised for crisper typography/figures");
eq(safariWide.maxCanvasTextureDpr, 1.5, "desktop Safari Lottie upload DPR raised");

const firefoxWide = createRenderProfile({ userAgent: firefoxDesktop, width: 1280 });
eq(firefoxWide.enablePostFx, false, "desktop Firefox skips postprocessing");
eq(firefoxWide.figureMaterialMode, "full", "desktop Firefox keeps color-preserving figure materials");

const androidPhone = createRenderProfile({ userAgent: chromeAndroid, width: 412 });
eq(androidPhone.enablePostFx, false, "Android Chrome skips postprocessing");
eq(androidPhone.enableEnvironment, false, "Android Chrome skips PMREM environment setup");
eq(androidPhone.precision, "highp", "Android computes in highp — Adreno mediump (real fp16) NaNs the glass iridescence/dispersion into black blotches");
eq(androidPhone.dpr[1], 2, "Android Chrome renders at a fixed 2x like the other narrow conservative devices");
eq(androidPhone.adaptiveDpr, false, "Android Chrome also holds its DPR instead of collapsing it under load");
eq(androidPhone.antialias, true, "Android Chrome turns MSAA on for the alpha-tested title edges");
eq(androidPhone.figureMaterialMode, "full", "Android Chrome keeps color-preserving figure materials");

const chromeWide = createRenderProfile({ userAgent: chromeDesktop, width: 1280 });
eq(chromeWide.dpr[1], 1.5, "desktop Chrome keeps the existing DPR cap");
eq(chromeWide.enablePostFx, true, "desktop Chrome keeps postprocessing");
eq(chromeWide.antialias, false, "desktop Chrome uses SMAA instead of MSAA");
eq(chromeWide.adaptiveDpr, true, "desktop keeps the adaptive DPR loop — its 1.5x ceiling makes a regression cheap to look at");
eq(chromeWide.figureMaterialMode, "full", "desktop Chrome keeps full figure materials");
eq(chromeWide.enableEnvironment, true, "desktop Chrome keeps PMREM environment");
eq(chromeWide.maxCanvasTextureDpr, 1.5, "desktop Chrome caps Lottie upload DPR");
eq(chromeWide.textureFrameRate, 30, "desktop Chrome caps canvas-texture upload rate");

const sceneSource = readFileSync(
  new URL("../src/components/Scene.tsx", import.meta.url),
  "utf8",
);
const videoPlaneSource = readFileSync(
  new URL("../src/components/VideoPlane.tsx", import.meta.url),
  "utf8",
);
ok(/<AdaptiveDpr\s*\/>/.test(sceneSource), "R3F performance regression drives DPR where it is enabled");
ok(
  /\{renderProfile\.adaptiveDpr\s*&&\s*\(/.test(sceneSource),
  "the DPR regression loop (<AdaptiveDpr /> + PerformanceRegressor) is mounted only when the profile allows it",
);
ok(
  sceneSource.indexOf("renderProfile.adaptiveDpr") < sceneSource.indexOf("<AdaptiveDpr"),
  "the adaptiveDpr gate wraps <AdaptiveDpr />, it does not follow it",
);
ok(
  !/<AdaptiveDpr[^>]*\bpixelated\b/.test(sceneSource),
  "adaptive DPR keeps temporary reduced resolution filtered",
);
ok(
  /const tier\s*=\s*frameTierForScreen\(\)/.test(videoPlaneSource) &&
    /frameLoaderBudgetFor\(tier\)/.test(videoPlaneSource) &&
    /onStartupReady\s*:/.test(videoPlaneSource),
  "video readiness uses staged decoded startup coverage and tier budgets",
);
ok(
  /startupReady\s*:\s*loader\.startupReady/.test(videoPlaneSource) &&
    /startupLoadedCount\s*:\s*loader\.startupLoadedCount/.test(videoPlaneSource) &&
    /inFlight\s*:\s*loader\.inFlightCount/.test(videoPlaneSource),
  "video diagnostics expose staged startup state",
);

console.log("render profile assertions passed");
