// owner: M2
// purpose: shared event stream and task state for every desktop panel.
import { useCallback, useEffect, useState } from "react";
import { applyServerMessage } from "./store";
import { createAgentTransport, type ClientEvent, type ConnectionState, type ServerEvent } from "./wsClient";

export function useAgent() {
  const [events, setEvents] = useState<ServerEvent[]>([]);
  const [status, setStatus] = useState<ConnectionState>("connecting");
  const [send, setSend] = useState<((event: ClientEvent) => void) | null>(null);
  useEffect(() => {
    let active = true;
    let transport: Awaited<ReturnType<typeof createAgentTransport>> | null = null;
    void createAgentTransport((event) => {
      if (!active) return;
      applyServerMessage(event);
      setEvents((old) => [...old.slice(-199), { ...event, receivedAt: Date.now() }]);
    }, setStatus).then((value) => {
      if (!active) return value.close();
      transport = value;
      setSend(() => (event: ClientEvent) => value.send(event));
      value.send({ type: "task.list.request", filter: "pending" });
    });
    return () => { active = false; transport?.close(); };
  }, []);
  const sendEvent = useCallback((event: ClientEvent) => send?.(event), [send]);
  return { events, status, send: sendEvent };
}
