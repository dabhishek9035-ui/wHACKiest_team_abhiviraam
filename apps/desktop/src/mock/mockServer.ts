// owner: M2
// purpose: in-process mock matching the UI side of the section 7.1 event contract.
import type { ClientEvent, ConnectionState, EventTransport, ServerEvent } from "../state/wsClient";
import { MOCK_PENDING_TASKS, MOCK_SEND_PREVIEW } from "./scriptedEvents";

const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
export function createMockTransport(onEvent: (event: ServerEvent) => void, onStatus: (status: ConnectionState) => void): EventTransport {
  let closed = false;
  let activeApprovalTask = "demo-approval";
  onStatus("connected");
  const emit = (event: ServerEvent, wait = 0) => { window.setTimeout(() => { if (!closed) onEvent(event); }, wait); };
  return {
    send(event: ClientEvent) {
      switch (event.type) {
        case "task.list.request": emit({ type: "task.list", tasks: event.filter === "all" ? [...MOCK_PENDING_TASKS, { taskId: "demo-history", request: "Open the project folder", status: "completed", summary: "Folder opened.", steps: [] }] : MOCK_PENDING_TASKS }); break;
        case "user.message": {
          const taskId = `mock-${Date.now()}`;
          activeApprovalTask = taskId;
          emit({ type: "pet.state", state: "thinking" });
          emit({ type: "task.created", taskId, request: event.text }, 80);
          if (String(event.text).toLowerCase().includes("send")) {
            emit({ type: "task.step", taskId, stepId: "send", tool: "gmail_send_draft", server: "gmail", kind: "consequential", status: "awaiting_approval", summary: "Ready to send a reply draft; waiting for your approval." }, 350);
            emit({ type: "approval.requested", approvalId: `approval-${taskId}`, taskId, preview: MOCK_SEND_PREVIEW, reason: "Sending email is consequential and needs approval of the exact message.", expiresAt: new Date(Date.now() + 120_000).toISOString() }, 450);
            emit({ type: "pet.state", state: "awaiting_approval" }, 470);
            break;
          }
          emit({ type: "task.step", taskId, stepId: "read", tool: "gmail_search_threads", server: "gmail", kind: "read", status: "running", summary: "Searching the authorized mailbox" }, 250);
          emit({ type: "task.step", taskId, stepId: "read", tool: "gmail_search_threads", server: "gmail", kind: "read", status: "done", summary: "Found one matching conversation" }, 650);
          emit({ type: "task.step", taskId, stepId: "draft", tool: "gmail_create_draft", server: "gmail", kind: "routine", status: "done", summary: "Prepared a reply draft" }, 950);
          emit({ type: "task.finished", taskId, status: "completed", summary: "Reply draft is ready.", unresolved: [] }, 1200);
          emit({ type: "pet.state", state: "completed" }, 1250);
          break;
        }
        case "approval.decision": emit({ type: "task.finished", taskId: activeApprovalTask, status: event.decision === "approve" ? "completed" : "cancelled", summary: event.decision === "approve" ? "Approved action completed in demo." : "Action denied.", unresolved: [] }); break;
        case "task.resume": emit({ type: "task.step", taskId: String(event.taskId), stepId: "resume", kind: "routine", status: "running", summary: "Resuming after rechecking prior work" }); break;
        case "task.cancel": emit({ type: "task.finished", taskId: String(event.taskId), status: "cancelled", summary: "Task cancelled.", unresolved: [] }); break;
        case "voice.audio": emit({ type: "voice.transcript", text: "Summarize my latest project email", language: "en-IN" }, 300); break;
        case "tts.request": emit({ type: "tts.unsupported", reason: "Voice playback is unavailable in the UI mock." }); break;
        default: void delay(0);
      }
    },
    close() { closed = true; onStatus("offline"); },
  };
}
