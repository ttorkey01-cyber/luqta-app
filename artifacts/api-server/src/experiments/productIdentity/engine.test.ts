import assert from "node:assert/strict";
import test from "node:test";
import { assessSameProductCheaper } from "./cheaper";
import { classifyPair } from "./engine";
import { groupCandidates } from "./grouping";
import { normalizeIdentifier } from "./identifiers";
import type { IdentityRecord } from "./types";

function record(
  id: string,
  partial: Partial<IdentityRecord> = {},
): IdentityRecord {
  return {
    id,
    title: "Acme Nova wireless headphones",
    brand: "Acme",
    category: "electronics",
    model: "Nova 2",
    ...partial,
  };
}

test("normalizes and validates GTIN-8, GTIN-12, GTIN-13, and GTIN-14 check digits", () => {
  const cases = [
    ["GTIN8", "96385074"],
    ["GTIN12", "036000291452"],
    ["GTIN13", "4006381333931"],
    ["GTIN14", "10012345678902"],
  ] as const;
  for (const [kind, value] of cases) {
    const normalized = normalizeIdentifier({ kind, value });
    assert.equal(normalized.raw, value);
    assert.equal(normalized.normalized, value.padStart(14, "0"));
    assert.equal(normalized.status, "VALID", `${kind} should be valid`);
    assert.equal(normalizeIdentifier({ kind, value: `${value.slice(0, -1)}0` }).status, "INVALID");
  }
  assert.equal(normalizeIdentifier({ kind: "GTIN", value: "12345" }).status, "INVALID");
});

test("validated GTIN formats share a 14-digit key and invalid digits never match", () => {
  const upc = normalizeIdentifier({ kind: "GTIN12", value: "036000291452" });
  const ean = normalizeIdentifier({ kind: "GTIN13", value: "0036000291452" });
  const gtin14 = normalizeIdentifier({ kind: "GTIN14", value: "00036000291452" });
  assert.equal(upc.status, "VALID");
  assert.equal(upc.normalized, "00036000291452");
  assert.equal(ean.normalized, upc.normalized);
  assert.equal(gtin14.normalized, upc.normalized);

  const left = record("upc", {
    brand: undefined, model: undefined,
    identifiers: [{ kind: "GTIN12", value: "036000291452" }],
  });
  const equivalent = record("ean", {
    brand: undefined, model: undefined,
    identifiers: [{ kind: "GTIN13", value: "0036000291452" }],
  });
  assert.equal(classifyPair(left, equivalent).classification, "SAME_PRODUCT_SAME_VARIANT");
  assert.ok(classifyPair(left, equivalent).positiveEvidence.some((item) => item.code === "MATCHED_GTIN"));

  const invalid = record("bad", {
    brand: undefined, model: undefined,
    identifiers: [{ kind: "GTIN13", value: "0036000291453" }],
  });
  const invalidComparison = classifyPair(left, invalid);
  assert.notEqual(invalidComparison.classification, "SAME_PRODUCT_SAME_VARIANT");
  assert.ok(!invalidComparison.positiveEvidence.some((item) => item.code === "MATCHED_GTIN"));
});

test("normalizes scoped MPN/SKU/OEM/model without erasing scope", () => {
  const value = normalizeIdentifier({ kind: "MPN", value: " ab- 12 ", scope: " ACME " });
  assert.equal(value.status, "VALID");
  assert.equal(value.raw, " ab- 12 ");
  assert.equal(value.normalized, "AB-12");
  assert.equal(value.scope, "ACME");
  assert.equal(normalizeIdentifier({ kind: "SKU", value: " " }).status, "INVALID");
  assert.equal(normalizeIdentifier({ kind: "vendor_code", value: "A-1" }).status, "UNKNOWN_FORMAT");
});

test("supported identifier aliases preserve raw kind while matching by safe canonical kind", () => {
  const oemPart = normalizeIdentifier({ kind: "OEM_PART", value: "ALT-900" });
  assert.equal(oemPart.kind, "OEM_PART");
  assert.equal(oemPart.raw, "ALT-900");
  assert.equal(oemPart.canonicalKind, "OEM");
  assert.equal(normalizeIdentifier({ kind: "STYLE_CODE", value: "NK-1" }).canonicalKind, "STYLE");
  assert.equal(normalizeIdentifier({ kind: "UPC-A", value: "036000291452" }).canonicalKind, "GTIN12");
  assert.equal(normalizeIdentifier({ kind: "EAN-13", value: "0036000291452" }).canonicalKind, "GTIN13");

  const partA = record("part-a", {
    model: "Alternator Z", identifiers: [{ kind: "OEM_PART", value: "ALT-900", scope: "Acme" }],
  });
  const partB = record("part-b", {
    model: "Alternator Z", identifiers: [{ kind: "OEM", value: "ALT-901", scope: "Acme" }],
  });
  const partConflict = classifyPair(partA, partB);
  assert.equal(partConflict.classification, "DIFFERENT_PRODUCT");
  assert.ok(partConflict.conflictingEvidence.some((item) => item.code === "CONFLICTING_OEM"));

  const upc = record("upc-alias", {
    model: undefined, brand: undefined,
    identifiers: [{ kind: "UPC-A", value: "036000291452" }],
  });
  const ean = record("ean-alias", {
    model: undefined, brand: undefined,
    identifiers: [{ kind: "EAN-13", value: "0036000291452" }],
  });
  assert.equal(classifyPair(upc, ean).classification, "SAME_PRODUCT_SAME_VARIANT");
});

test("matched authoritative identifiers establish same product and same variant", () => {
  const left = record("one", {
    brand: "A", model: undefined,
    identifiers: [{ kind: "GTIN13", value: "4006381333931" }],
  });
  const right = record("two", {
    brand: "A", model: undefined,
    title: "Totally different seller wording",
    identifiers: [{ kind: "GTIN13", value: "4006381333931" }],
  });
  const result = classifyPair(left, right);
  assert.equal(result.classification, "SAME_PRODUCT_SAME_VARIANT");
  assert.ok(result.positiveEvidence.some((entry) => entry.code === "MATCHED_GTIN"));
  assert.ok(result.productIdentity);
});

test("matching brand/model without trade-variant evidence is not an exact variant match", () => {
  const result = classifyPair(
    record("left", { variant: undefined }),
    record("right", { variant: undefined }),
  );
  assert.equal(result.classification, "PROBABLE_SAME_PRODUCT");
  assert.ok(result.productIdentity);
  assert.ok(result.unknownEvidence.some((entry) => entry.code === "VARIANT_DETAILS_INCOMPLETE"));

  const fashionSameVariant = classifyPair(
    record("shirt-a", {
      category: "fashion", styleCode: "TS-1",
      variant: { color: "blue", size: "M" },
    }),
    record("shirt-b", {
      category: "fashion", styleCode: "TS-1",
      variant: { color: "blue", size: "M" },
    }),
  );
  assert.equal(fashionSameVariant.classification, "SAME_PRODUCT_SAME_VARIANT");
});

test("strong identifier conflicts override nearly identical titles", () => {
  const left = record("one", { identifiers: [{ kind: "OEM", value: "AX-100", scope: "ACME" }] });
  const right = record("two", { identifiers: [{ kind: "OEM", value: "AX-101", scope: "ACME" }] });
  const result = classifyPair(left, right);
  assert.equal(result.classification, "DIFFERENT_PRODUCT");
  assert.ok(result.conflictingEvidence.some((entry) => entry.code === "CONFLICTING_OEM"));
});

test("matching style with different color preserves product identity and separates variants", () => {
  const left = record("one", {
    model: undefined,
    styleCode: "JKT-42",
    variant: { color: "navy", size: "M" },
  });
  const right = record("two", {
    model: undefined,
    styleCode: "JKT-42",
    variant: { color: "red", size: "M" },
  });
  const result = classifyPair(left, right, { color: "navy" });
  assert.equal(result.classification, "SAME_PRODUCT_DIFFERENT_VARIANT");
  assert.ok(result.positiveEvidence.some((entry) => entry.code === "QUERY_VARIANT_PREFERENCE"));
  assert.notEqual(result.variantIdentity, null);

  const naturalLanguageQuery = classifyPair(
    record("navy", { model: undefined, styleCode: "JKT-42", variant: { color: "navy" } }),
    record("red", { model: undefined, styleCode: "JKT-42", variant: { color: "red" } }),
    "navy jacket",
  );
  assert.equal(naturalLanguageQuery.classification, "SAME_PRODUCT_DIFFERENT_VARIANT");
  assert.ok(naturalLanguageQuery.positiveEvidence.some((entry) => entry.code === "QUERY_VARIANT_PREFERENCE"));
});

test("brand/category agreement alone and title similarity never assert exact identity", () => {
  const left = record("one", { model: undefined, title: "Acme blue linen summer shirt" });
  const right = record("two", { model: undefined, title: "Acme blue linen summer shirt" });
  const result = classifyPair(left, right);
  assert.notEqual(result.classification, "SAME_PRODUCT_SAME_VARIANT");
  assert.equal(result.productIdentity, null);
});

test("provider product identifiers are compared only within provider scope", () => {
  const left = record("one", { model: undefined, providerId: "shop-a", providerProductId: "123" });
  const right = record("two", { model: undefined, providerId: "shop-b", providerProductId: "123" });
  assert.equal(classifyPair(left, right).classification, "PROBABLE_SAME_PRODUCT");
  assert.ok(classifyPair(left, right).unknownEvidence.some((entry) => entry.code === "PROVIDER_ID_UNSCOPED"));
  assert.equal(classifyPair(left, { ...right, providerId: "shop-a" }).classification, "PROBABLE_SAME_PRODUCT");
});

test("brand-scoped model conflict and category-specific variant fields are recognized", () => {
  const modelConflict = classifyPair(
    record("a", { model: "Phone X", title: "Acme phone x", category: "electronics" }),
    record("b", { model: "Phone Y", title: "Acme phone x", category: "electronics" }),
  );
  assert.equal(modelConflict.classification, "DIFFERENT_PRODUCT");

  const storage = classifyPair(
    record("a", { model: "Phone X", variant: { storage: "128 GB" } }),
    record("b", { model: "Phone X", variant: { storage: "256 GB" } }),
  );
  assert.equal(storage.classification, "SAME_PRODUCT_DIFFERENT_VARIANT");
});

test("beauty pack/volume and automotive OEM compatibility distinguish identity from fitment", () => {
  const beauty = classifyPair(
    record("cream-50", {
      brand: "Glow", model: undefined, category: "beauty_care",
      styleCode: "CREAM-1", variant: { capacity: "50 ml", packQuantity: 1 },
    }),
    record("cream-100", {
      brand: "Glow", model: undefined, category: "beauty_care",
      styleCode: "CREAM-1", variant: { capacity: "100 ml", packQuantity: 2 },
    }),
  );
  assert.equal(beauty.classification, "SAME_PRODUCT_DIFFERENT_VARIANT");

  const compatible = classifyPair(
    record("part-1", {
      brand: "Motori", model: undefined, category: "automotive",
      title: "OEM replacement alternator fits Motori vehicles",
      identifiers: [{ kind: "OEM", value: "ALT-900", scope: "Motori" }],
    }),
    record("part-2", {
      brand: "Motori", model: undefined, category: "automotive",
      title: "Alternator for Motori compatibility list",
      identifiers: [{ kind: "OEM", value: "ALT-901", scope: "Motori" }],
    }),
  );
  assert.equal(compatible.classification, "DIFFERENT_PRODUCT");
  assert.ok(compatible.conflictingEvidence.some((entry) => entry.code === "CONFLICTING_OEM"));

  const packConflict = classifyPair(
    record("pack-one", {
      category: "beauty_care", styleCode: "SERUM-1",
      variant: { capacity: "30 ml", packQuantity: 1 },
    }),
    record("pack-two", {
      category: "beauty_care", styleCode: "SERUM-1",
      variant: { capacity: "30 ml", packQuantity: 2 },
    }),
  );
  assert.equal(packConflict.classification, "SAME_PRODUCT_DIFFERENT_VARIANT");
});

test("editorial or compatibility pages cannot become exact matches from title", () => {
  const result = classifyPair(
    record("a", { model: undefined, title: "Acme Nova headphones review and buying guide" }),
    record("b", { model: undefined, title: "Acme Nova headphones review and buying guide" }),
  );
  assert.notEqual(result.classification, "SAME_PRODUCT_SAME_VARIANT");
  assert.ok(result.unknownEvidence.some((entry) => entry.code === "NON_PRODUCT_OR_FAMILY_PAGE"));
});

test("Arabic letters are preserved in identity normalization without transliteration", () => {
  const arabicLeft = record("ar-1", {
    brand: "شركة النور", model: "طراز ألف",
    title: "هاتف شركة النور طراز ألف",
  });
  const arabicRight = record("ar-2", {
    brand: "شركة النور", model: "طراز ألف",
    title: "هاتف طراز ألف من شركة النور",
  });
  const latinTransliteration = record("latin", {
    brand: "sharikat alnur", model: "taraz alf",
    title: "phone sharikat alnur taraz alf",
  });
  assert.equal(classifyPair(arabicLeft, arabicRight).classification, "PROBABLE_SAME_PRODUCT");
  assert.notEqual(classifyPair(arabicLeft, latinTransliteration).classification, "SAME_PRODUCT_SAME_VARIANT");
});

test("explicit supported title model-code siblings conflict without creating title-only exact matches", () => {
  const cases: [IdentityRecord, IdentityRecord][] = [
    [
      record("s24", {
        brand: "Samsung", model: undefined,
        title: "Samsung Galaxy S24 256GB Onyx Black", category: "electronics",
      }),
      record("s24-plus", {
        brand: "Samsung", model: undefined,
        title: "Samsung Galaxy S24+ 256GB Onyx Black", category: "electronics",
      }),
    ],
    [
      record("iphone-15", {
        brand: "Apple", model: undefined,
        title: "Apple iPhone 15 128GB", category: "electronics",
      }),
      record("iphone-15-pro", {
        brand: "Apple", model: undefined,
        title: "Apple iPhone 15 Pro 128GB", category: "electronics",
      }),
    ],
    [
      record("nike-100", {
        brand: "Nike", model: undefined,
        title: "Nike Dunk Low DD1391-100", category: "shoes",
      }),
      record("nike-101", {
        brand: "Nike", model: undefined,
        title: "Nike Dunk Low DD1391-101", category: "shoes",
      }),
    ],
  ];
  for (const [left, right] of cases) {
    const decision = classifyPair(left, right);
    assert.equal(decision.classification, "DIFFERENT_PRODUCT");
    assert.ok(decision.conflictingEvidence.some((item) => item.code === "CONFLICTING_TITLE_MODEL_CODE"));
  }
  const identicalFamilyText = classifyPair(cases[0][0], {
    ...cases[0][0], id: "same-title-different-source",
  });
  assert.notEqual(identicalFamilyText.classification, "SAME_PRODUCT_SAME_VARIANT");
});

test("grouping applies product, variant, and offer levels with complete-link safeguards", () => {
  const base = {
    brand: "Acme",
    model: undefined,
    styleCode: "SHIRT-1",
    title: "Acme shirt",
  };
  const groups = groupCandidates([
    record("navy-m", { ...base, variant: { color: "navy", size: "M" }, offer: { merchant: "A", price: 20, currency: "USD" } }),
    record("navy-m-2", { ...base, variant: { color: "navy", size: "M" }, offer: { merchant: "B", price: 18, currency: "USD" } }),
    record("red-m", { ...base, variant: { color: "red", size: "M" } }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].variants.length, 2);
  assert.equal(groups[0].variants.find((variant) => variant.records.length === 2)?.offers.length, 2);
  const keyedOfferGroups = groupCandidates([
    record("offer-copy-a", {
      ...base, providerId: "shop", variant: { color: "navy", size: "M" },
      offer: { merchant: "Merchant", price: 10, currency: "USD", providerOfferId: "native-1" },
    }),
    record("offer-copy-b", {
      ...base, providerId: "shop", variant: { color: "navy", size: "M" },
      offer: { merchant: "Merchant", price: 10, currency: "USD", providerOfferId: "native-1" },
    }),
    record("separate-listing", {
      ...base, providerId: "shop", variant: { color: "navy", size: "M" },
      offer: { merchant: "Merchant", price: 10, currency: "USD" },
    }),
  ]);
  assert.equal(keyedOfferGroups[0].variants[0].offers.length, 2);
  assert.deepEqual(
    keyedOfferGroups[0].variants[0].offers.map((offer) => offer.records.length).sort(),
    [1, 2],
  );

  const extraIdentifierGroup = groupCandidates([
    record("model-only", { variant: undefined }),
    record("model-plus-gtin", {
      variant: undefined,
      identifiers: [{ kind: "GTIN13", value: "4006381333931" }],
    }),
  ]);
  assert.equal(extraIdentifierGroup.length, 1);
  assert.equal(extraIdentifierGroup[0].records.length, 2);
  const unresolved = groupCandidates([
    record("unknown-a", { brand: undefined, model: undefined }),
    record("unknown-b", { brand: undefined, model: undefined }),
  ]);
  assert.equal(unresolved.length, 2);
});

test("cheaper assessment requires exact identity, fresh in-stock prices, and same currency", () => {
  const now = "2025-01-10T00:00:00.000Z";
  const exact = {
    identifiers: [{ kind: "GTIN13", value: "4006381333931" }],
    model: undefined,
    variant: { color: "blue" },
    offer: {
      price: 100, currency: "USD", availability: "in_stock",
      updatedAt: "2025-01-09T00:00:00.000Z",
    },
  };
  const reference = record("a", exact);
  const cheaper = record("b", {
    ...exact,
    offer: { ...exact.offer, price: 80 },
  });
  const good = assessSameProductCheaper(reference, cheaper, { now });
  assert.equal(good.classification, "SAME_PRODUCT_CHEAPER");
  assert.equal(good.savings, 20);
  assert.equal(good.savingsPercent, 20);

  assert.equal(assessSameProductCheaper(reference, record("c", {
    ...exact, offer: { ...exact.offer, currency: "EUR", price: 80 },
  }), { now }).classification, "UNKNOWN");
  assert.equal(assessSameProductCheaper(reference, record("d", {
    ...exact, offer: { ...exact.offer, availability: "unknown", price: 80 },
  }), { now }).classification, "UNKNOWN");
  assert.equal(assessSameProductCheaper(reference, record("e", {
    ...exact, variant: { color: "red" }, offer: { ...exact.offer, price: 80 },
  }), { now }).classification, "ALTERNATIVE");
  assert.equal(assessSameProductCheaper(reference, record("f", {
    ...exact, offer: { ...exact.offer, updatedAt: "2024-01-01T00:00:00.000Z", price: 80 },
  }), { now }).classification, "UNKNOWN");
});