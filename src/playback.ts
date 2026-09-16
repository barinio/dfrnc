import {
  DEFT_DROP_S,
  LOTTIE_INTRO_S,
  LOTTIE_TOTAL_S,
  REVEAL_END,
  LOTTIE_SCRUB_START,
  FIGURES_START,
  FIGURES_END,
  LOTTIE_END,
  LOTTIE_ZOOM_S,
  VIDEO_START,
  VIDEO_FADE,
  FIGURE_FADE,
  VIDEO_SPLIT,
  VID_FLY_END,
} from "./constants";

// Single source of truth for the scroll-driven timeline. LottiePlane, the
// ArcModels and VideoPlane all derive their per-frame state from these pure
// functions (read inside useFrame/rAF), so the experience is a function of
// scroll progress alone and never requires a React re-render to advance.
export type Phase = "scroll" | "done";

function smoothstep(x: number): number {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
}

function clamp01(x: number): number {
  return Math.min(Math.max(x, 0), 1);
}

// Lottie keyframe times are authored in comp frames, so seconds must be
// converted with the export's own frame rate. The export out-point is
// exclusive: its terminal time maps one frame past the drawable range and is
// therefore clamped to `totalFrames - 1`.
export function lottieFrameForTime(
  tSec: number,
  totalFrames: number,
  frameRate: number,
): number {
  if (!Number.isFinite(totalFrames) || totalFrames <= 0) return 0;
  if (!Number.isFinite(tSec) || !Number.isFinite(frameRate) || frameRate <= 0)
    return 0;
  const finalFrame = Math.max(totalFrames - 1, 0);
  return Math.min(Math.max(tSec * frameRate, 0), finalFrame);
}

// Lottie timeline (seconds). The reveal starts at DEFT_DROP_S — the loader has
// already auto-played [0, DEFT_DROP_S], and because the mapping never returns
// less than DEFT_DROP_S, scrolling back to the top can never re-enter the drop.
// Reduced-motion ("done") phase: hold the readable intro frame until the video
// is FULLY opaque (VIDEO_START + VIDEO_FADE), then snap to the final frame
// (an empty zoom-through) which the video now covers completely. The video
// fades in BEHIND the typography, so the readable frame stays on top through
// the fade and the swap itself is invisible. The discrete swap is intentional —
// no animation plays for these users.
export function lottieTimeFor(sp: number, phase: Phase): number {
  if (phase === "done")
    return sp < VIDEO_START + VIDEO_FADE ? LOTTIE_INTRO_S : LOTTIE_TOTAL_S;
  if (sp <= REVEAL_END)
    return DEFT_DROP_S + (sp / REVEAL_END) * (LOTTIE_INTRO_S - DEFT_DROP_S);
  // Hold ends at LOTTIE_SCRUB_START (not FIGURES_END), immediately after the
  // final GBA window has landed; the 3D sequence never overlaps the resumed
  // typography motion.
  if (sp <= LOTTIE_SCRUB_START) return LOTTIE_INTRO_S;
  // Two-speed scrub, split at VIDEO_START:
  //  1) [LOTTIE_SCRUB_START, VIDEO_START] → [LOTTIE_INTRO_S, LOTTIE_ZOOM_S]:
  //     the words finish assembling/settling at their readable pace (unchanged
  //     from the old single linear scrub).
  //  2) [VIDEO_START, LOTTIE_END] → [LOTTIE_ZOOM_S, LOTTIE_TOTAL_S]: a SHORT,
  //     fast zoom-through so the giant letters clear the frame before the
  //     video's baked caption appears (~sp 0.682) — otherwise they block it.
  if (sp <= VIDEO_START) {
    const t = (sp - LOTTIE_SCRUB_START) / (VIDEO_START - LOTTIE_SCRUB_START);
    return LOTTIE_INTRO_S + t * (LOTTIE_ZOOM_S - LOTTIE_INTRO_S);
  }
  const t = clamp01((sp - VIDEO_START) / (LOTTIE_END - VIDEO_START));
  return LOTTIE_ZOOM_S + t * (LOTTIE_TOTAL_S - LOTTIE_ZOOM_S);
}

// During every actually visible figure flight the typography must already be
// on its authored frame-103 settle. The scroll-derived target can jump across
// the short clean beat in one wheel/touch sample, so temporal smoothing alone
// cannot enforce this visual handoff.
export function lottieSettledIntroRequiredFor(sp: number): boolean {
  return sp >= FIGURES_START && sp <= LOTTIE_SCRUB_START;
}

// Framerate-independent display-time smoothing for the scroll-driven Lottie.
// The figures interval is the one deliberate snap: both forward and reverse
// jumps must show the exact settled title before 3D is rendered. Everywhere
// else the displayed frame keeps chasing coarse scroll steps smoothly.
export function lottieDisplayedTimeFor(
  currentSec: number,
  targetSp: number,
  deltaSec: number,
): number {
  const targetSec = lottieTimeFor(targetSp, "scroll");
  if (lottieSettledIntroRequiredFor(targetSp)) return LOTTIE_INTRO_S;
  if (!Number.isFinite(currentSec) || currentSec < 0) return targetSec;

  const safeDelta = Number.isFinite(deltaSec) ? Math.max(deltaSec, 0) : 0;
  const nextSec =
    currentSec + (targetSec - currentSec) * (1 - Math.exp(-safeDelta * 10));
  return Math.abs(targetSec - nextSec) < 1 / 120 ? targetSec : nextSec;
}

export interface FigureState {
  // Local flight progress through this figure's window, 0..1 (clamped).
  t: number;
  opacity: number;
}

// Per-figure flight state. `window` is the figure's sub-range of the figures
// phase, in normalized phase units [0,1]; windows may OVERLAP (up to two
// figures airborne at once) so the sequence reads as a continuous cascade.
// The phase starts at FIGURES_START, after the completed title settle and its
// 8vh clean beat. The fade is SYMMETRIC within the window (first/last
// FIGURE_FADE of local t), so each flight reads as a balanced dome and is fully
// reversible on reverse scroll.
export function figureStateFor(
  sp: number,
  window: readonly [number, number],
  phase: Phase,
): FigureState {
  if (phase === "done") return { t: 1, opacity: 0 };
  const phaseT = (sp - FIGURES_START) / (FIGURES_END - FIGURES_START);
  const [w0, w1] = window;
  const t = clamp01((phaseT - w0) / (w1 - w0));
  let opacity = 0;
  if (phaseT > w0 && phaseT < w1) {
    // FIGURE_FADE === 0: figures never change opacity (they enter/exit by
    // flying off-screen), so opacity is binary inside the window.
    if (FIGURE_FADE <= 0) opacity = 1;
    else if (t < FIGURE_FADE) opacity = smoothstep(t / FIGURE_FADE);
    else if (t > 1 - FIGURE_FADE) opacity = smoothstep((1 - t) / FIGURE_FADE);
    else opacity = 1;
  }
  return { t, opacity };
}

// NOTE: there is deliberately NO mount-visibility function here any more. The
// figures used to be mounted/unmounted around their windows (a scroll-driven
// gate with a grace margin), which meant the ~90 KB transmission/dispersion
// glass shader compiled — and three allocated its transmission render target —
// at the moment the FIRST figure appeared, mid-screen, mid-scroll: the phone
// freeze. Scene now mounts all three permanently (they render nothing while
// their opacity is 0) so the pipeline warms under the intro loader instead.

export interface VideoState {
  // Normalized video time 0..1 across [VIDEO_START, 1].
  t: number;
  opacity: number;
}

// Video phase: fades in over VIDEO_FADE starting at VIDEO_START — while the
// typography is still zooming, BEHIND the letters — and scrubs linearly from
// VIDEO_START to the clip's last frame at sp = 1.
// "done" (reduced motion): never scrubs — static final frame — but the fade
// still follows scroll so the typography isn't covered before the tail.
export function videoStateFor(sp: number, phase: Phase): VideoState {
  const opacity = smoothstep((sp - VIDEO_START) / VIDEO_FADE);
  if (phase === "done") return { t: 1, opacity };
  return {
    t: clamp01((sp - VIDEO_START) / (1 - VIDEO_START)),
    opacity,
  };
}

// Anim-track scroll → clip-time map: [sp, clip-fraction] knots, walked
// piecewise-linearly. Since 2026-09-16 there are exactly TWO of them — ONE
// UNIFORM ramp over the whole anim track.
//
// History. The map used to carry five interior knots (545.6 / 551.8 / 769.8 /
// 843.1 / 1228.5 vh ↔ 0.11 / 0.139 / 0.248 / 0.592 / 0.786) that parked the two
// captions BAKED into the footage on a ~9× shallower slope, so a reader could
// dwell on the text under an UNCAPPED scroll. Since the soft pin (5e79660) the
// page itself may not advance the clip faster than 12.5 f/s, so the captions
// can no longer be fast-forwarded at all and the dwells were redundant: they
// spent 82 % of the zone's PIXELS on 36 % of its FRAMES, which on a phone reads
// as "nothing happens" — and made one flick worth 9× more clip in one place
// than in another, i.e. both halves of the client's last note ("hang" and
// "it scrolls by itself for 2–4 s").
//
// The rule now: one linear ramp, VIDEO_START (504vh) → sp 1 (1240vh), 736vh for
// VIDEO_SPLIT of clip ≈ 2.98 constant vh per sequence frame — 23.1 px/frame at
// innerHeight 844 (page cap ≈289 px/s) and 29.6 px/frame at 1080 (≈370 px/s).
// SCROLL_TRACK_VH is unchanged; the video-card tail [VIDEO_SPLIT, 1] still
// rides the gallery track. videoTimelinePositionFor (the EXACT inverse) walks
// this same array, so it has to keep working with two knots — it does: one
// segment, one affine solve, no special case.
// Re-derive if VIDEO_START / VIDEO_SPLIT move or the clip swaps.
export const VIDEO_TIME_KNOTS: readonly (readonly [number, number])[] = [
  [VIDEO_START, 0], // 504vh — the clip's first frame
  [1, VIDEO_SPLIT], // 1240vh — 20 s in; the last 3.56 s ride the video card
];

function animTrackClipTimeFor(sp: number): number {
  const s = Math.min(Math.max(sp, VIDEO_START), 1);
  for (let i = 1; i < VIDEO_TIME_KNOTS.length; i++) {
    const [s1, f1] = VIDEO_TIME_KNOTS[i];
    if (s <= s1) {
      const [s0, f0] = VIDEO_TIME_KNOTS[i - 1];
      return f0 + ((s - s0) / (s1 - s0)) * (f1 - f0);
    }
  }
  return VIDEO_SPLIT;
}

export interface VideoTimelinePosition {
  sp: number;
  gp: number;
}

// Exact inverse of videoMasterTimeFor's scroll phase. The authored caption
// dwells are piecewise-linear in clip time, so invert those same knots instead
// of approximating the position numerically. At VIDEO_SPLIT the canonical
// position is the sp/gp seam ({ sp: 1, gp: 0 }); the remaining clip tail rides
// the video-card gallery track through gp = VID_FLY_END.
export function videoTimelinePositionFor(t: number): VideoTimelinePosition {
  const time = Number.isNaN(t) ? 0 : clamp01(t);

  if (time <= VIDEO_SPLIT) {
    for (let i = 1; i < VIDEO_TIME_KNOTS.length; i++) {
      const [sp1, time1] = VIDEO_TIME_KNOTS[i];
      if (time <= time1) {
        const [sp0, time0] = VIDEO_TIME_KNOTS[i - 1];
        const segment = time1 - time0;
        const u = segment > 0 ? (time - time0) / segment : 0;
        return { sp: sp0 + u * (sp1 - sp0), gp: 0 };
      }
    }
    return { sp: 1, gp: 0 };
  }

  const tail = (time - VIDEO_SPLIT) / (1 - VIDEO_SPLIT);
  return { sp: 1, gp: tail * VID_FLY_END };
}

// Video time across the WHOLE life of the clip — extended past sp = 1 into the
// gallery so the FPV plays continuously while it morphs into slide #1, holds and
// flies away (never a frozen frame). Monotonic and continuous across the
// sp → gp boundary (gp > 0 ⟺ sp = 1):
//   anim track  sp ∈ [VIDEO_START, 1]  → t ∈ [0, VIDEO_SPLIT]  (caption-dwell
//                                        knots above — not a single linear ramp)
//   gallery     gp ∈ [0, VID_FLY_END]  → t ∈ [VIDEO_SPLIT, 1]   (last frame as it flies)
// Replaces videoStateFor.t as the scrub source; videoStateFor stays for the
// sp-based reveal opacity + grain mix. "done" (reduced motion): frozen last frame.
export function videoMasterTimeFor(sp: number, gp: number, phase: Phase): number {
  if (phase === "done") return 1;
  if (gp <= 0) return animTrackClipTimeFor(sp);
  return clamp01(VIDEO_SPLIT + (clamp01(gp / VID_FLY_END)) * (1 - VIDEO_SPLIT));
}

// 0 → the Lottie keeps its framed inset margin; 1 → full-bleed. The frame
// dissolves over the same ramp that brings the video in behind the text, so
// the zoom-through reads edge-to-edge. Phase-independent: under reduced
// motion the swap still follows scroll (no animation plays).
export function lottieBleedFor(sp: number): number {
  return smoothstep((sp - VIDEO_START) / VIDEO_FADE);
}

const LOTTIE_TRANSPARENT_TAIL_EPS = 1 / 120;

export function lottiePlaneVisibleFor(tSec: number, targetSp: number): boolean {
  return (
    targetSp < LOTTIE_END &&
    tSec < LOTTIE_TOTAL_S - LOTTIE_TRANSPARENT_TAIL_EPS
  );
}
