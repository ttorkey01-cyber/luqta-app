/**
 * Evidence-based calculator for the preregistered real-source evaluation.
 *
 * Observation input is an array of rows:
 * { caseId, query, firstArm, arms: { v2: { state, products, elapsedMs },
 *   phase1b: { state, products, elapsedMs } }, annotations?: {
 *   phase1b: { displayed: [{ id, classification }] } }. A product must have a stable
 * string `id`. Optional provider accounting may be recorded as
 * `providerCalls: { brave: number, feed: number }` on an arm. The live
 * runner's optional `braveUsage` and `contributions` fields are also read.
 *
 * Blind independent labels are a separate JSON object:
 * {
 *   "schemaVersion": 1,
 *   "cases": [{
 *     "caseId": 1,
 *     "inventoryAvailabilityAssessment": "found" | "none" | "unknown",
 *     "judgeRationale": "Evidence and reasoning...",
 *     "arms": {
 *       "v2": {
 *         "intendedMeaningPreserved": true,
 *         "failureCategory": "none" | "intent_misunderstood" | "retrieval_failure" |
 *           "ranking_failure" | "hard_constraint_failure" | "identity_failure" |
 *           "availability_failure" | "appropriate_abstention" | "other",
 *         "queryHardConstraints": [
 *           { "field": "brand", "constraintIndex": 0,
 *             "verdict": "verified_pass",
 *             "evidence": "Independent source URL / quoted evidence" }
 *         ],
 *         "candidates": [{
 *           "id": "stable observation product ID",
 *           "relevance": "RELEVANT" | "PARTIALLY_RELEVANT" | "IRRELEVANT",
 *           "identity": "EXACT" | "PROBABLE_EXACT" | "ALTERNATIVE" |
 *             "NOT_EXACT" | "UNVERIFIABLE",
 *           "evidenceReference": "Independent source/evidence reference",
 *           "hardConstraints": [
 *             { "field": "brand", "verdict": "verified_pass" |
 *               "verified_fail" | "unknown", "evidence": "Independent evidence",
 *               "constraintIndex": 0 }
 *           ],
 *           "evidence": "Independent evidence supporting these labels"
 *         }]
 *       },
 *       "phase1b": { "... same shape ..." }
 *     }
 *   }]
 * }
 * Every verdict must include its evidence (empty evidence is accepted as a
 * recorded evidence field but does not upgrade unknown). Do not include which
 * system produced a candidate or its rank in the blind judging material.
 * Join IDs to the observations only after independent labels are finalized.
 * Missing/unknown labels are never inferred from absence and are not scored.
 * This module does not create labels, inspect observations, or make production
 * quality claims.
 */

export type ArmName = "v2" | "phase1b";
export type Relevance =
  | "RELEVANT"
  | "PARTIALLY_RELEVANT"
  | "IRRELEVANT";
export type Identity =
  | "EXACT"
  | "PROBABLE_EXACT"
  | "ALTERNATIVE"
  | "NOT_EXACT"
  | "UNVERIFIABLE";
export type ConstraintVerdict =
  | "verified_pass"
  | "verified_fail"
  | "unknown";
export type FailureCategory =
  | "none"
  | "intent_misunderstood"
  | "retrieval_failure"
  | "ranking_failure"
  | "hard_constraint_failure"
  | "identity_failure"
  | "availability_failure"
  | "appropriate_abstention"
  | "other";

export interface RealCase {
  id: number | string;
  group: string;
  query: string;
  hard: Array<{ field: string; [key: string]: unknown }>;
  exactRequired?: boolean;
  alternativeAcceptable?: boolean;
  expectedIdentity?: string | null;
}

export interface ObservedProduct {
  id: string;
  [key: string]: unknown;
}

export interface ObservedArm {
  state: string;
  products: ObservedProduct[];
  elapsedMs: number;
  providerCalls?: { brave?: number; feed?: number };
  [key: string]: unknown;
}

export interface Observation {
  caseId: number | string;
  query: string;
  firstArm: ArmName;
  arms: Record<ArmName, ObservedArm>;
  annotations?: {
    phase1b?: {
      displayed?: Array<{ id: string; classification: string }>;
    };
  };
}

export interface ConstraintLabel {
  field: string;
  /** Zero-based index in the preregistered case's `hard` array. Required when
   * a case contains repeated fields (for example priceSAR > 100 and < 300). */
  constraintIndex?: number;
  verdict: ConstraintVerdict;
  evidence: string;
}

export interface CandidateLabel {
  id: string;
  relevance?: Relevance;
  identity?: Identity;
  hardConstraints?: ConstraintLabel[];
  evidence?: string;
  evidenceReference?: string;
}

export interface ArmLabels {
  intendedMeaningPreserved?: boolean | "unknown";
  failureCategory?: FailureCategory;
  queryHardConstraints?: ConstraintLabel[];
  candidates?: CandidateLabel[];
}

export interface CaseLabels {
  caseId: number | string;
  inventoryAvailabilityAssessment?: "found" | "none" | "unknown";
  judgeRationale: string;
  arms?: Partial<Record<ArmName, ArmLabels>>;
}

export interface IndependentLabels {
  schemaVersion: 1;
  cases: CaseLabels[];
}

export interface Metric {
  numerator: number;
  denominator: number;
  value: number | null;
  status: "SCORED" | "NOT_SCOREABLE";
}

function metric(numerator: number, denominator: number): Metric {
  return {
    numerator,
    denominator,
    value: denominator ? numerator / denominator : null,
    status: denominator ? "SCORED" : "NOT_SCOREABLE",
  };
}

function key(id: string | number): string {
  return String(id);
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = p * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function isProviderFailure(state: string): boolean {
  return /fail|unavailable|error|timeout/i.test(state);
}

function isNoMatch(state: string): boolean {
  return /no[_ -]?(?:confident[_ -]?)?match|no.?results|empty/i.test(state);
}

function candidateMap(labels: ArmLabels | undefined): Map<string, CandidateLabel> {
  return new Map((labels?.candidates ?? []).map((candidate) => [candidate.id, candidate]));
}

function constraintVerdicts(
  assessments: ConstraintLabel[] | undefined,
  hard: RealCase["hard"],
): Map<number, ConstraintVerdict> {
  const result = new Map<number, ConstraintVerdict>();
  const fieldCounts = new Map<string, number>();
  for (const constraint of hard) {
    fieldCounts.set(constraint.field, (fieldCounts.get(constraint.field) ?? 0) + 1);
  }
  for (const assessment of assessments ?? []) {
    if (assessment.constraintIndex !== undefined) {
      if (hard[assessment.constraintIndex]?.field === assessment.field) {
        result.set(assessment.constraintIndex, assessment.verdict);
      }
      continue;
    }
    if (fieldCounts.get(assessment.field) !== 1) continue;
    const index = hard.findIndex((constraint) => constraint.field === assessment.field);
    if (index >= 0) result.set(index, assessment.verdict);
  }
  return result;
}

function exactCandidate(label: CandidateLabel | undefined): boolean {
  return label?.identity === "EXACT";
}

function useful(label: CandidateLabel | undefined, testCase: RealCase): boolean {
  if (label?.relevance === "RELEVANT") return true;
  return label?.relevance === "PARTIALLY_RELEVANT" &&
    testCase.alternativeAcceptable === true &&
    testCase.exactRequired !== true &&
    label.identity === "ALTERNATIVE";
}

function evaluateArm(
  armName: ArmName,
  testCases: RealCase[],
  observations: Map<string, Observation>,
  labels: Map<string, CaseLabels>,
) {
  let p1Hits = 0;
  let p1Denominator = 0;
  let p3Hits = 0;
  let p3Denominator = 0;
  let success5Hits = 0;
  let success5Denominator = 0;
  let exactRank1Hits = 0;
  let exactRank1Denominator = 0;
  let exactTop5Hits = 0;
  let exactTop5Denominator = 0;
  let hardQueryPass = 0;
  let hardQueryDenominator = 0;
  let hardResultPass = 0;
  let hardResultDenominator = 0;
  let irrelevant = 0;
  let relevanceDenominator = 0;
  let allDisplayedIrrelevant = 0;
  let allDisplayedRelevanceDenominator = 0;
  let falseExact = 0;
  let adjudicatedExactAssertions = 0;
  let unadjudicatedExactAssertions = 0;
  const assertedExactAudit: Array<{
    caseId: number | string;
    id: string;
    classification: string;
    independentIdentity: Identity | null;
    evidenceReference: string | null;
  }> = [];
  let correctNoMatch = 0;
  let noMatchDenominator = 0;
  let zeroResults = 0;
  let providerFailures = 0;
  let braveCalls = 0;
  let feedCalls = 0;
  let braveCallsReported = false;
  let feedCallsReported = false;
  let feedProductCountReported = false;
  let braveProducts = 0;
  let feedProducts = 0;
  let webSearchProducts = 0;
  const providerProductCounts: Record<string, number> = {};
  let hardQueryCases = 0;
  const latency: number[] = [];
  let intendedMeaningPass = 0;
  let intendedMeaningDenominator = 0;

  for (const testCase of testCases) {
    const caseId = key(testCase.id);
    const observation = observations.get(caseId);
    const caseLabel = labels.get(caseId);
    if (!observation) continue;
    const observedArm = observation.arms?.[armName];
    if (!observedArm) continue;

    const products = Array.isArray(observedArm.products) ? observedArm.products : [];
    if (!products.length) zeroResults++;
    if (
      isProviderFailure(observedArm.state) ||
      (Array.isArray(observedArm.providerErrors) && observedArm.providerErrors.length > 0)
    ) providerFailures++;
    if (typeof observedArm.elapsedMs === "number" && Number.isFinite(observedArm.elapsedMs)) {
      latency.push(observedArm.elapsedMs);
    }
    if (observedArm.providerCalls) {
      if (typeof observedArm.providerCalls.brave === "number") {
        braveCallsReported = true;
        braveCalls += observedArm.providerCalls.brave;
      }
      if (typeof observedArm.providerCalls.feed === "number") {
        feedCallsReported = true;
        feedCalls += observedArm.providerCalls.feed;
      }
    }
    const braveUsage = observedArm.braveUsage as { braveRequests?: unknown } | undefined;
    if (typeof braveUsage?.braveRequests === "number") {
      braveCallsReported = true;
      braveCalls += braveUsage.braveRequests;
    }
    const contributions = observedArm.contributions as {
      feedProducts?: unknown;
      webProducts?: unknown;
      providerProductCounts?: unknown;
    } | undefined;
    if (typeof contributions?.feedProducts === "number") {
      feedProductCountReported = true;
      feedProducts += contributions.feedProducts;
    }
    if (typeof contributions?.webProducts === "number") {
      webSearchProducts += contributions.webProducts;
    }
    if (
      contributions?.providerProductCounts &&
      typeof contributions.providerProductCounts === "object"
    ) {
      for (const [providerId, count] of Object.entries(
        contributions.providerProductCounts as Record<string, unknown>,
      )) {
        if (typeof count === "number" && Number.isFinite(count)) {
          providerProductCounts[providerId] = (providerProductCounts[providerId] ?? 0) + count;
        }
      }
    }
    for (const product of products) {
      if (product.provider === "brave" || product.providerId === "brave") braveProducts++;
      if (product.provider === "feed") feedProducts++;
    }
    const armLabel = caseLabel?.arms?.[armName];
    const judged = candidateMap(armLabel);
    if (armName === "phase1b") {
      const assertions = observation.annotations?.phase1b?.displayed ?? [];
      for (const assertion of assertions) {
        if (assertion.classification.toUpperCase() !== "EXACT") continue;
        const independentLabel = judged.get(assertion.id);
        const identity = independentLabel?.identity ?? null;
        assertedExactAudit.push({
          caseId: observation.caseId,
          id: assertion.id,
          classification: assertion.classification,
          independentIdentity: identity,
          evidenceReference: independentLabel?.evidenceReference ??
            independentLabel?.evidence ?? null,
        });
        if (identity && identity !== "UNVERIFIABLE") {
          adjudicatedExactAssertions++;
          if (identity !== "EXACT") falseExact++;
        } else {
          unadjudicatedExactAssertions++;
        }
      }
    }
    if (!caseLabel) continue;

    const availability = caseLabel.inventoryAvailabilityAssessment;
    const hasAdjudicatedExactTarget =
      testCase.exactRequired === true &&
      availability === "found" &&
      typeof testCase.expectedIdentity === "string" &&
      testCase.expectedIdentity.trim().length > 0;
    if (hasAdjudicatedExactTarget) {
      // Shared per-case denominator: unavailable/missing top-1 results and
      // unverified top-1 identities are misses, not exclusions.
      exactRank1Denominator++;
      exactTop5Denominator++;
    }
    const first = products[0];
    const firstLabel = first ? judged.get(first.id) : undefined;
    if (availability === "found") {
      if (!products.length) {
        // Independently known available inventory makes an empty response a
        // missed query, not an unscorable query.
        p1Denominator++;
        success5Denominator++;
      } else if (firstLabel?.relevance) {
        p1Denominator++;
        if (useful(firstLabel, testCase)) p1Hits++;
      }
    }
    const top3 = products.slice(0, 3);
    const judgedTop3 = top3.filter((product) => judged.get(product.id)?.relevance);
    if (availability === "found") {
      p3Denominator += 3;
      p3Hits += judgedTop3.filter((product) =>
        useful(judged.get(product.id), testCase),
      ).length;
    }
    const top5 = products.slice(0, 5);
    const judgedTop5 = top5.filter((product) => judged.get(product.id)?.relevance);
    if (availability === "found" && products.length && judgedTop5.length) {
      success5Denominator++;
      if (judgedTop5.some((product) => useful(judged.get(product.id), testCase))) {
        success5Hits++;
      }
      relevanceDenominator += judgedTop5.length;
      irrelevant += judgedTop5.filter(
        (product) => judged.get(product.id)?.relevance === "IRRELEVANT",
      ).length;
    }
    if (availability === "found") {
      const judgedAll = products.filter((product) => judged.get(product.id)?.relevance);
      allDisplayedRelevanceDenominator += judgedAll.length;
      allDisplayedIrrelevant += judgedAll.filter(
        (product) => judged.get(product.id)?.relevance === "IRRELEVANT",
      ).length;
    }

    if (hasAdjudicatedExactTarget) {
      if (exactCandidate(firstLabel)) exactRank1Hits++;
    }
    if (
      hasAdjudicatedExactTarget &&
      top5.some((product) => exactCandidate(judged.get(product.id)))
    ) {
      exactTop5Hits++;
    }

    const hardConstraints = testCase.hard ?? [];
    if (hardConstraints.length) {
      hardQueryCases++;
      const queryVerdicts = constraintVerdicts(
        armLabel?.queryHardConstraints,
        hardConstraints,
      );
      if (queryVerdicts.size === hardConstraints.length) {
        hardQueryDenominator++;
        if (hardConstraints.every((_, index) => queryVerdicts.get(index) === "verified_pass")) {
          hardQueryPass++;
        }
      }

      for (const product of products) {
        const candidate = judged.get(product.id);
        const verdicts = constraintVerdicts(
          candidate?.hardConstraints,
          hardConstraints,
        );
        if (verdicts.size !== hardConstraints.length) continue;
        hardResultDenominator++;
        if (hardConstraints.every((_, index) => verdicts.get(index) === "verified_pass")) {
          hardResultPass++;
        }
      }
    }

    if (availability === "none") {
      noMatchDenominator++;
      if (
        isNoMatch(observedArm.state) &&
        products.length === 0
      ) correctNoMatch++;
    }
    if (typeof armLabel?.intendedMeaningPreserved === "boolean") {
      intendedMeaningDenominator++;
      if (armLabel.intendedMeaningPreserved) intendedMeaningPass++;
    }
  }

  const median = percentile(latency, 0.5);
  const p95 = percentile(latency, 0.95);
  return {
    metrics: {
      precisionAt1: metric(p1Hits, p1Denominator),
      precisionAt3: metric(p3Hits, p3Denominator),
      successAt5: metric(success5Hits, success5Denominator),
      exactProductIdentificationRank1: metric(exactRank1Hits, exactRank1Denominator),
      exactProductIdentificationSuccessAt5: metric(exactTop5Hits, exactTop5Denominator),
      hardConstraintCompliance: {
        queryLevel: metric(hardQueryPass, hardQueryDenominator),
        displayedResultsLevel: metric(hardResultPass, hardResultDenominator),
        casesWithHardConstraints: hardQueryCases,
        note: "Unknown verdicts fail. Missing or incomplete verdict sets are excluded; only complete verdicts are scored, and a pass requires every constraint to be verified_pass.",
      },
      irrelevantResultRateAt5: metric(irrelevant, relevanceDenominator),
      irrelevantResultRateAllDisplayed: metric(
        allDisplayedIrrelevant,
        allDisplayedRelevanceDenominator,
      ),
      correctNoMatch: {
        ...metric(correctNoMatch, noMatchDenominator),
        note: "Denominator includes only cases independently assessed as inventoryAvailabilityAssessment=none. Empty outputs or missing availability labels are not treated as proof of no match.",
      },
      intendedMeaningPreservation: metric(intendedMeaningPass, intendedMeaningDenominator),
    },
    assertedExactFalseRate: armName === "phase1b"
      ? {
        ...metric(falseExact, adjudicatedExactAssertions),
        adjudicatedExactAssertions,
        unadjudicatedExactAssertions,
        unverifiedAssertions: unadjudicatedExactAssertions,
        audit: assertedExactAudit,
        note: "Phase1B uppercase/lowercase EXACT assertions only. An assertion is adequately adjudicated only when independent identity is present and not UNVERIFIABLE.",
      }
      : null,
    operational: {
      casesObserved: testCases.filter((item) => observations.has(key(item.id))).length,
      zeroResultCases: zeroResults,
      providerFailureCases: providerFailures,
      providerContribution: {
        brave: {
          requests: braveCallsReported ? braveCalls : null,
          calls: braveCallsReported ? braveCalls : null,
          attributedProducts: braveProducts || null,
          returnedProducts: braveProducts || null,
          callCountAvailable: braveCallsReported,
        },
        webSearch: { returnedProducts: webSearchProducts || null },
        feed: {
          calls: feedCallsReported ? feedCalls : null,
          attributedProducts: feedProductCountReported ? feedProducts : feedProducts || null,
          returnedProducts: feedProductCountReported ? feedProducts : feedProducts || null,
          callCountAvailable: feedCallsReported,
        },
        providerProductCounts,
      },
      latencyMs: { samples: latency.length, median, p95 },
    },
  };
}

function compareArms(
  testCases: RealCase[],
  observations: Map<string, Observation>,
  labels: Map<string, CaseLabels>,
) {
  const better: Record<ArmName, string[]> = { v2: [], phase1b: [] };
  const qualityByCase: Array<{
    caseId: string;
    v2RelevantTop5: number;
    phase1bRelevantTop5: number;
    better: ArmName | "tie" | "not_comparable";
  }> = [];
  let filteredUseful = 0;
  let removedGarbage = 0;
  const filteredUsefulCases = new Set<string>();
  const removedGarbageCases = new Set<string>();

  for (const testCase of testCases) {
    const id = key(testCase.id);
    const row = observations.get(id);
    const label = labels.get(id);
    if (!row || !label) continue;
    const sets = {} as Record<ArmName, Map<string, CandidateLabel>>;
    const observed = {} as Record<ArmName, ObservedArm>;
    for (const arm of ["v2", "phase1b"] as const) {
      sets[arm] = candidateMap(label.arms?.[arm]);
      observed[arm] = row.arms[arm];
    }
    const usefulV2 = new Set(
      observed.v2.products
        .filter((product) => useful(sets.v2.get(product.id), testCase))
        .map((product) => product.id),
    );
    for (const product of observed.v2.products) {
      if (usefulV2.has(product.id) && !observed.phase1b.products.some((item) => item.id === product.id)) {
        filteredUseful++;
        filteredUsefulCases.add(id);
      }
    }
    for (const product of observed.v2.products) {
      if (
        sets.v2.get(product.id)?.relevance === "IRRELEVANT" &&
        !observed.phase1b.products.some((item) => item.id === product.id)
      ) {
        removedGarbage++;
        removedGarbageCases.add(id);
      }
    }

    const countTop5 = (arm: ArmName) => observed[arm].products
      .slice(0, 5)
      .filter((product) => useful(sets[arm].get(product.id), testCase)).length;
    const v2RelevantTop5 = countTop5("v2");
    const phase1bRelevantTop5 = countTop5("phase1b");
    let winner: ArmName | "tie" | "not_comparable" = "not_comparable";
    const fullyJudgedTop5 = (arm: ArmName) => {
      const top = observed[arm].products.slice(0, 5);
      if (!top.length) return label.inventoryAvailabilityAssessment === "found";
      return top.every((product) => sets[arm].get(product.id)?.relevance);
    };
    if (fullyJudgedTop5("v2") && fullyJudgedTop5("phase1b")) {
      winner = v2RelevantTop5 === phase1bRelevantTop5
        ? "tie"
        : v2RelevantTop5 > phase1bRelevantTop5 ? "v2" : "phase1b";
      if (winner !== "tie") better[winner].push(id);
    }
    qualityByCase.push({ caseId: id, v2RelevantTop5, phase1bRelevantTop5, better: winner });
  }
  return {
    betterCaseCounts: { v2: better.v2.length, phase1b: better.phase1b.length },
    betterCaseIds: better,
    qualityByCase,
    filtering: {
      usefulV2ResultsAbsentFromPhase1b: filteredUseful,
      casesWithUsefulV2ResultsFilteredByPhase1b: [...filteredUsefulCases],
      irrelevantV2ResultsAbsentFromPhase1b: removedGarbage,
      casesWithIrrelevantV2ResultsRemovedByPhase1b: [...removedGarbageCases],
      note: "Removal comparisons are ID-based: V2 results absent from Phase1B. An unjudged result is neither useful nor garbage.",
    },
    comparisonRule: "A case is called better only when both arms' displayed top-five candidates have complete independent relevance labels; the winner has more useful results in that window, where PARTIALLY_RELEVANT requires an allowed alternative on a non-exactRequired case.",
  };
}

/**
 * Calculate a descriptive scorecard using preregistered cases, captured
 * observations, and separately authored independent labels. This function
 * reports no thresholds and makes no production or population claims.
 */
export function calculateRealScorecard(
  preregistered: { cases: RealCase[] },
  observationRows: Observation[],
  independentLabels: IndependentLabels,
) {
  const observations = new Map(observationRows.map((row) => [key(row.caseId), row]));
  const labels = new Map(independentLabels.cases.map((row) => [key(row.caseId), row]));
  const failureCategoryCounts: Record<ArmName, Partial<Record<FailureCategory, number>>> = {
    v2: {},
    phase1b: {},
  };
  const inventoryAssessmentCounts: Record<"found" | "none" | "unknown", number> = {
    found: 0,
    none: 0,
    unknown: 0,
  };
  for (const label of independentLabels.cases) {
    if (label.inventoryAvailabilityAssessment) {
      inventoryAssessmentCounts[label.inventoryAvailabilityAssessment]++;
    }
    for (const arm of ["v2", "phase1b"] as const) {
      const armLabels = label.arms?.[arm];
      if (armLabels?.failureCategory) {
        failureCategoryCounts[arm][armLabels.failureCategory] =
          (failureCategoryCounts[arm][armLabels.failureCategory] ?? 0) + 1;
      }
    }
  }
  const firstArmCounts: Record<ArmName, number> = { v2: 0, phase1b: 0 };
  for (const row of observationRows) firstArmCounts[row.firstArm]++;
  const armResults = {
    v2: evaluateArm("v2", preregistered.cases, observations, labels),
    phase1b: evaluateArm("phase1b", preregistered.cases, observations, labels),
  };
  const arabicCases = preregistered.cases.filter(
    (testCase) => testCase.group === "saudi_arabic" ||
      testCase.group === "mixed_arabic_english",
  );
  const identifierCases = preregistered.cases.filter(
    (testCase) => testCase.group === "exact_identifier",
  );
  const automotiveCases = preregistered.cases.filter(
    (testCase) => testCase.group === "automotive",
  );
  const subgroups = Object.fromEntries(
    (["v2", "phase1b"] as const).map((arm) => {
      const arabic = evaluateArm(arm, arabicCases, observations, labels).metrics;
      const identifiers = evaluateArm(arm, identifierCases, observations, labels).metrics;
      const automotive = evaluateArm(arm, automotiveCases, observations, labels).metrics;
      return [arm, {
        arabicSuccessAt5: arabic.successAt5,
        identifierSuccessAt5: identifiers.exactProductIdentificationSuccessAt5,
        automotiveEvidenceSafety: automotive.hardConstraintCompliance,
      }];
    }),
  ) as Record<ArmName, {
    arabicSuccessAt5: Metric;
    identifierSuccessAt5: Metric;
    automotiveEvidenceSafety: ReturnType<typeof evaluateArm>["metrics"]["hardConstraintCompliance"];
  }>;
  const comparison = compareArms(preregistered.cases, observations, labels);

  return {
    schemaVersion: 1,
    evaluation: {
      classification: "DESCRIPTIVE_REAL_SOURCE_EVALUATION",
      preregisteredCaseCount: preregistered.cases.length,
      observedCaseCount: observationRows.length,
      independentlyLabeledCaseCount: independentLabels.cases.length,
      firstArmCounts,
      productionClaims: false,
      labelsGeneratedByCalculator: false,
      blindJudgmentRequirement: "Adjudication must be completed independently without source-arm identity/rank; labels are joined to observations by case and candidate IDs only afterward.",
    },
    independentAdjudication: {
      failureCategoryCounts,
      inventoryAssessmentCounts,
    },
    arms: {
      v2: { ...armResults.v2, subgroups: subgroups.v2 },
      phase1b: { ...armResults.phase1b, subgroups: subgroups.phase1b },
    },
    assertedExactFalseRatePhase1b: armResults.phase1b.assertedExactFalseRate,
    providerContributionNote: "Contribution counts follow the runner's per-response/per-call accounting and may count the same product more than once; they are not deduplicated unique-product counts.",
    comparison,
  };
}