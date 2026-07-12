// Live screen-space rectangles of the airborne award figures. ArcModel writes
// its figure's projected bounding rect (NDC of the full-screen canvas) every
// frame; FigureTooltip (a DOM overlay) reads them for hover / tap hit-tests.
// A Map keyed by figure name — mirrors figureOpacityLive's pattern: written
// imperatively inside useFrame, never through React state.

export interface FigureScreenRect {
  // Award label shown in the tooltip (from the figure manifest).
  label: string;
  // Projected bounds in NDC: x −1(left)..1(right), y −1(bottom)..1(top).
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  // False while the figure is (nearly) invisible or unmounted — not hoverable.
  visible: boolean;
}

export const figureRectsLive = new Map<string, FigureScreenRect>();
