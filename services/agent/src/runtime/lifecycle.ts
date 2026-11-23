/**
 * owner: M1 (Ronit Kapar)
 * purpose: Task state machine, honest terminal status resolution, and pet.state mapping.
 */

import type {
  PetState,
  StepRecord,
  TaskState,
  TaskTerminalStatus,
} from "@pengu/contracts";

export function mapTaskToPetState(status: TaskState): PetState {
  switch (status) {
    case "received":
    case "planned":
      return "thinking";
    case "running":
      return "executing";
    case "awaiting_approval":
      return "awaiting_approval";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "partial":
    case "paused":
    case "cancelled":
    default:
      return "idle";
  }
}

/**
 * Computes an honest terminal status from actual step outcomes.
 * Rule (Section 2.3): Never report "completed" if any step failed or remained unresolved.
 */
export function resolveTerminalStatus(
  steps: Array<Pick<StepRecord, "status">>,
  options: { cancelled?: boolean; paused?: boolean; unresolved?: string[] } = {}
): TaskTerminalStatus {
  if (options.cancelled) return "cancelled";
  if (options.paused) return "paused";

  const hasUnresolved = (options.unresolved?.length ?? 0) > 0;
  const doneCount = steps.filter((s) => s.status === "done").length;
  const failedCount = steps.filter((s) => s.status === "failed").length;
  const pendingCount = steps.filter(
    (s) =>
      s.status === "planned" ||
      s.status === "running" ||
      s.status === "awaiting_approval"
  ).length;

  if (failedCount > 0 && doneCount > 0) return "partial";
  if (failedCount > 0 && doneCount === 0) return "failed";
  if (pendingCount > 0 || hasUnresolved) return doneCount > 0 ? "partial" : "failed";
  return "completed";
}
