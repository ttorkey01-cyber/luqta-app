import assert from "node:assert/strict";
import test from "node:test";
import {
  createSearchRelevanceGate,
  evaluateSearchRelevance,
  filterSearchRelevance,
  preserveDistinctiveFallbackQuery,
  sortSearchRelevance,
} from "./relevanceGate";
import type { NormalizedProduct } from "./types";

function product(
  title: string,
  options: Partial<NormalizedProduct> = {},
): NormalizedProduct {
  return {
    id: title,
    title,
    availability: "unknown",
    sourceType: "catalog",
    rankScore: 1,
    priceScore: 0,
    availabilityScore: 0,
    conditionScore: 0,
    locationScore: 0,
    providerId: "fixture",
    providerName: "Fixture",
    isAffiliate: false,
    canonical: {} as NormalizedProduct["canonical"],
    ...options,
  };
}

const state = (candidate: NormalizedProduct, query: string) =>
  evaluateSearchRelevance(candidate, createSearchRelevanceGate(query));

test("ten explicit intent patterns retain product and identifier relevance", () => {
  const handbagGate = createSearchRelevanceGate("شنطة سوداء أقل من 300 ريال");
  const handbag = product("Black handbag", { category: "bags_accessories", rankScore: 1 });
  const falseBagLexical = product("Hand Bag paddle brush", { category: "beauty_care", rankScore: 100 });
  const shampoo = product("Shampoo", { category: "beauty_care", rankScore: 99 });
  const unrelatedBlack = product("Black chair", { category: "home_living", rankScore: 98 });
  const bagResults = sortSearchRelevance(
    filterSearchRelevance([falseBagLexical, shampoo, unrelatedBlack, handbag], handbagGate),
    handbagGate,
  );
  assert.equal(bagResults[0]?.title, "Black handbag");
  assert.deepEqual(bagResults.map((item) => item.title), ["Black handbag"]);

  const phoneGate = createSearchRelevanceGate("جوال أقل من 1500 ريال");
  const phone = product("Android mobile phone", { category: "electronics" });
  const grooming = [
    product("Beard trimmer", { category: "beauty_care" }),
    product("Shaver", { category: "beauty_care" }),
    product("Hair cream", { category: "beauty_care" }),
  ];
  assert.deepEqual(
    filterSearchRelevance([...grooming, phone], phoneGate).map((item) => item.title),
    ["Android mobile phone"],
  );
  const arabicBeauty = product("غسول للبشرة", {
    category: "الجمال والعناية الشخصية",
  });
  const arabicGrooming = product("فرشاة حلاقة وكريم", {
    canonical: { category: "beauty_care" } as NormalizedProduct["canonical"],
  });
  assert.equal(evaluateSearchRelevance(arabicBeauty, phoneGate).productType, "CONFLICT");
  assert.equal(evaluateSearchRelevance(arabicGrooming, phoneGate).productType, "CONFLICT");
  assert.equal(
    evaluateSearchRelevance(
      product("منتج عناية", {
        canonical: { category: "beauty_care" } as NormalizedProduct["canonical"],
      }),
      phoneGate,
    ).productType,
    "CONFLICT",
  );

  const shoeGate = createSearchRelevanceGate("Nike shoes black size 42");
  const eu42 = product("Nike running shoe EU 42", { brand: "Nike", category: "shoes", rankScore: 2 });
  const band = product("Nike watch band 42 mm", { brand: "Nike", category: "watches_jewelry", rankScore: 100 });
  const unknownShoe = product("Nike black shoes", { brand: "Nike", category: "shoes", rankScore: 1 });
  assert.equal(evaluateSearchRelevance(eu42, shoeGate).size, "MATCH");
  assert.equal(evaluateSearchRelevance(band, shoeGate).productType, "CONFLICT");
  assert.equal(evaluateSearchRelevance(band, shoeGate).size, "CONFLICT");
  assert.equal(evaluateSearchRelevance(unknownShoe, shoeGate).size, "UNKNOWN");
  assert.deepEqual(
    sortSearchRelevance([unknownShoe, eu42], shoeGate).map((item) => item.title),
    ["Nike running shoe EU 42", "Nike black shoes"],
  );

  const jeansGate = createSearchRelevanceGate("Diesel jeans size 32");
  const waist32 = product("Diesel jeans waist 32", { brand: "Diesel", category: "fashion" });
  const wrongWaist = product("Diesel jeans waist 34 inseam 32", { brand: "Diesel", category: "fashion" });
  const unknownWaist = product("Diesel denim jeans", { brand: "Diesel", category: "fashion" });
  assert.equal(evaluateSearchRelevance(waist32, jeansGate).size, "MATCH");
  assert.equal(evaluateSearchRelevance(wrongWaist, jeansGate).size, "CONFLICT");
  assert.equal(evaluateSearchRelevance(unknownWaist, jeansGate).size, "UNKNOWN");
  assert.deepEqual(
    filterSearchRelevance([waist32, wrongWaist, unknownWaist], jeansGate).map((item) => item.title),
    ["Diesel jeans waist 32", "Diesel denim jeans"],
  );
  const wrongSizeFromTitle = product("Diesel size 34 jeans, inseam 32");
  assert.equal(evaluateSearchRelevance(wrongSizeFromTitle, jeansGate).size, "CONFLICT");
  assert.equal(
    evaluateSearchRelevance(product("Diesel Regular 34 Size Jeans for Men in 32 Inseam"), jeansGate).size,
    "CONFLICT",
  );
  assert.equal(
    evaluateSearchRelevance(product("Diesel jeans waist 32 with 42 mm hardware"), jeansGate).size,
    "MATCH",
  );

  const toasterGate = createSearchRelevanceGate("QZVTR-999 seventeen-handle purple toaster");
  const genericToaster = product("Purple toaster", { category: "home_living" });
  assert.equal(evaluateSearchRelevance(genericToaster, toasterGate).identifier, "CONFLICT");
  assert.deepEqual(filterSearchRelevance([genericToaster], toasterGate), []);
  assert.match(
    preserveDistinctiveFallbackQuery(toasterGate.query, "purple toaster", toasterGate),
    /QZVTR-999/u,
  );
  const generalSkuGate = createSearchRelevanceGate("ABXQ-2049 purple toaster");
  assert.deepEqual(generalSkuGate.identifiers, ["ABXQ-2049"]);
  assert.deepEqual(filterSearchRelevance([genericToaster], generalSkuGate), []);
  assert.equal(createSearchRelevanceGate("jeans size-32 under-300").identifiers.length, 0);
  assert.equal(createSearchRelevanceGate("size-42 price-300 42-inch").identifiers.length, 0);

  const s24Gate = createSearchRelevanceGate("Samsung S24 Ultra");
  assert.deepEqual(s24Gate.identifiers, ["S24 Ultra"]);
  assert.equal(
    evaluateSearchRelevance(product("Samsung Galaxy S24 Ultra", { providerProductId: "SM-S928B" }), s24Gate).identifier,
    "MATCH",
  );
  assert.deepEqual(
    filterSearchRelevance([product("Samsung Galaxy S24")], s24Gate),
    [],
  );
  assert.match(preserveDistinctiveFallbackQuery("Samsung S24 Ultra", "Samsung phone", s24Gate), /S24 Ultra/u);

  const iphoneGate = createSearchRelevanceGate("iPhone 15 Pro Max");
  const iphoneProduct = product("Apple iPhone 15 Pro Max 256GB");
  assert.equal(evaluateSearchRelevance(iphoneProduct, iphoneGate).identifier, "MATCH");
  assert.deepEqual(filterSearchRelevance([product("iPhone 15 Pro")], iphoneGate), []);

  const watchGate = createSearchRelevanceGate("ساعة حدود 500 ريال");
  const watch = product("Quartz wrist watch", { category: "watches_jewelry", rankScore: 2 });
  const cheapWrong = product("Cheap phone", { category: "electronics", rankScore: 100 });
  assert.deepEqual(
    sortSearchRelevance([cheapWrong, watch], watchGate).map((item) => item.title),
    ["Quartz wrist watch", "Cheap phone"],
  );

  const contextualShoeGate = createSearchRelevanceGate("Nike black size 42");
  assert.equal(contextualShoeGate.requestedType, "shoes");
  assert.equal(evaluateSearchRelevance(band, contextualShoeGate).productType, "CONFLICT");
  assert.equal(
    evaluateSearchRelevance(product("SM-S928B Galaxy phone"), createSearchRelevanceGate("SM-S928")).identifier,
    "MATCH",
  );

  const bagOnlyGate = createSearchRelevanceGate("handbag");
  assert.equal(state(product("Shampoo"), "handbag").productType, "CONFLICT");
  assert.equal(state(product("Unclassified item"), "handbag").productType, "UNKNOWN");
  assert.equal(state(product("Black wallet"), "handbag").productType, "CONFLICT");
  assert.equal(evaluateSearchRelevance(falseBagLexical, bagOnlyGate).productType, "CONFLICT");
  assert.equal(
    evaluateSearchRelevance(
      product("Shampoo for handbag care", {
        productType: "shampoo",
        description: "For cleaning handbag leather",
        category: "beauty_care",
        price: 100,
      }),
      bagOnlyGate,
    ).productType,
    "CONFLICT",
  );
  assert.equal(
    evaluateSearchRelevance(product("Mobile phone holder", { productType: "phone holder" }), phoneGate).productType,
    "CONFLICT",
  );
  assert.equal(
    evaluateSearchRelevance(product("Rose shampoo", { category: "beauty_care" }), createSearchRelevanceGate("عطر ورد")).productType,
    "CONFLICT",
  );
  assert.deepEqual(createSearchRelevanceGate("S24").identifiers, ["S24"]);
  const samsungAccessory = product("Samsung Galaxy S24 Ultra case", { category: "electronics" });
  const iphoneAccessory = product("iPhone 15 Pro Max screen protector", { category: "electronics" });
  assert.deepEqual(filterSearchRelevance([samsungAccessory], s24Gate), []);
  assert.deepEqual(filterSearchRelevance([iphoneAccessory], iphoneGate), []);

  const editorial = product("Samsung Galaxy S24 Ultra review and comparison", {
    sourceType: "web",
  });
  const listing = product("Samsung Galaxy S24 Ultra 256GB", {
    sourceType: "web",
    productUrl: "https://example.invalid/product/s24-ultra",
  });
  const categoryPage = product("Samsung Galaxy S24 Ultra phones collection", {
    sourceType: "web",
    productUrl: "https://example.invalid/collections/samsung-phones",
  });
  const pricePage = product("Samsung Galaxy S24 Ultra price in Saudi Arabia", {
    sourceType: "web",
    productUrl: "https://example.invalid/samsung-s24-ultra-price",
  });
  assert.equal(evaluateSearchRelevance(editorial, s24Gate).identifier, "CONFLICT");
  assert.equal(evaluateSearchRelevance(categoryPage, s24Gate).identifier, "CONFLICT");
  assert.equal(evaluateSearchRelevance(pricePage, s24Gate).identifier, "CONFLICT");
  assert.equal(evaluateSearchRelevance(listing, s24Gate).identifier, "MATCH");
  assert.deepEqual(filterSearchRelevance([editorial, categoryPage, pricePage, listing], s24Gate), [listing]);
  assert.deepEqual(
    filterSearchRelevance(
      [product("Phone review", { sourceType: "web" }), product("Mobile phone", { sourceType: "web" })],
      phoneGate,
    ).map((item) => item.title),
    ["Mobile phone"],
  );

  const higherRankWrongType = product("Wallet", { rankScore: 100 });
  const lowerRankRightType = product("Handbag", { rankScore: 1 });
  assert.deepEqual(
    sortSearchRelevance([higherRankWrongType, lowerRankRightType], bagOnlyGate).map((item) => item.title),
    ["Handbag", "Wallet"],
  );
});

test("size and identifier checks stay unknown rather than inventing evidence", () => {
  const gate = createSearchRelevanceGate("jeans size 32");
  const unknown = product("Denim pants");
  assert.deepEqual(evaluateSearchRelevance(unknown, gate), {
    productType: "MATCH",
    size: "UNKNOWN",
    identifier: "UNKNOWN",
  });
  const unconstrained = createSearchRelevanceGate("Nike");
  assert.equal(unconstrained.requestedType, undefined);
  assert.equal(evaluateSearchRelevance(product("Nike sneakers"), unconstrained).productType, "UNKNOWN");
  assert.equal(
    preserveDistinctiveFallbackQuery("blue chair", "chair", unconstrained),
    "chair",
  );
});

test("captured Production family conflicts are rejected before a strict price can help them", () => {
  const bags = createSearchRelevanceGate("شنطة سوداء أقل من 300 ريال");
  const hairTools = [
    product("مكواة فرد الشعر المزودة بلوحين مزدوجين - لون أسود", {
      category: "أجهزة تمليس الشعر", price: 173.04, currency: "SAR",
    }),
    product("ديويت ستايل مصفف الشعر بالهواء الساخن باللون الأسود", {
      category: "Hot Air Stylers", price: 1.373, currency: "SAR",
    }),
    product("Hand bag hair styler", { price: 50, currency: "SAR" }),
  ];
  const realBag = product("Black leather handbag", {
    category: "bags_accessories", price: 299, currency: "SAR",
  });
  assert.deepEqual(
    filterSearchRelevance([...hairTools, realBag], bags, { requireProductTypeEvidence: true })
      .map((item) => item.title),
    [realBag.title],
  );
  assert.deepEqual(
    filterSearchRelevance(hairTools, bags, { requireProductTypeEvidence: true }),
    [],
  );
  // The unconstrained black-bag query keeps its relevant product as before.
  assert.equal(
    filterSearchRelevance([...hairTools, realBag], createSearchRelevanceGate("شنطة سوداء"))[0],
    realBag,
  );

  const phones = createSearchRelevanceGate("جوال أقل من 1500 ريال");
  const cheapAccessories = [
    product("High Smartphone Case With Bumper, Iphone 11 Pro, Pink", {
      category: "Fashion", price: 45, currency: "SAR",
    }),
    product("Large Logo Smartphone Wristlet for women", {
      category: "Fashion", price: 395, currency: "SAR",
    }),
    product("Signum Smartphone Case", { price: 45, currency: "SAR" }),
    product("Cheap black electronic item", { price: 100, currency: "SAR" }),
  ];
  const actualPhone = product("Samsung Galaxy mobile phone", {
    price: 1499, currency: "SAR", category: "electronics",
  });
  assert.deepEqual(
    filterSearchRelevance([...cheapAccessories, actualPhone], phones, { requireProductTypeEvidence: true })
      .map((item) => item.title),
    [actualPhone.title],
  );
  assert.deepEqual(
    filterSearchRelevance(cheapAccessories, phones, { requireProductTypeEvidence: true }),
    [],
  );
});

test("footwear and jeans sizes use their own context, not millimeters or inseams", () => {
  const nike = createSearchRelevanceGate("Nike أسود مقاس 42");
  assert.equal(nike.requestedType, "shoes");
  assert.equal(nike.sizeDimension, "shoe");
  const band = product("حزام رياضي Nike بلون أسود ليلي لإطار 42 مم", {
    category: "bags_accessories", sourceType: "web", rankScore: 100,
  });
  const euShoe = product("Nike Men's Running Shoes, Black, 42 EU", {
    category: "shoes", sourceType: "web", rankScore: 1,
  });
  const unknownShoe = product("Nike black running shoes", { category: "shoes" });
  assert.equal(evaluateSearchRelevance(band, nike).productType, "CONFLICT");
  assert.equal(evaluateSearchRelevance(band, nike).size, "CONFLICT");
  assert.equal(evaluateSearchRelevance(euShoe, nike).size, "MATCH");
  assert.equal(evaluateSearchRelevance(unknownShoe, nike).size, "UNKNOWN");
  assert.deepEqual(
    sortSearchRelevance(filterSearchRelevance([band, unknownShoe, euShoe], nike), nike)
      .map((item) => item.title),
    [euShoe.title, unknownShoe.title],
  );
  assert.equal(createSearchRelevanceGate("Nike watch band size 42").requestedType, "watch band");

  const diesel = createSearchRelevanceGate("Diesel jeans مقاس 32");
  const broad = product("Diesel Regular 32 Size Jeans for Men for sale | eBay", {
    sourceType: "web", productUrl: "https://example.invalid/search/diesel-jeans", rankScore: 100,
  });
  const specific = product("Diesel jeans waist 32", {
    sourceType: "web", productUrl: "https://example.invalid/itm/diesel-jeans", rankScore: 1,
  });
  const inseam = product("Diesel jeans waist 34 inseam 32", { rankScore: 200 });
  assert.equal(evaluateSearchRelevance(broad, diesel).size, "UNKNOWN");
  assert.equal(evaluateSearchRelevance(specific, diesel).size, "MATCH");
  assert.equal(evaluateSearchRelevance(inseam, diesel).size, "CONFLICT");
  assert.deepEqual(
    sortSearchRelevance(filterSearchRelevance([broad, specific, inseam], diesel), diesel)
      .map((item) => item.title),
    [specific.title, broad.title],
  );
});

test("web page quality prefers actual listings without inventing price or exact SKU evidence", () => {
  const watch = createSearchRelevanceGate("ساعة حدود 500 ريال");
  const watchListing = product("Casio wrist watch", {
    sourceType: "web", category: "watches_jewelry",
    productUrl: "https://example.invalid/product/casio-watch", price: 520, currency: "SAR",
  });
  const weakWatchPages = [
    product("أفضل ساعات ذكية لعام 2026 - الاعلي تقييما", {
      sourceType: "web", category: "watches_jewelry", rankScore: 100,
    }),
    product("سعر ساعة ذكية T500 - كان بكام", {
      sourceType: "web", category: "watches_jewelry", rankScore: 90,
    }),
    product("ساعات ذكية للبيع | السوق المفتوح", {
      sourceType: "web", category: "watches_jewelry", rankScore: 80,
    }),
  ];
  assert.equal(sortSearchRelevance([watchListing, ...weakWatchPages], watch)[0], watchListing);
  assert.equal(weakWatchPages.every((item) => item.price == null), true);
  // 500 is a preference; a real 520 SAR watch stays eligible.
  assert.deepEqual(filterSearchRelevance([watchListing], watch), [watchListing]);

  const iphone = createSearchRelevanceGate("iPhone 15 Pro Max");
  const listing = product("Apple iPhone 15 Pro Max 256GB Blue Titanium - eXtra", {
    sourceType: "web", category: "electronics",
    productUrl: "https://example.invalid/product/iphone-15-pro-max",
  });
  const marketplace = product("Apple iPhone 15 Pro Max Mobiles for Sale : Best Prices", {
    sourceType: "web", category: "electronics", rankScore: 100,
  });
  assert.equal(evaluateSearchRelevance(listing, iphone).identifier, "MATCH");
  assert.equal(sortSearchRelevance([marketplace, listing], iphone)[0], listing);
  assert.deepEqual(filterSearchRelevance([product("iPhone 15 Pro")], iphone), []);

  const samsung = createSearchRelevanceGate("Samsung S24 Ultra");
  const specificSamsung = product("Samsung Galaxy S24 Ultra 256 GB Titanium Black", {
    sourceType: "web", category: "electronics",
    productUrl: "https://example.invalid/product/galaxy-s24-ultra",
  });
  const modelPage = product("Samsung Galaxy S24 Ultra with Galaxy AI", {
    sourceType: "web", category: "electronics", rankScore: 100,
  });
  assert.equal(sortSearchRelevance([modelPage, specificSamsung], samsung)[0], specificSamsung);
  assert.equal(evaluateSearchRelevance(modelPage, samsung).identifier, "MATCH");
});