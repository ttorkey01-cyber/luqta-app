import { BraveWebSearchProvider } from "../../connectors/braveWebSearchProvider";
import { createDefaultProviderRegistry, ProviderRegistry } from "../../connectors/providerRegistry";
import type { ProviderProduct } from "../../connectors/types";
import { ExperimentalSearchV3 } from "./index";
import { PixelVisualSimilarityAdapter } from "./visual";
import { GeminiEmbeddingProvider } from "./visual/gemini";
import { GeminiVisualAdapter } from "./visual/geminiVisualAdapter";
import { createImageUrlLoader } from "./visual/urlLoader";

export type SearchV3FactoryOptions = {
  /** Exact HTTPS hostnames approved for candidate product image loading. */
  candidateImageHostAllowlist?: string[];
  /** Explicit experimental opt-in; missing server secret uses local pixels. */
  visualProvider?: "local" | "gemini";
  geminiOutputDimension?: number;
  /** Upper-bounded at 20 NEW candidate comparisons per search. */
  geminiCandidateLimit?: number;
  /** Optional pre-indexed catalog used only for photo-only requests. */
  photoOnlyCandidatePool?:
    | readonly ProviderProduct[]
    | ((
        maxCandidates: number,
      ) => Promise<readonly ProviderProduct[]> | readonly ProviderProduct[]);
};

/**
 * Construct the experiment on demand. Importing this module has no side
 * effects; without an explicit opt-in, no feed providers or Brave client are
 * constructed and the prototype cannot perform a search.
 */
export function createSearchV3Experiment(
  enabled = process.env.LUQTA_SEARCH_V3_EXPERIMENTAL === "true",
  options: SearchV3FactoryOptions = {},
): ExperimentalSearchV3 {
  const allowedImageHosts = options.candidateImageHostAllowlist ?? [];
  const useGemini = enabled && options.visualProvider === "gemini" &&
    Boolean(process.env.GEMINI_API_KEY?.trim());
  const gemini = useGemini
    ? new GeminiEmbeddingProvider({
        apiKey: process.env.GEMINI_API_KEY!,
        outputDimension: options.geminiOutputDimension ?? 768,
        cacheMaxEntries: 4_096,
        cacheTtlMs: 24 * 60 * 60_000,
        timeoutMs: 8_000,
      })
    : undefined;
  const candidateLimit = Math.min(20, Math.max(0, Math.floor(options.geminiCandidateLimit ?? 20)));
  return new ExperimentalSearchV3({
    registry: enabled
      ? createDefaultProviderRegistry({ startBackgroundRefresh: false })
      : new ProviderRegistry([]),
    brave: enabled ? new BraveWebSearchProvider() : undefined,
    visualAdapter: enabled
      ? gemini ? new GeminiVisualAdapter(gemini) : new PixelVisualSimilarityAdapter()
      : undefined,
    ...(gemini
      ? { visualRankingOptions: { candidateLimit, concurrency: 2, comparisonTimeoutMs: 9_000, stageTimeoutMs: 20_000 } }
      : {}),
    imageLoader:
      enabled && allowedImageHosts.length > 0
        ? createImageUrlLoader({ enabled: true, allowedHosts: allowedImageHosts })
        : undefined,
    photoOnlyCandidatePool: options.photoOnlyCandidatePool,
    enabled,
  });
}