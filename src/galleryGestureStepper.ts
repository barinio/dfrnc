import { VID_FLY_END } from "./constants";
import {
  GALLERY_IMAGES,
  galleryProgressForImageLinear,
} from "./gallery";

export type GalleryDirection = -1 | 1;

export interface GalleryStepperState {
  index: number;
}

export type GalleryStepResult =
  | { kind: "step"; state: GalleryStepperState; targetGp: number }
  | { kind: "release-before"; state: GalleryStepperState }
  | { kind: "release-after"; state: GalleryStepperState };

export function galleryStepTargets(): readonly number[] {
  return [
    VID_FLY_END,
    ...GALLERY_IMAGES.map((_, index) =>
      index === GALLERY_IMAGES.length - 1
        ? 1
        : galleryProgressForImageLinear(index + 1),
    ),
  ];
}

export function createGalleryStepperState(index = 0): GalleryStepperState {
  const max = galleryStepTargets().length - 1;
  return { index: Math.min(Math.max(Math.trunc(index), 0), max) };
}

export function requestGalleryStep(
  state: GalleryStepperState,
  direction: GalleryDirection,
): GalleryStepResult {
  const current = createGalleryStepperState(state.index);
  const targets = galleryStepTargets();

  if (direction < 0 && current.index === 0) {
    return { kind: "release-before", state: current };
  }
  if (direction > 0 && current.index === targets.length - 1) {
    return { kind: "release-after", state: current };
  }

  const next = createGalleryStepperState(current.index + direction);
  return { kind: "step", state: next, targetGp: targets[next.index] };
}
