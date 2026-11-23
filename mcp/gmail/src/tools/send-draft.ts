/**
 * owner: M3 (Maneesha G)
 * purpose: gmail_send_draft CONSEQUENTIAL tool verifying HMAC approval token against live draft contentHash and sending duplicate-safely.
 * public interface: gmailSendDraft(args, approvalToken), verifyDraftSent(draftId).
 * consumed by: mcp/gmail/src/server.ts (M3), M1 resume flow verifier.
 * TODO: Re-fetch draft, verify token, send once per draftId, export sent-state verifier.
 */
