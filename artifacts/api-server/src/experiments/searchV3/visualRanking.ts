import type { ProviderProduct } from "../../connectors/types";
import { ImageUrlLoaderError } from "./visual/urlLoader";
import type { ImageUrlLoader } from "./visual/urlLoader";
import { VisualSimilarityError } from "./visual";
import type { VisualImage } from "./visual";
import type { RerankContext, RerankedCandidate } from "./index";

const MAX_VISUAL_CANDIDATES = 4;
const MAX_VISUAL_CONCURRENCY = 2;
const VISUAL_COMPARISON_TIMEOUT_MS = 1_200;

export type VisualRankingOptions = {
  candidateLimit?: number;
  concurrency?: number;
  comparisonTimeoutMs?: number;
  stageTimeoutMs?: number;
};

export type VisualAdapter = {
  compareImages(
    reference: VisualImage,
    candidate: VisualImage,
  ): Promise<{ visualScore: number; pixelScore: number; embeddingScore?: number; embeddingError?: string }>;
};

export type VisualCandidateDiagnostic = {
  productId: string;
  textScore: number;
  identityScore: number;
  visualScore?: number;
  hybridScore: number;
  visualStatus: "compared" | "unavailable" | "skipped";
  unavailableReason?: string;
};

type ComparisonRecord = {
  visualScore?: number;
  visualStatus: "compared" | "unavailable" | "skipped";
  unavailableReason?: string;
};

export type VisualRankingState = {
  comparisons: Map<string, ComparisonRecord>;
  remainingComparisons: number;
  stageLatencyMs: number;
  comparisonsAttempted: number;
  comparisonsCompleted: number;
  comparisonsFailed: number;
  imageLoadCalls: number;
  adapterCallCount: number;
};

export function createVisualRankingState(candidateLimit = MAX_VISUAL_CANDIDATES): VisualRankingState {
  return {
    comparisons: new Map(),
    remainingComparisons: Math.max(0, Math.floor(candidateLimit)),
    stageLatencyMs: 0,
    comparisonsAttempted: 0,
    comparisonsCompleted: 0,
    comparisonsFailed: 0,
    imageLoadCalls: 0,
    adapterCallCount: 0,
  };
}

function normalized(value: string) {
  return value.toLocaleLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function tokens(value: string) {
  return normalized(value).split(/\s+/u).filter((token) => token.length > 1);
}

function phraseMatch(surface: string, phrase: string) {
  const expected = normalized(phrase);
  return Boolean(expected) && ` ${normalized(surface)} `.includes(` ${expected} `);
}

function productSurface(product: ProviderProduct) {
  return [
    product.title,
    product.description,
    product.brand,
    product.productType,
    product.subcategory,
    product.color,
    product.providerProductId,
  ].filter(Boolean).join(" ");
}

function identifierSurface(product: ProviderProduct) {
  return [product.title, product.providerProductId].filter(Boolean).join(" ");
}

function productKey(product: ProviderProduct) {
  return product.productUrl ?? `${product.source ?? product.sourceType ?? ""}:${product.id}`;
}

function textEvidenceScore(context: RerankContext, product: ProviderProduct) {
  const textTokens = [...new Set(tokens([
    context.request.query,
    context.intent.normalized,
    context.request.image?.extractedText,
  ].filter(Boolean).join(" ")))];
  const surface = normalized(productSurface(product));
  if (!textTokens.length) return 0;
  return textTokens.filter((token) => surface.includes(token)).length / textTokens.length;
}

function identityEvidenceScore(context: RerankContext, product: ProviderProduct) {
  const { request, intent } = context;
  const surface = identifierSurface(product);
  const identifierScore = intent.typedIdentifiers.reduce((best, identifier) => {
    if (!phraseMatch(surface, identifier.value)) return best;
    const weight = identifier.kind === "sku" ? 1 : 0.85;
    return Math.max(best, weight * Math.max(0, Math.min(1, identifier.confidence)));
  }, 0);
  const hypothesisScore = intent.identityHypotheses.reduce((best, identity) => {
    const confidence = Math.max(0, Math.min(1, identity.confidence));
    if (identity.sku && phraseMatch(surface, identity.sku)) return Math.max(best, confidence);
    if (identity.model && phraseMatch(surface, identity.model)) return Math.max(best, confidence * 0.85);
    const labelTokens = tokens(identity.label);
    if (!labelTokens.length) return best;
    const matched = labelTokens.filter((token) => normalized(surface).includes(token));
    return Math.max(best, (matched.length / labelTokens.length) * confidence * 0.65);
  }, 0);
  const identityBrand = request.image?.identities.reduce((best, identity) => {
    if (!identity.brand || !phraseMatch(surface, identity.brand)) return best;
    return Math.max(best, Math.max(0, Math.min(1, identity.confidence)) * 0.5);
  }, 0) ?? 0;
  return Math.max(identifierScore, hypothesisScore, identityBrand);
}

function skuMatchPriority(context: RerankContext, product: ProviderProduct) {
  const surface = identifierSurface(product);
  return context.intent.typedIdentifiers.reduce((best, identifier) => {
    if (identifier.kind !== "sku" || !phraseMatch(surface, identifier.value)) return best;
    if (identifier.source === "text" || identifier.confidence >= 0.9) {
      return Math.max(best, 3 + identifier.confidence);
    }
    return Math.max(best, 2 + identifier.confidence);
  }, 0);
}

function stableErrorCode(error: unknown) {
  if (error instanceof ImageUrlLoaderError || error instanceof VisualSimilarityError) {
    return error.code;
  }
  if (error instanceof Error && error.message === "Visual comparison timed out") return "TIMEOUT";
  return "VISUAL_COMPARISON_FAILED";
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Visual comparison timed out")), timeoutMs);
    promise.then(resolve, reject).finally(() => clearTimeout(timeout));
  });
}

function unavailableReason(
  context: RerankContext,
  adapter?: VisualAdapter,
  imageLoader?: ImageUrlLoader,
) {
  if (!context.request.image?.imageBytes?.byteLength) return "REFERENCE_IMAGE_BYTES_MISSING";
  if (!adapter) return "VISUAL_ADAPTER_UNAVAILABLE";
  if (!imageLoader) return "IMAGE_URL_LOADER_UNAVAILABLE";
  return undefined;
}

export async function rerankWithVisual(
  context: RerankContext,
  candidates: RerankedCandidate[],
  adapter: VisualAdapter | undefined,
  imageLoader: ImageUrlLoader | undefined,
  state: VisualRankingState,
  options: VisualRankingOptions = {},
) {
  const startedAt = Date.now();
  const prerequisiteFailure = unavailableReason(context, adapter, imageLoader);
  const records = new Map<string, ComparisonRecord>();
  const eligibleForComparison: RerankedCandidate[] = [];

  for (const candidate of candidates) {
    const key = productKey(candidate.product);
    const cached = state.comparisons.get(key);
    if (cached) {
      records.set(key, cached);
    } else if (prerequisiteFailure) {
      const record = {
        visualStatus: "unavailable" as const,
        unavailableReason: prerequisiteFailure,
      };
      records.set(key, record);
    } else if (!candidate.product.imageUrl) {
      const record = {
        visualStatus: "unavailable" as const,
        unavailableReason: "CANDIDATE_IMAGE_URL_MISSING",
      };
      records.set(key, record);
    } else {
      eligibleForComparison.push(candidate);
    }
  }

  const selected = eligibleForComparison
    .filter((candidate) => !state.comparisons.has(productKey(candidate.product)))
    .slice(0, state.remainingComparisons);
  for (const candidate of eligibleForComparison) {
    if (selected.includes(candidate)) continue;
    const key = productKey(candidate.product);
    if (!state.comparisons.has(key)) {
      const record = {
        visualStatus: "skipped" as const,
        unavailableReason: "VISUAL_CANDIDATE_LIMIT_REACHED",
      };
      records.set(key, record);
      state.comparisons.set(key, record);
    }
  }
  state.remainingComparisons -= selected.length;

  if (selected.length && adapter && imageLoader && context.request.image?.imageBytes) {
    let cursor = 0;
    const stageDeadline = options.stageTimeoutMs === undefined
      ? Number.POSITIVE_INFINITY
      : Date.now() + Math.max(1, options.stageTimeoutMs);
    const workers = Array.from(
      {
        length: Math.min(
          Math.max(1, Math.floor(options.concurrency ?? MAX_VISUAL_CONCURRENCY)),
          selected.length,
        ),
      },
      async () => {
        while (cursor < selected.length) {
          const candidate = selected[cursor++];
          if (!candidate?.product.imageUrl) continue;
          const key = productKey(candidate.product);
          if (Date.now() >= stageDeadline) {
            const record = {
              visualStatus: "skipped" as const,
              unavailableReason: "VISUAL_STAGE_DEADLINE_REACHED",
            };
            state.comparisons.set(key, record);
            records.set(key, record);
            continue;
          }
          state.comparisonsAttempted += 1;
          state.imageLoadCalls += 1;
          try {
            const referenceImage = context.request.image;
            const comparison = await withTimeout(
              (async () => {
                const candidateImage = await imageLoader(candidate.product.imageUrl!);
                state.adapterCallCount += 1;
                return adapter.compareImages(
                  {
                    bytes: referenceImage!.imageBytes!,
                    ...(referenceImage?.mimeType ? { mimeType: referenceImage.mimeType } : {}),
                  },
                  candidateImage,
                );
              })(),
              Math.max(1, options.comparisonTimeoutMs ?? VISUAL_COMPARISON_TIMEOUT_MS),
            );
            if (!Number.isFinite(comparison.visualScore)) {
              throw new Error("Visual adapter returned a non-finite score");
            }
            const record: ComparisonRecord = {
              visualScore: Math.max(0, Math.min(1, comparison.visualScore)),
              visualStatus: "compared",
            };
            state.comparisonsCompleted += 1;
            state.comparisons.set(key, record);
            records.set(key, record);
          } catch (error) {
            const record: ComparisonRecord = {
              visualStatus: "unavailable",
              unavailableReason: stableErrorCode(error),
            };
            state.comparisonsFailed += 1;
            state.comparisons.set(key, record);
            records.set(key, record);
          }
        }
      },
    );
    await Promise.all(workers);
    for (const candidate of selected) {
      const key = productKey(candidate.product);
      if (state.comparisons.has(key)) {
        records.set(key, state.comparisons.get(key)!);
      }
    }
  }

  state.stageLatencyMs += Date.now() - startedAt;
  const scored = candidates.map((candidate) => {
    const key = productKey(candidate.product);
    const record = records.get(key) ?? state.comparisons.get(key) ?? {
      visualStatus: "skipped" as const,
      unavailableReason: prerequisiteFailure ?? "VISUAL_NOT_EVALUATED",
    };
    const textScore = candidate.textScore ?? textEvidenceScore(context, candidate.product);
    const identityScore = candidate.identityScore ?? identityEvidenceScore(context, candidate.product);
    const hasVerifiedSku = skuMatchPriority(context, candidate.product) >= 3;
    const visualWeight = hasVerifiedSku
      ? 0.02
      : textScore < 0.35
        ? 0.55
        : textScore < 0.55
          ? 0.42
          : textScore < 0.75
            ? 0.3
            : 0.15;
    const hybridScore = record.visualScore === undefined
      ? candidate.score
      : Math.max(0, Math.min(1, candidate.score * (1 - visualWeight) + record.visualScore * visualWeight));
    return {
      ...candidate,
      baseScore: candidate.score,
      score: Number(hybridScore.toFixed(4)),
      textScore: Number(textScore.toFixed(4)),
      identityScore: Number(identityScore.toFixed(4)),
      ...(record.visualScore !== undefined ? { visualScore: Number(record.visualScore.toFixed(4)) } : {}),
      hybridScore: Number(hybridScore.toFixed(4)),
      visualStatus: record.visualStatus,
      ...(record.unavailableReason ? { unavailableReason: record.unavailableReason } : {}),
      visualPriority: skuMatchPriority(context, candidate.product),
    };
  });
  scored.sort(
    (left, right) =>
      right.visualPriority - left.visualPriority ||
      (right.identityPriority ?? 0) - (left.identityPriority ?? 0) ||
      right.score - left.score,
  );

  const candidateDiagnostics: VisualCandidateDiagnostic[] = scored.map((candidate) => ({
    productId: candidate.product.id,
    textScore: candidate.textScore ?? 0,
    identityScore: candidate.identityScore ?? 0,
    ...(candidate.visualScore !== undefined ? { visualScore: candidate.visualScore } : {}),
    hybridScore: candidate.hybridScore ?? candidate.score,
    visualStatus: candidate.visualStatus ?? "unavailable",
    ...("unavailableReason" in candidate && candidate.unavailableReason
      ? { unavailableReason: candidate.unavailableReason }
      : {}),
  }));
  const hasVisual = state.comparisonsCompleted > 0;
  const hasUnavailable = scored.some((candidate) => candidate.visualStatus !== "compared");
  const overallUnavailableReason =
    prerequisiteFailure ??
    (state.comparisonsCompleted === 0
      ? scored.find((candidate) => "unavailableReason" in candidate)?.unavailableReason ??
        (scored.length ? undefined : "NO_ELIGIBLE_CANDIDATES")
      : undefined);
  return {
    ranked: scored.map(({ visualPriority: _visualPriority, ...candidate }) => candidate),
    diagnostics: {
      status: !hasVisual ? "unavailable" as const : hasUnavailable ? "partial" as const : "available" as const,
      ...(overallUnavailableReason ? { unavailableReason: overallUnavailableReason } : {}),
      candidates: candidateDiagnostics,
      stageLatencyMs: state.stageLatencyMs,
      comparisonsAttempted: state.comparisonsAttempted,
      comparisonsCompleted: state.comparisonsCompleted,
      comparisonsFailed: state.comparisonsFailed,
      imageLoadCalls: state.imageLoadCalls,
      adapterCallCount: state.adapterCallCount,
    },
  };
}