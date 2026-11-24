/**
 * owner: M1 (Ronit Kapar)
 * purpose: Per-launch WebSocket authentication token generation and constant-time validation.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

/**
 * Uses PENGU_WS_TOKEN if supplied by the launcher (e.g. Tauri shell),
 * otherwise generates a fresh 32-byte cryptographically random per-launch token.
 */
export function resolveWsAuthToken(envToken?: string): string {
  if (envToken && envToken.trim().length >= 16) {
    return envToken.trim();
  }
  return randomBytes(32).toString("hex");
}

export function extractTokenFromRequest(req: IncomingMessage): string | null {
  const authHeader = req.headers["authorization"];
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }
  if (req.url) {
    try {
      const parsed = new URL(req.url, "http://127.0.0.1");
      const token = parsed.searchParams.get("token");
      if (token) return token.trim();
    } catch {
      return null;
    }
  }
  return null;
}

export function verifyWsAuthToken(
  provided: string | null,
  expected: string
): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
