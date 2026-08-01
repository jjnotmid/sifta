import {
  BedrockRuntimeClient,
  ConverseCommand,
  InvokeModelCommand,
  type ContentBlock,
  type ConversationRole,
  type Message as BedrockMessage,
  type Tool,
  type ToolInputSchema,
} from '@aws-sdk/client-bedrock-runtime';
import { EMBEDDING_DIMENSIONS } from '../config.js';
import {
  ProviderUnavailableError,
  type EmbeddingProvider,
  type LLMProvider,
  type LLMResponse,
  type Message,
  type StopReason,
  type ToolDef,
  type ToolUse,
} from './types.js';

/**
 * Bedrock types arbitrary JSON as `DocumentType`, a recursive union the SDK
 * does not export directly. Tool inputs and results are exactly that, so these
 * aliases recover the right type from the shapes that ARE exported, rather
 * than reaching for `any`.
 */
type ToolUseInput = NonNullable<ContentBlock.ToolUseMember['toolUse']>['input'];
type ToolResultJson = NonNullable<
  NonNullable<ContentBlock.ToolResultMember['toolResult']>['content']
>[number];

/**
 * Amazon Bedrock, via ConverseCommand.
 *
 * This is the only file that knows Bedrock exists. Everything upstream depends
 * on LLMProvider, which is what makes "model access is still pending" or
 * "Bedrock is throttling us" an env var rather than a refactor.
 */

const THROTTLING_ERRORS = new Set([
  'ThrottlingException',
  'TooManyRequestsException',
  'ServiceUnavailableException',
  'ModelTimeoutException',
  'InternalServerException',
]);

function toProviderError(err: unknown): ProviderUnavailableError {
  const name = (err as { name?: string })?.name ?? 'UnknownError';
  const message = err instanceof Error ? err.message : String(err);
  // Retryable vs not matters: the degradation path queues alerts for humans on
  // a throttle, but a malformed request should fail loudly instead of looping.
  return new ProviderUnavailableError(
    `Bedrock ${name}: ${message}`,
    THROTTLING_ERRORS.has(name),
    err,
  );
}

export interface BedrockOptions {
  region?: string;
  modelId?: string;
  maxTokens?: number;
  temperature?: number;
}

export class BedrockProvider implements LLMProvider {
  readonly name = 'bedrock';
  private readonly client: BedrockRuntimeClient;
  private readonly modelId: string;
  private readonly maxTokens: number;
  private readonly temperature: number;

  constructor(options: BedrockOptions = {}) {
    const region = options.region ?? process.env.AWS_REGION ?? 'us-east-1';
    this.client = new BedrockRuntimeClient({ region });
    this.modelId =
      options.modelId ??
      process.env.BEDROCK_MODEL_ID ??
      'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
    this.maxTokens = options.maxTokens ?? 2048;
    this.temperature = options.temperature ?? 0;
  }

  async generate(messages: Message[], tools?: ToolDef[]): Promise<LLMResponse> {
    // Converse takes the system prompt as a separate parameter, not as a turn.
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => ({ text: m.content }));

    const conversation: BedrockMessage[] = messages
      .filter((m) => m.role !== 'system')
      .map(
        (message): BedrockMessage => ({
          role: (message.role === 'assistant' ? 'assistant' : 'user') as ConversationRole,
          content: toContentBlocks(message),
        }),
      )
      // Bedrock rejects turns with no content blocks.
      .filter((m) => (m.content?.length ?? 0) > 0);

    const toolConfig: { tools: Tool[] } | undefined =
      tools && tools.length > 0
        ? {
            tools: tools.map(
              (tool): Tool => ({
                toolSpec: {
                  name: tool.name,
                  description: tool.description,
                  inputSchema: { json: tool.inputSchema as ToolUseInput } as ToolInputSchema,
                },
              }),
            ),
          }
        : undefined;

    try {
      const response = await this.client.send(
        new ConverseCommand({
          modelId: this.modelId,
          messages: conversation,
          ...(system.length > 0 ? { system } : {}),
          ...(toolConfig ? { toolConfig } : {}),
          inferenceConfig: {
            maxTokens: this.maxTokens,
            temperature: this.temperature,
          },
        }),
      );

      const blocks = response.output?.message?.content ?? [];
      const text = blocks
        .map((block) => ('text' in block ? block.text : undefined))
        .filter((t): t is string => typeof t === 'string')
        .join('\n');

      const toolUses: ToolUse[] = blocks
        .filter((block): block is ContentBlock.ToolUseMember => 'toolUse' in block)
        .map((block) => ({
          id: block.toolUse?.toolUseId ?? '',
          name: block.toolUse?.name ?? '',
          input: (block.toolUse?.input as Record<string, unknown>) ?? {},
        }));

      return {
        content: text,
        toolUses,
        stopReason: mapStopReason(response.stopReason),
        usage: {
          inputTokens: response.usage?.inputTokens ?? 0,
          outputTokens: response.usage?.outputTokens ?? 0,
        },
      };
    } catch (err) {
      throw toProviderError(err);
    }
  }
}

function toContentBlocks(message: Message): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  if (message.content.trim().length > 0) {
    blocks.push({ text: message.content });
  }
  for (const use of message.toolUses ?? []) {
    blocks.push({
      toolUse: { toolUseId: use.id, name: use.name, input: use.input as ToolUseInput },
    });
  }
  for (const result of message.toolResults ?? []) {
    blocks.push({
      toolResult: {
        toolUseId: result.toolUseId,
        content: [{ json: result.content as ToolUseInput } as ToolResultJson],
        status: result.isError ? 'error' : 'success',
      },
    });
  }
  return blocks;
}

function mapStopReason(reason: string | undefined): StopReason {
  switch (reason) {
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    case 'end_turn':
    case 'stop_sequence':
      return 'end_turn';
    default:
      return 'end_turn';
  }
}

/**
 * Titan Text Embeddings V2.
 *
 * `dimensions` is negotiated with the model rather than assumed: Titan V2
 * supports 1024, 512 and 256, and EMBEDDING_DIMENSIONS is the single constant
 * that decides which the schema is built for.
 */
export class TitanEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'titan';
  readonly dimensions: number;
  private readonly client: BedrockRuntimeClient;
  private readonly modelId: string;

  constructor(options: { region?: string; modelId?: string; dimensions?: number } = {}) {
    const region = options.region ?? process.env.AWS_REGION ?? 'us-east-1';
    this.client = new BedrockRuntimeClient({ region });
    this.modelId =
      options.modelId ?? process.env.BEDROCK_EMBEDDING_MODEL_ID ?? 'amazon.titan-embed-text-v2:0';
    this.dimensions = options.dimensions ?? EMBEDDING_DIMENSIONS;
  }

  async embed(texts: string[]): Promise<number[][]> {
    // Titan embeds one input per call. Kept sequential deliberately: the
    // variant ingest embeds hundreds of thousands of names and a burst of
    // parallel calls trips the account-level rate limit almost immediately.
    const out: number[][] = [];
    for (const text of texts) {
      out.push(await this.embedOne(text));
    }
    return out;
  }

  private async embedOne(text: string): Promise<number[]> {
    try {
      const response = await this.client.send(
        new InvokeModelCommand({
          modelId: this.modelId,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            inputText: text,
            dimensions: this.dimensions,
            normalize: true,
          }),
        }),
      );
      const decoded = JSON.parse(new TextDecoder().decode(response.body)) as {
        embedding?: number[];
      };
      if (!decoded.embedding) {
        throw new Error('Titan response contained no embedding');
      }
      if (decoded.embedding.length !== this.dimensions) {
        throw new Error(
          `Titan returned ${decoded.embedding.length} dimensions, expected ${this.dimensions}`,
        );
      }
      return decoded.embedding;
    } catch (err) {
      throw toProviderError(err);
    }
  }
}
