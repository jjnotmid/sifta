import Groq from 'groq-sdk';
import {
  ProviderUnavailableError,
  type LLMProvider,
  type LLMResponse,
  type Message,
  type StopReason,
  type ToolDef,
  type ToolUse,
} from './types.js';

/**
 * Groq — the fallback when Bedrock model access is pending or throttled.
 *
 * Exists because Bedrock model access approval is not instant and the build
 * could not afford to be blocked on it. Switching is `PROVIDER=groq`; no
 * calling code changes, because everything upstream only knows LLMProvider.
 */

interface GroqToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

interface GroqChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: GroqToolCall[];
  tool_call_id?: string;
}

export interface GroqOptions {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export class GroqProvider implements LLMProvider {
  readonly name = 'groq';
  private readonly client: Groq;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly temperature: number;

  constructor(options: GroqOptions = {}) {
    const apiKey = options.apiKey ?? process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error('GROQ_API_KEY is not set. Use PROVIDER=mock or supply a key.');
    }
    this.client = new Groq({ apiKey });
    this.model = options.model ?? process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile';
    this.maxTokens = options.maxTokens ?? 2048;
    this.temperature = options.temperature ?? 0;
  }

  async generate(messages: Message[], tools?: ToolDef[]): Promise<LLMResponse> {
    const payload: GroqChatMessage[] = [];

    for (const message of messages) {
      // Tool results are their own role in the OpenAI-style schema, one
      // message per result, rather than blocks on a user turn.
      if (message.toolResults && message.toolResults.length > 0) {
        for (const result of message.toolResults) {
          payload.push({
            role: 'tool',
            tool_call_id: result.toolUseId,
            content: JSON.stringify(result.content),
          });
        }
        continue;
      }

      if (message.role === 'assistant' && message.toolUses && message.toolUses.length > 0) {
        payload.push({
          role: 'assistant',
          content: message.content.length > 0 ? message.content : null,
          tool_calls: message.toolUses.map((use) => ({
            id: use.id,
            type: 'function',
            function: { name: use.name, arguments: JSON.stringify(use.input) },
          })),
        });
        continue;
      }

      payload.push({ role: message.role, content: message.content });
    }

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: payload as never,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        ...(tools && tools.length > 0
          ? {
              tools: tools.map((tool) => ({
                type: 'function' as const,
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.inputSchema,
                },
              })),
            }
          : {}),
      });

      const choice = response.choices[0];
      const calls = (choice?.message?.tool_calls ?? []) as GroqToolCall[];

      const toolUses: ToolUse[] = calls.map((call) => ({
        id: call.id,
        name: call.function.name,
        input: parseArguments(call.function.arguments),
      }));

      return {
        content: choice?.message?.content ?? '',
        toolUses,
        stopReason: mapFinishReason(choice?.finish_reason, toolUses.length > 0),
        usage: {
          inputTokens: response.usage?.prompt_tokens ?? 0,
          outputTokens: response.usage?.completion_tokens ?? 0,
        },
      };
    } catch (err) {
      const status = (err as { status?: number })?.status;
      const message = err instanceof Error ? err.message : String(err);
      // 429 and 5xx are worth retrying; a 400 means we built a bad request.
      const retryable = status === 429 || (status !== undefined && status >= 500);
      throw new ProviderUnavailableError(`Groq ${status ?? 'error'}: ${message}`, retryable, err);
    }
  }
}

/**
 * Tool arguments arrive as a JSON string. A model occasionally emits malformed
 * JSON; surface that as an empty input so the loop reports a tool error back to
 * the model rather than crashing the investigation.
 */
function parseArguments(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function mapFinishReason(reason: string | null | undefined, hasToolCalls: boolean): StopReason {
  if (hasToolCalls) return 'tool_use';
  switch (reason) {
    case 'length':
      return 'max_tokens';
    case 'tool_calls':
      return 'tool_use';
    default:
      return 'end_turn';
  }
}
