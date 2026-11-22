// owner: M4 (D Venkata Abhishek, 1TD25CS079)
// purpose: approval-token primitives per contract 7.3 — canonicalJSON, argsHash,
//          HMAC-SHA256 signing/verification of {approvalId, tool, argsHash, expiresAt}.
//          The LOCAL SERVER is a second line of defence: it independently recomputes
//          the argsHash from the actual resolved action and refuses on ANY mismatch.
//          The token is injected by M1 into the server-side MCP invocation (_meta) and
//          is never exposed to the model or the desktop UI.
// public interface it must expose: canonicalJSON, sha256Hex, hmacSha256Hex,
//          signApprovalToken (test helper / gate parity), verifyApprovalToken,
//          ApprovalToken type.
// consumed by: server.ts (shell_run_restricted), tests; M3 gmail has its own twin.
// TODO: none (implemented).

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export interface ApprovalToken {
  approvalId: string;
  tool: string;
  argsHash: string;
  /** ISO-8601 string or epoch milliseconds. */
  expiresAt: string | number;
  mac: string;
}

/**
 * Deterministic JSON with recursively sorted object keys — the exact byte-level
 * form both the signer (M1 gate) and every verifying MCP server must agree on.
 */
export function canonicalJSON(value: unknown): string {
  return canonicalValue(value);
}

function canonicalValue(value: unknown): string {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalValue).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalValue(v)}`);
    return `{${entries.join(",")}}`;
  }
  return "null";
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** argsHash for an action = sha256(canonicalJSON(resolvedArgs)) (contract 7.3). */
export function argsHashOf(resolvedArgs: unknown): string {
  return sha256Hex(canonicalJSON(resolvedArgs));
}

export function hmacSha256Hex(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

/**
 * Signs an approval token. The POLICY GATE (M1) is the issuer in production; this
 * implementation lives here so tests can produce valid/invalid tokens and so the
 * canonical byte-level format is documented in code. It must never be reachable
 * from the model or UI.
 */
export function signApprovalToken(parts: {
  secret: string;
  approvalId: string;
  tool: string;
  argsHash: string;
  expiresAt: string | number;
}): ApprovalToken {
  const payload = canonicalJSON({
    approvalId: parts.approvalId,
    tool: parts.tool,
    argsHash: parts.argsHash,
    expiresAt: parts.expiresAt,
  });
  return {
    approvalId: parts.approvalId,
    tool: parts.tool,
    argsHash: parts.argsHash,
    expiresAt: parts.expiresAt,
    mac: hmacSha256Hex(parts.secret, payload),
  };
}

export type VerifyFailureReason =
  | "malformed"
  | "bad_signature"
  | "expired"
  | "tool_mismatch"
  | "hash_mismatch";

export type VerifyResult = { ok: true } | { ok: false; reason: VerifyFailureReason };

/**
 * Full server-side verification: shape, signature, expiry, tool binding and
 * argsHash binding. Refuses on any mismatch (fail closed).
 */
export function verifyApprovalToken(opts: {
  token: unknown;
  expectedTool: string;
  expectedArgsHash: string;
  secret: string;
  nowMs?: number;
}): VerifyResult {
  const token = opts.token as Partial<ApprovalToken> | null | undefined;
  if (
    !token ||
    typeof token !== "object" ||
    typeof token.approvalId !== "string" ||
    typeof token.tool !== "string" ||
    typeof token.argsHash !== "string" ||
    (typeof token.expiresAt !== "string" && typeof token.expiresAt !== "number") ||
    typeof token.mac !== "string"
  ) {
    return { ok: false, reason: "malformed" };
  }
  const expiresMs =
    typeof token.expiresAt === "number" ? token.expiresAt : Date.parse(token.expiresAt);
  if (!Number.isFinite(expiresMs)) return { ok: false, reason: "malformed" };
  const nowMs = opts.nowMs ?? Date.now();
  if (expiresMs <= nowMs) return { ok: false, reason: "expired" };
  if (token.tool !== opts.expectedTool) return { ok: false, reason: "tool_mismatch" };

  const payload = canonicalJSON({
    approvalId: token.approvalId,
    tool: token.tool,
    argsHash: token.argsHash,
    expiresAt: token.expiresAt,
  });
  const expectedMac = hmacSha256Hex(opts.secret, payload);
  if (!constantTimeEqualHex(expectedMac, token.mac)) return { ok: false, reason: "bad_signature" };

  // Signature is valid; the token still covers a different action than requested.
  if (token.argsHash !== opts.expectedArgsHash) return { ok: false, reason: "hash_mismatch" };
  return { ok: true };
}
