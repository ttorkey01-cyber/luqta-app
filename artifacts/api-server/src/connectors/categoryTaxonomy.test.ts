import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyLuqtaCategory,
  getCategoryIndexData,
  matchesLuqtaCategory,
} from "./categoryTaxonomy";
import type { ProviderProduct } from "./types";

function product(
  title: string,
  category?: string,
  description?: string,
): Pick<ProviderProduct, "title" | "category" | "description" | "brand"> {
  return { title, category, description };
}

test("Electronics requires a real device or functioning electronic accessory, not incidental words", () => {
  for (const [title, category] of [
    ["Wireless Bluetooth headphones", "Audio & Video"],
    ["USB-C laptop charger 65W", "Tool Parts"],
    ["Laptop cooling fan 5V", "Tool Parts"],
    ["Digital thermometer Braun", "Electronics"],
    ["Wireless audio receiver", "Tool Parts"],
    ["ميزان حرارة 3 من براون", "إلكترونيات"],
    ["براون جهاز قياس الحرارة ثرموسكان", "إلكترونيات"],
  ]) {
    assert.equal(matchesLuqtaCategory(product(title, category), "electronics"), true, title);
  }
  for (const [title, category] of [
    ["Laptop graphic cotton T-shirt", "Tops & Tees"],
    ["Leather Cell Phone Charm", "Electronics"],
    ["Tablet Cover Beige Leather", "Electronics"],
    ["Analog watch for men", "Watches"],
    ["Silicone curing agent for motors and electronics", "Tool Parts"],
    ["Copper tube for refrigerator display", "Tool Parts"],
    ["CPU edge removal repair tool", "Tool Parts"],
    ["Camera crossbody bag for women", "Electronics"],
    ["USB phone case", "Phone Accessories"],
    ["Under Desk Keyboard Tray for Computer", "Tool Parts"],
    ["LED luminous hat mobile phone editor", "Tool Parts"],
    ["High Quality Stage Truss Display Stand for LED Screen", "Tool Parts"],
    ["Smartphone Pry Blade LCD Screen Opening Tool", "Tool Parts"],
    ["LED Air Duster for Computer", "Tool Parts"],
    ["Mobile phone selfie stick with Bluetooth remote", "Tool Parts"],
    ["Motherboard Maintenance Pure Bristle Brush Mobile Phone Cleaning", "Tool Parts"],
    ["Reflective Polarizer Film for LCD Display", "Tool Parts"],
    ["Waterproof Box for WiFi Base Station Router", "Tool Parts"],
  ]) {
    assert.equal(matchesLuqtaCategory(product(title, category), "electronics"), false, title);
  }
});
test("classifies clear title products", () => {
  assert.equal(
    classifyLuqtaCategory(product("Classic leather handbag")),
    "bags_accessories",
  );
  assert.equal(
    classifyLuqtaCategory(product("Toyota Camry replacement headlight")),
    "automotive",
  );
  assert.equal(
    classifyLuqtaCategory(product("Stainless steel kitchen cookware set")),
    "home_living",
  );
});

test("provider category text takes precedence over conflicting title words", () => {
  const item = product("Phone case accessory", "Home furniture and decor");
  assert.equal(classifyLuqtaCategory(item), "home_living");
  assert.equal(matchesLuqtaCategory(item, "home_living"), true);
  assert.equal(matchesLuqtaCategory(item, "electronics"), false);
});

test("rejects ambiguous or weak title-only classifications", () => {
  assert.equal(classifyLuqtaCategory(product("Premium accessory")), undefined);
  assert.equal(classifyLuqtaCategory(product("Protective case")), undefined);
  assert.equal(classifyLuqtaCategory(product("Top collection")), undefined);
  assert.equal(classifyLuqtaCategory(product("Red black")), undefined);
  assert.equal(
    getCategoryIndexData(product("Premium accessory"), "bags_accessories").matches,
    false,
  );
});

test("rejects service, article, and editorial listings", () => {
  assert.equal(classifyLuqtaCategory(product("Salon beauty service")), undefined);
  assert.equal(
    classifyLuqtaCategory(product("News article about new watches")),
    undefined,
  );
  assert.equal(
    getCategoryIndexData(
      product("Guide to buying laptops", "Electronics"),
      "electronics",
    ).matches,
    false,
  );
});

test("does not treat gold or silver as sufficient jewelry evidence", () => {
  assert.equal(classifyLuqtaCategory(product("Gold")), undefined);
  assert.equal(classifyLuqtaCategory(product("ذهب")), undefined);
  assert.equal(classifyLuqtaCategory(product("Gold ring")), "watches_jewelry");
  assert.equal(
    classifyLuqtaCategory(product("سوار ذهب")),
    "watches_jewelry",
  );
  assert.equal(
    classifyLuqtaCategory(product("42cm silver chain")),
    undefined,
  );
  assert.equal(
    classifyLuqtaCategory(product("42cm silver chain necklace")),
    "watches_jewelry",
  );
});

test("classifies body-care products as Beauty and excludes them from Watches", () => {
  const bodyCareTitles = [
    "Body butter",
    "Gold body butter",
    "Body cream",
    "Skin cream",
    "Lotion",
    "Serum",
    "Shampoo",
    "ذهب النساء - مقشرللجسم من شيا ميركلز بخلاصة العسل، زيت اللوز وزبدة الشيا، 500 مل",
    "زبدة الشيا",
    "كريم الجسم",
    "لوشن مرطب",
    "سيروم للبشرة",
    "شامبو للشعر",
  ];

  for (const title of bodyCareTitles) {
    const item = product(title);
    assert.equal(classifyLuqtaCategory(item), "beauty_care", title);
    assert.equal(getCategoryIndexData(item, "beauty_care").matches, true, title);
    assert.equal(
      getCategoryIndexData(item, "watches_jewelry").matches,
      false,
      title,
    );
  }
});

test("keeps fashion, beauty, and bags out of unrelated category indexes", () => {
  const notBeauty = [
    "Denim jeans",
    "Red dress",
    "Leather handbag",
    "Gold wristwatch",
    "Running sneakers",
    "جينز نسائي",
    "فستان سهرة",
    "حقيبة يد",
    "ساعة يد",
    "حذاء رياضي",
  ];
  for (const title of notBeauty) {
    assert.notEqual(
      classifyLuqtaCategory(product(title)),
      "beauty_care",
      title,
    );
  }

  const notShoes = [
    "Body cream",
    "Red dress",
    "Gold wristwatch",
    "Leather handbag",
    "كريم الجسم",
    "فستان",
    "ساعة يد",
    "حقيبة",
  ];
  for (const title of notShoes) {
    assert.notEqual(classifyLuqtaCategory(product(title)), "shoes", title);
  }

  assert.equal(
    classifyLuqtaCategory(product("Black dress shoes")),
    "shoes",
  );
});

test("rejects English and Arabic cross-category terms across the target categories", () => {
  const categories = [
    "fashion",
    "beauty_care",
    "bags_accessories",
    "watches_jewelry",
    "shoes",
  ] as const;
  const examples = [
    { item: product("Body cream"), actual: "beauty_care" },
    { item: product("كريم الجسم"), actual: "beauty_care" },
    { item: product("Denim jeans"), actual: "fashion" },
    { item: product("جينز نسائي"), actual: "fashion" },
    { item: product("Leather handbag"), actual: "bags_accessories" },
    { item: product("حقيبة يد"), actual: "bags_accessories" },
    { item: product("Gold wristwatch"), actual: "watches_jewelry" },
    { item: product("ساعة يد"), actual: "watches_jewelry" },
    { item: product("Sneakers"), actual: "shoes" },
    { item: product("حذاء رياضي"), actual: "shoes" },
  ] as const;

  for (const { item, actual } of examples) {
    assert.equal(classifyLuqtaCategory(item), actual, item.title);
    for (const category of categories) {
      if (category === actual) continue;
      assert.equal(
        getCategoryIndexData(item, category).matches,
        false,
        `${item.title} must not match ${category}`,
      );
    }
  }
});

test("uses official product types to keep hair brushes and belted clothing out of Bags", () => {
  const hairBrush = product(
    "Denman D84 Hand Bag Paddle Brush | 1 Pc",
    "فراشي للشعر",
  );
  assert.equal(classifyLuqtaCategory(hairBrush), "beauty_care");
  assert.equal(getCategoryIndexData(hairBrush, "bags_accessories").matches, false);

  const blazer = product(
    "Urban Printing Geometric Lapel Collar Blazer With Belt",
    "Blazers",
  );
  assert.equal(classifyLuqtaCategory(blazer), "fashion");
  assert.equal(getCategoryIndexData(blazer, "bags_accessories").matches, false);

  const cardigan = product(
    "Color Block Sweater Cardigan With Belt",
    "Cardigans",
  );
  assert.equal(classifyLuqtaCategory(cardigan), "fashion");
  assert.equal(getCategoryIndexData(cardigan, "bags_accessories").matches, false);

  assert.equal(
    classifyLuqtaCategory(product("Leopard Urban Belt", "Belts")),
    "bags_accessories",
  );
  assert.equal(
    classifyLuqtaCategory(product("Cosmetic bag for makeup", "Bags")),
    "bags_accessories",
  );

  const bagSizedBodyButter = product(
    "Body butter, 500ml travel bag size",
    "Body Care",
  );
  assert.equal(classifyLuqtaCategory(bagSizedBodyButter), "beauty_care");
  assert.equal(
    getCategoryIndexData(bagSizedBodyButter, "bags_accessories").matches,
    false,
  );
});
