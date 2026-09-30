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

test("parses Arabic maximum price, product, color, and explicit Saudi currency", async () => {
  const intent = await new DeterministicIntentParser().parse(
    "شنطة سوداء أقل من ٣٠٠ ريال",
  );

  assert.equal(intent.productType, "handbag");
  assert.equal(intent.color, "black");
  assert.equal(intent.maxPrice, 300);
  assert.equal(intent.currency, "SAR");
});

test("parses Arabic minimum and maximum price ranges with Arabic-Indic digits", async () => {
  const intent = await new DeterministicIntentParser().parse(
    "جزمة من ۲۰۰ إلى ۴۰۰",
  );

  assert.equal(intent.productType, "shoes");
  assert.equal(intent.minPrice, 200);
  assert.equal(intent.maxPrice, 400);
  assert.equal(intent.currency, "SAR");
});

test("parses a Saudi budget phrase as a strict maximum", async () => {
  const intent = await new DeterministicIntentParser().parse("ميزانيتي 500");

  assert.equal(intent.maxPrice, 500);
  assert.equal(intent.minPrice, undefined);
});

test("parses ما يتعدى as a strict maximum", async () => {
  const intent = await new DeterministicIntentParser().parse(
    "ساعة ما يتعدى 600 ريال",
  );

  assert.equal(intent.productType, "watch");
  assert.equal(intent.maxPrice, 600);
  assert.equal(intent.currency, "SAR");
});

test("keeps an approximate price separate from strict maximum and minimum", async () => {
  const intent = await new DeterministicIntentParser().parse("حوالي 300 ريال");

  assert.equal(intent.approximatePrice, 300);
  assert.equal(intent.maxPrice, undefined);
  assert.equal(intent.minPrice, undefined);
  assert.equal(intent.currency, "SAR");
});

test("preserves an explicit strict maximum alongside an approximate price", async () => {
  const intent = await new DeterministicIntentParser().parse(
    "شنطة حوالي 300 لكن ما يتعدى 350",
  );

  assert.equal(intent.productType, "handbag");
  assert.equal(intent.approximatePrice, 300);
  assert.equal(intent.maxPrice, 350);
  assert.equal(intent.minPrice, undefined);
});

test("parses حدود as an approximate price without adding strict price bounds", async () => {
  const intent = await new DeterministicIntentParser().parse("شنطة حدود ٣٠٠ ريال");

  assert.equal(intent.productType, "handbag");
  assert.equal(intent.approximatePrice, 300);
  assert.equal(intent.maxPrice, undefined);
  assert.equal(intent.minPrice, undefined);
  assert.equal(intent.currency, "SAR");
});

test("keeps Arabic strict price phrases strict and separate from soft amounts", async () => {
  const parser = new DeterministicIntentParser();
  const lessThan = await parser.parse("جزمة أقل من 300");
  const doesNotExceed = await parser.parse("ساعة ما يتعدى 300");
  const around = await parser.parse("جاكيت حوالي 300");

  assert.equal(lessThan.maxPrice, 300);
  assert.equal(lessThan.approximatePrice, undefined);
  assert.equal(doesNotExceed.maxPrice, 300);
  assert.equal(doesNotExceed.approximatePrice, undefined);
  assert.equal(around.approximatePrice, 300);
  assert.equal(around.maxPrice, undefined);
});

test("preserves contextual iPhone model numbers without treating them as prices", async () => {
  const parser = new DeterministicIntentParser();
  const english = await parser.parse("iPhone 15");
  const mixed = await parser.parse("ابغى ايفون 15 Pro Max مستعمل حدود ٣٠٠");
  const explicitlyBranded = await parser.parse("Apple iPhone 15");

  assert.equal(english.productType, undefined);
  assert.equal(english.brand, undefined);
  assert.match(english.normalized ?? "", /iphone 15/iu);
  assert.equal(english.maxPrice, undefined);
  assert.equal(english.minPrice, undefined);
  assert.equal(english.approximatePrice, undefined);

  assert.equal(mixed.productType, undefined);
  assert.equal(mixed.brand, undefined);
  assert.equal(mixed.condition, "used");
  assert.equal(mixed.approximatePrice, 300);
  assert.equal(mixed.maxPrice, undefined);
  assert.match(mixed.normalized ?? "", /iphone 15 pro max/iu);

  assert.equal(explicitlyBranded.brand, "Apple");
  assert.equal(explicitlyBranded.productType, undefined);
  assert.match(explicitlyBranded.normalized ?? "", /iphone 15/iu);
});

test("preserves explicitly labeled fashion sizes but not unmarked standalone amounts", async () => {
  const parser = new DeterministicIntentParser();
  const labeled = await parser.parse("Diesel jeans مقاس 32 اسود مستعمل");
  const sizeOnly = await parser.parse("مقاس 42");
  const unmarked = await parser.parse("ساعة 300");

  assert.equal(labeled.brand, "Diesel");
  assert.equal(labeled.productType, "jeans");
  assert.equal(labeled.color, "black");
  assert.equal(labeled.condition, "used");
  assert.match(labeled.normalized ?? "", /مقاس 32/iu);
  assert.equal(labeled.maxPrice, undefined);
  assert.equal(labeled.minPrice, undefined);

  assert.match(sizeOnly.normalized ?? "", /مقاس 42/iu);
  assert.equal(sizeOnly.maxPrice, undefined);
  assert.equal(sizeOnly.minPrice, undefined);
  assert.equal(sizeOnly.approximatePrice, undefined);
  assert.doesNotMatch(unmarked.normalized ?? "", /300/u);
  assert.equal(unmarked.maxPrice, undefined);
  assert.equal(unmarked.minPrice, undefined);
  assert.equal(unmarked.approximatePrice, undefined);
});
