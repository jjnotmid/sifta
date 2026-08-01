/**
 * The only place an LLM or embedding SDK may be imported is this directory.
 * Everything upstream depends on these two interfaces, which is what makes
 * "Bedrock is throttled, switch to Groq" an env var rather than a refactor.
 */

export type Role = 'user' | 'assistant' | 'system';

export interface ToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolUseId: string;
  content: unknown;
  isError?: boolean;
}

export interface Message {
  role: Role;
  /** Prose content. Empty string when the turn is purely tool calls/results. */
  content: string;
  /** Tool calls the assistant made on this turn. */
  toolUses?: ToolUse[];
  /** Tool results supplied back to the model on a user turn. */
  toolResults?: ToolResult[];
}

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema for the tool's input. */
  inputSchema: Record<string, unknown>;
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'error';

export interface LLMResponse {
  content: string;
  toolUses: ToolUse[];
  stopReason: StopReason;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface LLMProvider {
  readonly name: string;
  generate(messages: Message[], tools?: ToolDef[]): Promise<LLMResponse>;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * Raised when the underlying model is throttled or unavailable.
 *
 * The degradation path documented in the README depends on callers being able
 * to distinguish "the model is busy, queue this alert for a human" from "this
 * request was malformed". Retrying the second is pointless.
 */
export class ProviderUnavailableError extends Error {
  override readonly name = 'ProviderUnavailableError';
  constructor(
    message: string,
    readonly retryable: boolean = true,
    override readonly cause?: unknown,
  ) {
    super(message);
  }
}
