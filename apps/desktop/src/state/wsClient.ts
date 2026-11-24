// owner: M2
// purpose: authenticated local-agent WebSocket with reconnect and mock fallback.
import { invoke, isTauri } from "@tauri-apps/api/core";

export type ClientEvent = Record<string, unknown> & { type: string };
export type ServerEvent = Record<string, unknown> & { type: string };
export type ConnectionState = "connecting" | "connected" | "reconnecting" | "offline";

export interface EventTransport {
  send(event: ClientEvent): void;
  close(): void;
}

export async function createAgentTransport(
  onEvent: (event: ServerEvent) => void,
  onStatus: (status: ConnectionState) => void,
  mock = import.meta.env.VITE_PENGU_MOCK === "1" || new URLSearchParams(window.location.search).get("mock") === "1",
): Promise<EventTransport> {
  if (mock) {
    const { createMockTransport } = await import("../mock/mockServer");
    return createMockTransport(onEvent, onStatus);
  }
  let socket: WebSocket | null = null;
  let stopped = false;
  let retryTimer = 0;
  let retry = 0;
  const backlog: ClientEvent[] = [];
  const connect = async () => {
    if (stopped) return;
    onStatus(retry ? "reconnecting" : "connecting");
    try {
      const token = isTauri() ? await invoke<string>("get_ws_token") : "";
      const address = new URL("ws://127.0.0.1:7777");
      if (token) address.searchParams.set("token", token);
      socket = new WebSocket(address);
      socket.onopen = () => {
        retry = 0;
        onStatus("connected");
        while (backlog.length) socket?.send(JSON.stringify(backlog.shift()));
      };
      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(String(message.data)) as ServerEvent;
          if (event && typeof event.type === "string") onEvent(event);
        } catch { onEvent({ type: "error", code: "bad_event", message: "The agent sent an unreadable event." }); }
      };
      socket.onclose = () => scheduleReconnect();
      socket.onerror = () => socket?.close();
    } catch { scheduleReconnect(); }
  };
  const scheduleReconnect = () => {
    if (stopped || retryTimer) return;
    onStatus("offline");
    retry++;
    retryTimer = window.setTimeout(() => { retryTimer = 0; void connect(); }, Math.min(8000, 400 * 2 ** Math.min(retry, 5)));
  };
  void connect();
  return {
    send(event) {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
      else if (backlog.length < 50) backlog.push(event);
    },
    close() { stopped = true; window.clearTimeout(retryTimer); socket?.close(); },
  };
}
