import assert from "node:assert/strict";
import test from "node:test";
import { deterministicIntentParser } from "./intentParser";
import {
  MAX_EXTERNAL_RETRIEVAL_QUERIES,
  planRetrievalQueries,
} from "./retrievalQueryPlanner";
import { normalizeArabicForSearch } from "./queryExpansion";

async function planned(query: string) {
  const intent = await deterministicIntentParser.parse(query);
  return planRetrievalQueries(query, intent);
}

test("plans bounded bilingual phone retrieval with hard SAR budgets", async () => {
  const queries = await planned("جوال أقل من 1500 ريال");

  assert.ok(queries.length <= MAX_EXTERNAL_RETRIEVAL_QUERIES);
  assert.ok(queries.every((query) => /1500/.test(query)));
  assert.ok(queries.every((query) => /under 1500|أقل من 1500/iu.test(query)));
  assert.ok(queries.some((query) => /phone|mobile/i.test(query)));
  assert.ok(queries.some((query) => /under 1500 SAR/i.test(query)));
  assert.ok(queries.some((query) => /[\u0600-\u06ff]/u.test(query)));
});

test("keeps a watch budget soft and uses product-listing language", async () => {
  const queries = await planned("ساعة حدود 500 ريال");

  assert.ok(queries.some((query) => /watch|watches/i.test(query)));
  assert.ok(queries.some((query) => /around 500 SAR/i.test(query)));
  assert.ok(!queries.some((query) => /under 500/i.test(query)));
  assert.ok(queries.some((query) => /product listing/i.test(query)));
  assert.ok(queries.every((query) => /500/.test(query)));
  assert.ok(queries.every((query) => /around 500|حوالي 500/iu.test(query)));
});

test("seeks Diesel jeans listings with waist-size semantics", async () => {
  const queries = await planned("Diesel jeans مقاس 32");

  assert.ok(queries.every((query) => /Diesel|ديزل/iu.test(query)));
  assert.ok(queries.every((query) => /jeans?|denim|جينز/iu.test(query)));
  assert.ok(queries.every((query) => /waist 32|مقاس 32/iu.test(query)));
  assert.ok(queries.some((query) => /[\u0600-\u06ff]/u.test(query)));
  assert.ok(!queries.some((query) => /inseam 32/i.test(query)));
  const inseamOnly = await planned("Diesel jeans inseam 32");
  assert.ok(inseamOnly.every((query) => !/waist 32/i.test(query)));
  assert.ok(inseamOnly.some((query) => /inseam 32/i.test(query)));

  const conflictingDimensions = await planned("Diesel jeans size 32 waist 34");
  assert.ok(conflictingDimensions.every((query) => /size 32/i.test(query)));
  assert.ok(conflictingDimensions.every((query) => /waist 34/i.test(query)));
  assert.ok(conflictingDimensions.every((query) => !/waist 32/i.test(query)));
});

test("preserves EU shoe sizes and does not reinterpret millimeters as shoe size", async () => {
  const shoeQueries = await planned("Nike shoes size 42");
  const euQueries = await planned("Nike shoes EU 42");
  const millimeterQueries = await planned("Nike watch 42 mm");
  const ukQueries = await planned("Nike shoes UK 8");
  const usQueries = await planned("Nike shoes US 9");

  assert.ok(shoeQueries.some((query) => /Nike.*(?:EU 42|size 42)/i.test(query)));
  assert.ok(shoeQueries.every((query) => !/EU 42/i.test(query)));
  assert.ok(euQueries.every((query) => /EU 42/i.test(query)));
  assert.ok(ukQueries.every((query) => /UK 8/i.test(query)));
  assert.ok(usQueries.every((query) => /US 9/i.test(query)));
  assert.ok(millimeterQueries.some((query) => /42 mm/i.test(query)));
  assert.ok(!millimeterQueries.some((query) => /EU 42|size 42/i.test(query)));
  const labeledMillimeters = await planned("Nike watch size 42 mm");
  assert.ok(labeledMillimeters.some((query) => /size 42 mm/i.test(query)));
  assert.ok(!labeledMillimeters.some((query) => /EU 42/i.test(query)));
  const mixedMeasurements = await planned("Nike watch 42 mm and size 20");
  assert.ok(mixedMeasurements.every((query) => /42 mm/i.test(query)));
  assert.ok(mixedMeasurements.every((query) => /(?:size|مقاس) 20/i.test(query)));
});

test("preserves black-bag intent with and without a hard price cap", async () => {
  const bagQueries = await planned("black bag");
  const budgetQueries = await planned("black bag under $200");

  assert.ok(bagQueries.some((query) => /black.*(?:bag|handbag)/i.test(query)));
  assert.ok(budgetQueries.some((query) => /under 200 USD/i.test(query)));
  assert.ok(budgetQueries.some((query) => /black.*(?:bag|handbag)/i.test(query)));
  assert.ok(budgetQueries.every((query) => /200/.test(query)));
  assert.ok(budgetQueries.every((query) => /under 200|أقل من 200/iu.test(query)));
});

test("every retrieval variant honors authoritative structured fields and bounds", () => {
  const queries = planRetrievalQueries(
    "Nike black shoes size 42 under 500 SAR",
    {
      normalized: "Adidas white shoes size 41 under 300 SAR",
      productType: "shoes",
      brand: "Adidas",
      color: "white",
      maxPrice: 300,
      currency: "SAR",
    },
  );

  assert.equal(queries.length, MAX_EXTERNAL_RETRIEVAL_QUERIES);
  for (const query of queries) {
    assert.match(query, /Adidas/i);
    assert.match(query, /white|أبيض/iu);
    assert.match(query, /300/);
    assert.match(query, /under 300|أقل من 300/iu);
    assert.match(query, /size 41|مقاس 41/iu);
    assert.match(query, /shoes?|حذاء/iu);
    assert.doesNotMatch(query, /Nike|black|500/iu);
    assert.match(query, /Saudi Arabia|السعودية/iu);
  }
});

test("preserves complete distinctive Samsung and iPhone model identifiers", async () => {
  const samsung = await planned("Samsung S24 Ultra");
  const iphone = await planned("iPhone 15 Pro Max");

  assert.ok(samsung.every((query) => /S24 Ultra/i.test(query)));
  assert.ok(iphone.every((query) => /iPhone 15 Pro Max/i.test(query)));
});

test("retains original case for unlabeled gate identifiers", async () => {
  const uppercase = await planned("black bag QZVTR-999");
  const lowercase = await planned("black bag qzvtr-999");

  assert.ok(uppercase.every((query) => query.includes("QZVTR-999")));
  assert.ok(lowercase.every((query) => query.includes("qzvtr-999")));
});

test("retains an impossible unknown SKU rather than broadening it away", async () => {
  const queries = await planned("black bag SKU QZ-999XYZ");

  assert.ok(queries.length > 0);
  assert.ok(queries.every((query) => /QZ-999XYZ/i.test(query)));
  assert.ok(queries.every((query) => /Saudi Arabia|السعودية/iu.test(query)));
});

test("preserves explicitly labeled opaque SKU and model spellings exactly", async () => {
  const queries = await planned(
    "black bag SKU XYZ_123 model Ab.CD",
  );

  assert.ok(queries.every((query) => query.includes("XYZ_123")));
  assert.ok(queries.every((query) => query.includes("Ab.CD")));
  assert.ok(queries.every((query) => !/XYZ123|AbCD/u.test(query)));
});

test("keeps unknown canonical product types in the Arabic variant", () => {
  const queries = planRetrievalQueries(
    "QZVTR-999 seventeen-handle purple toaster",
    {
      normalized: "QZVTR-999 seventeen-handle purple toaster",
      productType: "toaster",
    },
  );

  assert.ok(queries.every((query) => /QZVTR-999/u.test(query)));
  assert.ok(queries.every((query) => /toaster/iu.test(query)));
  assert.ok(queries.every((query) => /seventeen-handle/u.test(query)));
});

test("preserves Arabic millimeter and centimeter units without unitless sizes", () => {
  const intent = {
    normalized: "Diesel jeans size 42",
    productType: "jeans",
    brand: "Diesel",
  };
  const millimeters = planRetrievalQueries("جينز مقاس 42مم", intent);
  const centimeters = planRetrievalQueries("جينز مقاس 42 سم", intent);
  const hasUnitlessWaist = (query: string) =>
    /(?:waist|size)\s*42(?!\s*(?:mm|cm))|مقاس\s*42(?!\s*(?:مم|سم))/iu.test(query);

  assert.ok(millimeters.every((query) => /42مم/u.test(query)));
  assert.ok(centimeters.every((query) => /42\s*سم/u.test(query)));
  assert.ok(millimeters.every((query) => !hasUnitlessWaist(query)));
  assert.ok(centimeters.every((query) => !hasUnitlessWaist(query)));

  const arabicIntent = {
    normalized: "Diesel jeans size 42",
    productType: "jeans",
    brand: "Diesel",
  };
  const arabicDigitsMm = planRetrievalQueries("جينز مقاس٤٢مم", arabicIntent);
  assert.ok(arabicDigitsMm.every((query) => /٤٢مم/u.test(query)));
  assert.ok(arabicDigitsMm.every((query) => !hasUnitlessWaist(query)));

  const fractionalCm = planRetrievalQueries(
    "Nike shoes size 42.5cm",
    { normalized: "Nike shoes size 42", productType: "shoes", brand: "Nike" },
  );
  assert.ok(fractionalCm.every((query) => /42\.5cm/iu.test(query)));
  assert.ok(
    fractionalCm.every((query) => !/\b(?:size|EU)\s*42(?![.,]\d)/iu.test(query)),
  );
});

test("authoritative Arabic price bounds replace rather than duplicate raw bounds", () => {
  const queries = planRetrievalQueries("جوال أقل من 1500 ريال", {
    normalized: "phone under 900 SAR",
    productType: "phone",
    maxPrice: 900,
    currency: "SAR",
  });

  assert.ok(queries.every((query) => /900/.test(query)));
  assert.ok(queries.every((query) => /under 900|أقل من 900/iu.test(query)));
  assert.ok(queries.every((query) => !/1500/.test(query)));
});

test("Arabic structured output keeps original Arabic terms and unknown words", async () => {
  const queries = await planned("هاتف ذكي أسود أقل من 1500 ريال");
  const bag = await planned("شنطة منظف");

  assert.ok(queries.every((query) => /1500/.test(query)));
  assert.ok(queries.some((query) => /هاتف/u.test(query)));
  assert.ok(queries.some((query) => /أسود/u.test(query)));
  assert.ok(bag.some((query) => /منظف/u.test(query)));
});

test("keeps contextual LV shopping transliteration and rejects ambiguous LV", async () => {
  const shopping = await planned("ابغا شنطة ال في");
  const ambiguous = await planned("LV in a low voltage circuit");

  assert.ok(shopping.some((query) => /Louis Vuitton/i.test(query)));
  assert.ok(
    !ambiguous.some((query) => /Louis Vuitton/i.test(query)),
  );
});

test("removes equivalent planned queries after normalization", async () => {
  const intent = await deterministicIntentParser.parse("Samsung S24 Ultra");
  const queries = planRetrievalQueries("Samsung S24 Ultra", intent);
  const normalized = queries.map((query) =>
    normalizeArabicForSearch(query).replace(/[^\p{L}\p{N}]+/gu, " ").trim(),
  );

  assert.equal(new Set(normalized).size, queries.length);
  assert.ok(queries.length <= MAX_EXTERNAL_RETRIEVAL_QUERIES);
  assert.ok(queries.every((query) => /S24 Ultra/i.test(query)));
});

test("never exceeds the external retrieval query budget", async () => {
  const examples = [
    "جوال أقل من 1500 ريال",
    "ساعة حدود 500 ريال",
    "Diesel jeans مقاس 32",
    "Nike shoes size 42",
    "black bag under $200",
    "Samsung S24 Ultra",
    "iPhone 15 Pro Max",
    "black bag SKU QZ-999XYZ",
  ];

  for (const query of examples) {
    const result = await planned(query);
    assert.ok(result.length <= MAX_EXTERNAL_RETRIEVAL_QUERIES, query);
  }
});