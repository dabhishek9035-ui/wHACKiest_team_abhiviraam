import { useState, type FormEvent } from "react";
import { GmailConnectButton } from "../components/GmailConnectButton";
import { MicButton } from "../components/MicButton";
import type { ServerEvent } from "../state/wsClient";
interface ComposerProps { onClose: () => void; send: (event: { type: string; [key: string]: unknown }) => void; events: ServerEvent[]; }
export function Composer({ onClose, send, events }: ComposerProps) {
  const [text, setText] = useState("");
  function submit(event: FormEvent) { event.preventDefault(); const request = text.trim(); if (request) { send({ type: "user.message", text: request, source: "text" }); setText(""); } }
  const last = [...events].reverse().find((event) => event.type === "voice.transcript" || event.type === "task.finished" || event.type === "error");
  return <form className="composer" onSubmit={submit}><div className="panel-head"><strong>Quick request</strong><button type="button" onClick={onClose}>Close</button></div><label htmlFor="composer-text">What should Pengu do?</label><textarea id="composer-text" rows={3} value={text} onChange={(event) => setText(event.target.value)} placeholder="Type a request"/><div className="request-actions"><MicButton send={send}/><button type="submit" disabled={!text.trim()}>Send</button></div><GmailConnectButton events={events} send={send}/>{last ? <p className="composer-result" role="status">{String(last.text ?? last.summary ?? last.message ?? "")}</p> : null}</form>;
}
