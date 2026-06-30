// Render-profile assertions for browser-specific performance budgets.
// Run manually with: npx tsx scripts/check-render-profile.ts
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

const safariPhone = createRenderProfile({ userAgent: safariIOS, width: 390 });
eq(safariPhone.dpr[1], 1, "iOS Safari uses the lightweight canvas DPR");
eq(safariPhone.enablePostFx, false, "Safari skips postprocessing");
eq(safariPhone.antialias, false, "Safari skips MSAA");
eq(safariPhone.precision, "mediump", "Safari uses the lightweight shader precision");
eq(safariPhone.figureMaterialMode, "full", "Safari keeps color-preserving figure materials");
eq(safariPhone.enableEnvironment, false, "Safari skips PMREM environment setup");
eq(safariPhone.maxCanvasTextureDpr, 1, "iOS Safari Lottie upload DPR is capped to 1x");
eq(safariPhone.textureFrameRate, 30, "Safari caps canvas-texture upload rate");
eq(safariPhone.safeVideoHandoff, false, "Safari keeps the live video visible through the gallery text handoff");

const safariWide = createRenderProfile({ userAgent: safariDesktop, width: 1280 });
eq(safariWide.dpr[1], 1.15, "desktop Safari canvas DPR is capped lower than Chrome");
eq(safariWide.maxCanvasTextureDpr, 1.25, "desktop Safari Lottie upload DPR is capped");
eq(safariWide.safeVideoHandoff, false, "desktop Safari keeps the live video visible through the gallery text handoff");

const firefoxWide = createRenderProfile({ userAgent: firefoxDesktop, width: 1280 });
eq(firefoxWide.enablePostFx, false, "desktop Firefox skips postprocessing");
eq(firefoxWide.figureMaterialMode, "full", "desktop Firefox keeps color-preserving figure materials");
eq(firefoxWide.safeVideoHandoff, false, "desktop Firefox keeps the live video visible through the gallery text handoff");

const chromeWide = createRenderProfile({ userAgent: chromeDesktop, width: 1280 });
eq(chromeWide.dpr[1], 1.5, "desktop Chrome keeps the existing DPR cap");
eq(chromeWide.enablePostFx, true, "desktop Chrome keeps postprocessing");
eq(chromeWide.antialias, false, "desktop Chrome uses SMAA instead of MSAA");
eq(chromeWide.figureMaterialMode, "full", "desktop Chrome keeps full figure materials");
eq(chromeWide.enableEnvironment, true, "desktop Chrome keeps PMREM environment");
eq(chromeWide.maxCanvasTextureDpr, Infinity, "desktop Chrome keeps uncapped Lottie DPR");
eq(chromeWide.textureFrameRate, Infinity, "desktop Chrome keeps uncapped texture uploads");
eq(chromeWide.safeVideoHandoff, false, "desktop Chrome keeps the live WebGL video-card handoff");

console.log("render profile assertions passed");
