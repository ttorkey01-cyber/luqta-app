import { logger } from "../lib/logger";
import { CacheService } from "./cacheService";
import { CategoryProductIndex } from "./categoryProductIndex";
import { withCategoryBuildSlot } from "./categoryBuildCoordinator";
import { collectFeedImageUrls } from "./feedImageUrls";
import {
  FEED_REQUEST_RECOVERY_COOLDOWN_MS,
  retryFeedRefresh,
} from "./feedRefreshCoordinator";
import { getCategoryFilterSelectionIds } from "./categoryTaxonomy";
import type {
  ProviderImageHealth,
  ProviderMetadata,
  ProviderProduct,
  ProviderCategorySearchResult,
  ProviderSearchRequest,
  SearchProvider,
} from "./types";

const QUERY_CACHE_TTL_MS = 15 * 60 * 1_000;
const INDEX_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const DEFAULT_FEED_FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_FEED_BYTES = 10 * 1_024 * 1_024;
const MAX_SEARCH_RESULTS = 100;
const IMAGE_HEALTH_SAMPLE_SIZE = 12;
const IMAGE_HEALTH_REQUEST_TIMEOUT_MS = 4_000;
const IMAGE_HEALTH_MAX_CONCURRENCY = 4;
const IMAGE_HEALTH_WARNING_FAILURE_THRESHOLD = 2;

type CsvRecord = Record<string, string>;

type RefreshTiming = {
  startedAt: number;
  feedDownloadParseStartedAt?: number;
  feedDownloadParseCompletedAt?: number;
  categoryIndexBuildQueuedAt?: number;
  categoryIndexBuildStartedAt?: number;
  categoryIndexBuildCompletedAt?: number;
  productIndexPublishedAt?: number;
};

function normalizeHeader(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function detectDelimiter(input: string) {
  const header = input.split(/\r?\n/, 1)[0] ?? "";
  return [";", ",", "\t"]
    .map((delimiter) => ({
      delimiter,
      count: header.split(delimiter).length - 1,
    }))
    .sort((a, b) => b.count - a.count)[0]?.delimiter ?? ";";
}

function createCsvRowParser(
  delimiter: string,
  onRow: (row: string[]) => void,
) {
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const push = (input: string) => {
    for (let index = 0; index < input.length; index += 1) {
      const character = input[index];

      if (inQuotes) {
        if (character === '"') {
          if (input[index + 1] === '"') {
            field += '"';
            index += 1;
          } else {
            inQuotes = false;
          }
        } else {
          field += character;
        }
      } else if (character === '"') {
        inQuotes = true;
      } else if (character === delimiter) {
        row.push(field);
        field = "";
      } else if (character === "\n") {
        row.push(field);
        onRow(row);
        row = [];
        field = "";
      } else if (character !== "\r") {
        field += character;
      }
    }
  };

  return {
    push,
    finish() {
      if (field || row.length) {
        row.push(field);
        onRow(row);
      }
    },
  };
}

function first(record: CsvRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function safeHttpUrl(value: string | undefined) {
  if (!value) return undefined;
  const originalValue = value.trim();
  try {
    const parsed = new URL(originalValue);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? originalValue
      : undefined;
  } catch {
    return undefined;
  }
}

function parsePrice(value: string | undefined) {
  if (!value) return undefined;
  const normalized = value.replace(/\s/g, "").replace(/,/g, ".");
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const price = Number(match[0]);
  return Number.isFinite(price) && price >= 0 ? price : undefined;
}

function parseNonNegativeInteger(value: string | undefined) {
  const parsed = parsePrice(value);
  return parsed !== undefined && Number.isInteger(parsed) ? parsed : undefined;
}

function parseRating(value: string | undefined) {
  const parsed = parsePrice(value);
  return parsed !== undefined && parsed <= 5 ? parsed : undefined;
}

function normalizeCurrency(value: string | undefined) {
  const currency = value?.trim().toUpperCase();
  return currency && /^[A-Z]{3}$/.test(currency) ? currency : undefined;
}

function normalizeAvailability(value: string | undefined) {
  const normalized = value?.trim().toLocaleLowerCase();
  if (["true", "1", "in stock", "in_stock", "available"].includes(normalized ?? "")) {
    return "in_stock" as const;
  }
  if (
    ["false", "0", "out of stock", "out_of_stock", "unavailable"].includes(
      normalized ?? "",
    )
  ) {
    return "out_of_stock" as const;
  }
  return "unknown" as const;
}

function normalizeCondition(value: string | undefined) {
  const normalized = decodeHtml(value)?.toLocaleLowerCase();
  if (!normalized) return undefined;
  if (/\b(refurbished|renewed|reconditioned)\b/.test(normalized)) {
    return "refurbished" as const;
  }
  if (/\b(new|unused)\b/.test(normalized)) {
    return "new" as const;
  }
  if (
    /\b(pre[- ]?owned|used|fair|good|excellent|wear|worn|scuff|scratch)\b/.test(
      normalized,
    )
  ) {
    return "used" as const;
  }
  return "unknown" as const;
}

function decodeHtml(value: string | undefined) {
  if (!value) return undefined;
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function calculateMatchScore(product: ProviderProduct, query: string) {
  const tokens = query
    .toLocaleLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (!tokens.length) return 0.5;

  const haystack = [
    product.title,
    product.description,
    product.category,
    product.brand,
    product.merchant,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
  return tokens.filter((token) => haystack.includes(token)).length / tokens.length;
}

function mapRecord(
  record: CsvRecord,
  index: number,
  merchant: string,
  fieldMappings: AdmitadFeedFieldMappings | undefined,
  requireCompleteProductData = false,
): ProviderProduct | undefined {
  const title = first(record, ["name", "title", "product_name"]);
  const affiliateUrl = safeHttpUrl(
    first(record, ["url", "affiliate_url", "affiliate_link", "deeplink"]),
  );
  if (!title || !affiliateUrl) return undefined;

  const price = parsePrice(first(record, ["price", "sale_price"]));
  const originalPrice = parsePrice(first(record, ["oldprice", "old_price", "original_price"]));
  const providerProductId = first(record, ["id", "product_id", "sku"]);
  const imageFieldsDisabled = fieldMappings?.image?.includes(
    "__official_image_unavailable__",
  );
  const imageUrls = imageFieldsDisabled
    ? []
    : collectFeedImageUrls(
        record,
        fieldMappings?.image ?? ["picture", "image", "image_url"],
      );
  const currency = normalizeCurrency(first(record, ["currencyid", "currency", "currency_code"]));
  if (requireCompleteProductData && (price === undefined || price <= 0 || !currency || !imageUrls.length)) {
    return undefined;
  }

  return {
    id: providerProductId ?? `admitad-feed-${index}`,
    providerProductId: providerProductId ?? null,
    title: decodeHtml(title) ?? title,
    description: decodeHtml(first(record, ["description", "short_description"])),
    productUrl: affiliateUrl,
    affiliateUrl,
    imageUrl: imageUrls[0],
    alternateImageUrls: imageUrls.length > 1 ? imageUrls.slice(1) : null,
    price,
    originalPrice,
    currency,
    merchant,
    category: decodeHtml(
      first(
        record,
        fieldMappings?.category ?? ["categoryid", "category", "type"],
      ),
    ),
    productType: decodeHtml(
      first(record, fieldMappings?.productType ?? ["product_type", "producttype"]),
    ),
    subcategory: decodeHtml(
      first(
        record,
        fieldMappings?.subcategory ?? ["subcategory", "sub_category", "category_level_2"],
      ),
    ),
    audience: decodeHtml(
      first(record, fieldMappings?.audience ?? ["audience", "gender", "target_gender"]),
    ),
    color: decodeHtml(
      first(record, fieldMappings?.color ?? ["color", "colour", "color_name", "colour_name"]),
    ),
    brand: decodeHtml(first(record, fieldMappings?.brand ?? ["brand", "vendor"])),
    availability: normalizeAvailability(first(record, ["available", "availability", "stock"])),
    condition: fieldMappings?.condition
      ? normalizeCondition(first(record, fieldMappings.condition))
      : undefined,
    rating: parseRating(first(record, fieldMappings?.rating ?? ["rating", "average_rating"])),
    reviewCount: parseNonNegativeInteger(
      first(record, fieldMappings?.reviewCount ?? ["review_count", "reviews_count"]),
    ),
    updatedAt: first(
      record,
      fieldMappings?.updatedAt ?? ["updated_at", "updatedat", "last_updated", "date_modified"],
    ),
    sourceType: "affiliate_feed",
  };
}

export type AdmitadFeedFieldMappings = {
  image?: string[];
  brand?: string[];
  category?: string[];
  condition?: string[];
  productType?: string[];
  subcategory?: string[];
  audience?: string[];
  color?: string[];
  rating?: string[];
  reviewCount?: string[];
  updatedAt?: string[];
};

export type AdmitadFeedProviderOptions = {
  providerId: string;
  providerName: string;
  merchant: string;
  feedSecret: string;
  country?: string;
  currency?: string;
  priority: number;
  maxFeedBytes?: number;
  maxIndexedProducts?: number;
  requireCompleteProductData?: boolean;
  allowEmptyFeed?: boolean;
  feedFetchTimeoutMs?: number;
  fieldMappings?: AdmitadFeedFieldMappings;
};

export class AdmitadFeedProvider implements SearchProvider {
  readonly metadata: ProviderMetadata;
  private readonly queryCache = new CacheService<ProviderProduct[]>(
    QUERY_CACHE_TTL_MS,
  );
  private productIndex: ProviderProduct[] = [];
  private readonly categoryProductIndex = new CategoryProductIndex();
  private indexRefreshedAt = 0;
  private refreshPromise: Promise<number> | undefined;
  private lastRecoveryRequestAt = 0;
  private readonly refreshTimer: NodeJS.Timeout | undefined;
  private consecutiveImageHealthFailures = 0;
  private imageHealthRefreshId = 0;

  constructor(
    private readonly feedUrl: string | undefined,
    private readonly options: AdmitadFeedProviderOptions,
    startBackgroundRefresh = true,
  ) {
    const configured = Boolean(safeHttpUrl(feedUrl));
    this.metadata = {
      id: options.providerId,
      name: options.providerName,
      enabled: configured,
      searchEnabled: configured,
      affiliateEnabled: configured,
      priceMonitoringAllowed: false,
      visualSearchAllowed: false,
      country: options.country ?? "",
      currency: options.currency ?? "",
      integrationType: "affiliate_feed",
      requiresCredentials: true,
      credentialRequirements: [options.feedSecret],
      priority: options.priority,
      lastSuccessfulSync: null,
      affiliateCapability: configured ? "active" : "available_pending_access",
      priceMonitoringCapability: "disabled",
      integrationStatus: configured ? "ready" : "disabled",
      imageHealth: this.createInitialImageHealth(),
    };

    if (configured && startBackgroundRefresh) {
      void this.refreshIndex(false).catch((error) => {
        logger.warn(
          {
            providerId: this.metadata.id,
            error: error instanceof Error ? error.message : "Unknown feed error",
          },
          "Provider index startup refresh failed",
        );
      });
      this.refreshTimer = setInterval(() => {
        void this.refreshIndex(false).catch((error) => {
          logger.warn(
            {
              providerId: this.metadata.id,
              error:
                error instanceof Error ? error.message : "Unknown feed error",
            },
            "Scheduled provider index refresh failed; retaining existing index",
          );
        });
      }, INDEX_REFRESH_INTERVAL_MS);
      this.refreshTimer.unref();
    }
  }

  async search(request: ProviderSearchRequest): Promise<ProviderProduct[]> {
    if (!this.metadata.searchEnabled) return [];
    this.recoverUnreadyIndexOnRequest();

    const searchText = `${request.query.trim()} ${
      request.intent?.keywords?.join(" ") ?? ""
    }`.trim();
    const categoryBrowse = Boolean(
      request.category && request.searchMode !== "intent",
    );
    const cacheKey = categoryBrowse
      ? `category:${request.category}:${request.categoryFilterId ?? "all"}`
      : searchText.toLocaleLowerCase();
    const cached = this.queryCache.get(cacheKey);
    if (cached) return cached;

    if (categoryBrowse && request.category) {
      return (await this.searchCategory(request)).products;
    }

    const results = this.productIndex
      .map((product) => ({
        ...product,
        exactMatchScore: calculateMatchScore(product, searchText),
      }))
      .filter((product) => !searchText || (product.exactMatchScore ?? 0) > 0)
      .sort(
        (a, b) => (b.exactMatchScore ?? 0) - (a.exactMatchScore ?? 0),
      )
      .slice(0, MAX_SEARCH_RESULTS);

    if (this.productIndex.length > 0) this.queryCache.set(cacheKey, results);
    return results;
  }

  getSearchIndexReadiness() {
    return {
      ready: this.productIndex.length > 0 || Boolean(this.options.allowEmptyFeed && this.indexRefreshedAt),
      productCount: this.productIndex.length,
      refreshing: this.refreshPromise !== undefined,
      lastSuccessfulSync: this.metadata.lastSuccessfulSync,
    };
  }

  ensureSearchIndexReady(): Promise<number> {
    if (!this.metadata.searchEnabled || this.getSearchIndexReadiness().ready) {
      return Promise.resolve(this.productIndex.length);
    }
    if (this.refreshPromise) return this.refreshPromise;
    if (Date.now() - this.lastRecoveryRequestAt < FEED_REQUEST_RECOVERY_COOLDOWN_MS) {
      return Promise.resolve(0);
    }
    this.lastRecoveryRequestAt = Date.now();
    return this.refreshIndex(false);
  }

  async searchCategory(
    request: ProviderSearchRequest,
  ): Promise<ProviderCategorySearchResult> {
    if (!this.metadata.searchEnabled || !request.category) {
      return { products: [], total: 0, facetCounts: {} };
    }
    this.recoverUnreadyIndexOnRequest();

    if (!this.getSearchIndexReadiness().ready) {
      return {
        products: [],
        total: 0,
        facetCounts: {},
        ready: false,
        timings: {
          readinessWaitMs: 0,
          categoryIndexMs: 0,
          facetLookupMs: 0,
        },
      };
    }

    const selection =
      request.categoryFilterId === undefined
        ? undefined
        : getCategoryFilterSelectionIds(
            request.category,
            request.categoryFilterId,
          );
    const categoryIndexStartedAt = performance.now();
    const results =
      selection === undefined
        ? this.categoryProductIndex.getProducts(
            this.productIndex,
            request.category,
            undefined,
            request.page,
            request.pageSize,
          )
        : selection.length > 0
          ? this.categoryProductIndex.getProducts(
              this.productIndex,
              request.category,
              request.categoryFilterId,
              request.page,
              request.pageSize,
            )
          : [];
    const categoryIndexMs = performance.now() - categoryIndexStartedAt;
    const indexFilterId =
      selection === undefined ? undefined : request.categoryFilterId;
    const facetLookupStartedAt = performance.now();
    const facetCounts = Object.fromEntries(
      this.categoryProductIndex.getFacetCounts(
        this.productIndex,
        request.category,
        indexFilterId,
      ),
    );
    const facetLookupMs = performance.now() - facetLookupStartedAt;
    return {
      products: results,
      total:
        selection === undefined
          ? this.categoryProductIndex.getCount(this.productIndex, request.category)
          : selection.length > 0
            ? this.categoryProductIndex.getCount(
                this.productIndex,
                request.category,
                request.categoryFilterId,
              )
            : 0,
      facetCounts,
      ready: true,
      timings: {
        readinessWaitMs: 0,
        categoryIndexMs,
        facetLookupMs,
      },
    };
  }

  async refreshIndex(force = true): Promise<number> {
    if (!this.metadata.searchEnabled) return 0;
    if (
      !force &&
      (this.productIndex.length || (this.options.allowEmptyFeed && this.indexRefreshedAt)) &&
      Date.now() - this.indexRefreshedAt < INDEX_REFRESH_INTERVAL_MS
    ) {
      return this.productIndex.length;
    }
    if (this.refreshPromise) return this.refreshPromise;

    const timing: RefreshTiming = { startedAt: Date.now() };
    const refresh = retryFeedRefresh(() => this.fetchProductIndex(timing))
      .then(async (products) => {
        if (!products.length && this.productIndex.length) {
          logger.warn(
            { providerId: this.metadata.id, retainedProductCount: this.productIndex.length },
            "Empty provider refresh ignored; retaining existing index",
          );
          return this.productIndex.length;
        }
        timing.categoryIndexBuildQueuedAt = Date.now();
        logger.info(
          {
            providerId: this.metadata.id,
            indexedProductCount: products.length,
            feedDownloadParseDurationMs:
              timing.feedDownloadParseCompletedAt! -
              timing.feedDownloadParseStartedAt!,
          },
          "Provider category-index build queued",
        );
        await withCategoryBuildSlot(async () => {
          timing.categoryIndexBuildStartedAt = Date.now();
          logger.info(
            {
              providerId: this.metadata.id,
              indexedProductCount: products.length,
              feedDownloadParseDurationMs:
                timing.feedDownloadParseCompletedAt! -
                timing.feedDownloadParseStartedAt!,
              categoryIndexBuildWaitDurationMs:
                timing.categoryIndexBuildStartedAt -
                timing.categoryIndexBuildQueuedAt!,
              categoryIndexBuildDurationMs: 0,
            },
            "Provider category-index build started",
          );
          try {
            await this.categoryProductIndex.setProductsYielding(products);
          } catch (error) {
            logger.warn(
              {
                providerId: this.metadata.id,
                categoryIndexBuildDurationMs:
                  Date.now() - timing.categoryIndexBuildStartedAt,
                error: error instanceof Error ? error.message : "Unknown build error",
              },
              "Provider category-index build failed",
            );
            throw error;
          }
          timing.categoryIndexBuildCompletedAt = Date.now();
          logger.info(
            {
              providerId: this.metadata.id,
              indexedProductCount: products.length,
              feedDownloadParseDurationMs:
                timing.feedDownloadParseCompletedAt! -
                timing.feedDownloadParseStartedAt!,
              categoryIndexBuildWaitDurationMs:
                timing.categoryIndexBuildStartedAt -
                timing.categoryIndexBuildQueuedAt!,
              categoryIndexBuildDurationMs:
                timing.categoryIndexBuildCompletedAt -
                timing.categoryIndexBuildStartedAt,
            },
            "Provider category-index build finished",
          );
        });
        this.productIndex = products;
        timing.productIndexPublishedAt = Date.now();
        this.indexRefreshedAt = Date.now();
        if (products.length) {
          this.metadata.currency = [
            ...new Set(products.map((product) => product.currency).filter(Boolean)),
          ]
            .sort()
            .join(",");
        }
        this.metadata.lastSuccessfulSync = new Date(
          this.indexRefreshedAt,
        ).toISOString();
        this.queryCache.clear();
        void this.refreshImageHealth(products);
        logger.info(
          {
            providerId: this.metadata.id,
            feedDownloadParseDurationMs:
              timing.feedDownloadParseCompletedAt! -
              timing.feedDownloadParseStartedAt!,
            categoryIndexBuildDurationMs:
              timing.categoryIndexBuildCompletedAt! -
              timing.categoryIndexBuildStartedAt!,
            categoryIndexBuildWaitDurationMs:
              timing.categoryIndexBuildStartedAt! -
              timing.categoryIndexBuildQueuedAt!,
            totalRefreshDurationMs:
              timing.productIndexPublishedAt! - timing.startedAt,
            indexedProductCount: products.length,
          },
          "Provider product-index published",
        );
        return products.length;
      })
      .finally(() => {
        this.refreshPromise = undefined;
      });
    this.refreshPromise = refresh;
    return refresh;
  }

  private recoverUnreadyIndexOnRequest() {
    void this.ensureSearchIndexReady().catch((error) => {
      logger.warn(
        {
          providerId: this.metadata.id,
          error: error instanceof Error ? error.message : "Unknown feed error",
        },
        "Provider on-request index recovery failed",
      );
    });
  }

  private createInitialImageHealth(): ProviderImageHealth {
    return {
      populatedImageCount: 0,
      sampledImageCount: 0,
      reachableImageCount: 0,
      status: "not_checked",
      lastCheckedAt: null,
    };
  }

  private async refreshImageHealth(products: ProviderProduct[]) {
    const populatedImageCount = products.filter(
      (product) => Boolean(product.imageUrl),
    ).length;
    const imageUrls = [
      ...new Set(
        products
          .map((product) => product.imageUrl)
          .filter((imageUrl): imageUrl is string => Boolean(imageUrl)),
      ),
    ];
    const sample = imageUrls.slice(0, IMAGE_HEALTH_SAMPLE_SIZE);
    const refreshId = ++this.imageHealthRefreshId;

    if (!sample.length) {
      this.consecutiveImageHealthFailures = 0;
      this.metadata.imageHealth = {
        populatedImageCount,
        sampledImageCount: 0,
        reachableImageCount: 0,
        status: "not_checked",
        lastCheckedAt: new Date().toISOString(),
      };
      return;
    }

    let reachableImageCount = 0;
    for (
      let offset = 0;
      offset < sample.length;
      offset += IMAGE_HEALTH_MAX_CONCURRENCY
    ) {
      const batch = sample.slice(
        offset,
        offset + IMAGE_HEALTH_MAX_CONCURRENCY,
      );
      const results = await Promise.all(
        batch.map((imageUrl) => this.isImageReachable(imageUrl)),
      );
      reachableImageCount += results.filter(Boolean).length;
    }

    if (refreshId !== this.imageHealthRefreshId) return;

    const failedImageCount = sample.length - reachableImageCount;
    const status =
      failedImageCount === 0
        ? "healthy"
        : reachableImageCount === 0
          ? "unhealthy"
          : "degraded";
    this.metadata.imageHealth = {
      populatedImageCount,
      sampledImageCount: sample.length,
      reachableImageCount,
      status,
      lastCheckedAt: new Date().toISOString(),
    };

    if (failedImageCount > 0) {
      this.consecutiveImageHealthFailures += 1;
    } else {
      this.consecutiveImageHealthFailures = 0;
    }

    if (
      this.consecutiveImageHealthFailures ===
      IMAGE_HEALTH_WARNING_FAILURE_THRESHOLD
    ) {
      logger.warn(
        {
          providerId: this.metadata.id,
          populatedImageCount: imageUrls.length,
          sampledImageCount: sample.length,
          reachableImageCount,
          consecutiveFailures: this.consecutiveImageHealthFailures,
        },
        "Provider image health warning: sampled merchant images are not all reachable",
      );
    }
  }

  private async isImageReachable(imageUrl: string) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      IMAGE_HEALTH_REQUEST_TIMEOUT_MS,
    );

    try {
      const response = await fetch(imageUrl, {
        method: "HEAD",
        headers: {
          accept: "image/*,*/*;q=0.1",
          "user-agent": "LUQTA-Provider/1.0",
        },
        redirect: "follow",
        signal: controller.signal,
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchProductIndex(
    timing?: RefreshTiming,
  ): Promise<ProviderProduct[]> {
    if (timing) timing.feedDownloadParseStartedAt = Date.now();
    const feedUrl = safeHttpUrl(this.feedUrl);
    if (!feedUrl) {
      throw new Error(`${this.metadata.name} feed URL is not configured`);
    }

    const maxFeedBytes =
      this.options.maxFeedBytes ?? DEFAULT_MAX_FEED_BYTES;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.feedFetchTimeoutMs ?? DEFAULT_FEED_FETCH_TIMEOUT_MS,
    );

    try {
      const response = await fetch(feedUrl, {
        headers: {
          accept: "text/csv,text/plain;q=0.9,*/*;q=0.1",
          "user-agent": "LUQTA-Provider/1.0",
        },
        redirect: "follow",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(
          `${this.metadata.name} feed returned HTTP ${response.status}`,
        );
      }

      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > maxFeedBytes) {
        throw new Error(
          `${this.metadata.name} feed exceeds the maximum allowed size`,
        );
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error(`${this.metadata.name} feed returned an empty response`);
      }

      const decoder = new TextDecoder();
      let parser: ReturnType<typeof createCsvRowParser> | undefined;
      let pending = "";
      let headers: string[] | undefined;
      let totalBytes = 0;
      const products: ProviderProduct[] = [];
      let dataRowCount = 0;
      let productLimitReached = false;
      const consumeRow = (row: string[]) => {
        if (!headers) {
          headers = row.map(normalizeHeader);
          if (this.options.allowEmptyFeed &&
              !["name", "url", "price", "currencyid", "picture"].every(
                (key) => headers?.includes(key),
              )) {
            throw new Error(`${this.metadata.name} feed has an invalid CSV header`);
          }
          return;
        }
        if (
          this.options.maxIndexedProducts &&
          products.length >= this.options.maxIndexedProducts
        ) {
          productLimitReached = true;
          return;
        }
        if (!row.some((value) => value.trim())) return;
        dataRowCount += 1;
        const record = Object.fromEntries(
          headers.map((header, index) => [header, row[index]?.trim() ?? ""]),
        );
        const product = mapRecord(
          record,
          products.length,
          this.options.merchant,
          this.options.fieldMappings,
          this.options.requireCompleteProductData,
        );
        if (product) products.push(product);
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > maxFeedBytes) {
          await reader.cancel();
          throw new Error(
            `${this.metadata.name} feed exceeds the maximum allowed size`,
          );
        }

        const text = decoder.decode(value, { stream: true });
        if (!parser) {
          pending += text;
          if (!pending.includes("\n")) continue;
          parser = createCsvRowParser(detectDelimiter(pending), consumeRow);
          parser.push(pending);
          pending = "";
        } else {
          parser.push(text);
        }
        if (productLimitReached) {
          await reader.cancel();
          break;
        }
      }

      const finalText = decoder.decode();
      if (parser) {
        if (finalText) parser.push(finalText);
        parser.finish();
      } else {
        pending += finalText;
        parser = createCsvRowParser(detectDelimiter(pending), consumeRow);
        parser.push(pending);
        parser.finish();
      }

      if (!products.length && !(this.options.allowEmptyFeed && dataRowCount === 0)) {
        throw new Error(
          `${this.metadata.name} feed contained no valid products`,
        );
      }

      if (timing) {
        timing.feedDownloadParseCompletedAt = Date.now();
        logger.info(
          {
            providerId: this.metadata.id,
            indexedProductCount: products.length,
            feedDownloadParseDurationMs:
              timing.feedDownloadParseCompletedAt -
              timing.feedDownloadParseStartedAt!,
          },
          "Provider feed download and parse complete",
        );
      }
      logger.info(
        {
          providerId: this.metadata.id,
          indexedProductCount: products.length,
          bytesRead: totalBytes,
          productLimitReached,
        },
        "Provider product index refreshed",
      );
      return products;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class NazihProvider extends AdmitadFeedProvider {
  constructor(
    feedUrl = process.env.ADMITAD_NAZIH_FEED_URL,
    startBackgroundRefresh = true,
  ) {
    super(feedUrl, {
      providerId: "nazih",
      providerName: "Nazih",
      merchant: "Nazih",
      feedSecret: "ADMITAD_NAZIH_FEED_URL",
      country: "SA",
      currency: "SAR",
      priority: 15,
    }, startBackgroundRefresh);
  }
}