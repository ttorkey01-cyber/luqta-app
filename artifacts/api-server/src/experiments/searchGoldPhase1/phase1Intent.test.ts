import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePhase1Intent } from "./phase1Intent";

describe("Phase 1 Saudi shopping intent", () => {
  it("preserves Saudi dialect user wording and explicit query text", async () => {
    for (const phrase of ["أبغى", "أبي", "أبغا", "ودي"]) {
      const query = `${phrase} شنطة سوداء`;
      const intent = await parsePhase1Intent(query);
      assert.equal(intent.rawQuery, query);
      assert.equal(intent.explicitText, query);
      assert.equal(intent.productType.value, "handbag");
      assert.equal(intent.color.value, "black");
      assert.equal(intent.color.evidence, "USER_EXPLICIT");
    }
  });

  it("parses typed fields and preserves Arabic-digit OEM identifiers verbatim", async () => {
    const query = "أبي شمعة أمامية Toyota Camry موديل ٢٠٢٠ OEM: ٠٩٠٣-abc في جدة";
    const intent = await parsePhase1Intent(query);
    assert.equal(intent.productType.value, "headlight");
    assert.equal(intent.brand.value, "Toyota");
    assert.equal(intent.vehicle.model.value, "Camry");
    assert.equal(intent.model.value, "Camry");
    assert.equal(intent.vehicle.year.value, "2020");
    assert.equal(intent.vehicle.year.evidence, "USER_EXPLICIT");
    assert.equal(intent.vehicle.year.sourceText, "٢٠٢٠");
    assert.equal(intent.oem.value, "٠٩٠٣-abc");
    assert.equal(intent.vehicle.oemNumber.value, "٠٩٠٣-abc");
    assert.ok(intent.rawQuery.includes("OEM: ٠٩٠٣-abc"));
    assert.equal(intent.city.value, "Jeddah");
    assert.equal(intent.automotive.value, true);
    assert.equal(intent.ambiguityReasons.length, 0);
    assert.equal(intent.clarificationReasons.length, 0);
    assert.doesNotMatch(intent.clarificationReasons.join(" "), /fitment/i);
    const camry2022 = await parsePhase1Intent("Toyota Camry 2022");
    assert.equal(camry2022.vehicle.model.value, "Camry");
    assert.equal(camry2022.vehicle.year.value, "2022");
    assert.equal(camry2022.model.value, "Camry");
  });

  it("distinguishes spark plugs and surfaces standalone شمعة ambiguity", async () => {
    for (const query of ["أبغا شمعة احتراق Toyota Camry", "شمعة المحرك", "spark plug Toyota Camry"]) {
      const spark = await parsePhase1Intent(query);
      assert.equal(spark.productType.value, "spark plug");
      assert.equal(spark.automotive.value, true);
      assert.doesNotMatch(spark.ambiguityReasons.join(" "), /شمعة is ambiguous/);
      if (query === "شمعة المحرك") assert.match(spark.clarificationReasons.join(" "), /make\/model/i);
    }
    const headlamp = await parsePhase1Intent("أبي شمعة السيارة في جدة");
    assert.equal(headlamp.productType.value, "headlight");
    assert.doesNotMatch(headlamp.ambiguityReasons.join(" "), /شمعة is ambiguous/);
    assert.match(headlamp.clarificationReasons.join(" "), /make\/model/i);

    const ambiguous = await parsePhase1Intent("أبغى شمعة");
    assert.equal(ambiguous.productType.value, null);
    assert.equal(ambiguous.automotive.value, null);
    assert.ok(ambiguous.ambiguityReasons.length);
    assert.ok(ambiguous.clarificationReasons.length);
  });

  it("keeps strict and approximate budget semantics distinct", async () => {
    const table = [
      { query: "شنطة ما يتعدى ٣٠٠ ريال", max: 300, min: null, approx: null, op: "lte" },
      { query: "shoes under 100 SAR", max: 100, min: null, approx: null, op: "lt" },
      { query: "أبي كرسي فوق ٥٠", max: null, min: 50, approx: null, op: "gt" },
      { query: "شنطة بين ١٠٠ و ٢٠٠", max: 200, min: 100, approx: null, op: "gte" },
      { query: "شنطة أقل من ٣٠٠", max: 300, min: null, approx: null, op: "lt" },
      { query: "شنطة حدود ٣٠٠ ريال", max: null, min: null, approx: 300, op: undefined },
      { query: "bag around $50", max: null, min: null, approx: 50, op: undefined },
    ] as const;
    for (const sample of table) {
      const intent = await parsePhase1Intent(sample.query);
      assert.equal(intent.budget.value?.max, sample.max, sample.query);
      assert.equal(intent.budget.value?.min, sample.min, sample.query);
      assert.equal(intent.budget.value?.approximate, sample.approx, sample.query);
      assert.equal(intent.hardRequirements[0]?.operator, sample.op, sample.query);
      if (sample.op === undefined) assert.equal(intent.hardRequirements.length, 0);
    }
    assert.equal((await parsePhase1Intent("bag around $50")).budget.value?.currency, "USD");
    const inclusiveRange = await parsePhase1Intent("bag between 100 and 200");
    assert.deepEqual(inclusiveRange.hardRequirements.map((requirement) => requirement.operator), ["gte", "lte"]);
  });

  it("parses exact/similar/cheaper, condition, material, size and style from mixed languages", async () => {
    const examples = [
      { query: "نفس هذا بس أسود", relation: "exact", color: "black" },
      { query: "زيها مثله", relation: "similar" },
      { query: "أرخص منه", relation: "cheaper" },
    ] as const;
    for (const example of examples) {
      const intent = await parsePhase1Intent(example.query);
      assert.equal(intent.relation.value, example.relation);
    }
    assert.equal((await parsePhase1Intent("نفس هذا بس أسود")).color.value, "black");
    const exactCheaper = await parsePhase1Intent("دور لي نفس الساعة بس أرخص");
    assert.equal(exactCheaper.relation.value, "cheaper");
    assert.deepEqual(exactCheaper.relations.value, ["exact", "cheaper"]);
    assert.equal(exactCheaper.relations.evidence, "USER_EXPLICIT");
    assert.deepEqual((await parsePhase1Intent("same watch but cheaper")).relations.value, ["exact", "cheaper"]);
    const intent = await parsePhase1Intent("new leather shoes size 42 style classic original");
    assert.equal(intent.condition.value, "new");
    assert.equal(intent.material.value, "leather");
    assert.equal(intent.size.value, "42");
    assert.equal(intent.style.value, "classic");
    assert.equal(intent.authenticity.value, true);
    const genericModel = await parsePhase1Intent("Samsung Galaxy S24");
    assert.equal(genericModel.model.value, "Galaxy S24");
  });

  it("trusts contextual LV only through the stable parser, not low-voltage text", async () => {
    const lv = await parsePhase1Intent("دورلي LV handbag");
    assert.equal(lv.brand.value, "Louis Vuitton");
    assert.equal(lv.brand.evidence, "USER_EXPLICIT");
    const voltage = await parsePhase1Intent("low-voltage sensor");
    assert.equal(voltage.brand.value, null);
  });

  it("keeps labeled and bare model codes while only extracting an explicitly labeled brand", async () => {
    for (const [query, expectedCode, expectedBrand] of ([
      ["FixtureBrand Model AB-120", "AB-120", "FixtureBrand"],
      ["FixtureBrand Model XR-9A", "XR-9A", "FixtureBrand"],
      ["WH-1000XM5", "WH-1000XM5", null],
    ] as const)) {
      const intent = await parsePhase1Intent(query);
      assert.equal(intent.model.value, expectedCode);
      assert.equal(intent.model.sourceText, expectedCode);
      assert.equal(intent.brand.value, expectedBrand);
    }
  });

  it("decomposes explicit brand/model pairs, mixed-script phones, and corroborated Samsung typo", async () => {
    const fixture = await parsePhase1Intent("FixtureBrand Model AB-120");
    assert.equal(fixture.brand.value, "FixtureBrand");
    assert.equal(fixture.brand.sourceText, "FixtureBrand");
    assert.equal(fixture.model.value, "AB-120");
    assert.equal((await parsePhase1Intent("أبي FixtureBrand Model XR-9A")).brand.value, "FixtureBrand");
    for (const query of [
      "FixtureBrand ExactModel Z-4",
      "FixtureBrand XR-9A",
      "FixtureBrand Shared Model P-20",
      "FixtureBrand Camera M10",
    ]) {
      const intent = await parsePhase1Intent(query);
      assert.equal(intent.brand.value, "FixtureBrand", query);
    }
    assert.equal((await parsePhase1Intent("FixtureBrand ExactModel Z-4")).model.value, "Z-4");
    assert.equal((await parsePhase1Intent("FixtureBrand Shared Model P-20")).model.value, "P-20");
    assert.equal((await parsePhase1Intent("FixtureBrand Camera M10")).model.value, "M10");

    const iphone = await parsePhase1Intent("أبي iPhone ١٥");
    assert.equal(iphone.brand.value, "Apple");
    assert.equal(iphone.model.value, "iPhone ١٥");
    assert.equal(iphone.model.sourceText, "iPhone ١٥");
    const arabicIphone = await parsePhase1Intent("آيفون ١٥");
    assert.equal(arabicIphone.brand.value, "Apple");
    assert.equal(arabicIphone.model.value, "آيفون ١٥");
    assert.ok(arabicIphone.hardRequirements.some((requirement) => requirement.field === "model" && requirement.value === "آيفون ١٥"));

    const corrected = await parsePhase1Intent("Samsng Galaxy Fixture S24");
    assert.equal(corrected.brand.value, "Samsung");
    assert.equal(corrected.brand.sourceText, "Samsng");
    assert.equal(corrected.model.value, "S24");
    assert.equal((await parsePhase1Intent("Samsng case")).brand.value, null);
  });

  it("handles seller-scoped SKU, size systems, charger/Jaguar ambiguity, and soft preferences", async () => {
    const sellerSku = await parsePhase1Intent("seller SKU: Ab-٠٠٤");
    assert.equal(sellerSku.sku.value, "Ab-٠٠٤");
    assert.ok(sellerSku.hardRequirements.some((requirement) => requirement.field === "seller_sku" && requirement.value === "Ab-٠٠٤"));

    const euSize = await parsePhase1Intent("shoes EU 38");
    assert.equal(euSize.size.value, "EU 38");
    assert.ok(euSize.hardRequirements.some((requirement) => requirement.field === "size" && requirement.value === "EU 38"));
    const unclearSize = await parsePhase1Intent("shoes size 38");
    assert.equal(unclearSize.size.value, "38");
    assert.match(unclearSize.clarificationReasons.join(" "), /size system/i);

    const charger = await parsePhase1Intent("charger");
    assert.match(charger.clarificationReasons.join(" "), /device|connector/i);
    assert.equal((await parsePhase1Intent("USB-C charger")).clarificationReasons.length, 0);
    const arabicTypeC = await parsePhase1Intent("ابي شاحن تايب سي");
    assert.equal(arabicTypeC.productType.value, "charger");
    assert.equal(arabicTypeC.clarificationReasons.length, 0);
    assert.ok(arabicTypeC.hardRequirements.some((requirement) => requirement.field === "connector" && requirement.value === "USB-C"));
    assert.match((await parsePhase1Intent("Jaguar")).clarificationReasons.join(" "), /vehicle|animal/i);
    assert.equal((await parsePhase1Intent("Jaguar XE")).clarificationReasons.length, 0);

    const preferred = await parsePhase1Intent("يفضل black shoes");
    assert.equal(preferred.color.value, "black");
    assert.equal(preferred.hardRequirements.some((requirement) => requirement.field === "color"), false);
    assert.ok((await parsePhase1Intent("بس black shoes")).hardRequirements.some((requirement) => requirement.field === "color"));
    assert.equal((await parsePhase1Intent("شنطة بحدود ٣٠٠")).budget.value?.approximate, 300);
  });

  it("recognizes requested Saudi Arabic-English product synonyms without guessing شمعة", async () => {
    const synonyms: Array<[string, string]> = [
      ["حقيبة", "handbag"], ["موبايل", "phone"], ["حذاء", "shoes"], ["نظارة", "glasses"],
      ["ساعة", "watch"], ["صدام", "bumper"],
    ];
    for (const [query, product] of synonyms) {
      assert.equal((await parsePhase1Intent(query)).productType.value, product, query);
    }
    assert.equal((await parsePhase1Intent("مستعمل phone")).condition.value, "used");
    const original = await parsePhase1Intent("original phone");
    assert.equal(original.authenticity.value, true);
    assert.equal(original.hardRequirements.some((requirement) => requirement.field === "authenticity"), false);
    const ambiguous = await parsePhase1Intent("شمعة السيارة");
    assert.equal(ambiguous.productType.value, "headlight");
  });

  it("parses mixed Arabic/English earbuds and USB-C charger wording", async () => {
    const earbuds = await parsePhase1Intent("أبغى earbuds سماعات الأذن");
    assert.equal(earbuds.productType.value, "earbuds");
    assert.equal(earbuds.category.value, "electronics");
    assert.equal(earbuds.rawQuery, "أبغى earbuds سماعات الأذن");
    const charger = await parsePhase1Intent("USB-C charger");
    assert.equal(charger.productType.value, "charger");
    assert.equal(charger.category.value, "electronics");
  });

  it("never makes inferred or unknown values hard requirements", async () => {
    const intent = await parsePhase1Intent("handbag", { maxPrice: 1000, condition: "used", brand: "Example" });
    assert.equal(intent.budget.value, null);
    assert.equal(intent.condition.value, null);
    assert.equal(intent.brand.value, "Example");
    assert.equal(intent.brand.evidence, "HIGH_CONFIDENCE");
    assert.deepEqual(intent.hardRequirements, []);
  });

  it("uses explicit exact and similar requirement evidence only", async () => {
    const intent = await parsePhase1Intent("شنطة مستعمل أصلي في جدة أقل من 300");
    assert.equal(intent.condition.value, "used");
    assert.equal(intent.authenticity.value, true);
    assert.ok(intent.hardRequirements.every((requirement) => requirement.evidence === "USER_EXPLICIT"));
    assert.ok(intent.hardRequirements.some((requirement) => requirement.operator === "lt"));
  });
});