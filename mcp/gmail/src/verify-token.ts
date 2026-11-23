/**
 * owner: M3 (Maneesha G)
 * purpose: Independent server-side HMAC-SHA256 approval token verifier for gmail_send_draft.
 * public interface: verifySendApprovalToken(token, draftId, currentContentHash).
 * consumed by: mcp/gmail/src/tools/send-draft.ts (M3).
 * TODO: Recompute argsHash from live draft contentHash and verify HMAC + expiry.
 */
