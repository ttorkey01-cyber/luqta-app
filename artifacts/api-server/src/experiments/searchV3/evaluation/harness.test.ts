import assert from "node:assert/strict";
import test from "node:test";
import {
  EVALUATION_CASES,
  EVALUATION_CATALOG,
  evaluationResultComplies,
  evaluateSearchV3,
  renderEvaluationMarkdown,
} from "./harness";

test("evaluation covers every requested shopping scenario with 20+ cases", () => {
  assert.ok(EVALUATION_CASES.length >= 20);
  const scenarios = EVALUATION_CASES.map(({ scenario }) => scenario.toLowerCase());
  for (const required of [
    "fashion",
    "handbag",
    "shoes",
    "watch",
    "beauty",
    "electronics",
    "automotive",
    "arabic",
    "english",
    "image-only",
    "image + text",
    "exact brand/model",
    "exact sku/model number",
    "maximum price",
    "price range",
    "different requested color",
    "used condition",
    "strict location and currency",
    "complex image background",
    "ambiguous image",
    "same product but cheaper",
    "visually similar alternative",
  ]) {
    assert.ok(scenarios.some((scenario) => scenario.includes(required)), `missing scenario: ${required}`);
  }
  assert.ok(EVALUATION_CATALOG.length >= 20);
});

test("cheaper ground truth requires the same exact model from a lower-price listing", async () => {
  const cheaperCase = EVALUATION_CASES.find((item) => item.id === "same-product-cheaper");
  assert.ok(cheaperCase);
  assert.deepEqual(cheaperCase.exactIds, ["sony-wh1000xm5-cheaper"]);
  assert.deepEqual(cheaperCase.closeIds, []);
  assert.equal(cheaperCase.reference?.model, "WH-1000XM5");

  const reference = EVALUATION_CATALOG.find((item) => item.id === "sony-wh1000xm5");
  const cheaperListing = EVALUATION_CATALOG.find((item) => item.id === cheaperCase.exactIds[0]);
  assert.ok(reference);
  assert.ok(cheaperListing);
  assert.equal(cheaperListing.brand, reference.brand);
  assert.equal(cheaperListing.model, reference.model);
  assert.ok(cheaperListing.price! < reference.price!);
  assert.notEqual(cheaperListing.productUrl, reference.productUrl);
  assert.ok(!cheaperCase.exactIds.includes("sony-whch720n"));

  const report = await evaluateSearchV3();
  const measuredCase = report.cases.find((item) => item.id === cheaperCase.id);
  assert.ok(measuredCase);
  assert.equal(measuredCase.v2.ids[0], "sony-wh1000xm5-cheaper");
  assert.equal(
    measuredCase.v3.ids.slice(0, 5).some((id) => cheaperCase.closeIds.includes(id)),
    false,
    "a different Sony model must not receive cheaper same-product relevance credit",
  );
});

test("location, currency, ambiguity, and constraint scoring cases are explicit", async () => {
  const strictCase = EVALUATION_CASES.find((item) => item.id === "strict-location-currency");
  assert.ok(strictCase?.constraints);
  assert.equal(strictCase.constraints.location, "Riyadh");
  assert.equal(strictCase.constraints.currency, "SAR");
  assert.equal(strictCase.constraints.condition, "used");
  assert.equal(evaluationResultComplies(["canon-eos-r50-used"], strictCase.constraints), true);
  assert.equal(evaluationResultComplies(["canon-eos-r50-used-dammam-usd"], strictCase.constraints), false);

  const ambiguous = EVALUATION_CASES.find((item) => item.id === "ambiguous-image");
  assert.ok(ambiguous?.image);
  assert.equal(ambiguous.exactIds.length, 0);
  assert.deepEqual(
    ambiguous.image.identities.map((identity) => identity.confidence),
    [0.54, 0.46],
  );
  assert.ok(ambiguous.closeIds.includes("casio-a168"));
  assert.ok(ambiguous.closeIds.includes("guess-watch-gold"));

  const priceCase = EVALUATION_CASES.find((item) => item.id === "maximum-price");
  assert.ok(priceCase?.constraints?.maxPrice);
  assert.equal(evaluationResultComplies(["sony-whch720n"], priceCase.constraints), true);
  assert.equal(evaluationResultComplies(["sony-wh1000xm5"], priceCase.constraints), false);

  const report = await evaluateSearchV3();
  const strictReport = report.cases.find((item) => item.id === strictCase.id);
  assert.ok(strictReport);
  assert.equal(strictReport.v3.constraintCompliant, evaluationResultComplies(strictReport.v3.ids, strictCase.constraints));
  assert.equal(strictReport.v3.constraintCompliant, true);
  const ambiguousReport = report.cases.find((item) => item.id === ambiguous.id);
  assert.ok(ambiguousReport);
  assert.ok(ambiguous.closeIds.some((id) => ambiguousReport.v3.ids.slice(0, 3).includes(id)));
  assert.equal(report.v2.diagnosticLatencyMs, null);
  assert.ok(report.v3.diagnosticLatencyMs);
  for (const result of report.cases) {
    assert.ok(Number.isFinite(result.v2.latencyMs));
    assert.ok(Number.isFinite(result.v3.latencyMs));
  }
});

test("V2 and V3 are evaluated offline against the same deterministic catalog", async () => {
  const report = await evaluateSearchV3();
  assert.equal(report.v2.cases, EVALUATION_CASES.length);
  assert.equal(report.v3.cases, EVALUATION_CASES.length);
  assert.equal(report.cases.length, EVALUATION_CASES.length);
  assert.equal(report.v2.braveCalls, 0);
  assert.equal(report.v3.braveCalls, 0);
  assert.equal(report.v2.apiCalls, 0);
  assert.equal(report.v3.apiCalls, 0);
  assert.ok(report.v2.providerCalls > 0);
  assert.ok(report.v3.providerCalls > 0);
  assert.ok(report.v3.diagnosticProviderInvocationCount > 0);
  assert.ok(report.limitations.some((item) => item.includes("pixel-level")));
  for (const [caseId, expectedId] of [
    ["same-product-cheaper", "sony-wh1000xm5-cheaper"],
    ["automotive-part", "toyota-camry-headlamp-2022"],
    ["new-condition", "toyota-camry-headlamp-2022"],
    ["arabic-price-condition", "toyota-camry-headlamp-used"],
  ]) {
    const row = report.cases.find((item) => item.id === caseId);
    assert.ok(row?.v3.ids.includes(expectedId), `${caseId}: expected ${expectedId}`);
  }

  const markdown = renderEvaluationMarkdown(report);
  assert.match(markdown, /Search V2 vs V3 offline evaluation/u);
  assert.match(markdown, /Per-case result IDs/u);
  assert.match(markdown, /Limitations/u);
});