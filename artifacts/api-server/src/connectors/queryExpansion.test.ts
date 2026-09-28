import assert from "node:assert/strict";
import test from "node:test";
import {
  expandShoppingQuery,
  getBilingualShoppingConcepts,
  hasConfidentLouisVuittonShoppingContext,
  normalizeArabicForSearch,
} from "./queryExpansion";

test("normalizes Arabic safely without changing the original query", () => {
  const query = "  جِينز أَسود رِجالي  ";
  const expansion = expandShoppingQuery(query);

  assert.equal(expansion.originalQuery, query);
  assert.equal(expansion.normalizedQuery, "جينز اسود رجالي");
  assert.equal(normalizeArabicForSearch("إطار على طاولة"), "اطار علي طاوله");
});

test("generates bounded English shopping variants for product intent", () => {
  const expansion = expandShoppingQuery("جينز رجالي اسود");

  assert.ok(expansion.variants.includes("جينز رجالي اسود"));
  assert.ok(expansion.variants.includes("men's black jeans"));
  assert.ok(expansion.variants.some((variant) => /denim/iu.test(variant)));
  assert.deepEqual(expansion.productTerms, ["jeans", "denim", "jean"]);
  assert.ok(expansion.variants.length <= 6);
});

test("expands required product intents in both language directions", () => {
  const pairs = [
    ["جينز رجالي", "men's jeans", /jeans/iu, /جينز/u],
    [
      "ساعة جيس رجالية سوداء",
      "Guess men's black watch",
      /guess.*men.*black.*watch/iu,
      /ساعة.*جيس.*رجالي.*سوداء/u,
    ],
    ["عطر نسائي", "women's perfume", /women.*perfume/iu, /عطر.*نسائي/u],
    ["شنطة سوداء", "black handbag", /black.*handbag/iu, /شنطة.*سوداء/u],
    [
      "شمعة كامري 2022",
      "2022 Camry headlight",
      /camry.*headlight.*2022/iu,
      /شمعة.*كامري.*2022/u,
    ],
  ] as const;

  for (const [arabicQuery, englishQuery, englishPattern, arabicPattern] of pairs) {
    const arabicConcepts = getBilingualShoppingConcepts(arabicQuery);
    const englishConcepts = getBilingualShoppingConcepts(englishQuery);
    const arabicExpansion = expandShoppingQuery(arabicQuery);
    const englishExpansion = expandShoppingQuery(englishQuery);

    assert.match(arabicConcepts.english.join(" "), englishPattern);
    assert.match(englishConcepts.arabic.join(" "), arabicPattern);
    assert.ok(arabicExpansion.variants.some((variant) => /[a-z]/iu.test(variant)));
    assert.ok(
      englishExpansion.variants.some((variant) => /[\u0600-\u06ff]/u.test(variant)),
    );
  }
});

test("normalizes common Arabic brand transliterations to canonical names", () => {
  const aliases = [
    ["جيس", "Guess"],
    ["ديزل", "Diesel"],
    ["نايك", "Nike"],
    ["اديداس", "Adidas"],
    ["أديداس", "Adidas"],
    ["شي ان", "SHEIN"],
    ["شي إن", "SHEIN"],
    ["ديور", "Dior"],
    ["رولكس", "Rolex"],
  ] as const;

  for (const [arabic, canonical] of aliases) {
    const concepts = getBilingualShoppingConcepts(arabic);
    assert.ok(
      concepts.english.some((concept) => concept.includes(canonical)),
      `${arabic} did not expand to ${canonical}`,
    );
  }
});

test("resolves Louis Vuitton aliases only in confident shopping contexts", () => {
  const queries = [
    "ابغا شنطة ال في",
    "LV handbag",
    "شنطة لويس فيتون",
  ];

  for (const query of queries) {
    const concepts = getBilingualShoppingConcepts(query);
    const expansion = expandShoppingQuery(query);

    assert.ok(
      concepts.english.some((concept) =>
        /Louis Vuitton.*handbag|handbag.*Louis Vuitton/iu.test(concept),
      ),
      `${query} did not resolve to Louis Vuitton handbag concepts`,
    );
    assert.ok(
      expansion.variants.some((variant) =>
        /Louis Vuitton.*handbag/iu.test(variant),
      ),
      `${query} did not create the canonical provider query`,
    );
  }

  assert.equal(hasConfidentLouisVuittonShoppingContext("LV"), false);
  assert.equal(hasConfidentLouisVuittonShoppingContext("ال في"), false);
  assert.equal(
    hasConfidentLouisVuittonShoppingContext("LV is a low voltage circuit"),
    false,
  );
  assert.ok(
    !expandShoppingQuery("LV").variants.some((variant) =>
      /Louis Vuitton/iu.test(variant),
    ),
  );
  assert.ok(
    !expandShoppingQuery("ال في").variants.some((variant) =>
      /Louis Vuitton/iu.test(variant),
    ),
  );
});

test("translates product model transliterations with Saudi product terms", () => {
  const nikeVariants = expandShoppingQuery("جزمة نايك اير فورس بيضاء").variants;
  const diorVariants = expandShoppingQuery("عطر ديور سوفاج").variants;

  assert.ok(
    nikeVariants.some((variant) =>
      /Nike Air Force.*shoes|Nike Air Force.*sneakers/iu.test(variant),
    ),
    "Nike Air Force query should retain brand, model, and product type",
  );
  assert.ok(
    diorVariants.some((variant) => /Dior Sauvage.*perfume/iu.test(variant)),
    "Dior Sauvage query should retain brand, model, and fragrance type",
  );
});

test("supports shopping vocabulary across categories", () => {
  const expectations = new Map([
    ["شنطة", ["bag", "handbag", "purse"]],
    ["حذاء", ["shoes", "shoe", "sneakers"]],
    ["ساعة", ["watch", "watches"]],
    ["عطر", ["perfume", "fragrance", "eau de toilette"]],
    ["جوال", ["phone", "smartphone", "mobile"]],
    ["كرسي", ["chair", "chairs"]],
    ["قطع غيار", ["spare parts", "auto parts"]],
  ]);

  for (const [query, expected] of expectations) {
    const variants = expandShoppingQuery(query).variants;
    assert.ok(
      expected.every((term) => variants.some((variant) => variant.includes(term))),
      `${query} did not produce all expected variants`,
    );
  }
});

test("preserves unknown words while translating known shopping terms", () => {
  const variants = expandShoppingQuery("جينز ماركة محلية").variants;
  assert.ok(variants.includes("jeans ماركه محليه"));
});

test("translates Saudi automotive fallback terms deterministically", () => {
  const variants = expandShoppingQuery("شمعة كامري 2022").variants;

  assert.ok(variants.some((variant) => variant.includes("headlight")));
  assert.ok(variants.some((variant) => variant.includes("Camry")));
  assert.ok(variants.some((variant) => variant.includes("2022")));
});