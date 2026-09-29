import { REAL_WORLD_IMAGE_CASES, type RealWorldImageCase } from "./manifest";

export type RealWorldCandidate = {
  id: string;
  imageUrl?: string;
  [field: string]: unknown;
};

export type VisualQualityRating = {
  candidateId: string;
  /** Human-review score; 1 is poor visual match and 5 is strong visual match. */
  score: 1 | 2 | 3 | 4 | 5;
  evaluator: string;
};

export type ResultViolations = {
  wrongProduct?: boolean;
  wrongBrand?: boolean;
  price?: boolean;
  constraint?: boolean;
};

export type ReferenceImageVerification = {
  available: boolean;
  /** Identified person/service independent from the search adapter. */
  verifiedBy: string;
  verifiedAt: string;
  method: "http-get-200" | "human-opened-image";
  imageUrl: string;
};

export type CandidateCatalogReview = {
  reviewerId: string;
  reviewedAt: string;
  candidateCatalogFingerprint: string;
  /** Must cover the entire supplied catalog, not just returned candidates. */
  reviewedCandidateIds: string[];
};

export type BenchmarkCaseReview = {
  caseId: string;
  referenceImageVerification: ReferenceImageVerification;
  catalogReview: CandidateCatalogReview;
  adjudication: {
    reviewerId: string;
    reviewedAt: string;
    exactCandidateIds: string[];
    closeCandidateIds: string[];
    relevanceByCandidateId: Record<string, "exact" | "close" | "irrelevant">;
    visualQualityRatings?: VisualQualityRating[];
    violationsByCandidateId?: Record<string, ResultViolations>;
  };
};

/** Search measurements returned by an adapter; it cannot provide adjudication. */
export type AdapterSearchResult = {
  caseId: string;
  /** The adapter must echo the exact shared-catalog fingerprint it searched. */
  candidateCatalogFingerprint: string;
  rankedCandidateIds: string[];
  latencyMs: number;
  providerCalls?: number;
  braveCalls?: number;
  modelCalls?: number;
  cacheHits?: number;
  cacheMisses?: number;
  estimatedCostPerSearch?: number;
  firstPassSuccess?: boolean;
  secondPassAttempted?: boolean;
  secondPassRecovery?: boolean;
};

/** Combined only by the runner from separate adapter and reviewer inputs. */
export type BenchmarkObservation = AdapterSearchResult & {
  adapterId: string;
  review?: BenchmarkCaseReview;
};

export type RealWorldSearchAdapter = {
  /** `v3` is the local V3 path; `gemini-v3` is the opt-in Gemini-backed path. */
  version: "v2" | "v3" | "gemini-v3";
  /** Stable adapter identifier, distinct from human reviewer identifiers. */
  id: string;
  search(input: {
    adapterId: string;
    benchmarkCase: RealWorldImageCase;
    candidateCatalog: readonly RealWorldCandidate[];
    candidateCatalogFingerprint: string;
  }): Promise<AdapterSearchResult>;
};

export type BenchmarkAdapterError = {
  caseId: string;
  message: string;
  latencyMs: number;
  providerCalls?: number;
  braveCalls?: number;
  modelCalls?: number;
  cacheHits?: number;
  cacheMisses?: number;
  estimatedCostPerSearch?: number;
};

/** Lets adapters preserve trustworthy counters when a search fails partway through. */
export class BenchmarkAdapterCallError extends Error {
  constructor(
    message: string,
    readonly measurements: Partial<Pick<
      AdapterSearchResult,
      "providerCalls" | "braveCalls" | "modelCalls" | "cacheHits" | "cacheMisses" | "estimatedCostPerSearch"
    >> = {},
  ) {
    super(message);
    this.name = "BenchmarkAdapterCallError";
  }
}

export type RateMetric = { rate: number | null; numerator: number; denominator: number };

export type RealWorldMetricSummary = {
  totalCases: number;
  evaluatedCases: number;
  top1: RateMetric;
  top3: RateMetric;
  top5: RateMetric;
  exactProductTop5: RateMetric;
  closeMatchTop3: RateMetric;
  visualQualityMean1To5: { mean: number | null; ratings: number };
  irrelevantResultRate: RateMetric;
  violations: {
    wrongProduct: RateMetric;
    wrongBrand: RateMetric;
    price: RateMetric;
    constraint: RateMetric;
  };
  constraintCompliance: RateMetric;
  firstPassSuccess: RateMetric;
  secondPassRecovery: RateMetric;
  latencyMs: { mean: number | null; p95: number | null; measuredCases: number };
  providerCalls: number | null;
  braveCalls: number | null;
  modelCalls: number | null;
  cacheHits: number | null;
  cacheMisses: number | null;
  estimatedCostPerSearch: number | null;
};

export type VersionBenchmarkReport = {
  status: "available" | "partial" | "unavailable";
  unavailableReason?: string;
  summary: RealWorldMetricSummary;
  observations: BenchmarkObservation[];
  errors: BenchmarkAdapterError[];
};

export type RealWorldBenchmarkReport = {
  benchmark: "LUQTA Search V2 vs local V3 vs Gemini V3 real-image";
  generatedAt: string;
  candidateCatalogFingerprint: string | null;
  imageCases: number;
  provenance: "Static Wikimedia Commons metadata snapshot; remote images are not downloaded by this runner.";
  v2: VersionBenchmarkReport;
  /** Local V3 benchmark arm (keeps the existing v3 adapter interface). */
  v3: VersionBenchmarkReport;
  geminiV3: VersionBenchmarkReport;
  limitations: string[];
};

const rate = (numerator: number, denominator: number): RateMetric => ({
  rate: denominator ? Number((numerator / denominator).toFixed(4)) : null,
  numerator,
  denominator,
});

const mean = (values: number[]): number | null =>
  values.length ? Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(2)) : null;

const meanCost = (values: number[]): number | null =>
  values.length ? Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(8)) : null;

function p95(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.ceil(sorted.length * 0.95) - 1]!.toFixed(2));
}

function sumMeasurements(
  observations: BenchmarkObservation[],
  errors: BenchmarkAdapterError[],
  key: "providerCalls" | "braveCalls" | "modelCalls" | "cacheHits" | "cacheMisses",
): number | null {
  const counts = [
    ...observations.map((observation) => observation[key]),
    ...errors.map((error) => error[key]),
  ];
  return counts.length && counts.every((value) => value !== undefined)
    ? counts.reduce((total, value) => total + value!, 0)
    : null;
}

function validTimestamp(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function hasIndependentReferenceImageEvidence(
  evidence: ReferenceImageVerification | undefined,
  adapterId: string,
): evidence is ReferenceImageVerification {
  return Boolean(
    evidence?.available === true &&
    evidence.verifiedBy.trim() &&
    evidence.verifiedBy !== adapterId &&
    validTimestamp(evidence.verifiedAt) &&
    ["http-get-200", "human-opened-image"].includes(evidence.method),
  );
}

function sameSet(a: readonly string[], b: ReadonlySet<string>): boolean {
  return a.length === b.size && new Set(a).size === a.length && a.every((id) => b.has(id));
}

function hasVerifiedImageForCase(
  observation: BenchmarkObservation,
  benchmarkCase: RealWorldImageCase,
): boolean {
  return hasIndependentReferenceImageEvidence(
    observation.review?.referenceImageVerification,
    observation.adapterId,
  ) && observation.review?.referenceImageVerification.imageUrl === benchmarkCase.imageUrl;
}

function isFullyReviewedObservation(
  observation: BenchmarkObservation,
  benchmarkCase: RealWorldImageCase,
  expectedFingerprint: string,
  candidateCatalogIds: ReadonlySet<string>,
): boolean {
  const review = observation.review;
  const catalogReview = review?.catalogReview;
  const adjudication = review?.adjudication;
  if (!hasVerifiedImageForCase(observation, benchmarkCase) ||
      !catalogReview ||
      !catalogReview.reviewerId.trim() ||
      catalogReview.reviewerId === observation.adapterId ||
      !validTimestamp(catalogReview.reviewedAt) ||
      catalogReview.candidateCatalogFingerprint !== expectedFingerprint ||
      !sameSet(catalogReview.reviewedCandidateIds, candidateCatalogIds) ||
      !adjudication ||
      !adjudication.reviewerId.trim() ||
      adjudication.reviewerId === observation.adapterId ||
      adjudication.reviewerId !== catalogReview.reviewerId ||
      !validTimestamp(adjudication.reviewedAt)
  ) return false;

  const relevance = adjudication.relevanceByCandidateId;
  if (!sameSet(Object.keys(relevance), candidateCatalogIds) ||
      !Object.values(relevance).every((label) => ["exact", "close", "irrelevant"].includes(label))
  ) return false;
  const exactIds = new Set(
    Object.entries(relevance).filter(([, label]) => label === "exact").map(([id]) => id),
  );
  const closeIds = new Set(
    Object.entries(relevance).filter(([, label]) => label === "close").map(([id]) => id),
  );
  return sameSet(adjudication.exactCandidateIds, exactIds) &&
    sameSet(adjudication.closeCandidateIds, closeIds) &&
    observation.rankedCandidateIds.slice(0, 5).every((id) => candidateCatalogIds.has(id));
}

/**
 * Calculate metrics only from adapter results and explicit adjudication.
 * Cases without a reviewed candidate pool do not count as retrieval misses.
 */
export function summarizeRealWorldObservations(
  cases: readonly RealWorldImageCase[],
  observations: readonly BenchmarkObservation[],
  candidateCatalogFingerprint: string,
  candidateCatalogIds: ReadonlySet<string>,
  errors: readonly BenchmarkAdapterError[] = [],
): RealWorldMetricSummary {
  const observationsById = new Map(observations.map((observation) => [observation.caseId, observation]));
  const fullyReviewed = new Map<string, BenchmarkObservation>();
  for (const benchmarkCase of cases) {
    const observation = observationsById.get(benchmarkCase.id);
    if (observation && isFullyReviewedObservation(
      observation,
      benchmarkCase,
      candidateCatalogFingerprint,
      candidateCatalogIds,
    )) {
      fullyReviewed.set(benchmarkCase.id, observation);
    }
  }
  const judged = cases.flatMap((benchmarkCase) => {
    const observation = fullyReviewed.get(benchmarkCase.id);
    return observation ? [{ benchmarkCase, observation }] : [];
  });
  const topK = (k: number, qualifies: (observation: BenchmarkObservation, id: string) => boolean) =>
    rate(judged.filter(({ observation }) => observation.rankedCandidateIds.slice(0, k).some((id) => qualifies(observation, id))).length, judged.length);
  const exactAt = (observation: BenchmarkObservation, id: string) =>
    observation.review?.adjudication.exactCandidateIds.includes(id) ?? false;
  const closeAt = (observation: BenchmarkObservation, id: string) =>
    observation.review?.adjudication.closeCandidateIds.includes(id) ?? false;

  const relevanceReviewed: Array<{ observation: BenchmarkObservation; candidateId: string }> = [];
  const violationValues: Record<keyof ResultViolations, boolean[]> = {
    wrongProduct: [],
    wrongBrand: [],
    price: [],
    constraint: [],
  };
  const ratings: number[] = [];
  for (const observation of fullyReviewed.values()) {
    const adjudication = observation.review?.adjudication;
    if (!adjudication) continue;
    for (const candidateId of observation.rankedCandidateIds.slice(0, 5)) {
      if (adjudication.relevanceByCandidateId[candidateId] !== undefined) {
        relevanceReviewed.push({ observation, candidateId });
      }
      const violation = adjudication.violationsByCandidateId?.[candidateId];
      if (violation) {
        for (const key of Object.keys(violationValues) as Array<keyof ResultViolations>) {
          if (violation[key] !== undefined) violationValues[key].push(violation[key]!);
        }
      }
    }
    for (const rating of adjudication.visualQualityRatings ?? []) {
      if (rating.evaluator.trim() &&
          rating.evaluator === adjudication.reviewerId &&
          observation.rankedCandidateIds.slice(0, 5).includes(rating.candidateId)
      ) ratings.push(rating.score);
    }
  }

  const latencies = [
    ...observations.map(({ latencyMs }) => latencyMs),
    ...errors.map(({ latencyMs }) => latencyMs),
  ]
    .filter((latencyMs) => Number.isFinite(latencyMs) && latencyMs >= 0);
  const firstPassObservations = observations.filter(({ firstPassSuccess }) => firstPassSuccess !== undefined);
  const secondPassObservations = observations.filter(({ secondPassAttempted, secondPassRecovery }) =>
    secondPassAttempted === true && secondPassRecovery !== undefined,
  );
  const violationRate = (key: keyof ResultViolations) =>
    rate(violationValues[key].filter(Boolean).length, violationValues[key].length);
  const costs = [
    ...observations.map(({ estimatedCostPerSearch }) => estimatedCostPerSearch),
    ...errors.map(({ estimatedCostPerSearch }) => estimatedCostPerSearch),
  ];
  const allCostsMeasured = costs.length > 0 && costs.every((cost) => cost !== undefined);

  return {
    totalCases: cases.length,
    evaluatedCases: judged.length,
    top1: topK(1, (observation, id) => exactAt(observation, id) || closeAt(observation, id)),
    top3: topK(3, (observation, id) => exactAt(observation, id) || closeAt(observation, id)),
    top5: topK(5, (observation, id) => exactAt(observation, id) || closeAt(observation, id)),
    exactProductTop5: topK(5, exactAt),
    closeMatchTop3: topK(3, closeAt),
    visualQualityMean1To5: { mean: mean(ratings), ratings: ratings.length },
    irrelevantResultRate: rate(
      relevanceReviewed.filter(({ observation, candidateId }) =>
        observation.review?.adjudication.relevanceByCandidateId[candidateId] === "irrelevant",
      ).length,
      relevanceReviewed.length,
    ),
    violations: {
      wrongProduct: violationRate("wrongProduct"),
      wrongBrand: violationRate("wrongBrand"),
      price: violationRate("price"),
      constraint: violationRate("constraint"),
    },
    constraintCompliance: rate(
      violationValues.constraint.filter((violation) => !violation).length,
      violationValues.constraint.length,
    ),
    firstPassSuccess: rate(firstPassObservations.filter(({ firstPassSuccess }) => firstPassSuccess).length, firstPassObservations.length),
    secondPassRecovery: rate(secondPassObservations.filter(({ secondPassRecovery }) => secondPassRecovery).length, secondPassObservations.length),
    latencyMs: { mean: mean(latencies), p95: p95(latencies), measuredCases: latencies.length },
    providerCalls: sumMeasurements([...observations], [...errors], "providerCalls"),
    braveCalls: sumMeasurements([...observations], [...errors], "braveCalls"),
    modelCalls: sumMeasurements([...observations], [...errors], "modelCalls"),
    cacheHits: sumMeasurements([...observations], [...errors], "cacheHits"),
    cacheMisses: sumMeasurements([...observations], [...errors], "cacheMisses"),
    estimatedCostPerSearch: allCostsMeasured ? meanCost(costs as number[]) : null,
  };
}

function emptyVersion(cases: readonly RealWorldImageCase[], reason: string): VersionBenchmarkReport {
  return {
    status: "unavailable",
    unavailableReason: reason,
    summary: summarizeRealWorldObservations(cases, [], "", new Set()),
    observations: [],
    errors: [],
  };
}

function imageCaseIssue(cases: readonly RealWorldImageCase[]): string | undefined {
  const missing = cases.find(({ imageUrl }) => {
    if (!imageUrl.trim()) return true;
    try {
      const parsed = new URL(imageUrl);
      return parsed.protocol !== "https:" ||
        !["thumb.wikimedia.org", "upload.wikimedia.org"].includes(parsed.hostname);
    } catch {
      return true;
    }
  });
  return missing
    ? `Image URL is missing or outside the permitted Wikimedia HTTPS hosts for case ${missing.id}.`
    : undefined;
}

function summarizeVersion(
  cases: readonly RealWorldImageCase[],
  observations: BenchmarkObservation[],
  catalogFingerprint: string,
  catalogIds: ReadonlySet<string>,
  errors: BenchmarkAdapterError[],
): VersionBenchmarkReport {
  const observationByCaseId = new Map(observations.map((observation) => [observation.caseId, observation]));
  const imageReady = cases.filter((benchmarkCase) => {
    const observation = observationByCaseId.get(benchmarkCase.id);
    return observation && hasVerifiedImageForCase(observation, benchmarkCase);
  }).length;
  const reviewed = cases.filter((benchmarkCase) => {
    const observation = observationByCaseId.get(benchmarkCase.id);
    return observation && isFullyReviewedObservation(
      observation,
      benchmarkCase,
      catalogFingerprint,
      catalogIds,
    );
  }).length;
  let status: VersionBenchmarkReport["status"];
  let unavailableReason: string | undefined;
  if (imageReady === 0) {
    status = "unavailable";
    unavailableReason = errors.length
      ? `${errors.length}/${cases.length} adapter calls failed and no independent reference-image verification evidence was supplied.`
      : "No independent reference-image verification evidence was supplied; real-image metrics are unavailable.";
  } else if (reviewed === 0) {
    status = "unavailable";
    unavailableReason = "No case has independent image evidence plus complete, reviewer-identified relevance judgments for the supplied catalog; quality metrics are unavailable.";
  } else if (imageReady < cases.length || reviewed < cases.length) {
    status = "partial";
    unavailableReason = `${reviewed}/${cases.length} cases have independent image evidence and complete catalog/relevance review.`;
  } else {
    status = "available";
  }
  return {
    status,
    ...(unavailableReason ? { unavailableReason } : {}),
    summary: summarizeRealWorldObservations(cases, observations, catalogFingerprint, catalogIds, errors),
    observations,
    errors,
  };
}

function validateObservation(
  observation: AdapterSearchResult,
  benchmarkCase: RealWorldImageCase,
  catalogFingerprint: string,
  catalogIds: Set<string>,
): void {
  if (observation.caseId !== benchmarkCase.id) throw new Error(`Adapter returned case ${observation.caseId} for ${benchmarkCase.id}`);
  if (observation.candidateCatalogFingerprint !== catalogFingerprint) {
    throw new Error(`${benchmarkCase.id}: adapter did not use the shared candidate catalog fingerprint`);
  }
  if (!Number.isFinite(observation.latencyMs) || observation.latencyMs < 0) {
    throw new Error(`${benchmarkCase.id}: latencyMs must be a finite, non-negative number`);
  }
  if (observation.rankedCandidateIds.some((id) => !catalogIds.has(id))) {
    throw new Error(`${benchmarkCase.id}: adapter returned a candidate outside the shared catalog`);
  }
  if (new Set(observation.rankedCandidateIds).size !== observation.rankedCandidateIds.length) {
    throw new Error(`${benchmarkCase.id}: adapter returned duplicate candidate IDs`);
  }
  for (const key of ["providerCalls", "braveCalls", "modelCalls", "cacheHits", "cacheMisses"] as const) {
    const value = observation[key];
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new Error(`${benchmarkCase.id}: ${key} must be a non-negative integer`);
    }
  }
  if (observation.estimatedCostPerSearch !== undefined &&
      (!Number.isFinite(observation.estimatedCostPerSearch) || observation.estimatedCostPerSearch < 0)
  ) {
    throw new Error(`${benchmarkCase.id}: estimatedCostPerSearch must be finite and non-negative`);
  }
}

/**
 * Inject existing V2/V3 clients and the same real candidate pool. This module
 * makes no network requests itself; image processing, if any, belongs to the
 * explicitly supplied adapters. Quality metrics require independent reference
 * image verification, a human reviewer distinct from the adapter, an exact
 * review of the full shared catalog, and relevance labels for every catalog ID.
 */
export async function runRealWorldBenchmark(input: {
  candidateCatalog?: readonly RealWorldCandidate[];
  candidateCatalogFingerprint?: string;
  v2?: RealWorldSearchAdapter;
  /** Existing V3 adapter using the local, non-Gemini visual/reranking path. */
  v3?: RealWorldSearchAdapter;
  /** Explicit opt-in Gemini V3 adapter. No key lookup or fallback is performed here. */
  geminiV3?: RealWorldSearchAdapter;
  cases?: readonly RealWorldImageCase[];
  /** Separate independent human/provenance evidence; never returned by adapters. */
  reviews?: readonly BenchmarkCaseReview[];
}): Promise<RealWorldBenchmarkReport> {
  const cases = input.cases ?? REAL_WORLD_IMAGE_CASES;
  const catalog = input.candidateCatalog;
  const fingerprint = input.candidateCatalogFingerprint;
  const missingImageReason = imageCaseIssue(cases);
  const unavailableCatalogReason = !catalog?.length
    ? "No real candidate catalog was provided; retrieval metrics are unavailable."
    : !fingerprint
      ? "A stable candidate-catalog fingerprint was not provided; paired comparison is unavailable."
      : undefined;
  const catalogIds = new Set(catalog?.map(({ id }) => id) ?? []);
  const reviewsByCaseId = new Map<string, BenchmarkCaseReview>();
  for (const review of input.reviews ?? []) {
    if (reviewsByCaseId.has(review.caseId)) throw new Error(`Duplicate independent review for case ${review.caseId}`);
    if (!cases.some(({ id }) => id === review.caseId)) throw new Error(`Review refers to unknown benchmark case ${review.caseId}`);
    reviewsByCaseId.set(review.caseId, review);
  }
  if (catalog && catalogIds.size !== catalog.length) {
    throw new Error("Candidate catalog contains duplicate candidate IDs");
  }

  const execute = async (
    adapter: RealWorldSearchAdapter | undefined,
    version: "v2" | "v3" | "gemini-v3",
  ) => {
    if (!adapter) return emptyVersion(cases, `${version.toUpperCase()} search adapter is not configured.`);
    if (adapter.version !== version) throw new Error(`Expected a ${version.toUpperCase()} adapter, received ${adapter.version.toUpperCase()}`);
    if (!adapter.id.trim()) throw new Error(`${version.toUpperCase()} adapter id is required`);
    if (missingImageReason) return emptyVersion(cases, missingImageReason);
    if (unavailableCatalogReason) return emptyVersion(cases, unavailableCatalogReason);
    const observations: BenchmarkObservation[] = [];
    const errors: BenchmarkAdapterError[] = [];
    for (const benchmarkCase of cases) {
      const startedAt = Date.now();
      try {
        const observation = await adapter.search({
          adapterId: adapter.id,
          benchmarkCase,
          candidateCatalog: catalog!,
          candidateCatalogFingerprint: fingerprint!,
        });
        validateObservation(observation, benchmarkCase, fingerprint!, catalogIds);
        const independentReview = reviewsByCaseId.get(benchmarkCase.id);
        observations.push({
          caseId: observation.caseId,
          adapterId: adapter.id,
          candidateCatalogFingerprint: observation.candidateCatalogFingerprint,
          rankedCandidateIds: observation.rankedCandidateIds,
          latencyMs: observation.latencyMs,
          ...(observation.providerCalls !== undefined ? { providerCalls: observation.providerCalls } : {}),
          ...(observation.braveCalls !== undefined ? { braveCalls: observation.braveCalls } : {}),
          ...(observation.modelCalls !== undefined ? { modelCalls: observation.modelCalls } : {}),
          ...(observation.cacheHits !== undefined ? { cacheHits: observation.cacheHits } : {}),
          ...(observation.cacheMisses !== undefined ? { cacheMisses: observation.cacheMisses } : {}),
          ...(observation.estimatedCostPerSearch !== undefined ? { estimatedCostPerSearch: observation.estimatedCostPerSearch } : {}),
          ...(observation.firstPassSuccess !== undefined ? { firstPassSuccess: observation.firstPassSuccess } : {}),
          ...(observation.secondPassAttempted !== undefined ? { secondPassAttempted: observation.secondPassAttempted } : {}),
          ...(observation.secondPassRecovery !== undefined ? { secondPassRecovery: observation.secondPassRecovery } : {}),
          ...(independentReview ? { review: independentReview } : {}),
        });
      } catch (error) {
        const measurements = error instanceof BenchmarkAdapterCallError ? error.measurements : {};
        errors.push({
          caseId: benchmarkCase.id,
          message: error instanceof BenchmarkAdapterCallError
            ? "BENCHMARK_ADAPTER_CALL_FAILED"
            : "ADAPTER_CALL_FAILED",
          latencyMs: Math.max(0, Date.now() - startedAt),
          ...(measurements.providerCalls !== undefined ? { providerCalls: measurements.providerCalls } : {}),
          ...(measurements.braveCalls !== undefined ? { braveCalls: measurements.braveCalls } : {}),
          ...(measurements.modelCalls !== undefined ? { modelCalls: measurements.modelCalls } : {}),
          ...(measurements.cacheHits !== undefined ? { cacheHits: measurements.cacheHits } : {}),
          ...(measurements.cacheMisses !== undefined ? { cacheMisses: measurements.cacheMisses } : {}),
          ...(measurements.estimatedCostPerSearch !== undefined ? { estimatedCostPerSearch: measurements.estimatedCostPerSearch } : {}),
        });
      }
    }
    return summarizeVersion(cases, observations, fingerprint!, catalogIds, errors);
  };

  if (input.geminiV3 && input.geminiV3.version !== "gemini-v3") {
    throw new Error(`Expected a Gemini V3 adapter, received ${input.geminiV3.version}`);
  }
  const [v2, v3, geminiV3] = await Promise.all([
    execute(input.v2, "v2"),
    execute(input.v3, "v3"),
    execute(input.geminiV3, "gemini-v3"),
  ]);
  return {
    benchmark: "LUQTA Search V2 vs local V3 vs Gemini V3 real-image",
    generatedAt: new Date().toISOString(),
    candidateCatalogFingerprint: unavailableCatalogReason ? null : fingerprint!,
    imageCases: cases.length,
    provenance: "Static Wikimedia Commons metadata snapshot; remote images are not downloaded by this runner.",
    v2,
    v3,
    geminiV3,
    limitations: [
      "The manifest contains public Commons thumbnails with recorded attribution/license metadata; the runner never fetches images.",
      "A reference image counts only with independently identified image-verification evidence tied to the exact manifest URL; adapter boolean assertions are not sufficient.",
      "Commons file titles are source labels, not independently inspected or adjudicated visual ground truth.",
      "No candidate catalog, product ground truth, or image-capable model is bundled. Missing adapters/catalog yield unavailable metrics, never synthetic scores.",
      "For a valid paired comparison, pass the same real candidate catalog and fingerprint to both adapters and echo that fingerprint in every observation.",
      "Quality metrics require independent reviewer IDs, review of every candidate in the shared catalog, matching catalog fingerprints, and relevance labels for every catalog ID. Missing evidence yields partial/unavailable quality metrics.",
      "Adapters must instrument provider, Brave, model calls and cost. Uninstrumented values are null rather than assumed zero.",
      "Cache hit/miss counters and errors are reported only when supplied/measured; failed calls are listed and make aggregate call/cost totals unavailable.",
      "Gemini V3 is strictly opt-in through an explicitly injected adapter. This runner performs no key fallback, credential discovery, or implicit Gemini import.",
      "New automotive, app-screenshot, and multi-object entries are prompt-only source-title representatives, not independently validated visual scenarios. No validated low-quality, automotive OEM, or genuine shopping screenshot case is bundled.",
    ],
  };
}

/** JSON-ready metrics are explicit nulls when the evidence is unavailable. */
export function renderRealWorldReportJson(report: RealWorldBenchmarkReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function unavailableRealWorldReport(): RealWorldBenchmarkReport {
  const reportCases = REAL_WORLD_IMAGE_CASES;
  return {
    benchmark: "LUQTA Search V2 vs local V3 vs Gemini V3 real-image",
    generatedAt: new Date().toISOString(),
    candidateCatalogFingerprint: null,
    imageCases: reportCases.length,
    provenance: "Static Wikimedia Commons metadata snapshot; remote images are not downloaded by this runner.",
    v2: emptyVersion(reportCases, "No real candidate catalog or V2 search adapter was configured."),
    v3: emptyVersion(reportCases, "No real candidate catalog or V3 search adapter was configured."),
    geminiV3: emptyVersion(reportCases, "Gemini V3 is opt-in and no explicit adapter was injected."),
    limitations: [
      "This no-configuration report is a capability/status export, not a search evaluation.",
      "No real candidate catalog or image-capable model was bundled or called; quality and retrieval rates are unavailable.",
      "Pass real adapters and the exact same candidate catalog to runRealWorldBenchmark for a paired run.",
    ],
  };
}