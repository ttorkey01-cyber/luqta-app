import { logger } from "../lib/logger";
import { CacheService } from "./cacheService";
import { CategoryProductIndex } from "./categoryProductIndex";
import { collectFeedImageUrls } from "./feedImageUrls";
import {
  FEED_REQUEST_RECOVERY_COOLDOWN_MS,
  retryFeedRefresh,
} from "./feedRefreshCoordinator";
import {
  getCategoryFilterSelectionIds,
  getElectronicsCategoryQuality,
  matchesLuqtaCategory,
} from "./categoryTaxonomy";
import type {
  ProviderMetadata,
  ProviderProduct,
  ProviderCategorySearchResult,
  ProviderSearchRequest,
  SearchProvider,
} from "./types";

const FEED_URL_SECRET = "ADMITAD_ALIEXPRESS_HOT_PRODUCTS_CSV_URL";
const QUERY_CACHE_TTL_MS = 15 * 60 * 1_000;
const INDEX_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const FEED_FETCH_TIMEOUT_MS = 90_000;
const MAX_FEED_BYTES = 500 * 1_024 * 1_024;
// Keep cold-start indexing bounded; this upstream hot-products feed can contain
// hundreds of thousands of rows, which cannot be indexed before Autoscale idles.
const MAX_INDEXED_PRODUCTS = 5_000;
const GENERAL_INDEX_LIMIT = 3_000;
const ELECTRONICS_INDEX_LIMIT = MAX_INDEXED_PRODUCTS - GENERAL_INDEX_LIMIT;
const MAX_CATEGORY_SCAN_BYTES = 30 * 1_024 * 1_024;
const MAX_SEARCH_RESULTS = 100;

type CsvRecord = Record<string, string>;

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
  const candidates = [",", ";", "\t"];
  return candidates
    .map((delimiter) => ({
      delimiter,
      count: header.split(delimiter).length - 1,
    }))
    .sort((a, b) => b.count - a.count)[0]?.delimiter ?? ",";
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
        continue;
      }

      if (character === '"') {
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
  if (!normalized) return "unknown" as const;
  if (
    ["in stock", "in_stock", "instock", "available", "true", "1"].includes(
      normalized,
    )
  ) {
    return "in_stock" as const;
  }
  if (
    ["out of stock", "out_of_stock", "outofstock", "unavailable", "false", "0"].includes(
      normalized,
    )
  ) {
    return "out_of_stock" as const;
  }
  return "unknown" as const;
}

function normalizeCondition(value: string | undefined) {
  const normalized = value?.trim().toLocaleLowerCase();
  if (normalized === "new") return "new" as const;
  if (normalized === "used") return "used" as const;
  if (normalized === "refurbished") return "refurbished" as const;
  return "unknown" as const;
}

function calculateMatchScore(product: ProviderProduct, query: string) {
  const tokens = query
    .toLocaleLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (!tokens.length) return 0.5;

  const haystack = `${product.title} ${product.description ?? ""}`.toLocaleLowerCase();
  const matches = tokens.filter((token) => haystack.includes(token)).length;
  return matches / tokens.length;
}

function mapRecord(record: CsvRecord, index: number): ProviderProduct | undefined {
  const title = first(record, [
    "title",
    "name",
    "product_name",
    "product_title",
    "productname",
  ]);
  if (!title) return undefined;

  const link = safeHttpUrl(
    first(record, [
      "affiliate_url",
      "affiliate_link",
      "deeplink",
      "deep_link",
      "tracking_link",
      "admitad_link",
      "link",
      "url",
    ]),
  );
  const productUrl =
    safeHttpUrl(
      first(record, [
        "product_url",
        "product_link",
        "canonical_url",
        "landing_page",
        "url",
        "link",
      ]),
    ) ?? link;
  if (!productUrl && !link) return undefined;

  const id =
    first(record, [
      "id",
      "product_id",
      "offer_id",
      "sku",
      "item_id",
      "productid",
    ]) ?? `feed-${index}`;
  const providerProductId = first(record, [
    "id",
    "product_id",
    "offer_id",
    "sku",
    "item_id",
    "productid",
  ]);
  const salePrice = first(record, [
    "sale_price",
    "discount_price",
    "promo_price",
    "price",
  ]);
  const imageUrls = collectFeedImageUrls(record, [
    "image_link",
    "image_url",
    "picture",
    "picture_url",
    "product_image",
    "main_image",
  ]);

  return {
    id,
    providerProductId: providerProductId ?? null,
    title,
    description: first(record, [
      "description",
      "product_description",
      "short_description",
    ]),
    productUrl,
    affiliateUrl: link,
    imageUrl: imageUrls[0],
    alternateImageUrls: imageUrls.length > 1 ? imageUrls.slice(1) : null,
    price: parsePrice(salePrice),
    currency: normalizeCurrency(
      first(record, [
        "currency",
        "currencyid",
        "currency_id",
        "currency_code",
        "price_currency",
      ]),
    ),
    merchant: first(record, ["merchant", "shop", "store", "advertiser"]),
    category: first(record, ["category", "category_path", "category_name", "categoryid", "category_id"]),
    productType: first(record, ["product_type", "producttype"]),
    subcategory: first(record, ["subcategory", "sub_category", "category_level_2"]),
    audience: first(record, ["audience", "gender", "target_gender"]),
    color: first(record, ["color", "colour", "color_name", "colour_name"]),
    availability: normalizeAvailability(
      first(record, ["availability", "stock", "in_stock"]),
    ),
    condition: normalizeCondition(first(record, ["condition"])),
    location: first(record, ["location", "ship_from", "shipping_country"]),
    rating: parseRating(first(record, ["rating", "average_rating"])),
    reviewCount: parseNonNegativeInteger(first(record, ["review_count", "reviews_count"])),
    updatedAt: first(record, ["updated_at", "updatedat", "last_updated", "date_modified"]),
    sourceType: "affiliate_feed",
    reliabilityScore: 0.8,
    specificationScore: 0.6,
  };
}

export class AliExpressProvider implements SearchProvider {
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

  constructor(
    private readonly feedUrl = process.env[FEED_URL_SECRET],
    startBackgroundRefresh = true,
  ) {
    const configured = Boolean(safeHttpUrl(feedUrl));
    this.metadata = {
      id: "aliexpress",
      name: "AliExpress",
      enabled: configured,
      searchEnabled: configured,
      affiliateEnabled: configured,
      priceMonitoringAllowed: false,
      visualSearchAllowed: false,
      country: "MULTI",
      currency: "USD",
      integrationType: "affiliate_feed",
      requiresCredentials: true,
      credentialRequirements: [FEED_URL_SECRET],
      priority: 5,
      lastSuccessfulSync: null,
      affiliateCapability: configured ? "active" : "available_pending_access",
      priceMonitoringCapability: "disabled",
      integrationStatus: configured ? "ready" : "disabled",
    };

    if (configured && startBackgroundRefresh) {
      void this.refreshIndex(false).catch((error) => {
        logger.warn(
          {
            providerId: this.metadata.id,
            error:
              error instanceof Error ? error.message : "Unknown feed error",
          },
          "Provider index startup refresh failed",
        );
      });

      this.refreshTimer = setInterval(() => {
        if (!this.productIndex.length) return;
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

    const query = request.query.trim();
    const intentTerms = request.intent?.keywords?.join(" ") ?? "";
    const searchText = `${query} ${intentTerms}`.trim();
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
      .filter(
        (product) => !searchText || (product.exactMatchScore ?? 0) > 0,
      )
      .sort(
        (a, b) => (b.exactMatchScore ?? 0) - (a.exactMatchScore ?? 0),
      )
      .slice(0, MAX_SEARCH_RESULTS);

    if (this.productIndex.length > 0) this.queryCache.set(cacheKey, results);
    return results;
  }

  getSearchIndexReadiness() {
    return {
      ready: this.productIndex.length > 0,
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

    if (!this.productIndex.length) {
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

  /**
   * Refreshes the server-side product index. Passing force=false reuses a
   * fresh index; the default is an explicit on-demand refresh.
   */
  async refreshIndex(force = true): Promise<number> {
    if (!this.metadata.searchEnabled) return 0;
    if (
      !force &&
      this.productIndex.length &&
      Date.now() - this.indexRefreshedAt < INDEX_REFRESH_INTERVAL_MS
    ) {
      return this.productIndex.length;
    }
    if (this.refreshPromise) return this.refreshPromise;

    const refresh = retryFeedRefresh(() => this.fetchProductIndex())
      .then(async (products) => {
        if (!products.length && this.productIndex.length) {
          logger.warn(
            { providerId: this.metadata.id, retainedProductCount: this.productIndex.length },
            "Empty provider refresh ignored; retaining existing index",
          );
          return this.productIndex.length;
        }
        await this.categoryProductIndex.setProductsYielding(products);
        this.productIndex = products;
        this.indexRefreshedAt = Date.now();
        this.metadata.lastSuccessfulSync = new Date(
          this.indexRefreshedAt,
        ).toISOString();
        this.queryCache.clear();
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

  private async fetchProductIndex(): Promise<ProviderProduct[]> {
    const feedUrl = safeHttpUrl(this.feedUrl);
    if (!feedUrl) throw new Error("AliExpress feed URL is not configured");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FEED_FETCH_TIMEOUT_MS);

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
        throw new Error(`AliExpress feed returned HTTP ${response.status}`);
      }

      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_FEED_BYTES) {
        throw new Error("AliExpress feed exceeds the maximum allowed size");
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("AliExpress feed returned an empty response");

      const decoder = new TextDecoder();
      let parser:
        | ReturnType<typeof createCsvRowParser>
        | undefined;
      let pending = "";
      let headers: string[] | undefined;
      const generalProducts: ProviderProduct[] = [];
      const electronicsProducts: Array<{ product: ProviderProduct; quality: number }> = [];
      let validRows = 0;
      let totalBytes = 0;
      let feedFullyScanned = true;
      let productLimitReached = false;

      const consumeRow = (row: string[]) => {
        if (!headers) {
          headers = row.map(normalizeHeader);
          return;
        }
        if (!row.some((value) => value.trim())) return;

        const record = Object.fromEntries(
          headers.map((header, index) => [
            header,
            row[index]?.trim() ?? "",
          ]),
        );
        const product = mapRecord(record, validRows);
        if (!product) return;
        validRows += 1;
        if (generalProducts.length < GENERAL_INDEX_LIMIT) {
          generalProducts.push(product);
          return;
        }
        if (electronicsProducts.length >= ELECTRONICS_INDEX_LIMIT) return;
        const quality = getElectronicsCategoryQuality(product);
        if (quality > 0 && matchesLuqtaCategory(product, "electronics")) {
          electronicsProducts.push({ product, quality });
        }
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value.byteLength;
          if (totalBytes > MAX_FEED_BYTES) {
            await reader.cancel();
            throw new Error("AliExpress feed exceeds the maximum allowed size");
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
          if (
            generalProducts.length >= GENERAL_INDEX_LIMIT &&
            (electronicsProducts.length >= ELECTRONICS_INDEX_LIMIT ||
              totalBytes >= MAX_CATEGORY_SCAN_BYTES)
          ) {
            productLimitReached =
              electronicsProducts.length >= ELECTRONICS_INDEX_LIMIT;
            feedFullyScanned = false;
            await reader.cancel();
            break;
          }

        }
      } catch (error) {
        if (!controller.signal.aborted || generalProducts.length === 0) throw error;
        feedFullyScanned = false;
        logger.warn(
          {
            providerId: this.metadata.id,
            indexedProductCount: generalProducts.length + electronicsProducts.length,
          },
          "Provider index refresh timed out; using collected products",
        );
      }

      if (parser) {
        const finalText = decoder.decode();
        if (finalText) parser.push(finalText);
        parser.finish();
      } else if (pending) {
        parser = createCsvRowParser(detectDelimiter(pending), consumeRow);
        parser.push(pending);
        parser.finish();
      }

      if (!generalProducts.length && !electronicsProducts.length) {
        throw new Error("AliExpress feed contained no valid products");
      }

      // A category-first pool prevents a sorted hot-products CSV from filling
      // the entire bounded index with apparel before electronics are reached.
      const products = [
        ...electronicsProducts.sort((a, b) => b.quality - a.quality).map(({ product }) => product),
        ...generalProducts,
      ];
      logger.info(
        {
          providerId: this.metadata.id,
          indexedProductCount: products.length,
          electronicsProductCount: electronicsProducts.length,
          bytesRead: totalBytes,
          feedFullyScanned,
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