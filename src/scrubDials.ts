// Runtime scrub dials, read ONCE at startup from the URL query.
//
// Three numbers decide how a flick feels inside the video zone — how much clip
// one gesture may still owe, how much a finger release is worth, and how long
// the coast eases out — and the only honest way to judge them is a thumb on a
// real phone. So they are overridable per URL:
//
//   ?bank=<clip seconds>   the input-bank ceiling      0 < v ≤ 10
//   ?fling=<ms>            the synthetic fling tau     0 ≤ v ≤ 1000
//   ?ease=<clip seconds>   the coast ease-out window   0 ≤ v ≤ 2
//
// Gated exactly like Scene.tsx's `?gyro=1` — a plain URLSearchParams read on
// window.location.search — with ONE deliberate difference: no import.meta.env
// .DEV around it, because a phone is handed a `vite preview` (or a deployed
// preview) build, never the dev server. A missing, malformed or out-of-range
// value yields null and the caller keeps its shipped constant, so a mistyped
// query can never change what the product does.
//
// This module is a LEAF: it imports nothing, so the governor and the controller
// can own their own defaults and still consume the overrides.

export interface ScrubDialOverrides {
  // Seconds of clip one gesture may still owe (scrollGovernor.clampBankPx).
  bankMaxClipS: number | null;
  // Milliseconds of release velocity a touch lift queues (the controller).
  flingTauMs: number | null;
  // Seconds of clip over which a coast decelerates (coastRateScale).
  easeWindowClipS: number | null;
}

export const NO_SCRUB_DIALS: ScrubDialOverrides = {
  bankMaxClipS: null,
  flingTauMs: null,
  easeWindowClipS: null,
};

function dial(
  params: URLSearchParams,
  key: string,
  min: number,
  max: number,
  minExclusive = false,
): number | null {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  if (minExclusive ? value <= min : value < min) return null;
  if (value > max) return null;
  return value;
}

/** Pure parser — the whole validation contract, unit-tested without a window. */
export function parseScrubDials(search: string): ScrubDialOverrides {
  if (typeof search !== "string" || search === "") return { ...NO_SCRUB_DIALS };
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return { ...NO_SCRUB_DIALS };
  }
  return {
    bankMaxClipS: dial(params, "bank", 0, 10, true),
    flingTauMs: dial(params, "fling", 0, 1000),
    easeWindowClipS: dial(params, "ease", 0, 2),
  };
}

function readSearch(): string {
  try {
    if (typeof window === "undefined") return "";
    return window.location?.search ?? "";
  } catch {
    return "";
  }
}

// Read ONCE, at module evaluation: the dials are a testing seat for the whole
// page load, never something that changes under a running gesture.
export const SCRUB_DIAL_OVERRIDES: ScrubDialOverrides = parseScrubDials(
  readSearch(),
);

export function scrubDialsActive(
  overrides: ScrubDialOverrides = SCRUB_DIAL_OVERRIDES,
): boolean {
  return (
    overrides.bankMaxClipS !== null ||
    overrides.flingTauMs !== null ||
    overrides.easeWindowClipS !== null
  );
}
