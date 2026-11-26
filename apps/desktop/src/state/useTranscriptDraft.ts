import { useEffect, useRef, useState } from "react";
import type { ServerEvent } from "./wsClient";

export function useTranscriptDraft(events: ServerEvent[]) {
  const [text, setText] = useState("");
  const [source, setSource] = useState<"text" | "voice">("text");
  const transcript = [...events].reverse().find((event) => event.type === "voice.transcript");
  const handledTranscript = useRef(transcript);

  useEffect(() => {
    if (!transcript || transcript === handledTranscript.current) return;
    handledTranscript.current = transcript;
    if (typeof transcript.text !== "string" || !transcript.text.trim()) return;
    setText(transcript.text);
    setSource("voice");
  }, [transcript]);

  function editText(value: string) {
    setText(value);
    setSource("text");
  }

  function clear() {
    setText("");
    setSource("text");
  }

  return { text, source, editText, clear };
}
