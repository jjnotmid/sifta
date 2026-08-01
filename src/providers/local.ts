import { EMBEDDING_DIMENSIONS } from '../config.js';
import { ProviderUnavailableError, type EmbeddingProvider } from './types.js';

/**
 * Local embeddings via Transformers.js — `all-MiniLM-L6-v2`, 384 dimensions.
 *
 * The offline path: no AWS account, no API key, no network after the first
 * model download. Useful for local development, for a self-hosted deployment
 * (which the PRD names as a way past the trust barrier with regulated buyers),
 * and as the last fallback if Bedrock access never arrives.
 *
 * `@xenova/transformers` is an OPTIONAL dependency. It pulls in ONNX runtime
 * and is a large download, so the build does not require it and the module is
 * imported dynamically through a non-literal specifier — that keeps TypeScript
 * from demanding the package be present to compile. If it is missing, the
 * error says exactly what to install.
 *
 * Note the dimension change: MiniLM is 384, Titan is 1024. Set
 * EMBEDDING_DIMENSIONS=384 and re-run `npm run migrate` — that constant is the
 * single place the schema's VECTOR(n) width comes from.
 */

const PACKAGE = '@xenova/transformers';
export const LOCAL_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const LOCAL_DIMENSIONS = 384;

type FeatureExtractor = (
  texts: string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

type TransformersModule = {
  pipeline: (task: string, model: string) => Promise<FeatureExtractor>;
  env: { allowLocalModels: boolean };
};

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'local';
  readonly dimensions: number;
  private readonly model: string;
  private extractor: FeatureExtractor | null = null;
  private loading: Promise<FeatureExtractor> | null = null;

  constructor(options: { model?: string; dimensions?: number } = {}) {
    this.model = options.model ?? LOCAL_MODEL;
    this.dimensions = options.dimensions ?? LOCAL_DIMENSIONS;

    if (this.dimensions !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `LocalEmbeddingProvider produces ${this.dimensions}-dimension vectors but ` +
          `EMBEDDING_DIMENSIONS is ${EMBEDDING_DIMENSIONS}. Set EMBEDDING_DIMENSIONS=${this.dimensions} ` +
          `and re-run 'npm run migrate' so the VECTOR(n) columns match.`,
      );
    }
  }

  /** Model load is deferred and shared, so concurrent callers load it once. */
  private async load(): Promise<FeatureExtractor> {
    if (this.extractor) return this.extractor;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      let transformers: TransformersModule;
      try {
        // Non-literal specifier on purpose: see the note at the top.
        const specifier = PACKAGE;
        transformers = (await import(specifier)) as TransformersModule;
      } catch (err) {
        throw new ProviderUnavailableError(
          `EMBEDDING_PROVIDER=local requires the optional dependency ${PACKAGE}. ` +
            `Install it with: npm install ${PACKAGE}`,
          false,
          err,
        );
      }
      const extractor = await transformers.pipeline('feature-extraction', this.model);
      this.extractor = extractor;
      return extractor;
    })();

    try {
      return await this.loading;
    } finally {
      this.loading = null;
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const extractor = await this.load();
    try {
      // Mean pooling + L2 normalisation, matching how the vector index is
      // queried: distances are only comparable if every vector is normalised.
      const output = await extractor(texts, { pooling: 'mean', normalize: true });
      const vectors = output.tolist();
      for (const vector of vectors) {
        if (vector.length !== this.dimensions) {
          throw new Error(
            `${this.model} returned ${vector.length} dimensions, expected ${this.dimensions}`,
          );
        }
      }
      return vectors;
    } catch (err) {
      if (err instanceof ProviderUnavailableError) throw err;
      throw new ProviderUnavailableError(
        `local embedding failed: ${err instanceof Error ? err.message : String(err)}`,
        false,
        err,
      );
    }
  }
}
