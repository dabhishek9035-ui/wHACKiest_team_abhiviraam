# Pengu Architecture & Verification Decisions (`docs/DECISIONS.md`)

- **Owner:** M1 — Ronit Kapar (`1BY25CS253`)
- **Last updated:** 2026-11-23

---

## ADR-01: Configured GLM Model & Sarvam Token Factory API Verification

### Official Documentation Verification (Verified 2026-11-23)

Per official Sarvam AI documentation ([Chat Completion API](https://docs.sarvam.ai/api/token-factory/chat-completions), [Chat Completion V2 Reference](https://docs.sarvam.ai/api-reference/chat/chat-completions-v2), [GLM 5.3 Model Page](https://www.sarvam.ai/token-factory/models/glm-5-3)):

| Parameter | Verified Official Value | Notes |
|---|---|---|
| **Endpoint** | `POST https://api.sarvam.ai/v2/chat/completions` | OpenAI-compatible V2 Chat Completions API. |
| **Model ID** | `glm5.3` (case-sensitive) | Unknown model IDs return `404 not_found_error`. Fixed in agent config; **no UI model picker**. |
| **Authentication** | `api-subscription-key: <SARVAM_API_KEY>` | Primary Sarvam header (`Authorization: Bearer <key>` is also accepted for OpenAI-compatible clients). Auth failures return HTTP `403` (`invalid_api_key_error`), not `401`. |
| **Context Window** | `1,048,576` tokens | Covers prompt, `reasoning_content`, and completion output. Max request size: `10,485,760` bytes. |
| **Tool Calling** | Native OpenAI-compatible `tools` & `tool_calls` | Returns `finish_reason: "tool_calls"` with `choices[0].message.tool_calls` (`function.name` + stringified JSON `function.arguments`). Tool results appended as `{ role: "tool", tool_call_id, content }`. |
| **Parallel Tool Calls** | `parallel_tool_calls: false` | Supported on V2 to limit each turn to one tool call, enabling deterministic step-by-step policy gating. |
| **Reasoning & Token Budget** | `reasoning_effort: "low" \| "high" \| "max"` | Default on `glm5.3` is `"max"`. Reasoning trace is returned in `choices[0].message.reasoning_content` and counts toward `max_tokens` (V2 default `2048`). Pengu sets `reasoning_effort: "low"` and `max_tokens: 4096` for responsive tool orchestration and **strips `reasoning_content` before emitting any UI event** (honest-claims rule: never expose private chain-of-thought). |
| **Completion Count** | `n: 1` (or omitted) | Any `n > 1` returns `400 invalid_request_error`. |

### Live Smoke Test Status & Strict-JSON Fallback Agreement

- **Live smoke test command:** `pnpm --filter @pengu/agent smoke:glm` (runs `services/agent/src/llm/glm-client.ts` live smoke harness against `POST https://api.sarvam.ai/v2/chat/completions` with `SARVAM_API_KEY` from `.env`).
- **Current status:** Official endpoint, model ID (`glm5.3`), auth header, `reasoning_content` behavior, and tool-calling schema are verified from Sarvam's official V2 documentation above. Because the initial build environment has outbound network disabled, **Ronit (M1) must execute `pnpm --filter @pengu/agent smoke:glm` locally with `SARVAM_API_KEY` set and paste the redacted HTTP 200 + tool-call transcript below before closing Gate G3.**
- **Strict-JSON fallback:** `services/agent/src/llm/glm-client.ts` implements native OpenAI-compatible `tools` calling as primary, plus a strict-JSON envelope fallback (`{"action":"tool_call"|"final", ...}`) validated against the MCP registry schema if a model response emits inline JSON instead of `message.tool_calls`. Pengu **never silently falls back to a different model**.
- **Test-only replay mode:** `GlmClient` accepts a deterministic `replayScript` option strictly for unit/handshake tests (`policy.test.ts`, `runtime.test.ts`). Production/demo startup always requires the verified `glm5.3` configuration.

---

## ADR-02: Sarvam Speech Models Reference (For M3 Alignment)

Verified from official Sarvam documentation ([Saaras](https://docs.sarvam.ai/api/api-guides-tutorials/models/saaras), [Bulbul](https://docs.sarvam.ai/api/api-guides-tutorials/models/bulbul), [Models Overview](https://docs.sarvam.ai/api/getting-started/models)):

- **STT:** `saaras:v4` supports **23 languages** (22 Indian languages + Global/Indian English).
- **TTS:** `bulbul:v3` and `bulbul:v4-flash` support **11 languages** (10 Indian languages + English).
- **Decision:** M3 maintains separate `STT_LANGUAGES` and `TTS_LANGUAGES` tables in `services/agent/src/voice/languages.ts`. Unsupported TTS languages return `{ unsupported: true, reason }` and emit `tts.unsupported` to the UI.

---

## ADR-03: Single Risk-Based Policy Model & Server-Side Token Injection

- Pengu ships **one** risk-based policy model (no Manual/Smart/Full modes).
- `READ` and `ROUTINE` tools inside granted setup scopes execute without per-task approval prompts.
- `CONSEQUENTIAL` tools (`gmail_send_draft`, `shell_run_restricted`) always pause for exact-action approval using their manifest-declared `previewTool` (`gmail_get_draft`, `shell_describe_command`).
- Unknown tools, missing manifests, failed scope checks, and unknown/unsafe shell command IDs are **hard-denied** and cannot be overridden by user approval.
- The HMAC-SHA256 approval token is injected by `services/agent/src/mcp/client.ts` under the reserved field `__pengu_approval` and is stripped from all LLM-visible tool schemas and UI WebSocket payloads.

---

## ADR-04: Local WebSocket Transport & Zero-Dependency Core Compatibility

- `services/agent/src/server/ws.ts` listens exclusively on loopback `127.0.0.1:7777` (never `0.0.0.0`) and authenticates upgrades using constant-time comparison (`crypto.timingSafeEqual`) against a per-launch token.
- `services/agent/src/mcp/client.ts` implements newline-delimited JSON-RPC 2.0 over stdio compatible with `@modelcontextprotocol/sdk` stdio servers (`initialize`, `tools/list`, `tools/call`), ensuring clean interoperability with M3 (`mcp/gmail`) and M4 (`mcp/local`) servers.
