/**
 * owner: M4 (D Venkata Abhishek)
 * purpose: shell_describe_command READ preview tool returning purpose, resolved cwd, impact, and reversibility for an allowlisted commandId.
 * public interface: shellDescribeCommand(args).
 * consumed by: mcp/local/src/server.ts (M4), M1 approval preview builder.
 * TODO: Validate commandId + args against command-allowlist.json and return preview metadata.
 */
