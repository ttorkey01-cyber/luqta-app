import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateHuntResults,
  huntNotificationResultKey,
  huntSearchCacheKey,
  type MonitorableHunt,
} from "./huntMonitoring";
import { createDefaultProviderRegistry } from "./providerRegistry";
import type { NormalizedProduct, QueryIntent } from "./types";

function makeProduct(
  overrides: Partial<NormalizedProduct> = {},
): NormalizedProduct {
  return {
    id: "diesel-123",
    providerProductId: "diesel-123",
    title: "Diesel Men's Black Jeans",
    description: "New season jeans",
    price: 350,
    currency: "SAR",
    merchant: "Diesel",
    brand: "Diesel",
    condition: "new",
    availability: "in_stock",
    sourceType: "affiliate",
    providerId: "diesel-ksa",
    providerName: "Diesel KSA",
    isAffiliate: true,
    rankScore: 1,
    priceScore: 1,
    availabilityScore: 1,
    conditionScore: 1,
    locationScore: 1,
    canonical: {
      brand: "Diesel",
      category: "clothing",
      productType: "jeans",
      attributes: {},
    },
    ...overrides,
  } as NormalizedProduct;
}

function makeHunt(
  overrides: Partial<MonitorableHunt> = {},
): MonitorableHunt {
  const structuredIntent: QueryIntent = {
    raw: "Diesel men's black jeans",
    normalized: "Diesel men's black jeans",
    keywords: ["diesel", "mens", "black", "jeans"],
    brand: "Diesel",
    audience: "men",
    productType: "jeans",
    currency: "SAR",
  };
  return {
    id: "hunt-1",
    query: structuredIntent.raw!,
    originalQuery: structuredIntent.raw!,
    structuredIntent,
    targetPrice: null,
    currency: "SAR",
    condition: "any",
    ...overrides,
  };
}

test("unknown-price discoveries remain visible but cannot trigger an alert", () => {
  const product = makeProduct({ price: null, currency: null });
  const result = evaluateHuntResults(makeHunt({ targetPrice: 200 }), [product]);

  assert.equal(result.discoveryMatches.length, 1);
  assert.equal(result.discoveryMatches[0]?.price, null);
  assert.equal(result.discoveryMatches[0]?.priceStatus, "unavailable");
  assert.equal(result.bestMatch, null);
  assert.deepEqual(result.notificationCandidates, []);
  assert.equal(result.matchStatus, "no_verified_price");
});

test("only verified within-budget prices qualify for target-price alerts", () => {
  const below = makeProduct({
    id: "below",
    providerProductId: "below",
    price: 180,
  });
  const above = makeProduct({
    id: "above",
    providerProductId: "above",
    price: 240,
  });
  const unknown = makeProduct({
    id: "unknown",
    providerProductId: "unknown",
    price: null,
    currency: null,
  });
  const result = evaluateHuntResults(
    makeHunt({ targetPrice: 200 }),
    [above, unknown, below],
  );

  assert.equal(result.discoveryMatches.length, 3);
  assert.equal(result.bestMatch?.id, "below");
  assert.deepEqual(
    result.notificationCandidates.map((product) => product.id),
    ["below"],
  );
});

test("original and OEM claims require listing evidence and replica listings are rejected", () => {
  const intent: QueryIntent = {
    raw: "Toyota Camry 2020 OEM control arm original",
    normalized: "Toyota Camry 2020 OEM control arm original",
    keywords: ["toyota", "camry", "control arm", "oem", "original"],
    vehicleMake: "Toyota",
    vehicleModel: "Camry",
    vehicleYear: "2020",
    partName: "control arm",
    oemNumber: "48068-06140",
  };
  const hunt = makeHunt({
    query: intent.raw!,
    originalQuery: intent.raw!,
    structuredIntent: intent,
    targetPrice: 500,
  });
  const missingEvidence = makeProduct({
    id: "no-evidence",
    title: "Toyota Camry 2020 Control Arm 48068-06140",
    description: "Front suspension part",
    brand: "Toyota",
    productUrl: "https://parts.example/item-1",
  });
  const original = makeProduct({
    id: "original",
    title: "Toyota Camry 2020 Original OEM Control Arm 48068-06140",
    description: "Genuine Toyota replacement part",
    brand: "Toyota",
    productUrl: "https://parts.example/item-2",
  });
  const replica = makeProduct({
    id: "replica",
    title: "Toyota Camry 2020 Original OEM Control Arm 48068-06140",
    description: "Replica copy",
    brand: "Toyota",
    productUrl: "https://parts.example/item-3",
  });
  const result = evaluateHuntResults(hunt, [
    missingEvidence,
    original,
    replica,
  ]);

  assert.deepEqual(
    result.discoveryMatches.map((product) => product.id),
    ["original"],
  );
  assert.deepEqual(
    result.notificationCandidates.map((product) => product.id),
    ["original"],
  );
});

test("equivalent structured intents share a search cache key across budgets", () => {
  const first: QueryIntent = {
    raw: "Toyota Camry 2020 control arm under 400 SAR",
    normalized: "Toyota Camry 2020 control arm under 400 SAR",
    keywords: ["toyota", "camry", "control arm"],
    vehicleMake: "Toyota",
    vehicleModel: "Camry",
    vehicleYear: "2020",
    partName: "control arm",
    currency: "SAR",
    maxPrice: 400,
  };
  const second: QueryIntent = {
    ...first,
    raw: "Toyota Camry 2020 control arm under 900 SAR",
    normalized: "Toyota Camry 2020 control arm under 900 SAR",
    maxPrice: 900,
  };

  assert.equal(
    huntSearchCacheKey(first, ["nazih", "diesel"]),
    huntSearchCacheKey(second, ["diesel", "nazih"]),
  );
  assert.notEqual(huntSearchCacheKey(first, ["nazih"]), huntSearchCacheKey(first, ["diesel"]));
});

test("notification identity is stable and deduplicates cross-provider listings", () => {
  const first = makeProduct({ id: "current-id", providerProductId: "stable-id" });
  const refreshed = makeProduct({ id: "new-local-id", providerProductId: "stable-id" });
  const duplicatedFromAnotherProvider = makeProduct({
    id: "other-provider-id",
    providerProductId: "other-id",
    providerId: "other-provider",
  });

  assert.equal(
    huntNotificationResultKey(first),
    huntNotificationResultKey(refreshed),
  );
  assert.equal(
    huntNotificationResultKey(first),
    huntNotificationResultKey(duplicatedFromAnotherProvider),
  );
});

test("monitoring provider registry construction does not start feed refreshes", async () => {
  const feedKeys = [
    "ADMITAD_ALIEXPRESS_HOT_PRODUCTS_CSV_URL",
    "ADMITAD_NAZIH_FEED_URL",
    "ADMITAD_DIESEL_KSA_EN_FEED_URL",
    "ADMITAD_STYLEWE_FEED_URL",
    "ADMITAD_LUXURY_CLOSET_WW_FEED_URL",
    "ADMITAD_THE_DEAL_OUTLET_SA_AR_FEED_URL",
    "ADMITAD_HUAWEI_SA_AR_FEED_URL",
  ];
  const previousValues = new Map(
    feedKeys.map((key) => [key, process.env[key]]),
  );
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;

  try {
    for (const key of feedKeys) {
      process.env[key] = "https://example.invalid/feed.csv";
    }
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("Feed refresh must not start during monitoring setup");
    }) as typeof fetch;

    createDefaultProviderRegistry({ startBackgroundRefresh: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previousValues) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});