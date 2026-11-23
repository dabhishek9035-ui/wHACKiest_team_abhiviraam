/**
 * owner: M4 (D Venkata Abhishek)
 * purpose: shell_run_restricted CONSEQUENTIAL tool executing allowlisted PowerShell command IDs with validated args, fixed cwd, timeout, output cap, and HMAC verification.
 * public interface: shellRunRestricted(args, approvalToken).
 * consumed by: mcp/local/src/server.ts (M4).
 * TODO: Reject unknown commands/invalid args/invalid tokens; run without elevation.
 */
