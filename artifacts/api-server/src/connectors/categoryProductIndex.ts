import {
  getCategoryIndexDataForIndex,
  getCategoryFilterSelectionIds,
  getCategoryFilters,
  prepareCategoryIndexEvidence,
  type PreparedCategoryIndexEvidence,
} from "./categoryTaxonomy";
import {
  LUQTA_CATEGORIES,
  type LuqtaCategory,
  type ProviderProduct,
} from "./types";

const categoryKey = (category: LuqtaCategory, filterId?: string) =>
  filterId ? `${category}:${filterId}` : category;

const CATEGORY_INDEX_YIELD_BATCH_SIZE = 64;

type BuiltCategoryIndex = {
  indexes: number[];
  filterIdsByIndex: Map<number, string[]>;
  facetCounts: Map<string, number>;
  filterIndexesById: Map<string, number[]>;
  filteredFacetCountsById: Map<string, Map<string, number>>;
};

type IndexedEvidence = {
  index: number;
  evidence: PreparedCategoryIndexEvidence;
};

function yieldToEventLoop() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

function getFilterDefinitions(category: LuqtaCategory) {
  return getCategoryFilters(category).map((filter) => ({
    filter,
    selectionIds: getCategoryFilterSelectionIds(category, filter.id),
  }));
}

/**
 * Keeps only numeric references into a provider's existing product index.
 * Products are copied only when a category request is materialized.
 */
export class CategoryProductIndex {
  private indexedProducts: ProviderProduct[] | undefined;
  private categorizedProducts = new Map<LuqtaCategory, IndexedEvidence[]>();
  private productIndexes = new Map<string, number[]>();
  private filterIdsByCategory = new Map<string, Map<number, string[]>>();
  private facetCountsByCategory = new Map<string, Map<string, number>>();
  private buildGeneration = 0;

  setProducts(products: ProviderProduct[]) {
    this.buildGeneration += 1;
    this.indexedProducts = products;
    this.categorizedProducts = this.prepareAndGroupProducts(products);
    this.productIndexes = new Map();
    this.filterIdsByCategory = new Map();
    this.facetCountsByCategory = new Map();
    for (const category of LUQTA_CATEGORIES) {
      this.ensureCategory(category);
    }
  }

  async setProductsYielding(products: ProviderProduct[]) {
    const generation = ++this.buildGeneration;
    const nextProductIndexes = new Map<string, number[]>();
    const nextFilterIdsByCategory = new Map<
      string,
      Map<number, string[]>
    >();
    const nextFacetCountsByCategory = new Map<string, Map<string, number>>();
    const categorizedProducts = new Map<LuqtaCategory, IndexedEvidence[]>(
      LUQTA_CATEGORIES.map((category) => [category, []]),
    );
    for (let index = 0; index < products.length; index += 1) {
      const evidence = prepareCategoryIndexEvidence(products[index]);
      if (evidence.classifiedCategory) {
        categorizedProducts.get(evidence.classifiedCategory)?.push({
          index,
          evidence,
        });
      }
      if ((index + 1) % CATEGORY_INDEX_YIELD_BATCH_SIZE === 0) {
        await yieldToEventLoop();
        if (generation !== this.buildGeneration) return;
      }
    }

    for (const category of LUQTA_CATEGORIES) {
      const built = await this.buildCategoryIndexYielding(
        categorizedProducts.get(category) ?? [],
        category,
        generation,
      );
      if (!built || generation !== this.buildGeneration) return;
      nextProductIndexes.set(categoryKey(category), built.indexes);
      nextFilterIdsByCategory.set(category, built.filterIdsByIndex);
      nextFacetCountsByCategory.set(
        categoryKey(category),
        built.facetCounts,
      );
      for (const [filterId, indexes] of built.filterIndexesById) {
        nextProductIndexes.set(categoryKey(category, filterId), indexes);
      }
      for (const [filterId, counts] of built.filteredFacetCountsById) {
        nextFacetCountsByCategory.set(categoryKey(category, filterId), counts);
      }
      await yieldToEventLoop();
    }

    if (generation !== this.buildGeneration) return;
    this.indexedProducts = products;
    this.categorizedProducts = categorizedProducts;
    this.productIndexes = nextProductIndexes;
    this.filterIdsByCategory = nextFilterIdsByCategory;
    this.facetCountsByCategory = nextFacetCountsByCategory;
  }

  private async buildCategoryIndexYielding(
    products: IndexedEvidence[],
    category: LuqtaCategory,
    generation: number,
  ): Promise<BuiltCategoryIndex | undefined> {
    const indexes: number[] = [];
    const filterIdsByIndex = new Map<number, string[]>();
    const facetCounts = new Map<string, number>();
    const filterIndexesById = new Map<string, number[]>();
    const filterDefinitions = getFilterDefinitions(category);
    const filters = filterDefinitions.map(({ filter }) => filter);

    for (let index = 0; index < products.length; index += 1) {
      const { index: productIndex, evidence } = products[index];
      const categoryData = getCategoryIndexDataForIndex(
        evidence,
        category,
        filters,
      );
      if (categoryData.matches) {
        const filterIds = categoryData.filterIds;
        const filterIdSet = new Set(filterIds);
        indexes.push(productIndex);
        filterIdsByIndex.set(productIndex, filterIds);
        for (const facetId of filterIds) {
          facetCounts.set(facetId, (facetCounts.get(facetId) ?? 0) + 1);
        }

        for (const { filter, selectionIds } of filterDefinitions) {
          if (
            selectionIds?.every((selectionId) => filterIdSet.has(selectionId))
          ) {
            const filterIndexes = filterIndexesById.get(filter.id) ?? [];
            filterIndexes.push(productIndex);
            filterIndexesById.set(filter.id, filterIndexes);
          }
        }
      }

      if ((index + 1) % CATEGORY_INDEX_YIELD_BATCH_SIZE === 0) {
        await yieldToEventLoop();
        if (generation !== this.buildGeneration) return undefined;
      }
    }

    const filteredFacetCountsById = new Map<
      string,
      Map<string, number>
    >();
    for (const [filterId, filterIndexes] of filterIndexesById) {
      const selectedFacetCounts = new Map<string, number>();
      for (let index = 0; index < filterIndexes.length; index += 1) {
        const productIndex = filterIndexes[index];
        for (const facetId of filterIdsByIndex.get(productIndex) ?? []) {
          selectedFacetCounts.set(
            facetId,
            (selectedFacetCounts.get(facetId) ?? 0) + 1,
          );
        }
        if ((index + 1) % (CATEGORY_INDEX_YIELD_BATCH_SIZE * 2) === 0) {
          await yieldToEventLoop();
          if (generation !== this.buildGeneration) return undefined;
        }
      }
      filteredFacetCountsById.set(filterId, selectedFacetCounts);
    }

    return {
      indexes,
      filterIdsByIndex,
      facetCounts,
      filterIndexesById,
      filteredFacetCountsById,
    };
  }

  private prepareAndGroupProducts(
    products: ProviderProduct[],
  ) {
    const categorizedProducts = new Map<LuqtaCategory, IndexedEvidence[]>(
      LUQTA_CATEGORIES.map((category) => [category, []]),
    );
    for (let index = 0; index < products.length; index += 1) {
      const evidence = prepareCategoryIndexEvidence(products[index]);
      if (evidence.classifiedCategory) {
        categorizedProducts.get(evidence.classifiedCategory)?.push({
          index,
          evidence,
        });
      }
    }
    return categorizedProducts;
  }

  private ensureCategory(category: LuqtaCategory) {
    if (this.productIndexes.has(category)) return;
    const products = this.categorizedProducts.get(category) ?? [];
    const indexes: number[] = [];
    const filterIdsByIndex = new Map<number, string[]>();
    const facetCounts = new Map<string, number>();
    const filterDefinitions = getFilterDefinitions(category);
    const filters = filterDefinitions.map(({ filter }) => filter);

    for (let index = 0; index < products.length; index += 1) {
      const { index: productIndex, evidence } = products[index];
      const categoryData = getCategoryIndexDataForIndex(
        evidence,
        category,
        filters,
      );
      if (!categoryData.matches) continue;

      const filterIds = categoryData.filterIds;
      indexes.push(productIndex);
      filterIdsByIndex.set(productIndex, filterIds);
      for (const facetId of filterIds) {
        facetCounts.set(facetId, (facetCounts.get(facetId) ?? 0) + 1);
      }

      for (const { filter, selectionIds } of filterDefinitions) {
        if (
          selectionIds?.every((selectionId) => filterIds.includes(selectionId))
        ) {
          const key = categoryKey(category, filter.id);
          const filterIndexes = this.productIndexes.get(key) ?? [];
          filterIndexes.push(productIndex);
          this.productIndexes.set(key, filterIndexes);
        }
      }
    }
    this.productIndexes.set(categoryKey(category), indexes);
    this.filterIdsByCategory.set(category, filterIdsByIndex);
    this.facetCountsByCategory.set(categoryKey(category), facetCounts);

    for (const { filter } of filterDefinitions) {
      const key = categoryKey(category, filter.id);
      const filterIndexes = this.productIndexes.get(key);
      if (!filterIndexes) continue;
      const selectedFacetCounts = new Map<string, number>();
      for (const index of filterIndexes) {
        for (const facetId of filterIdsByIndex.get(index) ?? []) {
          selectedFacetCounts.set(
            facetId,
            (selectedFacetCounts.get(facetId) ?? 0) + 1,
          );
        }
      }
      this.facetCountsByCategory.set(key, selectedFacetCounts);
    }
  }

  getProducts(
    products: ProviderProduct[],
    category: LuqtaCategory,
    filterId?: string,
    page = 1,
    pageSize = 24,
  ) {
    if (this.indexedProducts !== products) this.setProducts(products);
    this.ensureCategory(category);
    const indexes = this.productIndexes.get(categoryKey(category, filterId)) ?? [];
    const filterIdsByIndex = this.filterIdsByCategory.get(category) ?? new Map();
    const offset = Math.max(0, page - 1) * pageSize;
    return indexes.slice(offset, offset + pageSize).flatMap((index) => {
      const product = products[index];
      if (!product) return [];
      return [
        {
          ...product,
          categoryFilterIds: filterIdsByIndex.get(index) ?? [],
          exactMatchScore: product.exactMatchScore ?? 0.5,
        },
      ];
    });
  }

  getCount(
    products: ProviderProduct[],
    category: LuqtaCategory,
    filterId?: string,
  ) {
    if (this.indexedProducts !== products) this.setProducts(products);
    this.ensureCategory(category);
    return this.productIndexes.get(categoryKey(category, filterId))?.length ?? 0;
  }

  getFacetCounts(
    products: ProviderProduct[],
    category: LuqtaCategory,
    filterId?: string,
  ) {
    if (this.indexedProducts !== products) this.setProducts(products);
    this.ensureCategory(category);
    return (
      this.facetCountsByCategory.get(categoryKey(category, filterId)) ??
      new Map<string, number>()
    );
  }
}