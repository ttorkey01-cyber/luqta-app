import assert from "node:assert/strict";
import test from "node:test";
import { buildRecoveryBlindPackets } from "./prepareRecoveryBlind.js";
import { scoreRecovery } from "./scoreRecovery.js";
import type { IndependentLabels, Observation } from "./score.js";

const ids = {
  known: "000000000000000000000001",
  irrelevant: "000000000000000000000002",
  newCandidate: "000000000000000000000003",
};

const cases = {
  cases: [{
    id: 1,
    group: "similar_alternative",
    query: "black backpack",
    intended: "Black backpack",
    hard: [{ field: "color", op: "eq", value: "black" }],
    preferences: [],
    expectedIdentity: "Named model",
    useful: "Matching product",
    irrelevant: "Different product",
    exactRequired: false,
    alternativeAcceptable: true,
  }],
};

const historicalObservations: Observation[] = [{
  caseId: 1,
  query: "black backpack",
  firstArm: "v2",
  arms: {
    v2: {
      state: "success", elapsedMs: 10,
      products: [
        { id: ids.known, title: "Known item" },
        { id: ids.irrelevant, title: "Unjudged" },
        { id: ids.newCandidate, title: "Old item", description: "Old copy", price: 10, condition: "used", stock: 1, updatedAt: "2025-01-01" },
      ],
    },
    phase1b: {
      state: "success", elapsedMs: 12,
      products: [
        { id: ids.known, title: "Known item" },
        { id: ids.irrelevant, title: "Unjudged" },
        { id: ids.newCandidate, title: "Old item", description: "Old copy", price: 10, condition: "used", stock: 1, updatedAt: "2025-01-01" },
      ],
    },
  },
  annotations: { phase1b: { displayed: [{ id: ids.irrelevant, classification: "EXACT" }] } },
}];

const oldLabels: IndependentLabels = {
  schemaVersion: 1,
  cases: [{
    caseId: 1,
    inventoryAvailabilityAssessment: "found",
    judgeRationale: "Independent synthetic fixture judgment.",
    arms: {
      v2: {
        candidates: [
          { id: ids.known, relevance: "RELEVANT", identity: "EXACT" },
          { id: ids.irrelevant, relevance: "IRRELEVANT", identity: "NOT_EXACT" },
          { id: ids.newCandidate, relevance: "IRRELEVANT", identity: "NOT_EXACT",
            hardConstraints: [{ field: "color", constraintIndex: 0, verdict: "verified_fail", evidence: "Old listing stated red." }] },
        ],
      },
      phase1b: {
        candidates: [
          { id: ids.known, relevance: "RELEVANT", identity: "EXACT" },
          { id: ids.irrelevant, relevance: "IRRELEVANT", identity: "NOT_EXACT" },
          { id: ids.newCandidate, relevance: "IRRELEVANT", identity: "NOT_EXACT",
            hardConstraints: [{ field: "color", constraintIndex: 0, verdict: "verified_fail", evidence: "Old listing stated red." }] },
        ],
      },
    },
  }],
};

const recoveryObservations = [{
  caseId: 1,
  query: "black backpack",
  firstArm: "recovery" as const,
  arms: {
    v2: { state: "success", elapsedMs: 11, products: [
      { id: ids.known, title: "Known item" },
      { id: ids.irrelevant, title: "Unjudged" },
      { id: ids.newCandidate, title: "New item", description: "New copy", price: 20, condition: "new", stock: 3, updatedAt: "2026-01-01" },
    ] },
    phase1b: { state: "success", elapsedMs: 13, products: [{ id: ids.known }] },
    recovery: { state: "success", elapsedMs: 14, products: [
      { id: ids.known, title: "Known item" },
      { id: ids.newCandidate, title: "New item", description: "New copy", price: 20, condition: "new", stock: 3, updatedAt: "2026-01-01" },
      { id: ids.irrelevant, title: "Unjudged" },
    ] },
  },
  annotations: { recovery: { displayed: [{ id: ids.irrelevant, classification: "EXACT" }] } },
}];

test("recovery blind packets include unjudged and changed-evidence IDs without arm/provider/source leakage", () => {
  const observations = {
    observations: [{
      caseId: 1,
      query: "black backpack",
      arms: {
        v2: { products: [
          { id: ids.known, title: "Known item", provider: "v2-provider", rank: 1 },
          { id: ids.newCandidate, title: "New item", description: "At https://affiliate.example/x", price: 20, condition: "new", stock: 3, updatedAt: "2026-01-01", providerId: "secret-feed", classification: "EXACT", strategy: "recovery" },
        ] },
        phase1b: { products: [{ id: ids.newCandidate, title: "Other title", metadata: { sourceUrl: "https://feed.example/item", sourceProvider: "brand", size: "M" } }] },
        recovery: { products: [{ id: ids.irrelevant, title: "Unjudged", metadata: { merchant: "shop", productUrl: "www.shop.example/item" } }] },
      },
    }],
  };
  const historical = {
    observations: [{
      caseId: 1,
      query: "black backpack",
      arms: {
        v2: { products: [
          { id: ids.known, title: "Known item" },
          { id: ids.irrelevant, title: "Unjudged" },
          { id: ids.newCandidate, title: "Old item", description: "Old copy", price: 10, condition: "used", stock: 1, updatedAt: "2025-01-01" },
        ] },
        phase1b: { products: [
          { id: ids.known, title: "Known item" },
          { id: ids.irrelevant, title: "Unjudged" },
          { id: ids.newCandidate, title: "Old item", description: "Old copy", price: 10, condition: "used", stock: 1, updatedAt: "2025-01-01" },
        ] },
      },
    }],
  };
  const packets = buildRecoveryBlindPackets(observations, cases, oldLabels, historical, 5);
  const packet = packets[0]!;
  assert.equal(packet.cases.length, 1);
  assert.deepEqual(
    new Set(packet.cases[0]?.candidates.map((candidate) => candidate.id)),
    new Set([ids.newCandidate, ids.irrelevant]),
  );
  const serialized = JSON.stringify(packet);
  for (const forbidden of ["provider", "https://", "www.shop", "classification", "strategy", "rank"]) {
    assert.equal(serialized.toLowerCase().includes(forbidden), false, `unexpected ${forbidden}`);
  }
  assert.equal(serialized.includes("[URL removed]"), true);
  const changedCandidate = packet.cases[0]?.candidates.find((candidate) =>
    candidate.id === ids.newCandidate);
  assert.equal(changedCandidate?.title, "New item");
  assert.equal(changedCandidate?.price, 20);
  assert.equal(changedCandidate?.condition, "new");
  assert.equal(changedCandidate?.stock, 3);
  assert.equal(changedCandidate?.updatedAt, "2026-01-01");
  assert.deepEqual(packet.cases[0]?.hard, cases.cases[0]?.hard);
});

test("case-level first-replay labels reuse unchanged evidence and repacket changed evidence", () => {
  const sharedLabels = {
    schemaVersion: 1 as const,
    cases: [{
      caseId: 1,
      judgeRationale: "Blind first-replay candidate judgment.",
      candidates: [{ id: ids.known, relevance: "RELEVANT" as const, identity: "EXACT" as const }],
    }],
  } as unknown as IndependentLabels;
  const candidate = { id: ids.known, title: "First replay title", price: 45, condition: "new", stock: 4, updatedAt: "2026-03-01" };
  const historical = {
    observations: [{
      caseId: 1,
      query: "black backpack",
      arms: {
        v2: { products: [candidate] },
        phase1b: { products: [candidate] },
        recovery: { products: [candidate] },
      },
    }],
  };
  const current = (price: number) => ({
    observations: [{
      caseId: 1,
      query: "black backpack",
      arms: {
        v2: { products: [{ ...candidate, price }] },
        phase1b: { products: [{ ...candidate, price }] },
        recovery: { products: [{ ...candidate, price }] },
      },
    }],
  });
  const sameEvidencePackets = buildRecoveryBlindPackets(current(45), cases, sharedLabels, historical);
  assert.deepEqual(sameEvidencePackets[0]?.cases[0]?.candidates, []);

  const changedEvidencePackets = buildRecoveryBlindPackets(current(46), cases, sharedLabels, historical);
  assert.deepEqual(
    changedEvidencePackets[0]?.cases[0]?.candidates.map((item) => item.id),
    [ids.known],
  );
  const packetJson = JSON.stringify(changedEvidencePackets);
  assert.equal(packetJson.includes("relevance"), false);
  assert.equal(packetJson.includes("EXACT"), false);
  assert.equal(packetJson.includes("classification"), false);
});

test("scorer reuses case-level labels for unchanged historical and current IDs", () => {
  const sharedLabels = {
    schemaVersion: 1 as const,
    cases: [{
      caseId: 1,
      inventoryAvailabilityAssessment: "found" as const,
      judgeRationale: "First-replay blind judgment.",
      candidates: [{ id: ids.known, relevance: "RELEVANT" as const, identity: "EXACT" as const }],
    }],
  } as unknown as IndependentLabels;
  const result = scoreRecovery(
    cases,
    historicalObservations,
    recoveryObservations,
    sharedLabels,
    { schemaVersion: 1, cases: [] },
    { comparison: { qualityByCase: [] } },
  );
  assert.equal(result.historicalV2Phase1b.recomputedWithFrozenCalculator.arms.v2.metrics.precisionAt1.numerator, 1);
  assert.equal(result.historicalV2Phase1b.recomputedWithFrozenCalculator.arms.v2.metrics.precisionAt1.denominator, 1);
  assert.equal(result.recoveryV2Recovery.scorecard.arms.v2.metrics.precisionAt1.numerator, 1);
  assert.equal(result.recoveryV2Recovery.scorecard.arms.v2.metrics.precisionAt1.denominator, 1);
});

test("inventory drift makes cases 8 and 29 non-comparable without inferring no inventory", () => {
  const driftCases = [8, 29].map((id) => ({
    id,
    group: "strict_constraints",
    query: `case ${id}`,
    hard: [],
  }));
  const driftCandidateId = (caseId: number) => String(caseId).padStart(24, "0");
  const makeObservation = (caseId: number, armNames: string[]) => ({
    caseId,
    query: `case ${caseId}`,
    firstArm: "v2" as const,
    arms: Object.fromEntries(armNames.map((arm) => [
      arm,
      { state: "success", elapsedMs: 1, products: [{ id: driftCandidateId(caseId) }] },
    ])),
  });
  const historicalRows = [8, 29].map((id) => makeObservation(id, ["v2", "phase1b"]));
  const recoveryRows = [8, 29].map((id) => ({
    ...makeObservation(id, ["v2", "phase1b", "recovery"]),
    firstArm: "recovery" as const,
  }));
  const oldLabels: IndependentLabels = {
    schemaVersion: 1,
    cases: [8, 29].map((caseId) => {
      const id = driftCandidateId(caseId);
      return {
        caseId,
        inventoryAvailabilityAssessment: "unknown" as const,
        judgeRationale: "Historical inventory evidence is unknown.",
        arms: {
          v2: { candidates: [{ id, relevance: "RELEVANT" as const }] },
          phase1b: { candidates: [{ id, relevance: "RELEVANT" as const }] },
        },
      };
    }),
  };
  const freshLabels = {
    schemaVersion: 1 as const,
    cases: [8, 29].map((caseId) => ({
      caseId,
      inventoryAvailabilityAssessment: "found" as const,
      judgeRationale: "New independent evidence found qualifying inventory.",
    })),
  };
  const result = scoreRecovery(
    { cases: driftCases },
    historicalRows as unknown as Observation[],
    recoveryRows,
    oldLabels,
    freshLabels,
    { comparison: { qualityByCase: [] } },
  );
  for (const caseId of [8, 29]) {
    const audit = result.perCaseComparabilityAndInventoryDrift.find((row) =>
      row.caseId === caseId);
    assert.equal(audit?.historicalInventoryAssessment, "unknown");
    assert.equal(audit?.recoveryInventoryAssessment, "found");
    assert.equal(audit?.inventoryAssessmentDrift, "changed");
    assert.equal(audit?.comparableToHistorical, false);
    assert.equal(audit?.comparability.inventoryAssessmentMatches, false);
    assert.equal(audit?.comparability.historicalV2Phase1bTop5FullyJudged, true);
    assert.equal(audit?.comparability.recoveryV2RecoveryTop5FullyJudged, true);
  }
  assert.equal(result.recoveryV2Recovery.scorecard.arms.v2.metrics.precisionAt1.denominator, 2);
  assert.equal(result.historicalV2Phase1b.recomputedWithFrozenCalculator.arms.v2.metrics.precisionAt1.denominator, 0);
  assert.equal(result.recoveryV2Recovery.scorecard.independentAdjudication.inventoryAssessmentCounts.none, 0);
});

test("matching inventory does not make a case comparable when historical top-five labels are missing", () => {
  const caseId = 30;
  const firstId = "000000000000000000000030";
  const secondId = "000000000000000000000031";
  const row = (firstArm: "v2" | "recovery") => ({
    caseId,
    query: "case 30",
    firstArm,
    arms: {
      v2: { state: "success", elapsedMs: 1, products: [{ id: firstId }] },
      phase1b: { state: "success", elapsedMs: 1, products: [{ id: secondId }] },
      ...(firstArm === "recovery"
        ? { recovery: { state: "success", elapsedMs: 1, products: [{ id: secondId }] } }
        : {}),
    },
  });
  const result = scoreRecovery(
    { cases: [{ id: caseId, group: "strict_constraints", query: "case 30", hard: [] }] },
    [row("v2") as unknown as Observation],
    [row("recovery")],
    {
      schemaVersion: 1,
      cases: [{
        caseId,
        inventoryAvailabilityAssessment: "unknown",
        judgeRationale: "Inventory remains unknown.",
        arms: { v2: { candidates: [{ id: firstId, relevance: "RELEVANT" }] }, phase1b: { candidates: [] } },
      }],
    },
    {
      schemaVersion: 1,
      cases: [{
        caseId,
        inventoryAvailabilityAssessment: "unknown",
        judgeRationale: "New inventory assessment remains unknown.",
        arms: { recovery: { candidates: [{ id: secondId, relevance: "RELEVANT" }] } },
      }],
    },
    { comparison: { qualityByCase: [] } },
  );
  const audit = result.perCaseComparabilityAndInventoryDrift[0]!;
  assert.equal(audit.inventoryAssessmentDrift, "unchanged");
  assert.equal(audit.comparability.inventoryAssessmentMatches, true);
  assert.equal(audit.comparability.historicalV2Phase1bTop5FullyJudged, false);
  assert.equal(audit.comparability.recoveryV2RecoveryTop5FullyJudged, true);
  assert.equal(audit.comparableToHistorical, false);
});

test("unsupported exact assertions are distinct from same-ID cross-arm downgrades", () => {
  const a = ids.known;
  const b = ids.irrelevant;
  const c = ids.newCandidate;
  const d = "000000000000000000000004";
  const e = "000000000000000000000005";
  const f = "000000000000000000000006";
  const phase1bExact = [a, b, c, d].map((id) => ({ id, classification: "EXACT" }));
  const recoveryDisplayed = [
    { id: a, classification: "PROBABLE_EXACT" },
    { id: b, classification: "IRRELEVANT" },
    { id: c, classification: "EXACT" },
    { id: d, classification: "EXACT" },
    { id: e, classification: "PROBABLE_EXACT" },
    { id: f, classification: "EXACT" },
  ];
  const result = scoreRecovery(
    { cases: [{ id: 40, group: "test", query: "test", hard: [] }] },
    [],
    [{
      caseId: 40,
      query: "test",
      firstArm: "v2",
      arms: {
        v2: { state: "success", elapsedMs: 1, products: [] },
        phase1b: { state: "success", elapsedMs: 1, products: [a, b, c, d].map((id) => ({ id })) },
        recovery: { state: "success", elapsedMs: 1, products: [a, b, c, d, e, f].map((id) => ({ id })) },
      },
      annotations: {
        phase1b: { displayed: phase1bExact },
        recovery: { displayed: recoveryDisplayed },
      },
    }],
    { schemaVersion: 1, cases: [] },
    {
      schemaVersion: 1,
      cases: [{
        caseId: 40,
        inventoryAvailabilityAssessment: "unknown",
        judgeRationale: "Synthetic independent identity judgments.",
        arms: {
          recovery: {
            candidates: [
              { id: c, relevance: "RELEVANT", identity: "NOT_EXACT" },
              { id: d, relevance: "RELEVANT", identity: "EXACT" },
              { id: f, relevance: "RELEVANT", identity: "UNVERIFIABLE" },
            ],
          },
        },
      }],
    },
    { comparison: { qualityByCase: [] } },
  );
  assert.equal(result.exactAssertionAudit.unsupportedRecoveryExactAssertions, 1);
  assert.equal(result.exactAssertionAudit.recoveryArmExactAssertionsDowngradedFromExact, 1);
  assert.equal(result.exactAssertionAudit.crossArmPhase1bExactStillDisplayedButDowngraded, 2);
  assert.equal(result.exactAssertionAudit.recoveryArmExactAssertionsUnadjudicated, 1);
  assert.deepEqual(
    result.exactAssertionAudit.crossArmAudit.map((item) => [item.id, item.recoveryClassification]),
    [[a, "PROBABLE_EXACT"], [b, "IRRELEVANT"]],
  );
});

test("score recovery keeps pairwise denominators, evidence, assertion downgrade, and unknown inventory distinct", () => {
  const recoveryLabels = {
    schemaVersion: 1 as const,
    cases: [{
      caseId: 1,
      inventoryAvailabilityAssessment: "unknown" as const,
      judgeRationale: "New independent synthetic judgment; inventory is unknown.",
      arms: {
        recovery: {
          candidates: [
            {
              id: ids.newCandidate,
              relevance: "PARTIALLY_RELEVANT" as const,
              identity: "ALTERNATIVE" as const,
              evidenceReference: "Independent synthetic evidence record",
              hardConstraints: [{
                field: "color",
                constraintIndex: 0,
                verdict: "unknown" as const,
                evidence: "No independent source-backed color evidence.",
              }],
            },
            { id: ids.irrelevant, relevance: "IRRELEVANT" as const, identity: "NOT_EXACT" as const },
          ],
        },
      },
    }],
  };
  const historicalScorecard = {
    comparison: { qualityByCase: [{ caseId: "1", better: "tie" }] },
  };
  const result = scoreRecovery(
    cases,
    historicalObservations,
    recoveryObservations,
    oldLabels,
    recoveryLabels,
    historicalScorecard,
  );
  assert.equal(result.historicalV2Phase1b.recomputedWithFrozenCalculator.arms.v2.metrics.precisionAt1.denominator, 1);
  assert.equal(result.recoveryV2Recovery.scorecard.arms.v2.metrics.precisionAt1.denominator, 0);
  assert.equal(result.recoveryV2Recovery.scorecard.arms.phase1b.metrics.precisionAt1.denominator, 0);
  assert.equal(result.threeArmScorecard.arms.recovery.metrics.precisionAt1.denominator, 0);
  assert.equal(result.threeArmScorecard.arms.phase1b.metrics.precisionAt1.denominator, 1);
  assert.equal(result.independentEvidenceRetained.inventoryAssessmentCounts.unknown, 1);
  assert.equal(result.threeArmScorecard.arms.recovery.metrics.correctNoMatch.denominator, 0);
  assert.equal(result.exactAssertionAudit.recoveryArmExactAssertionsDowngradedFromExact, 1);
  assert.equal(result.independentEvidenceRetained.alternativeJudgments.some((item) =>
    item.id === ids.newCandidate), true);
  assert.equal(result.independentEvidenceRetained.unknownConstraintEvidence.some((item) =>
    item.id === ids.newCandidate && item.evidence.includes("No independent")), true);
  assert.equal(result.evidenceDrift.changedCandidateIdsByCase["1"]?.includes(ids.newCandidate), true);
  assert.equal(result.evidenceDrift.changedCandidateIdsByCase["1"]?.includes(ids.irrelevant), false);
  const joinedArms = result.joinedIndependentLabels.cases[0]?.arms as
    Record<string, { candidates?: Array<{ id: string; identity?: string; hardConstraints?: Array<{ verdict: string }> }> }> | undefined;
  const rejudged = joinedArms?.recovery?.candidates
    ?.find((candidate) => candidate.id === ids.newCandidate);
  assert.equal(rejudged?.identity, "ALTERNATIVE");
  assert.equal(rejudged?.hardConstraints?.[0]?.verdict, "unknown");
  const rejudgedV2 = joinedArms?.v2?.candidates?.find((candidate) =>
    candidate.id === ids.newCandidate);
  assert.equal(rejudgedV2?.hardConstraints?.[0]?.verdict, "unknown");
  const noFreshJudgment = scoreRecovery(
    cases,
    historicalObservations,
    recoveryObservations,
    oldLabels,
    { schemaVersion: 1, cases: [{ caseId: 1, judgeRationale: "No candidate judgments authored." }] },
    historicalScorecard,
  );
  assert.equal(
    (noFreshJudgment.joinedIndependentLabels.cases[0]?.arms as
      Record<string, { candidates?: Array<{ id: string }> }> | undefined)?.recovery?.candidates
      ?.some((candidate) => candidate.id === ids.newCandidate),
    false,
  );
  assert.equal(
    (noFreshJudgment.joinedIndependentLabels.cases[0]?.arms as
      Record<string, { candidates?: Array<{ id: string }> }> | undefined)?.phase1b?.candidates
      ?.some((candidate) => candidate.id === ids.newCandidate),
    false,
  );
  assert.equal(result.v2RetentionLossSuppression.usefulV2CandidatesRetainedByRecovery, 2);
  assert.equal(result.v2RetentionLossSuppression.independentlyLabeledIrrelevantV2CandidatesSuppressed, 0);
  assert.equal(result.evaluation.productionClaims, false);
});