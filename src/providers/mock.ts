import { EMBEDDING_DIMENSIONS } from '../config.js';
import { normalizeName } from '../normalize.js';
import type {
  EmbeddingProvider,
  LLMProvider,
  LLMResponse,
  Message,
  ToolDef,
  ToolUse,
} from './types.js';

/**
 * Deterministic character-trigram hashing embedder.
 *
 * This is not a stub that returns noise. It is a real (if unsophisticated)
 * lexical embedding: strings that share character sequences land near each
 * other in L2 space, so vector search over it behaves qualitatively like it
 * does over Titan. That matters because the entire test suite — including the
 * eval harness that produces the headline recall number — runs against it.
 * A random-vector mock would make every one of those tests meaningless.
 *
 * It is also genuinely useful in production as a zero-dependency, zero-cost
 * fallback when neither Bedrock nor a local model is reachable.
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'mock';
  readonly dimensions: number;

  constructor(dimensions: number = EMBEDDING_DIMENSIONS) {
    this.dimensions = dimensions;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.embedOne(text));
  }

  embedOne(text: string): number[] {
    const vec = new Array<number>(this.dimensions).fill(0);
    const normalized = normalizeName(text);
    if (normalized.length === 0) {
      // A zero vector has no direction; nearest-neighbour ordering against it
      // is arbitrary. Give empty input a stable, distinct point instead.
      vec[0] = 1;
      return vec;
    }

    // Pad so that leading and trailing characters produce trigrams too, and
    // so single-token names still yield signal.
    const padded = `  ${normalized}  `;
    for (let i = 0; i + 3 <= padded.length; i++) {
      const gram = padded.slice(i, i + 3);
      const bucket = fnv1a(gram) % this.dimensions;
      // Signed contribution keeps unrelated grams from all pushing the same
      // direction, which would make every vector similar to every other.
      const sign = (fnv1a(`${gram}#sign`) & 1) === 0 ? 1 : -1;
      vec[bucket] = vec[bucket]! + sign;
    }

    // Whole-token grams as well, so word-level identity survives reordering:
    // "JOSHUA USIFOH" and "USIFOH JOSHUA" share both token features.
    for (const token of normalized.split(' ')) {
      const bucket = fnv1a(`tok:${token}`) % this.dimensions;
      vec[bucket] = vec[bucket]! + 2;
    }

    return l2Normalize(vec);
  }
}

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply, kept in unsigned range.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function l2Normalize(vec: number[]): number[] {
  let sum = 0;
  for (const v of vec) sum += v * v;
  const norm = Math.sqrt(sum);
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

/**
 * Scripted LLM. Each call pops the next canned response, so an agent test
 * drives a fully deterministic tool-call sequence.
 */
export interface MockScript {
  responses: LLMResponse[];
}

export class MockLLMProvider implements LLMProvider {
  readonly name = 'mock';
  private queue: LLMResponse[];
  readonly calls: { messages: Message[]; tools: ToolDef[] | undefined }[] = [];

  constructor(script: MockScript = { responses: [] }) {
    this.queue = [...script.responses];
  }

  /** Queue further responses mid-test. */
  push(...responses: LLMResponse[]): void {
    this.queue.push(...responses);
  }

  async generate(messages: Message[], tools?: ToolDef[]): Promise<LLMResponse> {
    this.calls.push({ messages, tools });
    const next = this.queue.shift();
    if (next) return next;
    // Running dry means the agent looped further than the test scripted. End
    // the turn rather than hanging, so the assertion failure is the useful one.
    return {
      content: 'No further steps.',
      toolUses: [],
      stopReason: 'end_turn',
    };
  }
}

/** Convenience builders for scripting agent tests. */
export function toolUseResponse(
  name: string,
  input: Record<string, unknown>,
  id = `tu_${name}`,
): LLMResponse {
  const toolUse: ToolUse = { id, name, input };
  return { content: '', toolUses: [toolUse], stopReason: 'tool_use' };
}

export function textResponse(content: string): LLMResponse {
  return { content, toolUses: [], stopReason: 'end_turn' };
}
