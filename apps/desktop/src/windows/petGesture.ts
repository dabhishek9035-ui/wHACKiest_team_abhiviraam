// Local pointer rules for the pet. These are UI timings, not a WebSocket contract.
// A movement past the threshold is a drag and must not count as a tap.

export const DRAG_THRESHOLD_PX = 8;
export const DOUBLE_TAP_MS = 280;

export interface Point {
  x: number;
  y: number;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function isDrag(start: Point, current: Point): boolean {
  return distance(start, current) > DRAG_THRESHOLD_PX;
}

export type TapKind = "single" | "double";

export function classifyTap(lastTapAt: number | null, now: number): TapKind {
  if (lastTapAt !== null && now - lastTapAt <= DOUBLE_TAP_MS) {
    return "double";
  }
  return "single";
}

export type PointerRelease = "drag" | "single" | "double";

// A drag consumes the gesture. It cannot open the composer or the workspace,
// even when the release happens inside the double-tap window.
export function resolvePointerRelease(
  wasDrag: boolean,
  lastTapAt: number | null,
  now: number,
): PointerRelease {
  if (wasDrag) return "drag";
  return classifyTap(lastTapAt, now);
}
