import {
  GALLERY_PIN_TRACK_PX,
  SCROLL_TRACK_VH,
  VIDEO_CARD_TRACK_VH,
  VID_FLY_END,
} from "./constants";
import { galleryProgressFrom } from "./gallery";
import {
  videoMasterTimeFor,
  videoTimelinePositionFor,
} from "./playback";
import { NATIVE_CLIP_RATE_PER_S } from "./frameScrub";

export interface TimelineProgress {
  sp: number;
  gp: number;
}

function validHeight(innerHeight: number): boolean {
  return Number.isFinite(innerHeight) && innerHeight > 0;
}

function clampProgress(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}

function physicalTracks(innerHeight: number) {
  return {
    animY: ((SCROLL_TRACK_VH - 100) / 100) * innerHeight,
    videoCardPx: (VIDEO_CARD_TRACK_VH / 100) * innerHeight,
    imagePx: GALLERY_PIN_TRACK_PX,
  };
}

export function animationEndY(innerHeight: number): number {
  if (!validHeight(innerHeight)) return 0;
  return physicalTracks(innerHeight).animY;
}

// Canonical physical scroll position → both logical timelines. Gallery
// conversion deliberately delegates to galleryProgressFrom so its piecewise
// video-card/image cadence remains a single source of truth.
export function timelineProgressForY(
  y: number,
  innerHeight: number,
): TimelineProgress {
  if (!validHeight(innerHeight)) return { sp: 0, gp: 0 };

  const { animY, videoCardPx, imagePx } = physicalTracks(innerHeight);
  const maxY = animY + videoCardPx + imagePx;
  const scrollY = Number.isNaN(y) ? 0 : Math.min(Math.max(y, 0), maxY);
  const sp = animY > 0 ? clampProgress(scrollY / animY) : 0;

  return { sp, gp: galleryProgressFrom(scrollY, innerHeight) };
}

// Inverse timeline mapping. Animation progress owns positions while sp < 1;
// once sp is complete, gp selects the short video-card track and then the image
// track. This gives the ambiguous seam one stable representation: sp=1,gp=0.
export function scrollYForTimelineProgress(
  value: TimelineProgress,
  innerHeight: number,
): number {
  if (!validHeight(innerHeight)) return 0;

  const { animY, videoCardPx, imagePx } = physicalTracks(innerHeight);
  const sp = clampProgress(value.sp);
  const gp = clampProgress(value.gp);

  if (sp < 1) return sp * animY;
  if (gp <= VID_FLY_END) {
    return animY + (gp / VID_FLY_END) * videoCardPx;
  }
  return (
    animY +
    videoCardPx +
    ((gp - VID_FLY_END) / (1 - VID_FLY_END)) * imagePx
  );
}

export function videoTimeForY(y: number, innerHeight: number): number {
  const { sp, gp } = timelineProgressForY(y, innerHeight);
  return videoMasterTimeFor(sp, gp, "scroll");
}

export function scrollYForVideoTime(t: number, innerHeight: number): number {
  return scrollYForTimelineProgress(videoTimelinePositionFor(t), innerHeight);
}

export function videoGovernorBounds(innerHeight: number): {
  startY: number;
  endY: number;
} {
  if (!validHeight(innerHeight)) return { startY: 0, endY: 0 };
  return {
    startY: scrollYForVideoTime(0, innerHeight),
    endY: scrollYForVideoTime(1, innerHeight),
  };
}

// ── Page-speed cap (the "scroll is TIED to the video" limiter) ───────────────
// Everything above maps a position to a progress. This is the one place that
// limits how fast that position may CHANGE, and it is deliberately expressed in
// CLIP TIME, not pixels: inside videoGovernorBounds the page may advance the
// clip by at most NATIVE_CLIP_RATE_PER_S per wall second (= the same 12.5
// sequence-frames/s the painted chase runs at), then inverts that clip time back
// through the very same VIDEO_TIME_KNOTS to a scroll position. So the cap is
// automatically correct at every knot slope — and since 2026-09-16 there is
// only ONE slope: the uniform ramp gives ≈289 px/s of page at innerHeight 844
// and ≈370 px/s at 1080, everywhere inside the anim track, plus ≈314 px/s on
// the video-card tail. The published progress can never outrun the picture.
//
// `rateScale` is the one caller-supplied modifier: the controller passes < 1
// while the page is COASTING on a spent gesture (see coastRateScale) so a flick
// eases out the way a native fling does instead of stopping at full speed. It
// is 1 — untouched — while a finger is down or input is fresh, because the
// client rejected any lag under the finger.
//
// Symmetric: a rewind is capped exactly like a forward run (the clip cannot play
// backwards faster than it was shot either).
//
// RESIDUE OUTSIDE THE ZONE PASSES FREE. Only the part of the movement that lies
// inside [startY, endY] is metered; a request that merely clips a zone edge on
// its way past (entering from before VIDEO_START, or leaving forward into the
// pinned gallery) spends only its in-zone share and keeps the rest. Without
// that, ordinary scrolling outside the video would be throttled by a zone it is
// only touching.
export function capVirtualY(
  fromY: number,
  requestedY: number,
  dtSec: number,
  innerHeight: number,
  rateScale = 1,
): number {
  if (!Number.isFinite(requestedY)) return Number.isFinite(fromY) ? fromY : 0;
  if (!Number.isFinite(fromY)) return requestedY;
  if (!validHeight(innerHeight)) return requestedY;

  const { startY, endY } = videoGovernorBounds(innerHeight);
  if (!(endY > startY)) return requestedY;
  if (requestedY === fromY) return requestedY;

  // Clamp BOTH endpoints into the zone: what is left is exactly the in-zone
  // share of the movement.
  const a = Math.min(Math.max(fromY, startY), endY);
  const b = Math.min(Math.max(requestedY, startY), endY);
  if (a === b) return requestedY;

  const t0 = videoTimeForY(a, innerHeight);
  const scale =
    Number.isFinite(rateScale) ? Math.min(Math.max(rateScale, 0), 1) : 1;
  const budget =
    NATIVE_CLIP_RATE_PER_S *
    scale *
    (Number.isFinite(dtSec) ? Math.max(dtSec, 0) : 0);
  const tRequested = videoTimeForY(b, innerHeight);
  const demand = tRequested - t0;
  if (Math.abs(demand) <= budget) return requestedY;

  const capped = t0 + Math.sign(demand) * budget;
  return scrollYForVideoTime(clampProgress(capped), innerHeight);
}

// ── Input bank ceiling ───────────────────────────────────────────────────────
// capVirtualY answers "how fast may the page move". This answers the other half
// the client complained about: "how much of a gesture may still be OWED". The
// cap used to DROP whatever it could not spend in a 16 ms tick — a 100 px wheel
// notch bought the ~1.5 px a scenic stretch allows and the other 98.5 px
// evaporated, so riding the 23.5 s zone meant ~150 notches of continuous
// cranking (and on a phone a 0.3 s swipe bought ~20 px). The controller now
// BANKS the remainder and keeps paying it out at the cap after the input stops.
//
// How much playback one flick may buy. In CLIP SECONDS, not pixels, because
// that is the unit the cap is in.
//
// 2026-09-16 — 4 s → 1.2 s: "a flick moves a bit and stops". A native Android
// fling coasts ~0.4–1.1 s, and 4 s of clip (plus the old caption half-rate,
// which doubled it in WALL seconds) is what the client saw as the page
// scrolling by itself for 2–4 s after every swipe. 1.2 s of clip is 15 frames
// ≈ 345 px at innerHeight 844 — a 400 px finger swipe is worth ~1.4 s of clip
// here, so most of it is paid DURING the gesture and just after it, and the
// remainder is dropped rather than replayed at the user.
export const SCROLL_BANK_MAX_CLIP_S = 1.2;

// ── Coast ease-out ──────────────────────────────────────────────────────────
// A bank that runs out at full speed stops DEAD, which is the one thing no
// native fling does. So while the page is coasting — nothing under the finger,
// no input for INPUT_QUIET_MS — the controller scales the per-tick budget by
// how much clip is still owed: full rate until the last BANK_EASE_OUT_CLIP_S
// of it, then proportionally down to BANK_EASE_OUT_FLOOR, which keeps the tail
// finite instead of asymptotic. Smoothing the INPUT, never the pixels: no frame
// is ever blended, the clip simply arrives a little slower at the very end.
export const BANK_EASE_OUT_CLIP_S = 0.3;
export const BANK_EASE_OUT_FLOOR = 0.15;

// Seconds of clip still owed → the fraction of the cap this tick may spend.
// Pure, so the deceleration curve is a unit test and not a screen recording.
export function coastRateScale(
  bankClipS: number,
  windowClipS = BANK_EASE_OUT_CLIP_S,
  floor = BANK_EASE_OUT_FLOOR,
): number {
  if (!Number.isFinite(bankClipS)) return 1;
  if (!Number.isFinite(windowClipS) || windowClipS <= 0) return 1;
  const owed = Math.abs(bankClipS);
  return Math.min(Math.max(owed / windowClipS, floor), 1);
}

// The standing debt expressed in the unit the ease-out reasons about: seconds
// of CLIP still owed, i.e. how long the page would keep moving at the cap.
// Pixels would be the wrong unit — the same 300 px is a different amount of
// picture on the anim track and on the video-card tail.
export function bankClipSeconds(
  virtualY: number,
  bankPx: number,
  innerHeight: number,
): number {
  if (!Number.isFinite(bankPx) || bankPx === 0) return 0;
  if (!Number.isFinite(virtualY)) return 0;
  if (!validHeight(innerHeight)) return 0;
  const from = videoTimeForY(virtualY, innerHeight);
  const to = videoTimeForY(virtualY + bankPx, innerHeight);
  return Math.abs(to - from) / NATIVE_CLIP_RATE_PER_S;
}

// Ceiling for a signed bank held at `virtualY`, in pixels. Unbounded on a side
// whose horizon has run past the end of the clip: that is what preserves
// today's edge semantics exactly — the residue passes free, so capTick's
// `next >= seamY` hand-off to the pinned gallery and its `next < zoneStartY`
// hand-back to native scrolling both still fire on the very same tick they do
// now, instead of being fenced in one horizon short of the edge.
// `maxClipS` is a parameter so the URL dial (?bank=) can move it without this
// module knowing anything about the page it runs in.
export function clampBankPx(
  virtualY: number,
  bankPx: number,
  innerHeight: number,
  maxClipS = SCROLL_BANK_MAX_CLIP_S,
): number {
  if (!Number.isFinite(bankPx) || bankPx === 0) return bankPx;
  if (!Number.isFinite(virtualY)) return bankPx;
  if (!validHeight(innerHeight)) return bankPx;
  if (!Number.isFinite(maxClipS) || maxClipS < 0) return bankPx;

  const budget = maxClipS * NATIVE_CLIP_RATE_PER_S;
  const t = videoTimeForY(virtualY, innerHeight);

  if (bankPx > 0) {
    const horizon = t + budget;
    if (horizon >= 1) return bankPx;
    return Math.min(bankPx, scrollYForVideoTime(horizon, innerHeight) - virtualY);
  }
  const horizon = t - budget;
  if (horizon <= 0) return bankPx;
  return Math.max(bankPx, scrollYForVideoTime(horizon, innerHeight) - virtualY);
}
