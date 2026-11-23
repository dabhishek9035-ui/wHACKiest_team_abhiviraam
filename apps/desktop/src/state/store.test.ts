import { beforeEach, describe, expect, it } from "vitest";
import {
  PET_STATES,
  applyServerMessage,
  getPetState,
  reducePetState,
  resetPetStateForTests,
  subscribePetState,
} from "./store";

describe("pet.state", () => {
  beforeEach(() => {
    resetPetStateForTests();
  });

  it("accepts only the seven section 7.1 pet states", () => {
    for (const state of PET_STATES) {
      expect(reducePetState("idle", { type: "pet.state", state })).toBe(state);
    }
    expect(reducePetState("idle", { type: "pet.state", state: "done" })).toBe("idle");
    expect(reducePetState("thinking", { type: "task.finished", state: "completed" })).toBe(
      "thinking",
    );
  });

  it("publishes an applied pet.state to subscribers", () => {
    const seen: string[] = [];
    const unsubscribe = subscribePetState((state) => seen.push(state));
    expect(applyServerMessage({ type: "pet.state", state: "awaiting_approval" })).toBe(
      "awaiting_approval",
    );
    expect(getPetState()).toBe("awaiting_approval");
    expect(applyServerMessage({ type: "error", state: "failed" })).toBe("awaiting_approval");
    unsubscribe();
    applyServerMessage({ type: "pet.state", state: "failed" });
    expect(seen).toEqual(["awaiting_approval"]);
    expect(getPetState()).toBe("failed");
  });
});
