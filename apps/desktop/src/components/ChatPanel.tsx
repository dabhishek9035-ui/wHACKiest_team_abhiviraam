import type { FormEvent, KeyboardEvent } from "react";
import type { ServerEvent } from "../state/wsClient";
import { useTranscriptDraft } from "../state/useTranscriptDraft";
import { MicButton } from "./MicButton";

export function ChatPanel({ events, send, status }: { events: ServerEvent[]; send: (event: { type: string; [key: string]: unknown }) => void; status: string }) {
  const draft = useTranscriptDraft(events);
  function submit(event: FormEvent) { event.preventDefault(); const request = draft.text.trim(); if (!request) return; send({ type: "user.message", text: request, source: draft.source }); draft.clear(); }
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }
  const chat = events.filter((e) => ["task.created", "task.finished", "voice.transcript", "tts.unsupported", "error"].includes(e.type));
  return <div className="chat-panel"><p className="connection" role="status">Agent: {status}</p>
    <div className="chat-log" aria-live="polite">{chat.length ? chat.map((e, i) => <article key={`${e.type}-${i}`} className="chat-event"><b>{e.type === "task.created" ? "You" : e.type === "task.finished" ? String(e.status) : e.type === "voice.transcript" ? `Transcript${e.language ? ` · ${String(e.language)}` : ""}` : e.type === "tts.unsupported" ? "Voice unavailable" : "Notice"}</b><p>{String(e.request ?? e.summary ?? e.text ?? (e.type === "tts.unsupported" ? e.reason : e.message) ?? "")}</p>{e.type === "task.finished" && e.unresolved ? <p>Needs attention: {Array.isArray(e.unresolved) ? e.unresolved.join(", ") : String(e.unresolved)}</p> : null}{e.type === "task.finished" && e.summary ? <button type="button" onClick={() => send({ type: "tts.request", text: String(e.summary), language: "en-IN" })}>Speak reply (English India)</button> : null}</article>) : <p>Send a request to see its progress here.</p>}</div>
    <form className="request-form" onSubmit={submit}><label htmlFor="request-text">Message Pengu</label><textarea id="request-text" rows={3} value={draft.text} onChange={(e) => draft.editText(e.target.value)} onKeyDown={handleKeyDown} placeholder="Ask Pengu to help (Enter to send, Shift+Enter for a new line)"/><div className="request-actions"><MicButton send={send}/><button type="submit" disabled={!draft.text.trim()}>Send request</button></div></form>
  </div>;
}
