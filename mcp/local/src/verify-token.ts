/**
 * owner: M4 (D Venkata Abhishek)
 * purpose: Independent server-side HMAC-SHA256 approval token verifier for shell_run_restricted.
 * public interface: verifyShellApprovalToken(token, commandId, args, cwd).
 * consumed by: mcp/local/src/tools/shell-run.ts (M4).
 * TODO: Recompute canonical argsHash and verify HMAC signature + expiry.
 */
