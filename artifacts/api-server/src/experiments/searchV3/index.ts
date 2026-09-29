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
  };
  relation?: "cheaper" | "different_color" | "similar";
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
  confidence: "exact" | "close" | "alternative";
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
  sourcesSearched: string[];
  resultCountPerSource: Record<string, number>;
  totalCandidates: number;
  deduplicatedCandidates: number;
  removedByConstraints: number;
  rerankedCandidates: number;
  confidenceScores: number[];
  passes: Array<{ pass: 1 | 2; query: string; candidates: number }>;
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
  reasons: string[];
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
  enabled?: boolean;
};

const MAX_OFFICIAL_PROVIDERS = 8;
const MAX_CANDIDATES = 100;
const MAX_QUERY_LENGTH = 200;
const SEARCH_TIMEOUT_MS = 4_000;
const RERANK_TIMEOUT_MS = 1_500;
const MAX_RESULTS_PER_SOURCE = 20;
const MAX_EXPANDED_QUERIES = 8;

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
  if (request.relation === "cheaper" && !userPreferences.includes("budget_friendly")) {
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
  if (
    intent.category &&
    product.category &&
    normalized(intent.category) !== normalized(product.category)
  ) return false;
  const requiredBrand =
    request.reference?.brand ||
    (request.relation === "cheaper" || request.relation === "different_color"
      ? identity?.brand
      : undefined) ||
    intent.brand ||
    (identity && identity.confidence >= 0.9 ? identity.brand : undefined);
  const requiredModel =
    request.reference?.model ||
    (request.relation === "cheaper" || request.relation === "different_color"
      ? identity?.model
      : undefined) ||
    intent.vehicleModel ||
    (identity && identity.confidence >= 0.9 ? identity.model : undefined);
  const requiredSku = identity && identity.confidence >= 0.85 ? identity.sku : undefined;

  if (requiredBrand) {
    if (
      (product.brand && !includesPhrase(product.brand, requiredBrand)) ||
      (!product.brand && !includesPhrase(surface, requiredBrand))
    ) {
      return false;
    }
  }
  if (requiredModel && !includesPhrase(surface, requiredModel)) return false;
  if (requiredSku && !includesPhrase(surface, requiredSku)) return false;
  if (
    intent.partName &&
    ![intent.partName, ...getShoppingVocabularyAliases(intent.partName)].some(
      (name) => includesPhrase(surface, name),
    )
  ) return false;
  if (intent.partNumber && !includesPhrase(surface, intent.partNumber)) return false;
  if (intent.oemNumber && !includesPhrase(surface, intent.oemNumber)) return false;
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
  const requiredBrand =
    intent.brand || (identity && identity.confidence >= 0.9 ? identity.brand : undefined);
  const brandVerified = Boolean(
    requiredBrand &&
      !intent.inferredBrandFromCandidates &&
      (result.product.brand
        ? includesPhrase(result.product.brand, requiredBrand)
        : includesPhrase(surface, requiredBrand)),
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
    return sufficientlyCertain && includesPhrase(surface, identifier.value);
  });
  if (
    result.score >= 0.88 &&
    verifiedIdentifier &&
    brandVerified &&
    typeVerified &&
    !(deviceType && accessoryTitle)
  ) {
    return "exact";
  }
  return result.score >= 0.58 ? "close" : "alternative";
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
  const identity = selectedIdentity(request);
  if (identity?.sku && includesPhrase(surface, identity.sku)) reasons.push("SKU matches image identity");
  if (identity?.model && includesPhrase(surface, identity.model)) reasons.push("Model matches image identity");
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

    return candidates
      .map((product) => {
        const surface = normalized(productSurface(product));
        const matched = uniqueQueryTokens.filter((token) => surface.includes(token));
        let score = uniqueQueryTokens.length ? matched.length / uniqueQueryTokens.length : 0.25;
        const exactIdentifier = [identity?.sku, identity?.model].some(
          (value) => value && includesPhrase(surface, value),
        );
        if (exactIdentifier) score += 0.48;
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
        };
      })
      .sort((left, right) => right.score - left.score);
  }
}

export class ExperimentalSearchV3 {
  private readonly enabled: boolean;
  private readonly reranker: MultimodalReranker;

  constructor(private readonly options: ExperimentalSearchV3Options) {
    this.enabled = options.enabled ?? false;
    this.reranker = options.reranker ?? new DeterministicMultimodalReranker();
  }

  async search(request: V3Request): Promise<{ products: V3ProductResult[]; diagnostics: V3Diagnostics }> {
    const startedAt = Date.now();
    const parsed = await deterministicIntentParser.parse(request.query);
    applyExplicitIdentifierIntent(request.query, parsed);
    if (request.reference?.brand && !parsed.brand) parsed.brand = request.reference.brand;
    if (!parsed.location) parsed.location = explicitLocation(request.query);
    const intent = buildV3Intent(request, parsed);
    const queries = uniqueQueries(request, intent);
    const diagnostics: V3Diagnostics = {
      enabled: this.enabled,
      parsedIntent: { ...intent },
      generatedQueries: queries,
      sourcesSearched: [],
      resultCountPerSource: {},
      totalCandidates: 0,
      deduplicatedCandidates: 0,
      removedByConstraints: 0,
      rerankedCandidates: 0,
      confidenceScores: [],
      passes: [],
      totalLatencyMs: 0,
      providerInvocationCount: 0,
      externalApiCallCount: 0,
    };
    if (!this.enabled || !queries.length) {
      diagnostics.totalLatencyMs = Date.now() - startedAt;
      return { products: [], diagnostics };
    }

    const official = this.options.registry
      .getSearchProviders()
      .filter((provider) => provider.metadata.integrationType !== "web_search")
      .slice(0, MAX_OFFICIAL_PROVIDERS);
    const sources = [
      ...official,
      ...(this.options.brave?.metadata.enabled && this.options.brave.metadata.searchEnabled
        ? [this.options.brave]
        : []),
    ];
    const uniqueSources = [...new Map(sources.map((provider) => [provider.metadata.id, provider])).values()];
    const allCandidates: ProviderProduct[] = [];
    const searchedSources = new Set<string>();

    const runPass = async (pass: 1 | 2, query: string) => {
      const tasks = uniqueSources.map(async (provider) => {
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
      diagnostics.passes.push({ pass, query, candidates: allCandidates.length });
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
      const ranked = await bounded(
        this.reranker.rerank({ request, intent }, eligible),
        RERANK_TIMEOUT_MS,
      );
      const bestScore = ranked[0]?.score ?? 0;
      return { deduped, eligible, ranked, bestScore };
    };

    let result = await runPass(1, queries[0]);
    const weak = result.bestScore < 0.58 || result.eligible.length === 0;
    if (weak && queries.length > 1) {
      result = await runPass(2, queries[1]);
    }

    diagnostics.sourcesSearched = [...searchedSources];
    diagnostics.parsedIntent = { ...intent };
    diagnostics.deduplicatedCandidates = result.deduped.length;
    diagnostics.removedByConstraints = Math.max(0, result.deduped.length - result.eligible.length);
    diagnostics.rerankedCandidates = result.ranked.length;
    const products = result.ranked.slice(0, 30).map((candidate) => ({
      product: candidate.product,
      score: candidate.score,
      confidence: classifyConfidence(candidate, request, intent),
      reasons: candidate.reasons.length
        ? candidate.reasons
        : explain(candidate.product, request, intent, candidate.score),
    }));
    diagnostics.confidenceScores = products.map((product) => product.score);
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