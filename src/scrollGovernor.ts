import {
  GALLERY_PIN_TRACK_PX,
  SCROLL_TRACK_VH,
  VIDEO_CARD_TRACK_VH,
  VID_FLY_END,
} from "./constants";
import { galleryProgressFrom } from "./gallery";
import { videoMasterTimeFor, videoTimelinePositionFor } from "./playback";
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
// automatically correct at every knot slope — 70 px/s through the scenic
// stretches, ~660 px/s through the caption dwells — with no per-segment dials,
// and the published progress can never outrun the picture.
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

  const budget =
    NATIVE_CLIP_RATE_PER_S *
    (Number.isFinite(dtSec) ? Math.max(dtSec, 0) : 0);
  const t0 = videoTimeForY(a, innerHeight);
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
// How much playback one flick may buy. In CLIP SECONDS, not pixels, for exactly
// the reason the cap is: a scenic stretch (70 px/s at 844) and a caption dwell
// (660 px/s) owe the viewer the same four seconds of PICTURE, not the same
// number of pixels. The client's spec is untouched by it — the bank only
// changes how long the page keeps moving, never how fast (never above 1×).
export const SCROLL_BANK_MAX_CLIP_S = 4;

// Ceiling for a signed bank held at `virtualY`, in pixels. Unbounded on a side
// whose 4 s horizon has run past the end of the clip: that is what preserves
// today's edge semantics exactly — the residue passes free, so capTick's
// `next >= seamY` hand-off to the pinned gallery and its `next < zoneStartY`
// hand-back to native scrolling both still fire on the very same tick they do
// now, instead of being fenced in one horizon short of the edge.
export function clampBankPx(
  virtualY: number,
  bankPx: number,
  innerHeight: number,
): number {
  if (!Number.isFinite(bankPx) || bankPx === 0) return bankPx;
  if (!Number.isFinite(virtualY)) return bankPx;
  if (!validHeight(innerHeight)) return bankPx;

  const budget = SCROLL_BANK_MAX_CLIP_S * NATIVE_CLIP_RATE_PER_S;
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
