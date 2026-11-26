import type { FormEvent, KeyboardEvent } from "react";
import { GmailConnectButton } from "../components/GmailConnectButton";
import { MicButton } from "../components/MicButton";
import type { ServerEvent } from "../state/wsClient";
import { useTranscriptDraft } from "../state/useTranscriptDraft";
interface ComposerProps { onClose: () => void; send: (event: { type: string; [key: string]: unknown }) => void; events: ServerEvent[]; }
export function Composer({ onClose, send, events }: ComposerProps) {
  const draft = useTranscriptDraft(events);
  function submit(event: FormEvent) { event.preventDefault(); const request = draft.text.trim(); if (request) { send({ type: "user.message", text: request, source: draft.source }); draft.clear(); } }
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }
  const last = [...events].reverse().find((event) => event.type === "voice.transcript" || event.type === "task.finished" || event.type === "error");
  return <form className="composer" onSubmit={submit}><div className="panel-head"><strong>Quick request</strong><button type="button" onClick={onClose}>Close</button></div><label htmlFor="composer-text">What should Pengu do?</label><textarea id="composer-text" rows={3} value={draft.text} onChange={(event) => draft.editText(event.target.value)} onKeyDown={handleKeyDown} placeholder="Type a request (Enter to send, Shift+Enter for a new line)"/><div className="request-actions"><MicButton send={send}/><button type="submit" disabled={!draft.text.trim()}>Send</button></div><GmailConnectButton events={events} send={send}/>{last ? <p className="composer-result" role="status">{String(last.text ?? last.summary ?? last.message ?? "")}</p> : null}</form>;
}
