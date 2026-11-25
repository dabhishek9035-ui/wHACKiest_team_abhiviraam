import { useEffect } from "react";
import type { ServerEvent } from "../state/wsClient";

type GmailStatusEvent = ServerEvent & {
  type: "gmail.auth.status";
  status: "connected" | "not_connected" | "starting" | "failed";
  message: string;
};

export function GmailConnectButton({
  events,
  send,
}: {
  events: ServerEvent[];
  send: (event: { type: string; [key: string]: unknown }) => void;
}) {
  const statusEvent = [...events]
    .reverse()
    .find((event): event is GmailStatusEvent => event.type === "gmail.auth.status");
  const connected = statusEvent?.status === "connected";
  const starting = statusEvent?.status === "starting";

  useEffect(() => {
    const refresh = () => send({ type: "gmail.auth.status.request" });
    refresh();
    if (connected) return;
    const timer = window.setInterval(refresh, 3000);
    return () => window.clearInterval(timer);
  }, [send, connected]);

  return (
    <div className="gmail-connect-control">
      <button
        type="button"
        disabled={connected || starting}
        onClick={() => send({ type: "gmail.auth.start" })}
      >
        {connected ? "Gmail connected" : starting ? "Opening Google…" : "Connect Gmail"}
      </button>
      <span role="status">
        {statusEvent?.message ?? "Sign in with Google to search and read Gmail."}
      </span>
    </div>
  );
}
