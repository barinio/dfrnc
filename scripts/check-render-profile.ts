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
eq(safariPhone.dpr[1], 2, "iOS Safari renders up to 2x so the typography/figures aren't staircased (adaptive floor stays 1x)");
eq(safariPhone.dpr[0], 1, "iOS Safari can still drop to 1x under load (adaptive floor)");
eq(safariPhone.enablePostFx, false, "Safari skips postprocessing");
eq(safariPhone.antialias, false, "Safari relies on 2x supersampling (not MSAA) for AA — keeps the higher DPR affordable on weaker phones");
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

const chromeWide = createRenderProfile({ userAgent: chromeDesktop, width: 1280 });
eq(chromeWide.dpr[1], 1.5, "desktop Chrome keeps the existing DPR cap");
eq(chromeWide.enablePostFx, true, "desktop Chrome keeps postprocessing");
eq(chromeWide.antialias, false, "desktop Chrome uses SMAA instead of MSAA");
eq(chromeWide.figureMaterialMode, "full", "desktop Chrome keeps full figure materials");
eq(chromeWide.enableEnvironment, true, "desktop Chrome keeps PMREM environment");
eq(chromeWide.maxCanvasTextureDpr, 1.5, "desktop Chrome caps Lottie upload DPR");
eq(chromeWide.textureFrameRate, 30, "desktop Chrome caps canvas-texture upload rate");

console.log("render profile assertions passed");
