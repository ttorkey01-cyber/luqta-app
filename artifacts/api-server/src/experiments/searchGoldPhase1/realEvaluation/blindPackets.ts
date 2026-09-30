import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_CASE_COUNT = 40;
const PRODUCT_FIELDS = [
  "providerId",
  "title",
  "description",
  "brand",
  "productType",
  "category",
  "color",
  "price",
  "currency",
  "condition",
  "location",
  "availability",
  "updatedAt",
  "sourceType",
  "merchant",
] as const;

const URL_PATTERN =
  /\b(?:https?:\/\/|www\.)\S+|\b(?:[\w-]+\.)+(?:com|net|org|sa|co|io|shop|store)(?:\/\S*)?/giu;
const SENSITIVE_KEY_PATTERN = /(?:url|link|secret|token|credential|password|authorization|api.?key)/iu;

type PreregisteredCase = {
  id: number | string;
  query: string;
  intended: unknown;
  hard: unknown;
  preferences: unknown;
  expectedIdentity: unknown;
  useful: unknown;
  irrelevant: unknown;
  exactRequired: unknown;
  alternativeAcceptable: unknown;
};

type CandidateSnapshot = {
  id: string;
  [key: string]: unknown;
};

type Observation = {
  caseId: number | string;
  query: string;
  arms: Record<string, { products: CandidateSnapshot[] }>;
};

type ObservationFile = {
  caseSha256: string;
  selectedCaseIds?: Array<number | string>;
  observations: Observation[];
  runCompletedAt?: string | null;
  runError?: unknown;
};

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(URL_PATTERN, "[URL removed]").replace(/\s+/gu, " ").trim();
  }
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !SENSITIVE_KEY_PATTERN.test(key))
        .map(([key, child]) => [key, sanitizeValue(child)]),
    );
  }
  return value;
}

function snapshot(product: CandidateSnapshot): CandidateSnapshot {
  if (typeof product.id !== "string" || !/^[a-f0-9]{24}$/iu.test(product.id)) {
    throw new Error("Displayed candidate is missing its stable hashed product id");
  }
  const output: CandidateSnapshot = { id: product.id };
  for (const field of PRODUCT_FIELDS) {
    if (Object.hasOwn(product, field)) output[field] = sanitizeValue(product[field]);
  }
  return output;
}

function validateInputs(
  observationsFile: ObservationFile,
  preregistration: { cases: PreregisteredCase[] },
  caseFileHash: string,
): void {
  if (!Array.isArray(preregistration.cases) || preregistration.cases.length !== REQUIRED_CASE_COUNT) {
    throw new Error(`Expected exactly ${REQUIRED_CASE_COUNT} preregistered cases`);
  }
  if (observationsFile.caseSha256 !== caseFileHash) {
    throw new Error("Observation caseSha256 does not match the supplied cases.json");
  }
  if (
    !observationsFile.runCompletedAt ||
    typeof observationsFile.runCompletedAt !== "string" ||
    observationsFile.runError != null
  ) {
    throw new Error("Observations must come from a completed run with no runError");
  }
  if (!Array.isArray(observationsFile.observations) ||
    observationsFile.observations.length !== REQUIRED_CASE_COUNT) {
    throw new Error(`Expected exactly ${REQUIRED_CASE_COUNT} completed observations`);
  }

  const casesById = new Map(preregistration.cases.map((item) => [String(item.id), item]));
  const observedIds = new Set<string>();
  for (const observation of observationsFile.observations) {
    const caseId = String(observation.caseId);
    const preregistered = casesById.get(caseId);
    if (!preregistered || observedIds.has(caseId)) {
      throw new Error(`Observation caseId ${caseId} is unknown or duplicated`);
    }
    if (observation.query !== preregistered.query) {
      throw new Error(`Observation query does not match preregistered case ${caseId}`);
    }
    if (
      !observation.arms ||
      !observation.arms.v2 ||
      !observation.arms.phase1b ||
      !Array.isArray(observation.arms.v2.products) ||
      !Array.isArray(observation.arms.phase1b.products)
    ) {
      throw new Error(`Observation ${caseId} must contain both completed arms and product lists`);
    }
    observedIds.add(caseId);
  }

  if (observedIds.size !== casesById.size) {
    throw new Error("Observation case IDs do not cover all preregistered cases");
  }
  if (observationsFile.selectedCaseIds) {
    const selected = new Set(observationsFile.selectedCaseIds.map(String));
    if (
      selected.size !== REQUIRED_CASE_COUNT ||
      [...casesById.keys()].some((id) => !selected.has(id))
    ) {
      throw new Error("selectedCaseIds do not match all 40 preregistered cases");
    }
  }
}

export function buildBlindPackets(
  observationsFile: ObservationFile,
  preregistration: { cases: PreregisteredCase[] },
  caseFileHash: string,
  batchSize: 5 | 10,
) {
  if (batchSize !== 5 && batchSize !== 10) {
    throw new Error("Packet batch size must be 5 or 10");
  }
  validateInputs(observationsFile, preregistration, caseFileHash);

  const observationsById = new Map(
    observationsFile.observations.map((observation) => [String(observation.caseId), observation]),
  );
  const cases = preregistration.cases.map((item) => {
    const observation = observationsById.get(String(item.id))!;
    const candidatesById = new Map<string, CandidateSnapshot>();
    for (const arm of [observation.arms.v2, observation.arms.phase1b]) {
      for (const product of arm.products) {
        const candidate = snapshot(product);
        const existing = candidatesById.get(candidate.id);
        if (!existing || stableJson(candidate).localeCompare(stableJson(existing)) < 0) {
          candidatesById.set(candidate.id, candidate);
        }
      }
    }
    const candidates = [...candidatesById.values()].sort((left, right) => {
      const leftHash = sha256(`${item.id}\u0000${left.id}`);
      const rightHash = sha256(`${item.id}\u0000${right.id}`);
      return leftHash.localeCompare(rightHash) || left.id.localeCompare(right.id);
    });
    return {
      caseId: item.id,
      query: item.query,
      intended: item.intended,
      hard: item.hard,
      preferences: item.preferences,
      expectedIdentity: item.expectedIdentity,
      useful: item.useful,
      irrelevant: item.irrelevant,
      exactRequired: item.exactRequired,
      alternativeAcceptable: item.alternativeAcceptable,
      candidates,
    };
  });

  const packets: Array<{ schemaVersion: 1; packet: number; cases: typeof cases }> = [];
  for (let offset = 0; offset < cases.length; offset += batchSize) {
    packets.push({
      schemaVersion: 1,
      packet: packets.length + 1,
      cases: cases.slice(offset, offset + batchSize),
    });
  }
  return packets;
}

export async function createBlindPackets(
  observationsPath: string,
  casesPath: string,
  outputDirectory: string,
  batchSize: 5 | 10,
): Promise<string[]> {
  if (!outputDirectory) throw new Error("An explicit output directory is required");
  const [observationBytes, caseBytes] = await Promise.all([
    readFile(observationsPath),
    readFile(casesPath),
  ]);
  const observations = JSON.parse(observationBytes.toString("utf8")) as ObservationFile;
  const preregistration = JSON.parse(caseBytes.toString("utf8")) as { cases: PreregisteredCase[] };
  const packets = buildBlindPackets(observations, preregistration, sha256(caseBytes), batchSize);
  const targetDirectory = resolve(outputDirectory);
  await mkdir(targetDirectory, { recursive: true });

  const paths: string[] = [];
  for (const packet of packets) {
    const outputPath = resolve(
      targetDirectory,
      `blind-packet-${String(packet.packet).padStart(2, "0")}.json`,
    );
    await writeFile(outputPath, `${JSON.stringify(packet, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    paths.push(outputPath);
  }
  return paths;
}

function usage(): string {
  return [
    "Usage:",
    "  pnpm exec tsx src/experiments/searchGoldPhase1/realEvaluation/blindPackets.ts <observations.json> <cases.json> <output-directory> <5|10>",
    "",
    "The observations file must contain a completed run of all 40 preregistered cases.",
    "Output files are written as blind-packet-01.json, blind-packet-02.json, etc.",
  ].join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , observationsPath, casesPath, outputDirectory, batchSizeArg] = process.argv;
  if (
    !observationsPath ||
    !casesPath ||
    !outputDirectory ||
    (batchSizeArg !== "5" && batchSizeArg !== "10")
  ) {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 1;
  } else {
    createBlindPackets(observationsPath, casesPath, outputDirectory, Number(batchSizeArg) as 5 | 10).then(
      (paths) => process.stdout.write(`Created ${paths.length} blinded packets in ${dirname(paths[0]!)}\n`),
      (error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      },
    );
  }
}