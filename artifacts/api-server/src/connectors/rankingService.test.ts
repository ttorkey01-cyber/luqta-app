import assert from "node:assert/strict";
import { test } from "node:test";
import { RankingService } from "./rankingService";
import type { NormalizedProduct } from "./types";

test("Electronics category orders better real products by relevance and data, not merchant", () => {
  const base = {
    availabilityScore: 0.5,
    reliabilityScore: 0.8,
    exactMatchScore: 0.5,
    visualScore: 0.5,
    specificationScore: 0.5,
  };
  const weaker = {
    ...base,
    providerId: "aliexpress",
    merchant: "AliExpress",
    title: "USB-C charger",
    category: "Tool Parts",
    description: "",
    price: null,
    imageUrl: null,
    productUrl: "https://shop.example.test/charger",
  } as unknown as NormalizedProduct;
  const stronger = {
    ...base,
    providerId: "other-feed",
    merchant: "Another merchant",
    title: "Wireless Bluetooth headphones",
    category: "Audio & Video",
    description: "Wireless headphones with active noise cancellation",
    price: 120,
    imageUrl: "https://images.example.test/headphones.jpg",
    affiliateUrl: "https://shop.example.test/headphones",
  } as unknown as NormalizedProduct;
  const ranking = new RankingService();
  assert.equal(ranking.rank([weaker, stronger], undefined, true)[0]?.title, stronger.title);
  assert.equal(ranking.rank([weaker, stronger], undefined, false)[0]?.title, weaker.title);
});

test("soft budgets slightly prefer nearby known prices without filtering distant or unknown results", () => {
  const base = {
    availabilityScore: 0.5,
    reliabilityScore: 0.5,
    exactMatchScore: 0.5,
    visualScore: 0.5,
    specificationScore: 0.5,
  };
  const products = [
    { ...base, id: "far", price: 900, currency: "SAR" },
    { ...base, id: "unknown", price: null, currency: "SAR" },
    { ...base, id: "near", price: 310, currency: "SAR" },
  ] as unknown as NormalizedProduct[];
  const ranked = new RankingService().rank(products, { approximatePrice: 300 });
  assert.deepEqual(ranked.map((result) => result.id), ["near", "unknown", "far"]);
  assert.equal(ranked.length, products.length);
  assert.equal(ranked.find((result) => result.id === "unknown")?.priceScore, 0.5);
  assert.equal(products[0].priceScore, undefined);
});

test("a soft SAR budget does not reward a USD amount or an unknown currency", () => {
  const base = {
    availabilityScore: 0.5,
    reliabilityScore: 0.5,
    exactMatchScore: 0.5,
    visualScore: 0.5,
    specificationScore: 0.5,
  };
  const products = [
    { ...base, id: "usd", price: 300, currency: "USD" },
    { ...base, id: "missing-currency", price: 300, currency: null },
    { ...base, id: "sar", price: 310, currency: "SAR" },
  ] as unknown as NormalizedProduct[];
  const ranked = new RankingService().rank(products, {
    approximatePrice: 300,
    currency: "SAR",
  });
  assert.equal(ranked[0]?.id, "sar");
  assert.deepEqual(
    ranked.filter((result) => result.id !== "sar").map((result) => result.priceScore),
    [0.5, 0.5],
  );
  assert.equal(ranked.length, products.length);
});

test("strict price bounds take priority over a simultaneous soft preference", () => {
  const result = { availabilityScore: 0.5, price: 400 } as NormalizedProduct;
  const ranking = new RankingService();
  const withBoth = ranking.rank([result], { maxPrice: 300, approximatePrice: 400 });
  const withStrictOnly = ranking.rank([result], { maxPrice: 300 });
  assert.equal(withBoth[0].priceScore, withStrictOnly[0].priceScore);
});