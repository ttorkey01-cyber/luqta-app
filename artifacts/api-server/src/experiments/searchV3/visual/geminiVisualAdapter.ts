import type { VisualAdapter } from "../visualRanking";
import { PixelVisualSimilarityAdapter, type VisualImage } from "./index";
import { GeminiEmbeddingProvider, GeminiSearchVisualAdapter } from "./gemini";

/**
 * Experimental composition: the embedding provider remains replaceable and the
 * existing local visual adapter remains usable without Gemini.
 */
export class GeminiVisualAdapter implements VisualAdapter {
  private readonly local = new PixelVisualSimilarityAdapter();

  constructor(
    readonly provider: GeminiEmbeddingProvider,
    private readonly semantic = new GeminiSearchVisualAdapter(provider),
  ) {}

  forSearch() {
    return new GeminiVisualAdapter(this.provider);
  }

  withSearchLock<T>(action: () => Promise<T>): Promise<T> {
    return this.provider.withSearchLock(action);
  }

  getEmbeddingMetrics() {
    return this.provider.getMetrics();
  }

  async compareImages(reference: VisualImage, candidate: VisualImage) {
    const [pixels, embeddings] = await Promise.allSettled([
      this.local.compareImages(reference, candidate),
      this.semantic.compareImages(reference, candidate),
    ]);
    if (pixels.status === "rejected" && embeddings.status === "rejected") {
      // Never propagate provider response bodies, request headers or key material.
      throw new Error("LOCAL_AND_GEMINI_VISUAL_UNAVAILABLE");
    }
    const pixelScore = pixels.status === "fulfilled" ? pixels.value.pixelScore : 0;
    if (embeddings.status === "rejected") {
      return { visualScore: pixelScore, pixelScore, embeddingError: "GEMINI_EMBEDDING_UNAVAILABLE" };
    }
    return {
      visualScore: embeddings.value,
      pixelScore,
      ...(pixels.status === "rejected" ? { pixelUnavailable: true } : {}),
      embeddingScore: embeddings.value,
    };
  }
}