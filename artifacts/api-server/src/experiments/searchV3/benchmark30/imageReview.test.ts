import assert from "node:assert/strict";
import test from "node:test";
import { SEARCH_V3_BENCHMARK_30 } from "./groundTruth";
import { QUERY_IMAGE_REVIEWS } from "./imageReview";

test("manual query-image ground truth is complete before search scoring", () => {
  const linked = SEARCH_V3_BENCHMARK_30.filter((item) => item.imageReference);
  assert.equal(linked.length, 11);
  assert.equal(QUERY_IMAGE_REVIEWS.length, linked.length);
  assert.deepEqual(
    new Set(QUERY_IMAGE_REVIEWS.map((item) => item.caseId)),
    new Set(linked.map((item) => item.id)),
  );
  assert.equal(QUERY_IMAGE_REVIEWS.filter((item) => item.usable).length, 9);
  for (const item of QUERY_IMAGE_REVIEWS) {
    assert.ok(item.visibleCategory && item.visibleAttributes.length && item.uncertainty);
    assert.equal(Boolean(item.exclusionReason), !item.usable);
    assert.equal(item.visibleModel, null);
  }
});