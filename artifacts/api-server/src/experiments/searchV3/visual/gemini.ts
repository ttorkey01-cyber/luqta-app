import { createHash } from "node:crypto";
import {
  GeminiEmbedding2Provider,
  type GeminiEmbedding2Counters,
} from "./geminiEmbedding2";
import type { VisualImage } from "./index";

export type GeminiEmbeddingProviderOptions = {
  /** Server-side Gemini API key; it is sent only in the x-goog-api-key header. */
  apiKey: string;
  /** Requested vector size (128–3072). Defaults to 768. */
  outputDimension?: number;
  maxImageBytes?: number;
  timeoutMs?: number;
  cacheMaxEntries?: number;
  cacheTtlMs?: number;
  /** Injectable transport for tests. */
  fetch?: typeof fetch;
};

export type GeminiEmbeddingProviderMetrics = Readonly<{
  imageCalls: number;
  textCalls: number;
  cacheHits: number;
  cacheMisses: number;
  estimatedCostUsd: number;
  queryImageCalls: number;
  candidateImageCalls: number;
  estimatedQueryImageCostUsd: number;
  estimatedCandidateImageCostUsd: number;
  imageInFlightDeduplications: number;
}>;

/** Integration-friendly constructor and metrics facade for the experimental provider. */
export class GeminiEmbeddingProvider extends GeminiEmbedding2Provider {
  constructor(options: GeminiEmbeddingProviderOptions) {
    if (!options || typeof options !== "object") {
      throw new Error("Gemini Embedding 2 provider options are required");
    }
    const { apiKey, outputDimension, ...providerOptions } = options;
    super(apiKey, {
      ...providerOptions,
      outputDimensionality: outputDimension,
    });
  }

  getMetrics(): GeminiEmbeddingProviderMetrics {
    const counters: GeminiEmbedding2Counters = this.getCounters();
    return Object.freeze({
      imageCalls: counters.imageCalls,
      textCalls: counters.textCalls,
      cacheHits: counters.imageCacheHits,
      cacheMisses: counters.imageCacheMisses,
      estimatedCostUsd: counters.estimatedImageCostUsd,
      queryImageCalls: counters.queryImageCalls,
      candidateImageCalls: counters.candidateImageCalls,
      estimatedQueryImageCostUsd: counters.estimatedQueryImageCostUsd,
      estimatedCandidateImageCostUsd: counters.estimatedCandidateImageCostUsd,
      imageInFlightDeduplications: counters.imageInFlightDeduplications,
    });
  }

  resetMetrics(): void {
    this.resetCounters();
  }
}

/**
 * Search-scoped visual comparison facade. Every candidate in one scope shares
 * the same query embedding promise, including a rejected promise.
 */
export class GeminiVisualAdapter {
  constructor(private readonly provider: GeminiEmbeddingProvider) {}

  forSearch(queryImage?: VisualImage): GeminiSearchVisualAdapter {
    return new GeminiSearchVisualAdapter(this.provider, queryImage);
  }

  withSearchLock<T>(action: () => T | Promise<T>): Promise<T> {
    return this.provider.withSearchLock(action);
  }
}

export class GeminiSearchVisualAdapter {
  private queryPromise?: Promise<number[]>;
  private queryHash?: string;

  constructor(
    private readonly provider: GeminiEmbeddingProvider,
    private readonly fixedQueryImage?: VisualImage,
  ) {}

  /** Compare reference/query image to candidate, embedding the query first. */
  async compareImages(reference: VisualImage, candidate: VisualImage): Promise<number>;
  /** With a query fixed by forSearch(query), compare that query to a candidate. */
  async compareImages(candidate: VisualImage): Promise<number>;
  async compareImages(first: VisualImage, second?: VisualImage): Promise<number> {
    const reference = this.fixedQueryImage ?? first;
    const candidate = this.fixedQueryImage && second === undefined ? first : second;
    if (!candidate) {
      throw new Error("A candidate image is required for Gemini visual comparison");
    }
    const referenceHash = this.hashImage(reference);
    if (this.queryHash !== undefined && this.queryHash !== referenceHash) {
      throw new Error("A Gemini visual search scope cannot change its query image");
    }
    this.queryHash ??= referenceHash;
    const queryEmbedding = await this.queryEmbedding(reference);
    const candidateEmbedding = await this.provider.embedCandidateImage(candidate);
    return this.provider.compare(queryEmbedding, candidateEmbedding);
  }

  private queryEmbedding(image: VisualImage): Promise<number[]> {
    if (!this.queryPromise) {
      // Defer invocation so even a synchronous validation error is memoized.
      this.queryPromise = Promise.resolve().then(() => this.provider.embedQueryImage(image));
    }
    return this.queryPromise;
  }

  private hashImage(image: VisualImage): string {
    if (!image || !(image.bytes instanceof Uint8Array)) {
      throw new Error("A valid query image is required for Gemini visual comparison");
    }
    return createHash("sha256").update(image.bytes).digest("hex");
  }
}

export { GeminiEmbedding2Error } from "./geminiEmbedding2";