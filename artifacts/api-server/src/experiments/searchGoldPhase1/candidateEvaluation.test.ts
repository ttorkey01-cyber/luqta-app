import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NormalizedProduct } from "../../connectors/types";
import { evaluatePhase1Candidates } from "./candidateEvaluation";
import { parsePhase1Intent } from "./phase1Intent";

function product(
  id: string,
  values: Partial<NormalizedProduct["canonical"]> = {},
  extras: Partial<Pick<NormalizedProduct, "isAffiliate" | "affiliateUrl" | "rankScore" | "exactMatchScore" | "providerId">> = {},
): NormalizedProduct {
  const canonical: NormalizedProduct["canonical"] = {
    id,
    providerId: "provider-a",
    providerProductId: `provider-item-${id}`,
    title: "Generic product",
    description: null,
    brand: null,
    productType: null,
    category: null,
    subcategory: null,
    audience: null,
    color: null,
    imageUrl: null,
    alternateImageUrls: null,
    price: 100,
    originalPrice: null,
    discount: null,
    currency: "SAR",
    merchant: "Merchant",
    productUrl: null,
    affiliateUrl: null,
    destinationUrl: null,
    availability: "in_stock",
    condition: "new",
    location: null,
    rating: null,
    reviewCount: null,
    updatedAt: null,
    sourceType: "catalog",
    ...values,
  };
  return {
    id,
    title: canonical.title,
    availability: "in_stock",
    condition: canonical.condition ?? undefined,
    sourceType: canonical.sourceType,
    providerId: "provider-a",
    providerName: "Provider A",
    isAffiliate: false,
    rankScore: 0,
    priceScore: 0.5,
    availabilityScore: 1,
    conditionScore: 1,
    locationScore: 0.5,
    canonical,
    ...extras,
  };
}

describe("isolated Phase 1 candidate evaluation", () => {
  it("evaluates Saudi Arabic and mixed-language strict price/color/condition/city constraints", async () => {
    const intent = await parsePhase1Intent("أبي شنطة سوداء مستعمل في جدة أقل من ٣٠٠ ريال");
    const matching = product("matching", {
      title: "Black handbag",
      category: "bags_accessories",
      brand: "Acme",
      color: "black",
      condition: "used",
      location: "Jeddah, Saudi Arabia",
      price: 299,
      currency: "SAR",
    });
    const tooExpensive = product("expensive", {
      ...matching.canonical,
      id: "expensive",
      price: 300,
    });
    const wrongCurrency = product("currency", {
      ...matching.canonical,
      id: "currency",
      price: 200,
      currency: "USD",
    });

    const result = evaluatePhase1Candidates(intent, [matching, tooExpensive, wrongCurrency]);
    assert.equal(result.rejected.some((candidate) => candidate.product.id === "matching"), false);
    assert.equal(result.rejected.find((candidate) => candidate.product.id === "expensive")?.constraints.price?.status, "verified_fail");
    assert.equal(result.rejected.find((candidate) => candidate.product.id === "currency")?.constraints.price?.status, "verified_fail");
    assert.equal(result.alternatives[0]?.product.id, "matching");
    assert.equal(result.alternatives[0]?.constraints.city.status, "verified_pass");
    assert.equal(result.alternatives[0]?.constraints.condition.status, "verified_pass");
  });

  it("respects inclusive caps and price ranges, including missing price/currency as unknown", async () => {
    const cap = await parsePhase1Intent("handbag at most 100 SAR");
    const capResult = evaluatePhase1Candidates(cap, [
      product("equal", { title: "handbag", category: "bags_accessories", price: 100 }),
      product("missing", { title: "handbag", category: "bags_accessories", price: null }),
    ]);
    assert.equal(capResult.rejected.find((candidate) => candidate.product.id === "equal"), undefined);
    assert.equal(capResult.rejected.find((candidate) => candidate.product.id === "missing")?.constraints.price?.status, "unknown");

    const range = await parsePhase1Intent("bag between 100 and 200 SAR");
    const rangeResult = evaluatePhase1Candidates(range, [
      product("inside", { title: "bag", category: "bags_accessories", price: 100 }),
      product("outside", { title: "bag", category: "bags_accessories", price: 201 }),
    ]);
    assert.equal(rangeResult.rejected.find((candidate) => candidate.product.id === "inside"), undefined);
    assert.equal(rangeResult.rejected.find((candidate) => candidate.product.id === "outside")?.constraints.price?.status, "verified_fail");
  });

  it("requires currency evidence for strict budgets and applies the implicit Saudi SAR policy", async () => {
    const intent = await parsePhase1Intent("handbag under 100");
    const noCurrency = product("no-currency", {
      title: "Handbag",
      category: "bags_accessories",
      productType: "handbag",
      price: 80,
      currency: null,
    });
    const result = evaluatePhase1Candidates(intent, [noCurrency]);
    const rejected = result.rejected[0];
    assert.equal(rejected?.constraints.price.status, "unknown");
    assert.match(rejected?.constraints.price.reason ?? "", /Saudi-market policy requires SAR/u);
  });

  it("keeps approximate budgets soft rather than turning them into a hard gate", async () => {
    const intent = await parsePhase1Intent("handbag around 300 SAR");
    const result = evaluatePhase1Candidates(intent, [
      product("over-soft-budget", {
        title: "handbag",
        category: "bags_accessories",
        price: 450,
        currency: "SAR",
      }),
    ]);
    assert.equal(result.rejected.length, 0);
    assert.equal(result.alternatives[0]?.product.id, "over-soft-budget");
    assert.equal(result.alternatives[0]?.constraints.price, undefined);
  });

  it("never lets unknown explicit constraints pass", async () => {
    const intent = await parsePhase1Intent("new black shoes size 42 in Riyadh");
    const candidate = product("unknown-fields", {
      title: "Black shoes",
      category: "shoes",
      color: "black",
      condition: null,
      location: null,
    });
    const result = evaluatePhase1Candidates(intent, [candidate]);
    const rejected = result.rejected[0];
    assert.ok(rejected);
    assert.equal(rejected.constraints.size.status, "unknown");
    assert.equal(rejected.constraints.condition.status, "unknown");
    assert.equal(rejected.constraints.city.status, "unknown");
    assert.equal(result.qualifying.length, 0);
  });

  it("rejects conflicting explicit brand/model and treats a near-model as a mismatch", async () => {
    const intent = await parsePhase1Intent("Samsung Galaxy S24 phone");
    const matchingModel = product("matching-model", {
      title: "Samsung Galaxy S24 phone",
      category: "electronics",
      productType: "phone",
      brand: "Samsung",
    });
    const wrongBrand = product("wrong-brand", {
      title: "Samsung Galaxy S24 phone",
      category: "electronics",
      productType: "phone",
      brand: "Apple",
    });
    const nearModel = product("near-model", {
      title: "Samsung Galaxy S23 phone",
      category: "electronics",
      productType: "phone",
      brand: "Samsung",
    });
    const result = evaluatePhase1Candidates(intent, [matchingModel, wrongBrand, nearModel]);
    assert.equal(result.qualifying[0]?.product.id, "matching-model");
    assert.equal(result.qualifying[0]?.classification, "PROBABLE_EXACT");
    assert.equal(result.qualifying[0]?.constraints.model.status, "verified_pass");
    assert.equal(result.rejected.find((candidate) => candidate.product.id === "wrong-brand")?.constraints.brand.status, "verified_fail");
    assert.equal(result.rejected.find((candidate) => candidate.product.id === "near-model")?.constraints.model.status, "verified_fail");
  });

  it("rejects product-type conflicts even when the broad category matches", async () => {
    const headlightIntent = await parsePhase1Intent("Toyota headlight");
    const sparkPlug = product("spark-plug", {
      title: "Toyota spark plug",
      category: "automotive",
      productType: "spark plug",
      brand: "Toyota",
    });
    const headlightResult = evaluatePhase1Candidates(headlightIntent, [sparkPlug]);
    assert.equal(headlightResult.rejected[0]?.constraints.product_type.status, "verified_fail");

    const phoneIntent = await parsePhase1Intent("Samsung phone");
    const phoneCase = product("phone-case", {
      title: "Samsung phone case",
      category: "electronics",
      productType: "phone case",
      brand: "Samsung",
    });
    const phoneResult = evaluatePhase1Candidates(phoneIntent, [phoneCase]);
    assert.equal(phoneResult.rejected[0]?.constraints.product_type.status, "verified_fail");
    assert.equal(phoneResult.qualifying.length, 0);
  });

  it("requires matching labeled identifiers and category compatibility for EXACT; seller IDs alone never identify globally", async () => {
    const intent = await parsePhase1Intent("Toyota headlight MPN: 123-ABC");
    const exact = product("labeled", {
      title: "Toyota headlight MPN: 123-ABC",
      category: "automotive",
      productType: "headlight",
      brand: "Toyota",
    });
    const sellerIdOnly = product("seller-id", {
      title: "Toyota headlight",
      category: "automotive",
      productType: "headlight",
      brand: "Toyota",
      providerProductId: "123-ABC",
    });
    const wrongCategory = product("wrong-category", {
      title: "Toyota headlight MPN: 123-ABC",
      category: "electronics",
      productType: "headlight",
      brand: "Toyota",
    });
    const result = evaluatePhase1Candidates(intent, [exact, sellerIdOnly, wrongCategory]);
    assert.equal(result.rejected.find((candidate) => candidate.product.id === "labeled")?.constraints.vehicle_fitment.status, "unknown");
    assert.equal(result.rejected.find((candidate) => candidate.product.id === "seller-id")?.constraints.mpn.status, "unknown");
    assert.equal(result.rejected.find((candidate) => candidate.product.id === "wrong-category")?.constraints.vehicle_fitment.status, "unknown");
    assert.equal(result.qualifying.length, 0);
  });

  it("keeps identifier labels distinct and normalizes Arabic digits and slash punctuation", async () => {
    const intent = await parsePhase1Intent("handbag MPN: ABC-123");
    intent.mpn = { value: "١٢٣/ABC", evidence: "USER_EXPLICIT" };
    const matchingMpn = product("mpn-slash", {
      title: "Handbag MPN: 123/ABC",
      category: "bags_accessories",
      productType: "handbag",
    });
    const skuLabeledOnly = product("sku-not-oem", {
      title: "Handbag SKU: 123/ABC",
      category: "bags_accessories",
      productType: "handbag",
    });
    const result = evaluatePhase1Candidates(intent, [matchingMpn, skuLabeledOnly]);
    assert.equal(result.qualifying[0]?.classification, "EXACT");
    assert.equal(result.qualifying[0]?.constraints.mpn.status, "verified_pass");
    assert.equal(result.rejected.find((candidate) => candidate.product.id === "sku-not-oem")?.constraints.mpn.status, "unknown");

    const oemIntent = await parsePhase1Intent("handbag OEM: 123/ABC");
    oemIntent.oem = { value: "123/ABC", evidence: "USER_EXPLICIT" };
    const wrongLabel = evaluatePhase1Candidates(oemIntent, [skuLabeledOnly]);
    assert.equal(wrongLabel.rejected[0]?.constraints.oem.status, "unknown");
  });

  it("separates source-backed EXACT from seller-SKU PROBABLE_EXACT", async () => {
    const mpnIntent = await parsePhase1Intent("leather handbag MPN: ABC-123");
    const exact = product("stable-mpn", {
      title: "Leather handbag MPN: ABC-123",
      category: "bags_accessories",
      productType: "handbag",
    });
    const exactResult = evaluatePhase1Candidates(mpnIntent, [exact]);
    assert.equal(exactResult.qualifying[0]?.classification, "EXACT");

    const skuIntent = await parsePhase1Intent("handbag SKU: ABC-123");
    const sellerSku = product("seller-sku", {
      title: "Handbag SKU: ABC-123",
      category: "bags_accessories",
    });
    const skuResult = evaluatePhase1Candidates(skuIntent, [sellerSku]);
    assert.equal(skuResult.qualifying[0]?.classification, "PROBABLE_EXACT");
  });

  it("does not assert authenticity or automotive fitment without authoritative structured evidence", async () => {
    const authenticityIntent = await parsePhase1Intent("original perfume");
    const perfume = product("perfume", {
      title: "Original perfume",
      category: "beauty_care",
      productType: "perfume",
    });
    const authenticityResult = evaluatePhase1Candidates(authenticityIntent, [perfume]);
    assert.equal(authenticityResult.rejected[0]?.constraints.authenticity.status, "unknown");

    const carIntent = await parsePhase1Intent("Toyota Camry spark plug");
    const sparkPlug = product("spark", {
      title: "Toyota Camry spark plug",
      category: "automotive",
      brand: "Toyota",
    });
    const carResult = evaluatePhase1Candidates(carIntent, [sparkPlug]);
    assert.equal(carResult.rejected[0]?.constraints.vehicle_fitment.status, "unknown");
    assert.equal(carResult.qualifying.length, 0);
  });

  it("rejects unrelated popular/affiliate/high-provider-score candidates and ranks deterministically", async () => {
    const intent = await parsePhase1Intent("handbag");
    const unrelated = product("popular-garbage", {
      title: "Wireless phone charger",
      category: "electronics",
    }, { rankScore: 999, exactMatchScore: 1, isAffiliate: true, affiliateUrl: "https://example.test/affiliate" });
    const a = product("a", { title: "Leather handbag", category: "bags_accessories" });
    const b = product("b", { title: "Leather handbag", category: "bags_accessories" }, { providerId: "provider-b" });
    const result = evaluatePhase1Candidates(intent, [unrelated, b, a], {
      a: "strategy-z",
      b: "strategy-a",
    });
    assert.equal(result.rejected[0]?.product.id, "popular-garbage");
    assert.equal(result.qualifying.length, 0);
    assert.deepEqual(result.alternatives.map((candidate) => candidate.product.id), ["a", "b"]);
    assert.equal(result.alternatives[0]?.strategy, "strategy-z");
    assert.ok(result.alternatives.every((candidate) => candidate.classification === "CLOSE_ALTERNATIVE"));
  });

  it("does not let unknown query tokens make garbage relevant or change supported relevance", async () => {
    const intent = await parsePhase1Intent("handbag blorptoken");
    const ordinary = product("ordinary", {
      title: "Leather handbag",
      category: "bags_accessories",
      productType: "handbag",
    });
    const unknownTokenOnly = product("unknown-token", {
      title: "Blorptoken",
    });
    const result = evaluatePhase1Candidates(intent, [ordinary, unknownTokenOnly]);
    assert.equal(result.alternatives.find((candidate) => candidate.product.id === "ordinary")?.score, 1);
    assert.equal(result.rejected.find((candidate) => candidate.product.id === "unknown-token")?.classification, "IRRELEVANT");
  });

  it("recovers mixed wireless-earbud Arabic color intent using the verified white fixture only", async () => {
    const intent = await parsePhase1Intent("wireless earbuds أبيها أبيض");
    const result = evaluatePhase1Candidates(intent, [
      product("mixed-white-earbuds", {
        title: "wireless earbuds",
        productType: "earbuds",
        category: "electronics",
        color: "white",
      }),
      product("mixed-black-earbuds", {
        title: "wireless earbuds",
        productType: "earbuds",
        category: "electronics",
        color: "black",
      }),
      product("mixed-unknown-earbuds", {
        title: "wireless earbuds",
        productType: "earbuds",
        category: "electronics",
        color: null,
      }),
    ]);
    assert.deepEqual(result.alternatives.map((candidate) => candidate.product.id), ["mixed-white-earbuds"]);
    assert.equal(result.alternatives[0]?.constraints.color.status, "verified_pass");
    assert.equal(result.rejected.find((candidate) => candidate.product.id === "mixed-black-earbuds")?.constraints.color.status, "verified_fail");
    assert.equal(result.rejected.find((candidate) => candidate.product.id === "mixed-unknown-earbuds")?.constraints.color.status, "unknown");
  });

  it("ranks color-only results only when requested color is structured and verified", async () => {
    const intent = await parsePhase1Intent("أزرق");
    const result = evaluatePhase1Candidates(intent, [
      product("color-blue", { title: "fixture item", color: "blue" }),
      product("color-navy", { title: "fixture item", color: "navy" }),
      product("color-unknown", { title: "fixture item", color: null }),
    ]);
    assert.deepEqual(result.alternatives.map((candidate) => candidate.product.id), ["color-blue"]);
    assert.equal(result.alternatives[0]?.constraints.color.status, "verified_pass");
    assert.equal(result.rejected.find((candidate) => candidate.product.id === "color-navy")?.constraints.color.status, "verified_fail");
    assert.equal(result.rejected.find((candidate) => candidate.product.id === "color-unknown")?.constraints.color.status, "unknown");
  });

  it("ranks attribute-only used-in-Jeddah candidates from seller locality, not delivery text", async () => {
    const intent = await parsePhase1Intent("مستعمل في جدة");
    const result = evaluatePhase1Candidates(intent, [
      product("local-used-jeddah", { title: "generic item", condition: "used", location: "Jeddah" }),
      product("remote-used-delivery-jeddah", {
        title: "generic item",
        condition: "used",
        location: "Riyadh",
        description: "Delivery destination Jeddah.",
      }),
      product("local-new-jeddah", { title: "generic item", condition: "new", location: "Jeddah" }),
      product("unknown-condition-city", { title: "generic item", condition: null, location: "Jeddah" }),
    ]);
    assert.deepEqual(result.alternatives.map((candidate) => candidate.product.id), ["local-used-jeddah"]);
    assert.equal(result.alternatives[0]?.constraints.condition.status, "verified_pass");
    assert.equal(result.alternatives[0]?.constraints.city.status, "verified_pass");
    assert.equal(result.rejected.find((candidate) => candidate.product.id === "remote-used-delivery-jeddah")?.constraints.city.status, "verified_fail");
    assert.equal(result.rejected.find((candidate) => candidate.product.id === "local-new-jeddah")?.constraints.condition.status, "verified_fail");
    assert.equal(result.rejected.find((candidate) => candidate.product.id === "unknown-condition-city")?.constraints.condition.status, "unknown");
  });

  it("keeps an available current offer and moves stale out-of-stock copies to diagnostics", async () => {
    const intent = await parsePhase1Intent("FixtureBrand stale current offer P-51");
    const result = evaluatePhase1Candidates(intent, [
      product("stale-cheaper-offer", {
        title: "FixtureBrand stale current offer P-51",
        price: 70,
        availability: "out_of_stock",
      }),
      product("current-available-offer", {
        title: "FixtureBrand current offer P-51",
        price: 95,
        availability: "in_stock",
      }),
    ]);
    assert.ok(result.alternatives.some((candidate) => candidate.product.id === "current-available-offer"));
    assert.equal(result.qualifying.length, 0, "unverified title-only model identity must not pass the hard gate");
    assert.equal(result.alternatives.find((candidate) => candidate.product.id === "current-available-offer")?.constraints.model.status, "unknown");
    assert.equal(result.alternatives.some((candidate) => candidate.product.id === "stale-cheaper-offer"), false);
    assert.match(
      result.rejected.find((candidate) => candidate.product.id === "stale-cheaper-offer")?.diagnostics.join(" ") ?? "",
      /out of stock/u,
    );
  });

  it("retrieves both relevant USB-C charger copies for the duplicate-offer fixture", async () => {
    const intent = await parsePhase1Intent("USB-C charger");
    const result = evaluatePhase1Candidates(intent, [
      product("duplicate-copy-a", { title: "USB-C charger" }),
      product("duplicate-copy-b", { title: "USB-C charger" }),
    ]);
    assert.deepEqual(result.alternatives.map((candidate) => candidate.product.id), ["duplicate-copy-a", "duplicate-copy-b"]);
    assert.ok(result.alternatives.every((candidate) => candidate.score > 0));
  });

  it("treats explicitly requested USB-C as a hard, source-backed connector constraint", async () => {
    const intent = await parsePhase1Intent("أبي شاحن USB-C");
    const result = evaluatePhase1Candidates(intent, [
      product("usb-c-fixture", {
        title: "USB-C charger",
        description: "Controlled fixture connector: USB-C; wattage unspecified.",
        productType: "charger",
        category: "electronics",
      }),
      product("micro-usb-fixture", {
        title: "Micro-USB charger",
        description: "Controlled fixture connector: Micro-USB.",
        productType: "charger",
        category: "electronics",
      }),
      product("unknown-connector", {
        title: "Generic charger",
        productType: "charger",
        category: "electronics",
      }),
    ]);
    assert.equal(result.alternatives[0]?.product.id, "usb-c-fixture");
    assert.equal(result.alternatives[0]?.constraints.connector.status, "verified_pass");
    assert.equal(result.rejected.find((candidate) => candidate.product.id === "micro-usb-fixture")?.constraints.connector.status, "verified_fail");
    assert.equal(result.rejected.find((candidate) => candidate.product.id === "unknown-connector")?.constraints.connector.status, "unknown");
    assert.equal(result.alternatives.some((candidate) => candidate.product.id !== "usb-c-fixture"), false);
  });

  it("recognizes explicitly labeled GTIN and MPN as exact without inferred categories", async () => {
    const gtinIntent = await parsePhase1Intent("00012345678905");
    const gtinResult = evaluatePhase1Candidates(gtinIntent, [
      product("gtin-exact", { title: "item GTIN 00012345678905" }),
      product("gtin-near", { title: "item GTIN 00012345678906" }),
    ]);
    assert.equal(gtinResult.qualifying[0]?.product.id, "gtin-exact");
    assert.equal(gtinResult.qualifying[0]?.classification, "EXACT");
    assert.equal(gtinResult.rejected.find((candidate) => candidate.product.id === "gtin-near")?.constraints.gtin14.status, "unknown");

    const mpnIntent = await parsePhase1Intent("Fixture MPN ZX-8842");
    const mpnResult = evaluatePhase1Candidates(mpnIntent, [
      product("mpn-exact", { title: "Fixture MPN ZX-8842" }),
      product("mpn-close", { title: "Fixture MPN ZX-8843" }),
    ]);
    assert.equal(mpnResult.qualifying[0]?.product.id, "mpn-exact");
    assert.equal(mpnResult.qualifying[0]?.classification, "EXACT");
    assert.notEqual(mpnResult.rejected.find((candidate) => candidate.product.id === "mpn-close")?.classification, "EXACT");
  });

  it("requires valid GTIN-14 checksums on both the requested and candidate identifiers", async () => {
    const validIntent = await parsePhase1Intent("00012345678905");
    assert.equal(validIntent.gtin14.value, "00012345678905");
    const invalidCandidate = product("invalid-gtin-candidate", {
      title: "item GTIN-14 00012345678906",
    });
    const candidateResult = evaluatePhase1Candidates(validIntent, [invalidCandidate]);
    assert.equal(candidateResult.qualifying.length, 0);
    assert.equal(candidateResult.rejected[0]?.constraints.gtin14.status, "unknown");

    const invalidIntent = await parsePhase1Intent("00012345678906");
    assert.equal(invalidIntent.gtin14.value, null);
    const invalidRequestResult = evaluatePhase1Candidates(invalidIntent, [
      product("valid-candidate-not-requested", { title: "item GTIN-14 00012345678905" }),
    ]);
    assert.equal(invalidRequestResult.qualifying.length, 0);
    assert.equal(invalidRequestResult.alternatives.length, 0);

    const unsupportedLengthIntent = await parsePhase1Intent("1234567890123");
    assert.equal(unsupportedLengthIntent.gtin14.value, null);
    const unsupportedLengthResult = evaluatePhase1Candidates(unsupportedLengthIntent, [
      product("valid-candidate-for-unsupported-length", { title: "item GTIN-14 00012345678905" }),
    ]);
    assert.equal(unsupportedLengthResult.qualifying.length, 0);
  });

  it("leaves unique-token and absent-category no-match snapshots irrelevant", async () => {
    const unique = await parsePhase1Intent("unmatchable-fixture-token-55");
    const uniqueResult = evaluatePhase1Candidates(unique, [
      product("no-match-blue-chair", { title: "blue office chair", category: "home_living" }),
      product("no-match-usb-charger", { title: "USB-C charger", category: "electronics" }),
    ]);
    assert.deepEqual(uniqueResult.qualifying, []);
    assert.deepEqual(uniqueResult.alternatives, []);

    const absent = await parsePhase1Intent("refrigerator");
    const absentResult = evaluatePhase1Candidates(absent, [
      product("absent-category-chair", { title: "office chair", category: "home_living" }),
      product("absent-category-phone", { title: "mobile phone", category: "electronics" }),
    ]);
    assert.deepEqual(absentResult.qualifying, []);
    assert.deepEqual(absentResult.alternatives, []);
  });

  it("does not use affiliate or commission-related fields in scoring", async () => {
    const intent = await parsePhase1Intent("handbag");
    const direct = product("direct", { title: "Leather handbag", category: "bags_accessories" });
    const affiliate = product("affiliate", {
      title: "Leather handbag",
      category: "bags_accessories",
    }, { isAffiliate: true, affiliateUrl: "https://example.test/affiliate" });
    const result = evaluatePhase1Candidates(intent, [affiliate, direct]);
    assert.equal(result.alternatives[0]?.score, result.alternatives[1]?.score);
    assert.deepEqual(result.alternatives.map((candidate) => candidate.product.id), ["affiliate", "direct"]);
  });

  it("does not let affiliate status alter stable-identifier EXACT classification", async () => {
    const intent = await parsePhase1Intent("handbag MPN: ABC-123");
    const direct = product("direct-exact", {
      title: "Handbag MPN: ABC-123",
      category: "bags_accessories",
      productType: "handbag",
    });
    const affiliate = product("affiliate-exact", {
      title: "Handbag MPN: ABC-123",
      category: "bags_accessories",
      productType: "handbag",
    }, { isAffiliate: true, affiliateUrl: "https://example.test/affiliate" });
    const result = evaluatePhase1Candidates(intent, [affiliate, direct]);
    assert.deepEqual(result.qualifying.map((candidate) => candidate.classification), ["EXACT", "EXACT"]);
    assert.equal(result.qualifying[0]?.score, result.qualifying[1]?.score);
  });
});