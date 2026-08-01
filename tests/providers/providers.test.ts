import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EMBEDDING_DIMENSIONS } from '../../src/config.js';
import {
  BedrockProvider,
  GroqProvider,
  LocalEmbeddingProvider,
  MockEmbeddingProvider,
  MockLLMProvider,
  ProviderUnavailableError,
  TitanEmbeddingProvider,
  getEmbeddingProvider,
  getLLMProvider,
  resetProviders,
  setProviders,
} from '../../src/providers/index.js';

/**
 * Phase 6 gate: `npm test` passes with PROVIDER=mock, and the real-provider
 * integration tests are SKIPPED — never failed — when credentials are absent.
 *
 * The distinction matters. A test that fails without an AWS account cannot
 * tell you whether the code is broken or the machine is unconfigured, so the
 * suite stops being a signal. `it.skipIf` keeps the difference visible in the
 * output.
 */

const hasAwsCredentials = Boolean(
  process.env.AWS_ACCESS_KEY_ID ?? process.env.AWS_PROFILE ?? process.env.AWS_SESSION_TOKEN,
);
const hasGroqKey = Boolean(process.env.GROQ_API_KEY);

describe('provider selection', () => {
  const savedProvider = process.env.PROVIDER;
  const savedEmbedding = process.env.EMBEDDING_PROVIDER;

  beforeEach(() => {
    resetProviders();
  });

  afterEach(() => {
    restore('PROVIDER', savedProvider);
    restore('EMBEDDING_PROVIDER', savedEmbedding);
    resetProviders();
  });

  it('defaults to the mock on both interfaces', () => {
    delete process.env.PROVIDER;
    delete process.env.EMBEDDING_PROVIDER;
    expect(getLLMProvider().name).toBe('mock');
    expect(getEmbeddingProvider().name).toBe('mock');
  });

  it('selects a real provider by env var alone, with no code change', () => {
    process.env.PROVIDER = 'bedrock';
    expect(getLLMProvider()).toBeInstanceOf(BedrockProvider);
  });

  it('constructs Bedrock without credentials present', () => {
    // The AWS SDK resolves credentials when a request is made, not when the
    // client is built, and BedrockProvider does not second-guess it. If this
    // threw, merely selecting the provider in a credential-free CI job would
    // fail before any request was attempted.
    process.env.PROVIDER = 'bedrock';
    expect(() => getLLMProvider()).not.toThrow();
  });

  it('Groq fails fast on a missing key rather than at the first alert', () => {
    // Deliberately unlike Bedrock. Groq has one credential and no resolver
    // chain, so an absent GROQ_API_KEY is a configuration error that is known
    // at startup — and the operator should learn about it then, not halfway
    // through an investigation. `PROVIDER=groq` with no key is a mistake, and
    // silently substituting the mock would hide it.
    process.env.PROVIDER = 'groq';
    if (hasGroqKey) {
      expect(getLLMProvider()).toBeInstanceOf(GroqProvider);
      return;
    }
    expect(() => getLLMProvider()).toThrow(/GROQ_API_KEY is not set/);
  });

  it('rejects an unrecognised provider name instead of falling back silently', () => {
    process.env.PROVIDER = 'gpt4';
    expect(() => getLLMProvider()).toThrow(/not recognised/);
    resetProviders();
    process.env.EMBEDDING_PROVIDER = 'openai';
    expect(() => getEmbeddingProvider()).toThrow(/not recognised/);
  });

  it('memoises, so a provider is constructed once per process', () => {
    process.env.PROVIDER = 'mock';
    expect(getLLMProvider()).toBe(getLLMProvider());
  });

  it('honours an injected provider, which is how the agent tests run', () => {
    const llm = new MockLLMProvider();
    setProviders({ llm });
    expect(getLLMProvider()).toBe(llm);
  });
});

describe('embedding dimension agreement', () => {
  it('Titan negotiates the dimension from the single config constant', () => {
    expect(new TitanEmbeddingProvider().dimensions).toBe(EMBEDDING_DIMENSIONS);
  });

  it('the mock matches the schema width', () => {
    expect(new MockEmbeddingProvider(EMBEDDING_DIMENSIONS).dimensions).toBe(
      EMBEDDING_DIMENSIONS,
    );
  });

  it('LocalEmbeddingProvider refuses to run against a mismatched schema', () => {
    // MiniLM is 384. Constructing it while the schema is built for 1024 is a
    // guaranteed insert failure hundreds of thousands of rows later, so it is
    // caught at construction with the fix in the message.
    if (EMBEDDING_DIMENSIONS === 384) {
      expect(new LocalEmbeddingProvider().dimensions).toBe(384);
      return;
    }
    expect(() => new LocalEmbeddingProvider()).toThrow(/EMBEDDING_DIMENSIONS=384/);
  });
});

describe('degradation contract', () => {
  it('ProviderUnavailableError distinguishes retryable from terminal', () => {
    // The README's degradation path depends on this: a throttle means queue
    // the alert for a human and retry, a malformed request means stop.
    const throttled = new ProviderUnavailableError('throttled', true);
    const malformed = new ProviderUnavailableError('bad request', false);
    expect(throttled.retryable).toBe(true);
    expect(malformed.retryable).toBe(false);
    expect(throttled).toBeInstanceOf(Error);
    expect(throttled.name).toBe('ProviderUnavailableError');
  });

  it('preserves the underlying cause for the audit trail', () => {
    const cause = new Error('ThrottlingException');
    expect(new ProviderUnavailableError('wrapped', true, cause).cause).toBe(cause);
  });

  it('the local provider reports the missing optional dependency by name', async () => {
    if (EMBEDDING_DIMENSIONS !== 384) return; // covered by the constructor test
    await expect(new LocalEmbeddingProvider().embed(['test'])).rejects.toThrow(
      /@xenova\/transformers/,
    );
  });

  it('embedding an empty batch is a no-op, not a provider call', async () => {
    // The variant ingest calls embed() per chunk; an empty final chunk must
    // not become a billed request.
    await expect(new TitanEmbeddingProvider().embed([])).resolves.toEqual([]);
    await expect(new MockEmbeddingProvider(EMBEDDING_DIMENSIONS).embed([])).resolves.toEqual(
      [],
    );
  });
});

describe.skipIf(!hasAwsCredentials)('Bedrock (integration — needs AWS credentials)', () => {
  it('embeds text at the configured dimension', async () => {
    const [vector] = await new TitanEmbeddingProvider().embed(['Usifoh Joshua']);
    expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
  }, 30_000);

  it('completes a turn through ConverseCommand', async () => {
    const response = await new BedrockProvider().generate([
      { role: 'user', content: 'Reply with the single word: ready' },
    ]);
    expect(response.content.toLowerCase()).toContain('ready');
  }, 60_000);
});

describe.skipIf(!hasGroqKey)('Groq (integration — needs GROQ_API_KEY)', () => {
  it('completes a turn', async () => {
    const response = await new GroqProvider().generate([
      { role: 'user', content: 'Reply with the single word: ready' },
    ]);
    expect(response.content.toLowerCase()).toContain('ready');
  }, 60_000);
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
