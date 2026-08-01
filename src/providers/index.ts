import { EMBEDDING_DIMENSIONS } from '../config.js';
import { MockEmbeddingProvider, MockLLMProvider } from './mock.js';
import type { EmbeddingProvider, LLMProvider } from './types.js';

export * from './types.js';
export {
  MockEmbeddingProvider,
  MockLLMProvider,
  textResponse,
  toolUseResponse,
} from './mock.js';

/**
 * Provider selection, by env var only.
 *
 * Nothing outside src/providers/ imports an SDK, so "Bedrock model access is
 * still pending" or "Bedrock is throttled, fall back to Groq" is a one-line
 * env change rather than a code change. Real providers are wired in Phase 6;
 * until then every path resolves to the deterministic mock, which is a genuine
 * trigram embedder rather than a noise generator.
 */
export type EmbeddingProviderName = 'mock' | 'titan' | 'local';
export type LLMProviderName = 'mock' | 'bedrock' | 'groq';

let embeddingProvider: EmbeddingProvider | null = null;
let llmProvider: LLMProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (embeddingProvider) return embeddingProvider;
  const name = (process.env.EMBEDDING_PROVIDER ?? 'mock') as EmbeddingProviderName;

  switch (name) {
    case 'mock':
      embeddingProvider = new MockEmbeddingProvider(EMBEDDING_DIMENSIONS);
      break;
    default:
      throw new Error(
        `EMBEDDING_PROVIDER='${name}' is not wired up yet (arrives in phase 6). Use 'mock'.`,
      );
  }
  return embeddingProvider;
}

export function getLLMProvider(): LLMProvider {
  if (llmProvider) return llmProvider;
  const name = (process.env.PROVIDER ?? 'mock') as LLMProviderName;

  switch (name) {
    case 'mock':
      llmProvider = new MockLLMProvider();
      break;
    default:
      throw new Error(
        `PROVIDER='${name}' is not wired up yet (arrives in phase 6). Use 'mock'.`,
      );
  }
  return llmProvider;
}

/** Test seam: force a provider instance. */
export function setProviders(providers: {
  embedding?: EmbeddingProvider;
  llm?: LLMProvider;
}): void {
  if (providers.embedding) embeddingProvider = providers.embedding;
  if (providers.llm) llmProvider = providers.llm;
}

export function resetProviders(): void {
  embeddingProvider = null;
  llmProvider = null;
}
