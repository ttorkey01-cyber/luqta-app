import assert from "node:assert/strict";
import { test } from "node:test";
import { ResultNormalizer } from "../../connectors/resultNormalizer";
import {
  InventoryUnavailableError,
  type SearchOrchestrationResult,
} from "../../connectors/searchOrchestrator";
import type { ProviderMetadata, ProviderProduct } from "../../connectors/types";
import { searchGoldPhase1, type SearchV2 } from "./phase1Search";

const metadata = {
  id: "controlled-fixture", name: "CONTROLLED FIXTURE",
} as ProviderMetadata;

function product(
  id: string,
  title: string,
  overrides: Partial<ProviderProduct> = {},
) {
  return new ResultNormalizer().normalize({
    id, title, description: "CONTROLLED FIXTURE only",
    sourceType: "controlled_fixture", availability: "in_stock",
    category: "bags_accessories", productType: "handbag",
    price: 299, currency: "SAR", color: "black",
    ...overrides,
  }, metadata);
}

function v2(products: ReturnType<typeof product>[]): SearchV2 {
  return async () => ({ products } satisfies SearchOrchestrationResult);
}

test("empty query is invalid without calling any provider", async () => {
  const result = await searchGoldPhase1({ query: "  " }, async () => {
    throw Error("provider must not be called");
  });
  assert.equal(result.state, "INVALID_QUERY");
  assert.equal(result.executedQueries.length, 0);
});

test("strict Saudi price and color reject unknown and conflicting evidence", async () => {
  const result = await searchGoldPhase1(
    { query: "أبغى شنطة سوداء أقل من 300 ريال" },
    v2([
      product("good", "black handbag"),
      product("equal", "black handbag", { price: 300 }),
      product("unknown", "black handbag", { price: null }),
      product("wrong-color", "red handbag", { color: "red" }),
    ]),
  );
  assert.equal(result.state, "RESULTS_FOUND");
  assert.deepEqual(result.results.map((item) => item.product.id), ["good"]);
  assert.equal(result.rejected.length, 3);
  assert.equal(result.rejected.find((item) => item.product.id === "unknown")?.constraints.price.status, "unknown");
  assert.equal(result.rejected.find((item) => item.product.id === "wrong-color")?.constraints.color.status, "verified_fail");
});

test("unknown unrelated inventory is no confident match, not a filler result", async () => {
  const result = await searchGoldPhase1(
    { query: "unmatchable-fixture-token-55" },
    v2([product("blue-chair", "blue chair", { category: "home_living", productType: "chair" })]),
  );
  assert.equal(result.state, "NO_CONFIDENT_MATCH");
  assert.deepEqual(result.results, []);
});

test("unavailable providers are distinguished from an empty successful search", async () => {
  const request = { query: "handbag" };
  const unavailable = await searchGoldPhase1(request, async () => {
    throw new InventoryUnavailableError(["controlled-fixture"]);
  });
  const empty = await searchGoldPhase1(request, v2([]));
  assert.equal(unavailable.state, "PROVIDER_UNAVAILABLE");
  assert.deepEqual(unavailable.providerErrors, ["controlled-fixture"]);
  assert.equal(empty.state, "NO_CONFIDENT_MATCH");
});

test("partial provider failure is visible even when relevant offers remain", async () => {
  const result = await searchGoldPhase1(
    { query: "handbag" },
    async () => ({
      products: [product("good", "handbag")],
      __timings: {
        providerStageMs: 0, categoryFilterMs: 0, sortingDeduplicationMs: 0,
        rankingMs: 0,
        providerTimings: [{
          providerId: "broken-fixture", readinessWaitMs: 0, categoryIndexMs: 0,
          facetLookupMs: 0, ready: true, indexedProductCount: 1,
          refreshing: false, lastSuccessfulSync: null, resultCount: 0,
          durationMs: 0, timedOut: true, errorType: "Timeout",
        }],
      },
    }),
  );
  assert.equal(result.state, "RESULTS_FOUND");
  assert.equal(result.partialCoverage, true);
  assert.deepEqual(result.providerErrors, ["broken-fixture"]);
});

test("same item but cheaper cannot be claimed without a reference offer", async () => {
  const result = await searchGoldPhase1(
    { query: "أبغى نفس الساعة بس أرخص" },
    async () => { throw Error("no reference; do not retrieve"); },
  );
  assert.equal(result.state, "NO_CONFIDENT_MATCH");
  assert.equal(result.executedQueries.length, 0);
  assert.ok(result.clarificationReasons.some((reason) => reason.includes("reference")));
});