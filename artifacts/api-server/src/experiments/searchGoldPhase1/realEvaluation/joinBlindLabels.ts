import { createHash } from "node:crypto";
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  CandidateLabel,
  ConstraintLabel,
  IndependentLabels,
  RealCase,
} from "./score.js";

const REQUIRED_CASE_COUNT = 40;
const ARMS = ["v2", "phase1b"] as const;

type DisplayedObservation = {
  caseId: number | string;
  query: string;
  arms: Record<(typeof ARMS)[number], { products: Array<{ id: string }> }>;
};

type ObservationFile = {
  observations: DisplayedObservation[];
  runCompletedAt?: unknown;
  runError?: unknown;
};

type JudgedConstraint = ConstraintLabel & { constraintIndex: number };
type JudgedCandidate = CandidateLabel & {
  relevance: NonNullable<CandidateLabel["relevance"]>;
  identity: NonNullable<CandidateLabel["identity"]>;
  hardConstraints: JudgedConstraint[];
  evidence: string;
};
type JudgedCase = {
  caseId: number | string;
  inventoryAvailabilityAssessment: "found" | "none" | "unknown";
  judgeRationale: string;
  candidates: JudgedCandidate[];
};

function fail(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasNonemptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function caseKey(id: number | string): string {
  return String(id);
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: string[],
  description: string,
): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length) {
    fail(`${description} contains unsupported field(s): ${unexpected.join(", ")}`);
  }
}

function normalizeJudgedCase(value: unknown, source: string): JudgedCase {
  if (!isRecord(value)) fail(`${source} contains a malformed judgment case`);
  assertOnlyKeys(
    value,
    ["caseId", "inventoryAvailabilityAssessment", "judgeRationale", "candidates"],
    `${source} judgment case`,
  );
  if (
    (typeof value.caseId !== "string" && typeof value.caseId !== "number") ||
    !Number.isFinite(typeof value.caseId === "number" ? value.caseId : 0)
  ) {
    fail(`${source} judgment case has an invalid caseId`);
  }
  if (!["found", "none", "unknown"].includes(String(value.inventoryAvailabilityAssessment))) {
    fail(`${source} case ${String(value.caseId)} must explicitly assess inventory availability`);
  }
  if (!hasNonemptyText(value.judgeRationale)) {
    fail(`${source} case ${String(value.caseId)} must include an explicit judgeRationale`);
  }
  if (!Array.isArray(value.candidates)) {
    fail(`${source} case ${String(value.caseId)} must include a candidates array`);
  }

  const seenCandidates = new Set<string>();
  const candidates = value.candidates.map((candidate, index): JudgedCandidate => {
    const location = `${source} case ${String(value.caseId)} candidate ${index + 1}`;
    if (!isRecord(candidate)) fail(`${location} is malformed`);
    assertOnlyKeys(candidate, ["id", "relevance", "identity", "hardConstraints", "evidence"], location);
    if (typeof candidate.id !== "string" || candidate.id.length === 0) {
      fail(`${location} must have a nonempty string id`);
    }
    if (seenCandidates.has(candidate.id)) {
      fail(`${source} case ${String(value.caseId)} judges candidate ${candidate.id} more than once`);
    }
    seenCandidates.add(candidate.id);
    if (!["RELEVANT", "PARTIALLY_RELEVANT", "IRRELEVANT"].includes(String(candidate.relevance))) {
      fail(`${location} must have an explicit valid relevance judgment`);
    }
    if (!["EXACT", "PROBABLE_EXACT", "ALTERNATIVE", "NOT_EXACT", "UNVERIFIABLE"].includes(
      String(candidate.identity),
    )) {
      fail(`${location} must have an explicit valid identity judgment`);
    }
    if (!hasNonemptyText(candidate.evidence)) {
      fail(`${location} must include explicit evidence`);
    }
    if (!Array.isArray(candidate.hardConstraints)) {
      fail(`${location} must include a hardConstraints array`);
    }
    const seenIndices = new Set<number>();
    const hardConstraints = candidate.hardConstraints.map((constraint, constraintPosition) => {
      const constraintLocation = `${location} hard constraint ${constraintPosition + 1}`;
      if (!isRecord(constraint)) fail(`${constraintLocation} is malformed`);
      assertOnlyKeys(
        constraint,
        ["field", "constraintIndex", "verdict", "evidence"],
        constraintLocation,
      );
      if (
        typeof constraint.field !== "string" ||
        !Number.isInteger(constraint.constraintIndex) ||
        (constraint.constraintIndex as number) < 0
      ) {
        fail(`${constraintLocation} must include a field and zero-based constraintIndex`);
      }
      if (seenIndices.has(constraint.constraintIndex as number)) {
        fail(`${location} repeats hard requirement index ${constraint.constraintIndex}`);
      }
      seenIndices.add(constraint.constraintIndex as number);
      if (!["verified_pass", "verified_fail", "unknown"].includes(String(constraint.verdict))) {
        fail(`${constraintLocation} must have an explicit valid verdict`);
      }
      if (!hasNonemptyText(constraint.evidence)) {
        fail(`${constraintLocation} must include explicit evidence`);
      }
      return {
        field: constraint.field,
        constraintIndex: constraint.constraintIndex as number,
        verdict: constraint.verdict as JudgedConstraint["verdict"],
        evidence: constraint.evidence,
      };
    });

    return {
      id: candidate.id,
      relevance: candidate.relevance as JudgedCandidate["relevance"],
      identity: candidate.identity as JudgedCandidate["identity"],
      hardConstraints,
      evidence: candidate.evidence,
    };
  });

  return {
    caseId: value.caseId,
    inventoryAvailabilityAssessment: value.inventoryAvailabilityAssessment as JudgedCase["inventoryAvailabilityAssessment"],
    judgeRationale: value.judgeRationale,
    candidates,
  };
}

function validateAndJoin(
  cases: RealCase[],
  observationsFile: ObservationFile,
  judgmentParts: Array<{ source: string; cases: unknown[] }>,
): IndependentLabels {
  if (!Array.isArray(cases) || cases.length !== REQUIRED_CASE_COUNT) {
    fail(`Expected exactly ${REQUIRED_CASE_COUNT} preregistered cases`);
  }
  const casesByKey = new Map<string, RealCase>();
  for (const item of cases) {
    if (
      !item ||
      (typeof item.id !== "number" && typeof item.id !== "string") ||
      !Array.isArray(item.hard)
    ) {
      fail("cases.json contains a malformed case or hard-requirement list");
    }
    const id = caseKey(item.id);
    if (casesByKey.has(id)) fail(`cases.json contains duplicate caseId ${id}`);
    for (const [index, constraint] of item.hard.entries()) {
      if (!constraint || typeof constraint.field !== "string") {
        fail(`Case ${id} hard requirement ${index} has no field`);
      }
    }
    casesByKey.set(id, item);
  }

  if (
    !observationsFile ||
    typeof observationsFile.runCompletedAt !== "string" ||
    !observationsFile.runCompletedAt ||
    observationsFile.runError != null
  ) {
    fail("Observations must come from a completed run with no runError");
  }
  if (
    !Array.isArray(observationsFile.observations) ||
    observationsFile.observations.length !== REQUIRED_CASE_COUNT
  ) {
    fail(`Expected exactly ${REQUIRED_CASE_COUNT} completed observations`);
  }
  const observationsByKey = new Map<string, DisplayedObservation>();
  for (const observation of observationsFile.observations) {
    if (
      !observation ||
      (typeof observation.caseId !== "number" && typeof observation.caseId !== "string")
    ) {
      fail("Observations contain a malformed caseId");
    }
    const id = caseKey(observation.caseId);
    const testCase = casesByKey.get(id);
    if (!testCase || observationsByKey.has(id)) {
      fail(`Observation caseId ${id} is unknown or duplicated`);
    }
    if (observation.query !== testCase.query) {
      fail(`Observation query does not match preregistered case ${id}`);
    }
    if (!observation.arms) fail(`Observation ${id} must contain both completed arms`);
    for (const armName of ARMS) {
      const arm = observation.arms[armName];
      if (!arm || !Array.isArray(arm.products)) {
        fail(`Observation ${id} must contain a product list for ${armName}`);
      }
      for (const product of arm.products) {
        if (!product || typeof product.id !== "string" || product.id.length === 0) {
          fail(`Observation ${id} ${armName} contains a candidate without a stable ID`);
        }
      }
    }
    observationsByKey.set(id, observation);
  }
  if (observationsByKey.size !== casesByKey.size) {
    fail("Observation case IDs do not cover all preregistered cases");
  }

  const judgmentsByKey = new Map<string, JudgedCase>();
  for (const part of judgmentParts) {
    for (const rawCase of part.cases) {
      const judged = normalizeJudgedCase(rawCase, part.source);
      const id = caseKey(judged.caseId);
      if (!casesByKey.has(id)) fail(`${part.source} contains unknown caseId ${id}`);
      if (judgmentsByKey.has(id)) fail(`Case ${id} is judged more than once across files`);
      const preregistered = casesByKey.get(id)!;
      const observation = observationsByKey.get(id)!;
      const displayedByArm = Object.fromEntries(ARMS.map((armName) => [
        armName,
        new Set(observation.arms[armName].products.map((product) => product.id)),
      ])) as Record<(typeof ARMS)[number], Set<string>>;
      const displayedIds = new Set([...displayedByArm.v2, ...displayedByArm.phase1b]);
      const labeledIds = new Set(judged.candidates.map((candidate) => candidate.id));
      for (const candidateId of displayedIds) {
        if (!labeledIds.has(candidateId)) {
          fail(`Case ${id} displayed candidate ${candidateId} has no independent judgment`);
        }
      }
      for (const candidateId of labeledIds) {
        if (!displayedIds.has(candidateId)) {
          fail(`Case ${id} judgment contains invented candidate ID ${candidateId}`);
        }
      }
      for (const candidate of judged.candidates) {
        if (candidate.hardConstraints.length !== preregistered.hard.length) {
          fail(
            `Case ${id} candidate ${candidate.id} must judge all ${preregistered.hard.length} hard requirements`,
          );
        }
        const constraintsByIndex = new Map(
          candidate.hardConstraints.map((constraint) => [constraint.constraintIndex, constraint]),
        );
        for (const [index, requirement] of preregistered.hard.entries()) {
          const assessment = constraintsByIndex.get(index);
          if (!assessment || assessment.field !== requirement.field) {
            fail(
              `Case ${id} candidate ${candidate.id} must judge hard requirement ${index} (${requirement.field})`,
            );
          }
        }
      }
      judgmentsByKey.set(id, judged);
    }
  }
  if (judgmentsByKey.size !== casesByKey.size) {
    const missing = [...casesByKey.keys()].filter((id) => !judgmentsByKey.has(id));
    fail(`Blinded judgments do not cover all cases; missing: ${missing.join(", ")}`);
  }

  return {
    schemaVersion: 1,
    cases: cases.map((testCase) => {
      const id = caseKey(testCase.id);
      const judged = judgmentsByKey.get(id)!;
      const observation = observationsByKey.get(id)!;
      const byCandidateId = new Map(judged.candidates.map((candidate) => [candidate.id, candidate]));
      const armCandidates = (armName: (typeof ARMS)[number]) => {
        const seen = new Set<string>();
        return observation.arms[armName].products.flatMap((product) => {
          if (seen.has(product.id)) return [];
          seen.add(product.id);
          return [byCandidateId.get(product.id)!];
        });
      };
      return {
        caseId: judged.caseId,
        inventoryAvailabilityAssessment: judged.inventoryAvailabilityAssessment,
        judgeRationale: judged.judgeRationale,
        arms: {
          v2: { candidates: armCandidates("v2") },
          phase1b: { candidates: armCandidates("phase1b") },
        },
      };
    }),
  };
}

export function joinBlindLabels(
  cases: RealCase[],
  observationsFile: ObservationFile,
  judgmentParts: Array<{ source: string; cases: unknown[] }>,
): IndependentLabels {
  return validateAndJoin(cases, observationsFile, judgmentParts);
}

export async function createJoinedLabels(
  casesPath: string,
  observationsPath: string,
  judgmentsDirectory: string,
  outputPath: string,
): Promise<void> {
  if (!judgmentsDirectory || !outputPath) {
    fail("An explicit judgments directory and output file are required");
  }
  const [casesBytes, observationsBytes] = await Promise.all([
    readFile(casesPath),
    readFile(observationsPath),
  ]);
  const cases = (JSON.parse(casesBytes.toString("utf8")) as { cases: RealCase[] }).cases;
  const observationsFile = JSON.parse(observationsBytes.toString("utf8")) as ObservationFile;
  const expectedHash = createHash("sha256").update(casesBytes).digest("hex");
  const actualHash = (observationsFile as ObservationFile & { caseSha256?: unknown }).caseSha256;
  if (actualHash !== expectedHash) {
    fail("Observation caseSha256 does not match the supplied cases.json");
  }

  const directory = resolve(judgmentsDirectory);
  const partFiles = (await readdir(directory))
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .sort();
  if (!partFiles.length) fail("The judgments directory contains no JSON part files");
  const judgmentParts = await Promise.all(partFiles.map(async (name) => {
    const filePath = resolve(directory, name);
    const parsed = JSON.parse((await readFile(filePath)).toString("utf8")) as { cases?: unknown };
    if (!parsed || !Array.isArray(parsed.cases)) {
      fail(`${name} must contain a cases array`);
    }
    return { source: name, cases: parsed.cases };
  }));
  const joined = validateAndJoin(cases, observationsFile, judgmentParts);
  const targetPath = resolve(outputPath);
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(joined, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

function usage(): string {
  return [
    "Usage:",
    "  pnpm exec tsx src/experiments/searchGoldPhase1/realEvaluation/joinBlindLabels.ts <cases.json> <observations.json> <judgments-directory> <output.json>",
    "",
    "Judgment parts must cover all 40 cases and exactly the displayed candidate IDs.",
    "The output file is created without overwriting an existing file.",
  ].join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , casesPath, observationsPath, judgmentsDirectory, outputPath] = process.argv;
  if (!casesPath || !observationsPath || !judgmentsDirectory || !outputPath) {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 1;
  } else {
    createJoinedLabels(casesPath, observationsPath, judgmentsDirectory, outputPath).then(
      () => process.stdout.write(`Joined independent labels to ${resolve(outputPath)}\n`),
      (error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      },
    );
  }
}