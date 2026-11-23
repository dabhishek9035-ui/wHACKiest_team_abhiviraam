/**
 * owner: M1 (Ronit Kapar)
 * purpose: Fail-closed manifest-based risk classifier (Section 7.2).
 */

import type { RiskClass, ToolManifestEntry } from "@pengu/contracts";

export interface ClassificationResult {
  allowed: boolean;
  riskClass?: RiskClass;
  requiresApproval: boolean;
  reason: string;
}

const VALID_RISK_CLASSES = new Set<RiskClass>([
  "READ",
  "ROUTINE",
  "CONSEQUENTIAL",
]);

/**
 * Classifies a tool strictly from its loaded manifest entry.
 * Missing manifest or unknown riskClass always fails closed (DENY).
 */
export function classifyToolCall(
  manifestEntry: ToolManifestEntry | undefined
): ClassificationResult {
  if (!manifestEntry) {
    return {
      allowed: false,
      requiresApproval: false,
      reason: "Denied by default: tool is missing from loaded MCP tool manifests.",
    };
  }

  if (!VALID_RISK_CLASSES.has(manifestEntry.riskClass)) {
    return {
      allowed: false,
      requiresApproval: false,
      reason: `Denied by default: unknown riskClass '${String(manifestEntry.riskClass)}' for tool '${manifestEntry.name}'.`,
    };
  }

  const requiresApproval =
    manifestEntry.riskClass === "CONSEQUENTIAL" ||
    manifestEntry.requiresApprovalToken === true;

  if (requiresApproval && !manifestEntry.previewTool) {
    return {
      allowed: false,
      requiresApproval: false,
      reason: `Denied by default: consequential tool '${manifestEntry.name}' has no declared previewTool.`,
    };
  }

  return {
    allowed: true,
    riskClass: manifestEntry.riskClass,
    requiresApproval,
    reason: requiresApproval
      ? `Tool '${manifestEntry.name}' is classified as CONSEQUENTIAL and requires exact-action approval.`
      : `Tool '${manifestEntry.name}' is classified as ${manifestEntry.riskClass}.`,
  };
}
