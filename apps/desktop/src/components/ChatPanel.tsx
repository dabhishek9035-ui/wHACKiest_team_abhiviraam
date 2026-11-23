import { useState, type FormEvent } from "react";
import type { ServerEvent } from "../state/wsClient";
import { MicButton } from "./MicButton";

export function ChatPanel({ events, send, status }: { events: ServerEvent[]; send: (event: { type: string; [key: string]: unknown }) => void; status: string }) {
  const [text, setText] = useState("");
  function submit(event: FormEvent) { event.preventDefault(); const request = text.trim(); if (!request) return; send({ type: "user.message", text: request, source: "text" }); setText(""); }
  const chat = events.filter((e) => ["task.created", "task.finished", "voice.transcript", "tts.unsupported", "error"].includes(e.type));
  return <div className="chat-panel"><p className="connection" role="status">Agent: {status}</p>
    <div className="chat-log" aria-live="polite">{chat.length ? chat.map((e, i) => <article key={`${e.type}-${i}`} className="chat-event"><b>{e.type === "task.created" ? "You" : e.type === "task.finished" ? String(e.status) : e.type === "voice.transcript" ? `Transcript${e.language ? ` · ${String(e.language)}` : ""}` : e.type === "tts.unsupported" ? "Voice unavailable" : "Notice"}</b><p>{String(e.request ?? e.summary ?? e.text ?? (e.type === "tts.unsupported" ? e.reason : e.message) ?? "")}</p>{e.type === "task.finished" && e.unresolved ? <p>Needs attention: {Array.isArray(e.unresolved) ? e.unresolved.join(", ") : String(e.unresolved)}</p> : null}{e.type === "task.finished" && e.summary ? <button type="button" onClick={() => send({ type: "tts.request", text: String(e.summary), language: "en-IN" })}>Speak reply (English India)</button> : null}</article>) : <p>Send a request to see its progress here.</p>}</div>
    <form className="request-form" onSubmit={submit}><label htmlFor="request-text">Message Pengu</label><textarea id="request-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask Pengu to help with a task"/><div className="request-actions"><MicButton send={send}/><button type="submit" disabled={!text.trim()}>Send request</button></div></form>
  </div>;
}
