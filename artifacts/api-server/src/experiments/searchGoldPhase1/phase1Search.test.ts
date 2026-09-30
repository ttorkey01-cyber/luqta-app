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

test("bounded exact then lexical retrieval recovers separate merchant offers", async () => {
  const calls: string[] = [];
  const result = await searchGoldPhase1(
    { query: "FixtureBrand Shared Model P-20" },
    async (request) => {
      calls.push(request.query);
      return {
        products: request.query === "P-20" ? [] : [
          product("offer-a", "FixtureBrand Shared Model P-20", { merchant: "Shop A" }),
          product("offer-b", "FixtureBrand Shared Model P-20", { merchant: "Shop B" }),
        ],
      };
    },
  );
  assert.equal(calls[0], "P-20");
  assert.equal(calls[1], "FixtureBrand Shared Model P-20");
  assert.ok(calls.length <= 4);
  assert.deepEqual(result.results.map((item) => item.product.id).sort(), ["offer-a", "offer-b"]);
  assert.equal(result.executedQueries[1]?.stage, "LEXICAL");
  assert.equal(result.identityGroups.flatMap((group) =>
    group.variants.flatMap((variant) => variant.offers)).length, 2);
});

test("same-title model offers cannot claim a saving without verified variant identity and fresh prices", async () => {
  const result = await searchGoldPhase1(
    { query: "FixtureBrand ExactModel Z-4 cheaper offer" },
    v2([
      product("lower", "FixtureBrand ExactModel Z-4", { merchant: "Shop B", price: 95 }),
      product("reference", "FixtureBrand ExactModel Z-4", { merchant: "Shop A", price: 120 }),
      product("lookalike", "FixtureBrand ExactModel Z-5", { merchant: "Shop C", price: 70 }),
    ]),
  );
  assert.deepEqual(result.results, []);
  assert.deepEqual(result.comparisonEvidence, []);
  assert.equal(result.state, "NO_CONFIDENT_MATCH");
});

test("fresh in-stock matching GTIN variants can be compared across two offers", async () => {
  const updatedAt = new Date().toISOString();
  const result = await searchGoldPhase1(
    { query: "GTIN-14 00012345678905 cheaper offer" },
    v2([
      product("lower", "GTIN-14 00012345678905 handbag", {
        price: 95, merchant: "Shop B", updatedAt, condition: "new",
      }),
      product("reference", "GTIN-14 00012345678905 handbag", {
        price: 120, merchant: "Shop A", updatedAt, condition: "new",
      }),
      product("lookalike", "GTIN-14 00012345678912 handbag", {
        price: 70, merchant: "Shop C", updatedAt, condition: "new",
      }),
    ]),
  );
  assert.deepEqual(result.results.map((item) => item.product.id), ["lower"]);
  assert.deepEqual(result.comparisonEvidence.map(({ cheaperOfferId, referenceOfferId, difference }) =>
    [cheaperOfferId, referenceOfferId, difference]), [["lower", "reference", 25]]);
});

test("current offer stays visible when an out-of-stock offer shares its identity", async () => {
  const result = await searchGoldPhase1(
    { query: "FixtureBrand stale current offer P-51" },
    v2([
      product("stale", "FixtureBrand stale current offer P-51", {
        price: 70, availability: "out_of_stock",
      }),
      product("current", "FixtureBrand current offer P-51", {
        price: 95, availability: "in_stock",
      }),
    ]),
  );
  assert.ok(result.results.some((item) => item.product.id === "current"));
  assert.ok(result.results.every((item) => item.product.id !== "stale"));
  assert.ok(result.rejected.some((item) => item.product.id === "stale"));
});

test("same-merchant conflicting condition evidence never asserts exact identity", async () => {
  const result = await searchGoldPhase1(
    { query: "FixtureBrand Conflicted Product C-61" },
    v2([
      product("source-a", "FixtureBrand Conflicted Product C-61", {
        merchant: "Same Shop", condition: "new",
      }),
      product("source-b", "FixtureBrand Conflicted Product C-61", {
        merchant: "Same Shop", condition: "used",
      }),
    ]),
  );
  assert.equal(result.state, "CONFLICTING_EVIDENCE");
  assert.ok(result.results.every((candidate) => candidate.classification !== "EXACT"));
  assert.ok(result.clarificationReasons.some((reason) => reason.includes("conflicting conditions")));
});

test("soft Saudi budget can recover a pricier alternative without relaxing hard caps", async () => {
  const result = await searchGoldPhase1(
    { query: "أبي شنطة بحدود 250 ريال" },
    async (request) => ({
      products: request.intent?.approximatePrice
        ? [product("near", "شنطة", { price: 250 })]
        : [
            product("near", "شنطة", { price: 250 }),
            product("above", "شنطة", { price: 420 }),
          ],
    }),
  );
  assert.equal(result.intent?.budget.value?.max, null);
  assert.equal(result.intent?.budget.value?.approximate, 250);
  assert.ok(result.results.some((candidate) => candidate.product.id === "above"));
  assert.equal(result.executedQueries[1]?.stage, "LEXICAL");
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
    v2([product("only-offer", "ساعة يد", { price: 100 })]),
  );
  assert.equal(result.state, "NO_CONFIDENT_MATCH");
  assert.ok(result.executedQueries.length > 0);
  assert.equal(result.comparisonEvidence.length, 0);
  assert.ok(result.clarificationReasons.some((reason) => reason.includes("reference")));
});