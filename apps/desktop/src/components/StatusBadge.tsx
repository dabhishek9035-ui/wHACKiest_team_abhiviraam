// owner: M2
// purpose: simple pet state feedback for the seven pet.state values
// public interface: render idle, listening, thinking, executing, awaiting approval, completed, failed
// consumed by: PetWindow

import { PET_STATE_LABEL, type PetState } from "../state/store";

interface StatusBadgeProps {
  state: PetState;
}

export function StatusBadge({ state }: StatusBadgeProps) {
  return (
    <p className={`status-badge status-${state}`} role="status">
      {PET_STATE_LABEL[state]}
    </p>
  );
}
