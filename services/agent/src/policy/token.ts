/**
 * owner: M1 (Ronit Kapar)
 * purpose: Deterministic canonicalJSON, SHA-256 argsHash/contentHash, and HMAC-SHA256 approval token sign/verify (Section 7.3).
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type {
  ApprovalTokenPayload,
  SignedApprovalToken,
} from "@pengu/contracts";

/**
 * Recursively serializes a value with lexicographically sorted object keys
 * and no insignificant whitespace. Undefined object properties are omitted.
 */
export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((item) => canonicalJSON(item === undefined ? null : item)).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  const entries = keys.map(
    (k) => `${JSON.stringify(k)}:${canonicalJSON(obj[k])}`
  );
  return "{" + entries.join(",") + "}";
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function computeArgsHash(resolvedArgs: Record<string, unknown>): string {
  return sha256Hex(canonicalJSON(resolvedArgs));
}

/**
 * Section 7.3 Gmail draft content hash: sha256(to|subject|body).
 */
export function computeDraftContentHash(
  to: string,
  subject: string,
  body: string
): string {
  return sha256Hex(`${to}|${subject}|${body}`);
}

export function signApprovalToken(
  payload: ApprovalTokenPayload,
  secret: string
): SignedApprovalToken {
  if (!secret || secret.trim().length < 16) {
    throw new Error(
      "PENGU_APPROVAL_SECRET must be configured with at least 16 characters."
    );
  }
  const signature = createHmac("sha256", secret)
    .update(canonicalJSON(payload), "utf8")
    .digest("hex");
  return { payload, signature };
}

export interface TokenVerificationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Verifies tool binding, exact resolved argsHash, expiry, and HMAC signature
 * using constant-time comparison. Shared algorithm with mcp/gmail and mcp/local.
 */
export function verifyApprovalToken(
  token: SignedApprovalToken | undefined | null,
  expectedTool: string,
  expectedResolvedArgs: Record<string, unknown>,
  secret: string,
  nowMs: number = Date.now()
): TokenVerificationResult {
  if (!token || !token.payload || typeof token.signature !== "string") {
    return { valid: false, reason: "Missing approval token." };
  }
  if (!secret) {
    return { valid: false, reason: "Approval secret is not configured." };
  }
  const { approvalId, tool, argsHash, expiresAt } = token.payload;
  if (!approvalId || !tool || !argsHash || !expiresAt) {
    return { valid: false, reason: "Incomplete approval token payload." };
  }
  if (tool !== expectedTool) {
    return {
      valid: false,
      reason: `Approval token tool mismatch: expected '${expectedTool}', got '${tool}'.`,
    };
  }
  const expiresMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresMs) || nowMs >= expiresMs) {
    return { valid: false, reason: "Approval token has expired." };
  }
  const expectedArgsHash = computeArgsHash(expectedResolvedArgs);
  if (argsHash !== expectedArgsHash) {
    return {
      valid: false,
      reason: "Approval token argsHash mismatch (target action changed after approval).",
    };
  }
  const expectedSig = createHmac("sha256", secret)
    .update(canonicalJSON(token.payload), "utf8")
    .digest("hex");
  const actualBuf = Buffer.from(token.signature, "utf8");
  const expectedBuf = Buffer.from(expectedSig, "utf8");
  if (
    actualBuf.length !== expectedBuf.length ||
    !timingSafeEqual(actualBuf, expectedBuf)
  ) {
    return { valid: false, reason: "Invalid approval token signature." };
  }
  return { valid: true };
}
