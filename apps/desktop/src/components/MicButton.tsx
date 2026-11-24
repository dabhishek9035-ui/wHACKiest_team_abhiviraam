import { useRef, useState } from "react";

export function MicButton({ send }: { send: (event: { type: string; [key: string]: unknown }) => void }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  async function toggle() {
    if (busy && recorder.current) { recorder.current.stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setNotice("Microphone recording is not supported in this environment."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const media = new MediaRecorder(stream);
      recorder.current = media;
      media.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      media.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        setBusy(false); recorder.current = null;
        const blob = new Blob(chunks, { type: media.mimeType || "audio/webm" });
        if (!blob.size) { setNotice("No audio was captured."); return; }
        const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1] ?? ""); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
        send({ type: "voice.audio", mime: blob.type, base64, languageHint: "en-IN" }); setNotice("Audio sent. The transcript will appear here before you continue.");
      };
      media.start(); setBusy(true); setNotice("Listening… select Stop when you are done.");
    } catch { setNotice("Microphone access was unavailable. Check the app's microphone permission."); }
  }
  return <span className="mic-wrap"><button type="button" onClick={() => void toggle()}>{busy ? "Stop recording" : "🎙 Voice"}</button>{notice ? <span className="sr-notice" role="status">{notice}</span> : null}</span>;
}
