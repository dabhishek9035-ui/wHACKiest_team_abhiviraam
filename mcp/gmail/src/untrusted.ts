/**
 * owner: M3 (Maneesha G)
 * purpose: Wraps all external email bodies, headers, and attachment text as untrusted data.
 * public interface: wrapUntrustedEmailContent(content).
 * consumed by: mcp/gmail/src/tools/read-thread.ts & search.ts (M3).
 * TODO: Return { untrusted: true, content } for all external email payloads.
 */
