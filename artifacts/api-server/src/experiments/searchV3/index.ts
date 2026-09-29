import { deterministicIntentParser } from "../../connectors/intentParser";
import {
  expandShoppingQuery,
  getShoppingVocabularyAliases,
} from "../../connectors/queryExpansion";
import type { ProviderRegistry } from "../../connectors/providerRegistry";
import type {
  ProviderProduct,
  ProviderSearchRequest,
  QueryIntent,
  SearchProvider,
} from "../../connectors/types";
import type { ImageUrlLoader } from "./visual/urlLoader";
import {
  createVisualRankingState,
  rerankWithVisual,
  type VisualAdapter,
  type VisualCandidateDiagnostic,
  type VisualRankingOptions,
  type VisualRankingState,
} from "./visualRanking";

export type V3Request = {
  query: string;
  image?: {
    identities: Array<{
      label: string;
      confidence: number;
      brand?: string;
      model?: string;
      sku?: string;
      color?: string;
    }>;
    description?: string;
    extractedText?: string;
    imageUri?: string;
    imageBytes?: Uint8Array;
    mimeType?: string;
  };
  relation?: "cheaper" | "similar_cheaper" | "different_color" | "similar";
  reference?: {
    price?: number;
    currency?: string;
    color?: string;
    brand?: string;
    model?: string;
  };
};

export type V3ProductResult = {
  product: ProviderProduct;
  score: number;
  textScore: number;
  identityScore: number;
  visualScore?: number;
  embeddingScore?: number;
  hybridScore: number;
  visualStatus: "compared" | "unavailable" | "skipped";
  confidence: "exact" | "high" | "close" | "alternative" | "weak";
  reasons: string[];
};

export type V3IdentityHypothesis = {
  label: string;
  confidence: number;
  brand?: string;
  model?: string;
  sku?: string;
  color?: string;
};

export type V3TypedIdentifier = {
  value: string;
  kind: "model" | "sku";
  source: "text" | "image";
  confidence: number;
};

export type V3Intent = QueryIntent & {
  inferredBrandFromCandidates?: boolean;
  material?: string;
  visibleText: string[];
  attributes: string[];
  userPreferences: string[];
  confidence: number;
  identityHypotheses: V3IdentityHypothesis[];
  typedIdentifiers: V3TypedIdentifier[];
};

export type V3Diagnostics = {
  enabled: boolean;
  parsedIntent: V3Intent;
  generatedQueries: string[];
  selectedQueries: string[];
  sourceRouting: {
    category?: string;
    relevantProviders: string[];
    broadProviders: string[];
  };
  sourcesSearched: string[];
  resultCountPerSource: Record<string, number>;
  totalCandidates: number;
  deduplicatedCandidates: number;
  removedByConstraints: number;
  rerankedCandidates: number;
  confidenceScores: number[];
  visual: {
    status: "available" | "partial" | "unavailable";
    unavailableReason?: string;
    candidates: VisualCandidateDiagnostic[];
    stageLatencyMs: number;
    comparisonsAttempted: number;
    comparisonsCompleted: number;
    comparisonsFailed: number;
    imageLoadCalls: number;
    adapterCallCount: number;
    /** Counted by the experimental Gemini provider; never includes credentials. */
    gemini?: {
      imageCalls: number;
      queryImageCalls: number;
      candidateImageCalls: number;
      cacheHits: number;
      cacheMisses: number;
      estimatedCostUsd: number;
    };
  };
  photoOnlyDiscovery: {
    status: "not_requested" | "available" | "unavailable";
    candidateCount: number;
    eligibleCount: number;
    unavailableReason?: string;
  };
  passes: Array<{
    pass: 1 | 2;
    query: string;
    sources: string[];
    candidates: number;
  }>;
  stageLatencyMs: {
    intentParsing: number;
    queryExpansion: number;
    sourceRouting: number;
    firstPass: number;
    secondPass: number;
    reranking: number;
    photoOnlyCatalog: number;
  };
  totalLatencyMs: number;
  providerInvocationCount: number;
  externalApiCallCount: number;
};

export type RerankContext = {
  request: V3Request;
  intent: V3Intent;
};

export type RerankedCandidate = {
  product: ProviderProduct;
  score: number;
  baseScore?: number;
  reasons: string[];
  textScore?: number;
  identityScore?: number;
  identityPriority?: number;
  visualScore?: number;
  embeddingScore?: number;
  hybridScore?: number;
  visualStatus?: "compared" | "unavailable" | "skipped";
};

/**
 * An adapter boundary for a future multimodal model. Implementations receive
 * the image input, extracted attributes, and product metadata in one batch.
 * The built-in implementation is deterministic, uses text/attribute evidence
 * only, and makes no network calls; it does not claim pixel similarity.
 */
export interface MultimodalReranker {
  rerank(
    context: RerankContext,
    candidates: ProviderProduct[],
  ): Promise<RerankedCandidate[]>;
}

export type ExperimentalSearchV3Options = {
  registry: ProviderRegistry;
  brave?: SearchProvider;
  reranker?: MultimodalReranker;
  visualAdapter?: VisualAdapter;
  /** Opt-in budget only for this isolated experiment. */
  visualRankingOptions?: VisualRankingOptions;
  imageLoader?: ImageUrlLoader;
  photoOnlyCandidatePool?:
    | readonly ProviderProduct[]
    | ((
        maxCandidates: number,
      ) => Promise<readonly ProviderProduct[]> | readonly ProviderProduct[]);
  enabled?: boolean;
};

const MAX_OFFICIAL_PROVIDERS = 8;
const MAX_CANDIDATES = 100;
const MAX_QUERY_LENGTH = 200;
const SEARCH_TIMEOUT_MS = 4_000;
const RERANK_TIMEOUT_MS = 1_500;
const MAX_RESULTS_PER_SOURCE = 20;
const MAX_EXPANDED_QUERIES = 8;
const MAX_RELEVANT_PROVIDERS = 6;
const MAX_PHOTO_ONLY_CANDIDATES = 100;

const MATERIALS: Array<{ value: string; aliases: string[] }> = [
  { value: "leather", aliases: ["leather", "جلد", "جلدية", "جلديه"] },
  { value: "cotton", aliases: ["cotton", "قطن", "قطنية", "قطنيه"] },
  { value: "silk", aliases: ["silk", "حرير", "حريرية", "حريريه"] },
  { value: "wool", aliases: ["wool", "صوف"] },
  { value: "denim", aliases: ["denim", "جينز"] },
  { value: "linen", aliases: ["linen", "كتان"] },
  { value: "wood", aliases: ["wood", "wooden", "خشب", "خشبي"] },
  { value: "gold", aliases: ["gold", "ذهب", "ذهبي"] },
  { value: "silver", aliases: ["silver", "فضة", "فضي"] },
  { value: "stainless steel", aliases: ["stainless steel", "ستانلس ستيل"] },
  { value: "plastic", aliases: ["plastic", "بلاستيك"] },
];

const ATTRIBUTE_TERMS: Array<{ value: string; aliases: string[] }> = [
  { value: "waterproof", aliases: ["waterproof", "water resistant", "مقاوم للماء", "ضد الماء"] },
  { value: "wireless", aliases: ["wireless", "لاسلكي", "لاسلكية"] },
  { value: "noise cancelling", aliases: ["noise cancelling", "noise-cancelling", "عازل للضوضاء"] },
  { value: "ergonomic", aliases: ["ergonomic", "مريح", "مريحة"] },
  { value: "lightweight", aliases: ["lightweight", "خفيف الوزن", "خفيفة"] },
  { value: "rechargeable", aliases: ["rechargeable", "قابل للشحن", "قابلة للشحن"] },
];

const PREFERENCE_TERMS: Array<{ value: string; aliases: string[] }> = [
  { value: "budget_friendly", aliases: ["cheap", "cheaper", "affordable", "budget", "رخيص", "ارخص", "أرخص", "اقتصادي"] },
  { value: "highly_rated", aliases: ["highly rated", "best rated", "top rated", "تقييم عالي", "الأعلى تقييما"] },
  { value: "fast_delivery", aliases: ["fast delivery", "quick delivery", "توصيل سريع", "شحن سريع"] },
  { value: "same_product", aliases: ["same product", "نفس المنتج"] },
];

function normalized(value: string | undefined | null) {
  return (value ?? "")
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[إأآا]/gu, "ا")
    .replace(/ة/gu, "ه")
    .replace(/ى/gu, "ي")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function tokens(value: string) {
  return normalized(value).split(/\s+/u).filter((token) => token.length > 1);
}

function includesPhrase(surface: string, phrase: string | undefined) {
  const expected = normalized(phrase);
  return Boolean(expected) && ` ${normalized(surface)} `.includes(` ${expected} `);
}

function uniqueQueries(request: V3Request, intent: QueryIntent) {
  const identityQueries = request.image?.identities
    .filter((item) => item.confidence >= 0.45)
    .sort((left, right) => right.confidence - left.confidence)
    .map((item) =>
      [item.brand, item.model, item.sku, item.label, item.color]
        .filter(Boolean)
        .join(" "),
    )
    .filter(Boolean) ?? [];
  const queryExpansions = [
    ...expandShoppingQuery(request.query).variants,
    ...identityQueries.flatMap((identity) => expandShoppingQuery(identity).variants),
  ];
  const variants = [
    request.query.trim() || identityQueries[0],
    ...(request.query.trim() ? identityQueries : identityQueries.slice(1)),
    ...queryExpansions,
    intent.normalized,
    request.image?.extractedText,
    request.image?.description,
  ];
  const result: string[] = [];
  for (const variant of variants) {
    const query = variant?.trim().replace(/\s+/gu, " ").slice(0, MAX_QUERY_LENGTH);
    if (query && !result.some((existing) => normalized(existing) === normalized(query))) {
      result.push(query);
    }
    if (result.length === MAX_EXPANDED_QUERIES) break;
  }
  return result;
}

function isPhotoOnlyRequest(request: V3Request) {
  return Boolean(
    request.image?.imageBytes?.byteLength &&
      !request.query.trim() &&
      !request.image.extractedText?.trim() &&
      !request.image.description?.trim() &&
      !(request.image.identities?.length),
  );
}

function productSurface(product: ProviderProduct) {
  return [
    product.title,
    product.description,
    product.brand,
    product.productType,
    product.subcategory,
    product.color,
    product.location,
    product.providerProductId,
  ]
    .filter(Boolean)
    .join(" ");
}

function identifierSurface(product: ProviderProduct) {
  return [product.title, product.providerProductId].filter(Boolean).join(" ");
}

const CATEGORY_PROVIDER_HINTS: Record<string, string[]> = {
  beauty_care: ["beauty", "nazih", "cosmetic", "perfume"],
  fashion: ["fashion", "namshi", "shein", "diesel", "stylewe", "luxury"],
  bags_accessories: ["bag", "accessor", "namshi", "stylewe", "luxury"],
  watches_jewelry: ["watch", "jewel", "luxury", "noon", "amazon"],
  electronics: ["electronic", "huawei", "noon", "amazon", "aliexpress"],
  automotive: ["automotive", "auto", "car", "parts", "haraj"],
  shoes: ["shoe", "namshi", "shein", "sports", "noon"],
  eyewear: ["eyewear", "glass", "sunglass", "noon", "amazon"],
  home_living: ["home", "furniture", "living", "noon", "amazon"],
  kids_baby: ["kids", "baby", "children", "noon", "amazon"],
  sports_fitness: ["sport", "fitness", "noon", "amazon"],
  games_hobbies: ["game", "hobby", "console", "noon", "amazon"],
};

function routeOfficialProviders(
  providers: SearchProvider[],
  category?: string,
) {
  const hints = category ? CATEGORY_PROVIDER_HINTS[category] ?? [] : [];
  const relevant = providers.filter((provider) => {
    const searchable = normalized(`${provider.metadata.id} ${provider.metadata.name}`);
    return hints.some((hint) => searchable.includes(normalized(hint)));
  });
  const relevantIds = new Set(relevant.map((provider) => provider.metadata.id));
  const broad = providers.filter((provider) => !relevantIds.has(provider.metadata.id));
  const relevantLimit =
    broad.length > 0
      ? Math.min(MAX_RELEVANT_PROVIDERS, MAX_OFFICIAL_PROVIDERS - 1)
      : MAX_OFFICIAL_PROVIDERS;
  const orderedRelevant = relevant.slice(0, relevantLimit);
  const orderedBroad = broad.slice(0, MAX_OFFICIAL_PROVIDERS - orderedRelevant.length);
  return {
    providers: [...orderedRelevant, ...orderedBroad],
    relevantProviderIds: orderedRelevant.map((provider) => provider.metadata.id),
    broadProviderIds: orderedBroad.map((provider) => provider.metadata.id),
  };
}

function namedBrandInResults(query: string, products: ProviderProduct[]) {
  const brands = new Map<string, string>();
  for (const product of products) {
    const brand = product.brand?.trim();
    if (brand && brand.length >= 3 && includesPhrase(query, brand)) {
      brands.set(normalized(brand), brand);
    }
  }
  // The user's named brand is explicit evidence even if it is absent from
  // the deterministic parser's dictionary. "A or B" stays unconstrained.
  return brands.size === 1 ? brands.values().next().value : undefined;
}

const LOCATION_ALIASES: Array<{ canonical: string; aliases: string[] }> = [
  { canonical: "Riyadh", aliases: ["riyadh", "الرياض"] },
  { canonical: "Jeddah", aliases: ["jeddah", "جدة", "جده"] },
  { canonical: "Dammam", aliases: ["dammam", "الدمام"] },
  { canonical: "Mecca", aliases: ["mecca", "makkah", "مكة", "مكه"] },
  { canonical: "Medina", aliases: ["medina", "madinah", "المدينة", "المدينه"] },
  { canonical: "Khobar", aliases: ["khobar", "al khobar", "الخبر"] },
  { canonical: "Taif", aliases: ["taif", "الطائف"] },
  { canonical: "Abha", aliases: ["abha", "أبها", "ابها"] },
];

function explicitLocation(query: string) {
  const normalizedQuery = normalized(query);
  const hasLocationCue = /(?:\b(?:in|near|around|from)\b|في|بمدينة|بالقرب من)/iu.test(query);
  if (!hasLocationCue) return undefined;
  return LOCATION_ALIASES.find(({ aliases }) =>
    aliases.some((alias) => includesPhrase(normalizedQuery, alias)),
  )?.canonical;
}

function applyExplicitIdentifierIntent(query: string, intent: QueryIntent) {
  if (!intent.partNumber && !intent.oemNumber) {
    const part = query.match(
      /\b(?:sku|part(?:\s*(?:number|no\.?))?|oem)\s*[:#-]?\s*([a-z0-9][a-z0-9-]{2,24})/iu,
    );
    if (part?.[1]) intent.partNumber = part[1].toLocaleUpperCase();
  }
  if (!intent.vehicleModel) {
    const model = query.match(
      /\bmodel(?:\s*(?:number|no\.?))?\s*[:#-]?\s*([a-z0-9][a-z0-9-]{2,24})/iu,
    );
    if (model?.[1]) intent.vehicleModel = model[1];
  }
}

function buildTypedIdentifiers(request: V3Request, intent: QueryIntent): V3TypedIdentifier[] {
  const identifiers: V3TypedIdentifier[] = [];
  const add = (
    value: string | undefined,
    kind: V3TypedIdentifier["kind"],
    source: V3TypedIdentifier["source"],
    confidence: number,
  ) => {
    const cleaned = value?.trim();
    if (!cleaned) return;
    if (
      identifiers.some(
        (identifier) =>
          identifier.kind === kind && normalized(identifier.value) === normalized(cleaned),
      )
    ) {
      return;
    }
    identifiers.push({ value: cleaned, kind, source, confidence });
  };

  add(intent.partNumber, "sku", "text", 1);
  add(intent.oemNumber, "sku", "text", 1);
  add(intent.vehicleModel, "model", "text", 1);
  const query = request.query;
  const compactCodes = query.match(/\b(?=[a-z0-9-]*[a-z])(?=[a-z0-9-]*\d)[a-z0-9]+(?:-[a-z0-9]+)*\b/giu) ?? [];
  for (const code of compactCodes) {
    if (!/^\d{4}$/u.test(code)) add(code, "model", "text", 1);
  }
  const namedDeviceModels =
    query.match(/\b(?:iphone|ipad|galaxy|pixel|playstation|xbox|macbook)\s+[a-z]?\d{1,3}(?:\s+(?:pro|max|ultra|plus))?\b/giu) ?? [];
  for (const model of namedDeviceModels) add(model, "model", "text", 1);
  for (const identity of request.image?.identities ?? []) {
    add(identity.model, "model", "image", Math.max(0, Math.min(1, identity.confidence)));
    add(identity.sku, "sku", "image", Math.max(0, Math.min(1, identity.confidence)));
  }
  return identifiers.slice(0, 12);
}

function buildV3Intent(request: V3Request, intent: QueryIntent): V3Intent {
  const visibleText = [...new Set(
    (request.image?.extractedText ?? "")
      .split(/[\r\n]+/u)
      .map((line) => line.trim().slice(0, 180))
      .filter(Boolean),
  )].slice(0, 12);
  const evidenceSurface = [
    request.query,
    ...visibleText,
    request.image?.description,
    ...(request.image?.identities ?? []).map((identity) => identity.label),
  ]
    .filter(Boolean)
    .join(" ");
  const materials = MATERIALS.filter(({ aliases }) =>
    aliases.some((alias) => includesPhrase(evidenceSurface, alias)),
  ).map(({ value }) => value);
  const material = materials[0];
  const identityHypotheses = (request.image?.identities ?? []).slice(0, 10).map((identity) => ({
    label: identity.label.trim(),
    confidence: Number.isFinite(identity.confidence)
      ? Math.max(0, Math.min(1, identity.confidence))
      : 0,
    ...(identity.brand?.trim() ? { brand: identity.brand.trim() } : {}),
    ...(identity.model?.trim() ? { model: identity.model.trim() } : {}),
    ...(identity.sku?.trim() ? { sku: identity.sku.trim() } : {}),
    ...(identity.color?.trim() ? { color: identity.color.trim() } : {}),
  }));
  const attributes = new Set<string>();
  for (const attribute of [
    intent.productType,
    intent.audience,
    intent.color,
    intent.condition,
    ...materials,
  ]) {
    if (attribute) attributes.add(attribute);
  }
  for (const { value, aliases } of ATTRIBUTE_TERMS) {
    if (aliases.some((alias) => includesPhrase(evidenceSurface, alias))) attributes.add(value);
  }
  for (const hypothesis of identityHypotheses) {
    if (hypothesis.color) attributes.add(hypothesis.color);
  }
  const userPreferences = PREFERENCE_TERMS
    .filter(({ aliases }) => aliases.some((alias) => includesPhrase(request.query, alias)))
    .map(({ value }) => value);
  if (
    (request.relation === "cheaper" || request.relation === "similar_cheaper") &&
    !userPreferences.includes("budget_friendly")
  ) {
    userPreferences.push("budget_friendly");
  }
  if (request.relation === "different_color") userPreferences.push("different_color");
  if (request.relation === "similar") userPreferences.push("similar_products");
  const typedIdentifiers = buildTypedIdentifiers(request, intent);
  const maxIdentityConfidence = Math.max(0, ...identityHypotheses.map(({ confidence }) => confidence));
  let confidence =
    0.2 +
    (intent.productType ? 0.14 : 0) +
    (intent.brand ? 0.12 : 0) +
    (intent.color ? 0.06 : 0) +
    (intent.condition ? 0.05 : 0) +
    (intent.maxPrice !== undefined || intent.minPrice !== undefined ? 0.06 : 0) +
    (visibleText.length ? 0.08 : 0) +
    (typedIdentifiers.length ? 0.1 : 0) +
    (attributes.size ? 0.04 : 0) +
    maxIdentityConfidence * 0.15;
  if (identityHypotheses.length > 1) confidence -= 0.08;

  return {
    ...intent,
    ...(material ? { material } : {}),
    visibleText,
    attributes: [...attributes],
    userPreferences,
    confidence: Number(Math.max(0, Math.min(1, confidence)).toFixed(3)),
    identityHypotheses,
    typedIdentifiers,
  };
}

function selectedIdentity(request: V3Request) {
  return [...(request.image?.identities ?? [])]
    .filter((identity) => identity.confidence >= 0.8)
    .sort((left, right) => right.confidence - left.confidence)[0];
}

function candidateColor(product: ProviderProduct) {
  return product.color || undefined;
}

function hasAttribute(surface: string, attribute: string) {
  const aliases = [
    ...(MATERIALS.find((item) => item.value === attribute)?.aliases ?? []),
    ...(ATTRIBUTE_TERMS.find((item) => item.value === attribute)?.aliases ?? []),
    attribute,
  ];
  return aliases.some((alias) => includesPhrase(surface, alias));
}

function satisfiesConstraints(product: ProviderProduct, request: V3Request, intent: V3Intent) {
  const identity = selectedIdentity(request);
  const surface = productSurface(product);
  const verifiedIdentifierSurface = identifierSurface(product);
  if (
    intent.category &&
    product.category &&
    normalized(intent.category) !== normalized(product.category)
  ) return false;
  const requiredBrand =
    (request.relation !== "similar_cheaper" ? request.reference?.brand : undefined) ||
    (request.relation === "cheaper" || request.relation === "different_color"
      ? identity?.brand
      : undefined) ||
    intent.brand ||
    (identity && identity.confidence >= 0.9 ? identity.brand : undefined);
  const requiredModel =
    (request.relation !== "similar_cheaper" ? request.reference?.model : undefined) ||
    (request.relation === "cheaper" || request.relation === "different_color"
      ? identity?.model
      : undefined) ||
    intent.vehicleModel ||
    (request.relation !== "similar_cheaper" && identity && identity.confidence >= 0.9
      ? identity.model
      : undefined);
  const requiredSku = identity && identity.confidence >= 0.85 ? identity.sku : undefined;

  if (requiredBrand) {
    if (
      (product.brand && !includesPhrase(product.brand, requiredBrand)) ||
      (!product.brand && !includesPhrase(surface, requiredBrand))
    ) {
      return false;
    }
  }
  if (requiredModel && !includesPhrase(verifiedIdentifierSurface, requiredModel)) return false;
  if (requiredSku && !includesPhrase(verifiedIdentifierSurface, requiredSku)) return false;
  if (
    intent.partName &&
    ![intent.partName, ...getShoppingVocabularyAliases(intent.partName)].some(
      (name) => includesPhrase(surface, name),
    )
  ) return false;
  if (intent.partNumber && !includesPhrase(verifiedIdentifierSurface, intent.partNumber)) return false;
  if (intent.oemNumber && !includesPhrase(verifiedIdentifierSurface, intent.oemNumber)) return false;
  if (intent.vehicleMake && !includesPhrase(surface, intent.vehicleMake)) return false;
  if (intent.vehicleYear && !includesPhrase(surface, intent.vehicleYear)) return false;

  const requestedColor = intent.color;
  const knownColor = candidateColor(product);
  if (requestedColor && (!knownColor || !includesPhrase(knownColor, requestedColor))) {
    return false;
  }
  if (intent.location && (!product.location || !includesPhrase(product.location, intent.location))) {
    return false;
  }

  if (intent.condition === "new" || intent.condition === "used") {
    if (product.condition !== intent.condition) return false;
  } else if (intent.condition === "refurbished" && product.condition !== "refurbished") {
    return false;
  }

  if (intent.maxPrice !== undefined) {
    if (product.price == null || product.price > intent.maxPrice) return false;
    if (intent.currency && product.currency !== intent.currency) return false;
  }
  if (intent.minPrice !== undefined) {
    if (product.price == null || product.price < intent.minPrice) return false;
    if (intent.currency && product.currency !== intent.currency) return false;
  }
  if (request.relation === "cheaper" || request.relation === "different_color") {
    if (!requiredBrand && !requiredModel) return false;
  }
  if (request.relation === "cheaper") {
    const strongReferenceIdentifier =
      (requiredModel && includesPhrase(verifiedIdentifierSurface, requiredModel)) ||
      (requiredSku && includesPhrase(verifiedIdentifierSurface, requiredSku)) ||
      intent.typedIdentifiers.some(
        (identifier) =>
          identifier.kind === "sku" &&
          includesPhrase(verifiedIdentifierSurface, identifier.value),
      );
    if (!requiredBrand || !strongReferenceIdentifier) return false;
  }
  if (request.relation === "similar_cheaper") {
    const referenceModel = request.reference?.model ?? identity?.model;
    if (referenceModel && includesPhrase(verifiedIdentifierSurface, referenceModel)) return false;
  }
  if (request.relation === "cheaper" || request.relation === "similar_cheaper") {
    const referenceCurrency =
      request.reference?.currency ??
      intent.currency ??
      (/(?:\bSAR\b|ريال)/iu.test(request.query) ? "SAR" : undefined);
    if (
      request.reference?.price === undefined ||
      !referenceCurrency ||
      product.price == null ||
      product.price >= request.reference.price ||
      product.currency !== referenceCurrency
    ) {
      return false;
    }
  }
  if (request.relation === "different_color") {
    const referenceColor =
      request.reference?.color ??
      (identity && identity.confidence >= 0.9 ? identity.color : undefined);
    if (!knownColor || !referenceColor || normalized(knownColor) === normalized(referenceColor)) {
      return false;
    }
  }
  return true;
}

function classifyConfidence(
  result: RerankedCandidate,
  request: V3Request,
  intent: V3Intent,
): V3ProductResult["confidence"] {
  const identity = selectedIdentity(request);
  const surface = productSurface(result.product);
  const verifiedIdentifierSurface = identifierSurface(result.product);
  const requiredBrand =
    intent.brand || (identity && identity.confidence >= 0.9 ? identity.brand : undefined);
  const brandVerified = Boolean(
    requiredBrand &&
      !intent.inferredBrandFromCandidates &&
      (result.product.brand
        ? includesPhrase(result.product.brand, requiredBrand)
        : includesPhrase(result.product.title, requiredBrand)),
  );
  const requiredType = intent.productType;
  const typeAliases: Record<string, string[]> = {
    phone: ["phone", "smartphone", "mobile", "cell phone"],
    laptop: ["laptop", "notebook"],
    headphones: ["headphones", "headphone", "headset", "earbuds", "earphones"],
    television: ["television", "tv"],
    tablet: ["tablet", "ipad"],
    camera: ["camera"],
    console: ["console", "playstation", "xbox"],
  };
  const expectedTypes = requiredType
    ? typeAliases[normalized(requiredType)] ?? [requiredType]
    : [];
  const metadataType = result.product.productType ?? "";
  const metadataTypeMatches = expectedTypes.some((type) => includesPhrase(metadataType, type));
  const titleTypeMatches = expectedTypes.some((type) => includesPhrase(result.product.title, type));
  const metadataAccessory =
    /\b(?:case|cover|charger|charging cable|cable|adapter|lens|strap|mount|stand|remote|accessor(?:y|ies)|protector)\b/iu.test(
      metadataType,
    );
  const typeVerified = Boolean(
    requiredType &&
      !metadataAccessory &&
      (metadataTypeMatches || (!metadataType || !metadataAccessory) && titleTypeMatches),
  );
  const accessoryTitle =
    /\b(?:case|cover|charger|charging cable|cable|adapter|lens|strap|mount|stand|remote|accessor(?:y|ies)|screen protector|protective film|replacement band|earbud tips|phone holder)\b/iu.test(
      `${result.product.title} ${result.product.productType ?? ""}`,
    );
  const deviceType = Boolean(
    requiredType &&
      ["phone", "laptop", "headphones", "television", "camera", "tablet", "console"].some(
        (type) => includesPhrase(requiredType, type),
      ),
  );
  const verifiedIdentifier = intent.typedIdentifiers.some((identifier) => {
    const sufficientlyCertain =
      identifier.source === "text" || identifier.confidence >= 0.9;
    return sufficientlyCertain && includesPhrase(verifiedIdentifierSurface, identifier.value);
  });
  if (
    request.relation !== "similar" &&
    request.relation !== "similar_cheaper" &&
    (result.baseScore ?? result.score) >= 0.88 &&
    verifiedIdentifier &&
    brandVerified &&
    typeVerified &&
    !(deviceType && accessoryTitle)
  ) {
    return "exact";
  }
  if (result.score >= 0.78) return "high";
  if (result.score >= 0.55) return "close";
  if (result.score >= 0.32) return "alternative";
  return "weak";
}

function bounded<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Search timed out")), timeoutMs);
    promise.then(resolve, reject).finally(() => clearTimeout(timeout));
  });
}

function braveRequestCount(provider: SearchProvider) {
  if (provider.metadata.integrationType !== "web_search") return undefined;
  const metricsProvider = provider as SearchProvider & {
    getUsageMetrics?: () => { braveRequests?: number };
  };
  return metricsProvider.getUsageMetrics?.().braveRequests;
}

function stableProductKey(product: ProviderProduct) {
  if (product.productUrl) {
    try {
      const url = new URL(product.productUrl);
      url.hash = "";
      return `url:${url.toString().replace(/\/$/u, "")}`;
    } catch {
      return `url:${product.productUrl}`;
    }
  }
  return `title:${normalized(`${product.title} ${product.brand ?? ""} ${product.merchant ?? ""}`)}`;
}

function explain(product: ProviderProduct, request: V3Request, intent: V3Intent, score: number) {
  const reasons: string[] = [];
  const surface = productSurface(product);
  const verifiedIdentifierSurface = identifierSurface(product);
  const identity = selectedIdentity(request);
  if (identity?.sku && includesPhrase(verifiedIdentifierSurface, identity.sku)) reasons.push("SKU matches image identity");
  if (identity?.model && includesPhrase(verifiedIdentifierSurface, identity.model)) reasons.push("Model matches image identity");
  if (
    intent.typedIdentifiers.some(
      (identifier) =>
        identifier.kind === "sku" &&
        includesPhrase(verifiedIdentifierSurface, identifier.value),
    )
  ) {
    reasons.push("Exact SKU/OEM identifier match");
  } else if (
    intent.typedIdentifiers.some(
      (identifier) =>
        identifier.kind === "model" &&
        includesPhrase(verifiedIdentifierSurface, identifier.value),
    )
  ) {
    reasons.push("Exact model identifier match");
  }
  if ((intent.brand || identity?.brand) && includesPhrase(surface, intent.brand ?? identity?.brand)) {
    reasons.push("Brand match");
  }
  if ((intent.color || identity?.color) && includesPhrase(product.color ?? "", intent.color ?? identity?.color)) {
    reasons.push("Color match");
  }
  if (intent.productType && includesPhrase(surface, intent.productType)) reasons.push("Product type match");
  if (intent.material && hasAttribute(surface, intent.material)) reasons.push("Material attribute match");
  if (
    intent.attributes.some((attribute) =>
      ATTRIBUTE_TERMS.some(
        (definition) =>
          definition.value === attribute && hasAttribute(surface, definition.value),
      ),
    )
  ) {
    reasons.push("Important attribute match");
  }
  if (intent.maxPrice !== undefined && product.price !== undefined) reasons.push("Within maximum price");
  if (intent.condition && product.condition === intent.condition) reasons.push("Condition matches");
  if (request.relation === "cheaper") reasons.push("Cheaper than reference");
  if (request.relation === "different_color") reasons.push("Different color from reference");
  if (!reasons.length) {
    reasons.push(score >= 0.58 ? "Strong text and attribute relevance" : "Possible related alternative");
  }
  return reasons;
}

export class DeterministicMultimodalReranker implements MultimodalReranker {
  async rerank(context: RerankContext, candidates: ProviderProduct[]): Promise<RerankedCandidate[]> {
    const { request, intent } = context;
    const identity = selectedIdentity(request);
    const queryTokens = tokens(
      [
        request.query,
        intent.normalized,
        identity?.label,
        identity?.brand,
        identity?.model,
        identity?.sku,
        request.relation === "different_color" ? undefined : identity?.color,
        request.image?.extractedText,
        request.image?.description,
      ]
        .filter(Boolean)
        .join(" "),
    );
    const uniqueQueryTokens = [...new Set(queryTokens)];
    const textTokens = [
      ...new Set(tokens([request.query, intent.normalized, request.image?.extractedText].filter(Boolean).join(" "))),
    ];

    return candidates
      .map((product) => {
        const surface = normalized(productSurface(product));
        const verifiedIdentifierSurface = normalized(identifierSurface(product));
        const matched = uniqueQueryTokens.filter((token) => surface.includes(token));
        let score = uniqueQueryTokens.length ? matched.length / uniqueQueryTokens.length : 0.25;
        const textMatches = textTokens.filter((token) => surface.includes(token));
        const textScore = textTokens.length ? textMatches.length / textTokens.length : 0;
        const matchedIdentifiers = intent.typedIdentifiers.filter((identifier) =>
          includesPhrase(verifiedIdentifierSurface, identifier.value),
        );
        const skuConfidence = Math.max(
          0,
          ...matchedIdentifiers
            .filter((identifier) => identifier.kind === "sku")
            .map((identifier) => identifier.confidence),
        );
        const modelConfidence = Math.max(
          0,
          ...matchedIdentifiers
            .filter((identifier) => identifier.kind === "model")
            .map((identifier) => identifier.confidence),
        );
        if (skuConfidence > 0) score += 0.08 + skuConfidence * 0.55;
        else if (modelConfidence > 0) score += 0.06 + modelConfidence * 0.43;
        const identifierPriority = Math.max(
          0,
          ...matchedIdentifiers.map(
            (identifier) =>
              (identifier.kind === "sku" ? 2 : 1) + identifier.confidence,
          ),
        );
        const identityHypothesisScores = intent.identityHypotheses.map((hypothesis) => {
          const certainty = Math.max(0, Math.min(1, hypothesis.confidence));
          if (hypothesis.sku && includesPhrase(surface, hypothesis.sku)) return certainty;
          if (hypothesis.model && includesPhrase(surface, hypothesis.model)) return certainty * 0.85;
          const labelTokens = tokens(hypothesis.label);
          const labelMatches = labelTokens.filter((token) => surface.includes(token));
          return labelTokens.length
            ? (labelMatches.length / labelTokens.length) * certainty * 0.65
            : 0;
        });
        const identityScore = Math.max(
          skuConfidence,
          modelConfidence * 0.85,
          ...identityHypothesisScores,
        );
        if (intent.brand && includesPhrase(`${product.brand ?? ""} ${surface}`, intent.brand)) score += 0.18;
        if (identity?.brand && includesPhrase(`${product.brand ?? ""} ${surface}`, identity.brand)) score += 0.12;
        if (intent.productType && includesPhrase(surface, intent.productType)) score += 0.12;
        if (intent.color && includesPhrase(product.color ?? "", intent.color)) score += 0.12;
        if (
          request.relation !== "different_color" &&
          identity?.color &&
          includesPhrase(product.color ?? "", identity.color)
        ) {
          score += Math.min(0.12, identity.confidence * 0.12);
        }
        if (intent.maxPrice !== undefined && product.price != null && product.price <= intent.maxPrice) {
          score += 0.06;
        }
        if (intent.condition && product.condition === intent.condition) score += 0.08;
        const softAttributes = [
          ...MATERIALS
            .filter(({ value }) => intent.attributes.includes(value))
            .map(({ value }) => value),
          ...ATTRIBUTE_TERMS
            .filter(({ value }) => intent.attributes.includes(value))
            .map(({ value }) => value),
        ].filter((value): value is string => Boolean(value));
        for (const attribute of softAttributes) {
          if (hasAttribute(surface, attribute)) score += 0.035;
        }
        if (product.availability === "in_stock") score += 0.02;
        score = Math.min(1, Math.max(0, score));
        return {
          product,
          score: Number(score.toFixed(4)),
          reasons: explain(product, request, intent, score),
          textScore: Number(textScore.toFixed(4)),
          identityScore: Number(identityScore.toFixed(4)),
          identifierPriority,
        };
      })
      .sort(
        (left, right) =>
          right.identifierPriority - left.identifierPriority ||
          right.score - left.score,
      )
      .map(({ identifierPriority, ...candidate }) => ({ ...candidate, identityPriority: identifierPriority }));
  }
}

type EmbeddingMetrics = ReturnType<NonNullable<VisualAdapter["getEmbeddingMetrics"]>>;

function embeddingMetricsDelta(before: EmbeddingMetrics, after: EmbeddingMetrics): EmbeddingMetrics {
  return {
    imageCalls: after.imageCalls - before.imageCalls,
    queryImageCalls: after.queryImageCalls - before.queryImageCalls,
    candidateImageCalls: after.candidateImageCalls - before.candidateImageCalls,
    cacheHits: after.cacheHits - before.cacheHits,
    cacheMisses: after.cacheMisses - before.cacheMisses,
    estimatedCostUsd: Number((after.estimatedCostUsd - before.estimatedCostUsd).toFixed(8)),
  };
}

export class ExperimentalSearchV3 {
  private readonly enabled: boolean;
  private readonly reranker: MultimodalReranker;

  constructor(private readonly options: ExperimentalSearchV3Options) {
    this.enabled = options.enabled ?? false;
    this.reranker = options.reranker ?? new DeterministicMultimodalReranker();
  }

  async search(request: V3Request): Promise<{ products: V3ProductResult[]; diagnostics: V3Diagnostics }> {
    const adapter = this.options.visualAdapter;
    return adapter?.withSearchLock
      ? adapter.withSearchLock(() => this.searchUnlocked(request))
      : this.searchUnlocked(request);
  }

  private async searchUnlocked(request: V3Request): Promise<{ products: V3ProductResult[]; diagnostics: V3Diagnostics }> {
    const startedAt = Date.now();
    const visualAdapter = this.options.visualAdapter?.forSearch?.() ?? this.options.visualAdapter;
    const geminiBefore = visualAdapter?.getEmbeddingMetrics?.();
    const intentStartedAt = Date.now();
    const parsed = await deterministicIntentParser.parse(request.query);
    applyExplicitIdentifierIntent(request.query, parsed);
    if (
      request.relation !== "similar_cheaper" &&
      request.reference?.brand &&
      !parsed.brand
    ) {
      parsed.brand = request.reference.brand;
    }
    if (!parsed.location) parsed.location = explicitLocation(request.query);
    const intent = buildV3Intent(request, parsed);
    const intentParsingMs = Date.now() - intentStartedAt;
    const expansionStartedAt = Date.now();
    const queries = uniqueQueries(request, intent);
    const queryExpansionMs = Date.now() - expansionStartedAt;
    const visualState = createVisualRankingState(this.options.visualRankingOptions?.candidateLimit);
    const visualUnavailableReason = !request.image?.imageBytes?.byteLength
      ? "REFERENCE_IMAGE_BYTES_MISSING"
      : !visualAdapter
        ? "VISUAL_ADAPTER_UNAVAILABLE"
        : !this.options.imageLoader
          ? "IMAGE_URL_LOADER_UNAVAILABLE"
          : undefined;
    const diagnostics: V3Diagnostics = {
      enabled: this.enabled,
      parsedIntent: { ...intent },
      generatedQueries: queries,
      selectedQueries: [],
      sourceRouting: {
        ...(intent.category ? { category: intent.category } : {}),
        relevantProviders: [],
        broadProviders: [],
      },
      sourcesSearched: [],
      resultCountPerSource: {},
      totalCandidates: 0,
      deduplicatedCandidates: 0,
      removedByConstraints: 0,
      rerankedCandidates: 0,
      confidenceScores: [],
      visual: {
        status: "unavailable",
        ...(visualUnavailableReason ? { unavailableReason: visualUnavailableReason } : {}),
        candidates: [],
        stageLatencyMs: 0,
        comparisonsAttempted: 0,
        comparisonsCompleted: 0,
        comparisonsFailed: 0,
        imageLoadCalls: 0,
        adapterCallCount: 0,
      },
      photoOnlyDiscovery: {
        status: "not_requested",
        candidateCount: 0,
        eligibleCount: 0,
      },
      passes: [],
      stageLatencyMs: {
        intentParsing: intentParsingMs,
        queryExpansion: queryExpansionMs,
        sourceRouting: 0,
        firstPass: 0,
        secondPass: 0,
        reranking: 0,
        photoOnlyCatalog: 0,
      },
      totalLatencyMs: 0,
      providerInvocationCount: 0,
      externalApiCallCount: 0,
    };
    if (!this.enabled) {
      diagnostics.totalLatencyMs = Date.now() - startedAt;
      return { products: [], diagnostics };
    }
    if (isPhotoOnlyRequest(request)) {
      return this.searchPhotoOnly(request, intent, diagnostics, startedAt, visualAdapter);
    }
    if (!queries.length) {
      diagnostics.totalLatencyMs = Date.now() - startedAt;
      return { products: [], diagnostics };
    }

    const routingStartedAt = Date.now();
    const allOfficialProviders = this.options.registry
      .getSearchProviders()
      .filter((provider) => provider.metadata.integrationType !== "web_search");
    const routing = routeOfficialProviders(allOfficialProviders, intent.category);
    const official = routing.providers;
    const braveAvailable = Boolean(
      this.options.brave?.metadata.enabled && this.options.brave.metadata.searchEnabled,
    );
    diagnostics.sourceRouting = {
      ...(intent.category ? { category: intent.category } : {}),
      relevantProviders: routing.relevantProviderIds,
      broadProviders: routing.broadProviderIds,
    };
    diagnostics.stageLatencyMs.sourceRouting = Date.now() - routingStartedAt;
    const secondPassSources = [
      ...official,
      ...(braveAvailable && this.options.brave ? [this.options.brave] : []),
    ];
    const allCandidates: ProviderProduct[] = [];
    const searchedSources = new Set<string>();

    const runPass = async (
      pass: 1 | 2,
      query: string,
      passSources: SearchProvider[],
    ) => {
      const passStartedAt = Date.now();
      const passSearchedSources = new Set<string>();
      const tasks = passSources.map(async (provider) => {
        const searchRequest: ProviderSearchRequest = {
          query,
          page: 1,
          pageSize: MAX_RESULTS_PER_SOURCE,
          searchMode: "intent",
          intent: { ...intent, raw: query },
          ...(request.image?.imageUri &&
          provider !== this.options.brave &&
          provider.metadata.integrationType !== "web_search" &&
          provider.metadata.visualSearchAllowed
            ? { imageUri: request.image.imageUri }
            : {}),
        };
        const beforeBraveRequests = braveRequestCount(provider);
        diagnostics.providerInvocationCount += 1;
        searchedSources.add(provider.metadata.id);
        passSearchedSources.add(provider.metadata.id);
        try {
          const found = await bounded(provider.search(searchRequest), SEARCH_TIMEOUT_MS);
          const products = found.slice(0, MAX_RESULTS_PER_SOURCE);
          diagnostics.resultCountPerSource[provider.metadata.id] =
            (diagnostics.resultCountPerSource[provider.metadata.id] ?? 0) + products.length;
          allCandidates.push(...products);
        } catch {
          diagnostics.resultCountPerSource[provider.metadata.id] ??= 0;
        } finally {
          const afterBraveRequests = braveRequestCount(provider);
          if (beforeBraveRequests !== undefined && afterBraveRequests !== undefined) {
            diagnostics.externalApiCallCount += Math.max(
              0,
              afterBraveRequests - beforeBraveRequests,
            );
          }
        }
      });
      await Promise.all(tasks);
      diagnostics.selectedQueries.push(query);
      diagnostics.totalCandidates = allCandidates.length;
      const deduped = deduplicate(allCandidates);
      if (!intent.brand && request.relation !== "similar") {
        const namedBrand = namedBrandInResults(request.query, deduped);
        if (namedBrand) {
          intent.brand = namedBrand;
          intent.inferredBrandFromCandidates = true;
        }
      }
      const eligible = deduped.filter((product) => satisfiesConstraints(product, request, intent));
      const rerankStartedAt = Date.now();
      const ranked = await bounded(
        this.reranker.rerank({ request, intent }, eligible),
        RERANK_TIMEOUT_MS,
      );
      diagnostics.stageLatencyMs.reranking += Date.now() - rerankStartedAt;
      const visualRanked = await rerankWithVisual(
        { request, intent },
        ranked,
        visualAdapter,
        this.options.imageLoader,
        visualState,
        this.options.visualRankingOptions,
      );
      diagnostics.visual = visualRanked.diagnostics;
      if (geminiBefore) {
        const current = visualAdapter?.getEmbeddingMetrics?.();
        if (current) diagnostics.visual.gemini = embeddingMetricsDelta(geminiBefore, current);
      }
      const finalRanked = visualRanked.ranked;
      const bestScore = finalRanked[0]?.score ?? 0;
      diagnostics.passes.push({
        pass,
        query,
        sources: [...passSearchedSources],
        candidates: allCandidates.length,
      });
      diagnostics.stageLatencyMs[pass === 1 ? "firstPass" : "secondPass"] =
        Date.now() - passStartedAt;
      return { deduped, eligible, ranked: finalRanked, bestScore };
    };

    let result = await runPass(1, queries[0], official);
    const topConfidence =
      result.ranked[0]
        ? classifyConfidence(result.ranked[0], request, intent)
        : "weak";
    const insufficientFirstPass =
      result.bestScore < 0.55 ||
      result.eligible.length === 0 ||
      (result.eligible.length < 2 && topConfidence !== "exact" && topConfidence !== "high");
    if (insufficientFirstPass && secondPassSources.length > 0) {
      const secondQuery = queries[1] ?? queries[0];
      // With no alternate query, use Brave for discovery rather than repeat
      // the same official-feed calls. Otherwise retry official feeds once and
      // add Brave as a bounded fallback.
      const fallbackSources =
        queries.length > 1
          ? secondPassSources
          : braveAvailable && this.options.brave
            ? [this.options.brave]
            : [];
      if (fallbackSources.length) {
        result = await runPass(2, secondQuery, fallbackSources);
      }
    }

    diagnostics.sourcesSearched = [...searchedSources];
    diagnostics.parsedIntent = { ...intent };
    diagnostics.deduplicatedCandidates = result.deduped.length;
    diagnostics.removedByConstraints = Math.max(0, result.deduped.length - result.eligible.length);
    diagnostics.rerankedCandidates = result.ranked.length;
    const products = diversifiedResults(result.ranked, request, intent).slice(0, 30).map((candidate) => ({
      product: candidate.product,
      score: candidate.score,
      textScore: candidate.textScore ?? 0,
      identityScore: candidate.identityScore ?? 0,
      ...(candidate.visualScore !== undefined ? { visualScore: candidate.visualScore } : {}),
      ...(candidate.embeddingScore !== undefined ? { embeddingScore: candidate.embeddingScore } : {}),
      hybridScore: candidate.hybridScore ?? candidate.score,
      visualStatus: candidate.visualStatus ?? "unavailable",
      confidence: candidate.confidence,
      reasons: candidate.reasons.length
        ? candidate.reasons
        : explain(candidate.product, request, intent, candidate.score),
    }));
    diagnostics.confidenceScores = products.map((product) => product.score);
    diagnostics.totalLatencyMs = Date.now() - startedAt;
    return { products, diagnostics };
  }

  private async searchPhotoOnly(
    request: V3Request,
    intent: V3Intent,
    diagnostics: V3Diagnostics,
    startedAt: number,
    visualAdapter?: VisualAdapter,
  ): Promise<{ products: V3ProductResult[]; diagnostics: V3Diagnostics }> {
    const geminiBefore = visualAdapter?.getEmbeddingMetrics?.();
    const catalogStartedAt = Date.now();
    let pool: readonly ProviderProduct[] | undefined;
    try {
      const injectedPool = this.options.photoOnlyCandidatePool;
      if (injectedPool) {
        pool =
          typeof injectedPool === "function"
            ? await bounded(
                Promise.resolve().then(() => injectedPool(MAX_PHOTO_ONLY_CANDIDATES)),
                SEARCH_TIMEOUT_MS,
              )
            : injectedPool;
      }
    } catch {
      pool = undefined;
    }
    diagnostics.stageLatencyMs.photoOnlyCatalog = Date.now() - catalogStartedAt;
    const catalogCandidates = Array.isArray(pool)
      ? pool.slice(0, MAX_PHOTO_ONLY_CANDIDATES)
      : [];
    if (!catalogCandidates.length) {
      diagnostics.photoOnlyDiscovery = {
        status: "unavailable",
        candidateCount: 0,
        eligibleCount: 0,
        unavailableReason: "PHOTO_ONLY_CATALOG_UNAVAILABLE",
      };
      diagnostics.totalLatencyMs = Date.now() - startedAt;
      return { products: [], diagnostics };
    }

    const deduped = deduplicate([...catalogCandidates]);
    const eligible = deduped.filter((product) => satisfiesConstraints(product, request, intent));
    diagnostics.totalCandidates = catalogCandidates.length;
    diagnostics.deduplicatedCandidates = deduped.length;
    diagnostics.removedByConstraints = Math.max(0, deduped.length - eligible.length);
    diagnostics.photoOnlyDiscovery = {
      status: "available",
      candidateCount: catalogCandidates.length,
      eligibleCount: eligible.length,
    };
    const candidates: RerankedCandidate[] = eligible.map((product) => ({
      product,
      score: 0.25,
      baseScore: 0.25,
      textScore: 0,
      identityScore: 0,
      reasons: [],
    }));
    const visualStartedAt = Date.now();
    const ranked = await rerankWithVisual(
      { request, intent },
      candidates,
      visualAdapter,
      this.options.imageLoader,
      createVisualRankingState(Math.min(
        MAX_PHOTO_ONLY_CANDIDATES,
        this.options.visualRankingOptions?.candidateLimit ?? MAX_PHOTO_ONLY_CANDIDATES,
      )),
      {
        candidateLimit: this.options.visualRankingOptions?.candidateLimit ?? MAX_PHOTO_ONLY_CANDIDATES,
        concurrency: this.options.visualRankingOptions?.concurrency ?? 4,
        comparisonTimeoutMs: this.options.visualRankingOptions?.comparisonTimeoutMs ?? 1_000,
        stageTimeoutMs: this.options.visualRankingOptions?.stageTimeoutMs ?? 15_000,
      },
    );
    diagnostics.visual = ranked.diagnostics;
    if (geminiBefore) {
      const current = visualAdapter?.getEmbeddingMetrics?.();
      if (current) diagnostics.visual.gemini = embeddingMetricsDelta(geminiBefore, current);
    }
    diagnostics.stageLatencyMs.reranking = Date.now() - visualStartedAt;
    const visuallyCompared = ranked.ranked.filter(
      (candidate) => candidate.visualStatus === "compared",
    );
    diagnostics.rerankedCandidates = visuallyCompared.length;
    if (!visuallyCompared.length) {
      diagnostics.photoOnlyDiscovery = {
        status: "unavailable",
        candidateCount: catalogCandidates.length,
        eligibleCount: eligible.length,
        unavailableReason:
          ranked.diagnostics.unavailableReason ?? "PHOTO_ONLY_VISUAL_COMPARISON_UNAVAILABLE",
      };
      diagnostics.totalLatencyMs = Date.now() - startedAt;
      return { products: [], diagnostics };
    }

    const products = diversifiedResults(visuallyCompared, request, intent)
      .slice(0, 30)
      .map((candidate) => ({
        product: candidate.product,
        score: candidate.score,
        textScore: candidate.textScore ?? 0,
        identityScore: candidate.identityScore ?? 0,
        ...(candidate.visualScore !== undefined ? { visualScore: candidate.visualScore } : {}),
        ...(candidate.embeddingScore !== undefined ? { embeddingScore: candidate.embeddingScore } : {}),
        hybridScore: candidate.hybridScore ?? candidate.score,
        visualStatus: candidate.visualStatus ?? "unavailable",
        confidence: candidate.confidence,
        reasons: candidate.reasons.length ? candidate.reasons : ["Visual image match"],
      }));
    diagnostics.confidenceScores = products.map((product) => product.score);
    diagnostics.photoOnlyDiscovery = {
      status: "available",
      candidateCount: catalogCandidates.length,
      eligibleCount: eligible.length,
    };
    diagnostics.totalLatencyMs = Date.now() - startedAt;
    return { products, diagnostics };
  }
}

function deduplicate(products: ProviderProduct[]) {
  const byKey = new Map<string, ProviderProduct>();
  for (const product of products) {
    const key = stableProductKey(product);
    if (!byKey.has(key)) byKey.set(key, product);
  }
  return [...byKey.values()].slice(0, MAX_CANDIDATES);
}

function diversifiedResults(
  ranked: RerankedCandidate[],
  request: V3Request,
  intent: V3Intent,
) {
  const classified = ranked.map((candidate) => ({
    ...candidate,
    confidence: classifyConfidence(candidate, request, intent),
  }));
  const dominant = classified.filter(
    (candidate) => candidate.confidence === "exact" || candidate.confidence === "high",
  );
  const alternatives = classified.filter(
    (candidate) => candidate.confidence !== "exact" && candidate.confidence !== "high",
  );
  const merchantCounts = new Map<string, number>();
  const selected: typeof alternatives = [];
  const deferred: typeof alternatives = [];
  for (const candidate of alternatives) {
    const merchant =
      candidate.product.merchant ??
      candidate.product.source ??
      candidate.product.sourceType ??
      "unknown";
    const count = merchantCounts.get(merchant) ?? 0;
    if (count >= 2) {
      deferred.push(candidate);
      continue;
    }
    merchantCounts.set(merchant, count + 1);
    selected.push(candidate);
  }
  return [...dominant, ...selected, ...deferred];
}