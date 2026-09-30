import { open, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  loadFrozenCases,
  reportEvaluation,
  type CandidateJudgment,
  type CaseJudgment,
  type ReplayObservation,
} from "./harness";

const EXPECTED_CASE_COUNT = 40;
const EXPECTED_CANDIDATE_OCCURRENCES = 462;
const VALID_LABELS = new Set<CandidateJudgment>([
  "EXACT", "RELEVANT", "IRRELEVANT", "UNVERIFIABLE", "ABSTAIN",
]);
const VALID_COVERAGE = new Set(["JUDGED", "ABSTAINED"]);
const VALID_INVENTORY = new Set(["found", "none", "unknown"]);

type JudgmentsDocument = {
  schemaVersion: number;
  source?: string;
  judgments: CaseJudgment[];
};

export type ScoreValidationSummary = {
  caseCount: number;
  candidateOccurrences: number;
  judgedOccurrences: number;
  uniqueObservationIdsAcrossCases: number;
  repeatedObservationIdsAcrossCases: number;
  inventoryAvailabilityCounts: { found: number; none: number; unknown: number };
};

type ValidationOptions = {
  expectedCaseCount?: number;
  expectedCandidateOccurrences?: number;
  expectedCaseIds?: readonly string[];
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertUniqueValues(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    assert(typeof value === "string" && value.trim().length > 0, `${label} contains an empty or invalid ID.`);
    assert(!seen.has(value), `${label} contains duplicate ID ${value}.`);
    seen.add(value);
  }
}

/** Validates case-local ID coverage; the same stable observation may recur in different cases. */
export function validateScoreInputs(
  observations: readonly ReplayObservation[],
  judgments: readonly CaseJudgment[],
  options: ValidationOptions = {},
): ScoreValidationSummary {
  const expectedCaseCount = options.expectedCaseCount ?? EXPECTED_CASE_COUNT;
  assert(observations.length === expectedCaseCount,
    `Expected exactly ${expectedCaseCount} observations, received ${observations.length}.`);
  assert(judgments.length === observations.length,
    `Expected one judgment per case (${observations.length}), received ${judgments.length}.`);

  const observationCaseIds = observations.map((item) => item.caseId);
  const judgmentCaseIds = judgments.map((item) => item.caseId);
  assertUniqueValues(observationCaseIds, "Observations");
  assertUniqueValues(judgmentCaseIds, "Judgments");

  const expectedCaseIds = options.expectedCaseIds
    ? new Set(options.expectedCaseIds)
    : undefined;
  if (expectedCaseIds) {
    assertUniqueValues(options.expectedCaseIds ?? [], "Frozen corpus");
    const observationIds = new Set(observationCaseIds);
    const foreign = [...observationIds].filter((caseId) => !expectedCaseIds.has(caseId));
    const missing = [...expectedCaseIds].filter((caseId) => !observationIds.has(caseId));
    assert(!foreign.length && !missing.length,
      `Case IDs differ from frozen corpus; missing=[${missing.join(",")}], foreign=[${foreign.join(",")}].`);
  }

  const judgmentsByCase = new Map(judgments.map((item) => [item.caseId, item]));
  const inventoryAvailabilityCounts = { found: 0, none: 0, unknown: 0 };
  const occurrenceCounts = new Map<string, number>();
  let candidateOccurrences = 0;
  let judgedOccurrences = 0;

  for (const observation of observations) {
    const caseId = observation.caseId;
    const judgment = judgmentsByCase.get(caseId);
    assert(judgment, `Missing judgment for case ${caseId}.`);
    assert(VALID_COVERAGE.has(judgment.coverage),
      `Case ${caseId} has invalid coverage ${String(judgment.coverage)}.`);
    const inventory = judgment.inventoryAvailabilityAssessment;
    assert(typeof inventory === "string" && VALID_INVENTORY.has(inventory),
      `Case ${caseId} must explicitly label inventoryAvailabilityAssessment as found, none, or unknown.`);
    inventoryAvailabilityCounts[inventory as keyof typeof inventoryAvailabilityCounts] += 1;

    const baselineIds = observation.baseline.map((candidate) => candidate.observationId);
    const identityIds = observation.identityAware.map((candidate) => candidate.observationId);
    assertUniqueValues(baselineIds, `Baseline candidates for case ${caseId}`);
    assertUniqueValues(identityIds, `Identity-aware candidates for case ${caseId}`);
    assertUniqueValues(observation.decisions.map((decision) => decision.observationId),
      `Decision observations for case ${caseId}`);
    const baselineSet = new Set(baselineIds);
    const identitySet = new Set(identityIds);
    const missingIdentity = baselineIds.filter((id) => !identitySet.has(id));
    const extraIdentity = identityIds.filter((id) => !baselineSet.has(id));
    assert(!missingIdentity.length && !extraIdentity.length,
      `Candidate cohort differs between arms for case ${caseId}.`);
    const decisionIds = observation.decisions.map((decision) => decision.observationId);
    const missingDecisions = baselineIds.filter((id) => !decisionIds.includes(id));
    const foreignDecisions = decisionIds.filter((id) => !baselineSet.has(id));
    assert(!missingDecisions.length && !foreignDecisions.length,
      `Decision IDs differ from candidate IDs for case ${caseId}.`);

    const judgmentMap = judgment.candidateJudgments;
    assert(isObject(judgmentMap), `Case ${caseId} candidateJudgments must be an object.`);
    const judgmentIds = Object.keys(judgmentMap);
    const candidateSet = new Set(baselineIds);
    const missing = baselineIds.filter((id) => !Object.hasOwn(judgmentMap, id));
    const foreign = judgmentIds.filter((id) => !candidateSet.has(id));
    assert(!missing.length && !foreign.length,
      `Candidate judgment IDs differ for case ${caseId}; missing=[${missing.join(",")}], foreign=[${foreign.join(",")}].`);
    for (const observationId of baselineIds) {
      const label = judgmentMap[observationId];
      assert(typeof label === "string" && VALID_LABELS.has(label as CandidateJudgment),
        `Invalid or missing label for observation ${observationId} in case ${caseId}.`);
      if (judgment.coverage === "ABSTAINED") {
        assert(label === "ABSTAIN",
          `ABSTAINED case ${caseId} contains non-ABSTAIN label for ${observationId}.`);
      }
      judgedOccurrences += 1;
      occurrenceCounts.set(observationId, (occurrenceCounts.get(observationId) ?? 0) + 1);
    }
    candidateOccurrences += baselineIds.length;

    assert(observation.sourceAvailability &&
      Number.isInteger(observation.sourceAvailability.resultCount) &&
      observation.sourceAvailability.resultCount >= 0,
    `Case ${caseId} has invalid source resultCount.`);
    assert(Number.isFinite(observation.durationMs) && observation.durationMs >= 0,
      `Case ${caseId} has invalid replay duration.`);
    for (const decision of observation.decisions) {
      assert(baselineSet.has(decision.observationId),
        `Decision for case ${caseId} contains foreign observation ID ${decision.observationId}.`);
      assert(decision.assertedExactByArm.baseline === false,
        `Baseline asserted EXACT state must remain unmeasured/false in case ${caseId}.`);
    }
  }

  assert(candidateOccurrences === judgedOccurrences,
    `Expected every candidate occurrence to be judged (${candidateOccurrences}), received ${judgedOccurrences}.`);
  if (options.expectedCandidateOccurrences !== undefined) {
    assert(candidateOccurrences === options.expectedCandidateOccurrences,
      `Expected ${options.expectedCandidateOccurrences} candidate observations, received ${candidateOccurrences}.`);
  }

  const uniqueObservationIdsAcrossCases = occurrenceCounts.size;
  return {
    caseCount: observations.length,
    candidateOccurrences,
    judgedOccurrences,
    uniqueObservationIdsAcrossCases,
    repeatedObservationIdsAcrossCases: candidateOccurrences - uniqueObservationIdsAcrossCases,
    inventoryAvailabilityCounts,
  };
}

function isRelevant(label: CandidateJudgment | undefined): boolean {
  return label === "EXACT" || label === "RELEVANT";
}

type RankedLabel = {
  observationId: string;
  label: CandidateJudgment;
};

function rankedLabels(
  observation: ReplayObservation,
  judgment: CaseJudgment,
  arm: "baseline" | "identityAware",
  limit: number,
): RankedLabel[] {
  return observation[arm].slice(0, limit).map((candidate) => ({
    observationId: candidate.observationId,
    label: judgment.candidateJudgments[candidate.observationId],
  }));
}

export type PairedLabelChanges = {
  top1: {
    eligibleCases: number;
    candidateChangedCases: number;
    labelChangedCases: number;
    relevanceRegressions: number;
    relevanceImprovements: number;
    regressionCaseIds: string[];
    improvementCaseIds: string[];
  };
  top5: {
    eligibleCases: number;
    membershipChangedCases: number;
    rankLabelChangedCases: number;
    relevanceRegressions: number;
    relevanceImprovements: number;
    regressionCaseIds: string[];
    improvementCaseIds: string[];
  };
  perCase: Array<{
    caseId: string;
    inventoryAvailabilityAssessment: "found" | "none" | "unknown";
    coverage: "JUDGED" | "ABSTAINED";
    top1: {
      baseline: RankedLabel | null;
      identityAware: RankedLabel | null;
      candidateChanged: boolean;
      labelChanged: boolean;
      evaluationEligible: boolean;
      relevanceRegression: boolean;
      relevanceImprovement: boolean;
    };
    top5: {
      baseline: RankedLabel[];
      identityAware: RankedLabel[];
      entrants: RankedLabel[];
      exits: RankedLabel[];
      membershipChanged: boolean;
      rankLabelChanged: boolean;
      baselineRelevantCount: number;
      identityAwareRelevantCount: number;
      relevantCountDelta: number;
      baselineSuccess: boolean;
      identityAwareSuccess: boolean;
      evaluationEligible: boolean;
      relevanceRegression: boolean;
      relevanceImprovement: boolean;
    };
  }>;
};

/** Extracts paired rank-label shifts without treating unsupported assertions as labels. */
export function extractPairedLabelChanges(
  observations: readonly ReplayObservation[],
  judgments: readonly CaseJudgment[],
): PairedLabelChanges {
  const judgmentsByCase = new Map(judgments.map((item) => [item.caseId, item]));
  const top1 = {
    eligibleCases: 0,
    candidateChangedCases: 0,
    labelChangedCases: 0,
    relevanceRegressions: 0,
    relevanceImprovements: 0,
    regressionCaseIds: [] as string[],
    improvementCaseIds: [] as string[],
  };
  const top5 = {
    eligibleCases: 0,
    membershipChangedCases: 0,
    rankLabelChangedCases: 0,
    relevanceRegressions: 0,
    relevanceImprovements: 0,
    regressionCaseIds: [] as string[],
    improvementCaseIds: [] as string[],
  };
  const perCase = observations.map((observation) => {
    const judgment = judgmentsByCase.get(observation.caseId)!;
    const inventory = judgment.inventoryAvailabilityAssessment ?? "unknown";
    const baselineTop1 = rankedLabels(observation, judgment, "baseline", 1)[0] ?? null;
    const identityTop1 = rankedLabels(observation, judgment, "identityAware", 1)[0] ?? null;
    const top1CandidateChanged = baselineTop1?.observationId !== identityTop1?.observationId;
    const top1LabelChanged = baselineTop1?.label !== identityTop1?.label;
    if (top1CandidateChanged) top1.candidateChangedCases += 1;
    if (top1LabelChanged) top1.labelChangedCases += 1;
    const top1Eligible = judgment.coverage === "JUDGED" && inventory === "found" &&
      baselineTop1 !== null && identityTop1 !== null &&
      baselineTop1.label !== "ABSTAIN" && identityTop1.label !== "ABSTAIN";
    const top1Regression = top1Eligible &&
      isRelevant(baselineTop1?.label) && !isRelevant(identityTop1?.label);
    const top1Improvement = top1Eligible &&
      !isRelevant(baselineTop1?.label) && isRelevant(identityTop1?.label);
    if (top1Eligible) top1.eligibleCases += 1;
    if (top1Regression) {
      top1.relevanceRegressions += 1;
      top1.regressionCaseIds.push(observation.caseId);
    }
    if (top1Improvement) {
      top1.relevanceImprovements += 1;
      top1.improvementCaseIds.push(observation.caseId);
    }

    const baselineTop5 = rankedLabels(observation, judgment, "baseline", 5);
    const identityTop5 = rankedLabels(observation, judgment, "identityAware", 5);
    const baselineIds = new Set(baselineTop5.map((candidate) => candidate.observationId));
    const identityIds = new Set(identityTop5.map((candidate) => candidate.observationId));
    const entrants = identityTop5.filter((candidate) => !baselineIds.has(candidate.observationId));
    const exits = baselineTop5.filter((candidate) => !identityIds.has(candidate.observationId));
    const membershipChanged = entrants.length > 0 || exits.length > 0;
    const rankLabelChanged = baselineTop5.length !== identityTop5.length || baselineTop5.some((candidate, index) =>
      candidate.label !== identityTop5[index]?.label,
    );
    if (membershipChanged) top5.membershipChangedCases += 1;
    if (rankLabelChanged) top5.rankLabelChangedCases += 1;
    const baselineRelevantCount = baselineTop5.filter((candidate) => isRelevant(candidate.label)).length;
    const identityRelevantCount = identityTop5.filter((candidate) => isRelevant(candidate.label)).length;
    const baselineSuccess = baselineRelevantCount > 0;
    const identitySuccess = identityRelevantCount > 0;
    const top5Eligible = judgment.coverage === "JUDGED" && inventory === "found" &&
      baselineTop5.length > 0 && identityTop5.length > 0 &&
      baselineTop5.every((candidate) => candidate.label !== "ABSTAIN") &&
      identityTop5.every((candidate) => candidate.label !== "ABSTAIN");
    const top5Regression = top5Eligible && baselineSuccess && !identitySuccess;
    const top5Improvement = top5Eligible && !baselineSuccess && identitySuccess;
    if (top5Eligible) top5.eligibleCases += 1;
    if (top5Regression) {
      top5.relevanceRegressions += 1;
      top5.regressionCaseIds.push(observation.caseId);
    }
    if (top5Improvement) {
      top5.relevanceImprovements += 1;
      top5.improvementCaseIds.push(observation.caseId);
    }

    return {
      caseId: observation.caseId,
      inventoryAvailabilityAssessment: inventory,
      coverage: judgment.coverage,
      top1: {
        baseline: baselineTop1,
        identityAware: identityTop1,
        candidateChanged: top1CandidateChanged,
        labelChanged: top1LabelChanged,
        evaluationEligible: top1Eligible,
        relevanceRegression: top1Regression,
        relevanceImprovement: top1Improvement,
      },
      top5: {
        baseline: baselineTop5,
        identityAware: identityTop5,
        entrants,
        exits,
        membershipChanged,
        rankLabelChanged,
        baselineRelevantCount,
        identityAwareRelevantCount: identityRelevantCount,
        relevantCountDelta: identityRelevantCount - baselineRelevantCount,
        baselineSuccess,
        identityAwareSuccess: identitySuccess,
        evaluationEligible: top5Eligible,
        relevanceRegression: top5Regression,
        relevanceImprovement: top5Improvement,
      },
    };
  });
  return { top1, top5, perCase };
}

function distribution(values: readonly number[]) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, min: null, median: null, p90: null, p95: null, max: null, mean: null };
  const percentile = (p: number) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
  return {
    count: sorted.length,
    min: sorted[0],
    median: percentile(0.5),
    p90: percentile(0.9),
    p95: percentile(0.95),
    max: sorted[sorted.length - 1],
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
  };
}

function countValues(values: readonly (string | undefined)[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    const key = value ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function summarizeAvailability(observations: readonly ReplayObservation[]) {
  const readinessSourceCopies = observations.flatMap((observation) =>
    observation.sourceAvailability.readinessPreflight?.sources ?? [],
  );
  const readinessSources = [...new Map(readinessSourceCopies.map((source) => [
    source.providerId,
    source,
  ])).values()];
  const runtimeProviders = observations.flatMap((observation) => observation.sourceAvailability.providers);
  const perProvider = new Map<string, {
    timingsMs: number[];
    calls: number;
    timeouts: number;
    errors: number;
    unready: number;
  }>();
  for (const provider of runtimeProviders) {
    const providerId = typeof provider.providerId === "string" ? provider.providerId : "unknown-provider";
    const item = perProvider.get(providerId) ?? { timingsMs: [], calls: 0, timeouts: 0, errors: 0, unready: 0 };
    item.calls += 1;
    if (typeof provider.durationMs === "number" && Number.isFinite(provider.durationMs)) {
      item.timingsMs.push(provider.durationMs);
    }
    if (provider.timedOut === true) item.timeouts += 1;
    if (provider.errorType) item.errors += 1;
    if (provider.ready === false || provider.refreshing === true) item.unready += 1;
    perProvider.set(providerId, item);
  }
  return {
    partialCoverageCases: observations.filter((item) => item.sourceAvailability.partialCoverage).length,
    casesWithFailures: observations.filter((item) => item.sourceAvailability.failures.length > 0).length,
    totalProviderFailures: observations.reduce((sum, item) =>
      sum + item.sourceAvailability.failures.length, 0),
    fallbackStatusCounts: countValues(observations.map((item) => item.sourceAvailability.fallbackStatus)),
    resultCount: distribution(observations.map((item) => item.sourceAvailability.resultCount)),
    readinessStatusCounts: countValues(readinessSources.map((item) => item.status)),
    readinessReportCaseCount: observations.filter((item) =>
      item.sourceAvailability.readinessPreflight !== undefined,
    ).length,
    readinessSourceCopies: readinessSourceCopies.length,
    uniqueReadinessProviders: readinessSources.length,
    runtimeReadinessCounts: {
      ready: runtimeProviders.filter((item) => item.ready === true).length,
      unready: runtimeProviders.filter((item) => item.ready === false || item.refreshing === true).length,
      unknown: runtimeProviders.filter((item) =>
        item.ready !== true && item.ready !== false && item.refreshing !== true,
      ).length,
    },
    readinessWaitMs: distribution(readinessSources.map((item) => item.waitMs).filter(Number.isFinite)),
    runtimeProviderCalls: runtimeProviders.length,
    runtimeProviderDurationMs: distribution(runtimeProviders
      .map((item) => item.durationMs)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value))),
    providers: [...perProvider].map(([providerId, item]) => ({
      providerId,
      calls: item.calls,
      timeouts: item.timeouts,
      errors: item.errors,
      unready: item.unready,
      durationMs: distribution(item.timingsMs),
    })).sort((a, b) => a.providerId.localeCompare(b.providerId)),
  };
}

function exactAtRank1(
  observations: readonly ReplayObservation[],
  judgments: readonly CaseJudgment[],
  arm: "baseline" | "identityAware",
) {
  const judgmentsByCase = new Map(judgments.map((item) => [item.caseId, item]));
  let denominator = 0;
  let exactCount = 0;
  for (const observation of observations) {
    const judgment = judgmentsByCase.get(observation.caseId)!;
    if (judgment.coverage !== "JUDGED" ||
        judgment.inventoryAvailabilityAssessment !== "found") continue;
    const top = observation[arm][0];
    if (!top) continue;
    const label = judgment.candidateJudgments[top.observationId];
    if (label === undefined || label === "ABSTAIN") continue;
    denominator += 1;
    if (label === "EXACT") exactCount += 1;
  }
  return {
    exactCount,
    denominator,
    rate: denominator ? exactCount / denominator : null,
    eligibility: "found inventory, JUDGED case, and non-ABSTAIN rank-1 label",
  };
}

type IrrelevantRateSummary = {
  irrelevantCount: number;
  denominator: number;
  rate: number | null;
  eligibleCaseCount: number;
  includedLabelCounts: {
    EXACT: number;
    RELEVANT: number;
    IRRELEVANT: number;
    UNVERIFIABLE: number;
  };
};

function irrelevantRateSummary(
  observations: readonly ReplayObservation[],
  judgments: readonly CaseJudgment[],
  arm: "baseline" | "identityAware",
  options: { topFiveOnly: boolean; foundInventoryOnly: boolean; excludeUnverifiable: boolean },
): IrrelevantRateSummary {
  const judgmentsByCase = new Map(judgments.map((item) => [item.caseId, item]));
  const includedLabelCounts = { EXACT: 0, RELEVANT: 0, IRRELEVANT: 0, UNVERIFIABLE: 0 };
  let eligibleCaseCount = 0;
  for (const observation of observations) {
    const judgment = judgmentsByCase.get(observation.caseId);
    if (!judgment || judgment.coverage !== "JUDGED") continue;
    if (options.foundInventoryOnly && judgment.inventoryAvailabilityAssessment !== "found") continue;
    const candidates = options.topFiveOnly
      ? observation[arm].slice(0, 5)
      : observation[arm];
    let caseHasIncludedLabels = false;
    for (const candidate of candidates) {
      const label = judgment.candidateJudgments[candidate.observationId];
      if (label === "ABSTAIN" || label === undefined) continue;
      if (label === "UNVERIFIABLE") {
        if (options.excludeUnverifiable) continue;
        includedLabelCounts.UNVERIFIABLE += 1;
        caseHasIncludedLabels = true;
        continue;
      }
      if (label === "EXACT" || label === "RELEVANT" || label === "IRRELEVANT") {
        includedLabelCounts[label] += 1;
        caseHasIncludedLabels = true;
      }
    }
    if (caseHasIncludedLabels) eligibleCaseCount += 1;
  }
  const denominator = includedLabelCounts.EXACT +
    includedLabelCounts.RELEVANT +
    includedLabelCounts.IRRELEVANT +
    includedLabelCounts.UNVERIFIABLE;
  return {
    irrelevantCount: includedLabelCounts.IRRELEVANT,
    denominator,
    rate: denominator ? includedLabelCounts.IRRELEVANT / denominator : null,
    eligibleCaseCount,
    includedLabelCounts,
  };
}

export function buildMetricsReport(
  observations: readonly ReplayObservation[],
  judgments: readonly CaseJudgment[],
  validation: ScoreValidationSummary,
  judgmentSource?: string,
) {
  const evaluation = reportEvaluation(observations, judgments);
  const baselineExactAtRank1 = exactAtRank1(observations, judgments, "baseline");
  const identityExactAtRank1 = exactAtRank1(observations, judgments, "identityAware");
  const pairedLabelChanges = extractPairedLabelChanges(observations, judgments);
  const sourceAvailability = summarizeAvailability(observations);
  const allCandidateIrrelevantRate = {
    eligibility: "all ranks in JUDGED cases; ABSTAIN excluded, UNVERIFIABLE included",
    baseline: irrelevantRateSummary(observations, judgments, "baseline", {
      topFiveOnly: false,
      foundInventoryOnly: false,
      excludeUnverifiable: false,
    }),
    identityAware: irrelevantRateSummary(observations, judgments, "identityAware", {
      topFiveOnly: false,
      foundInventoryOnly: false,
      excludeUnverifiable: false,
    }),
  };
  const topFiveIrrelevantRate = {
    allJudged: {
      eligibility: "top-five labels in JUDGED cases; ABSTAIN and UNVERIFIABLE excluded",
      baseline: irrelevantRateSummary(observations, judgments, "baseline", {
        topFiveOnly: true,
        foundInventoryOnly: false,
        excludeUnverifiable: true,
      }),
      identityAware: irrelevantRateSummary(observations, judgments, "identityAware", {
        topFiveOnly: true,
        foundInventoryOnly: false,
        excludeUnverifiable: true,
      }),
    },
    foundInventoryOnly: {
      eligibility: "top-five labels in JUDGED cases with inventory assessment found; ABSTAIN and UNVERIFIABLE excluded",
      baseline: irrelevantRateSummary(observations, judgments, "baseline", {
        topFiveOnly: true,
        foundInventoryOnly: true,
        excludeUnverifiable: true,
      }),
      identityAware: irrelevantRateSummary(observations, judgments, "identityAware", {
        topFiveOnly: true,
        foundInventoryOnly: true,
        excludeUnverifiable: true,
      }),
    },
  };
  return {
    schemaVersion: 1,
    inputFiles: { observations: "observations.json", judgments: "judgments.json" },
    validation,
    judgmentSource: judgmentSource ?? null,
    inventorySemantics: {
      assessmentSource: "judgments.json inventoryAvailabilityAssessment",
      assessmentsUsedVerbatim: true,
      unknownIsNeverInferredAsNone: true,
      emptyReplayResultsDoNotEstablishNone: true,
      rankingDenominatorsRequireFoundInventory: true,
    },
    metrics: {
      ...evaluation,
      allCandidateIrrelevantRate,
      topFiveIrrelevantRate,
      independentlyLabeledExactAtRank1: {
        baseline: baselineExactAtRank1,
        identityAware: identityExactAtRank1,
      },
      assertedExactFalseRate: {
        baseline: {
          rate: null,
          denominator: 0,
          status: "NOT_MEASURED_BASELINE_ARM_DOES_NOT_ASSERT_EXACT",
        },
        identityAware: {
          rate: evaluation.identityAware.falseExactRate,
          denominator: evaluation.identityAware.falseExactRateDenominator,
          status: evaluation.identityAware.falseExactRateDenominator
            ? "MEASURED"
            : "NOT_MEASURED_NO_ADJUDICATED_ASSERTIONS",
        },
      },
    },
    pairedLabelChanges,
    sourceAvailability,
    latencyMs: {
      replayByCase: distribution(observations.map((item) => item.durationMs)),
      providerCalls: distribution(observations.flatMap((observation) =>
        observation.sourceAvailability.providers
          .map((provider) => provider.durationMs)
          .filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
      )),
      preflightWaitBySource: sourceAvailability.readinessWaitMs,
    },
    historicalRecoveryContext: {
      status: "CONTEXT_ONLY_NOT_POOLED",
      note: "Historical Recovery rates are context only and are not combined with this replay's independently judged metrics.",
    },
  };
}

async function writeExclusive(path: string, content: string): Promise<void> {
  const file = await open(path, "wx");
  try {
    await file.writeFile(content, "utf8");
  } finally {
    await file.close();
  }
}

export async function scoreDirectory(directory: string): Promise<{
  outputPath: string;
  report: ReturnType<typeof buildMetricsReport>;
}> {
  const outputDirectory = resolve(directory);
  const [observationsText, judgmentsText, frozenCases] = await Promise.all([
    readFile(resolve(outputDirectory, "observations.json"), "utf8"),
    readFile(resolve(outputDirectory, "judgments.json"), "utf8"),
    loadFrozenCases(),
  ]);
  const parsedObservations: unknown = JSON.parse(observationsText);
  const parsedJudgments: unknown = JSON.parse(judgmentsText);
  assert(Array.isArray(parsedObservations), "observations.json must contain an array.");
  assert(isObject(parsedJudgments), "judgments.json must be a wrapper object.");
  assert(parsedJudgments.schemaVersion === 1, "judgments.json must have schemaVersion 1.");
  assert(Array.isArray(parsedJudgments.judgments), "judgments.json must contain a judgments array.");
  const observations = parsedObservations as ReplayObservation[];
  const wrapper = parsedJudgments as unknown as JudgmentsDocument;
  const judgments = wrapper.judgments;
  const validation = validateScoreInputs(observations, judgments, {
    expectedCaseCount: EXPECTED_CASE_COUNT,
    expectedCandidateOccurrences: EXPECTED_CANDIDATE_OCCURRENCES,
    expectedCaseIds: frozenCases.map((item) => item.id),
  });
  const report = buildMetricsReport(observations, judgments, validation, wrapper.source);
  const outputPath = resolve(outputDirectory, "metrics.json");
  await writeExclusive(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  return { outputPath, report };
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  let directory: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--dir" && !directory && args[index + 1]) {
      directory = args[index + 1];
      index += 1;
    } else {
      throw new Error("Unknown or duplicate CLI arguments.");
    }
  }
  if (!directory) throw new Error("Usage: tsx score-cli.ts --dir <existing-replay-directory>.");
  const result = await scoreDirectory(directory);
  const baselineExact = result.report.metrics.independentlyLabeledExactAtRank1.baseline;
  const identityExact = result.report.metrics.independentlyLabeledExactAtRank1.identityAware;
  console.log(`Scored ${result.report.validation.caseCount} cases / ${result.report.validation.judgedOccurrences} candidate judgments.`);
  console.log(`Independent EXACT@1: baseline ${baselineExact.exactCount}/${baselineExact.denominator}; identity-aware ${identityExact.exactCount}/${identityExact.denominator}.`);
  console.log(`Top-1 relevance regressions: ${result.report.pairedLabelChanges.top1.relevanceRegressions}; top-5 regressions: ${result.report.pairedLabelChanges.top5.relevanceRegressions}.`);
  console.log(`Metrics written to ${result.outputPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Replay scoring failed.");
    process.exitCode = 1;
  });
}