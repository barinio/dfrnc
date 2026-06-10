import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import { videoStateFor } from "../playback";
import type { Phase } from "../playback";

// (videoTime seconds → object-position-x %) keyframes for the portrait crop.
// The 16:9 frame is cover-cropped on phones; the baked-in taglines drift away
// from frame-center during parts of the clip, so the crop window pans to keep
// them centered.
// Tuned from portrait screenshots (390×844) at sp 0.82-0.98:
//   t≈2.6-5.2s  "WIR SIND EIN INTERNATIONALES KREATIVSTUDIO" sits right-of-center
//   t≈8-12s     "ZUHAUSE IM HERZEN DER SCHWEIZ" is heavily right-clipped
// Increasing % shifts the visible window rightward (shows more right side of source).
const PAN_KEYFRAMES: ReadonlyArray<readonly [number, number]> = [
  [0, 50],
  [2.0, 50],
  [2.6, 52],  // "WIR SIND..." right-of-center; gentle rightward shift
  [5.5, 51],  // tagline still slightly right; taper
  [7.5, 50],  // no tagline (aerial bridge); return to center
  [9.5, 50],  // transition into second tagline segment
  [10.0, 72], // "ZUHAUSE IM HERZEN DER SCHWEIZ" — right-of-center
  [11.5, 78], // text grows as drone flies into sign; keep shifting right
  [12.5, 72], // taper as text begins to fade
  [13.0, 50], // tagline fades; ease back to center
  [14.24, 50],
];

function panXFor(time: number): number {
  const k = PAN_KEYFRAMES;
  if (time <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) {
    if (time <= k[i][0]) {
      const f = (time - k[i - 1][0]) / (k[i][0] - k[i - 1][0]);
      return k[i - 1][1] + f * (k[i][1] - k[i - 1][1]);
    }
  }
  return k[k.length - 1][1];
}

interface VideoSectionProps {
  scrollRef: MutableRefObject<number>;
  phase: Phase;
}

// Scroll-scrubbed FPV background video for the page tail. A DOM layer above
// the WebGL canvas; opacity (the crossfade) and currentTime both derive from
// scroll progress inside one rAF loop — same no-React-per-frame discipline as
// the in-scene layers. The clip's taglines are baked in; there are no overlays.
export default function VideoSection({ scrollRef, phase }: VideoSectionProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastTime = useRef<number>(-1);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const v = videoRef.current;
      if (!v) return;
      const { t, opacity } = videoStateFor(scrollRef.current, phase);
      v.style.opacity = opacity.toFixed(3);
      if (opacity <= 0.001) return; // off-phase: skip seeking entirely
      const dur = v.duration;
      if (!Number.isFinite(dur) || dur <= 0) return; // metadata not ready: poster shows
      // Clamp short of the end so the held last frame never flickers black.
      const target = Math.min(t * dur, dur - 0.05);
      // Always update the pan — cheap string write, fires on orientation changes
      // even when the video is parked (no seek needed).
      const portrait = window.innerHeight > window.innerWidth;
      v.style.objectPosition = portrait
        ? `${panXFor(target).toFixed(1)}% 50%`
        : "50% 50%";
      // Re-seek only when the target moved by more than ~a frame.
      if (Math.abs(target - lastTime.current) < 1 / 30) return;
      lastTime.current = target;
      try {
        v.currentTime = target;
      } catch {
        // Seek failed (decoder hiccup / data-saver): poster or last decoded
        // frame stays up; scroll timeline is unaffected.
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [scrollRef, phase]);

  return (
    <video
      ref={videoRef}
      className="video-layer"
      src={import.meta.env.BASE_URL + "fpv.mp4"}
      poster={import.meta.env.BASE_URL + "fpv-poster.jpg"}
      muted
      playsInline
      preload="auto"
      aria-hidden
    />
  );
}
