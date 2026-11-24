import { describe, expect, it } from "vitest";
import { classifyTap, DOUBLE_TAP_MS, isDrag, resolvePointerRelease } from "./petGesture";

describe("pet pointer gestures", () => {
  it("treats a small movement as a tap, not a drag", () => {
    expect(isDrag({ x: 0, y: 0 }, { x: 4, y: 4 })).toBe(false);
  });

  it("treats movement past the threshold as a drag", () => {
    expect(isDrag({ x: 10, y: 10 }, { x: 30, y: 10 })).toBe(true);
  });

  it("classifies a second tap inside the window as a double tap", () => {
    expect(classifyTap(1_000, 1_000 + DOUBLE_TAP_MS)).toBe("double");
  });

  it("classifies a later tap as a single tap", () => {
    expect(classifyTap(1_000, 1_000 + DOUBLE_TAP_MS + 1)).toBe("single");
    expect(classifyTap(null, 1_000)).toBe("single");
  });

  it("does not turn a drag into a tap, including inside the double-tap window", () => {
    expect(resolvePointerRelease(true, 1_000, 1_000 + 40)).toBe("drag");
    expect(resolvePointerRelease(false, 1_000, 1_000 + 40)).toBe("double");
    expect(resolvePointerRelease(false, null, 1_000)).toBe("single");
  });
});
