import type { ServerEvent } from "../state/wsClient";
export function ActivityTimeline({ events }: { events: ServerEvent[] }) {
  const taskIds = new Set(events.filter((e) => e.type === "task.created").map((e) => e.taskId));
  const activity = events.filter((e) => ["task.created", "task.step", "approval.requested", "approval.invalidated", "task.finished", "error"].includes(e.type) && (!e.taskId || taskIds.has(e.taskId)));
  return <section className="timeline" aria-label="Task activity">{activity.length ? activity.map((e, i) => <article className="timeline-item" key={`${e.type}-${i}`}><div className="timeline-title"><b>{e.type.replaceAll(".", " ")}</b><span>{String(e.status ?? e.kind ?? "")}</span></div><p>{String(e.summary ?? e.reason ?? e.message ?? e.request ?? "")}</p>{e.tool ? <small>{String(e.server ?? "tool")} / {String(e.tool)} · risk: {String(e.kind ?? "unknown")}</small> : null}{e.type === "task.step" && e.summary ? <details><summary>Details</summary><p>{String(e.summary)}</p></details> : null}</article>) : <p>Task steps and outcomes will appear here as the agent reports them.</p>}</section>;
}
