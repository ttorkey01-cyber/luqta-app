import assert from "node:assert/strict";
import { test } from "node:test";
import type { CaseJudgment, ReplayObservation } from "./harness";
import {
  buildMetricsReport,
  extractPairedLabelChanges,
  validateScoreInputs,
} from "./score-cli";

function makeObservation(
  caseId: string,
  baselineIds: string[],
  identityIds = baselineIds,
): ReplayObservation {
  const candidates = (ids: string[]) => ids.map((observationId, index) => ({
    observationId,
    rank: index + 1,
    title: observationId,
    variant: {},
    source: {},
    identityRecord: { id: observationId, title: observationId },
  }));
  const baseline = candidates(baselineIds);
  const identityAware = candidates(identityIds);
  return {
    caseId,
    query: "fixture",
    durationMs: 10,
    sourceAvailability: {
      resultCount: baseline.length,
      partialCoverage: false,
      coverageNotes: [],
      providers: [],
      failures: [],
    },
    trace: [],
    baseline,
    identityAware,
    decisions: baseline.map((candidate) => ({
      observationId: candidate.observationId,
      baselineRank: candidate.rank,
      identityRank: identityAware.findIndex((item) => item.observationId === candidate.observationId) + 1,
      queryIdentity: { assertion: "NO_EXACT", status: "ABSTAIN", evidence: [], reasons: [] },
      assertedExactByArm: { baseline: false, identityAware: false },
      pairwiseComparisons: [],
    })),
    groups: [],
  } as ReplayObservation;
}

function makeJudgment(
  caseId: string,
  candidateJudgments: Record<string, CaseJudgment["candidateJudgments"][string]>,
  options: Partial<CaseJudgment> = {},
): CaseJudgment {
  return {
    caseId,
    candidateJudgments,
    coverage: "JUDGED",
    inventoryAvailabilityAssessment: "found",
    ...options,
  };
}

test("score coverage accepts every per-case ID exactly once and keeps unknown inventory unknown", () => {
  const observations = [
    makeObservation("case-1", ["same-id", "other-id"]),
    makeObservation("case-2", ["same-id"]),
  ];
  const judgments = [
    makeJudgment("case-1", { "same-id": "EXACT", "other-id": "IRRELEVANT" }),
    makeJudgment("case-2", { "same-id": "ABSTAIN" }, {
      coverage: "ABSTAINED",
      inventoryAvailabilityAssessment: "unknown",
    }),
  ];
  const summary = validateScoreInputs(observations, judgments, {
    expectedCaseCount: 2,
    expectedCandidateOccurrences: 3,
    expectedCaseIds: ["case-1", "case-2"],
  });
  assert.equal(summary.candidateOccurrences, 3);
  assert.equal(summary.judgedOccurrences, 3);
  assert.equal(summary.uniqueObservationIdsAcrossCases, 2);
  assert.equal(summary.repeatedObservationIdsAcrossCases, 1);
  assert.deepEqual(summary.inventoryAvailabilityCounts, { found: 1, none: 0, unknown: 1 });
});

test("score coverage rejects duplicate and foreign observation IDs", () => {
  const duplicate = makeObservation("case-1", ["same-id", "same-id"]);
  assert.throws(
    () => validateScoreInputs(
      [duplicate],
      [makeJudgment("case-1", { "same-id": "EXACT" })],
      { expectedCaseCount: 1 },
    ),
    /duplicate ID same-id/,
  );

  const observation = makeObservation("case-1", ["expected-id"]);
  assert.throws(
    () => validateScoreInputs(
      [observation],
      [makeJudgment("case-1", { foreign: "EXACT" })],
      { expectedCaseCount: 1 },
    ),
    /missing=\[expected-id\], foreign=\[foreign\]/,
  );
});

test("paired top-1 and top-5 extraction identifies regressions from independent labels", () => {
  const ids = ["exact", "b", "c", "d", "e", "f"];
  const observation = makeObservation("case-regression", ids, ["b", "c", "d", "e", "f", "exact"]);
  const judgment = makeJudgment("case-regression", {
    exact: "EXACT",
    b: "IRRELEVANT",
    c: "UNVERIFIABLE",
    d: "IRRELEVANT",
    e: "IRRELEVANT",
    f: "IRRELEVANT",
  });
  const paired = extractPairedLabelChanges([observation], [judgment]);
  const caseResult = paired.perCase[0];
  assert.equal(caseResult.top1.relevanceRegression, true);
  assert.equal(caseResult.top1.evaluationEligible, true);
  assert.equal(caseResult.top5.membershipChanged, true);
  assert.deepEqual(caseResult.top5.exits.map((item) => item.observationId), ["exact"]);
  assert.deepEqual(caseResult.top5.entrants.map((item) => item.observationId), ["f"]);
  assert.equal(caseResult.top5.baselineSuccess, true);
  assert.equal(caseResult.top5.identityAwareSuccess, false);
  assert.equal(caseResult.top5.relevanceRegression, true);
  assert.deepEqual(paired.top1.regressionCaseIds, ["case-regression"]);
  assert.deepEqual(paired.top5.regressionCaseIds, ["case-regression"]);
});

test("top-five irrelevant rates exclude abstentions and unverifiable labels and separate found inventory", () => {
  const firstIds = ["a", "b", "c", "d", "e", "f"];
  const secondIds = ["g", "h", "i", "j", "k", "m"];
  const observations = [
    makeObservation("found-case", firstIds, ["f", "a", "b", "c", "d", "e"]),
    makeObservation("unknown-case", secondIds),
  ];
  const labels = {
    a: "IRRELEVANT",
    b: "EXACT",
    c: "UNVERIFIABLE",
    d: "ABSTAIN",
    e: "RELEVANT",
    f: "IRRELEVANT",
  } as const;
  const judgments = [
    makeJudgment("found-case", { ...labels }),
    makeJudgment("unknown-case", {
      g: "IRRELEVANT",
      h: "IRRELEVANT",
      i: "UNVERIFIABLE",
      j: "ABSTAIN",
      k: "EXACT",
      m: "IRRELEVANT",
    }, { inventoryAvailabilityAssessment: "unknown" }),
  ];
  const report = buildMetricsReport(observations, judgments, {
    caseCount: 2,
    candidateOccurrences: 12,
    judgedOccurrences: 12,
    uniqueObservationIdsAcrossCases: 12,
    repeatedObservationIdsAcrossCases: 0,
    inventoryAvailabilityCounts: { found: 1, none: 0, unknown: 1 },
  });

  const allJudged = report.metrics.topFiveIrrelevantRate.allJudged;
  assert.deepEqual(
    [allJudged.baseline.irrelevantCount, allJudged.baseline.denominator, allJudged.baseline.rate],
    [3, 6, 0.5],
  );
  assert.deepEqual(
    [allJudged.identityAware.irrelevantCount, allJudged.identityAware.denominator, allJudged.identityAware.rate],
    [4, 6, 4 / 6],
  );
  const foundOnly = report.metrics.topFiveIrrelevantRate.foundInventoryOnly;
  assert.deepEqual(
    [foundOnly.baseline.irrelevantCount, foundOnly.baseline.denominator, foundOnly.baseline.rate],
    [1, 3, 1 / 3],
  );
  assert.deepEqual(
    [foundOnly.identityAware.irrelevantCount, foundOnly.identityAware.denominator, foundOnly.identityAware.rate],
    [2, 3, 2 / 3],
  );

  // The prior metric remains an explicitly named all-rank/all-candidate rate.
  assert.deepEqual(
    [
      report.metrics.allCandidateIrrelevantRate.baseline.irrelevantCount,
      report.metrics.allCandidateIrrelevantRate.baseline.denominator,
      report.metrics.allCandidateIrrelevantRate.baseline.rate,
    ],
    [5, 10, 0.5],
  );
  assert.equal(report.metrics.baseline.irrelevantRate, 0.5);
});