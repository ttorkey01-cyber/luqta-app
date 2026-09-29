import {
  BenchmarkAdapterCallError,
  type AdapterSearchResult,
  type RealWorldCandidate,
  type RealWorldSearchAdapter,
} from "./benchmark";
import { GeminiEmbeddingProvider } from "../visual/gemini";
import { GeminiVisualAdapter } from "../visual/geminiVisualAdapter";
import { PixelVisualSimilarityAdapter, type VisualImage } from "../visual";
import type { VisualAdapter } from "../visualRanking";

const MAX_VISUAL_BENCHMARK_CANDIDATES = 20;

export type RealWorldBenchmarkImageLoader = (url: string) => Promise<VisualImage>;

export type RealWorldVisualCatalogAdapterOptions = {
  candidateCatalog: readonly RealWorldCandidate[];
  candidateCatalogFingerprint: string;
  imageLoader: RealWorldBenchmarkImageLoader;
};

function validateOptions(options: RealWorldVisualCatalogAdapterOptions): string[] {
  if (!options.candidateCatalogFingerprint.trim()) {
    throw new Error("A candidate catalog fingerprint is required");
  }
  if (options.candidateCatalog.length === 0 ||
      options.candidateCatalog.length > MAX_VISUAL_BENCHMARK_CANDIDATES
  ) {
    throw new Error(`Visual benchmark catalog must contain 1-${MAX_VISUAL_BENCHMARK_CANDIDATES} candidates`);
  }
  const ids = options.candidateCatalog.map(({ id }) => id);
  if (ids.some((id) => !id.trim()) || new Set(ids).size !== ids.length) {
    throw new Error("Visual benchmark catalog candidate IDs must be non-empty and unique");
  }
  if (options.candidateCatalog.some(({ imageUrl }) => !imageUrl?.trim())) {
    throw new Error("Every controlled visual benchmark candidate must have an imageUrl");
  }
  return ids;
}

function counterDelta<T extends object>(
  before: T,
  after: T,
): Partial<Record<keyof T, number>> {
  const beforeCounters = before as Record<keyof T, number>;
  const afterCounters = after as Record<keyof T, number>;
  return Object.fromEntries(
    Object.keys(afterCounters).map((key) => [
      key,
      afterCounters[key as keyof T] - beforeCounters[key as keyof T],
    ]),
  ) as Partial<Record<keyof T, number>>;
}

function visualCatalogAdapter(
  version: "v3" | "gemini-v3",
  adapterId: string,
  options: RealWorldVisualCatalogAdapterOptions,
  visualAdapter: VisualAdapter,
  provider?: GeminiEmbeddingProvider,
): RealWorldSearchAdapter {
  const candidateIds = validateOptions(options);
  const readMetrics = () => visualAdapter.getEmbeddingMetrics?.() ?? provider?.getMetrics();
  const search: RealWorldSearchAdapter["search"] = async (input) => {
    if (input.candidateCatalogFingerprint !== options.candidateCatalogFingerprint ||
        input.candidateCatalog.length !== candidateIds.length ||
        input.candidateCatalog.some((candidate, index) =>
          candidate.id !== candidateIds[index] ||
          candidate.imageUrl !== options.candidateCatalog[index]?.imageUrl
        )
    ) {
      throw new Error("Visual benchmark adapter received a different controlled candidate catalog");
    }

    const startedAt = Date.now();
    const execute = async () => {
      const before = readMetrics();
      try {
        const searchVisualAdapter = visualAdapter.forSearch?.() ?? visualAdapter;
        const reference = await options.imageLoader(input.benchmarkCase.imageUrl);
        const outcomes = await Promise.allSettled(options.candidateCatalog.map(async (candidate, index) => {
          const candidateImage = await options.imageLoader(candidate.imageUrl!);
          const comparison = await searchVisualAdapter.compareImages(reference, candidateImage);
          if (version === "gemini-v3" && comparison.embeddingScore === undefined) {
            throw new Error("GEMINI_EMBEDDING_UNAVAILABLE");
          }
          const score = version === "gemini-v3"
            ? comparison.pixelUnavailable
              ? comparison.embeddingScore!
              : 0.4 * comparison.pixelScore + 0.6 * comparison.embeddingScore!
            : comparison.pixelScore;
          if (!Number.isFinite(score)) throw new Error("VISUAL_SCORE_INVALID");
          return { id: candidate.id, index, score };
        }));
        const failedCandidate = outcomes.find((outcome) => outcome.status === "rejected");
        if (failedCandidate?.status === "rejected") throw failedCandidate.reason;
        const ranked = outcomes.flatMap((outcome) =>
          outcome.status === "fulfilled" ? [outcome.value] : [],
        );
        ranked.sort((left, right) => right.score - left.score || left.index - right.index);
        const current = readMetrics();
        const metrics = before && current ? counterDelta(before, current) : undefined;
        const result: AdapterSearchResult = {
          caseId: input.benchmarkCase.id,
          candidateCatalogFingerprint: input.candidateCatalogFingerprint,
          rankedCandidateIds: ranked.map(({ id }) => id),
          latencyMs: Math.max(0, Date.now() - startedAt),
          providerCalls: metrics?.imageCalls ?? 0,
          braveCalls: 0,
          modelCalls: metrics?.imageCalls ?? 0,
          ...(metrics ? {
            ...(metrics.cacheHits !== undefined ? { cacheHits: metrics.cacheHits } : {}),
            ...(metrics.cacheMisses !== undefined ? { cacheMisses: metrics.cacheMisses } : {}),
            ...(metrics.estimatedCostUsd !== undefined ? { estimatedCostPerSearch: metrics.estimatedCostUsd } : {}),
          } : { estimatedCostPerSearch: 0 }),
        };
        return result;
      } catch (error) {
        const current = readMetrics();
        const metrics = before && current ? counterDelta(before, current) : undefined;
        const safeCode = error instanceof Error && error.message === "GEMINI_EMBEDDING_UNAVAILABLE"
          ? "GEMINI_EMBEDDING_UNAVAILABLE"
          : "REAL_WORLD_VISUAL_ADAPTER_FAILED";
        throw new BenchmarkAdapterCallError(
          safeCode,
          {
            providerCalls: metrics?.imageCalls ?? 0,
            braveCalls: 0,
            modelCalls: metrics?.imageCalls ?? 0,
            ...(metrics ? {
              ...(metrics.cacheHits !== undefined ? { cacheHits: metrics.cacheHits } : {}),
              ...(metrics.cacheMisses !== undefined ? { cacheMisses: metrics.cacheMisses } : {}),
              ...(metrics.estimatedCostUsd !== undefined ? { estimatedCostPerSearch: metrics.estimatedCostUsd } : {}),
            } : { estimatedCostPerSearch: 0 }),
          },
        );
      }
    };
    const withLock = visualAdapter.withSearchLock?.bind(visualAdapter) ??
      provider?.withSearchLock.bind(provider);
    return withLock ? withLock(execute) : execute();
  };
  return { version, id: adapterId, search };
}

/** Catalog-limited local V3 visual baseline using the local pixel adapter. */
export function createLocalV3BenchmarkAdapter(
  options: RealWorldVisualCatalogAdapterOptions,
): RealWorldSearchAdapter {
  return visualCatalogAdapter(
    "v3",
    "local-v3-pixel-catalog",
    options,
    new PixelVisualSimilarityAdapter(),
  );
}

export type GeminiV3BenchmarkAdapterOptions = RealWorldVisualCatalogAdapterOptions & {
  /** Must be true to construct the real provider. False returns without needing a key. */
  enabled: boolean;
  /** Explicit server-side credential; never read from process environment. */
  apiKey?: string;
  fetch?: typeof globalThis.fetch;
  outputDimension?: number;
};

/**
 * Build the actual Gemini V3 visual benchmark adapter only by explicit opt-in.
 * Construction itself performs no network requests; search invokes the supplied
 * transport through GeminiEmbeddingProvider.
 */
export function createGeminiV3BenchmarkAdapter(
  options: GeminiV3BenchmarkAdapterOptions,
): RealWorldSearchAdapter | undefined {
  if (!options.enabled) return undefined;
  if (!options.apiKey?.trim()) {
    throw new Error("Gemini V3 benchmark opt-in requires an explicit server-side API key");
  }
  const provider = new GeminiEmbeddingProvider({
    apiKey: options.apiKey,
    outputDimension: options.outputDimension ?? 768,
    cacheMaxEntries: 4_096,
    cacheTtlMs: 24 * 60 * 60_000,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return createGeminiV3BenchmarkAdapterFromProvider({
    candidateCatalog: options.candidateCatalog,
    candidateCatalogFingerprint: options.candidateCatalogFingerprint,
    imageLoader: options.imageLoader,
    provider,
  });
}

/** Compose an already explicitly configured Gemini provider with the V3 visual adapter. */
export function createGeminiV3BenchmarkAdapterFromProvider(
  options: RealWorldVisualCatalogAdapterOptions & { provider: GeminiEmbeddingProvider },
): RealWorldSearchAdapter {
  return visualCatalogAdapter(
    "gemini-v3",
    "gemini-v3-embedding-2",
    options,
    new GeminiVisualAdapter(options.provider),
    options.provider,
  );
}