import { useEffect, useState } from "react";
import type { ServerEvent } from "../state/wsClient";

function display(value: unknown) { return typeof value === "string" || typeof value === "number" ? String(value) : value == null ? "" : JSON.stringify(value, null, 2); }
export function ApprovalModal({ event, invalidated, send, onDecision }: { event: ServerEvent; invalidated?: string; send: (event: { type: string; [key: string]: unknown }) => void; onDecision: () => void }) {
  const [, refresh] = useState(0);
  useEffect(() => { const expires = new Date(String(event.expiresAt ?? 0)).getTime(); const timer = window.setTimeout(() => refresh((value) => value + 1), Math.max(0, expires - Date.now())); return () => window.clearTimeout(timer); }, [event.expiresAt]);
  const preview = (event.preview && typeof event.preview === "object" ? event.preview : {}) as Record<string, unknown>;
  const email = "recipient" in preview || "to" in preview;
  const command = "command" in preview || "commandId" in preview;
  const needed = email ? ["to", "recipient", "subject", "body"] : command ? ["command", "commandId", "arguments", "args", "cwd", "purpose", "impact", "reversibility"] : [];
  const has = (key: string) => key in preview && display(preview[key]).trim() !== "";
  const missing = needed.filter((key) => !has(key) && !(key === "recipient" && has("to")) && !(key === "to" && has("recipient")) && !(key === "args" && has("arguments")) && !(key === "arguments" && has("args")) && !(key === "command" && has("commandId")) && !(key === "commandId" && has("command")));
  const expired = !event.expiresAt || new Date(String(event.expiresAt)).getTime() <= Date.now();
  const disabled = Boolean(invalidated) || expired || missing.length > 0;
  return <div className="modal-backdrop" role="presentation"><section className="approval-modal" role="dialog" aria-modal="true" aria-labelledby="approval-title"><h3 id="approval-title">Review this action</h3><p>{String(event.reason ?? "The agent requires your approval for this exact action.")}</p><dl>{Object.entries(preview).map(([key, value]) => <div key={key}><dt>{key}</dt><dd className={key === "body" || key === "arguments" || key === "args" ? "sensitive-preview" : ""}>{display(value)}</dd></div>)}</dl>{invalidated ? <p role="alert">Approval expired or changed: {invalidated}</p> : expired ? <p role="alert">This approval has expired. Request a fresh preview.</p> : missing.length ? <p role="alert">Cannot approve: required preview details are missing ({missing.join(", ")}).</p> : null}<div className="modal-actions"><button onClick={() => { send({ type: "approval.decision", approvalId: event.approvalId, decision: "deny" }); onDecision(); }}>Deny</button><button disabled={disabled} onClick={() => { send({ type: "approval.decision", approvalId: event.approvalId, decision: "approve" }); onDecision(); }}>Approve exact action</button></div></section></div>;
}
