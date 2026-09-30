import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { IndependentLabels } from "./score.js";

type Case = {
  id: number | string;
  query: string;
  intended?: unknown;
  hard?: unknown;
  preferences?: unknown;
  expectedIdentity?: unknown;
  useful?: unknown;
  irrelevant?: unknown;
  exactRequired?: unknown;
  alternativeAcceptable?: unknown;
};

type Candidate = { id: string; [key: string]: unknown };
type RecoveryObservation = {
  caseId: number | string;
  query: string;
  arms: Record<string, { products: Candidate[] }>;
};
type RecoveryFile = { observations: RecoveryObservation[] };
type HistoricalFile = { observations: RecoveryObservation[] } | RecoveryObservation[];

const ARMS = ["v2", "phase1b", "recovery"] as const;
const URL_PATTERN =
  /\b(?:https?:\/\/|www\.)\S+|\b(?:[\w-]+\.)+(?:com|net|org|sa|co|io|shop|store)(?:\/\S*)?/giu;
const PRIVATE_KEY =
  /(?:url|link|provider|arm|rank|classification|strategy|secret|token|credential|password|authorization|api.?key)/iu;
const EVIDENCE_FIELDS = [
  "title", "description", "metadata", "brand", "productType", "category", "color",
  "price", "currency", "condition", "location", "availability", "availabilityStatus",
  "stock", "stockStatus", "stockQuantity", "inStock", "quantity", "inventoryStatus",
  "updatedAt",
] as const;

function idKey(value: number | string): string {
  return String(value);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function sanitize(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(URL_PATTERN, "[URL removed]").replace(/\s+/gu, " ").trim();
  }
  if (Array.isArray(value)) return value.map(sanitize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !PRIVATE_KEY.test(key))
      .map(([key, child]) => [key, sanitize(child)]));
  }
  return value;
}

function safeEvidence(product: Candidate): Candidate {
  if (typeof product.id !== "string" || !/^[a-f0-9]{24}$/iu.test(product.id)) {
    throw new Error("Recovery candidate is missing its stable opaque 24-character ID");
  }
  const safe: Candidate = { id: product.id };
  for (const field of EVIDENCE_FIELDS) {
    if (Object.hasOwn(product, field)) safe[field] = sanitize(product[field]);
  }
  return safe;
}

function observationRows(file: HistoricalFile): RecoveryObservation[] {
  return Array.isArray(file) ? file : file.observations;
}

function evidenceByCaseAndId(rows: RecoveryObservation[]): Map<string, Map<string, string>> {
  const result = new Map<string, Map<string, string>>();
  for (const row of rows) {
    const caseId = idKey(row.caseId);
    const evidenceSets = new Map<string, Map<string, Set<string>>>();
    for (const arm of ARMS) {
      for (const product of row.arms?.[arm]?.products ?? []) {
        if (typeof product.id !== "string") continue;
        const evidence = safeEvidence(product);
        const fields = evidenceSets.get(product.id) ?? new Map<string, Set<string>>();
        for (const [field, value] of Object.entries(evidence)) {
          if (field === "id") continue;
          const values = fields.get(field) ?? new Set<string>();
          values.add(stableJson(value));
          fields.set(field, values);
        }
        evidenceSets.set(product.id, fields);
      }
    }
    const candidates = new Map<string, string>();
    for (const [candidateId, fields] of evidenceSets) {
      candidates.set(candidateId, stableJson(Object.fromEntries(
        [...fields].sort(([a], [b]) => a.localeCompare(b))
          .map(([field, values]) => [field, [...values].sort()]),
      )));
    }
    result.set(caseId, candidates);
  }
  return result;
}

/** Returns current IDs with no historical snapshot or changed safe evidence. */
export function changedRecoveryEvidenceIds(
  historicalRows: RecoveryObservation[],
  currentRows: RecoveryObservation[],
): Map<string, Set<string>> {
  const history = evidenceByCaseAndId(historicalRows);
  const current = evidenceByCaseAndId(currentRows);
  const changed = new Map<string, Set<string>>();
  for (const [caseId, currentCandidates] of current) {
    const oldCandidates = history.get(caseId);
    const changedIds = new Set<string>();
    for (const [candidateId, fingerprint] of currentCandidates) {
      if (oldCandidates?.get(candidateId) !== fingerprint) changedIds.add(candidateId);
    }
    changed.set(caseId, changedIds);
  }
  return changed;
}

function previouslyJudgedIds(labels: IndependentLabels): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const row of labels.cases) {
    const ids = new Set<string>();
    const sharedLabels = (row as typeof row & { candidates?: Array<{ id: string }> }).candidates ?? [];
    for (const candidate of sharedLabels) ids.add(candidate.id);
    for (const arm of ARMS) {
      for (const candidate of row.arms?.[arm as "v2" | "phase1b"]?.candidates ?? []) {
        ids.add(candidate.id);
      }
    }
    result.set(idKey(row.caseId), ids);
  }
  return result;
}

export function buildRecoveryBlindPackets(
  observations: RecoveryFile,
  preregistration: { cases: Case[] },
  existingLabels: IndependentLabels,
  historicalObservations: HistoricalFile,
  batchSize: 5 | 10 = 5,
) {
  if (batchSize !== 5 && batchSize !== 10) throw new Error("Packet batch size must be 5 or 10");
  if (!Array.isArray(observations.observations) || !Array.isArray(preregistration.cases)) {
    throw new Error("Recovery observations and preregistered cases must be arrays");
  }
  if (existingLabels.schemaVersion !== 1 || !Array.isArray(existingLabels.cases)) {
    throw new Error("Existing independent labels must use schemaVersion 1");
  }
  const historicalRows = observationRows(historicalObservations);
  if (!Array.isArray(historicalRows)) {
    throw new Error("Historical observations must be an array or contain an observations array");
  }
  const caseMap = new Map(preregistration.cases.map((item) => [idKey(item.id), item]));
  const observationMap = new Map<string, RecoveryObservation>();
  for (const row of observations.observations) {
    const id = idKey(row.caseId);
    if (!caseMap.has(id) || observationMap.has(id)) {
      throw new Error(`Recovery observation caseId ${id} is unknown or duplicated`);
    }
    if (row.query !== caseMap.get(id)?.query) {
      throw new Error(`Recovery observation query does not match preregistered case ${id}`);
    }
    for (const arm of ARMS) {
      if (!Array.isArray(row.arms?.[arm]?.products)) {
        throw new Error(`Recovery observation ${id} must contain ${arm} products`);
      }
    }
    observationMap.set(id, row);
  }
  const alreadyJudged = previouslyJudgedIds(existingLabels);
  const historicalEvidence = evidenceByCaseAndId(historicalRows);
  const casePackets = preregistration.cases.map((item) => {
    const caseId = idKey(item.id);
    const observation = observationMap.get(caseId);
    if (!observation) throw new Error(`Missing recovery observation for case ${caseId}`);
    const merged = new Map<string, Candidate>();
    const currentEvidence = evidenceByCaseAndId([observation]).get(caseId) ?? new Map<string, string>();
    for (const arm of ARMS) {
      for (const product of observation.arms[arm].products) {
        const candidate = safeEvidence(product);
        const previous = merged.get(candidate.id);
        if (!previous || stableJson(candidate).localeCompare(stableJson(previous)) < 0) {
          merged.set(candidate.id, candidate);
        }
      }
    }
    const judged = alreadyJudged.get(caseId) ?? new Set<string>();
    const oldEvidence = historicalEvidence.get(caseId) ?? new Map<string, string>();
    const candidates = [...merged.values()]
      .filter((candidate) => !judged.has(candidate.id) ||
        oldEvidence.get(candidate.id) !== currentEvidence.get(candidate.id))
      .sort((a, b) => createHash("sha256").update(`${caseId}\0${a.id}`).digest("hex")
        .localeCompare(createHash("sha256").update(`${caseId}\0${b.id}`).digest("hex")) ||
        a.id.localeCompare(b.id));
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
  const packets: Array<{ schemaVersion: 1; packet: number; cases: typeof casePackets }> = [];
  for (let i = 0; i < casePackets.length; i += batchSize) {
    packets.push({ schemaVersion: 1, packet: packets.length + 1, cases: casePackets.slice(i, i + batchSize) });
  }
  return packets;
}

export async function prepareRecoveryBlind(
  observationsPath: string,
  casesPath: string,
  existingLabelsPath: string,
  historicalObservationsPath: string,
  outputDirectory: string,
  batchSize: 5 | 10 = 5,
): Promise<string[]> {
  if (!outputDirectory) throw new Error("An explicit output directory is required");
  const [observationsBytes, casesBytes, labelsBytes, historicalBytes] = await Promise.all([
    readFile(observationsPath), readFile(casesPath), readFile(existingLabelsPath),
    readFile(historicalObservationsPath),
  ]);
  const packets = buildRecoveryBlindPackets(
    JSON.parse(observationsBytes.toString("utf8")) as RecoveryFile,
    JSON.parse(casesBytes.toString("utf8")) as { cases: Case[] },
    JSON.parse(labelsBytes.toString("utf8")) as IndependentLabels,
    JSON.parse(historicalBytes.toString("utf8")) as HistoricalFile,
    batchSize,
  );
  const target = resolve(outputDirectory);
  await mkdir(target, { recursive: true });
  const paths: string[] = [];
  for (const packet of packets) {
    const path = resolve(target, `recovery-blind-packet-${String(packet.packet).padStart(2, "0")}.json`);
    await writeFile(path, `${JSON.stringify(packet, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    paths.push(path);
  }
  return paths;
}

function usage(): string {
  return [
    "Usage:",
    "  pnpm exec tsx src/experiments/searchGoldPhase1/realEvaluation/prepareRecoveryBlind.ts <recovery-observations.json> <cases.json> <independent-labels.json> <historical-observations.json> <output-directory> [5|10]",
    "",
    "Creates packets for unjudged IDs and previously judged IDs whose safe evidence changed since the historical run.",
    "Packets contain no arm/rank/classification/strategy or provider/source URLs.",
  ].join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , observations, cases, labels, historical, output, sizeArg = "5"] = process.argv;
  if (!observations || !cases || !labels || !historical || !output ||
    (sizeArg !== "5" && sizeArg !== "10")) {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 1;
  } else {
    prepareRecoveryBlind(
      observations, cases, labels, historical, output, Number(sizeArg) as 5 | 10,
    ).then(
      (paths) => process.stdout.write(`Created ${paths.length} blinded packet(s) in ${resolve(output)}\n`),
      (error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      },
    );
  }
}