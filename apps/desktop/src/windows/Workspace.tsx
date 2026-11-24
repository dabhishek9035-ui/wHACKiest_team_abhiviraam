import { useState } from "react";
import { ActivityTimeline } from "../components/ActivityTimeline";
import { ApprovalModal } from "../components/ApprovalModal";
import { AvatarPicker } from "../components/AvatarPicker";
import { ChatPanel } from "../components/ChatPanel";
import { HistoryList } from "../components/HistoryList";
import { PendingTasks } from "../components/PendingTasks";
import type { AvatarPersistence } from "../state/avatar";
import type { ServerEvent } from "../state/wsClient";

const TABS = ["Chat", "Activity", "History", "Pending"] as const;
type Tab = (typeof TABS)[number];
interface WorkspaceProps { onClose: () => void; defaultAvatarSrc: string; appliedAvatarSrc: string; persistence: AvatarPersistence; onAvatarApplied: (src: string) => void; events: ServerEvent[]; send: (event: { type: string; [key: string]: unknown }) => void; status: string; }
export function Workspace({ onClose, defaultAvatarSrc, appliedAvatarSrc, persistence, onAvatarApplied, events, send, status }: WorkspaceProps) {
  const [tab, setTab] = useState<Tab>("Chat");
  const [decidedApproval, setDecidedApproval] = useState<string | null>(null);
  const approval = [...events].reverse().find((event) => event.type === "approval.requested" && String(event.approvalId) !== decidedApproval);
  const invalidation = approval ? [...events].reverse().find((event) => event.type === "approval.invalidated" && event.approvalId === approval.approvalId) : undefined;
  return <section className="workspace" aria-label="Workspace"><div className="panel-head"><strong>Pengu workspace</strong><button type="button" onClick={onClose}>Close</button></div>
    <AvatarPicker defaultSrc={defaultAvatarSrc} appliedSrc={appliedAvatarSrc} persistence={persistence} onApplied={onAvatarApplied}/>
    <div className="tabs" role="tablist" aria-label="Workspace sections">{TABS.map((name) => <button key={name} type="button" role="tab" aria-selected={tab === name} onClick={() => { setTab(name); if (name === "History") send({ type: "task.list.request", filter: "all" }); if (name === "Pending") send({ type: "task.list.request", filter: "pending" }); }}>{name}</button>)}</div>
    <div className="tab-panel" role="tabpanel">{tab === "Chat" ? <ChatPanel events={events} send={send} status={status}/> : tab === "Activity" ? <ActivityTimeline events={events}/> : tab === "History" ? <HistoryList events={events}/> : <PendingTasks events={events} send={send}/>}</div>
    {approval ? <ApprovalModal event={approval} invalidated={invalidation ? String(invalidation.reason ?? "This approval is no longer valid.") : undefined} send={send} onDecision={() => setDecidedApproval(String(approval.approvalId))}/> : null}
  </section>;
}
