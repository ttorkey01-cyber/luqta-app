import assert from "node:assert/strict";
import test from "node:test";
import { REAL_WORLD_IMAGE_CASES } from "../realWorld/manifest";
import { SEARCH_V3_BENCHMARK_30 } from "./groundTruth";

const expectedCounts = {
  "exact-product-identity": 6,
  "visually-similar": 6,
  "hard-constraints": 5,
  automotive: 4,
  "saudi-arabic": 4,
  "difficult-ambiguous-image": 3,
  "negative-no-match": 2,
} as const;

test("frozen pre-scoring definition has exactly 30 unique cases in disjoint requested groups", () => {
  assert.equal(SEARCH_V3_BENCHMARK_30.length, 30);
  const ids = SEARCH_V3_BENCHMARK_30.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length);

  for (const [group, expected] of Object.entries(expectedCounts)) {
    assert.equal(
      SEARCH_V3_BENCHMARK_30.filter((benchmarkCase) => benchmarkCase.group === group).length,
      expected,
      `unexpected case count for ${group}`,
    );
  }
  assert.equal(
    Object.values(expectedCounts).reduce((total, count) => total + count, 0),
    SEARCH_V3_BENCHMARK_30.length,
    "one group assignment per case must account for all 30 cases",
  );
});

test("every case has a complete pre-scoring adjudication rubric and no embedded results", () => {
  for (const benchmarkCase of SEARCH_V3_BENCHMARK_30) {
    assert.ok(benchmarkCase.id.trim());
    assert.ok(benchmarkCase.query.trim());
    assert.ok(benchmarkCase.intendedProduct.trim());
    assert.ok(benchmarkCase.category.trim());
    assert.ok(Array.isArray(benchmarkCase.hardConstraints));
    assert.ok(benchmarkCase.exactCriteria.length > 0, `${benchmarkCase.id}: exact criteria required`);
    assert.ok(Array.isArray(benchmarkCase.closeCriteria), `${benchmarkCase.id}: close criteria must be explicit`);
    assert.ok(benchmarkCase.unacceptableCriteria.length > 0, `${benchmarkCase.id}: unacceptable criteria required`);
    assert.ok(benchmarkCase.expectedNoMatchBehavior.trim(), `${benchmarkCase.id}: no-match behavior required`);

    if (benchmarkCase.identityEvidence) {
      assert.equal(benchmarkCase.identityEvidence.type, "user-entered-model-or-sku");
      assert.equal(
        benchmarkCase.identityEvidence.limitation,
        "User-entered evidence only; not independently verified manufacturer identity or fitment.",
      );
    }
    assert.ok(!("results" in benchmarkCase));
    assert.ok(!("metrics" in benchmarkCase));
    assert.ok(!("candidateIds" in benchmarkCase));
  }
});

test("the six exact-identity cases cover the requested product examples with user-entered evidence", () => {
  const exactCases = SEARCH_V3_BENCHMARK_30.filter(({ group }) => group === "exact-product-identity");
  assert.equal(exactCases.length, 6);
  assert.deepEqual(
    new Set(exactCases.map(({ category }) => category)),
    new Set(["watches", "shoes", "handbags", "smartphones", "beauty-and-skincare", "fashion"]),
  );
  for (const benchmarkCase of exactCases) {
    assert.ok(benchmarkCase.identityEvidence, `${benchmarkCase.id}: user-entered identity evidence required`);
    assert.equal(benchmarkCase.identityEvidence.type, "user-entered-model-or-sku");
    assert.ok(benchmarkCase.identityEvidence.value.trim());
    assert.ok(benchmarkCase.exactCriteria.length > 0);
    assert.ok(benchmarkCase.closeCriteria.length > 0);
    assert.ok(benchmarkCase.unacceptableCriteria.length > 0);
  }
});

test("text-only cases need no image; Wikimedia references inherit provenance and stay pending verification", () => {
  const manifestById = new Map(REAL_WORLD_IMAGE_CASES.map((item) => [item.id, item]));
  const imageCases = SEARCH_V3_BENCHMARK_30.filter(({ imageReference }) => imageReference);
  const textOnlyCases = SEARCH_V3_BENCHMARK_30.filter(({ imageReference }) => !imageReference);

  assert.ok(imageCases.length > 0);
  assert.ok(textOnlyCases.length > 0);
  for (const benchmarkCase of imageCases) {
    const reference = benchmarkCase.imageReference!;
    const manifestCase = manifestById.get(reference.manifestCaseId);
    assert.ok(manifestCase, `${benchmarkCase.id}: unknown real-world manifest id ${reference.manifestCaseId}`);
    assert.equal(reference.verification, "pending-independent-verification");
    assert.equal(reference.provenance, "inherit-from-realWorld-manifest");
    assert.equal(manifestCase!.source, "Wikimedia Commons");
    assert.ok(manifestCase!.license.trim());
    assert.ok(manifestCase!.licenseUrl.startsWith("https://creativecommons.org/"));
  }
  assert.ok(textOnlyCases.every(({ imageReference }) => imageReference === undefined));
});