import { describe, expect, it } from "vitest";
import {
  PENGU_DEFAULT_SRC,
  PENGU_DRAGGED_SRC,
  PET_STATE_ASSETS,
  resolvePetSprite,
} from "./petAssets";
import { PET_STATES } from "./store";

describe("petAssets", () => {
  it("maps every section 7.1 pet state to a Pengu PNG or GIF asset", () => {
    expect(PENGU_DEFAULT_SRC).toContain("pengu_idle.gif");
    expect(PENGU_DRAGGED_SRC).toContain("pengu_dragged.png");
    for (const state of PET_STATES) {
      const src = PET_STATE_ASSETS[state];
      expect(typeof src).toBe("string");
      expect(src.length).toBeGreaterThan(0);
      expect(src).toMatch(/\.(gif|png)(\?.*)?$/i);
    }
  });

  it("prefers custom avatar over state/drag sprites and shows dragged sprite while dragging default pet", () => {
    expect(resolvePetSprite("thinking", null, false)).toBe(PET_STATE_ASSETS.thinking);
    expect(resolvePetSprite("idle", null, true)).toBe(PENGU_DRAGGED_SRC);
    expect(resolvePetSprite("idle", "data:image/png;base64,abc", true)).toBe(
      "data:image/png;base64,abc",
    );
  });
});
