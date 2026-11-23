/**
 * owner: M4 (D Venkata Abhishek)
 * purpose: Task checkpoint serialization and atomic save/load.
 * public interface: saveCheckpoint(taskId, state), loadCheckpoint(taskId).
 * consumed by: packages/store/src/index.ts (M4), services/agent/src/runtime/resume.ts (M1).
 * TODO: Implement transactional checkpoint persistence.
 */
