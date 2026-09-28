import assert from "node:assert/strict";
import test from "node:test";
import { AffiliateLinkService } from "./affiliateLinkService";
import type { NormalizedProduct, ProviderMetadata } from "./types";

const affiliateUrl = "https://tracking.example/offer/1";
const directUrl = "https://merchant.example/products/1";

function normalizedProduct(
  productUrl: string,
  affiliateUrlValue: string | null,
): NormalizedProduct {
  return {
    id: "provider-1",
    title: "Product",
    productUrl,
    affiliateUrl: affiliateUrlValue,
    canonical: {
      id: "provider-1",
      providerId: "provider",
      providerProductId: "provider-1",
      title: "Product",
      description: null,
      brand: null,
      productType: null,
      category: null,
      subcategory: null,
      audience: null,
      color: null,
      imageUrl: null,
      alternateImageUrls: null,
      price: null,
      originalPrice: null,
      discount: null,
      currency: null,
      merchant: null,
      productUrl,
      affiliateUrl: null,
      destinationUrl: null,
      availability: null,
      condition: null,
      location: null,
      rating: null,
      reviewCount: null,
      updatedAt: null,
      sourceType: "affiliate_feed",
    },
    providerId: "provider",
    providerName: "Provider",
    availability: "unknown",
    sourceType: "affiliate_feed",
    isAffiliate: false,
    rankScore: 0,
    priceScore: 0,
    availabilityScore: 0,
    conditionScore: 0,
    locationScore: 0,
  };
}

test("does not expose an affiliate destination until provider authorization", () => {
  const result = new AffiliateLinkService().attach(
    normalizedProduct(affiliateUrl, affiliateUrl),
    { affiliateEnabled: false } as ProviderMetadata,
  );

  assert.equal(result.affiliateUrl, null);
  assert.equal(result.productUrl, undefined);
  assert.equal(result.destinationUrl, undefined);
  assert.equal(result.canonical.affiliateUrl, null);
  assert.equal(result.canonical.productUrl, null);
  assert.equal(result.canonical.destinationUrl, null);
  assert.equal(result.isAffiliate, false);
});

test("keeps direct merchant destinations and authorized affiliate links distinct", () => {
  const service = new AffiliateLinkService();
  const unauthorized = service.attach(
    normalizedProduct(directUrl, affiliateUrl),
    { affiliateEnabled: false } as ProviderMetadata,
  );
  const authorized = service.attach(
    normalizedProduct(directUrl, affiliateUrl),
    { affiliateEnabled: true } as ProviderMetadata,
  );

  assert.equal(unauthorized.productUrl, directUrl);
  assert.equal(unauthorized.destinationUrl, directUrl);
  assert.equal(unauthorized.affiliateUrl, null);
  assert.equal(authorized.productUrl, directUrl);
  assert.equal(authorized.affiliateUrl, affiliateUrl);
  assert.equal(authorized.destinationUrl, affiliateUrl);
  assert.equal(authorized.canonical.productUrl, directUrl);
  assert.equal(authorized.canonical.affiliateUrl, affiliateUrl);
});