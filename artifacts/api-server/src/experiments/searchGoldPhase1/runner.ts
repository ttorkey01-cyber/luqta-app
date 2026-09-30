import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { ProviderRegistry } from "../../connectors/providerRegistry";
import { SearchOrchestrator } from "../../connectors/searchOrchestrator";
import type {
  ProviderMetadata,
  ProviderProduct,
  ProviderSearchRequest,
  SearchProvider,
} from "../../connectors/types";

/**
 * Isolated acceptance adapter; it is not a connector or inventory provider.
 * Every item, seller, offer, identifier, attribute, and gold annotation is
 * synthetic controlled-fixture data, never a claim about a real listing.
 */
const FIXTURE_PROVIDER_ID = "search-gold-controlled-fixture";
const FIXTURE_METADATA: ProviderMetadata = {
  id: FIXTURE_PROVIDER_ID,
  name: "Search gold controlled fixtures",
  enabled: true,
  searchEnabled: true,
  affiliateEnabled: true,
  priceMonitoringAllowed: false,
  visualSearchAllowed: false,
  country: "SA",
  currency: "SAR",
  integrationType: "generic_feed",
  requiresCredentials: false,
  credentialRequirements: [],
  priority: 1,
  lastSuccessfulSync: null,
  affiliateCapability: "not_verified",
  priceMonitoringCapability: "disabled",
  integrationStatus: "mock",
};

export type ResultIdentity = "exact" | "close" | "similar" | "irrelevant";
export type InteractionState =
  | "results"
  | "no_match"
  | "clarification"
  | "similar_alternative"
  | "conflicting_evidence"
  | "retrieval_failure";

export type SearchAdapterResult = {
  products: Array<{
    id: string;
    title: string;
    description: string | null;
    merchant: string | null;
    price: number | null;
    currency: string | null;
    sourceType: string;
    brand: string | null;
    color: string | null;
    productType: string | null;
    condition: string | null;
    location: string | null;
    availability: string | null;
    updatedAt: string | null;
    rating: number | null;
    reviewCount: number | null;
    isAffiliate: boolean;
  }>;
  exactMatches?: number;
  constraintRelaxationAvailable?: boolean;
  structuredIntent?: ProviderSearchRequest["intent"];
  /** Phase 1 may provide explicit identity judgments; V2 intentionally does not. */
  classifications?: Record<string, ResultIdentity>;
  /** Phase 1 may expose the gold product grouping while keeping offers distinct. */
  identityGroups?: Record<string, string[]>;
  /** Distinguishes a safe answer state from an empty/failed response. */
  interactionState?: InteractionState;
  retrievalError?: { name: string; message: string };
};

export type SearchAdapter = (
  request: ProviderSearchRequest,
  fixtureProducts: ProviderProduct[],
) => Promise<SearchAdapterResult>;

function fixture(
  id: string,
  title: string,
  overrides: Partial<ProviderProduct> = {},
): ProviderProduct {
  return {
    id,
    title: `CONTROLLED FIXTURE ${title}`,
    description: "Synthetic gold-labeled fixture; not a real listing or offer.",
    price: null,
    currency: "SAR",
    merchant: "Fixture Merchant",
    availability: "in_stock",
    source: "controlled-fixture-source",
    sourceType: "controlled_fixture",
    ...overrides,
  };
}

function bag(
  id: string,
  price: number | null,
  overrides: Partial<ProviderProduct> = {},
) {
  return fixture(id, "handbag", {
    productType: "handbag",
    category: "bags_accessories",
    color: "black",
    condition: "new",
    price,
    ...overrides,
  });
}

export type ExecutableCase = {
  id: number;
  title: string;
  request: ProviderSearchRequest;
  fixture: ProviderProduct[];
  /** Independently authored synthetic gold annotation, not product evidence. */
  goldLabels: Record<string, unknown>;
  check: (result: SearchAdapterResult) => void;
};

function assertTop(result: SearchAdapterResult, id: string) {
  assert.equal(result.products[0]?.id, id, `expected ${id} at rank 1`);
}

function assertClassification(
  result: SearchAdapterResult,
  id: string,
  expected: ResultIdentity,
) {
  assert.equal(
    result.classifications?.[id],
    expected,
    `classification for ${id} must be ${expected}; missing classification is not a pass`,
  );
}

function assertState(result: SearchAdapterResult, expected: InteractionState) {
  assert.equal(
    result.interactionState,
    expected,
    `interaction state must be ${expected}; a bare product/empty array is not a pass`,
  );
}

export const acceptanceCases: ExecutableCase[] = [
  {
    id: 1,
    title: "Exact GTIN versus a different GTIN",
    request: { query: "00012345678905", searchMode: "intent" },
    fixture: [
      fixture("gtin-exact", "item GTIN 00012345678905", { exactMatchScore: 1 }),
      fixture("gtin-near", "item GTIN 00012345678906", { exactMatchScore: 0.2 }),
    ],
    goldLabels: {
      exactProductId: "gtin-exact",
      identifier: "synthetic GTIN-14",
      nearProductId: "gtin-near",
    },
    check(result) {
      assertTop(result, "gtin-exact");
      assertClassification(result, "gtin-exact", "exact");
      assert.notEqual(
        result.classifications?.["gtin-near"],
        "exact",
        "different GTIN must not be exact",
      );
    },
  },
  {
    id: 2,
    title: "Exact brand plus model ahead of close model",
    request: { query: "FixtureBrand Model AB-120", searchMode: "intent" },
    fixture: [
      fixture("brand-model-exact", "FixtureBrand Model AB-120", {
        brand: "FixtureBrand",
        exactMatchScore: 1,
      }),
      fixture("brand-model-close", "FixtureBrand Model AB-121", {
        brand: "FixtureBrand",
        exactMatchScore: 0.3,
      }),
    ],
    goldLabels: {
      exactProductId: "brand-model-exact",
      closeProductId: "brand-model-close",
    },
    check(result) {
      assertTop(result, "brand-model-exact");
      assertClassification(result, "brand-model-exact", "exact");
      assertClassification(result, "brand-model-close", "close");
    },
  },
  {
    id: 3,
    title: "Seller-scoped SKU matches only its seller offer",
    request: { query: "Fixture Seller SKU FS-4401", searchMode: "intent" },
    fixture: [
      fixture("sku-scoped-match", "Fixture Seller SKU FS-4401", {
        merchant: "Fixture Seller A",
        exactMatchScore: 1,
      }),
      fixture("sku-other-seller", "Fixture Seller SKU FS-4401", {
        merchant: "Fixture Seller B",
        exactMatchScore: 1,
      }),
    ],
    goldLabels: {
      seller: "Fixture Seller A",
      sku: "FS-4401",
      exactProductId: "sku-scoped-match",
      sameSkuOtherSellerMustNotMatch: "sku-other-seller",
    },
    check(result) {
      assertTop(result, "sku-scoped-match");
      assertClassification(result, "sku-scoped-match", "exact");
      assert.notEqual(result.classifications?.["sku-other-seller"], "exact");
    },
  },
  {
    id: 4,
    title: "Exact MPN distinct from a near MPN",
    request: { query: "Fixture MPN ZX-8842", searchMode: "intent" },
    fixture: [
      fixture("mpn-exact", "Fixture MPN ZX-8842", { exactMatchScore: 1 }),
      fixture("mpn-close", "Fixture MPN ZX-8843", { exactMatchScore: 0.2 }),
    ],
    goldLabels: { exactProductId: "mpn-exact", nearProductId: "mpn-close" },
    check(result) {
      assertTop(result, "mpn-exact");
      assertClassification(result, "mpn-exact", "exact");
      assert.notEqual(result.classifications?.["mpn-close"], "exact");
    },
  },
  {
    id: 5,
    title: "One exact product retains two distinct merchant offers",
    request: { query: "FixtureBrand Shared Model P-20", searchMode: "intent" },
    fixture: [
      fixture("shared-offer-a", "FixtureBrand Shared Model P-20", {
        merchant: "Fixture Merchant A",
        productUrl: "https://fixture.invalid/offer/a",
        exactMatchScore: 1,
      }),
      fixture("shared-offer-b", "FixtureBrand Shared Model P-20", {
        merchant: "Fixture Merchant B",
        productUrl: "https://fixture.invalid/offer/b",
        exactMatchScore: 1,
      }),
    ],
    goldLabels: {
      identity: "synthetic-product-P20",
      offerIds: ["shared-offer-a", "shared-offer-b"],
    },
    check(result) {
      assert.deepEqual(
        result.products.map((product) => product.id).sort(),
        ["shared-offer-a", "shared-offer-b"],
      );
      assert.deepEqual(
        result.identityGroups?.["synthetic-product-P20"],
        ["shared-offer-a", "shared-offer-b"],
        "offers must remain distinct within the shared identity group",
      );
    },
  },
  {
    id: 6,
    title: "Exact model outranks a one-character-different model",
    request: { query: "FixtureBrand XR-9A", searchMode: "intent" },
    fixture: [
      fixture("one-char-exact", "FixtureBrand XR-9A", { exactMatchScore: 1 }),
      fixture("one-char-close", "FixtureBrand XR-9B", { exactMatchScore: 0.25 }),
    ],
    goldLabels: { exactProductId: "one-char-exact", closeProductId: "one-char-close" },
    check(result) {
      assertTop(result, "one-char-exact");
      assertClassification(result, "one-char-exact", "exact");
      assertClassification(result, "one-char-close", "close");
    },
  },
  {
    id: 7,
    title: "Arabic Bluetooth-audio category relevance",
    request: { query: "أبي سماعة بلوتوث", searchMode: "intent" },
    fixture: [
      fixture("arabic-audio", "Bluetooth سماعة صوت", {
        category: "electronics",
        productType: "headphones",
        exactMatchScore: 1,
      }),
      fixture("arabic-irrelevant", "Desk lamp", {
        category: "home_living",
        productType: "lamp",
        exactMatchScore: 0,
      }),
    ],
    goldLabels: { relevantIds: ["arabic-audio"], irrelevantIds: ["arabic-irrelevant"] },
    check(result) {
      assertTop(result, "arabic-audio");
      assert.equal(
        result.products.some((product) => product.id === "arabic-irrelevant"),
        false,
        "irrelevant result must not be presented as relevant",
      );
    },
  },
  {
    id: 10,
    title: "Arabic soft budget is not converted into a hard cap",
    request: { query: "أبي شنطة بحدود 250 ريال", searchMode: "intent" },
    fixture: [
      bag("soft-budget-near", 250),
      bag("soft-budget-above", 420),
    ],
    goldLabels: {
      approximateBudgetSAR: 250,
      hardCap: false,
      bothOffersCanRemain: true,
    },
    check(result) {
      assert.equal(result.structuredIntent?.approximatePrice, 250);
      assert.equal(result.structuredIntent?.maxPrice, undefined);
      assert.ok(
        result.products.some((product) => product.id === "soft-budget-above"),
        "soft budget must not silently exclude every over-budget alternative",
      );
    },
  },
  {
    id: 13,
    title: "Mixed English/Arabic wireless-earbud query keeps verified white color",
    request: { query: "wireless earbuds أبيها أبيض", searchMode: "intent" },
    fixture: [
      fixture("mixed-white-earbuds", "wireless earbuds", {
        color: "white",
        productType: "earbuds",
        category: "electronics",
        exactMatchScore: 1,
      }),
      fixture("mixed-black-earbuds", "wireless earbuds", {
        color: "black",
        productType: "earbuds",
        category: "electronics",
        exactMatchScore: 1,
      }),
    ],
    goldLabels: { qualifyingIds: ["mixed-white-earbuds"], color: "white" },
    check(result) {
      assert.deepEqual(
        result.products.map((product) => product.id),
        ["mixed-white-earbuds"],
      );
    },
  },
  {
    id: 14,
    title: "Arabic request preserves Latin brand/model identity",
    request: { query: "أبغى FixtureBrand model QX-750", searchMode: "intent" },
    fixture: [
      fixture("mixed-brand-model", "FixtureBrand QX-750", {
        brand: "FixtureBrand",
        exactMatchScore: 1,
      }),
      fixture("mixed-brand-near", "FixtureBrand QX-751", {
        brand: "FixtureBrand",
        exactMatchScore: 0.2,
      }),
    ],
    goldLabels: { exactProductId: "mixed-brand-model", exactModel: "QX-750" },
    check(result) {
      assertTop(result, "mixed-brand-model");
      assertClassification(result, "mixed-brand-model", "exact");
    },
  },
  {
    id: 17,
    title: "Dialect USB-C charger query retrieves connector-matched fixture",
    request: { query: "ابي شاحن تايب سي", searchMode: "intent" },
    fixture: [
      fixture("usb-c-fixture", "USB-C charger", {
        productType: "charger",
        category: "electronics",
        description: "Controlled fixture connector: USB-C; wattage unspecified.",
        exactMatchScore: 1,
      }),
      fixture("micro-usb-fixture", "Micro-USB charger", {
        productType: "charger",
        category: "electronics",
        description: "Controlled fixture connector: Micro-USB.",
        exactMatchScore: 0.1,
      }),
    ],
    goldLabels: { relevantIds: ["usb-c-fixture"], unsupportedWattage: null },
    check(result) {
      assertTop(result, "usb-c-fixture");
      assertClassification(result, "usb-c-fixture", "exact");
    },
  },
  {
    id: 18,
    title: "Arabic synonym جوال retrieves the phone fixture",
    request: { query: "أبي جوال", searchMode: "intent" },
    fixture: [
      fixture("arabic-phone-synonym", "هاتف ذكي phone", {
        productType: "phone",
        category: "electronics",
        exactMatchScore: 1,
      }),
      fixture("arabic-synonym-irrelevant", "Handbag", {
        productType: "handbag",
        category: "bags_accessories",
        exactMatchScore: 0,
      }),
    ],
    goldLabels: { canonicalIntent: "phone", relevantIds: ["arabic-phone-synonym"] },
    check(result) {
      assertTop(result, "arabic-phone-synonym");
      assert.equal(
        result.products.some((product) => product.id === "arabic-synonym-irrelevant"),
        false,
      );
    },
  },
  {
    id: 19,
    title: "Arabic numerals preserve Latin phone model",
    request: { query: "أبي آيفون ١٥", searchMode: "intent" },
    fixture: [
      fixture("arabic-numeral-iphone15", "iPhone 15", {
        brand: "FixturePhone",
        productType: "phone",
        category: "electronics",
        exactMatchScore: 1,
      }),
      fixture("arabic-numeral-iphone14", "iPhone 14", {
        brand: "FixturePhone",
        productType: "phone",
        category: "electronics",
        exactMatchScore: 0.2,
      }),
    ],
    goldLabels: { exactProductId: "arabic-numeral-iphone15", modelNumber: 15 },
    check(result) {
      assertTop(result, "arabic-numeral-iphone15");
      assertClassification(result, "arabic-numeral-iphone15", "exact");
    },
  },
  {
    id: 20,
    title: "Unique supported brand typo correction",
    request: { query: "Samsng Galaxy Fixture S24", searchMode: "intent" },
    fixture: [
      fixture("brand-typo-correction", "Samsung Galaxy Fixture S24", {
        brand: "Samsung",
        exactMatchScore: 1,
      }),
    ],
    goldLabels: {
      inputTypo: "Samsng",
      onlySupportedCorrection: "Samsung",
      exactProductId: "brand-typo-correction",
    },
    check(result) {
      assertTop(result, "brand-typo-correction");
      assertClassification(result, "brand-typo-correction", "exact");
    },
  },
  {
    id: 21,
    title: "Ambiguous Jaguar query requests clarification",
    request: { query: "Jaguar", searchMode: "intent" },
    fixture: [
      fixture("ambiguous-jaguar-auto", "Jaguar car", { exactMatchScore: 1 }),
      fixture("ambiguous-jaguar-animal", "Jaguar animal", { exactMatchScore: 1 }),
    ],
    goldLabels: { interpretations: ["automobile", "animal"], expected: "clarification" },
    check(result) {
      assertState(result, "clarification");
      assert.deepEqual(result.products, []);
    },
  },
  {
    id: 22,
    title: "Unsupported Arabic misspelling does not invent a correction",
    request: { query: "حقيبة مرزفنة", searchMode: "intent" },
    fixture: [
      fixture("unsupported-typo-chair", "office chair", { category: "home_living" }),
      fixture("unsupported-typo-phone", "mobile phone", { category: "electronics" }),
    ],
    goldLabels: {
      exhaustiveFixtureSnapshot: true,
      supportedCorrection: null,
      expectedState: "no_match",
    },
    check(result) {
      assertState(result, "no_match");
      assert.deepEqual(result.products, []);
    },
  },
  {
    id: 23,
    title: "Generic charger query asks for device or connector",
    request: { query: "أبي شاحن", searchMode: "intent" },
    fixture: [
      fixture("generic-charger-usbc", "USB-C charger", { productType: "charger" }),
      fixture("generic-charger-lightning", "Lightning charger", { productType: "charger" }),
    ],
    goldLabels: {
      ambiguity: "device/connector unspecified",
      expected: "clarification",
      noCompatibilityClaims: true,
    },
    check(result) {
      assertState(result, "clarification");
    },
  },
  {
    id: 33,
    title: "Strict maximum-price boundary is strictly less than SAR 300",
    request: { query: "شنطة أقل من 300 ريال", searchMode: "intent" },
    fixture: [
      bag("strict-under-300", 299.99),
      bag("strict-equal-300", 300),
      bag("strict-over-300", 301),
    ],
    goldLabels: { qualifyingIds: ["strict-under-300"], operator: "<", capSAR: 300 },
    check(result) {
      assert.deepEqual(
        result.products.map((product) => product.id),
        ["strict-under-300"],
      );
    },
  },
  {
    id: 34,
    title: "Unknown price never qualifies under strict price cap",
    request: { query: "شنطة أقل من 300 ريال", searchMode: "intent" },
    fixture: [bag("unknown-price-qualifying", 299), bag("unknown-price-item", null)],
    goldLabels: { qualifyingIds: ["unknown-price-qualifying"], unknownPriceQualifies: false },
    check(result) {
      assert.deepEqual(
        result.products.map((product) => product.id),
        ["unknown-price-qualifying"],
      );
    },
  },
  {
    id: 35,
    title: "Requested blue color excludes navy and black",
    request: { query: "أزرق", searchMode: "intent" },
    fixture: [
      bag("color-blue", 100, { color: "blue" }),
      bag("color-navy", 100, { color: "navy" }),
      bag("color-black", 100, { color: "black" }),
    ],
    goldLabels: { qualifyingIds: ["color-blue"], navyEquivalentToBlue: false },
    check(result) {
      assert.deepEqual(result.products.map((product) => product.id), ["color-blue"]);
    },
  },
  {
    id: 36,
    title: "Absent requested color yields explicit no-match",
    request: { query: "أبي شنطة خضراء", searchMode: "intent" },
    fixture: [bag("absent-color-black", 80), bag("absent-color-blue", 90, { color: "blue" })],
    goldLabels: { qualifyingIds: [], expectedState: "no_match" },
    check(result) {
      assertState(result, "no_match");
      assert.deepEqual(result.products, []);
    },
  },
  {
    id: 37,
    title: "Exact shoe size 38 in explicitly labeled EU system",
    request: { query: "حذاء مقاس 38 EU", searchMode: "intent" },
    fixture: [
      fixture("size-38-eu", "running shoe size 38 EU", {
        productType: "shoe",
        category: "shoes",
        description: "Controlled fixture size=38, sizeSystem=EU.",
      }),
      fixture("size-39-eu", "running shoe size 39 EU", {
        productType: "shoe",
        category: "shoes",
        description: "Controlled fixture size=39, sizeSystem=EU.",
      }),
    ],
    goldLabels: { qualifyingIds: ["size-38-eu"], size: 38, sizeSystem: "EU" },
    check(result) {
      assert.deepEqual(result.products.map((product) => product.id), ["size-38-eu"]);
    },
  },
  {
    id: 38,
    title: "Missing size system requests clarification",
    request: { query: "shoe size 38", searchMode: "intent" },
    fixture: [
      fixture("size-system-eu", "running shoe size 38", {
        productType: "shoe",
        description: "Controlled fixture size=38; system=EU.",
      }),
      fixture("size-system-us", "running shoe size 38", {
        productType: "shoe",
        description: "Controlled fixture size=38; system=US.",
      }),
    ],
    goldLabels: { systems: ["EU", "US"], expectedState: "clarification" },
    check(result) {
      assertState(result, "clarification");
    },
  },
  {
    id: 39,
    title: "New-only excludes used and unknown condition",
    request: { query: "new fixture handbag only", searchMode: "intent" },
    fixture: [
      bag("condition-new", 50, { condition: "new" }),
      bag("condition-used", 40, { condition: "used" }),
      bag("condition-unknown", 45, { condition: "unknown" }),
    ],
    goldLabels: { qualifyingIds: ["condition-new"], condition: "new" },
    check(result) {
      assert.deepEqual(result.products.map((product) => product.id), ["condition-new"]);
    },
  },
  {
    id: 40,
    title: "Used-only excludes new and unknown condition",
    request: { query: "مستعمل شنطة fixture", searchMode: "intent" },
    fixture: [
      bag("used-only-used", 40, { condition: "used" }),
      bag("used-only-new", 50, { condition: "new" }),
      bag("used-only-unknown", 45, { condition: "unknown" }),
    ],
    goldLabels: { qualifyingIds: ["used-only-used"], condition: "used" },
    check(result) {
      assert.deepEqual(result.products.map((product) => product.id), ["used-only-used"]);
    },
  },
  {
    id: 41,
    title: "Used in Jeddah means seller location, not shipping destination",
    request: { query: "مستعمل في جدة", searchMode: "intent" },
    fixture: [
      bag("local-used-jeddah", 100, { condition: "used", location: "Jeddah" }),
      bag("remote-used-delivery-jeddah", 80, {
        condition: "used",
        location: "Riyadh",
        description: "Synthetic fixture: seller in Riyadh; delivery destination noted Jeddah.",
      }),
      bag("local-new-jeddah", 90, { condition: "new", location: "Jeddah" }),
    ],
    goldLabels: {
      qualifyingIds: ["local-used-jeddah"],
      sellerLocality: "Jeddah",
      deliveryIsNotLocality: true,
    },
    check(result) {
      assert.deepEqual(result.products.map((product) => product.id), ["local-used-jeddah"]);
    },
  },
  {
    id: 49,
    title: "Cheaper offer is same identity, not merely a lookalike",
    request: { query: "FixtureBrand ExactModel Z-4 cheaper offer", searchMode: "intent" },
    fixture: [
      fixture("cheaper-same-identity", "FixtureBrand ExactModel Z-4", {
        merchant: "Fixture Merchant B",
        price: 95,
        productUrl: "https://fixture.invalid/same/b",
        exactMatchScore: 1,
      }),
      fixture("reference-price-same-identity", "FixtureBrand ExactModel Z-4", {
        merchant: "Fixture Merchant A",
        price: 120,
        productUrl: "https://fixture.invalid/same/a",
        exactMatchScore: 1,
      }),
      fixture("cheaper-lookalike", "FixtureBrand ExactModel Z-5", {
        merchant: "Fixture Merchant C",
        price: 70,
        productUrl: "https://fixture.invalid/lookalike/c",
        exactMatchScore: 0.2,
      }),
    ],
    goldLabels: {
      identity: "synthetic-Z4",
      cheaperSameIdentityOffer: "cheaper-same-identity",
      closeAlternative: "cheaper-lookalike",
    },
    check(result) {
      assertTop(result, "cheaper-same-identity");
      assertClassification(result, "cheaper-same-identity", "exact");
      assertClassification(result, "cheaper-lookalike", "close");
    },
  },
  {
    id: 51,
    title: "Stale/out-of-stock low offer is not called currently purchasable",
    request: { query: "FixtureBrand stale current offer P-51", searchMode: "intent" },
    fixture: [
      fixture("stale-cheaper-offer", "FixtureBrand stale current offer P-51", {
        price: 70,
        availability: "out_of_stock",
        updatedAt: "2024-01-01T00:00:00.000Z",
        exactMatchScore: 1,
      }),
      fixture("current-available-offer", "FixtureBrand current offer P-51", {
        price: 95,
        availability: "in_stock",
        updatedAt: "2026-09-29T00:00:00.000Z",
        exactMatchScore: 1,
      }),
    ],
    goldLabels: {
      purchasableOfferIds: ["current-available-offer"],
      staleUnavailableOfferId: "stale-cheaper-offer",
    },
    check(result) {
      const staleOffer = result.products.find(
        (product) => product.id === "stale-cheaper-offer",
      );
      assert.ok(
        !staleOffer || staleOffer.availability !== "in_stock",
        "a stale/out-of-stock offer may appear only with its unavailable status",
      );
      assert.ok(
        result.products.some((product) => product.id === "current-available-offer"),
      );
    },
  },
  {
    id: 52,
    title: "Similar alternative is explicitly distinguished from exact",
    request: { query: "similar alternative to FixtureBrand Camera M10", searchMode: "intent" },
    fixture: [
      fixture("similar-camera", "FixtureBrand Camera M11", {
        productType: "camera",
        exactMatchScore: 0.6,
      }),
    ],
    goldLabels: { resultId: "similar-camera", identity: "similar", expectedState: "similar_alternative" },
    check(result) {
      assertClassification(result, "similar-camera", "similar");
      assertState(result, "similar_alternative");
    },
  },
  {
    id: 53,
    title: "Only close model exists; it must not be called the same item",
    request: { query: "same FixtureBrand Model Q-100", searchMode: "intent" },
    fixture: [
      fixture("same-only-close", "FixtureBrand Model Q-101", {
        brand: "FixtureBrand",
        exactMatchScore: 0.5,
      }),
    ],
    goldLabels: {
      exactIdentityExists: false,
      closeProductId: "same-only-close",
      expectedClassification: "close",
    },
    check(result) {
      assertClassification(result, "same-only-close", "close");
      assert.notEqual(result.classifications?.["same-only-close"], "exact");
    },
  },
  {
    id: 55,
    title: "Unique nonexistent token returns explicit no-match",
    request: { query: "unmatchable-fixture-token-55", searchMode: "intent" },
    fixture: [
      fixture("no-match-blue-chair", "blue office chair", { category: "home_living" }),
      fixture("no-match-usb-charger", "USB-C charger", { category: "electronics" }),
    ],
    goldLabels: { exhaustiveFixtureSnapshot: true, matchingFixtureIds: [], expectedState: "no_match" },
    check(result) {
      assertState(result, "no_match");
      assert.deepEqual(result.products, []);
    },
  },
  {
    id: 56,
    title: "Absent category yields no match, not adjacent products",
    request: { query: "refrigerator", searchMode: "intent" },
    fixture: [
      fixture("absent-category-chair", "office chair", { category: "home_living" }),
      fixture("absent-category-phone", "mobile phone", { category: "electronics" }),
    ],
    goldLabels: { exhaustiveFixtureSnapshot: true, absentCategory: "refrigerator", expectedState: "no_match" },
    check(result) {
      assertState(result, "no_match");
      assert.deepEqual(result.products, []);
    },
  },
  {
    id: 57,
    title: "Relevance outranks popular synthetic affiliate",
    request: { query: "FixtureBrand exact headphones H-1", searchMode: "intent" },
    fixture: [
      fixture("affiliate-irrelevant-popular", "viral phone case", {
        rating: 5,
        reviewCount: 100000,
        affiliateUrl: "https://fixture.invalid/affiliate/irrelevant",
        exactMatchScore: 0,
      }),
      fixture("affiliate-neutral-relevant", "FixtureBrand exact headphones H-1", {
        productType: "headphones",
        exactMatchScore: 1,
      }),
    ],
    goldLabels: {
      relevantId: "affiliate-neutral-relevant",
      irrelevantPopularAffiliateId: "affiliate-irrelevant-popular",
      monetizationDoesNotChangeRelevance: true,
    },
    check(result) {
      assertTop(result, "affiliate-neutral-relevant");
      assertClassification(result, "affiliate-irrelevant-popular", "irrelevant");
    },
  },
  {
    id: 58,
    title: "Strict color and price empty intersection remains empty",
    request: { query: "شنطة زرقاء أقل من 300 ريال", searchMode: "intent" },
    fixture: [
      bag("intersection-blue-over", 350, { color: "blue" }),
      bag("intersection-black-under", 200, { color: "black" }),
      bag("intersection-blue-unknown", null, { color: "blue" }),
    ],
    goldLabels: { qualifyingIds: [], color: "blue", priceOperator: "<", capSAR: 300 },
    check(result) {
      assert.deepEqual(result.products, []);
    },
  },
  {
    id: 59,
    title: "Duplicate indexed copies of one offer deduplicate",
    request: { query: "USB-C charger", searchMode: "intent" },
    fixture: [
      fixture("duplicate-copy-a", "USB-C charger", {
        merchant: "Fixture Merchant",
        productUrl: undefined,
        exactMatchScore: 1,
      }),
      fixture("duplicate-copy-b", "USB-C charger", {
        merchant: "Fixture Merchant",
        productUrl: undefined,
        exactMatchScore: 1,
      }),
    ],
    goldLabels: { canonicalOfferId: "fixture-canonical-offer", duplicateRecordCount: 2 },
    check(result) {
      assert.equal(result.products.length, 1);
    },
  },
  {
    id: 60,
    title: "Same product across merchants preserves both distinct offers",
    request: { query: "FixtureBrand Shared Model S-60", searchMode: "intent" },
    fixture: [
      fixture("multi-merchant-a", "FixtureBrand Shared Model S-60", {
        merchant: "Fixture Merchant A",
        productUrl: "https://fixture.invalid/merchant/a",
        price: 120,
        exactMatchScore: 1,
      }),
      fixture("multi-merchant-b", "FixtureBrand Shared Model S-60", {
        merchant: "Fixture Merchant B",
        productUrl: "https://fixture.invalid/merchant/b",
        price: 110,
        exactMatchScore: 1,
      }),
    ],
    goldLabels: {
      identity: "synthetic-S60",
      offerIds: ["multi-merchant-a", "multi-merchant-b"],
    },
    check(result) {
      assert.deepEqual(
        result.products.map((product) => product.id).sort(),
        ["multi-merchant-a", "multi-merchant-b"],
      );
      assert.deepEqual(
        result.identityGroups?.["synthetic-S60"],
        ["multi-merchant-a", "multi-merchant-b"],
      );
    },
  },
  {
    id: 61,
    title: "Conflicting synthetic evidence is surfaced as uncertainty",
    request: { query: "FixtureBrand Conflicted Product C-61", searchMode: "intent" },
    fixture: [
      fixture("conflict-price-source-a", "FixtureBrand Conflicted Product C-61", {
        merchant: "Fixture Merchant",
        price: 100,
        condition: "new",
        source: "controlled-source-a",
        updatedAt: "2026-01-01T00:00:00.000Z",
        productUrl: "https://fixture.invalid/conflict/a",
        exactMatchScore: 1,
      }),
      fixture("conflict-price-source-b", "FixtureBrand Conflicted Product C-61", {
        merchant: "Fixture Merchant",
        price: 80,
        condition: "used",
        source: "controlled-source-b",
        updatedAt: "2026-01-02T00:00:00.000Z",
        productUrl: "https://fixture.invalid/conflict/b",
        exactMatchScore: 1,
      }),
    ],
    goldLabels: {
      conflictingFields: ["price", "condition"],
      expectedState: "conflicting_evidence",
      bothSourcesAreSynthetic: true,
    },
    check(result) {
      assertState(result, "conflicting_evidence");
    },
  },
  {
    id: 62,
    title: "Affiliate metadata does not displace exact relevant result",
    request: { query: "FixtureBrand exact watch W-62", searchMode: "intent" },
    fixture: [
      fixture("affiliate-irrelevant-watch", "popular unrelated smartwatch strap", {
        productType: "accessory",
        affiliateUrl: "https://fixture.invalid/affiliate/unrelated",
        rating: 5,
        reviewCount: 50000,
        exactMatchScore: 0,
      }),
      fixture("affiliate-neutral-exact-watch", "FixtureBrand exact watch W-62", {
        productType: "watch",
        exactMatchScore: 1,
      }),
    ],
    goldLabels: {
      exactRelevantId: "affiliate-neutral-exact-watch",
      irrelevantAffiliateId: "affiliate-irrelevant-watch",
    },
    check(result) {
      assertTop(result, "affiliate-neutral-exact-watch");
      assertClassification(result, "affiliate-irrelevant-watch", "irrelevant");
    },
  },
  {
    id: 63,
    title: "Provider retrieval failure is not represented as verified no-match",
    request: { query: "FixtureBrand failure sentinel", searchMode: "intent" },
    fixture: [
      fixture("fixture-provider-failure", "provider retrieval failure sentinel", {
        exactMatchScore: 1,
      }),
    ],
    goldLabels: {
      providerThrows: true,
      expectedState: "retrieval_failure",
      distinctFromNoMatch: true,
    },
    check(result) {
      assert.deepEqual(result.products, []);
      assertState(result, "retrieval_failure");
      assert.notEqual(result.interactionState, "no_match");
    },
  },
];

/** Phase 1 can substitute this adapter and return classifications/states/groups. */
export const runV2Search: SearchAdapter = async (request, fixtureProducts) => {
  const fixtureProvider: SearchProvider = {
    metadata: FIXTURE_METADATA,
    async search() {
      if (fixtureProducts.some((product) => product.id === "fixture-provider-failure")) {
        throw new Error("Synthetic controlled-fixture retrieval failure.");
      }
      return fixtureProducts;
    },
  };
  let response;
  try {
    response = await new SearchOrchestrator(
      new ProviderRegistry([fixtureProvider]),
    ).searchWithMetadata({
      ...request,
      preferredProviderIds: [FIXTURE_PROVIDER_ID],
    });
  } catch (error) {
    return {
      products: [],
      exactMatches: 0,
      constraintRelaxationAvailable: false,
      retrievalError: {
        name: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
  return {
    products: response.products.map((product) => ({
      id: product.id,
      title: product.title,
      description: product.description ?? null,
      merchant: product.merchant ?? null,
      price: product.price ?? null,
      currency: product.currency ?? null,
      sourceType: product.sourceType,
      brand: product.brand ?? null,
      color: product.color ?? null,
      productType: product.productType ?? null,
      condition: product.condition ?? null,
      location: product.location ?? null,
      availability: product.availability ?? null,
      updatedAt: product.updatedAt ?? null,
      rating: product.rating ?? null,
      reviewCount: product.reviewCount ?? null,
      isAffiliate: product.isAffiliate,
    })),
    exactMatches: response.exactMatches,
    constraintRelaxationAvailable: response.constraintRelaxationAvailable,
    structuredIntent: response.structuredIntent,
  };
};

export type CaseSnapshot = {
  caseId: number;
  title: string;
  query: string;
  goldLabels: Record<string, unknown>;
  status: "PASS" | "FAIL";
  elapsedMs: number;
  fixtureProductCount: number;
  fixtureOnly: true;
  response: SearchAdapterResult | undefined;
  error: string | undefined;
};

/** Run the unchanged corpus and assertions using V2 or an injected Phase 1 adapter. */
export async function runAcceptance(
  adapter: SearchAdapter = runV2Search,
): Promise<CaseSnapshot[]> {
  const snapshots: CaseSnapshot[] = [];
  for (const testCase of acceptanceCases) {
    const startedAt = performance.now();
    let result: SearchAdapterResult | undefined;
    let errorMessage: string | undefined;
    try {
      result = await adapter(testCase.request, testCase.fixture);
      testCase.check(result);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }
    snapshots.push({
      caseId: testCase.id,
      title: testCase.title,
      query: testCase.request.query,
      goldLabels: testCase.goldLabels,
      status: errorMessage ? "FAIL" : "PASS",
      elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
      fixtureProductCount: testCase.fixture.length,
      fixtureOnly: true,
      response: result,
      error: errorMessage,
    });
  }
  return snapshots;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const snapshots = await runAcceptance();
  const report = {
    schemaVersion: 2,
    baselineVersion: "v2.2.0-expanded-baseline-2026-09-30",
    generatedAt: new Date().toISOString(),
    adapter: "current SearchOrchestrator.searchWithMetadata",
    networkCalls: false,
    realProductsOrOffers: false,
    fixtureNotice:
      "All product, offer, identifier, attribute, and gold-label data in this report is synthetic controlled fixture data; it is not real inventory or a real measurement.",
    counts: {
      executableControlledCases: acceptanceCases.length,
      pass: snapshots.filter((snapshot) => snapshot.status === "PASS").length,
      fail: snapshots.filter((snapshot) => snapshot.status === "FAIL").length,
    },
    cases: snapshots,
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (snapshots.some((snapshot) => snapshot.status !== "PASS")) {
    process.exitCode = 1;
  }
}