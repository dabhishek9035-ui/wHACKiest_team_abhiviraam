import type { ServerEvent } from "../state/wsClient";
const terminal = new Set(["completed", "partial", "failed", "paused", "cancelled"]);
export function HistoryList({ events }: { events: ServerEvent[] }) {
  const persisted = [...events].reverse().find((e) => e.type === "task.list" && Array.isArray(e.tasks));
  const persistedTasks = Array.isArray(persisted?.tasks) ? persisted.tasks as Record<string, unknown>[] : [];
  const tasks = new Map<string, Record<string, unknown>>();
  for (const e of events) if (e.type === "task.created" && e.taskId) tasks.set(String(e.taskId), { taskId: e.taskId, request: e.request, status: "running" });
  for (const e of events) if (e.type === "task.finished" && e.taskId && tasks.has(String(e.taskId))) tasks.set(String(e.taskId), { ...tasks.get(String(e.taskId)), status: e.status, summary: e.summary, unresolved: e.unresolved });
  const history = [...persistedTasks.filter((t) => terminal.has(String(t.status))), ...[...tasks.values()].filter((t) => terminal.has(String(t.status))).reverse()];
  return <section className="history-list">{history.length ? history.map((task) => <article className="task-card" key={String(task.taskId)}><h3>{String(task.request ?? "Task")}</h3><b className={`outcome outcome-${task.status}`}>{String(task.status)}</b><p>{String(task.summary ?? "")}</p>{task.unresolved && Array.isArray(task.unresolved) && task.unresolved.length ? <p>Unresolved: {task.unresolved.join(", ")}</p> : null}</article>) : <p>Finished tasks will appear here when the agent reports their outcomes.</p>}</section>;
}
