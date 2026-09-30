import assert from "node:assert/strict";
import { test } from "node:test";
import { extractSourceEvidence } from "./sourceEvidence";

test("extracts a category-specific Samsung model and explicit source variants", () => {
  const evidence = extractSourceEvidence({
    title: "Samsung Galaxy S24 Ultra 256GB Black",
    brand: "Samsung",
    providerId: "shop-a",
  });
  assert.equal(evidence.brand?.value, "Samsung");
  assert.equal(evidence.model?.value, "Galaxy S24 Ultra");
  assert.equal(evidence.model?.source, "source.title.pattern.samsung_galaxy_s");
  assert.equal(evidence.variants.storage?.value, "256GB");
  assert.equal(evidence.variants.color?.value, "black");
});

test("extracts explicit volume and pack quantity while retaining absent or ambiguous variants as unknown", () => {
  const explicit = extractSourceEvidence({
    title: "Kérastase Genesis Serum 90ml pack of 2",
    providerId: "shop-a",
  });
  assert.equal(explicit.variants.size?.value, "90ml");
  assert.equal(explicit.variants.volume?.value, "90ml");
  assert.equal(explicit.variants.packQuantity?.value, "2");

  const unknown = extractSourceEvidence({
    title: "Samsung Galaxy S24 Smartphone",
    brand: "Samsung",
  });
  assert.equal(unknown.variants.color, undefined);
  assert.equal(unknown.variants.storage, undefined);

  const ambiguousStorage = extractSourceEvidence({
    title: "Samsung Galaxy S24 8GB RAM 256GB",
    brand: "Samsung",
  });
  assert.equal(ambiguousStorage.variants.storage, undefined);
});

test("extracts distinct Apple and Sony model tiers without collapsing siblings", () => {
  const iphone = extractSourceEvidence({
    title: "Apple iPhone 15 Pro Max 256GB",
    brand: "Apple",
    providerId: "shop-a",
  });
  const sony = extractSourceEvidence({
    title: "Sony WH-1000XM5 Wireless Headphones",
    brand: "Sony",
    providerId: "shop-b",
  });
  assert.equal(iphone.model?.value, "iPhone 15 Pro Max");
  assert.equal(sony.model?.value, "WH-1000XM5");
});

test("only labeled valid GTINs pass check-digit validation and seller SKUs stay scoped", () => {
  const evidence = extractSourceEvidence({
    title: "GTIN-13: 4006381333931 MPN: ABC-123 SKU: SHOP-44",
    brand: "Sample",
    providerId: "shop-a",
  });
  const gtin = evidence.identifierProofs.find((proof) => proof.kind === "GTIN");
  const mpn = evidence.identifierProofs.find((proof) => proof.kind === "MPN");
  const sku = evidence.identifierProofs.find((proof) => proof.kind === "SKU");
  assert.equal(gtin?.valid, true);
  assert.equal(mpn?.scope, "brand:Sample");
  assert.equal(sku?.scope, "provider:shop-a");
  assert.equal(evidence.model?.value, "ABC-123");
  const sellerSkuOnly = extractSourceEvidence({
    title: "Sample Phone SKU: IPHONE-15",
    brand: "Sample",
    providerId: "shop-a",
  });
  assert.equal(sellerSkuOnly.model, undefined);

  const invalid = extractSourceEvidence({ title: "EAN-13: 4006381333932", providerId: "shop-a" });
  assert.equal(invalid.identifierProofs[0]?.valid, false);
});

test("extracts Nike style codes and Huawei model codes only with explicit brand context", () => {
  const nike = extractSourceEvidence({
    title: "Nike Air Max CW2288-111 Size EU 42",
    brand: "Nike",
    providerId: "shop-a",
  });
  const huawei = extractSourceEvidence({
    title: "HUAWEI NOH-AN00 Smartphone",
    providerId: "shop-b",
  });
  const unscoped = extractSourceEvidence({ title: "Generic product CW2288-111" });
  assert.equal(nike.styleCode?.value, "CW2288-111");
  assert.equal(nike.styleCode?.scope, "brand:nike");
  assert.equal(nike.variants.size?.value, "EU 42");
  assert.equal(huawei.model?.value, "NOH-AN00");
  assert.equal(unscoped.styleCode, undefined);
});

test("editorial and comparison markers are explicit abstention evidence", () => {
  for (const title of [
    "Samsung Galaxy S24 256GB family bundle",
    "Samsung Galaxy S24 comparison review",
    "Samsung Galaxy S24 collection",
  ]) {
    assert.equal(extractSourceEvidence({ title, brand: "Samsung" }).editorial, true);
  }
});