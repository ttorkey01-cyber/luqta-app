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
    assert.ok(plan.length <= 3);
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

  it("returns one primary and only bounded bilingual fallbacks", async () => {
    const intent = await parsePhase1Intent("أبي شنطة جلد");
    const plan = planPhase1Queries(intent);
    assert.equal(plan[0]?.role, "PRIMARY");
    assert.ok(plan.slice(1).every((item) => item.role === "FALLBACK"));
    assert.ok(plan.length >= 2 && plan.length <= 3);
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
  });

  it("does not expand unresolved Arabic شمعة into one guessed automotive part", async () => {
    const intent = await parsePhase1Intent("أبغى شمعة");
    const plan = planPhase1Queries(intent);
    assert.equal(plan.length, 1);
    assert.equal(plan[0]?.query, "أبغى شمعة");
    assert.ok(intent.clarificationReasons.length > 0);
  });
});