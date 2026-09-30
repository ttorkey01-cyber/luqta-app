import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadBenchmarkInput, scoreBenchmark, verifyCorpusSha256 } from "./evaluate";
import {
  ALLOWED_REASSESSMENT_IDS,
  createSensitivityInput,
  scoreGtinSensitivity,
} from "./gtin-sensitivity";
import type { IdentityRecord, PairClassification } from "../types";

const pair = (id: string, left: IdentityRecord, right: IdentityRecord) => ({
  id,
  sourceClass: "CONTROLLED" as const,
  category: "test",
  left,
  right,
});

const label = (id: string, classification: PairClassification) => ({
  id,
  classification,
  adequatelyAdjudicated: true,
  rationale: "independent test label",
  positiveEvidence: [],
  conflictingEvidence: [],
  unknownEvidence: [],
});

test("prepared corpus fingerprint verifies before loading", () => {
  assert.equal(loadBenchmarkInput().pairs.length, 136);
  assert.throws(() => verifyCorpusSha256("modified corpus"), /SHA-256 mismatch/);
});

test("score joins exclusively by blind ID mapping, not corpus order", () => {
  const a: IdentityRecord = {
    id: "a-left",
    title: "Acme Alpha shoe black size 9",
    brand: "Acme",
    model: "Alpha",
    category: "fashion",
    variant: { color: "black", size: "9" },
  };
  const b: IdentityRecord = {
    id: "a-right",
    title: "Acme Alpha shoe black size 9",
    brand: "Acme",
    model: "Alpha",
    category: "fashion",
    variant: { color: "black", size: "9" },
  };
  const c: IdentityRecord = {
    id: "b-left",
    title: "Other Beta lamp",
    brand: "Other",
    model: "Beta",
    category: "lighting",
  };
  const d: IdentityRecord = {
    id: "b-right",
    title: "Other Gamma lamp",
    brand: "Other",
    model: "Gamma",
    category: "lighting",
  };
  const result = scoreBenchmark({
    pairs: [
      pair("source-a", a, b),
      pair("source-b", c, d),
    ],
    blindPairs: [
      { id: "blind-b", left: c, right: d },
      { id: "blind-a", left: a, right: b },
    ],
    labels: [
      label("blind-a", "SAME_PRODUCT_SAME_VARIANT"),
      label("blind-b", "DIFFERENT_PRODUCT"),
    ],
    mapping: [
      { blindId: "blind-b", originalId: "source-b" },
      { blindId: "blind-a", originalId: "source-a" },
    ],
  });

  assert.deepEqual(
    result.cases.map((item) => [item.blindId, item.originalId]),
    [["blind-b", "source-b"], ["blind-a", "source-a"]],
  );
  assert.equal(result.corpusPairs, 2);
  assert.equal(result.metrics.exactIdentity.precision.value, 1);
  assert.equal(result.metrics.exactIdentity.recall.value, 1);
  assert.equal(result.metrics.classification.variantClassificationAccuracy.value, 1);
});

test("incomplete blind-ID joins are rejected", () => {
  const empty = {
    pairs: [],
    blindPairs: [],
    labels: [],
    mapping: [],
  };
  assert.equal(scoreBenchmark(empty).corpusPairs, 0);
  assert.throws(() => scoreBenchmark({
    ...empty,
    mapping: [{ blindId: "missing", originalId: "missing" }],
  }), /Incomplete blind-ID join/);
});

test("false EXACT rate uses exact assertions; nonmatch false positives remain separate", () => {
  const exact = (id: string): IdentityRecord => ({
    id,
    title: "Acme Alpha shoe black size 9",
    brand: "Acme",
    model: "Alpha",
    category: "fashion",
    variant: { color: "black", size: "9" },
  });
  const left1 = exact("true-left");
  const right1 = exact("true-right");
  const left2 = exact("true2-left");
  const right2 = exact("true2-right");
  const falseLeft = exact("false-left");
  const falseRight = exact("false-right");
  const differentLeft = exact("different-left");
  const differentRight: IdentityRecord = {
    ...exact("different-right"),
    model: "Beta",
    title: "Acme Beta shoe black size 9",
  };
  const pairs = [
    pair("truth-1", left1, right1),
    pair("truth-2", left2, right2),
    pair("false-exact", falseLeft, falseRight),
    pair("negative", differentLeft, differentRight),
  ];
  const input = {
    pairs,
    blindPairs: pairs.map((item, index) => ({
      id: `blind-${index}`,
      left: item.left,
      right: item.right,
    })),
    labels: [
      label("blind-0", "SAME_PRODUCT_SAME_VARIANT"),
      label("blind-1", "SAME_PRODUCT_SAME_VARIANT"),
      label("blind-2", "DIFFERENT_PRODUCT"),
      label("blind-3", "DIFFERENT_PRODUCT"),
    ],
    mapping: pairs.map((item, index) => ({
      blindId: `blind-${index}`,
      originalId: item.id,
    })),
  };
  const exactMetrics = scoreBenchmark(input).metrics.exactIdentity;
  assert.deepEqual(exactMetrics.falseExactRate, {
    numerator: 1,
    denominator: 3,
    value: 1 / 3,
  });
  assert.deepEqual(exactMetrics.nonmatchFalsePositiveRate, {
    numerator: 1,
    denominator: 2,
    value: 0.5,
  });
});

test("merge/split rates use actual grouping and isolate probable-class errors", () => {
  const sameProduct = (id: string, title: string, model?: string): IdentityRecord => ({
    id,
    title,
    brand: "Acme",
    ...(model ? { model } : {}),
    category: "fashion",
    ...(model ? { variant: { color: "black", size: "9" } } : {}),
  });
  const rows = [
    pair("false-merge", sameProduct("fm-l", "Acme Alpha shoe", "Alpha"),
      sameProduct("fm-r", "Acme Alpha shoe", "Alpha")),
    pair("negative", sameProduct("neg-l", "Acme Alpha shoe", "Alpha"),
      sameProduct("neg-r", "Acme Beta shoe", "Beta")),
    pair("probable", sameProduct("prob-l", "Acme running shoe"),
      sameProduct("prob-r", "Acme running shoe")),
    pair("false-split", sameProduct("split-l", "Acme Alpha shoe", "Alpha"),
      sameProduct("split-r", "Acme Beta shoe", "Beta")),
  ];
  const result = scoreBenchmark({
    pairs: rows,
    blindPairs: rows.map((item, index) => ({
      id: `blind-${index}`,
      left: item.left,
      right: item.right,
    })),
    labels: [
      label("blind-0", "DIFFERENT_PRODUCT"),
      label("blind-1", "DIFFERENT_PRODUCT"),
      label("blind-2", "DIFFERENT_PRODUCT"),
      label("blind-3", "SAME_PRODUCT_DIFFERENT_VARIANT"),
    ],
    mapping: rows.map((item, index) => ({
      blindId: `blind-${index}`,
      originalId: item.id,
    })),
  }).metrics;
  assert.deepEqual(result.classification.falseMerge, {
    numerator: 1,
    denominator: 3,
    value: 1 / 3,
  });
  assert.deepEqual(result.classification.falseSplit, {
    numerator: 1,
    denominator: 1,
    value: 1,
  });
  assert.deepEqual(result.classification.probableMisclassification.falsePredictionRate, {
    numerator: 1,
    denominator: 1,
    value: 1,
  });
});

test("cheaper scoring uses 2026-09-30 and reports comparable and unscoreable offers", () => {
  const product = (id: string, price: number, updatedAt: string): IdentityRecord => ({
    id,
    title: "Acme Alpha shoe black size 9",
    brand: "Acme",
    model: "Alpha",
    category: "fashion",
    variant: { color: "black", size: "9" },
    offer: {
      providerOfferId: id,
      price,
      currency: "SAR",
      availability: "in_stock",
      updatedAt,
    },
  });
  const fresh = pair("fresh", product("fresh-left", 200, "2026-09-25T00:00:00Z"),
    product("fresh-right", 150, "2026-09-25T00:00:00Z"));
  const stale = pair("stale", product("stale-left", 200, "2025-06-01T00:00:00Z"),
    product("stale-right", 150, "2025-06-01T00:00:00Z"));
  const rows = [fresh, stale];
  const metrics = scoreBenchmark({
    pairs: rows,
    blindPairs: rows.map((item, index) => ({
      id: `blind-${index}`,
      left: item.left,
      right: item.right,
    })),
    labels: [
      label("blind-0", "SAME_PRODUCT_SAME_VARIANT"),
      label("blind-1", "SAME_PRODUCT_SAME_VARIANT"),
    ],
    mapping: rows.map((item, index) => ({
      blindId: `blind-${index}`,
      originalId: item.id,
    })),
  }).metrics.sameProductCheaper;
  assert.equal(metrics.trueComparableOfferCoverage.numerator, 1);
  assert.equal(metrics.trueComparableOfferCoverage.denominator, 2);
  assert.equal(metrics.unsafeClaimCount, 0);
  assert.equal(metrics.trueClaimCount, 1);
  assert.equal(metrics.unsafeClaimRate.value, 0);
  assert.equal(metrics.unsafeClaimsPerComparableOffer.numerator, 0);
  assert.equal(metrics.unsafeClaimsPerComparableOffer.denominator, 1);
  assert.equal(metrics.trueComparableOfferDenominator, 1);
  assert.equal(metrics.notScoreableOfferCaseCount, 1);
  assert.deepEqual(metrics.notScoreableOfferCases[0].evidence[0].split(":")[0],
    "OFFER_STALE_OR_UNDATED");
});

test("GTIN sensitivity changes only the exact allowlist and leaves primary artifacts immutable", () => {
  const directory = new URL("./", import.meta.url);
  const labelsPath = new URL("blind-labels.json", directory);
  const primaryPath = new URL("scorecard.json", directory);
  const labelsBefore = readFileSync(labelsPath);
  const primaryBefore = readFileSync(primaryPath);
  const original = loadBenchmarkInput();
  const originalLabelsBefore = JSON.stringify(original.labels);
  const reassessment = JSON.parse(readFileSync(
    new URL("gtin-reassessment.json", directory), "utf8"));
  assert.deepEqual(reassessment.map((entry: { blindId: string }) => entry.blindId),
    ALLOWED_REASSESSMENT_IDS);

  const sensitivityInput = createSensitivityInput(original, reassessment);
  const sensitivity = scoreGtinSensitivity(original, reassessment, {
    primaryScorecard: "primary-hash",
    originalLabels: "labels-hash",
    reassessment: "reassessment-hash",
  });
  const changed = sensitivityInput.labels.filter((entry, index) =>
    entry.classification !== original.labels[index].classification);
  assert.deepEqual(changed.map((entry) => entry.id), ALLOWED_REASSESSMENT_IDS);
  assert.equal(changed.length, 8);
  assert.equal(sensitivity.sensitivity.reassessedCaseCount, 8);
  assert.equal(sensitivity.corpusPairs, 136);
  assert.equal(sensitivity.metrics.exactIdentity.recall.denominator, 25);
  assert.equal(JSON.stringify(original.labels), originalLabelsBefore);
  assert.deepEqual(readFileSync(labelsPath), labelsBefore);
  assert.deepEqual(readFileSync(primaryPath), primaryBefore);
});

test("GTIN sensitivity rejects any reassessment outside the fixed eight-case allowlist", () => {
  const original = loadBenchmarkInput();
  const reassessment = JSON.parse(readFileSync(
    new URL("gtin-reassessment.json", import.meta.url), "utf8"));
  assert.throws(() => createSensitivityInput(original, [
    ...reassessment,
    { ...reassessment[0], blindId: "PI-124" },
  ]), /outside the fixed allowlist/);
});