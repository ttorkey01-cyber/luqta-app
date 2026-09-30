import assert from "node:assert/strict";
import test from "node:test";
import { CategoryProductIndex } from "./categoryProductIndex";
import {
  getCategoryFilterSelectionIds,
  getCategoryFilters,
  getCategoryIndexData,
} from "./categoryTaxonomy";
import { LUQTA_CATEGORIES, type ProviderProduct } from "./types";

function product(index: number): ProviderProduct {
  return {
    id: `fashion-${index}`,
    title: `Women's blue denim jeans ${index}`,
    category: "Women's Clothing > Jeans",
    productType: "jeans",
    availability: "in_stock",
    sourceType: "affiliate_feed",
  };
}

test("yielding category-index builds allow the event loop to serve requests", async () => {
  const products = Array.from({ length: 192 }, (_, index) => product(index));
  const synchronousIndex = new CategoryProductIndex();
  synchronousIndex.setProducts(products);
  const expectedProducts = synchronousIndex.getProducts(
    products,
    "fashion",
    undefined,
    1,
    24,
  );
  const expectedFacets = [
    ...synchronousIndex.getFacetCounts(products, "fashion"),
  ];

  const yieldingIndex = new CategoryProductIndex();
  let eventLoopCallbackRan = false;
  setTimeout(() => {
    eventLoopCallbackRan = true;
  }, 0);
  await yieldingIndex.setProductsYielding(products);

  assert.equal(eventLoopCallbackRan, true);
  assert.equal(yieldingIndex.getCount(products, "fashion"), products.length);
  assert.deepEqual(
    yieldingIndex.getProducts(products, "fashion", undefined, 1, 24),
    expectedProducts,
  );
  assert.deepEqual(
    [...yieldingIndex.getFacetCounts(products, "fashion")],
    expectedFacets,
  );
});

test("yielding rebuilds keep the last complete index published until commit", async () => {
  const previousProducts = Array.from({ length: 8 }, (_, index) =>
    product(index),
  );
  const nextProducts = Array.from({ length: 192 }, (_, index) =>
    product(index + 1000),
  );
  const index = new CategoryProductIndex();
  index.setProducts(previousProducts);

  let previousIndexStayedAvailable = false;
  setTimeout(() => {
    previousIndexStayedAvailable =
      index.getCount(previousProducts, "fashion") === previousProducts.length;
  }, 0);
  const rebuild = index.setProductsYielding(nextProducts);
  await rebuild;

  assert.equal(previousIndexStayedAvailable, true);
  assert.equal(index.getCount(nextProducts, "fashion"), nextProducts.length);
});

test("yielding and synchronous indexes match direct category and facet results", async () => {
  const categoryExamples: Record<
    (typeof LUQTA_CATEGORIES)[number],
    { title: string; category: string; productType: string }
  > = {
    beauty_care: {
      title: "Hydrating face moisturizer and serum",
      category: "Beauty & Personal Care > Skincare",
      productType: "Skincare",
    },
    fashion: {
      title: "Women's blue denim jeans",
      category: "Women's Clothing > Jeans",
      productType: "jeans",
    },
    bags_accessories: {
      title: "Leather crossbody handbag",
      category: "Bags & Luggage > Handbags",
      productType: "handbag",
    },
    watches_jewelry: {
      title: "Gold necklace and diamond ring",
      category: "Jewelry > Necklaces & Rings",
      productType: "necklace",
    },
    electronics: {
      title: "Wireless smartphone with camera",
      category: "Electronics > Mobile Phones",
      productType: "smartphone",
    },
    home_living: {
      title: "Ceramic dining table lamp",
      category: "Home & Living > Lighting",
      productType: "lamp",
    },
    shoes: {
      title: "Men's leather running shoes",
      category: "Shoes > Sneakers",
      productType: "sneakers",
    },
    eyewear: {
      title: "Polarized sunglasses with UV protection",
      category: "Eyewear > Sunglasses",
      productType: "sunglasses",
    },
    automotive: {
      title: "Car tire and wheel accessories",
      category: "Automotive > Tires & Wheels",
      productType: "tires",
    },
    kids_baby: {
      title: "Children's toy building blocks",
      category: "Toys & Games > Kids Toys",
      productType: "toys",
    },
    sports_fitness: {
      title: "Running shoes and fitness workout gear",
      category: "Sports & Fitness > Running",
      productType: "running",
    },
    games_hobbies: {
      title: "Video game controller and console",
      category: "Games & Hobbies > Video Games",
      productType: "game controller",
    },
  };
  const products: ProviderProduct[] = LUQTA_CATEGORIES.flatMap(
    (category, categoryIndex) =>
    Array.from({ length: 6 }, (_, variant) => {
      const example = categoryExamples[category];
      return {
        id: `${category}-${variant}`,
        title: `${example.title} ${variant}`,
        category: example.category,
        productType: example.productType,
        description:
          variant % 2 === 0 ? "Premium quality, new season collection" : undefined,
        brand: variant % 3 === 0 ? `Brand ${categoryIndex}` : undefined,
        audience: variant % 2 === 0 ? "unisex" : undefined,
        availability: "in_stock",
        sourceType: "affiliate_feed",
      };
    }),
  );
  const directIndex = new CategoryProductIndex();
  const yieldingIndex = new CategoryProductIndex();
  directIndex.setProducts(products);
  await yieldingIndex.setProductsYielding(products);

  for (const category of LUQTA_CATEGORIES) {
    const directMatches = products.flatMap((product) => {
      const categoryData = getCategoryIndexData(product, category);
      return categoryData.matches
        ? [{ ...product, categoryFilterIds: categoryData.filterIds }]
        : [];
    });
    assert.ok(directMatches.length > 0, `fixture should exercise ${category}`);
    assert.equal(directIndex.getCount(products, category), directMatches.length);
    assert.equal(yieldingIndex.getCount(products, category), directMatches.length);

    const expectedFacets = new Map<string, number>();
    for (const product of directMatches) {
      for (const filterId of product.categoryFilterIds) {
        expectedFacets.set(
          filterId,
          (expectedFacets.get(filterId) ?? 0) + 1,
        );
      }
    }
    assert.deepEqual(
      [...directIndex.getFacetCounts(products, category)],
      [...expectedFacets],
    );
    assert.deepEqual(
      [...yieldingIndex.getFacetCounts(products, category)],
      [...expectedFacets],
    );

    for (const productFilter of getCategoryFilters(category)) {
      const selectionIds = getCategoryFilterSelectionIds(
        category,
        productFilter.id,
      );
      const filteredMatches = directMatches.filter((product) =>
        selectionIds?.every((selectionId) =>
          product.categoryFilterIds.includes(selectionId),
        ),
      );
      assert.equal(
        directIndex.getCount(products, category, productFilter.id),
        filteredMatches.length,
        `${category}:${productFilter.id} synchronous count`,
      );
      assert.equal(
        yieldingIndex.getCount(products, category, productFilter.id),
        filteredMatches.length,
        `${category}:${productFilter.id} yielding count`,
      );
      const filteredFacetCounts = new Map<string, number>();
      for (const product of filteredMatches) {
        for (const filterId of product.categoryFilterIds) {
          filteredFacetCounts.set(
            filterId,
            (filteredFacetCounts.get(filterId) ?? 0) + 1,
          );
        }
      }
      assert.deepEqual(
        [
          ...directIndex.getFacetCounts(products, category, productFilter.id),
        ],
        [...filteredFacetCounts],
        `${category}:${productFilter.id} synchronous facets`,
      );
      assert.deepEqual(
        [
          ...yieldingIndex.getFacetCounts(products, category, productFilter.id),
        ],
        [...filteredFacetCounts],
        `${category}:${productFilter.id} yielding facets`,
      );
      assert.deepEqual(
        yieldingIndex.getProducts(
          products,
          category,
          productFilter.id,
          1,
          products.length,
        ),
        filteredMatches.map((product) => ({
          ...product,
          exactMatchScore: product.exactMatchScore ?? 0.5,
        })),
        `${category}:${productFilter.id} filtered products`,
      );
    }

    assert.deepEqual(
      yieldingIndex.getProducts(products, category, undefined, 1, products.length),
      directMatches.map((product) => ({
        ...product,
        exactMatchScore: product.exactMatchScore ?? 0.5,
      })),
      `${category} products`,
    );
  }
});

test("optimized yielding index matches the old array-scan reference for empty and 5,000-product feeds", async () => {
  const examples = [
    { title: "Wireless smartphone and headphones", category: "Electronics > Phones", productType: "smartphone" },
    { title: "Women's blue denim jeans", category: "Women's Clothing > Jeans", productType: "jeans" },
    { title: "Hydrating facial moisturizer", category: "Beauty & Personal Care > Skincare", productType: "Skincare" },
    { title: "Car tire and wheel accessories", category: "Automotive > Tires & Wheels", productType: "tires" },
    { title: "Leather running shoes for women", category: "Shoes > Sneakers", productType: "sneakers" },
    { title: "Generic unclassified item", category: "Other", productType: "miscellaneous" },
    { title: "Women's blue denim jeans and running shoes", category: "Women's Clothing > Jeans and Shoes", productType: "sneakers" },
  ] as const;

  for (const count of [0, 5_000]) {
    const products: ProviderProduct[] = Array.from({ length: count }, (_, index) => ({
      ...examples[index % examples.length],
      id: `synthetic-${index}`,
      availability: "in_stock",
      sourceType: "affiliate_feed",
    }));
    if (count) {
      assert.ok(
        LUQTA_CATEGORIES.every(
          (category) => !getCategoryIndexData(products[5], category).matches,
        ),
        "unmatched fixture must have no category",
      );
      assert.ok(
        LUQTA_CATEGORIES.some(
          (category) => getCategoryIndexData(products[6], category).matches,
        ),
        "mixed fashion/shoes fixture must exercise category classification",
      );
    }
    const reference = new CategoryProductIndex();
    const optimized = new CategoryProductIndex();
    // setProducts retains the original Array.includes membership logic.
    reference.setProducts(products);
    await optimized.setProductsYielding(products);

    for (const category of LUQTA_CATEGORIES) {
      for (const filterId of [
        undefined,
        ...getCategoryFilters(category).map((filter) => filter.id),
      ]) {
        const context = `${count} products / ${category} / ${filterId ?? "all"}`;
        assert.equal(
          optimized.getCount(products, category, filterId),
          reference.getCount(products, category, filterId),
          context,
        );
        assert.deepEqual(
          [...optimized.getFacetCounts(products, category, filterId)],
          [...reference.getFacetCounts(products, category, filterId)],
          `${context} facets`,
        );
        assert.deepEqual(
          optimized.getProducts(products, category, filterId, 1, count || 1),
          reference.getProducts(products, category, filterId, 1, count || 1),
          `${context} membership and order`,
        );
      }
    }
  }
});