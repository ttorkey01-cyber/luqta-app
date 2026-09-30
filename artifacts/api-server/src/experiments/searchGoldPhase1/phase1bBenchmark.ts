import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runPhase1Benchmark } from "./phase1Benchmark";

const PHASE1_FILE = new URL("./phase1-results.json", import.meta.url);
const PHASE1_SCORECARD_FILE = new URL("./scorecard.json", import.meta.url);
const PHASE1_SHA256 = "96200c055607c6f8b93e5fbc5c9d195c84716b7c45a7af5f8856ef909a9afe2b";
const PHASE1_SCORECARD_SHA256 = "fc7aa50f59db469bdb9801b931a4b970bd5d873921680cadc0518f6af31e8f5b";

type Snapshot = {
  caseId: number;
  status: "PASS" | "FAIL";
  response?: {
    products: Array<{ id: string }>;
    classifications?: Record<string, string>;
    interactionState?: string;
  };
};

function frozenJson<T>(url: URL, expectedHash: string): T {
  const bytes = readFileSync(url);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expectedHash) {
    throw new Error(`Frozen Phase 1 artifact hash mismatch: ${fileURLToPath(url)} (${actual})`);
  }
  return JSON.parse(bytes.toString("utf8")) as T;
}

/** Phase 1 and V2 outputs remain frozen. Only Phase 1B results are generated. */
export async function runPhase1bBenchmark() {
  const previous = frozenJson<{
    baseline: { sha256: string };
    phase1: { pass: number; fail: number; cases: Snapshot[] };
  }>(PHASE1_FILE, PHASE1_SHA256);
  const previousScorecard = frozenJson<{
    scorecard: { metrics: Record<string, unknown> };
  }>(PHASE1_SCORECARD_FILE, PHASE1_SCORECARD_SHA256);
  const current = await runPhase1Benchmark();
  if (previous.baseline.sha256 !== current.baseline.sha256 ||
      previous.phase1.cases.length !== current.phase1.cases.length ||
      current.phase1.cases.length !== 39) {
    throw new Error("The frozen V2 or Phase 1 acceptance suite does not match the Phase 1B run.");
  }
  const previousById = new Map(previous.phase1.cases.map((item) => [item.caseId, item]));
  const cases = current.phase1.cases.map((item) => {
    const prior = previousById.get(item.caseId);
    if (!prior) throw new Error(`Missing frozen Phase 1 case ${item.caseId}`);
    const before = prior.response;
    const after = item.response;
    const oldProducts = before?.products.map((product) => product.id) ?? [];
    const newProducts = after?.products.map((product) => product.id) ?? [];
    return {
      caseId: item.caseId,
      title: item.title,
      phase1: prior.status,
      phase1b: item.status,
      transition: prior.status === "FAIL" && item.status === "PASS"
        ? "FAIL_TO_PASS"
        : prior.status === "PASS" && item.status === "FAIL"
          ? "PASS_TO_FAIL"
          : "UNCHANGED",
      phase1State: before?.interactionState ?? null,
      phase1bState: after?.interactionState ?? null,
      phase1DisplayedIds: oldProducts,
      phase1bDisplayedIds: newProducts,
      noMatchToUsefulResult: before?.interactionState === "no_match" && newProducts.length > 0,
      filteredPreviouslyDisplayedIds: oldProducts.filter((id) => !newProducts.includes(id)),
      exactDowngradedIds: oldProducts.filter(
        (id) => before?.classifications?.[id] === "exact" &&
          after?.classifications?.[id] !== "exact",
      ),
      similarPromotedToExactIds: newProducts.filter(
        (id) => before?.classifications?.[id] === "similar" &&
          after?.classifications?.[id] === "exact",
      ),
    };
  });
  return {
    schemaVersion: 1,
    benchmarkVersion: "phase1b-controlled-fixture-2026-09-30",
    generatedAt: new Date().toISOString(),
    classification: "CONTROLLED FIXTURE",
    realObservedCount: 0,
    baseline: current.baseline,
    frozenPhase1: {
      file: "phase1-results.json",
      sha256: PHASE1_SHA256,
      scorecardFile: "scorecard.json",
      scorecardSha256: PHASE1_SCORECARD_SHA256,
      pass: previous.phase1.pass,
      fail: previous.phase1.fail,
      metrics: previousScorecard.scorecard.metrics,
    },
    phase1b: current.phase1,
    v2Comparison: current.comparison,
    phase1Comparison: {
      summary: {
        casesCompared: cases.length,
        improvements: cases.filter((item) => item.transition === "FAIL_TO_PASS").length,
        regressions: cases.filter((item) => item.transition === "PASS_TO_FAIL").length,
        noMatchToUsefulResult: cases.filter((item) => item.noMatchToUsefulResult).length,
      },
      cases,
    },
    scorecard: current.scorecard,
    caveat: "All data and measurements are controlled fixtures, not real inventory or production quality. The frozen V2 hash attests output bytes, not a historical fixture-corpus hash.",
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runPhase1bBenchmark();
  writeFileSync(
    fileURLToPath(new URL("./phase1b-results.json", import.meta.url)),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  writeFileSync(
    fileURLToPath(new URL("./phase1b-scorecard.json", import.meta.url)),
    `${JSON.stringify({
      schemaVersion: result.schemaVersion,
      benchmarkVersion: result.benchmarkVersion,
      generatedAt: result.generatedAt,
      classification: result.classification,
      baseline: result.baseline,
      frozenPhase1: {
        file: result.frozenPhase1.file,
        sha256: result.frozenPhase1.sha256,
        pass: result.frozenPhase1.pass,
        fail: result.frozenPhase1.fail,
        metrics: result.frozenPhase1.metrics,
      },
      phase1bSummary: {
        pass: result.phase1b.pass,
        fail: result.phase1b.fail,
        comparedCaseCount: result.phase1b.cases.length,
      },
      v2Comparison: result.v2Comparison.summary,
      phase1Comparison: result.phase1Comparison,
      scorecard: result.scorecard,
      caveat: result.caveat,
    }, null, 2)}\n`,
  );
  console.log(`Phase 1B: ${result.phase1b.pass}/39 PASS, ${result.phase1Comparison.summary.improvements} improved, ${result.phase1Comparison.summary.regressions} regressed vs Phase 1.`);
}