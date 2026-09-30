import assert from "node:assert/strict";
import test from "node:test";
import { calculateRealScorecard } from "./score.js";

const preregistered = {
  cases: [
    {
      id: 1,
      group: "saudi_arabic",
      query: "black bag",
      hard: [{ field: "color" }],
      exactRequired: true,
      alternativeAcceptable: false,
      expectedIdentity: "Exact black bag model",
    },
    { id: 2, group: "difficult_no_match", query: "rare SKU", hard: [{ field: "sku" }] },
  ],
};

const observations = [
  {
    caseId: 1,
    query: "black bag",
    firstArm: "v2" as const,
    arms: {
      v2: {
        state: "success",
        elapsedMs: 10,
        providerCalls: { brave: 1, feed: 2 },
        products: [
          { id: "bag", classification: "exact", provider: "brave" },
          { id: "junk", provider: "feed" },
        ],
      },
      phase1b: {
        state: "success",
        elapsedMs: 30,
        products: [
          { id: "junk" },
          { id: "bag" },
        ],
      },
    },
    annotations: {
      phase1b: { displayed: [{ id: "junk", classification: "EXACT" }] },
    },
  },
  {
    caseId: 2,
    query: "rare SKU",
    firstArm: "v2" as const,
    arms: {
      v2: { state: "no_match", elapsedMs: 20, products: [] },
      phase1b: { state: "provider_unavailable", elapsedMs: 40, products: [] },
    },
  },
];

const labels = {
  schemaVersion: 1 as const,
  cases: [
    {
      caseId: 1,
      inventoryAvailabilityAssessment: "found" as const,
      judgeRationale: "Independent source supports bag result.",
      arms: {
        v2: {
          intendedMeaningPreserved: true,
          failureCategory: "none" as const,
          queryHardConstraints: [
            { field: "color", verdict: "verified_pass" as const, evidence: "Listing states black." },
          ],
          candidates: [
            {
              id: "bag",
              relevance: "RELEVANT" as const,
              identity: "EXACT" as const,
              hardConstraints: [
                { field: "color", verdict: "verified_pass" as const, evidence: "Listing states black." },
              ],
            },
            {
              id: "junk",
              relevance: "IRRELEVANT" as const,
              identity: "NOT_EXACT" as const,
              hardConstraints: [
                { field: "color", verdict: "verified_fail" as const, evidence: "Listing is red." },
              ],
            },
          ],
        },
        phase1b: {
          intendedMeaningPreserved: false,
          failureCategory: "identity_failure" as const,
          queryHardConstraints: [
            { field: "color", verdict: "unknown" as const, evidence: "No evidence." },
          ],
          candidates: [
            {
              id: "junk",
              relevance: "IRRELEVANT" as const,
              identity: "NOT_EXACT" as const,
              evidenceReference: "Independent listing audit 1",
            },
            { id: "bag", relevance: "RELEVANT" as const, identity: "EXACT" as const },
          ],
        },
      },
    },
    {
      caseId: 2,
      inventoryAvailabilityAssessment: "none" as const,
      judgeRationale: "No qualifying authorized result found in captured response.",
      arms: {
        v2: {
          intendedMeaningPreserved: true,
          failureCategory: "appropriate_abstention" as const,
          queryHardConstraints: [],
          candidates: [],
        },
        phase1b: {
          intendedMeaningPreserved: false,
          failureCategory: "retrieval_failure" as const,
          queryHardConstraints: [],
          candidates: [],
        },
      },
    },
  ],
};

test("scores only independently adjudicated observations and reports descriptive comparisons", () => {
  const scorecard = calculateRealScorecard(preregistered, observations, labels);
  const v2 = scorecard.arms.v2;
  assert.deepEqual(v2.metrics.precisionAt1, {
    numerator: 1, denominator: 1, value: 1, status: "SCORED",
  });
  assert.deepEqual(v2.metrics.precisionAt3, {
    numerator: 1, denominator: 3, value: 1 / 3, status: "SCORED",
  });
  assert.equal(v2.metrics.successAt5.value, 1);
  assert.equal(v2.metrics.exactProductIdentificationRank1.value, 1);
  assert.equal(v2.metrics.hardConstraintCompliance.queryLevel.value, 1);
  assert.equal(v2.metrics.hardConstraintCompliance.displayedResultsLevel.value, 0.5);
  assert.equal(v2.metrics.irrelevantResultRateAt5.value, 0.5);
  assert.equal(v2.metrics.irrelevantResultRateAllDisplayed.value, 0.5);
  assert.equal(scorecard.assertedExactFalseRatePhase1b?.adjudicatedExactAssertions, 1);
  assert.equal(scorecard.assertedExactFalseRatePhase1b?.unadjudicatedExactAssertions, 0);
  assert.equal(scorecard.assertedExactFalseRatePhase1b?.numerator, 1);
  assert.equal(scorecard.assertedExactFalseRatePhase1b?.denominator, 1);
  assert.deepEqual(scorecard.assertedExactFalseRatePhase1b?.audit[0], {
    caseId: 1,
    id: "junk",
    classification: "EXACT",
    independentIdentity: "NOT_EXACT",
    evidenceReference: "Independent listing audit 1",
  });
  assert.equal(scorecard.independentAdjudication.failureCategoryCounts.phase1b?.identity_failure, 1);
  assert.equal(v2.metrics.correctNoMatch.value, 1);
  assert.equal(v2.operational.providerFailureCases, 0);
  assert.equal(v2.operational.zeroResultCases, 1);
  assert.equal(v2.operational.providerContribution.brave.calls, 1);
  assert.equal(v2.operational.providerContribution.feed.returnedProducts, 1);
  assert.equal(v2.operational.latencyMs.median, 15);
  assert.equal(scorecard.comparison.filtering.usefulV2ResultsAbsentFromPhase1b, 0);
  assert.equal(scorecard.evaluation.productionClaims, false);
});

test("unknown or missing labels do not become successful judgments", () => {
  const sparseLabels = {
    schemaVersion: 1 as const,
    cases: [{
      caseId: 1,
      judgeRationale: "Partial independent review.",
      inventoryAvailabilityAssessment: "unknown" as const,
      arms: {
        v2: {
          intendedMeaningPreserved: true,
          queryHardConstraints: [
            { field: "color", verdict: "unknown" as const, evidence: "Not verifiable." },
          ],
          candidates: [{ id: "bag", relevance: "RELEVANT" as const }],
        },
      },
    }],
  };
  const result = calculateRealScorecard(
    { cases: [preregistered.cases[0]] },
    [observations[0]],
    sparseLabels,
  );
  assert.equal(result.arms.v2.metrics.exactProductIdentificationRank1.status, "NOT_SCOREABLE");
  assert.equal(result.arms.v2.metrics.hardConstraintCompliance.queryLevel.value, 0);
  assert.equal(result.arms.v2.metrics.correctNoMatch.status, "NOT_SCOREABLE");
  // An EXACT assertion with no independent identity label remains unadjudicated.
  assert.equal(result.assertedExactFalseRatePhase1b?.unadjudicatedExactAssertions, 1);
});

test("found inventory with zero results is a miss, while unknown inventory is not scored", () => {
  const row = {
    caseId: 1,
    query: "black bag",
    firstArm: "v2" as const,
    arms: {
      v2: { state: "COMPLETED", elapsedMs: 5, products: [] },
      phase1b: { state: "COMPLETED", elapsedMs: 6, products: [] },
    },
  };
  const label = {
    schemaVersion: 1 as const,
    cases: [{
      caseId: 1,
      inventoryAvailabilityAssessment: "found" as const,
      judgeRationale: "Independent available matching offer exists.",
      arms: {
        v2: { intendedMeaningPreserved: false, candidates: [] },
        phase1b: { intendedMeaningPreserved: false, candidates: [] },
      },
    }],
  };
  const result = calculateRealScorecard(
    { cases: [preregistered.cases[0]] },
    [row],
    label,
  );
  assert.deepEqual(result.arms.v2.metrics.precisionAt1, {
    numerator: 0, denominator: 1, value: 0, status: "SCORED",
  });
  assert.deepEqual(result.arms.v2.metrics.successAt5, {
    numerator: 0, denominator: 1, value: 0, status: "SCORED",
  });
  assert.deepEqual(result.arms.v2.metrics.precisionAt3, {
    numerator: 0, denominator: 3, value: 0, status: "SCORED",
  });
  assert.deepEqual(result.arms.phase1b.metrics.exactProductIdentificationRank1, {
    numerator: 0, denominator: 1, value: 0, status: "SCORED",
  });
  assert.deepEqual(result.arms.phase1b.metrics.exactProductIdentificationSuccessAt5, {
    numerator: 0, denominator: 1, value: 0, status: "SCORED",
  });
  assert.equal(
    result.arms.v2.metrics.exactProductIdentificationRank1.denominator,
    result.arms.phase1b.metrics.exactProductIdentificationRank1.denominator,
  );
});

test("partial alternatives are useful only when accepted and not exact-required", () => {
  const cases = [
    {
      id: 1, group: "test", query: "exact item", hard: [],
      exactRequired: true, alternativeAcceptable: true,
    },
    {
      id: 2, group: "test", query: "similar item", hard: [],
      exactRequired: false, alternativeAcceptable: true,
    },
  ];
  const rows = cases.map((item) => ({
    caseId: item.id,
    query: item.query,
    firstArm: "v2" as const,
    arms: {
      v2: { state: "COMPLETED", elapsedMs: 1, products: [{ id: `p${item.id}` }] },
      phase1b: { state: "COMPLETED", elapsedMs: 1, products: [{ id: `p${item.id}` }] },
    },
  }));
  const caseLabels = cases.map((item) => ({
    caseId: item.id,
    inventoryAvailabilityAssessment: "found" as const,
    judgeRationale: "Alternative assessed independently.",
    arms: {
      v2: {
        candidates: [{
          id: `p${item.id}`,
          relevance: "PARTIALLY_RELEVANT" as const,
          identity: "ALTERNATIVE" as const,
        }],
      },
      phase1b: {
        candidates: [{
          id: `p${item.id}`,
          relevance: "PARTIALLY_RELEVANT" as const,
          identity: "ALTERNATIVE" as const,
        }],
      },
    },
  }));
  const result = calculateRealScorecard(
    { cases },
    rows,
    { schemaVersion: 1, cases: caseLabels },
  );
  assert.deepEqual(result.arms.v2.metrics.precisionAt1, {
    numerator: 1, denominator: 2, value: 0.5, status: "SCORED",
  });
  assert.deepEqual(result.arms.v2.metrics.successAt5, {
    numerator: 1, denominator: 2, value: 0.5, status: "SCORED",
  });
});

test("filtering comparisons use V2-to-Phase1B direction and score known empty-arm regressions", () => {
  const cases = [1, 2, 3].map((id) => ({
    id,
    group: "test",
    query: `case ${id}`,
    hard: [],
  }));
  const observations = [
    {
      caseId: 1,
      query: "case 1",
      firstArm: "v2" as const,
      arms: {
        v2: {
          state: "COMPLETED", elapsedMs: 1,
          products: [{ id: "good" }, { id: "garbage" }],
        },
        phase1b: { state: "COMPLETED", elapsedMs: 1, products: [] },
      },
    },
    {
      caseId: 2,
      query: "case 2",
      firstArm: "phase1b" as const,
      arms: {
        v2: { state: "COMPLETED", elapsedMs: 1, products: [] },
        phase1b: { state: "COMPLETED", elapsedMs: 1, products: [{ id: "only-good" }] },
      },
    },
    {
      caseId: 3,
      query: "case 3",
      firstArm: "v2" as const,
      arms: {
        v2: { state: "COMPLETED", elapsedMs: 1, products: [] },
        phase1b: { state: "COMPLETED", elapsedMs: 1, products: [] },
      },
    },
  ];
  const labels = {
    schemaVersion: 1 as const,
    cases: [
      {
        caseId: 1,
        inventoryAvailabilityAssessment: "found" as const,
        judgeRationale: "V2 includes one useful item and one irrelevant item.",
        arms: {
          v2: {
            candidates: [
              { id: "good", relevance: "RELEVANT" as const },
              { id: "garbage", relevance: "IRRELEVANT" as const },
            ],
          },
          phase1b: { candidates: [] },
        },
      },
      {
        caseId: 2,
        inventoryAvailabilityAssessment: "found" as const,
        judgeRationale: "Only Phase1B returns a useful item.",
        arms: {
          v2: { candidates: [] },
          phase1b: {
            candidates: [{ id: "only-good", relevance: "RELEVANT" as const }],
          },
        },
      },
      {
        caseId: 3,
        inventoryAvailabilityAssessment: "found" as const,
        judgeRationale: "Both arms abstained despite independently found inventory.",
        arms: { v2: { candidates: [] }, phase1b: { candidates: [] } },
      },
    ],
  };
  const result = calculateRealScorecard({ cases }, observations, labels);
  assert.equal(result.comparison.filtering.usefulV2ResultsAbsentFromPhase1b, 1);
  assert.equal(result.comparison.filtering.irrelevantV2ResultsAbsentFromPhase1b, 1);
  assert.deepEqual(result.comparison.betterCaseIds, { v2: ["1"], phase1b: ["2"] });
  assert.equal(result.comparison.qualityByCase.find((row) => row.caseId === "3")?.better, "tie");
});