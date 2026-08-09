import { VID_FLY_END } from "../src/constants";
import { GALLERY_IMAGES } from "../src/gallery";
import {
  createGalleryStepperState,
  galleryStepTargets,
  requestGalleryStep,
} from "../src/galleryGestureStepper";

function ok(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
}

function eq(actual: number | string, expected: number | string, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

const targets = galleryStepTargets();
eq(
  targets.length,
  GALLERY_IMAGES.length + 1,
  "entrance plus one exit per photo",
);
eq(targets[0], VID_FLY_END, "entrance is the video/photo seam");
eq(targets.at(-1)!, 1, "CTA is the terminal semantic target");
for (let index = 1; index < targets.length; index += 1) {
  ok(targets[index] > targets[index - 1], `target ${index} is ordered`);
}

let state = createGalleryStepperState();
let result = requestGalleryStep(state, 1);
eq(result.kind, "step", "forward entrance advances one card");
if (result.kind === "step") {
  eq(result.state.index, 1, "one forward gesture advances exactly one index");
  state = result.state;
}

result = requestGalleryStep(state, -1);
eq(result.kind, "step", "reverse gesture rewinds one card");
if (result.kind === "step") {
  eq(result.state.index, 0, "reverse returns to entrance");
}

eq(
  requestGalleryStep(createGalleryStepperState(), -1).kind,
  "release-before",
  "reverse at entrance releases video scroll",
);
const terminal = { index: targets.length - 1 };
eq(
  requestGalleryStep(terminal, 1).kind,
  "release-after",
  "forward at CTA releases page scroll",
);
