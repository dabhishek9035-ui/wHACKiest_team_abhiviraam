/**
 * owner: M4 (D Venkata Abhishek)
 * purpose: Startup restore queries assembling pending task summaries for UI restore view and resume flow.
 * public interface: listPendingRestoreItems, getResumeContext.
 * consumed by: packages/store/src/index.ts (M4), services/agent/src/runtime/resume.ts (M1).
 * TODO: Return sanitized TaskSummaryItem[] without secrets or private bodies.
 */
