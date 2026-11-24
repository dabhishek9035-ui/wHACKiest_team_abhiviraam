// owner: M2
// purpose: pet.state slice of the UI store. Other section 7.1 events stay unwired until later steps.
// public interface: apply a pet.state message and subscribe to the seven pet states
// consumed by: PetWindow, StatusBadge

export const PET_STATES = [
  "idle",
  "listening",
  "thinking",
  "executing",
  "awaiting_approval",
  "completed",
  "failed",
] as const;

export type PetState = (typeof PET_STATES)[number];

export const PET_STATE_LABEL: Record<PetState, string> = {
  idle: "Idle",
  listening: "Listening",
  thinking: "Thinking",
  executing: "Executing",
  awaiting_approval: "Awaiting approval",
  completed: "Completed",
  failed: "Failed",
};

export function isPetState(value: unknown): value is PetState {
  return typeof value === "string" && (PET_STATES as readonly string[]).includes(value);
}

export function reducePetState(
  current: PetState,
  message: { type?: unknown; state?: unknown },
): PetState {
  if (message.type !== "pet.state") return current;
  if (!isPetState(message.state)) return current;
  return message.state;
}

let petState: PetState = "idle";
const listeners = new Set<(state: PetState) => void>();

export function getPetState(): PetState {
  return petState;
}

export function subscribePetState(listener: (state: PetState) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetPetStateForTests(): void {
  petState = "idle";
  listeners.clear();
}

// Accepts one server message. Only `pet.state` with a section 7.1 state changes the pet.
export function applyServerMessage(message: { type?: unknown; state?: unknown }): PetState {
  const next = reducePetState(petState, message);
  if (next !== petState) {
    petState = next;
    for (const listener of listeners) listener(petState);
  }
  return petState;
}
