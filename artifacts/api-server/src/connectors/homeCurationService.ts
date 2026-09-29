import { CacheService } from "./cacheService";
import type { LuqtaCategory, NormalizedProduct } from "./types";
import type { SearchOrchestrator } from "./searchOrchestrator";

export type HomeCollectionDefinition = {
  id: string;
  title: string;
  category: LuqtaCategory;
  filterId?: string;
};

export type HomePicksResponse = {
  collection: HomeCollectionDefinition;
  products: NormalizedProduct[];
};

const COLLECTIONS: readonly HomeCollectionDefinition[] = [
  {
    id: "watches-to-see",
    title: "ساعات تستحق النظرة",
    category: "watches_jewelry",
    filterId: "watches",
  },
  {
    id: "selected-style",
    title: "أناقة مختارة",
    category: "fashion",
  },
  {
    id: "selected-fragrance",
    title: "عطور مختارة",
    category: "beauty_care",
    filterId: "fragrance",
  },
  {
    id: "bags-accessories",
    title: "شنط وإكسسوارات",
    category: "bags_accessories",
  },
  {
    id: "discover-new",
    title: "اكتشف الجديد",
    category: "electronics",
  },
  {
    id: "value-picks",
    title: "اختيارات بسعر مميز",
    category: "shoes",
  },
];

const MIN_FEATURED_PRODUCTS = 3;
const MAX_FEATURED_PRODUCTS = 4;

function isHttpUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isFeaturedEligible(product: NormalizedProduct) {
  return (
    product.providerId !== "brave-web" &&
    product.sourceType !== "web" &&
    isHttpUrl(product.imageUrl) &&
    isHttpUrl(product.destinationUrl ?? product.productUrl) &&
    Boolean(product.title.trim()) &&
    Boolean(product.merchant?.trim())
  );
}

function featuredScore(product: NormalizedProduct) {
  const completeness =
    Number(Boolean(product.description?.trim())) * 0.08 +
    Number(Boolean(product.category?.trim())) * 0.08 +
    Number(Boolean(product.brand?.trim())) * 0.08 +
    Number(product.price !== undefined) * 0.06 +
    Number(product.originalPrice !== undefined) * 0.04 +
    Number(isHttpUrl(product.imageUrl)) * 0.12;
  const availability =
    product.availability === "in_stock"
      ? 0.12
      : product.availability === "unknown"
        ? 0.06
        : 0;
  return (
    (product.rankScore ?? 0) * 0.42 +
    (product.reliabilityScore ?? 0.5) * 0.2 +
    availability +
    completeness
  );
}

export class HomeCurationService {
  private readonly cache = new CacheService<HomePicksResponse>(5 * 60 * 1_000);

  constructor(private readonly search: SearchOrchestrator) {}

  async getPicks(): Promise<HomePicksResponse> {
    const cached = this.cache.get("home-picks");
    if (cached) return cached;

    const startIndex =
      Math.floor(Date.now() / (24 * 60 * 60 * 1_000)) % COLLECTIONS.length;
    for (let offset = 0; offset < COLLECTIONS.length; offset += 1) {
      const collection = COLLECTIONS[(startIndex + offset) % COLLECTIONS.length];
      const response = await this.search.searchWithMetadata({
        query: collection.category,
        category: collection.category,
        searchMode: "category_browse",
      });
      const products = response.products
        .filter(isFeaturedEligible)
        .filter((product) =>
          collection.filterId
            ? product.categoryFilterIds?.includes(collection.filterId)
            : true,
        )
        .sort((a, b) => featuredScore(b) - featuredScore(a))
        .slice(0, MAX_FEATURED_PRODUCTS);

      if (products.length >= MIN_FEATURED_PRODUCTS) {
        const result = { collection, products };
        this.cache.set("home-picks", result);
        return result;
      }
    }

    const emptyResult: HomePicksResponse = {
      collection: COLLECTIONS[startIndex] ?? COLLECTIONS[0],
      products: [],
    };
    this.cache.set("home-picks", emptyResult);
    return emptyResult;
  }
}