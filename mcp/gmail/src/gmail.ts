import { google, gmail_v1 } from 'googleapis';
import { getOAuthClient } from './auth.js';
import { canonicalJson, draftContentHash, sha256, verifyApproval } from './security.js';

export interface DraftPreview { draftId: string; threadId?: string; to: string; subject: string; body: string; contentHash: string }
const decode = (s = '') => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
const encode = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
function header(headers: gmail_v1.Schema$MessagePartHeader[] = [], name: string): string {
  return headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
}
function addressFromHeader(value: string): string {
  const match = value.match(/<([^<>]+)>/);
  return (match?.[1] ?? value).trim();
}
function mimeBody(to: string, subject: string, body: string, inReplyTo?: string, references?: string): string {
  const lines = [`To: ${to}`, `Subject: ${subject.replace(/[\r\n]/g, ' ')}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64'];
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);
  return `${lines.join('\r\n')}\r\n\r\n${Buffer.from(body, 'utf8').toString('base64')}`;
}
async function api() {
  if (process.env.PENGU_GMAIL_STUB === '1') return undefined;
  const auth = await getOAuthClient();
  return google.gmail({ version: 'v1', auth });
}
function stubGuard() { if (process.env.PENGU_GMAIL_STUB === '1') throw new Error('This operation is unavailable in stub mode; connect a real Gmail account.'); }

export async function searchThreads(query: string, maxResults = 10) {
  if (!query.trim() || query.length > 500) throw new Error('query must contain 1–500 characters');
  const gmail = await api();
  if (!gmail) return { untrusted: true, content: { threads: [{ id: 'stub-thread-1', snippet: { untrusted: true, content: 'Explicit local stub fixture (not live Gmail)' } }] } };
  const result = await gmail.users.threads.list({ userId: 'me', q: query, maxResults: Math.min(Math.max(maxResults, 1), 25) });
  return { untrusted: true, content: { threads: (result.data.threads ?? []).map(t => ({ id: t.id, snippet: { untrusted: true, content: t.snippet ?? '' } })) } };
}
export async function readThread(threadId: string) {
  const gmail = await api();
  if (!gmail) return { untrusted: true, content: { id: 'stub-thread-1', messages: [{ body: 'Stub fixture only. This is not Gmail data.' }] } };
  const result = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' });
  const messages = (result.data.messages ?? []).map(m => {
    const headers = m.payload?.headers ?? [];
    const plainText: string[] = [];
    const collect = (part?: gmail_v1.Schema$MessagePart) => {
      if (!part) return;
      if (part.mimeType === 'text/plain' && part.body?.data) plainText.push(decode(part.body.data));
      for (const child of part.parts ?? []) collect(child);
    };
    collect(m.payload);
    return { id: m.id, from: header(headers, 'From'), to: header(headers, 'To'), subject: header(headers, 'Subject'), date: header(headers, 'Date'), body: { untrusted: true, content: plainText.join('\n') } };
  });
  return { untrusted: true, content: { id: result.data.id, messages } };
}
export async function createReplyDraft(threadId: string, body: string, toOverride?: string) {
  stubGuard();
  if (!body.trim() || body.length > 100_000) throw new Error('body must contain 1–100000 characters');
  const gmail = await api();
  if (!gmail) throw new Error('Gmail API unavailable');
  const thread = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' });
  const last = thread.data.messages?.at(-1);
  if (!last) throw new Error('Thread has no messages');
  const headers = last.payload?.headers ?? [];
  const threadSubject = header(headers, 'Subject');
  const originalSender = addressFromHeader(header(headers, 'Reply-To') || header(headers, 'From'));
  const to = toOverride?.trim() || originalSender;
  if (!to || /[\r\n]/.test(to)) throw new Error('Invalid recipient address');
  const messageId = header(headers, 'Message-ID');
  const references = header(headers, 'References');
  const subject = /^re:/i.test(threadSubject) ? threadSubject : `Re: ${threadSubject}`;
  const raw = encode(mimeBody(to, subject, body, messageId, [references, messageId].filter(Boolean).join(' ')));
  const created = await gmail.users.drafts.create({ userId: 'me', requestBody: { message: { threadId, raw } } });
  return { draftId: created.data.id, threadId: created.data.message?.threadId ?? threadId, to, subject };
}
export async function getDraft(draftId: string): Promise<DraftPreview> {
  const gmail = await api();
  if (!gmail) return { draftId, threadId: 'stub-thread-1', to: 'stub@example.invalid', subject: 'Explicit stub draft', body: 'Not a real draft', contentHash: sha256('stub@example.invalid|Explicit stub draft|Not a real draft') };
  const result = await gmail.users.drafts.get({ userId: 'me', id: draftId, format: 'full' });
  const message = result.data.message;
  if (!message) throw new Error('Draft has no message');
  const headers = message.payload?.headers ?? [];
  let body = '';
  const collect = (part?: gmail_v1.Schema$MessagePart) => {
    if (!part) return;
    if (part.mimeType === 'text/plain' && part.body?.data) body += decode(part.body.data);
    for (const child of part.parts ?? []) collect(child);
  };
  collect(message.payload);
  const to = header(headers, 'To');
  const subject = header(headers, 'Subject');
  return { draftId, threadId: message.threadId ?? undefined, to, subject, body, contentHash: draftContentHash(to, subject, body) };
}
export async function sendDraft(input: { draftId: string; contentHash: string; _authorization?: { approvalId: string; tool: string; argsHash: string; expiresAt: number; signature: string } }) {
  stubGuard();
  const auth = input._authorization;
  if (!auth || auth.tool !== 'gmail_send_draft' || auth.argsHash !== sha256(canonicalJson({ draftId: input.draftId, contentHash: input.contentHash })) || !verifyApproval({ approvalId: auth.approvalId, tool: auth.tool, argsHash: auth.argsHash, expiresAt: auth.expiresAt }, auth.signature)) {
    throw new Error('Denied: valid exact-action approval token required');
  }
  let current: DraftPreview;
  try { current = await getDraft(input.draftId); }
  catch (error) {
    // Gmail removes a draft after send. Verify before reporting or retrying a duplicate request.
    const state = await verifyDraftSent(input.draftId, input.contentHash);
    if (state.status === 'sent') return { sent: true, duplicateSafe: true, messageId: state.messageId };
    if (state.status === 'unknown') throw new Error('Send outcome is indeterminate; inspect Gmail Sent before any retry.');
    throw error;
  }
  if (current.contentHash !== input.contentHash) throw new Error('Denied: draft content changed after approval');
  const gmail = await api();
  if (!gmail) throw new Error('Gmail API unavailable');
  try {
    const sent = await gmail.users.drafts.send({ userId: 'me', requestBody: { id: input.draftId } });
    return { sent: true, messageId: sent.data.id, threadId: sent.data.threadId };
  } catch (error) {
    const state = await verifyDraftSent(input.draftId, input.contentHash);
    if (state.status === 'sent') return { sent: true, duplicateSafe: true, messageId: state.messageId };
    throw error;
  }
}
export async function verifyDraftSent(draftId: string, approvedContentHash: string): Promise<{ status: 'sent' | 'not_sent' | 'unknown'; messageId?: string }> {
  const gmail = await api();
  if (!gmail) return { status: 'unknown' };
  try {
    await gmail.users.drafts.get({ userId: 'me', id: draftId });
    return { status: 'not_sent' };
  } catch (e: any) {
    if (e?.code !== 404) return { status: 'unknown' };
  }
  try {
    const result = await gmail.users.messages.list({ userId: 'me', q: 'in:sent newer_than:30d', maxResults: 100 });
    for (const item of result.data.messages ?? []) {
      if (!item.id) continue;
      const m = await gmail.users.messages.get({ userId: 'me', id: item.id, format: 'full' });
      const h = m.data.payload?.headers ?? [];
      let body = '';
      const collect = (part?: gmail_v1.Schema$MessagePart) => { if (!part) return; if (part.mimeType === 'text/plain' && part.body?.data) body += decode(part.body.data); for (const child of part.parts ?? []) collect(child); };
      collect(m.data.payload);
      const to = header(h, 'To'), subject = header(h, 'Subject');
      if (draftContentHash(to, subject, body) === approvedContentHash) return { status: 'sent', messageId: item.id };
    }
    return { status: 'unknown' };
  } catch { return { status: 'unknown' }; }
}
