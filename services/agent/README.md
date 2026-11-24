# @pengu/agent

- **Owner:** M1 (Ronit Kapar); src/voice owned by M3 (Maneesha G)
- **Purpose:** Node.js + TypeScript sidecar hosting the GLM runtime loop, MCP client/registry, risk-based policy gate, HMAC approval tokens, resume flow, and authenticated local WebSocket server.
- **Done criteria:** Real MCP tools listed, policy gate enforced before every call, approval preview/token/invalidation verified, hostile-content test green, resume verifies before repeating.
