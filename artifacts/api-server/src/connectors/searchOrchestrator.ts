import { AffiliateLinkService } from "./affiliateLinkService";
import { BraveWebSearchProvider } from "./braveWebSearchProvider";
import { CacheService } from "./cacheService";
import {
  getCategoryFilterFacets,
  getCategoryFilterIds,
  getCategoryFilterSelectionIds,
  getCategoryFilters,
  getCategoryState,
  getCategoryDefinition,
  matchesLuqtaCategory,
  type CategoryFacet,
  type CategoryState,
} from "./categoryTaxonomy";
import { DeduplicationService } from "./deduplicationService";
import {
  deterministicIntentParser,
  type AIIntentParser,
} from "./intentParser";
import { ProviderRegistry } from "./providerRegistry";
import { RankingService } from "./rankingService";
import {
  expandShoppingQuery,
  getShoppingVocabularyAliases,
  normalizeArabicForSearch,
  type SearchQueryExpansion,
} from "./queryExpansion";
import { ResultNormalizer } from "./resultNormalizer";
import type {
  NormalizedProduct,
  ProviderCategorySearchResult,
  ProviderIndexReadiness,
  ProviderProduct,
  ProviderSearchRequest,
  QueryIntent,
} from "./types";

export type SearchStageLogger = (
  stage: string,
  details?: Record<string, unknown>,
) => void;

export type SearchTimeouts = {
  providerSearchMs: number;
  intentParserMs: number;
  braveSearchMs: number;
  indexReadinessMs?: number;
};

const DEFAULT_SEARCH_TIMEOUTS: SearchTimeouts = {
  providerSearchMs: 1_200,
  intentParserMs: 300,
  braveSearchMs: 4_500,
};

class SearchStageTimeoutError extends Error {
  constructor(
    readonly stage: string,
    readonly timeoutMs: number,
  ) {
    super(`${stage} timed out after ${timeoutMs}ms`);
    this.name = "SearchStageTimeoutError";
  }
}

export class InventoryUnavailableError extends Error {
  constructor(readonly providerIds: string[]) {
    super("Product inventory is still warming or temporarily unavailable");
    this.name = "InventoryUnavailableError";
  }
}

function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  stage: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new SearchStageTimeoutError(stage, timeoutMs)),
      timeoutMs,
    );
  });

  return Promise.race([Promise.resolve().then(operation), timeout]).finally(
    () => {
      if (timer) clearTimeout(timer);
    },
  );
}

function safeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Unknown provider error";
  return error.message
    .replace(/https?:\/\/[^\s)]+/giu, "[url]")
    .slice(0, 180);
}

type ProviderStageResult = {
  providerId: string;
  products: NormalizedProduct[];
  categoryResult?: ProviderCategorySearchResult;
  readiness: ProviderIndexReadiness | null;
  durationMs: number;
  timedOut: boolean;
  errorType?: string;
  errorMessage?: string;
};

export type SearchOrchestrationResult = {
  products: NormalizedProduct[];
  categoryState?: CategoryState;
  categoryInventoryCount?: number;
  categoryFilters?: CategoryFacet[];
  total?: number;
  page?: number;
  pageSize?: number;
  hasMore?: boolean;
  structuredIntent?: ProviderSearchRequest["intent"];
  exactMatches?: number;
  constraintRelaxationAvailable?: boolean;
  strongInternalMatchCount?: number;
  fallbackStatus?: "not_needed" | "unavailable" | "empty" | "used";
  __timings?: {
    providerStageMs: number;
    categoryFilterMs: number;
    sortingDeduplicationMs: number;
    rankingMs: number;
    providerTimings: Array<{
      providerId: string;
      readinessWaitMs: number;
      categoryIndexMs: number;
      facetLookupMs: number;
      ready: boolean | null;
      indexedProductCount: number | null;
      refreshing: boolean | null;
      lastSuccessfulSync: string | null;
      resultCount: number;
      durationMs: number;
      timedOut: boolean;
      errorType?: string;
      errorMessage?: string;
    }>;
  };
};

function calculateSurfaceMatchScore(product: ProviderProduct, query: string) {
  const tokens = query
    .toLocaleLowerCase()
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter(Boolean);
  if (!tokens.length) return 0.5;

  const surface = [
    product.title,
    product.category,
    product.brand,
    product.merchant,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
  return tokens.filter((token) => surface.includes(token)).length / tokens.length;
}

function calculateProductTermScore(
  product: ProviderProduct,
  productTerms: string[],
) {
  if (!productTerms.length) return undefined;
  const surface = [product.title, product.category]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
  return productTerms.some((term) => surface.includes(term.toLocaleLowerCase()))
    ? 1
    : 0;
}

type SearchQuality = {
  rawResultCount: number;
  stronglyRelevantCount: number;
  topStronglyRelevantCount: number;
  triggerReasons: string[];
  relevantResults: NormalizedProduct[];
};

function buildIndexedCategoryFacets(
  category: NonNullable<ProviderSearchRequest["category"]>,
  facetCounts: Record<string, number>,
): CategoryFacet[] {
  return getCategoryFilters(category)
    .map((filter) => ({
      id: filter.id,
      label: filter.label,
      count: facetCounts[filter.id] ?? 0,
      level: filter.level ?? 0,
      ...(filter.parentId ? { parentId: filter.parentId } : {}),
    }))
    .filter((filter) => filter.count >= 2);
}

const SEARCH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "arabia",
  "for",
  "in",
  "ksa",
  "men",
  "mens",
  "new",
  "of",
  "on",
  "saudi",
  "the",
  "to",
  "used",
  "women",
  "womens",
  "under",
  "below",
  "less",
  "than",
  "sar",
  "riyal",
  "riyals",
  "اقل",
  "من",
  "دون",
  "تحت",
  "ريال",
  "السعودية",
]);

const PRODUCT_TERM_GROUPS = [
  ["watch", "watches", "wristwatch", "wristwatches", "ساعه", "ساعات"],
  ["headlight", "headlights", "headlamp", "headlamps", "شمعة", "شمعه", "شمعات"],
  ["headphones", "headphone", "earphones", "earphone", "headset", "سماعه", "سماعات"],
  ["dress", "dresses", "فستان", "فساتين"],
  ["shirt", "shirts", "tshirt", "t-shirt", "tee", "قميص", "قمصان", "تيشيرت"],
  ["shoes", "shoe", "sneakers", "حذاء", "احذيه", "جزم", "جزمه"],
  ["jeans", "jean", "denim", "جينز"],
  ["handbag", "handbags", "bag", "bags", "purse", "شنطه", "حقيبه", "شنط", "حقائب"],
  ["perfume", "fragrance", "cologne", "parfum", "cosmetics", "عطر", "عطور"],
  ["phone", "smartphone", "mobile", "جوال", "موبايل", "هاتف"],
  ["laptop", "notebook", "لابتوب", "حاسوب"],
  ["television", "tv", "display", "تلفزيون", "شاشه"],
  ["chair", "chairs", "كرسي", "كراسي"],
  ["table", "desk", "طاولة", "طاوله"],
  ["sofa", "couch", "كنبه", "اريكه"],
  ["tire", "tyre", "كفر", "اطار"],
].map((terms) => new Set(terms.map(compactSearchToken)));

const ATTRIBUTE_GROUPS = [
  ["black", "اسود", "سوداء", "سودا"],
  ["white", "ابيض", "بيضاء"],
  ["navy", "navyblue", "كحلي"],
  ["brown", "بني"],
  ["red", "احمر", "حمراء"],
  ["blue", "ازرق", "زرقاء"],
  ["green", "اخضر", "خضراء"],
  ["leather", "جلد"],
  ["authentic", "original", "genuine", "oem", "اصلي", "اصليه", "اصلية", "وكاله"],
  ["used", "preowned", "مستعمل", "refurbished"],
  ["new", "جديد", "جديده"],
  ["men", "mens", "male", "رجالي", "رجاليه", "رجال"],
  ["women", "womens", "female", "نسائي", "نسائيه", "نساء", "حريمي"],
  ["boys", "boy", "ولادي", "اولاد"],
  ["girls", "girl", "بناتي", "بنات"],
  ["kids", "children", "اطفال"],
].map((terms) => new Set(terms.map(compactSearchToken)));

const ARABIC_QUALITY_TRANSLATIONS = new Map([
  ["ساعه", "watch"],
  ["ساعة", "watch"],
  ["ساعات", "watch"],
  ["رجالي", "men"],
  ["رجال", "men"],
  ["رجاليه", "men"],
  ["رجالية", "men"],
  ["اسود", "black"],
  ["أسود", "black"],
  ["سوداء", "black"],
  ["شمعة", "headlight"],
  ["شمعه", "headlight"],
  ["شمعات", "headlight"],
  ["كامري", "camry"],
  ["تويوتا", "toyota"],
]);

function searchTokens(value: string) {
  return normalizeArabicForSearch(value)
    .split(/[\s/_,;:()[\]{}]+/u)
    .map((token) => token.replace(/[^\p{L}\p{N}-]/gu, ""))
    .filter(Boolean);
}

function compactSearchToken(value: string) {
  return normalizeArabicForSearch(value).replace(/[^\p{L}\p{N}]/gu, "");
}

function buildQualityTranslation(query: string) {
  return searchTokens(query)
    .map((token) => ARABIC_QUALITY_TRANSLATIONS.get(token) ?? token)
    .join(" ");
}

function surfaceMatchesTerm(surfaceTokens: Set<string>, term: string) {
  const normalizedTerm = compactSearchToken(term);
  return Boolean(
    normalizedTerm &&
      (surfaceTokens.has(normalizedTerm) ||
        [...surfaceTokens].some((token) =>
          token.split("-").includes(normalizedTerm),
        )),
  );
}

function groupMatchesSurface(surfaceTokens: Set<string>, group: Set<string>) {
  return [...group].some((term) => surfaceMatchesTerm(surfaceTokens, term));
}

type QualityAlternative = {
  identityTerms: string[];
  productGroups: Set<string>[];
  attributeGroups: Set<string>[];
  yearTerms: string[];
};

type QualityConstraints = {
  alternatives: QualityAlternative[];
  identityTerms: string[];
  productGroups: Set<string>[];
  requiredIdentityAlternatives: string[][];
  requiredProductGroups: Set<string>[];
  requiredProductTerms: string[];
  requiredAttributeGroups: Set<string>[];
  requiredAttributeTerms: string[];
  requiredYearTerms: string[];
  requiredExactTerms: string[];
  intent?: QueryIntent;
};

function matchingTermGroup(value: string, groups: Set<string>[]) {
  const tokens = searchTokens(value).map(compactSearchToken);
  return groups.find((group) => tokens.some((token) => group.has(token)));
}

function uniqueGroups(groups: Set<string>[]) {
  const seen = new Set<string>();
  return groups.filter((group) => {
    const key = [...group].sort().join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildQualityConstraints(
  queryExpansion: SearchQueryExpansion,
  intent?: QueryIntent,
): QualityConstraints {
  const qualityVariants = [
    ...queryExpansion.variants,
    buildQualityTranslation(queryExpansion.normalizedQuery),
  ].filter(Boolean);
  const alternatives = [...new Set(qualityVariants)].map((variant) => {
    const allTokens = new Set(
      searchTokens(variant).map(compactSearchToken).filter(Boolean),
    );
    const productGroups = PRODUCT_TERM_GROUPS.filter((group) =>
      [...group].some((term) => allTokens.has(term)),
    );
    const attributeGroups = ATTRIBUTE_GROUPS.filter((group) =>
      [...group].some((term) => allTokens.has(term)),
    );
    const yearTerms = [...allTokens].filter((token) => /^\d{4}$/u.test(token));
    const identityTerms = [...allTokens].filter((token) => {
      return (
        token.length >= 3 &&
        !SEARCH_STOP_WORDS.has(token) &&
        !/^\d+$/u.test(token) &&
        !yearTerms.includes(token) &&
        !productGroups.some((group) => group.has(token)) &&
        !attributeGroups.some((group) => group.has(token))
      );
    });

    return { identityTerms, productGroups, attributeGroups, yearTerms };
  });

  const requiredProductGroups: Set<string>[] = [];
  const requiredProductTerms: string[] = [];
  for (const value of [intent?.productType, intent?.partName].filter(
    (item): item is string => Boolean(item?.trim()),
  )) {
    const group = matchingTermGroup(value, PRODUCT_TERM_GROUPS);
    if (group) requiredProductGroups.push(group);
    else requiredProductTerms.push(...searchTokens(value).map(compactSearchToken));
  }

  const requiredAttributeGroups: Set<string>[] = [];
  const requiredAttributeTerms: string[] = [];
  const explicitAttributes = [
    intent?.color,
    intent?.audience,
    intent?.condition && intent.condition !== "unknown"
      ? intent.condition
      : undefined,
    intent?.newOrUsed && intent.newOrUsed !== "unknown"
      ? intent.newOrUsed
      : undefined,
    ...(intent?.keywords ?? []),
  ].filter((item): item is string => Boolean(item?.trim()));
  for (const value of explicitAttributes) {
    const group = matchingTermGroup(value, ATTRIBUTE_GROUPS);
    if (group) requiredAttributeGroups.push(group);
    else if (
      value === intent?.color ||
      value === intent?.audience ||
      value === intent?.condition ||
      value === intent?.newOrUsed
    ) {
      requiredAttributeTerms.push(...searchTokens(value).map(compactSearchToken));
    }
  }

  const vehicleIdentity =
    intent?.vehicleModel?.trim() || intent?.vehicleMake?.trim();

  return {
    alternatives,
    identityTerms: [...new Set(alternatives.flatMap((item) => item.identityTerms))],
    productGroups: alternatives.flatMap((item) => item.productGroups),
    requiredIdentityAlternatives: vehicleIdentity
      ? [getShoppingVocabularyAliases(vehicleIdentity)]
      : [],
    requiredProductGroups: uniqueGroups(requiredProductGroups),
    requiredProductTerms: [...new Set(requiredProductTerms)],
    requiredAttributeGroups: uniqueGroups(requiredAttributeGroups),
    requiredAttributeTerms: [...new Set(requiredAttributeTerms)],
    requiredYearTerms: intent?.vehicleYear ? [intent.vehicleYear] : [],
    requiredExactTerms: [intent?.partNumber, intent?.oemNumber].filter(
      (item): item is string => Boolean(item?.trim()),
    ),
    intent,
  };
}

function phraseMatchesSurface(surfaceTokens: Set<string>, phrase: string) {
  const terms = searchTokens(phrase).map(compactSearchToken).filter(Boolean);
  return (
    terms.length > 0 &&
    terms.every((term) => surfaceMatchesTerm(surfaceTokens, term))
  );
}

function matchesExplicitIntent(
  result: ProviderProduct,
  constraints: QualityConstraints,
) {
  const intent = constraints.intent;
  if (!intent) return true;

  const labelSurface = [
    result.title,
    result.category,
    result.brand,
  ]
    .filter(Boolean)
    .join(" ");
  const fullSurface = [
    result.title,
    result.description,
    result.category,
    result.brand,
  ]
    .filter(Boolean)
    .join(" ");
  const labelTokens = new Set(
    searchTokens(labelSurface).map(compactSearchToken),
  );
  const fullTokens = new Set(
    searchTokens(fullSurface).map(compactSearchToken),
  );

  if (intent.brand) {
    const brandAliases = getShoppingVocabularyAliases(intent.brand);
    const brandMatches = brandAliases.some((alias) =>
      phraseMatchesSurface(labelTokens, alias),
    );
    const structuredBrandMatches = result.brand
      ? brandAliases.some((alias) =>
          phraseMatchesSurface(
            new Set(searchTokens(result.brand!).map(compactSearchToken)),
            alias,
          ),
        )
      : brandMatches;
    if (!brandMatches || !structuredBrandMatches) return false;
  }
  if (
    !constraints.requiredIdentityAlternatives.every((alternatives) =>
      alternatives.some((phrase) => phraseMatchesSurface(labelTokens, phrase)),
    )
  ) {
    return false;
  }
  if (
    !constraints.requiredProductGroups.every((group) =>
      groupMatchesSurface(labelTokens, group),
    ) ||
    !constraints.requiredProductTerms.every((term) =>
      surfaceMatchesTerm(labelTokens, term),
    )
  ) {
    return false;
  }
  if (
    !constraints.requiredAttributeGroups.every((group) =>
      groupMatchesSurface(labelTokens, group),
    ) ||
    !constraints.requiredAttributeTerms.every((term) =>
      surfaceMatchesTerm(labelTokens, term),
    )
  ) {
    return false;
  }
  if (
    !constraints.requiredYearTerms.every((year) =>
      surfaceMatchesTerm(labelTokens, year),
    ) ||
    !constraints.requiredExactTerms.every((term) =>
      fullSurface.toLocaleLowerCase().includes(term.toLocaleLowerCase()),
    )
  ) {
    return false;
  }

  const oppositeAudience: Partial<
    Record<NonNullable<QueryIntent["audience"]>, Set<string>>
  > = {
    men: matchingTermGroup("women", ATTRIBUTE_GROUPS),
    women: matchingTermGroup("men", ATTRIBUTE_GROUPS) ?? new Set<string>(),
    boys: matchingTermGroup("girls", ATTRIBUTE_GROUPS) ?? new Set<string>(),
    girls: matchingTermGroup("boys", ATTRIBUTE_GROUPS) ?? new Set<string>(),
  };
  const contradictoryAudience = intent.audience
    ? oppositeAudience[intent.audience]
    : undefined;
  if (
    contradictoryAudience &&
    groupMatchesSurface(labelTokens, contradictoryAudience)
  ) {
    return false;
  }

  return true;
}

function resultMatchesConstraints(
  result: ProviderProduct,
  constraints: QualityConstraints,
) {
  const surfaceTokens = new Set(
    searchTokens(
      [
        result.title,
        result.description,
        result.category,
        result.brand,
        result.merchant,
      ]
        .filter(Boolean)
        .join(" "),
    ).map(compactSearchToken),
  );
  return {
    isStrong:
      matchesExplicitIntent(result, constraints) &&
      constraints.alternatives.some((alternative) => {
        const identityIsStrong = alternative.identityTerms.every((term) =>
          surfaceMatchesTerm(surfaceTokens, term),
        );
        const yearIsStrong = alternative.yearTerms.every((term) =>
          surfaceMatchesTerm(surfaceTokens, term),
        );
        const productMatches = alternative.productGroups.filter((group) =>
          groupMatchesSurface(surfaceTokens, group),
        );
        const attributeMatches = alternative.attributeGroups.filter((group) =>
          groupMatchesSurface(surfaceTokens, group),
        );
        const productIsStrong =
          alternative.productGroups.length === 0 ||
          productMatches.length === alternative.productGroups.length;
        const attributesAreStrong =
          alternative.attributeGroups.length === 0 ||
          attributeMatches.length >=
            Math.ceil(alternative.attributeGroups.length * 0.5);

        return (
          identityIsStrong &&
          yearIsStrong &&
          productIsStrong &&
          attributesAreStrong
        );
      }),
  };
}

export function filterExplicitIntentResults(
  results: NormalizedProduct[],
  queryExpansion: SearchQueryExpansion,
  intent?: QueryIntent,
) {
  const constraints = buildQualityConstraints(queryExpansion, intent);
  return results.filter((result) =>
    matchesExplicitIntent(result, constraints),
  );
}

function hasStrictPriceConstraint(intent?: QueryIntent) {
  return (
    Number.isFinite(intent?.minPrice) ||
    Number.isFinite(intent?.maxPrice)
  );
}

function normalizeCurrencyCode(currency: string | null | undefined) {
  const normalized = currency?.trim().toLocaleUpperCase();
  if (!normalized) return undefined;
  if (["SAR", "ر.س", "ريال", "ريال سعودي", "SAUDI RIYAL"].includes(normalized)) {
    return "SAR";
  }
  if (["USD", "US$", "$", "US DOLLAR", "DOLLAR"].includes(normalized)) {
    return "USD";
  }
  if (["AED", "درهم", "درهم اماراتي", "UAE DIRHAM"].includes(normalized)) {
    return "AED";
  }
  if (["KWD", "دينار كويتي", "KUWAITI DINAR"].includes(normalized)) {
    return "KWD";
  }
  if (["BHD", "دينار بحريني", "BAHRAINI DINAR"].includes(normalized)) {
    return "BHD";
  }
  if (["EUR", "€", "EURO"].includes(normalized)) return "EUR";
  if (["GBP", "£", "POUND STERLING"].includes(normalized)) return "GBP";
  return normalized;
}

export function filterStrictPriceResults(
  products: NormalizedProduct[],
  intent?: QueryIntent,
) {
  if (!hasStrictPriceConstraint(intent)) return products;
  const targetCurrency = normalizeCurrencyCode(intent?.currency ?? "SAR");
  if (!targetCurrency) return [];
  return products.filter((product) => {
    const price = product.price;
    const currency = normalizeCurrencyCode(product.currency);
    if (
      price === null ||
      price === undefined ||
      !Number.isFinite(price) ||
      !currency ||
      currency !== targetCurrency
    ) {
      return false;
    }
    return (
      (intent?.minPrice === undefined || price >= intent.minPrice) &&
      (intent?.maxPrice === undefined || price <= intent.maxPrice)
    );
  });
}

export function assessSearchQuality(
  results: NormalizedProduct[],
  queryExpansion: SearchQueryExpansion,
  intent?: QueryIntent,
): SearchQuality {
  const constraints = buildQualityConstraints(queryExpansion, intent);
  const relevantResults = results.filter((result) =>
    resultMatchesConstraints(result, constraints).isStrong,
  );
  const topResults = results.slice(0, 10);
  const topStronglyRelevantCount = topResults.filter((result) =>
    resultMatchesConstraints(result, constraints).isStrong,
  ).length;
  const triggerReasons: string[] = [];

  if (results.length === 0) triggerReasons.push("zero_internal_results");
  if (relevantResults.length < 5) {
    triggerReasons.push("fewer_than_five_strong_matches");
  }
  if (
    constraints.identityTerms.length > 0 &&
    topStronglyRelevantCount < Math.ceil(Math.min(5, topResults.length) * 0.6)
  ) {
    triggerReasons.push("strong_identity_constraints_missing");
  }
  if (
    constraints.productGroups.length > 0 &&
    topStronglyRelevantCount < Math.ceil(Math.min(5, topResults.length) * 0.6)
  ) {
    triggerReasons.push("product_type_constraints_missing");
  }
  if (
    topResults.length > 0 &&
    topStronglyRelevantCount / topResults.length < 0.5
  ) {
    triggerReasons.push("top_result_relevance_below_threshold");
  }

  return {
    rawResultCount: results.length,
    stronglyRelevantCount: relevantResults.length,
    topStronglyRelevantCount,
    triggerReasons: [...new Set(triggerReasons)],
    relevantResults,
  };
}

export class SearchOrchestrator {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly normalizer = new ResultNormalizer(),
    private readonly deduplication = new DeduplicationService(),
    private readonly ranking = new RankingService(),
    private readonly affiliateLinks = new AffiliateLinkService(),
    private readonly cache = new CacheService<SearchOrchestrationResult>(),
    private readonly webFallback?: BraveWebSearchProvider,
    private readonly intentParser: AIIntentParser = deterministicIntentParser,
    private readonly timeouts: SearchTimeouts = DEFAULT_SEARCH_TIMEOUTS,
  ) {}

  async search(request: ProviderSearchRequest): Promise<NormalizedProduct[]> {
    return (await this.searchWithMetadata(request)).products;
  }

  async searchWithMetadata(
    request: ProviderSearchRequest,
    trace?: SearchStageLogger,
  ): Promise<SearchOrchestrationResult> {
    const pipelineStartedAt = performance.now();
    const emit = (stage: string, details: Record<string, unknown> = {}) => {
      trace?.(stage, {
        elapsedMs: Number((performance.now() - pipelineStartedAt).toFixed(2)),
        ...details,
      });
    };
    emit("normalization_start");
    const categoryBrowse = Boolean(
      request.category && request.searchMode !== "intent",
    );
    const categoryDefinition = request.category
      ? categoryBrowse
        ? getCategoryDefinition(request.category)
        : undefined
      : undefined;
    const queryExpansion = categoryDefinition
      ? {
          originalQuery: request.query,
          normalizedQuery: request.query,
          variants: [...categoryDefinition.searchTerms],
          productTerms: [],
        }
      : expandShoppingQuery(request.query);
    emit("normalization_end", {
      categoryBrowse,
      queryVariantCount: categoryDefinition
        ? categoryDefinition.searchTerms.length
        : queryExpansion.variants.length,
    });
    const categoryPage = Math.max(1, Math.floor(request.page ?? 1));
    const categoryPageSize = Math.min(
      24,
      Math.max(1, Math.floor(request.pageSize ?? 24)),
    );
    const cacheKey = JSON.stringify({
      query: queryExpansion.originalQuery.trim().toLocaleLowerCase(),
      category: request.category,
      categoryFilterId: request.categoryFilterId,
      page: request.page,
      pageSize: request.pageSize,
      searchMode: request.searchMode,
      imageUri: request.imageUri,
      preferredProviderIds: request.preferredProviderIds
        ? [...request.preferredProviderIds].sort()
        : undefined,
      intent: request.intent,
    });
    const cached = this.cache.get(cacheKey);
    if (cached) {
      emit("cache_hit", { resultCount: cached.products.length });
      return cached;
    }

    const providers = this.registry
      .getSearchProviders(request.preferredProviderIds)
      .filter(
        (provider) =>
          provider.metadata.integrationType !== "mock_local" &&
          (!request.category ||
            !categoryBrowse ||
            provider.metadata.integrationType !== "web_search"),
      );
    // An Autoscale worker has its own index. Keep cold requests attached to
    // the existing single-flight imports, but never wait past the mobile SLA.
    const coldProviders = providers.filter(
      (provider) => provider.getSearchIndexReadiness?.().ready === false,
    );
    if (coldProviders.length) {
      const startedAt = performance.now();
      emit("index_wait_start", {
        providerIds: coldProviders.map((provider) => provider.metadata.id),
      });
      const imports = coldProviders.map(async (provider) => {
        try {
          await (provider.ensureSearchIndexReady?.() ?? provider.refreshIndex?.(false));
        } catch (error) {
          emit("index_recovery_failed", {
            providerId: provider.metadata.id,
            errorType: error instanceof Error ? error.name : "UnknownError",
          });
        }
      });
      try {
        await withTimeout(
          () => Promise.all(imports),
          this.timeouts.indexReadinessMs ?? (categoryBrowse ? 12_000 : 3_000),
          "index_readiness",
        );
      } catch (error) {
        emit("index_wait_timeout", {
          errorType: error instanceof Error ? error.name : "UnknownError",
        });
      }
      emit("index_wait_end", {
        durationMs: Number((performance.now() - startedAt).toFixed(2)),
        unreadyProviderIds: coldProviders
          .filter((provider) => provider.getSearchIndexReadiness?.().ready === false)
          .map((provider) => provider.metadata.id),
      });
    }
    // Do not start a search against an index that is still cold. In
    // particular, fallback results cannot certify incomplete feed inventory.
    const stillUnready = providers
      .filter((provider) => provider.getSearchIndexReadiness?.().ready === false)
      .map((provider) => provider.metadata.id);
    if (stillUnready.length) {
      emit("inventory_unavailable", { providerIds: stillUnready });
      throw new InventoryUnavailableError(stillUnready);
    }
    let parsedIntent: ProviderSearchRequest["intent"] = {};
    if (!categoryBrowse) {
      const intentStartedAt = performance.now();
      emit("intent_parse_start");
      try {
        parsedIntent = await withTimeout(
          () => this.intentParser.parse(request.query),
          this.timeouts.intentParserMs,
          "intent_parser",
        );
        emit("intent_parse_end", {
          durationMs: Number((performance.now() - intentStartedAt).toFixed(2)),
        });
      } catch (error) {
        emit(
          error instanceof SearchStageTimeoutError
            ? "intent_parse_timeout"
            : "intent_parse_error",
          {
            durationMs: Number((performance.now() - intentStartedAt).toFixed(2)),
            errorType: error instanceof Error ? error.name : "UnknownError",
          },
        );
        try {
          parsedIntent = await withTimeout(
            () => deterministicIntentParser.parse(request.query),
            this.timeouts.intentParserMs,
            "deterministic_intent_parser",
          );
        } catch {
          parsedIntent = {
            raw: request.query,
            normalized: queryExpansion.normalizedQuery,
          };
        }
      }
    }
    const suppliedIntent = Object.fromEntries(
      Object.entries(request.intent ?? {}).filter(([, value]) => value !== undefined),
    );
    const sharedIntent = {
      ...parsedIntent,
      ...suppliedIntent,
      raw: request.intent?.raw ?? queryExpansion.originalQuery,
      normalized:
        request.intent?.normalized ??
        parsedIntent?.normalized ??
        queryExpansion.normalizedQuery,
      category:
        request.category ??
        request.intent?.category ??
        parsedIntent?.category,
    };
    const searchQueries = categoryBrowse
      ? [queryExpansion.normalizedQuery]
      : queryExpansion.variants;
    const hasTranslatedVariants = searchQueries.some((query) =>
      /[a-z]/iu.test(query),
    );
    emit("provider_stage_start", {
      providerCount: providers.length,
      categoryBrowse,
      queryVariantCount: searchQueries.length,
    });
    const providerStageStartedAt = performance.now();
    const providerResults = await Promise.all(
      providers.map(async (provider): Promise<ProviderStageResult> => {
        const initialReadiness =
          provider.getSearchIndexReadiness?.() ?? null;
        const providerStartedAt = performance.now();
        emit("provider_search_start", {
          providerId: provider.metadata.id,
          indexReadiness:
            initialReadiness ?? { applicable: false, reason: "not_indexed" },
        });

        try {
          const result = await withTimeout(
            async () => {
              if (
                categoryBrowse &&
                request.category &&
                provider.searchCategory
              ) {
                const categoryResult = await provider.searchCategory({
                  ...request,
                  page: 1,
                  pageSize: categoryPage * categoryPageSize,
                  query: queryExpansion.normalizedQuery,
                  intent: sharedIntent,
                });
                const products = categoryResult.products.map((item) => ({
                  ...item,
                  exactMatchScore: (() => {
                    const baseScore = item.exactMatchScore ?? 0.5;
                    const surfaceScore = calculateSurfaceMatchScore(
                      item,
                      queryExpansion.normalizedQuery,
                    );
                    return baseScore * 0.85 + surfaceScore * 0.15;
                  })(),
                }));
                return {
                  products: products.map((item) =>
                    this.normalizer.normalize(item, provider.metadata),
                  ),
                  categoryResult,
                };
              }

              const variantResults = await Promise.all(
                searchQueries.map(async (query, variantIndex) => {
                  const results = await provider.search({
                    ...request,
                    query,
                    intent: sharedIntent,
                  });
                  const translatedVariantIndex = searchQueries
                    .slice(0, variantIndex)
                    .filter((variant) => /[a-z]/iu.test(variant)).length;
                  const variantWeight =
                    hasTranslatedVariants && !/[a-z]/iu.test(query)
                      ? 0.9
                      : Math.max(0.95, 1 - translatedVariantIndex * 0.01);
                  return results.map((item) => ({
                    ...item,
                    exactMatchScore: (() => {
                      const baseScore =
                        (item.exactMatchScore ?? 0.5) * variantWeight;
                      const surfaceScore = calculateSurfaceMatchScore(
                        item,
                        query,
                      );
                      const productTermScore = calculateProductTermScore(
                        item,
                        queryExpansion.productTerms,
                      );
                      return productTermScore === undefined
                        ? baseScore * 0.85 + surfaceScore * 0.15
                        : baseScore * 0.7 +
                            surfaceScore * 0.15 +
                            productTermScore * 0.15;
                    })(),
                  }));
                }),
              );
              return {
                products: variantResults
                  .flat()
                  .map((item) =>
                    this.normalizer.normalize(item, provider.metadata),
                  ),
              };
            },
            this.timeouts.providerSearchMs,
            `provider:${provider.metadata.id}`,
          );
          const durationMs = performance.now() - providerStartedAt;
          const readiness =
            provider.getSearchIndexReadiness?.() ?? initialReadiness;
          emit("provider_search_end", {
            providerId: provider.metadata.id,
            durationMs: Number(durationMs.toFixed(2)),
            resultCount: result.products.length,
            timedOut: false,
            errorType: null,
            indexReadiness:
              readiness ?? { applicable: false, reason: "not_indexed" },
            categoryReady: result.categoryResult?.ready ?? null,
          });
          return {
            providerId: provider.metadata.id,
            products: result.products,
            categoryResult: result.categoryResult,
            readiness,
            durationMs,
            timedOut: false,
          };
        } catch (error) {
          const durationMs = performance.now() - providerStartedAt;
          const timedOut = error instanceof SearchStageTimeoutError;
          const errorType =
            error instanceof Error ? error.name : "UnknownError";
          const errorMessage = safeErrorMessage(error);
          const readiness =
            provider.getSearchIndexReadiness?.() ?? initialReadiness;
          emit("provider_search_end", {
            providerId: provider.metadata.id,
            durationMs: Number(durationMs.toFixed(2)),
            resultCount: 0,
            timedOut,
            errorType,
            errorMessage,
            indexReadiness:
              readiness ?? { applicable: false, reason: "not_indexed" },
          });
          return {
            providerId: provider.metadata.id,
            products: [],
            readiness,
            durationMs,
            timedOut,
            errorType,
            errorMessage,
          };
        }
      }),
    );
    const providerStageMs = performance.now() - providerStageStartedAt;
    emit("provider_stage_end", {
      durationMs: Number(providerStageMs.toFixed(2)),
      resultCount: providerResults.reduce(
        (total, providerResult) =>
          total + providerResult.products.length,
        0,
      ),
      timedOutProviderCount: providerResults.filter(
        (providerResult) => providerResult.timedOut,
      ).length,
      errorProviderCount: providerResults.filter(
        (providerResult) => providerResult.errorType && !providerResult.timedOut,
      ).length,
    });
    // Partial results (including web fallback) cannot establish a complete
    // inventory while a relevant feed index is still cold. A completed empty
    // feed is ready; a refresh of an existing usable index remains ready too.
    const unreadyProviderIds = providerResults
      .filter(
        (result) =>
          result.readiness?.ready === false ||
          (categoryBrowse && result.categoryResult?.ready === false),
      )
      .map((result) => result.providerId);
    if (unreadyProviderIds.length) {
      emit("inventory_unavailable", { providerIds: unreadyProviderIds });
      throw new InventoryUnavailableError(unreadyProviderIds);
    }
    const sortingDeduplicationStartedAt = performance.now();
    emit("deduplication_start", {
      providerResultCount: providerResults.reduce(
        (total, providerResult) =>
          total + providerResult.products.length,
        0,
      ),
    });
    const bestMatchesFirst = providerResults
      .flatMap((providerResult) => providerResult.products)
      .sort(
        (a, b) => (b.exactMatchScore ?? 0) - (a.exactMatchScore ?? 0),
      );

    const categoryFiltered = categoryBrowse && request.category
      ? bestMatchesFirst.filter((result) =>
          matchesLuqtaCategory(result, request.category!),
        )
      : bestMatchesFirst;
    const deduplicated = this.deduplication.deduplicate(categoryFiltered);
    const priceConstraintActive =
      !categoryBrowse && hasStrictPriceConstraint(sharedIntent);
    const priceFiltered = priceConstraintActive
      ? filterStrictPriceResults(deduplicated, sharedIntent)
      : deduplicated;
    const categoryFilterMs =
      categoryBrowse && request.category
        ? performance.now() - sortingDeduplicationStartedAt
        : 0;
    const sortingDeduplicationMs =
      performance.now() - sortingDeduplicationStartedAt;
    emit("deduplication_end", {
      durationMs: Number(sortingDeduplicationMs.toFixed(2)),
      resultCount: deduplicated.length,
    });
    const categoryProducts =
      categoryBrowse && request.category
        ? deduplicated.map((product) => ({
            ...product,
            categoryFilterIds:
              product.categoryFilterIds ??
              getCategoryFilterIds(product, request.category!),
          }))
        : priceFiltered;
    const categorySelection =
      categoryBrowse && request.category && request.categoryFilterId
        ? getCategoryFilterSelectionIds(
            request.category,
            request.categoryFilterId,
          )
        : undefined;
    const selectedCategoryProducts =
      categorySelection === undefined
        ? categoryProducts
        : categorySelection.length > 0
          ? categoryProducts.filter((product) =>
              categorySelection.every((filterId) =>
                product.categoryFilterIds?.includes(filterId),
              ),
            )
          : [];
    const indexedCategoryResults = providerResults
      .map((providerResult) => providerResult.categoryResult)
      .filter((result): result is NonNullable<typeof result> => Boolean(result));
    const hasCompleteIndexedCategoryResults =
      categoryBrowse &&
      providers.length > 0 &&
      indexedCategoryResults.length === providers.length &&
      indexedCategoryResults.every((result) => result.ready !== false);
    const categoryInventoryCount = categoryBrowse
      ? hasCompleteIndexedCategoryResults
        ? indexedCategoryResults.reduce((total, result) => total + result.total, 0)
        : selectedCategoryProducts.length
      : undefined;
    const categoryFilters =
      categoryBrowse && request.category
        ? hasCompleteIndexedCategoryResults
          ? buildIndexedCategoryFacets(
              request.category,
              Object.fromEntries(
                indexedCategoryResults.flatMap((result) =>
                  Object.entries(result.facetCounts),
                ).reduce((counts, [facetId, count]) => {
                  counts.set(facetId, (counts.get(facetId) ?? 0) + count);
                  return counts;
                }, new Map<string, number>()),
              ),
            )
          : getCategoryFilterFacets(selectedCategoryProducts, request.category)
        : undefined;
    const rankingStartedAt = performance.now();
    emit("ranking_start", { candidateCount: selectedCategoryProducts.length });
    const rankedProducts = this.ranking.rank(
      selectedCategoryProducts,
      sharedIntent,
      categoryBrowse && request.category === "electronics",
    );
    const rankingMs = performance.now() - rankingStartedAt;
    emit("ranking_end", {
      durationMs: Number(rankingMs.toFixed(2)),
      resultCount: rankedProducts.length,
    });
    const internalRanked = categoryBrowse
      ? hasCompleteIndexedCategoryResults
        ? rankedProducts.slice(
            (categoryPage - 1) * categoryPageSize,
            categoryPage * categoryPageSize,
          )
        : rankedProducts.slice(
            (categoryPage - 1) * categoryPageSize,
            categoryPage * categoryPageSize,
          )
      : rankedProducts.slice(0, 100);
    emit("relevance_evaluation_start", {
      resultCount: internalRanked.length,
    });
    const quality = assessSearchQuality(
      internalRanked,
      queryExpansion,
      sharedIntent,
    );
    emit("relevance_evaluation_end", {
      resultCount: quality.rawResultCount,
      stronglyRelevantCount: quality.stronglyRelevantCount,
      triggerReasonCount: quality.triggerReasons.length,
    });
    const fallbackAllowed =
      !categoryBrowse &&
      !request.imageUri &&
      !request.preferredProviderIds?.length;
    let fallbackStatus: SearchOrchestrationResult["fallbackStatus"] =
      categoryBrowse || quality.triggerReasons.length === 0
        ? "not_needed"
        : fallbackAllowed && this.webFallback?.metadata.searchEnabled
          ? "empty"
          : "unavailable";
    let braveTimedOut = false;
    const canUseFallback =
      fallbackAllowed &&
      this.webFallback?.metadata.searchEnabled &&
      quality.triggerReasons.length > 0;
    emit("brave_decision", {
      eligible: Boolean(
        fallbackAllowed && this.webFallback?.metadata.searchEnabled,
      ),
      triggered: Boolean(canUseFallback),
      strongInternalMatchCount: quality.stronglyRelevantCount,
      triggerReasonCount: quality.triggerReasons.length,
    });
    let merged = internalRanked;

    if (canUseFallback && this.webFallback) {
      this.webFallback.noteFallbackTriggered();
      const qualityQuery = buildQualityTranslation(
        queryExpansion.normalizedQuery,
      );
      const intentQuery = sharedIntent.normalized?.trim();
      const fallbackQuery =
        intentQuery &&
        /[a-z]/iu.test(intentQuery) &&
        !/[\u0600-\u06ff]/u.test(intentQuery)
          ? intentQuery
          : qualityQuery &&
              /[a-z]/iu.test(qualityQuery) &&
              !/[\u0600-\u06ff]/u.test(qualityQuery)
            ? qualityQuery
          : queryExpansion.originalQuery;
      const braveStartedAt = performance.now();
      emit("brave_request_start");
      try {
        const fallbackProducts = await withTimeout(
          () =>
            this.webFallback!.search({
              ...request,
              query: fallbackQuery,
              intent: sharedIntent,
            }),
          this.timeouts.braveSearchMs,
          "brave_search",
        );
        const normalizedFallback = fallbackProducts.map((result) =>
          this.normalizer.normalize(result, this.webFallback!.metadata),
        );
        const relevantFallback = filterStrictPriceResults(
          filterExplicitIntentResults(
          normalizedFallback,
          queryExpansion,
          sharedIntent,
          ),
          sharedIntent,
        );
        fallbackStatus = relevantFallback.length > 0 ? "used" : "empty";
        const internalForMerge =
          normalizedFallback.length > 0
            ? quality.relevantResults
            : internalRanked;
        merged = this.ranking
          .rank(
            this.deduplication.deduplicate([
              ...internalForMerge,
              ...relevantFallback,
            ]),
            sharedIntent,
          )
          .slice(0, 100);
        emit("brave_request_end", {
          durationMs: Number(
            (performance.now() - braveStartedAt).toFixed(2),
          ),
          resultCount: fallbackProducts.length,
          relevantResultCount: relevantFallback.length,
          timedOut: false,
          errorType: null,
        });
      } catch (error) {
        fallbackStatus = "unavailable";
        braveTimedOut = error instanceof SearchStageTimeoutError;
        merged = internalRanked;
        emit("brave_request_end", {
          durationMs: Number(
            (performance.now() - braveStartedAt).toFixed(2),
          ),
          resultCount: 0,
          timedOut: error instanceof SearchStageTimeoutError,
          errorType: error instanceof Error ? error.name : "UnknownError",
        });
      }
    }

    const exactPriceResults = priceConstraintActive
      ? filterStrictPriceResults(merged, sharedIntent)
      : merged;
    const results = exactPriceResults.map((result) =>
      this.affiliateLinks.attach(
        result,
        result.providerId === this.webFallback?.metadata.id
          ? this.webFallback.metadata
          : this.registry.get(result.providerId)?.metadata,
      ),
    );

    const response: SearchOrchestrationResult = {
      products: results,
      ...(!categoryBrowse ? { structuredIntent: sharedIntent } : {}),
      ...(priceConstraintActive
        ? {
            exactMatches: results.length,
            constraintRelaxationAvailable: results.length === 0,
          }
        : {}),
      ...(!categoryBrowse
        ? { strongInternalMatchCount: quality.stronglyRelevantCount }
        : {}),
      fallbackStatus,
    };
    Object.defineProperty(response, "__timings", {
      enumerable: false,
      value: {
        providerStageMs,
        categoryFilterMs,
        sortingDeduplicationMs,
        rankingMs,
        providerTimings: providerResults.map((providerResult) => ({
            providerId: providerResult.providerId,
            readinessWaitMs:
              providerResult.categoryResult?.timings?.readinessWaitMs ?? 0,
            categoryIndexMs:
              providerResult.categoryResult?.timings?.categoryIndexMs ?? 0,
            facetLookupMs:
              providerResult.categoryResult?.timings?.facetLookupMs ?? 0,
            ready:
              providerResult.categoryResult?.ready ??
              providerResult.readiness?.ready ??
              null,
            indexedProductCount:
              providerResult.readiness?.productCount ?? null,
            refreshing: providerResult.readiness?.refreshing ?? null,
            lastSuccessfulSync:
              providerResult.readiness?.lastSuccessfulSync ?? null,
            resultCount: providerResult.products.length,
            durationMs: Number(providerResult.durationMs.toFixed(2)),
            timedOut: providerResult.timedOut,
            ...(providerResult.errorType
              ? { errorType: providerResult.errorType }
              : {}),
            ...(providerResult.errorMessage
              ? { errorMessage: providerResult.errorMessage }
              : {}),
          })),
      },
    });
    if (categoryBrowse && request.category) {
      response.categoryInventoryCount = categoryInventoryCount;
      response.categoryState = getCategoryState(categoryInventoryCount ?? 0);
      response.categoryFilters = categoryFilters;
      response.total = categoryInventoryCount;
      response.page = categoryPage;
      response.pageSize = categoryPageSize;
      response.hasMore = categoryPage * categoryPageSize < (categoryInventoryCount ?? 0);
    }
    emit("response_composed", {
      resultCount: response.products.length,
      fallbackStatus: response.fallbackStatus,
      categoryBrowse,
    });
    const unavailableProviders = providerResults
      .filter((providerResult) =>
        providerResult.readiness?.ready === false ||
        providerResult.categoryResult?.ready === false ||
        providerResult.timedOut ||
        Boolean(providerResult.errorType),
      )
      .map((providerResult) => providerResult.providerId);
    if (
      (categoryBrowse
        ? (categoryInventoryCount ?? 0) === 0
        : response.products.length === 0) &&
      (unavailableProviders.length > 0 || providers.length === 0)
    ) {
      emit("inventory_unavailable", { providerIds: unavailableProviders });
      throw new InventoryUnavailableError(unavailableProviders);
    }
    const hasProviderFailure = providerResults.some(
      (providerResult) => providerResult.timedOut || providerResult.errorType,
    );
    const hasRefreshingOrUnreadyIndex = providerResults.some(
      (providerResult) =>
        providerResult.readiness?.ready === false ||
        providerResult.readiness?.refreshing === true,
    );
    const shouldCache =
      (!categoryBrowse || hasCompleteIndexedCategoryResults) &&
      !hasProviderFailure &&
      !hasRefreshingOrUnreadyIndex &&
      !braveTimedOut;
    if (shouldCache) {
      this.cache.set(cacheKey, response);
      emit("cache_store", { resultCount: response.products.length });
    } else {
      emit("cache_skip", {
        providerFailure: hasProviderFailure,
        unreadyIndex: hasRefreshingOrUnreadyIndex,
        braveTimedOut,
      });
    }
    return response;
  }
}