import {
  getHomePicks,
  searchProducts,
  type HomePicksResponse,
  type ProductSearchResponse,
  type ProductSearchRequest,
  type SearchProduct,
} from '@workspace/api-client-react';
import type { ProductResult } from '@/types/search';
import { logMobileTiming, mobileNow } from '@/services/mobileDiagnostics';

export type SearchMode = NonNullable<ProductSearchRequest['searchMode']>;
export type CategoryState = 'healthy' | 'low' | 'zero';
export type CategoryFacet = {
  id: string;
  label: string;
  count: number;
  level: 0 | 1;
  parentId?: string;
};
export type SearchResults = {
  products: ProductResult[];
  exactMatches?: number;
  constraintRelaxationAvailable?: boolean;
  categoryState?: CategoryState;
  categoryInventoryCount?: number;
  categoryFilters: CategoryFacet[];
  total?: number;
  page?: number;
  pageSize?: number;
  hasMore?: boolean;
  structuredIntent?: ProductSearchResponse['structuredIntent'];
  strongInternalMatchCount?: number;
  fallbackStatus?: ProductSearchResponse['fallbackStatus'];
};
export type HomePicks = {
  collection: HomePicksResponse['collection'];
  products: ProductResult[];
};

const SEARCH_REQUEST_DEADLINE_MS = 8_000;
const COLD_CATEGORY_REQUEST_DEADLINE_MS = 20_000;

let hasLoggedNazihImageUrlTrace = false;

function mapSearchProduct(product: SearchProduct): ProductResult {
  const canonical = product.canonical;
  const imageUrls = [
    canonical.imageUrl,
    ...(canonical.alternateImageUrls ?? []),
  ].filter((value): value is string => Boolean(value));
  const uniqueImageUrls = [...new Set(imageUrls)];
  const image = uniqueImageUrls[0];

  const mapped: ProductResult = {
    id: canonical.id,
    title: canonical.title,
    description: canonical.description,
    image,
    ...(image ? { imageUrl: image } : {}),
    gallery: uniqueImageUrls,
    price: canonical.price,
    originalPrice: canonical.originalPrice,
    discount: canonical.discount,
    currency: canonical.currency,
    merchant: canonical.merchant,
    rating: canonical.rating,
    reviewCount: canonical.reviewCount,
    productUrl: canonical.productUrl,
    affiliateUrl: canonical.affiliateUrl,
    source: canonical.providerId,
    sourceType: product.isAffiliate ? 'affiliate' : 'marketplace',
    availability: canonical.availability,
    location: canonical.location,
    condition: canonical.condition,
    isAffiliate: product.isAffiliate,
    matchScore: product.rankScore,
    priceScore: product.priceScore,
    relevanceScore: product.exactMatchScore ?? product.rankScore,
    updatedAt: canonical.updatedAt,
    category: canonical.category,
    categoryFilterIds: product.categoryFilterIds,
    color: canonical.color,
    canonical,
  };
  if (__DEV__ && process.env.EXPO_PUBLIC_IMAGE_DEBUG === '1' &&
      product.providerId === 'nazih' && !hasLoggedNazihImageUrlTrace) {
    hasLoggedNazihImageUrlTrace = true;
    console.log('[luqta-nazih-image-url-trace]', {
      productId: product.id,
      title: canonical.title,
      apiJsonImageUrl: product.imageUrl,
      normalizedProductResultImageUrl: mapped.imageUrl,
      canonicalPrimaryImageUrl: canonical.imageUrl,
      canonicalAlternateImageCount: canonical.alternateImageUrls?.length ?? 0,
      byteForByteEqual: product.imageUrl === canonical.imageUrl,
    });
  }
  return mapped;
}

export class SearchService {
  private readonly cache = new Map<
    string,
    { expiresAt: number; response: SearchResults }
  >();
  private readonly productsById = new Map<string, ProductResult>();

  async search(
    query: string,
    category?: NonNullable<ProductSearchRequest['category']>,
  ): Promise<ProductResult[]> {
    return (await this.searchWithMetadata(query, category)).products;
  }

  async searchWithMetadata(
    query: string,
    category?: NonNullable<ProductSearchRequest['category']>,
    searchMode: SearchMode = category ? 'category_browse' : 'intent',
    categoryFilterId?: string,
    page = 1,
    signal?: AbortSignal,
  ): Promise<SearchResults> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return { products: [], categoryFilters: [] };

    const categoryBrowse = Boolean(category && searchMode === 'category_browse');
    const key = `${category ?? 'search'}:${searchMode}:${categoryFilterId ?? 'all'}:${categoryBrowse ? page : 1}:${normalizedQuery.toLocaleLowerCase()}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.response;

    const requestStartedAt = mobileNow();
    logMobileTiming('REQUEST_STARTED', {
      category,
      searchMode,
      page,
      query: normalizedQuery,
    });
    const deadlineController = new AbortController();
    const abortFromCaller = () => deadlineController.abort();
    if (signal) {
      if (signal.aborted) deadlineController.abort();
      else signal.addEventListener('abort', abortFromCaller, { once: true });
    }
    const deadline = setTimeout(
      () => deadlineController.abort(),
      categoryBrowse
        ? COLD_CATEGORY_REQUEST_DEADLINE_MS
        : SEARCH_REQUEST_DEADLINE_MS,
    );
    let response: ProductSearchResponse;
    try {
      response = await searchProducts(
        {
          query: normalizedQuery,
          ...(category ? { category } : {}),
          ...(categoryFilterId ? { categoryFilterId } : {}),
          ...(categoryBrowse ? { page, pageSize: 24 } : {}),
          searchMode,
        },
        { signal: deadlineController.signal },
      );
    } finally {
      clearTimeout(deadline);
      signal?.removeEventListener('abort', abortFromCaller);
    }
    const responseReceivedAt = mobileNow();
    const results = response.products.map(mapSearchProduct);
    const mappedAt = mobileNow();
    if (__DEV__) {
      console.log('[luqta-timing] search', {
        category,
        searchMode,
        page,
        productCount: results.length,
        imageCount: results.filter((product) => Boolean(product.image)).length,
        networkAndJsonMs: Number((responseReceivedAt - requestStartedAt).toFixed(1)),
        mobileMappingMs: Number((mappedAt - responseReceivedAt).toFixed(1)),
      });
    }
    logMobileTiming('RESPONSE_RECEIVED', {
      category,
      searchMode,
      page,
      responseProductCount: response.products.length,
      responseToMappingMs: Number((mappedAt - responseReceivedAt).toFixed(1)),
    });
    const mappedResponse: SearchResults = {
      products: results,
      exactMatches: response.exactMatches,
      constraintRelaxationAvailable: response.constraintRelaxationAvailable,
      categoryState: response.categoryState,
      categoryInventoryCount: response.categoryInventoryCount,
      categoryFilters: response.categoryFilters ?? [],
      total: response.total,
      page: response.page,
      pageSize: response.pageSize,
      hasMore: response.hasMore,
      structuredIntent: response.structuredIntent,
      strongInternalMatchCount: response.strongInternalMatchCount,
      fallbackStatus: response.fallbackStatus,
    };

    for (const product of results) {
      this.productsById.set(product.id, product);
    }
    this.cache.set(key, {
      expiresAt: Date.now() + 30_000,
      response: mappedResponse,
    });
    return mappedResponse;
  }

  getProduct(id: string): ProductResult | undefined {
    return this.productsById.get(id);
  }

  async getHomePicks(): Promise<HomePicks> {
    const response = await getHomePicks();
    const products = response.products.map(mapSearchProduct);
    for (const product of products) {
      this.productsById.set(product.id, product);
    }
    return { collection: response.collection, products };
  }
}

export const searchService = new SearchService();