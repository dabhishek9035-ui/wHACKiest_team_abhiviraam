/**
 * owner: M1 (Ronit Kapar)
 * purpose: Sarvam Token Factory /v2/chat/completions client locked to glm5.3 with native tool calling, strict-JSON fallback, and test-only replay mode.
 */

import type { ModelVisibleToolDefinition } from "../mcp/registry.js";
import type { ChatMessage } from "./prompts.js";

export const SARVAM_V2_ENDPOINT =
  "https://api.sarvam.ai/v2/chat/completions" as const;

/** Fixed configured GLM model ID per ADR-01 (no UI model picker). */
export const FIXED_GLM_MODEL = "glm5.3" as const;

export interface ProposedToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface GlmCompletionResult {
  /** Observable assistant text (private reasoning_content is ALWAYS stripped). */
  content: string;
  toolCalls: ProposedToolCall[];
  finishReason: string;
  usedFallbackJsonParser: boolean;
}

export interface GlmClient {
  complete(
    messages: ChatMessage[],
    tools: ModelVisibleToolDefinition[]
  ): Promise<GlmCompletionResult>;
}

export interface SarvamGlmClientOptions {
  apiKey: string;
  endpoint?: string;
  model?: string;
  reasoningEffort?: "low" | "high" | "max";
  maxTokens?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Strict-JSON fallback parser if the model emits a JSON tool envelope in message.content
 * instead of native OpenAI-compatible message.tool_calls (ADR-01).
 */
export function parseStrictJsonFallback(
  content: string
): ProposedToolCall[] | null {
  const trimmed = content.trim();
  const jsonMatch =
    trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] ?? trimmed;
  if (!jsonMatch.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(jsonMatch) as Record<string, unknown>;
    if (
      parsed.action === "tool_call" &&
      typeof parsed.tool === "string" &&
      typeof parsed.args === "object" &&
      parsed.args !== null &&
      !Array.isArray(parsed.args)
    ) {
      return [
        {
          id: `fallback_${Date.now()}`,
          name: parsed.tool,
          args: parsed.args as Record<string, unknown>,
        },
      ];
    }
  } catch {
    return null;
  }
  return null;
}

export class SarvamGlmClient implements GlmClient {
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly model: string;
  private readonly reasoningEffort: "low" | "high" | "max";
  private readonly maxTokens: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SarvamGlmClientOptions) {
    if (!options.apiKey) {
      throw new Error("SARVAM_API_KEY is required for SarvamGlmClient.");
    }
    this.apiKey = options.apiKey;
    this.endpoint = options.endpoint ?? SARVAM_V2_ENDPOINT;
    this.model = options.model ?? FIXED_GLM_MODEL;
    this.reasoningEffort = options.reasoningEffort ?? "low";
    this.maxTokens = options.maxTokens ?? 4096;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async complete(
    messages: ChatMessage[],
    tools: ModelVisibleToolDefinition[]
  ): Promise<GlmCompletionResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const body: Record<string, unknown> = {
        model: this.model,
        messages,
        n: 1,
        max_tokens: this.maxTokens,
        reasoning_effort: this.reasoningEffort,
        stream: false,
      };
      if (tools.length > 0) {
        body.tools = tools;
        body.tool_choice = "auto";
        // Deterministic single tool call per turn for clean policy gating (ADR-01).
        body.parallel_tool_calls = false;
      }

      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-subscription-key": this.apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(
          `Sarvam GLM V2 request failed (${response.status}): ${errText.slice(0, 300)}`
        );
      }

      const data = (await response.json()) as {
        choices?: Array<{
          finish_reason?: string;
          message?: {
            content?: string | null;
            reasoning_content?: string | null; // Intentionally ignored / stripped
            tool_calls?: Array<{
              id: string;
              type: "function";
              function: { name: string; arguments: string };
            }>;
          };
        }>;
      };

      const choice = data.choices?.[0];
      const msg = choice?.message;
      const content = typeof msg?.content === "string" ? msg.content : "";
      const finishReason = choice?.finish_reason ?? "stop";

      const nativeCalls: ProposedToolCall[] = [];
      if (Array.isArray(msg?.tool_calls)) {
        for (const tc of msg.tool_calls) {
          let parsedArgs: Record<string, unknown> = {};
          try {
            const raw = JSON.parse(tc.function.arguments || "{}");
            if (raw && typeof raw === "object" && !Array.isArray(raw)) {
              parsedArgs = raw as Record<string, unknown>;
            }
          } catch {
            parsedArgs = {};
          }
          nativeCalls.push({
            id: tc.id,
            name: tc.function.name,
            args: parsedArgs,
          });
        }
      }

      if (nativeCalls.length > 0) {
        return {
          content,
          toolCalls: nativeCalls,
          finishReason,
          usedFallbackJsonParser: false,
        };
      }

      const fallbackCalls = parseStrictJsonFallback(content);
      if (fallbackCalls) {
        return {
          content: "",
          toolCalls: fallbackCalls,
          finishReason: "tool_calls",
          usedFallbackJsonParser: true,
        };
      }

      return {
        content,
        toolCalls: [],
        finishReason,
        usedFallbackJsonParser: false,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * TEST-ONLY replay client for deterministic unit/handshake tests.
 * Never used for the live demo (Section 13 / M1 rules).
 */
export class ReplayGlmClient implements GlmClient {
  private readonly turns: GlmCompletionResult[];
  private cursor = 0;

  constructor(turns: GlmCompletionResult[]) {
    this.turns = turns;
  }

  async complete(): Promise<GlmCompletionResult> {
    const next = this.turns[this.cursor++];
    if (!next) {
      return {
        content: "Done.",
        toolCalls: [],
        finishReason: "stop",
        usedFallbackJsonParser: false,
      };
    }
    return next;
  }
}

export function createGlmClient(options: SarvamGlmClientOptions): GlmClient {
  return new SarvamGlmClient(options);
}

// CLI smoke test entrypoint: `pnpm --filter @pengu/agent smoke:glm`
if (process.argv.includes("--smoke")) {
  const apiKey = process.env.SARVAM_API_KEY ?? "";
  if (!apiKey) {
    console.error("Missing SARVAM_API_KEY in environment.");
    process.exit(1);
  }
  const client = createGlmClient({ apiKey });
  client
    .complete(
      [
        {
          role: "system",
          content: "Use the provided tool to list directory entries.",
        },
        { role: "user", content: "List the files in C:\\PenguWorkspace." },
      ],
      [
        {
          type: "function",
          function: {
            name: "fs_list_dir",
            description: "List directory entries inside an approved root.",
            parameters: {
              type: "object",
              properties: { path: { type: "string" } },
              required: ["path"],
            },
          },
        },
      ]
    )
    .then((res) => {
      console.log(
        JSON.stringify(
          {
            model: FIXED_GLM_MODEL,
            endpoint: SARVAM_V2_ENDPOINT,
            finishReason: res.finishReason,
            toolCalls: res.toolCalls,
            usedFallbackJsonParser: res.usedFallbackJsonParser,
          },
          null,
          2
        )
      );
    })
    .catch((err) => {
      console.error("GLM smoke test failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
