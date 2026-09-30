import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePhase1Intent } from "./phase1Intent";
import { planPhase1Queries } from "./queryPlanner";

describe("bounded Phase 1 query planner", () => {
  it("emits the exact identifier verbatim as the primary query", async () => {
    const intent = await parsePhase1Intent("OEM: ٠٩٠٣-abC Toyota headlamp");
    const plan = planPhase1Queries(intent);
    assert.equal(plan[0]?.strategy, "EXACT_ID");
    assert.equal(plan[0]?.query, "٠٩٠٣-abC");
    assert.ok(plan.some((item) => item.query.includes("٠٩٠٣-abC")));
    assert.equal(plan[0]?.stage, "EXACT");
    assert.equal(plan.length, 1);
  });

  it("preserves slash identifiers, OEM numbers, Arabic digits, and bare model codes", async () => {
    const identifierCases = [
      { query: "SKU AB-12/34", value: "AB-12/34", kind: "sku" as const },
      { query: "MPN ZX-8842", value: "ZX-8842", kind: "mpn" as const },
      { query: "OEM 90915-10003", value: "90915-10003", kind: "oem" as const },
      { query: "mpn ٠٩١٥-١٠٠٠٣", value: "٠٩١٥-١٠٠٠٣", kind: "mpn" as const },
    ];
    for (const sample of identifierCases) {
      const intent = await parsePhase1Intent(sample.query);
      const plan = planPhase1Queries(intent);
      assert.equal(intent[sample.kind].value, sample.value);
      assert.equal(plan[0]?.strategy, "EXACT_ID");
      assert.equal(plan[0]?.query, sample.value);
    }

    const modelCodeIntent = await parsePhase1Intent("WH-1000XM5");
    assert.equal(modelCodeIntent.model.value, "WH-1000XM5");
    const modelCodePlan = planPhase1Queries(modelCodeIntent);
    assert.equal(modelCodePlan[0]?.strategy, "EXACT_ID");
    assert.equal(modelCodePlan[0]?.query, "WH-1000XM5");
  });

  it("uses only checksum-valid bare GTIN-14 as an exact-ID primary", async () => {
    const validQuery = "00012345678905";
    const validIntent = await parsePhase1Intent(validQuery);
    assert.equal(validIntent.gtin14.value, validQuery);
    assert.equal(validIntent.gtin14.sourceText, validQuery);
    assert.ok(validIntent.hardRequirements.some((requirement) => requirement.field === "gtin14" && requirement.evidence === "USER_EXPLICIT"));
    const validPlan = planPhase1Queries(validIntent);
    assert.equal(validPlan[0]?.strategy, "EXACT_ID");
    assert.equal(validPlan[0]?.query, validQuery);

    const invalidQuery = "00012345678904";
    const invalidIntent = await parsePhase1Intent(invalidQuery);
    assert.equal(invalidIntent.gtin14.value, null);
    assert.equal(planPhase1Queries(invalidIntent)[0]?.query, invalidQuery);
    assert.notEqual(planPhase1Queries(invalidIntent)[0]?.strategy, "EXACT_ID");
  });

  it("prioritizes explicit model codes and preserves uncertified query text", async () => {
    const query = "FixtureBrand Model AB-120";
    const plan = planPhase1Queries(await parsePhase1Intent(query));
    assert.equal(plan[0]?.strategy, "EXACT_ID");
    assert.equal(plan[0]?.query, "AB-120");
    for (const modelQuery of ["FixtureBrand Model XR-9A", "FixtureBrand Model AB-120"]) {
      const modelPlan = planPhase1Queries(await parsePhase1Intent(modelQuery));
      assert.equal(modelPlan[0]?.strategy, "EXACT_ID");
      assert.equal(modelPlan[0]?.query, modelQuery.endsWith("XR-9A") ? "XR-9A" : "AB-120");
    }
    const naturalLanguage = "USB-C charger";
    assert.equal(planPhase1Queries(await parsePhase1Intent(naturalLanguage))[0]?.query, naturalLanguage);
  });

  it("uses the original contextual model query at Stage B without unlocking broader stages", async () => {
    const query = "FixtureBrand Shared Model P-20";
    const intent = await parsePhase1Intent(query);
    assert.ok(intent.hardRequirements.some((requirement) => requirement.field === "model"));
    const plan = planPhase1Queries(intent, "BROAD");
    assert.equal(plan[0]?.query, "P-20");
    assert.equal(plan[0]?.stage, "EXACT");
    assert.equal(plan[1]?.query, query);
    assert.equal(plan[1]?.stage, "LEXICAL");
    assert.deepEqual(plan.map((item) => item.stage), ["EXACT", "LEXICAL"]);
  });

  it("returns one primary and only bounded bilingual fallbacks", async () => {
    const intent = await parsePhase1Intent("أبي شنطة جلد");
    const plan = planPhase1Queries(intent, "BROAD");
    assert.equal(plan[0]?.role, "PRIMARY");
    assert.ok(plan.slice(1).every((item) => item.role === "FALLBACK"));
    assert.ok(plan.length >= 2 && plan.length <= 4);
    assert.equal(new Set(plan.map((item) => item.query.toLocaleLowerCase())).size, plan.length);
    assert.ok(plan.slice(1).some((item) => /[a-z]/iu.test(item.query)));
  });

  it("retains mixed-language model identifier text and never calls providers", async () => {
    const query = "أبي Toyota Camry موديل ٢٠٢٠ SKU: Ab-٠٠٤";
    const intent = await parsePhase1Intent(query);
    const plan = planPhase1Queries(intent);
    assert.equal(plan[0]?.query, "Ab-٠٠٤");
    assert.ok(intent.rawQuery.includes("موديل ٢٠٢٠"));
    assert.equal(intent.sku.value, "Ab-٠٠٤");
    assert.ok(plan.length <= 3);
  });

  it("uses explicit category/attribute context without inventing constraints", async () => {
    const intent = await parsePhase1Intent("black leather shoes");
    const plan = planPhase1Queries(intent);
    assert.ok(plan.length > 0);
    assert.ok(plan.every((item) => item.query.trim().length > 0));
    assert.ok(intent.hardRequirements.every((requirement) => requirement.evidence === "USER_EXPLICIT"));
    assert.ok(plan.every((item) => item.strategy !== "EXACT_ID"));
  });

  it("classifies model requests and raw query as deterministic primary", async () => {
    const intent = await parsePhase1Intent("Toyota Camry");
    const plan = planPhase1Queries(intent);
    assert.equal(plan[0]?.query, "Toyota Camry");
    assert.equal(plan[0]?.strategy, "BRAND_MODEL");
    assert.equal(plan[0]?.stage, "EXACT");
  });

  it("only adds later stages when requested and caps the plan at four distinct queries", async () => {
    const intent = await parsePhase1Intent("أبي حقيبة جلد");
    const exact = planPhase1Queries(intent);
    assert.equal(exact.length, 1);
    assert.deepEqual(exact.map((item) => item.stage), ["EXACT"]);

    const expanded = planPhase1Queries(intent, "BROAD");
    assert.ok(expanded.length <= 4);
    assert.deepEqual(expanded.map((item) => item.stage), ["EXACT", ...expanded.slice(1).map((item) => item.stage)]);
    assert.ok(expanded.slice(1).every((item) => ["LEXICAL", "EXPANSION", "BROAD"].includes(item.stage)));
    assert.equal(new Set(expanded.map((item) => item.query.toLocaleLowerCase())).size, expanded.length);
    assert.equal(planPhase1Queries(intent, "LEXICAL").some((item) => item.stage === "EXPANSION"), false);
  });

  it("does not expand unresolved Arabic شمعة into one guessed automotive part", async () => {
    const intent = await parsePhase1Intent("أبغى شمعة");
    const plan = planPhase1Queries(intent);
    assert.equal(plan.length, 1);
    assert.equal(plan[0]?.query, "أبغى شمعة");
    assert.ok(intent.clarificationReasons.length > 0);
  });

  it("keeps explicit sizes in plans and separates cheaper alternatives from same-variant checks", async () => {
    const mixedSizeQueries = [
      { query: "Nike أسود مقاس EU 42", size: "EU 42" },
      { query: "Nike black size 42", size: "42" },
      { query: "جزمة Nike 42", size: "42" },
      { query: "Diesel jeans مقاس 32", size: "32" },
    ];
    for (const sample of mixedSizeQueries) {
      const intent = await parsePhase1Intent(sample.query);
      const plan = planPhase1Queries(intent);
      assert.equal(intent.size.value, sample.size, sample.query);
      assert.ok(plan[0]?.query.includes(sample.size), sample.query);
    }

    const alternativeQuery = "cheaper alternative Nike black shoes size 42";
    const alternativeIntent = await parsePhase1Intent(alternativeQuery);
    const alternativePlan = planPhase1Queries(alternativeIntent, "LEXICAL");
    assert.deepEqual(alternativeIntent.relations.value, ["similar", "cheaper"]);
    assert.ok(alternativePlan.some((item) => item.stage === "LEXICAL" && /Nike.*shoes.*black.*42/i.test(item.query)));
    assert.ok(alternativeIntent.hardRequirements.some((requirement) =>
      requirement.field === "size" && requirement.value === "42",
    ));

    const sameVariant = await parsePhase1Intent("same Nike black shoes size 42 but cheaper");
    assert.deepEqual(sameVariant.relations.value, ["exact", "cheaper"]);
    assert.deepEqual(planPhase1Queries(sameVariant, "BROAD").map((item) => item.stage), ["EXACT"]);
  });

  it("uses referenced models as lexical anchors for alternatives, not exact-ID constraints", async () => {
    const fixtureAlternative = await parsePhase1Intent("similar to FixtureBrand ExactModel Z-4 but cheaper");
    assert.equal(fixtureAlternative.relations.value?.includes("exact"), false);
    const fixturePlan = planPhase1Queries(fixtureAlternative, "LEXICAL");
    assert.notEqual(fixturePlan[0]?.strategy, "EXACT_ID");
    assert.ok(fixturePlan.some((item) =>
      item.stage === "LEXICAL" && item.query.includes("FixtureBrand") && item.query.includes("Z-4"),
    ));
    assert.equal(fixtureAlternative.hardRequirements.some((requirement) => requirement.field === "model"), false);

    for (const [query, brand, model, product] of [
      ["cheaper alternative to Nike Air Max 270 shoes", "Nike", "Air Max 270", "shoes"],
      ["similar to Dyson Airwrap hair styler", "Dyson", "Airwrap", "hair styler"],
    ] as const) {
      const intent = await parsePhase1Intent(query);
      const plan = planPhase1Queries(intent, "LEXICAL");
      assert.equal(intent.brand.value, brand, query);
      assert.equal(intent.model.value, model, query);
      assert.equal(intent.productType.value, product, query);
      assert.notEqual(plan[0]?.strategy, "EXACT_ID", query);
      assert.ok(plan.some((item) =>
        item.stage === "LEXICAL" && item.query.includes(brand) && item.query.includes(model),
      ), query);
      assert.equal(intent.hardRequirements.some((requirement) => requirement.field === "model"), false, query);
    }

    const sameProduct = await parsePhase1Intent("same FixtureBrand ExactModel Z-4 but cheaper");
    const sameProductPlan = planPhase1Queries(sameProduct, "LEXICAL");
    assert.deepEqual(sameProduct.relations.value, ["exact", "cheaper"]);
    assert.equal(sameProductPlan[0]?.strategy, "EXACT_ID");
    assert.ok(sameProduct.hardRequirements.some((requirement) =>
      requirement.field === "model" && requirement.value === "Z-4",
    ));
  });
});