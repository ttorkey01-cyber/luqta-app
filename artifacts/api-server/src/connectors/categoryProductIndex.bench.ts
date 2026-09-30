/**
 * Local, synthetic-only category index benchmark.
 * Run from artifacts/api-server: pnpm exec tsx src/connectors/categoryProductIndex.bench.ts
 */
import { performance } from "node:perf_hooks";
import { CategoryProductIndex } from "./categoryProductIndex";
import type { ProviderProduct } from "./types";

const examples = [
  { title: "Wireless smartphone and headphones", category: "Electronics > Phones", productType: "smartphone" },
  { title: "Women's blue denim jeans", category: "Women's Clothing > Jeans", productType: "jeans" },
  { title: "Hydrating facial moisturizer", category: "Beauty & Personal Care > Skincare", productType: "Skincare" },
  { title: "Car tire and wheel accessories", category: "Automotive > Tires & Wheels", productType: "tires" },
  { title: "Leather running shoes for women", category: "Shoes > Sneakers", productType: "sneakers" },
  { title: "Generic unclassified item", category: "Other", productType: "miscellaneous" },
] as const;

for (const count of [500, 2_500, 5_000]) {
  const products: ProviderProduct[] = Array.from({ length: count }, (_, index) => {
    const example = examples[index % examples.length];
    return {
      ...example,
      id: `synthetic-${index}`,
      availability: "in_stock",
      sourceType: "affiliate_feed",
    };
  });
  const index = new CategoryProductIndex();
  const started = performance.now();
  await index.setProductsYielding(products);
  const elapsedMs = performance.now() - started;
  console.log(JSON.stringify({
    products: count,
    durationMs: Number(elapsedMs.toFixed(2)),
    fashionCount: index.getCount(products, "fashion"),
    electronicsCount: index.getCount(products, "electronics"),
  }));
}