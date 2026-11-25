/**
 * owner: M1 (Ronit Kapar)
 * purpose: Frozen WebSocket JSON protocol types for UI <-> Agent (Section 7.1).
 */

import type { ApprovalDecision, ApprovalPreview } from "./approval.js";
import type { TaskState } from "./store-api.js";

export type MessageSource = "text" | "voice";

export type StepKind = "read" | "routine" | "consequential";

export type StepStatus =
  | "planned"
  | "running"
  | "awaiting_approval"
  | "done"
  | "failed"
  | "skipped";

export type TaskTerminalStatus =
  | "completed"
  | "partial"
  | "failed"
  | "cancelled"
  | "paused";

export type PetState =
  | "idle"
  | "listening"
  | "thinking"
  | "executing"
  | "awaiting_approval"
  | "completed"
  | "failed";

export interface TaskStepSummary {
  stepId: string;
  summary: string;
  tool?: string;
  server?: string;
  status: StepStatus;
}

/**
 * Minimum persisted task payload returned in task.list (Section 7.1).
 * Must never include secrets or unnecessary private message contents.
 */
export interface TaskSummaryItem {
  taskId: string;
  request: string;
  status: TaskState;
  steps: TaskStepSummary[];
  pauseReason?: string;
  updatedAt?: string;
  outputRefs?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Client -> Server Messages
// ---------------------------------------------------------------------------

export interface UserMessageClientEvent {
  type: "user.message";
  taskId?: string;
  text: string;
  source: MessageSource;
}

export interface ApprovalDecisionClientEvent {
  type: "approval.decision";
  approvalId: string;
  decision: ApprovalDecision;
}

export interface TaskListRequestClientEvent {
  type: "task.list.request";
  filter?: "pending" | "all";
}

export interface TaskResumeClientEvent {
  type: "task.resume";
  taskId: string;
}

export interface TaskCancelClientEvent {
  type: "task.cancel";
  taskId: string;
}

export interface VoiceAudioClientEvent {
  type: "voice.audio";
  mime: string;
  base64: string;
  languageHint?: string;
}

export interface TtsRequestClientEvent {
  type: "tts.request";
  text: string;
  language: string;
}

export interface GmailAuthStatusRequestClientEvent {
  type: "gmail.auth.status.request";
}

export interface GmailAuthStartClientEvent {
  type: "gmail.auth.start";
}

export type ClientMessage =
  | UserMessageClientEvent
  | ApprovalDecisionClientEvent
  | TaskListRequestClientEvent
  | TaskResumeClientEvent
  | TaskCancelClientEvent
  | VoiceAudioClientEvent
  | TtsRequestClientEvent
  | GmailAuthStatusRequestClientEvent
  | GmailAuthStartClientEvent;

// ---------------------------------------------------------------------------
// Server -> Client Events
// ---------------------------------------------------------------------------

export interface TaskCreatedServerEvent {
  type: "task.created";
  taskId: string;
  request: string;
}

export interface TaskStepServerEvent {
  type: "task.step";
  taskId: string;
  stepId: string;
  tool: string;
  server: string;
  kind: StepKind;
  status: StepStatus;
  summary: string;
}

export interface ApprovalRequestedServerEvent {
  type: "approval.requested";
  approvalId: string;
  taskId: string;
  preview: ApprovalPreview;
  reason: string;
  expiresAt: string;
}

export interface ApprovalInvalidatedServerEvent {
  type: "approval.invalidated";
  approvalId: string;
  reason: string;
}

export interface TaskFinishedServerEvent {
  type: "task.finished";
  taskId: string;
  status: TaskTerminalStatus;
  summary: string;
  unresolved: string[];
}

export interface TaskListServerEvent {
  type: "task.list";
  tasks: TaskSummaryItem[];
}

export interface PetStateServerEvent {
  type: "pet.state";
  state: PetState;
}

export interface VoiceTranscriptServerEvent {
  type: "voice.transcript";
  text: string;
  language: string;
}

export interface TtsAudioServerEvent {
  type: "tts.audio";
  mime: string;
  base64: string;
}

export interface TtsUnsupportedServerEvent {
  type: "tts.unsupported";
  reason: string;
}

export interface GmailAuthStatusServerEvent {
  type: "gmail.auth.status";
  status: "connected" | "not_connected" | "starting" | "failed";
  message: string;
}

export interface ErrorServerEvent {
  type: "error";
  code: string;
  message: string;
}

export type ServerEvent =
  | TaskCreatedServerEvent
  | TaskStepServerEvent
  | ApprovalRequestedServerEvent
  | ApprovalInvalidatedServerEvent
  | TaskFinishedServerEvent
  | TaskListServerEvent
  | PetStateServerEvent
  | VoiceTranscriptServerEvent
  | TtsAudioServerEvent
  | TtsUnsupportedServerEvent
  | GmailAuthStatusServerEvent
  | ErrorServerEvent;
