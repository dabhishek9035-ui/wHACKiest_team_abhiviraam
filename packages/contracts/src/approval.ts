/**
 * owner: M1 (Ronit Kapar)
 * purpose: Frozen approval preview, HMAC token payload, and reserved server-side auth field contracts (Section 7.1 & 7.3).
 */

export type ApprovalDecision = "approve" | "deny";

/**
 * Reserved authorization field injected server-side by M1's MCP client when invoking
 * a consequential tool after user approval. Must be stripped from model-visible
 * schemas and never sent to the LLM or desktop UI.
 */
export const RESERVED_APPROVAL_TOKEN_FIELD = "__pengu_approval" as const;

export interface ApprovalPreview {
  title: string;
  account?: string;
  recipient?: string;
  subject?: string;
  body?: string;
  command?: string;
  commandId?: string;
  args?: Record<string, unknown> | string[];
  cwd?: string;
  purpose?: string;
  impact: string;
  reversible: boolean;
}

export interface ApprovalTokenPayload {
  approvalId: string;
  tool: string;
  /** Lowercase SHA-256 hex of canonicalJSON(resolvedArgs). */
  argsHash: string;
  /** ISO-8601 UTC expiration timestamp. */
  expiresAt: string;
}

export interface SignedApprovalToken {
  payload: ApprovalTokenPayload;
  /** Lowercase HMAC-SHA256 hex over canonicalJSON(payload) using PENGU_APPROVAL_SECRET. */
  signature: string;
}

export interface ResolvedGmailSendArgs {
  draftId: string;
  /** sha256(`${to}|${subject}|${body}`) of the draft as currently stored. */
  contentHash: string;
}

export interface ResolvedShellRunArgs {
  commandId: string;
  args: Record<string, unknown> | string[];
  cwd: string;
}
