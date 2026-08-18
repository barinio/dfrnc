// SPIKE — device-orientation ("gyroscope") tilt source for the glass figures.
//
// On touch devices there is no hover cursor, so the figures' mouse parallax
// (ArcModel `ptr` → mouseRotX/Y) is dead. This module turns `deviceorientation`
// into the SAME normalized −1..1 pointer signal, so ArcModel can consume it
// through the identical lerp path (rate 4, MOUSE_MAX) with no new tuning.
//
// Semantics:
//   x  — left/right tilt (gamma), +1 = tilted right (like cursor at the right)
//   y  — front/back tilt (beta),  +1 = top tilted away (like cursor at the top)
// Both are RELATIVE to a slowly re-centering baseline (the pose the phone was
// held in when sampling began), so any comfortable holding angle reads as 0
// and a held tilt decays back to neutral over ~5 s. Landscape swaps the axes.
//
// iOS 13+: sensor access needs `DeviceOrientationEvent.requestPermission()`,
// which only resolves when called synchronously inside a user gesture — so we
// arm it on the first touchend/click and start listening once granted. Android/Chrome: no prompt, listener starts immediately.
// Only enabled on coarse-pointer (touch) devices; laptops with sensors are
// ignored so the desktop cursor path stays the single source of truth there.

export const gyroPointer = { x: 0, y: 0, active: false };

const TILT_RANGE_DEG = 18; // ± degrees of relative tilt that map to ±1
const DEAD_ZONE_DEG = 0.6; // ignore sensor jitter around the baseline
const RECENTER_RATE = 0.2; // 1/s — baseline drifts toward the current pose

type OrientationEventCtor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

function isCoarsePointer(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(pointer: coarse)").matches ||
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0
  );
}

function screenAngle(): number {
  const so = typeof screen !== "undefined" ? screen.orientation?.angle : undefined;
  const legacy = (window as unknown as { orientation?: number }).orientation;
  const a = typeof so === "number" ? so : typeof legacy === "number" ? legacy : 0;
  return ((a % 360) + 360) % 360;
}

function clamp1(v: number): number {
  return v > 1 ? 1 : v < -1 ? -1 : v;
}

function applyDeadZone(deg: number): number {
  if (Math.abs(deg) < DEAD_ZONE_DEG) return 0;
  return deg - Math.sign(deg) * DEAD_ZONE_DEG;
}

// Pure mapping — exported for the assertions in check-playback.
export function orientationToPointer(
  dBeta: number,
  dGamma: number,
  angle: number,
): { x: number; y: number } {
  const b = applyDeadZone(dBeta) / TILT_RANGE_DEG;
  const g = applyDeadZone(dGamma) / TILT_RANGE_DEG;
  // Portrait: gamma is left/right, beta is front/back. Rotating the screen 90°
  // swaps which physical axis is horizontal on screen (and flips a sign).
  switch (angle) {
    case 90:
      return { x: clamp1(b), y: clamp1(g) };
    case 270:
      return { x: clamp1(-b), y: clamp1(-g) };
    case 180:
      return { x: clamp1(-g), y: clamp1(b) };
    default:
      return { x: clamp1(g), y: clamp1(-b) };
  }
}

/** Starts the gyro tilt source. Returns a disposer. No-op on non-touch devices. */
export function startGyroTilt(): () => void {
  if (typeof window === "undefined" || !("DeviceOrientationEvent" in window)) return () => {};
  if (!isCoarsePointer()) return () => {};

  let disposed = false;
  let listening = false;
  let baseBeta: number | null = null;
  let baseGamma: number | null = null;
  let lastT = 0;

  const onOrientation = (e: DeviceOrientationEvent) => {
    if (e.beta == null || e.gamma == null) return; // no sensor / desktop stub
    const now = performance.now();
    if (baseBeta == null || baseGamma == null) {
      baseBeta = e.beta;
      baseGamma = e.gamma;
      lastT = now;
      gyroPointer.active = true;
      return;
    }
    const dt = Math.min((now - lastT) / 1000, 0.25);
    lastT = now;
    // Slow re-centering: the baseline follows the current pose, so a sustained
    // tilt reads as the new neutral after a few seconds (no "stuck" offset).
    const k = 1 - Math.exp(-dt * RECENTER_RATE);
    baseBeta += (e.beta - baseBeta) * k;
    baseGamma += (e.gamma - baseGamma) * k;
    // gamma wraps at ±90 when the phone passes vertical — ignore those jumps.
    let dGamma = e.gamma - baseGamma;
    if (Math.abs(dGamma) > 90) dGamma = 0;
    const p = orientationToPointer(e.beta - baseBeta, dGamma, screenAngle());
    gyroPointer.x = p.x;
    gyroPointer.y = p.y;
  };

  const listen = () => {
    if (disposed || listening) return;
    listening = true;
    window.addEventListener("deviceorientation", onOrientation, { passive: true });
  };

  const Ctor = DeviceOrientationEvent as OrientationEventCtor;
  // touchend/click are activation-triggering per the HTML spec; a touch
  // pointerdown is NOT, and Safari rejects requestPermission() outside a
  // real activation — so we don't arm on pointerdown.
  const gestureEvents = ["touchend", "click"] as const;
  const disarm = () => {
    for (const ev of gestureEvents) window.removeEventListener(ev, onGesture, true);
  };
  const onGesture = () => {
    // Must be called synchronously within the gesture — no awaits before it.
    Ctor.requestPermission?.()
      .then((state) => {
        disarm(); // answered (granted or denied) — never re-prompt this load
        if (state === "granted") listen();
      })
      .catch(() => {
        /* rejected without an answer (no activation / insecure context):
           stay armed for the next gesture, keep the cursor path meanwhile */
      });
  };

  if (typeof Ctor.requestPermission === "function") {
    // iOS: arm on the first user gesture (capture phase, so a preventDefault
    // elsewhere can't swallow it).
    for (const ev of gestureEvents) window.addEventListener(ev, onGesture, true);
  } else {
    listen();
  }

  return () => {
    disposed = true;
    for (const ev of gestureEvents) window.removeEventListener(ev, onGesture, true);
    window.removeEventListener("deviceorientation", onOrientation);
    gyroPointer.active = false;
    gyroPointer.x = 0;
    gyroPointer.y = 0;
  };
}
