import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyLuqtaCategory,
  getCategoryIndexData,
} from "./categoryTaxonomy";

test("provider product type and subcategory classify before a broad category label", () => {
  const product = {
    title: "Herbal daily care set",
    category: "Other",
    subcategory: "Hair",
    productType: "Shampoo",
    audience: "Women",
  };

  assert.equal(classifyLuqtaCategory(product), "beauty_care");
  const indexed = getCategoryIndexData(product, "beauty_care");
  assert.equal(indexed.matches, true);
  assert.ok(indexed.filterIds.includes("hair_care"));
});