/**
 * owner: M1 (Ronit Kapar)
 * purpose: Builds observable step plans and safe UI summaries from GLM proposals without exposing private chain-of-thought.
 */

import type { RiskClass, StepKind } from "@pengu/contracts";
import type { ProposedToolCall } from "../llm/glm-client.js";
import type { McpToolRegistry } from "../mcp/registry.js";

export interface PlannedStep {
  tool: string;
  server: string;
  kind: StepKind;
  args: Record<string, unknown>;
  summary: string;
}

export function riskClassToStepKind(riskClass?: RiskClass): StepKind {
  if (riskClass === "CONSEQUENTIAL") return "consequential";
  if (riskClass === "ROUTINE") return "routine";
  return "read";
}

export function summarizeToolProposal(
  tool: string,
  args: Record<string, unknown>
): string {
  switch (tool) {
    case "gmail_search_threads":
      return `Search Gmail threads for "${String(args.query ?? "")}"`;
    case "gmail_read_thread":
      return `Read Gmail thread ${String(args.threadId ?? "")}`;
    case "gmail_create_draft":
      return `Create reply draft in Gmail`;
    case "gmail_get_draft":
      return `Inspect Gmail draft ${String(args.draftId ?? "")} for approval preview`;
    case "gmail_send_draft":
      return `Send Gmail draft ${String(args.draftId ?? "")} (requires approval)`;
    case "fs_list_dir":
      return `List directory ${String(args.path ?? "")}`;
    case "fs_create_folder":
      return `Create folder ${String(args.path ?? "")}`;
    case "browser_open_url":
      return `Open URL ${String(args.url ?? "")} in Chrome`;
    case "app_launch":
      return `Launch allowlisted app '${String(args.appId ?? "")}'`;
    case "shell_describe_command":
      return `Describe allowlisted command '${String(args.commandId ?? "")}'`;
    case "shell_run_restricted":
      return `Run restricted command '${String(args.commandId ?? "")}' (requires approval)`;
    default:
      return `Evaluate tool '${tool}'`;
  }
}

export function buildPlannedStep(
  proposal: ProposedToolCall,
  registry: McpToolRegistry
): PlannedStep {
  const registered = registry.getTool(proposal.name);
  return {
    tool: proposal.name,
    server: registered?.server ?? "unknown",
    kind: riskClassToStepKind(registered?.manifest.riskClass),
    args: proposal.args,
    summary: summarizeToolProposal(proposal.name, proposal.args),
  };
}
