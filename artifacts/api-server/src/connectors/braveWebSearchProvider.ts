import { createHash } from "node:crypto";
import { CacheService } from "./cacheService";
import { deterministicIntentParser } from "./intentParser";
import {
  MAX_EXTERNAL_RETRIEVAL_QUERIES,
  planRetrievalQueries,
} from "./retrievalQueryPlanner";
import { webPageQuality } from "./relevanceGate";
import {
  getBilingualShoppingConcepts,
  hasConfidentLouisVuittonShoppingContext,
  normalizeArabicForSearch,
} from "./queryExpansion";
import type {
  ProviderMetadata,
  ProviderProduct,
  ProviderSearchRequest,
  SearchProvider,
} from "./types";

const DEFAULT_CACHE_TTL_MS = 8 * 60 * 60 * 1_000;
const DEFAULT_TIMEOUT_MS = 4_000;
const MAX_RESULTS = 10;
export const MAX_RETRIEVAL_CANDIDATES = MAX_RESULTS * MAX_EXTERNAL_RETRIEVAL_QUERIES;
const BLOCKED_HOSTS = new Set([
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "pinterest.com",
  "reddit.com",
  "tiktok.com",
  "wikipedia.org",
  "x.com",
  "youtube.com",
]);
const NON_SHOPPING_TITLE =
  /\b(review|reviews|guide|news|reddit|forum|how to|what is|wikipedia|youtube)\b/iu;
const ESTABLISHED_RETAILERS = [
  "amazon.",
  "extra.com",
  "jarir.com",
  "namshi.com",
  "nike.",
  "noon.com",
  "sivvi.com",
  "sssports.com",
];

type BraveWebResult = {
  title?: string;
  url?: string;
  description?: string;
  thumbnail?: { src?: string };
};

type BraveResponse = {
  web?: { results?: BraveWebResult[] };
};

type FetchLike = typeof fetch;

export type BraveUsageMetrics = {
  braveRequests: number;
  braveCacheHits: number;
  braveFallbackTriggered: number;
};

function safeHttpUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

function normalizedHost(url: URL) {
  return url.hostname.toLocaleLowerCase().replace(/^www\./u, "");
}

function isBlockedHost(host: string) {
  return [...BLOCKED_HOSTS].some(
    (blocked) => host === blocked || host.endsWith(`.${blocked}`),
  );
}

function relevanceScore(result: BraveWebResult, query: string) {
  const tokens = normalizeArabicForSearch(query)
    .split(/\s+/u)
    .filter((token) => token.length > 1);
  if (!tokens.length) return 0.5;
  const surface = normalizeArabicForSearch(
    `${result.title ?? ""} ${result.description ?? ""} ${result.url ?? ""}`,
  );
  return tokens.filter((token) => surface.includes(token)).length / tokens.length;
}

function bestRelevanceScore(result: BraveWebResult, queries: string[]) {
  return Math.max(0, ...queries.map((query) => relevanceScore(result, query)));
}

function reliabilityScore(host: string) {
  if (ESTABLISHED_RETAILERS.some((domain) => host.includes(domain))) return 0.9;
  if (host.endsWith(".sa") || host.includes(".com.sa")) return 0.82;
  return 0.68;
}

function stableId(url: string) {
  return createHash("sha256").update(url).digest("hex").slice(0, 20);
}

// Deduplicate navigation/tracking aliases, not distinct SKU or size variants.
export function retrievalCandidateUrlKey(value: URL): string {
  const url = new URL(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/iu.test(key) || /^(?:gclid|fbclid|msclkid)$/iu.test(key)) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  return url.toString();
}

export function buildBraveShoppingQuery(query: string) {
  const queries = buildBraveShoppingQueries(query);
  return (
    queries.find(
      (variant) => /[a-z]/iu.test(variant) && !/[\u0600-\u06ff]/u.test(variant),
    ) ?? queries[0] ?? query.trim()
  );
}

export function buildBraveShoppingQueries(query: string) {
  const concepts = getBilingualShoppingConcepts(query);
  const louisVuittonContext = hasConfidentLouisVuittonShoppingContext(query);
  const appendSaudiRegion = (concept: string, arabic: boolean) => {
    if (/\b(saudi|ksa|sar)\b|السعود/iu.test(concept)) return concept;
    return arabic ? `${concept} السعودية` : `${concept} Saudi Arabia`;
  };
  const englishConcept =
    (louisVuittonContext &&
      concepts.english.find((concept) => /\bLouis Vuitton\b/iu.test(concept))) ||
    concepts.english.find((concept) => /[a-z]/iu.test(concept));
  const arabicConcept =
    (louisVuittonContext &&
      concepts.arabic.find((concept) =>
        /لويس\s+فيتون/u.test(normalizeArabicForSearch(concept)),
      )) ||
    concepts.arabic.find((concept) => /[\u0600-\u06ff]/u.test(concept));
  const queries = [
    englishConcept
      ? appendSaudiRegion(englishConcept, false)
      : undefined,
    arabicConcept
      ? appendSaudiRegion(arabicConcept, true)
      : undefined,
  ].filter((value): value is string => Boolean(value));

  return [...new Set(queries.map((value) => value.trim()).filter(Boolean))];
}

export class BraveWebSearchProvider implements SearchProvider {
  readonly metadata: ProviderMetadata = {
    id: "brave-web",
    name: "Brave Web Search",
    enabled: true,
    searchEnabled: true,
    affiliateEnabled: false,
    priceMonitoringAllowed: false,
    visualSearchAllowed: false,
    country: "SA",
    currency: "SAR",
    integrationType: "web_search",
    requiresCredentials: true,
    credentialRequirements: ["BRAVE_SEARCH_API_KEY"],
    priority: 1_000,
    lastSuccessfulSync: null,
    affiliateCapability: "not_applicable",
    priceMonitoringCapability: "disabled",
    integrationStatus: "ready",
  };

  private readonly cache: CacheService<ProviderProduct[]>;
  private readonly metrics: BraveUsageMetrics = {
    braveRequests: 0,
    braveCacheHits: 0,
    braveFallbackTriggered: 0,
  };

  constructor(
    private readonly apiKey = process.env.BRAVE_SEARCH_API_KEY,
    private readonly fetchImpl: FetchLike = fetch,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
    this.cache = new CacheService<ProviderProduct[]>(cacheTtlMs);
    this.metadata.enabled = Boolean(apiKey);
    this.metadata.searchEnabled = Boolean(apiKey);
    this.metadata.integrationStatus = apiKey ? "ready" : "disabled";
  }

  getUsageMetrics(): BraveUsageMetrics {
    return { ...this.metrics };
  }

  noteFallbackTriggered() {
    this.metrics.braveFallbackTriggered += 1;
  }

  async search(request: ProviderSearchRequest): Promise<ProviderProduct[]> {
    if (!this.apiKey || request.imageUri) return [];

    const query = request.intent?.raw?.trim() || request.query.trim();
    const parsedIntent = await deterministicIntentParser.parse(query);
    const suppliedIntent = Object.fromEntries(
      Object.entries(request.intent ?? {}).filter(([, value]) => value !== undefined),
    );
    const intent = { ...parsedIntent, ...suppliedIntent };
    const concepts = getBilingualShoppingConcepts(query);
    const queries = planRetrievalQueries(query, intent)
      .slice(0, MAX_EXTERNAL_RETRIEVAL_QUERIES);
    if (!queries.length) return [];
    const relevanceQueries = [
      ...concepts.arabic,
      ...concepts.english,
      request.query,
    ];
    const cacheKey = "retrieval-v2.2:" + queries
      .map(normalizeArabicForSearch)
      .sort()
      .join("|");
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.metrics.braveCacheHits += 1;
      return cached;
    }

    const resultSets = await Promise.all(
      queries.map(async (searchQuery): Promise<BraveWebResult[]> => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        this.metrics.braveRequests += 1;
        try {
          const url = new URL("https://api.search.brave.com/res/v1/web/search");
          url.searchParams.set("q", searchQuery);
          url.searchParams.set("country", "SA");
          url.searchParams.set("count", String(MAX_RESULTS));
          url.searchParams.set("safesearch", "moderate");

          const response = await this.fetchImpl(url, {
            redirect: "error",
            headers: {
              Accept: "application/json",
              "X-Subscription-Token": this.apiKey,
            },
            signal: controller.signal,
          });
          if (!response.ok) return [];

          const payload = (await response.json()) as BraveResponse;
          return (payload.web?.results ?? []).slice(0, MAX_RESULTS);
        } catch {
          return [];
        } finally {
          clearTimeout(timeout);
        }
      }),
    );

    const updatedAt = new Date().toISOString();
    const productsByUrl = new Map<string, ProviderProduct>();
    for (const result of resultSets.flat()) {
      const productUrl = safeHttpUrl(result.url);
      const title = result.title?.trim();
      if (!productUrl || !title) continue;

      const merchant = normalizedHost(productUrl);
      const matchScore = bestRelevanceScore(result, relevanceQueries);
      if (
        isBlockedHost(merchant) ||
        NON_SHOPPING_TITLE.test(title) ||
        matchScore < 0.2
      ) {
        continue;
      }

      const url = productUrl.toString();
      const urlKey = retrievalCandidateUrlKey(productUrl);
      const candidate: ProviderProduct = {
        id: `brave-${stableId(urlKey)}`,
        title,
        description: result.description?.trim() || undefined,
        productUrl: url,
        affiliateUrl: null,
        imageUrl: safeHttpUrl(result.thumbnail?.src)?.toString(),
        currency: "SAR",
        merchant,
        availability: "unknown",
        source: "brave_web",
        sourceType: "web",
        updatedAt,
        exactMatchScore: matchScore,
        reliabilityScore: reliabilityScore(merchant),
      };
      const existing = productsByUrl.get(urlKey);
      // Keep one coherent snippet; do not combine conflicting variant evidence.
      const preferExisting = existing && (
        webPageQuality(existing) < webPageQuality(candidate) ||
        (webPageQuality(existing) === webPageQuality(candidate) &&
          (existing.exactMatchScore ?? 0) >= matchScore)
      );
      const winner = preferExisting ? existing : candidate;
      productsByUrl.set(
        urlKey,
        winner,
      );
    }

    const products = [...productsByUrl.values()]
      .sort(
        (left, right) =>
          webPageQuality(left) - webPageQuality(right) ||
          (right.exactMatchScore ?? 0) - (left.exactMatchScore ?? 0) ||
          (right.reliabilityScore ?? 0) - (left.reliabilityScore ?? 0),
      )
      .slice(0, MAX_RETRIEVAL_CANDIDATES);
    this.cache.set(cacheKey, products);
    return products;
  }
}