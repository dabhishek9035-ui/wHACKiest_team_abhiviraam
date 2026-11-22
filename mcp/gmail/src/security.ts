import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value as object).sort().map(k => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
};
export const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
export const draftContentHash = (to: string, subject: string, body: string): string => sha256(`${to}|${subject}|${body}`);
export interface ApprovalPayload { approvalId: string; tool: string; argsHash: string; expiresAt: number }
export function signApproval(payload: ApprovalPayload, secret = process.env.PENGU_APPROVAL_SECRET): string {
  if (!secret || secret.length < 32) throw new Error('PENGU_APPROVAL_SECRET must contain at least 32 characters');
  return createHmac('sha256', secret).update(canonicalJson(payload)).digest('hex');
}
export function verifyApproval(payload: ApprovalPayload, signature: string, secret = process.env.PENGU_APPROVAL_SECRET): boolean {
  if (!secret || secret.length < 32 || !/^[a-f0-9]{64}$/i.test(signature) || payload.expiresAt <= Date.now()) return false;
  const expected = Buffer.from(signApproval(payload, secret), 'hex');
  const received = Buffer.from(signature, 'hex');
  return expected.length === received.length && timingSafeEqual(expected, received);
}
