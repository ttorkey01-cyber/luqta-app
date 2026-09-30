import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  calculateRealScorecard,
  type ArmLabels,
  type CandidateLabel,
  type CaseLabels,
  type IndependentLabels,
  type Observation,
  type RealCase,
} from "./score.js";
import { changedRecoveryEvidenceIds } from "./prepareRecoveryBlind.js";

type RecoveryObservation = {
  caseId: number | string;
  query: string;
  firstArm: "v2" | "phase1b" | "recovery";
  arms: Record<string, { products: Array<{ id: string; [key: string]: unknown }>; [key: string]: unknown }>;
  [key: string]: unknown;
};
type RecoveryLabelCase = CaseLabels & {
  arms?: Record<string, ArmLabels | undefined>;
  /** Optional shared candidate judgments authored from the arm-blinded packet. */
  candidates?: CandidateLabel[];
};
type RecoveryLabels = { schemaVersion: 1; cases: RecoveryLabelCase[] };
type HistoricalScorecard = {
  comparison?: { qualityByCase?: Array<Record<string, unknown>> };
  [key: string]: unknown;
};
type MetricScore = ReturnType<typeof calculateRealScorecard>;

function key(id: number | string): string {
  return String(id);
}

const URL_PATTERN =
  /\b(?:https?:\/\/|www\.)\S+|\b(?:[\w-]+\.)+(?:com|net|org|sa|co|io|shop|store)(?:\/\S*)?/giu;
const SENSITIVE_OUTPUT_KEY = /(?:url|link|secret|token|credential|password|authorization|api.?key)/iu;

function safeOutput(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(URL_PATTERN, "[URL removed]").replace(/\s+/gu, " ").trim();
  }
  if (Array.isArray(value)) return value.map(safeOutput);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([field]) => !SENSITIVE_OUTPUT_KEY.test(field))
      .map(([field, child]) => [field, safeOutput(child)]));
  }
  return value;
}

function mapRows<T extends { caseId: number | string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [key(row.caseId), row]));
}

function productIds(row: RecoveryObservation | Observation | undefined, arm: string): string[] {
  const products = (row?.arms as Record<string, { products?: Array<{ id: string }> }> | undefined)?.[arm]
    ?.products;
  return Array.isArray(products) ? products.map((product) => product.id) : [];
}

function candidateMap(arm: ArmLabels | undefined): Map<string, CandidateLabel> {
  return new Map((arm?.candidates ?? []).map((candidate) => [candidate.id, candidate]));
}

function sharedCandidateMap(row: CaseLabels | undefined): Map<string, CandidateLabel> {
  const candidates = (row as (CaseLabels & { candidates?: CandidateLabel[] }) | undefined)?.candidates ?? [];
  return new Map(candidates.map((candidate) => [candidate.id, candidate]));
}

function combineCandidate(oldValue: CandidateLabel | undefined, newValue: CandidateLabel): CandidateLabel {
  // Earlier independent judgments are immutable; new labels only fill missing IDs.
  return oldValue ?? newValue;
}

/**
 * Joins newly authored labels by (caseId, candidateId), never by rank or arm.
 * Existing candidate judgments take precedence and are not overwritten.
 */
export function joinRecoveryLabels(
  existing: IndependentLabels,
  fresh: RecoveryLabels,
  observations: RecoveryObservation[],
  changedIds: Map<string, Set<string>> = new Map(),
): IndependentLabels {
  if (existing.schemaVersion !== 1 || fresh.schemaVersion !== 1) {
    throw new Error("Both existing and recovery labels must use schemaVersion 1");
  }
  if (!Array.isArray(existing.cases) || !Array.isArray(fresh.cases)) {
    throw new Error("Independent label inputs must contain cases arrays");
  }
  for (const [name, rows] of [["existing", existing.cases], ["fresh", fresh.cases]] as const) {
    const seen = new Set<string>();
    for (const row of rows) {
      const id = key(row.caseId);
      if (seen.has(id)) throw new Error(`Duplicate ${name} independent label case ${id}`);
      seen.add(id);
    }
  }
  const oldRows = mapRows(existing.cases);
  const freshRows = mapRows(fresh.cases);
  const observedRows = mapRows(observations);
  const allIds = new Set([...oldRows.keys(), ...freshRows.keys()]);
  const cases: CaseLabels[] = [...allIds].map((caseId) => {
    const oldRow = oldRows.get(caseId);
    const freshRow = freshRows.get(caseId);
    const row = observedRows.get(caseId);
    if (!row && freshRow) throw new Error(`No recovery observation exists for newly labeled case ${caseId}`);
    const oldArms = oldRow?.arms as Record<string, ArmLabels | undefined> | undefined;
    const newArms = freshRow?.arms ?? {};
    const perArmFresh = new Map<string, CandidateLabel>();
    const globallyJudged = new Map<string, CandidateLabel>();
    for (const candidate of sharedCandidateMap(oldRow).values()) {
      globallyJudged.set(candidate.id, candidate);
    }
    for (const armName of ["v2", "phase1b", "recovery"]) {
      for (const candidate of oldArms?.[armName]?.candidates ?? []) {
        if (!globallyJudged.has(candidate.id)) globallyJudged.set(candidate.id, candidate);
      }
    }
    for (const label of freshRow?.candidates ?? []) perArmFresh.set(label.id, label);
    for (const arm of ["v2", "phase1b", "recovery"]) {
      for (const candidate of newArms[arm]?.candidates ?? []) {
        const shared = perArmFresh.get(candidate.id);
        if (shared && JSON.stringify(shared) !== JSON.stringify(candidate)) {
          throw new Error(`Conflicting new candidate judgments for case ${caseId}, ID ${candidate.id}`);
        }
        perArmFresh.set(candidate.id, candidate);
      }
    }
    if (row) {
      const displayedIds = new Set(["v2", "phase1b", "recovery"]
        .flatMap((arm) => productIds(row, arm)));
      for (const candidateId of perArmFresh.keys()) {
        if (!displayedIds.has(candidateId) && !globallyJudged.has(candidateId)) {
          throw new Error(`New candidate label ${candidateId} does not join to case ${caseId} by ID`);
        }
      }
    }
    const arms: Record<string, ArmLabels> = {};
    for (const arm of ["v2", "phase1b", "recovery"]) {
      const previous = oldArms?.[arm] ?? {};
      const authored = newArms[arm] ?? {};
      const priorCandidates = candidateMap(previous);
      const candidatesForArm: CandidateLabel[] = [];
      const seen = new Set<string>();
      for (const id of productIds(row, arm)) {
        if (seen.has(id)) continue;
        seen.add(id);
        const existingCandidate = priorCandidates.get(id);
        const globallyKnownCandidate = globallyJudged.get(id);
        const freshCandidate = perArmFresh.get(id);
        const evidenceChanged = changedIds.get(caseId)?.has(id) ?? false;
        const joined = evidenceChanged
          ? freshCandidate
          : freshCandidate
            ? combineCandidate(existingCandidate ?? globallyKnownCandidate, freshCandidate)
            : existingCandidate ?? globallyKnownCandidate;
        if (joined) candidatesForArm.push(joined);
      }
      // Retain existing independent judgments even if an arm is absent in this run.
      for (const candidate of previous.candidates ?? []) {
        if (!seen.has(candidate.id) && !changedIds.get(caseId)?.has(candidate.id)) {
          candidatesForArm.push(candidate);
        }
      }
      arms[arm] = {
        ...previous,
        ...authored,
        candidates: candidatesForArm,
      };
    }
    return {
      caseId: freshRow?.caseId ?? oldRow!.caseId,
      inventoryAvailabilityAssessment: freshRow?.inventoryAvailabilityAssessment ??
        oldRow?.inventoryAvailabilityAssessment,
      judgeRationale: freshRow?.judgeRationale ?? oldRow?.judgeRationale ?? "",
      arms,
    };
  });
  return { schemaVersion: 1, cases };
}

function pairedRecoveryRows(rows: RecoveryObservation[]): Observation[] {
  return rows.map((row) => {
    if (!row.arms.v2 || !row.arms.recovery) {
      throw new Error(`Case ${row.caseId} must contain v2 and recovery arms`);
    }
    const { recovery: _recovery, ...otherArms } = row.arms;
    const annotations = row.annotations as Record<string, unknown> | undefined;
    const recoveryAnnotations = annotations?.recovery;
    const pairedAnnotations = recoveryAnnotations
      ? { ...(annotations ?? {}), phase1b: recoveryAnnotations }
      : annotations;
    return {
      ...row,
      firstArm: row.firstArm === "recovery" ? "phase1b" : row.firstArm,
      arms: { ...otherArms, phase1b: row.arms.recovery } as Observation["arms"],
      ...(pairedAnnotations ? { annotations: pairedAnnotations } : {}),
    } as Observation;
  });
}

function pairedRecoveryLabels(labels: IndependentLabels): IndependentLabels {
  return {
    schemaVersion: 1,
    cases: labels.cases.map((row) => {
      const arms = row.arms as Record<string, ArmLabels | undefined> | undefined;
      return {
        ...row,
        arms: {
          v2: arms?.v2,
          phase1b: arms?.recovery,
        },
      };
    }),
  };
}

function historicalLabelsOnly(
  labels: IndependentLabels,
  observations: Observation[],
): IndependentLabels {
  const observationsByCase = mapRows(observations);
  return {
    schemaVersion: 1,
    cases: labels.cases.map((row) => {
      const observation = observationsByCase.get(key(row.caseId));
      const shared = sharedCandidateMap(row);
      const arms = {} as Record<"v2" | "phase1b", ArmLabels>;
      for (const armName of ["v2", "phase1b"] as const) {
        const previous = row.arms?.[armName] ?? {};
        const own = candidateMap(previous);
        if (!observation) {
          arms[armName] = previous;
          continue;
        }
        const candidates = productIds(observation, armName)
          .map((id) => own.get(id) ?? shared.get(id))
          .filter((candidate): candidate is CandidateLabel => Boolean(candidate));
        arms[armName] = { ...previous, candidates };
      }
      return { ...row, arms };
    }),
  };
}

function evidenceRetention(labels: IndependentLabels) {
  const alternatives: Array<{ caseId: number | string; arm: string; id: string; evidence: string | null }> = [];
  const unknowns: Array<{
    caseId: number | string;
    arm: string;
    id: string | null;
    field: string;
    constraintIndex?: number;
    evidence: string;
  }> = [];
  for (const row of labels.cases) {
    const arms = row.arms as Record<string, ArmLabels | undefined> | undefined;
    for (const armName of ["v2", "phase1b", "recovery"]) {
      const arm = arms?.[armName];
      for (const candidate of arm?.candidates ?? []) {
        if (candidate.identity === "ALTERNATIVE") {
          alternatives.push({
            caseId: row.caseId, arm: armName, id: candidate.id,
            evidence: candidate.evidenceReference ?? candidate.evidence ?? null,
          });
        }
        for (const constraint of candidate.hardConstraints ?? []) {
          if (constraint.verdict === "unknown") {
            unknowns.push({
              caseId: row.caseId, arm: armName, id: candidate.id,
              field: constraint.field, constraintIndex: constraint.constraintIndex,
              evidence: constraint.evidence,
            });
          }
        }
      }
      for (const constraint of arm?.queryHardConstraints ?? []) {
        if (constraint.verdict === "unknown") {
          unknowns.push({
            caseId: row.caseId, arm: armName, id: null,
            field: constraint.field, constraintIndex: constraint.constraintIndex,
            evidence: constraint.evidence,
          });
        }
      }
    }
  }
  return { alternativeJudgments: alternatives, unknownConstraintEvidence: unknowns };
}

function crossArmExactStillDisplayedAsNonExact(rows: RecoveryObservation[]) {
  const audit: Array<{
    caseId: number | string;
    id: string;
    phase1bClassification: string;
    recoveryClassification: string;
  }> = [];
  for (const row of rows) {
    const annotations = row.annotations as {
      phase1b?: { displayed?: Array<{ id: string; classification: string }> };
      recovery?: { displayed?: Array<{ id: string; classification: string }> };
    } | undefined;
    const recoveryById = new Map(
      (annotations?.recovery?.displayed ?? []).map((item) => [item.id, item.classification]),
    );
    const seen = new Set<string>();
    for (const phase1b of annotations?.phase1b?.displayed ?? []) {
      if (phase1b.classification.toUpperCase() !== "EXACT" || seen.has(phase1b.id)) continue;
      seen.add(phase1b.id);
      const recoveryClassification = recoveryById.get(phase1b.id);
      if (recoveryClassification && recoveryClassification.toUpperCase() !== "EXACT") {
        audit.push({
          caseId: row.caseId,
          id: phase1b.id,
          phase1bClassification: phase1b.classification,
          recoveryClassification,
        });
      }
    }
  }
  return { count: audit.length, audit };
}

function makeCaseAudit(
  cases: RealCase[],
  historicalRows: Observation[],
  recoveryRows: RecoveryObservation[],
  historicalLabels: IndependentLabels,
  joinedLabels: IndependentLabels,
  historicalScorecard: HistoricalScorecard,
) {
  const oldObservations = mapRows(historicalRows);
  const currentObservations = mapRows(recoveryRows);
  const oldLabels = mapRows(historicalLabels.cases);
  const currentLabels = mapRows(joinedLabels.cases);
  const priorQuality = new Map(
    (historicalScorecard.comparison?.qualityByCase ?? []).map((item) => [
      String(item.caseId), item,
    ]),
  );
  return cases.map((item) => {
    const id = key(item.id);
    const oldRow = oldObservations.get(id);
    const currentRow = currentObservations.get(id);
    const oldLabel = oldLabels.get(id);
    const currentLabel = currentLabels.get(id);
    const oldInventory = oldLabel?.inventoryAvailabilityAssessment ?? null;
    const currentInventory = currentLabel?.inventoryAvailabilityAssessment ?? null;
    const historicalSharedLabels = sharedCandidateMap(oldLabel);
    const historicalCandidatesForArm = (arm: "v2" | "phase1b") => {
      const candidates = candidateMap(oldLabel?.arms?.[arm]);
      for (const [candidateId, label] of historicalSharedLabels) {
        if (!candidates.has(candidateId)) candidates.set(candidateId, label);
      }
      return [...candidates.values()];
    };
    const sameV2Inventory = new Set(productIds(oldRow, "v2"));
    const currentV2 = new Set(productIds(currentRow, "v2"));
    const retained = [...sameV2Inventory].filter((candidateId) => currentV2.has(candidateId)).length;
    const sharedAcrossRuns = [...sameV2Inventory].filter((candidateId) => currentV2.has(candidateId));
    const v2Label = currentLabel?.arms?.v2?.candidates ?? [];
    const recoveryLabels = (currentLabel?.arms as Record<string, ArmLabels | undefined> | undefined)
      ?.recovery?.candidates ?? [];
    const knownCurrentIds = new Set([...v2Label, ...recoveryLabels]
      .filter((candidate) => candidate.relevance).map((candidate) => candidate.id));
    const oldTop5 = productIds(oldRow, "phase1b").slice(0, 5);
    const oldV2Top5 = productIds(oldRow, "v2").slice(0, 5);
    const nowV2Top5 = productIds(currentRow, "v2").slice(0, 5);
    const nowRecoveryTop5 = productIds(currentRow, "recovery").slice(0, 5);
    const isFullyJudgedTop5 = (
      ids: string[],
      candidates: CandidateLabel[],
      inventory: string | null,
    ) => ids.length
      ? ids.every((candidateId) =>
        candidates.some((candidate) => candidate.id === candidateId && Boolean(candidate.relevance)))
      : inventory === "found";
    const historicalTop5FullyJudged =
      isFullyJudgedTop5(oldV2Top5, historicalCandidatesForArm("v2"), oldInventory) &&
      isFullyJudgedTop5(oldTop5, historicalCandidatesForArm("phase1b"), oldInventory);
    const recoveryTop5FullyJudged =
      isFullyJudgedTop5(nowV2Top5, v2Label, currentInventory) &&
      isFullyJudgedTop5(
        nowRecoveryTop5,
        (currentLabel?.arms as Record<string, ArmLabels | undefined> | undefined)
          ?.recovery?.candidates ?? [],
        currentInventory,
      );
    const comparableToHistorical = Boolean(oldRow && currentRow && oldLabel && currentLabel) &&
      oldInventory === currentInventory &&
      historicalTop5FullyJudged &&
      recoveryTop5FullyJudged;
    return {
      caseId: item.id,
      historicalObservationAvailable: Boolean(oldRow),
      recoveryObservationAvailable: Boolean(currentRow),
      historicalV2CandidateCount: sameV2Inventory.size,
      recoveryRunV2CandidateCount: currentV2.size,
      v2CandidateIdsRetainedVsHistorical: retained,
      v2CandidateRetentionRateVsHistorical: sameV2Inventory.size
        ? retained / sameV2Inventory.size
        : null,
      candidateIdsSharedAcrossHistoricalAndRecoveryRunV2: sharedAcrossRuns,
      historicalV2CandidateIdsLost: [...sameV2Inventory].filter((candidateId) => !currentV2.has(candidateId)),
      historicalV2CandidateIdsAdded: [...currentV2].filter((candidateId) => !sameV2Inventory.has(candidateId)),
      historicalInventoryAssessment: oldInventory,
      recoveryInventoryAssessment: currentInventory,
      inventoryAssessmentDrift: oldInventory === currentInventory
        ? "unchanged"
        : oldInventory === null || currentInventory === null ? "assessment_missing" : "changed",
      historicalTop5CandidateIds: oldTop5,
      recoveryRunV2Top5CandidateIds: nowV2Top5,
      recoveryTop5CandidateIds: nowRecoveryTop5,
      recoveryPairTop5FullyJudged: nowV2Top5.every((candidateId) => knownCurrentIds.has(candidateId)) &&
        nowRecoveryTop5.every((candidateId) => knownCurrentIds.has(candidateId)),
      historicalPairTop5FullyJudged: historicalTop5FullyJudged,
      historicalScorecardCase: priorQuality.get(id) ?? null,
      comparableToHistorical,
      comparability: {
        bothObservationRunsAvailable: Boolean(oldRow && currentRow),
        inventoryAssessmentMatches: oldInventory === currentInventory,
        historicalV2Phase1bTop5FullyJudged: historicalTop5FullyJudged,
        recoveryV2RecoveryTop5FullyJudged: recoveryTop5FullyJudged,
        comparableRule: "Comparable requires both observation/label sets, the same inventory assessment, and complete relevance labels for both arm pairs' top-five windows; an empty window is fully judged only when inventory is assessed found.",
      },
    };
  });
}

export function scoreRecovery(
  preregistration: { cases: RealCase[] },
  historicalRows: Observation[],
  recoveryRows: RecoveryObservation[],
  historicalLabels: IndependentLabels,
  freshLabels: RecoveryLabels,
  historicalScorecard: HistoricalScorecard,
) {
  if (!Array.isArray(recoveryRows) || !Array.isArray(historicalRows)) {
    throw new Error("Historical and recovery observations must be arrays");
  }
  const caseIds = new Set<string>();
  for (const row of recoveryRows) {
    const id = key(row.caseId);
    if (caseIds.has(id)) throw new Error(`Duplicate recovery observation case ${id}`);
    caseIds.add(id);
    if (row.query !== preregistration.cases.find((item) => key(item.id) === id)?.query) {
      throw new Error(`Recovery observation query does not match preregistered case ${id}`);
    }
    for (const arm of ["v2", "phase1b", "recovery"]) {
      if (!Array.isArray(row.arms?.[arm]?.products)) {
        throw new Error(`Recovery observation ${id} is missing ${arm} products`);
      }
    }
  }
  const changedIds = changedRecoveryEvidenceIds(
    historicalRows as unknown as RecoveryObservation[],
    recoveryRows,
  );
  const joined = joinRecoveryLabels(historicalLabels, freshLabels, recoveryRows, changedIds);
  const historicalOnly = historicalLabelsOnly(historicalLabels, historicalRows);
  const oldPair = calculateRealScorecard(preregistration, historicalRows, historicalOnly);
  const recoveryPair = calculateRealScorecard(
    preregistration,
    pairedRecoveryRows(recoveryRows),
    pairedRecoveryLabels(joined),
  );

  const recoveryMap = mapRows(recoveryRows);
  const joinedMap = mapRows(joined.cases);
  let v2UsefulRetained = 0;
  let v2UsefulLost = 0;
  let v2IrrelevantSuppressed = 0;
  let v2UnknownRetention = 0;
  let v2Total = 0;
  for (const item of preregistration.cases) {
    const id = key(item.id);
    const row = recoveryMap.get(id);
    const label = joinedMap.get(id);
    if (!row || !label) continue;
    const recoveryIds = new Set(productIds(row, "recovery"));
    const judgments = candidateMap(label.arms?.v2);
    const acceptableAlternative = (candidate: CandidateLabel | undefined) =>
      candidate?.relevance === "PARTIALLY_RELEVANT" && item.alternativeAcceptable === true &&
      item.exactRequired !== true && candidate.identity === "ALTERNATIVE";
    for (const candidateId of productIds(row, "v2")) {
      v2Total++;
      const judgment = judgments.get(candidateId);
      const useful = judgment?.relevance === "RELEVANT" || acceptableAlternative(judgment);
      if (!judgment?.relevance) {
        if (recoveryIds.has(candidateId)) v2UnknownRetention++;
      } else if (useful) {
        if (recoveryIds.has(candidateId)) v2UsefulRetained++;
        else v2UsefulLost++;
      } else if (judgment.relevance === "IRRELEVANT" && !recoveryIds.has(candidateId)) {
        v2IrrelevantSuppressed++;
      }
    }
  }
  const exactAudit = recoveryPair.assertedExactFalseRatePhase1b;
  const exactDowngraded = exactAudit?.numerator ?? 0;
  const exactAssertionsUnknown = exactAudit?.unadjudicatedExactAssertions ?? 0;
  const crossArmDowngrades = crossArmExactStillDisplayedAsNonExact(recoveryRows);
  const evidence = evidenceRetention(joined);
  const inventoryCounts = { found: 0, none: 0, unknown: 0 };
  for (const row of joined.cases) {
    const assessment = row.inventoryAvailabilityAssessment ?? "unknown";
    inventoryCounts[assessment]++;
  }
  const output = {
    schemaVersion: 1,
    evaluation: {
      classification: "DESCRIPTIVE_REAL_SOURCE_EVALUATION",
      productionClaims: false,
      labelsGeneratedByCalculator: false,
      independentLabelsRequired: true,
      recoveryFreshLabelsCaseCount: freshLabels.cases.length,
      joinedIndependentLabelCaseCount: joined.cases.length,
      unknownInventoryIsNotTreatedAsNoMatch: true,
      scoringSemantics: "Frozen calculateRealScorecard semantics; each arm-pair retains its own judged denominator.",
    },
    historicalV2Phase1b: {
      scorecard: historicalScorecard,
      recomputedWithFrozenCalculator: oldPair,
    },
    recoveryV2Recovery: {
      scorecard: recoveryPair,
      armMapping: { v2: "v2", phase1b: "recovery" },
    },
    evidenceDrift: {
      changedCandidateIdCountsByCase: Object.fromEntries(
        [...changedIds].map(([caseId, ids]) => [caseId, ids.size]),
      ),
      changedCandidateIdsByCase: Object.fromEntries(
        [...changedIds].filter(([, ids]) => ids.size > 0)
          .map(([caseId, ids]) => [caseId, [...ids].sort()]),
      ),
      rule: "A new run uses fresh labels for changed safe evidence; if no fresh label exists, that candidate remains unjudged. Historical scoring continues to use historical observations and labels.",
    },
    threeArmScorecard: {
      schemaVersion: 1,
      evaluation: {
        classification: "DESCRIPTIVE_REAL_SOURCE_EVALUATION",
        productionClaims: false,
        labelsGeneratedByCalculator: false,
        arms: ["v2", "phase1b", "recovery"],
        note: "V2/Phase1B and V2/recovery use separate pairwise scoring populations; denominators are not pooled.",
      },
      arms: {
        v2: {
          historicalV2Phase1b: oldPair.arms.v2,
          recoveryV2Recovery: recoveryPair.arms.v2,
        },
        phase1b: oldPair.arms.phase1b,
        recovery: recoveryPair.arms.phase1b,
      },
    },
    v2RetentionLossSuppression: {
      v2DisplayedCandidates: v2Total,
      usefulV2CandidatesRetainedByRecovery: v2UsefulRetained,
      usefulV2CandidatesLostByRecovery: v2UsefulLost,
      independentlyLabeledIrrelevantV2CandidatesSuppressed: v2IrrelevantSuppressed,
      unjudgedV2CandidatesRetainedByRecovery: v2UnknownRetention,
      note: "Candidate membership is ID-based. Unknown or unjudged candidates are retained as unknown, never counted as useful or irrelevant.",
    },
    exactAssertionAudit: {
      unsupportedRecoveryExactAssertions: exactDowngraded,
      recoveryArmExactAssertionsDowngradedFromExact: exactDowngraded,
      crossArmPhase1bExactStillDisplayedButDowngraded: crossArmDowngrades.count,
      crossArmAudit: crossArmDowngrades.audit,
      recoveryArmExactAssertionsUnadjudicated: exactAssertionsUnknown,
      audit: exactAudit?.audit ?? [],
      note: "unsupportedRecoveryExactAssertions counts recovery annotations classified EXACT but independently judged as a non-EXACT identity; it is not a cross-arm firewall effect. recoveryArmExactAssertionsDowngradedFromExact is a deprecated legacy alias for that unsupported-assertion count. crossArmPhase1bExactStillDisplayedButDowngraded is computed independently from same-run annotations: the same ID is phase1b EXACT and displayed by recovery with a non-EXACT classification. Missing/UNVERIFIABLE independent identities remain unadjudicated.",
    },
    independentEvidenceRetained: {
      inventoryAssessmentCounts: inventoryCounts,
      ...evidence,
    },
    perCaseComparabilityAndInventoryDrift: makeCaseAudit(
      preregistration.cases, historicalRows, recoveryRows, historicalLabels, joined, historicalScorecard,
    ),
    joinedIndependentLabels: joined,
  };
  return safeOutput(output) as typeof output;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse((await readFile(path)).toString("utf8")) as unknown;
}

function rowsFrom(value: unknown, name: string): Observation[] {
  if (Array.isArray(value)) return value as Observation[];
  if (value !== null && typeof value === "object" && Array.isArray((value as { observations?: unknown }).observations)) {
    return (value as { observations: Observation[] }).observations;
  }
  throw new Error(`${name} must be an observation array or an object containing observations`);
}

export async function scoreRecoveryFiles(
  casesPath: string,
  historicalObservationsPath: string,
  historicalLabelsPath: string,
  historicalScorecardPath: string,
  recoveryObservationsPath: string,
  freshLabelsPath: string,
  outputPath: string,
): Promise<ReturnType<typeof scoreRecovery>> {
  const [cases, oldRows, oldLabels, oldScorecard, newRows, newLabels] = await Promise.all([
    readJson(casesPath), readJson(historicalObservationsPath), readJson(historicalLabelsPath),
    readJson(historicalScorecardPath), readJson(recoveryObservationsPath), readJson(freshLabelsPath),
  ]);
  if (!outputPath) throw new Error("An explicit output path is required");
  const result = scoreRecovery(
    cases as { cases: RealCase[] },
    rowsFrom(oldRows, "Historical observations"),
    rowsFrom(newRows, "Recovery observations") as unknown as RecoveryObservation[],
    oldLabels as IndependentLabels,
    newLabels as RecoveryLabels,
    oldScorecard as HistoricalScorecard,
  );
  await writeFile(resolve(outputPath), `${JSON.stringify(result, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return result;
}

function usage(): string {
  return [
    "Usage:",
    "  pnpm exec tsx src/experiments/searchGoldPhase1/realEvaluation/scoreRecovery.ts <cases.json> <historical-observations.json> <independent-labels.json> <historical-scorecard.json> <recovery-observations.json> <separately-authored-recovery-labels.json> <new-scorecard.json>",
    "",
    "The separately authored labels must be finalized independently before this join/score step.",
    "Fresh label JSON uses schemaVersion 1 and cases keyed by caseId; put new candidate labels in arms.recovery.candidates (or case-level candidates for shared judgments).",
    "Safe evidence changes versus historical observations require fresh labels; missing rejudgments remain unscored instead of reusing old candidate verdicts.",
    "No labels are generated. Output uses the frozen score.ts calculator separately for V2/Phase1B and V2/recovery.",
  ].join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 7 || args.some((arg) => !arg)) {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 1;
  } else {
    const [casesPath, oldObservationsPath, labelsPath, oldScorecardPath,
      recoveryObservationsPath, freshLabelsPath, outputPath] = args;
    scoreRecoveryFiles(
      casesPath!, oldObservationsPath!, labelsPath!, oldScorecardPath!,
      recoveryObservationsPath!, freshLabelsPath!, outputPath!,
    ).then(
      (result) => {
        const exact = result.exactAssertionAudit;
        process.stdout.write(
          `Wrote descriptive scorecard. Independent labels joined: ${result.evaluation.joinedIndependentLabelCaseCount}; recovery EXACT downgrades: ${exact.recoveryArmExactAssertionsDowngradedFromExact}.\n`,
        );
      },
      (error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      },
    );
  }
}