import assert from "node:assert/strict";
import test from "node:test";
import { ResultNormalizer } from "./resultNormalizer";
import type { ProviderMetadata } from "./types";

test("canonical product preserves real image variants and leaves absent feed data null", () => {
  const normalized = new ResultNormalizer().normalize(
    {
      id: "feed-row-1",
      providerProductId: null,
      title: "Shampoo",
      category: "Hair Care",
      imageUrl: "https://cdn.example/shampoo-primary.jpg",
      alternateImageUrls: ["https://cdn.example/shampoo-side.jpg"],
      availability: "unknown",
      sourceType: "affiliate_feed",
    },
    { id: "test-provider", name: "Test provider" } as ProviderMetadata,
  );

  assert.deepEqual(normalized.canonical, {
    id: "feed-row-1",
    providerId: "test-provider",
    providerProductId: null,
    title: "Shampoo",
    description: null,
    brand: null,
    productType: null,
    category: "beauty_care",
    subcategory: null,
    audience: null,
    color: null,
    imageUrl: "https://cdn.example/shampoo-primary.jpg",
    alternateImageUrls: ["https://cdn.example/shampoo-side.jpg"],
    price: null,
    originalPrice: null,
    discount: null,
    currency: null,
    merchant: null,
    productUrl: null,
    affiliateUrl: null,
    destinationUrl: null,
    availability: null,
    condition: null,
    location: null,
    rating: null,
    reviewCount: null,
    updatedAt: null,
    sourceType: "affiliate_feed",
  });
});