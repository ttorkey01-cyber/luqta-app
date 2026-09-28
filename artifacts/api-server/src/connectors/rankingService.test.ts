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