import assert from "node:assert/strict";
import test from "node:test";
import { DeterministicIntentParser } from "./intentParser";

test("parses Arabic shopping attributes, brand, and maximum price", async () => {
  const parser = new DeterministicIntentParser();
  const intent = await parser.parse("ساعة Guess رجالي سوداء أقل من 700");

  assert.equal(intent.productType, "watch");
  assert.equal(intent.category, "watches_jewelry");
  assert.equal(intent.brand, "Guess");
  assert.equal(intent.audience, "men");
  assert.equal(intent.color, "black");
  assert.equal(intent.maxPrice, 700);
  assert.equal(intent.currency, "SAR");
  assert.match(intent.normalized ?? "", /watch/iu);
});

test("canonicalizes all required Arabic brand transliterations", async () => {
  const parser = new DeterministicIntentParser();
  const brands = [
    ["جيس", "Guess"],
    ["ديزل", "Diesel"],
    ["نايك", "Nike"],
    ["اديداس", "Adidas"],
    ["أديداس", "Adidas"],
    ["شي ان", "SHEIN"],
    ["شي إن", "SHEIN"],
  ] as const;

  for (const [alias, canonical] of brands) {
    const intent = await parser.parse(`${alias} ساعة`);
    assert.equal(intent.brand, canonical, `${alias} should resolve to ${canonical}`);
  }
});

test("resolves Louis Vuitton aliases consistently in shopping context", async () => {
  const parser = new DeterministicIntentParser();
  const queries = [
    "ابغا شنطة ال في",
    "LV handbag",
    "شنطة لويس فيتون",
  ];

  for (const query of queries) {
    const intent = await parser.parse(query);
    assert.equal(intent.brand, "Louis Vuitton", query);
    assert.equal(intent.productType, "handbag", query);
    assert.equal(intent.normalized, "Louis Vuitton handbag", query);
  }

  const usedBag = await parser.parse("شنطة ال في مستعملة");
  assert.equal(usedBag.brand, "Louis Vuitton");
  assert.equal(usedBag.condition, "used");

  for (const query of [
    "LV is a low voltage circuit",
    "ال في في الدائرة الكهربائية",
  ]) {
    const ambiguous = await parser.parse(query);
    assert.equal(ambiguous.brand, undefined, query);
  }
});

test("parses Saudi product phrases with brand, model, color, gender, and type", async () => {
  const parser = new DeterministicIntentParser();
  const nike = await parser.parse("جزمة نايك اير فورس بيضاء");
  const dior = await parser.parse("عطر ديور سوفاج");
  const rolex = await parser.parse("ساعة رولكس رجالية");

  assert.equal(nike.brand, "Nike");
  assert.equal(nike.productType, "shoes");
  assert.equal(nike.color, "white");

  assert.equal(dior.brand, "Dior");
  assert.equal(dior.productType, "perfume");

  assert.equal(rolex.brand, "Rolex");
  assert.equal(rolex.productType, "watch");
  assert.equal(rolex.audience, "men");
});

test("parses an automotive part query without treating authenticity as condition", async () => {
  const parser = new DeterministicIntentParser();
  const intent = await parser.parse("شمعة كامري 2022 أصلية");

  assert.equal(intent.productType, "headlight");
  assert.equal(intent.category, "automotive");
  assert.equal(intent.partName, "headlight");
  assert.equal(intent.vehicleMake, "Toyota");
  assert.equal(intent.vehicleModel, "Camry");
  assert.equal(intent.vehicleYear, "2022");
  assert.equal(intent.condition, undefined);
});

test("keeps unsupported words unclassified rather than inventing intent", async () => {
  const parser = new DeterministicIntentParser();
  const intent = await parser.parse("مقاس ٤٠");

  assert.equal(intent.productType, undefined);
  assert.equal(intent.brand, undefined);
  assert.equal(intent.maxPrice, undefined);
  assert.equal(intent.minPrice, undefined);
});