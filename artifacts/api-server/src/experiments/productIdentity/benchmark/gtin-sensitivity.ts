import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizeIdentifier } from "../identifiers";
import type { IdentityRecord, PairClassification } from "../types";
import {
  loadBenchmarkInput,
  scoreBenchmark,
  type BenchmarkInput,
} from "./evaluate";

const ROOT = new URL("./", import.meta.url);
const PRIMARY_SCORECARD = new URL("scorecard.json", ROOT);
const LABELS_PATH = new URL("blind-labels.json", ROOT);
const REASSESSMENT_PATH = new URL("gtin-reassessment.json", ROOT);
const OUTPUT_PATH = new URL("gtin-sensitivity-scorecard.json", ROOT);
export const ALLOWED_REASSESSMENT_IDS = [
  "PI-075",
  "PI-086",
  "PI-091",
  "PI-103",
  "PI-109",
  "PI-114",
  "PI-119",
  "PI-123",
] as const;

type Reassessment = {
  blindId: string;
  identifierValidation: Array<{
    side: "left" | "right";
    raw: string;
    status: string;
    reason: string;
  }>;
  classification: string;
  adequatelyAdjudicated: boolean;
  rationale: string;
  positiveEvidence: string[];
  conflictingEvidence: string[];
  unknownEvidence: string[];
};

const sha256 = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");

function gtinIdentifiers(record: IdentityRecord) {
  return (record.identifiers ?? []).filter((identifier) =>
    /^GTIN(?:8|12|13|14)?$/i.test(identifier.kind));
}

function validateReassessment(
  input: BenchmarkInput,
  reassessment: Reassessment[],
): Map<string, Reassessment> {
  const allowed = new Set<string>(ALLOWED_REASSESSMENT_IDS);
  const mappingByBlindId = new Map(input.mapping.map((entry) => [entry.blindId, entry]));
  const pairsByBlindId = new Map(input.blindPairs.map((pair) => [pair.id, pair]));
  const labelsById = new Map(input.labels.map((label) => [label.id, label]));
  const seen = new Set<string>();

  for (const entry of reassessment) {
    if (!allowed.has(entry.blindId)) {
      throw new Error(`Refusing reassessment override outside the fixed allowlist: ${entry.blindId}`);
    }
    if (seen.has(entry.blindId)) {
      throw new Error(`Duplicate reassessment ID: ${entry.blindId}`);
    }
    seen.add(entry.blindId);
  }
  if (reassessment.length !== ALLOWED_REASSESSMENT_IDS.length ||
      ALLOWED_REASSESSMENT_IDS.some((id) => !seen.has(id))) {
    throw new Error("GTIN reassessment must contain exactly the eight approved blind IDs.");
  }

  for (const entry of reassessment) {
    const mapping = mappingByBlindId.get(entry.blindId);
    const blindPair = pairsByBlindId.get(entry.blindId);
    const originalLabel = labelsById.get(entry.blindId);
    if (!mapping || !blindPair || !originalLabel) {
      throw new Error(`Missing original blind case or label for ${entry.blindId}.`);
    }
    if (originalLabel.classification !== "DIFFERENT_PRODUCT" ||
        !originalLabel.adequatelyAdjudicated) {
      throw new Error(`Original label for ${entry.blindId} is not an adjudicated DIFFERENT_PRODUCT.`);
    }
    if (entry.classification !== "match" || !entry.adequatelyAdjudicated) {
      throw new Error(`Unsupported sensitivity classification for ${entry.blindId}.`);
    }
    const sides = [
      { side: "left" as const, record: blindPair.left },
      { side: "right" as const, record: blindPair.right },
    ];
    if (entry.identifierValidation.length !== sides.length) {
      throw new Error(`Expected exactly two independently assessed GTINs for ${entry.blindId}.`);
    }
    for (const { side, record } of sides) {
      const identifiers = gtinIdentifiers(record);
      const reassessedIdentifier = entry.identifierValidation.find((item) => item.side === side);
      if (identifiers.length !== 1 || !reassessedIdentifier ||
          identifiers[0].value !== reassessedIdentifier.raw ||
          reassessedIdentifier.status.toLowerCase() !== "invalid" ||
          /^\d+$/.test(reassessedIdentifier.raw) ||
          normalizeIdentifier(identifiers[0]).status !== "INVALID") {
        throw new Error(`GTIN reassessment does not match the invalid source identifier for ${entry.blindId}/${side}.`);
      }
    }
  }
  return new Map(reassessment.map((entry) => [entry.blindId, entry]));
}

export function createSensitivityInput(
  original: BenchmarkInput,
  reassessment: Reassessment[],
): BenchmarkInput {
  const reassessments = validateReassessment(original, reassessment);
  return {
    ...original,
    labels: original.labels.map((label) => {
      const revised = reassessments.get(label.id);
      if (!revised) return { ...label };
      return {
        ...label,
        classification: "SAME_PRODUCT_SAME_VARIANT" as PairClassification,
        adequatelyAdjudicated: revised.adequatelyAdjudicated,
        rationale: revised.rationale,
        positiveEvidence: [...revised.positiveEvidence],
        conflictingEvidence: [...revised.conflictingEvidence],
        unknownEvidence: [...revised.unknownEvidence],
      };
    }),
  };
}

export function scoreGtinSensitivity(
  original: BenchmarkInput,
  reassessment: Reassessment[],
  immutableHashes: { primaryScorecard: string; originalLabels: string; reassessment: string },
) {
  const sensitivityInput = createSensitivityInput(original, reassessment);
  const scorecard = scoreBenchmark(sensitivityInput);
  const originalById = new Map(original.labels.map((label) => [label.id, label]));
  return {
    ...scorecard,
    benchmark: "independent-product-identity-gtin-sensitivity",
    sensitivity: {
      method: "Recompute all benchmark metrics after applying only the eight allowlisted independent GTIN reassessments.",
      baselineScorecard: "scorecard.json",
      primaryScorecardSha256: immutableHashes.primaryScorecard,
      originalBlindLabelsSha256: immutableHashes.originalLabels,
      reassessmentSha256: immutableHashes.reassessment,
      reassessedCaseCount: reassessment.length,
      allowedBlindIds: [...ALLOWED_REASSESSMENT_IDS],
      changes: reassessment.map((entry) => ({
        blindId: entry.blindId,
        from: originalById.get(entry.blindId)!.classification,
        to: "SAME_PRODUCT_SAME_VARIANT",
        rationale: entry.rationale,
        positiveEvidence: entry.positiveEvidence,
        conflictingEvidence: entry.conflictingEvidence,
        unknownEvidence: entry.unknownEvidence,
      })),
      guardrail: "No other labels or corpus inputs are overridden; no engine, thresholds, source pairs, or primary scorecard are changed.",
    },
  };
}

export function generateGtinSensitivityScorecard() {
  const primaryBytes = readFileSync(PRIMARY_SCORECARD);
  const labelsBytes = readFileSync(LABELS_PATH);
  const reassessmentBytes = readFileSync(REASSESSMENT_PATH);
  const primaryHash = sha256(primaryBytes);
  const labelsHash = sha256(labelsBytes);
  const reassessmentHash = sha256(reassessmentBytes);
  const original = loadBenchmarkInput();
  const reassessment = JSON.parse(reassessmentBytes.toString("utf8")) as Reassessment[];
  const scorecard = scoreGtinSensitivity(original, reassessment, {
    primaryScorecard: primaryHash,
    originalLabels: labelsHash,
    reassessment: reassessmentHash,
  });

  if (sha256(readFileSync(PRIMARY_SCORECARD)) !== primaryHash ||
      sha256(readFileSync(LABELS_PATH)) !== labelsHash) {
    throw new Error("Immutable primary scorecard or blind labels changed during sensitivity scoring.");
  }
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(scorecard, null, 2)}\n`);
  return scorecard;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  generateGtinSensitivityScorecard();
}