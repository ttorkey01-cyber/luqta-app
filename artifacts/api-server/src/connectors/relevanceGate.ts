import type {
  NormalizedProduct,
  ProviderProduct,
  QueryIntent,
} from "./types";

export type RelevanceState = "MATCH" | "POSSIBLE" | "CONFLICT" | "UNKNOWN";

type Evidence = {
  productType: RelevanceState;
  size: RelevanceState;
  identifier: RelevanceState;
};

export type SearchRelevanceGate = {
  readonly query: string;
  readonly intent?: QueryIntent;
  readonly requestedType?: string;
  readonly requestedSize?: string;
  readonly sizeDimension?: "apparel" | "shoe" | "unknown";
  readonly identifiers: readonly string[];
  readonly requiresExactModel: boolean;
};

type TypeDefinition = {
  value: string;
  aliases: readonly string[];
  domain: string;
};

const PRODUCT_TYPES: readonly TypeDefinition[] = [
  { value: "sunglasses", domain: "eyewear", aliases: ["sunglasses", "نظارة شمسية", "نظارات شمسية"] },
  { value: "t-shirt", domain: "clothing", aliases: ["t-shirt", "tshirt", "tee", "تيشيرت", "تي شيرت", "تشيرت"] },
  { value: "spare parts", domain: "automotive", aliases: ["spare parts", "auto parts", "قطع غيار"] },
  { value: "headlight", domain: "automotive", aliases: ["headlight", "headlights", "headlamp", "headlamps", "شمعة", "شمعه", "شمعات"] },
  { value: "handbag", domain: "bags", aliases: ["handbag", "handbags", "hand bag", "purse", "bag", "bags", "شنطة", "شنطه", "حقيبة", "حقيبه", "شنط", "حقائب"] },
  { value: "wallet", domain: "bags", aliases: ["wallet", "wallets", "card holder", "محفظة", "محفظه"] },
  { value: "phone accessory", domain: "electronics", aliases: ["mobile phone holder", "phone holder", "phone case", "smartphone case", "iphone case", "phone cover", "smartphone cover", "smartphone wristlet", "phone wristlet", "screen protector", "phone stand", "كفر جوال", "حافظة جوال"] },
  { value: "phone", domain: "electronics", aliases: ["smartphone", "mobile phone", "cell phone", "phone", "mobile", "جوال", "موبايل", "هاتف"] },
  { value: "watch", domain: "watches", aliases: ["watch", "watches", "ساعة", "ساعه", "ساعات"] },
  { value: "watch band", domain: "watches", aliases: ["watch band", "watchband", "watch strap", "ساعة يد"] },
  { value: "jeans", domain: "clothing", aliases: ["jeans", "jean", "denim", "جينز"] },
  { value: "jacket", domain: "clothing", aliases: ["jacket", "jackets", "جاكيت", "جاكيتات"] },
  { value: "dress", domain: "clothing", aliases: ["dress", "dresses", "فستان", "فساتين"] },
  { value: "shirt", domain: "clothing", aliases: ["shirt", "shirts", "قميص", "قمصان"] },
  { value: "pants", domain: "clothing", aliases: ["pants", "trousers", "بنطلون", "بناطيل"] },
  { value: "shoes", domain: "footwear", aliases: ["sneakers", "trainers", "footwear", "shoes", "shoe", "حذاء", "احذية", "أحذية", "جزم", "جزمة"] },
  { value: "paddle brush", domain: "grooming", aliases: ["paddle brush", "hair brush", "hairbrush", "brush", "فرشاة شعر", "فرشه شعر", "فرشاة", "فرشه"] },
  { value: "shampoo", domain: "beauty", aliases: ["shampoo", "شامبو"] },
  { value: "hair styling tool", domain: "beauty", aliases: ["hair straightener", "hair styler", "hot air styler", "hot air stylers", "مكواة فرد الشعر", "مصفف الشعر", "أجهزة تمليس الشعر", "اجهزة تمليس الشعر"] },
  { value: "grooming", domain: "grooming", aliases: ["beard trimmer", "hair trimmer", "shaver", "razor", "trimmer", "ماكينة حلاقة", "ماكينه حلاقه", "حلاقة", "حلاقه"] },
  { value: "cream", domain: "beauty", aliases: ["hair cream", "face cream", "cream", "كريم"] },
  { value: "cleanser", domain: "beauty", aliases: ["cleanser", "face wash", "غسول"] },
  { value: "perfume", domain: "beauty", aliases: ["perfume", "fragrance", "parfum", "cologne", "عطر", "عطور"] },
  { value: "makeup", domain: "beauty", aliases: ["makeup", "cosmetics", "مكياج"] },
  { value: "toaster", domain: "home", aliases: ["toaster", "toasters", "محمصة", "توستر"] },
  { value: "headphones", domain: "electronics", aliases: ["headphones", "earphones", "headset", "سماعات", "سماعة"] },
  { value: "laptop", domain: "electronics", aliases: ["laptop", "notebook", "لابتوب"] },
  { value: "television", domain: "electronics", aliases: ["television", "tv", "تلفزيون"] },
  { value: "chair", domain: "home", aliases: ["chair", "chairs", "كرسي", "كراسي"] },
  { value: "table", domain: "home", aliases: ["table", "desk", "طاولة", "طاوله"] },
  { value: "sofa", domain: "home", aliases: ["sofa", "couch", "كنبة", "كنبه", "اريكة", "أريكة"] },
  { value: "car", domain: "automotive", aliases: ["car", "automotive", "سيارة", "سياره"] },
  { value: "tire", domain: "automotive", aliases: ["tire", "tyre", "كفر", "اطار", "إطار"] },
];

const TYPE_ALIASES = PRODUCT_TYPES.flatMap((definition) =>
  definition.aliases.map((alias) => ({ ...definition, alias })),
).sort((a, b) => b.alias.length - a.alias.length);

function normalizeText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[٠-٩]/gu, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/gu, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
}

function hasPhrase(text: string, phrase: string) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    `(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`,
    "iu",
  ).test(text);
}

function detectType(text: string) {
  const normalized = normalizeText(text);
  return TYPE_ALIASES.find(({ alias }) => hasPhrase(normalized, alias));
}

function resolveRequestedType(query: string, intent?: QueryIntent) {
  const explicitQueryType = detectType(query);
  if (explicitQueryType) return explicitQueryType;
  // A sports-shoe brand with an EU-range numeric size and no other named
  // family is footwear context, not a 42 mm watch-band request.
  const normalized = normalizeText(query);
  const labeledSize = normalized.match(/(?:size|مقاس)\s*(\d{2})(?!\d)/iu);
  if (/\bnike\b/iu.test(normalized) &&
      labeledSize && Number(labeledSize[1]) >= 35 && Number(labeledSize[1]) <= 50 &&
      !/\b(?:watch|band|strap|apparel|shirt|jacket|jeans)\b|ساعة|سوار/iu.test(normalized)) {
    return PRODUCT_TYPES.find(({ value }) => value === "shoes");
  }
  for (const candidate of [intent?.productType, intent?.raw, intent?.normalized]) {
    if (!candidate?.trim()) continue;
    const found = detectType(candidate);
    if (found) return found;
  }
  if (/\b(?:iphone\s+\d{1,3}|s\d{2}(?:\s+(?:ultra|plus|fe))?)\b/iu.test(query)) {
    return PRODUCT_TYPES.find(({ value }) => value === "phone");
  }
  return undefined;
}

function extractSize(query: string, intent?: QueryIntent) {
  const combined = [query, intent?.raw, intent?.normalized]
    .filter(Boolean)
    .join(" ");
  const match = normalizeText(combined).match(
    /(?:^|[^\p{L}\p{N}])(?:size|مقاس)\s*(\d{1,3})(?=$|[^\p{L}\p{N}])/iu,
  );
  if (!match) return undefined;
  const requestedType = resolveRequestedType(query, intent);
  const sizeDimension =
    requestedType?.value === "shoes"
      ? "shoe"
      : requestedType?.value === "jeans"
        ? "apparel"
        : "unknown";
  return { value: match[1], dimension: sizeDimension as SearchRelevanceGate["sizeDimension"] };
}

function extractIdentifiers(query: string, intent?: QueryIntent) {
  const original = [query, intent?.raw, intent?.normalized]
    .filter(Boolean)
    .join(" ");
  const normalized = normalizeText(original);
  const identifiers: string[] = [];
  const add = (value: string) => {
    if (!identifiers.some((item) => normalizeText(item) === normalizeText(value))) {
      identifiers.push(value.trim());
    }
  };

  const nonIdentifierPrefixes = new Set([
    "above", "around", "below", "between", "from", "inseam", "max",
    "less", "minimum", "over", "price", "sar", "size", "under", "waist",
  ]);
  for (const match of original.matchAll(
    /\b(?=[a-z0-9-]{6,24}\b)(?=[a-z0-9-]*\d)[a-z][a-z0-9]*(?:-[a-z0-9]+)+\b/giu,
  )) {
    const token = match[0];
    const prefix = token.split("-")[0].toLocaleLowerCase();
    if (!nonIdentifierPrefixes.has(prefix)) add(token);
  }

  const iphone = normalized.match(
    /\biphone\s+\d{1,3}(?:\s+(?:pro\s+max|pro|plus|mini))?\b/iu,
  );
  if (iphone) {
    const canonical = iphone[0].replace(/\biphone\b/iu, "iPhone");
    add(canonical);
  }

  const samsung = normalized.match(/\bs\d{2}\s+(?:ultra|plus|fe)\b/iu);
  if (samsung) {
    add(
      samsung[0]
        .split(/\s+/u)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" "),
    );
  }
  else {
    const sModel = normalized.match(/\bs\d{2}\b/iu);
    if (sModel && (/\bsamsung\b/iu.test(normalized) || /^\s*s\d{2}\s*$/iu.test(query))) {
      add(sModel[0].toUpperCase());
    }
  }

  const labeledPart = original.match(
    /(?:part(?:\s+number|\s*#)?|oem)\s*[:#-]?\s*([a-z0-9-]{5,24})/iu,
  );
  if (labeledPart?.[1]) add(labeledPart[1]);
  return identifiers;
}

export function createSearchRelevanceGate(
  query: string,
  intent?: QueryIntent,
): SearchRelevanceGate {
  const requestedType = resolveRequestedType(query, intent);
  const size = extractSize(query, intent);
  const identifiers = extractIdentifiers(query, intent);
  return {
    query,
    intent,
    requestedType: requestedType?.value,
    requestedSize: size?.value,
    sizeDimension: size?.dimension,
    identifiers,
    requiresExactModel: identifiers.length > 0,
  };
}

type ProductWithCanonicalEvidence = ProviderProduct & {
  canonical?: {
    category?: string | null;
    productType?: string | null;
    subcategory?: string | null;
    title?: string;
    description?: string | null;
  };
};

function productText(product: ProductWithCanonicalEvidence) {
  return [
    product.productType,
    product.subcategory,
    product.title,
    product.canonical?.productType,
    product.canonical?.subcategory,
    product.canonical?.title,
  ]
    .filter(Boolean)
    .join(" ");
}

function domainForCategory(category?: string | null) {
  const normalized = normalizeText(category ?? "").replace(/[_-]/gu, " ");
  if (/beauty|groom|cosmetic|personal care|skin care|hair|styler|العناية|تجميل|جمال|صحة|الشعر|تمليس/iu.test(normalized)) return "beauty";
  if (/bag|accessor/iu.test(normalized)) return "bags";
  if (/electronic/iu.test(normalized)) return "electronics";
  if (/watch|jewel/iu.test(normalized)) return "watches";
  if (/shoe|footwear/iu.test(normalized)) return "footwear";
  if (/fashion|clothing/iu.test(normalized)) return "clothing";
  if (/home|living/iu.test(normalized)) return "home";
  if (/automotive|vehicle|car parts/iu.test(normalized)) return "automotive";
  if (/eyewear|glasses/iu.test(normalized)) return "eyewear";
  return undefined;
}

function productTypeCompatibility(product: ProductWithCanonicalEvidence, gate: SearchRelevanceGate): RelevanceState {
  if (!gate.requestedType) return "UNKNOWN";
  const requested = PRODUCT_TYPES.find((definition) => definition.value === gate.requestedType);
  if (!requested) return "UNKNOWN";
  const title = normalizeText(product.title);
  // An accessory's compatible phone model is not evidence that it is a phone.
  if (requested.value === "phone" &&
      (/\b(?:phone|smartphone|mobile|iphone|galaxy)\b.{0,45}\b(?:case|cover|wristlet|screen protector|holder|stand|charger|charging cable|cable|band|shell|skin)\b/iu.test(title) ||
       /\b(?:case|cover|wristlet|screen protector|holder|stand|charger|cable)\b.{0,45}\b(?:for|phone|smartphone|iphone|galaxy)\b/iu.test(title) ||
       /كفر|جراب|حافظة|غطاء|واقي شاشة|شاحن|كيبل|سلك جوال/iu.test(title))) {
    return "CONFLICT";
  }
  // Explicit catalog type beats incidental terms in a title or description.
  const declared = [
    product.productType,
    product.canonical?.productType,
    product.subcategory,
    product.canonical?.subcategory,
  ]
    .filter((value): value is string => Boolean(value))
    .map(detectType)
    .find(Boolean);
  if (declared && declared.value !== requested.value) return "CONFLICT";
  const candidate = declared ?? detectType(productText(product));
  if (candidate) {
    if (candidate.value === requested.value) return "MATCH";
    return "CONFLICT";
  }
  const categoryDomain =
    domainForCategory(product.category) ??
    domainForCategory(product.canonical?.category);
  if (!categoryDomain) return "UNKNOWN";
  if (categoryDomain === requested.domain) return "POSSIBLE";
  return "CONFLICT";
}

function sizeCompatibility(product: ProviderProduct, gate: SearchRelevanceGate): RelevanceState {
  const requestedSize = gate.requestedSize;
  if (!requestedSize) return "UNKNOWN";
  const text = normalizeText(
    [product.productType, product.subcategory, product.title, product.description]
      .filter(Boolean)
      .join(" "),
  );
  const waist = text.match(/\b(?:waist|w)\s*[-:]?\s*(\d{1,3})\b/iu);
  const genericSize = text.match(
    /(?:^|[^\p{L}\p{N}])(?:size|eu|uk|us)\s*[-:]?\s*(\d{1,3})(?=$|[^\p{L}\p{N}])/iu,
  );
  const labeledApparelSize = text.match(
    /(?:^|[^\p{L}\p{N}])size\s*[-:]?\s*(\d{1,3})(?=$|[^\p{L}\p{N}])/iu,
  );
  const trailingApparelSize = text.match(
    /\b(\d{1,3})\s+size\s+jeans?\b/iu,
  );
  const jeanContext = /jean|denim|waist/iu.test(text) || gate.requestedType === "jeans";

  if (jeanContext) {
    if (waist) return waist[1] === requestedSize ? "MATCH" : "CONFLICT";
    if (labeledApparelSize) {
      if (labeledApparelSize[1] !== requestedSize) return "CONFLICT";
      return webPageQuality(product) >= 4 ? "UNKNOWN" : "MATCH";
    }
    if (trailingApparelSize) {
      if (trailingApparelSize[1] !== requestedSize) return "CONFLICT";
      return webPageQuality(product) >= 4 ? "UNKNOWN" : "MATCH";
    }
    if (genericSize && /\b(?:eu|uk|us)\s*[-:]?\s*\d+\b/iu.test(text)) {
      return genericSize[1] === requestedSize ? "MATCH" : "CONFLICT";
    }
    return "UNKNOWN";
  }

  if (gate.sizeDimension === "shoe") {
    const trailingShoeSize = text.match(/\b(\d{1,3})\s*(?:eu|uk|us)\b/iu);
    if (trailingShoeSize) {
      return trailingShoeSize[1] === requestedSize ? "MATCH" : "CONFLICT";
    }
  }
  // Inseam numbers are not evidence for the requested waist/apparel size.
  if (/\binseam\s*[-:]?\s*\d{1,3}\b/iu.test(text) && !waist) return "UNKNOWN";
  if (genericSize) {
    if (gate.sizeDimension === "shoe" && /\b(?:eu|uk|us)\s*[-:]?\s*\d+\b/iu.test(text)) {
      return genericSize[1] === requestedSize ? "MATCH" : "CONFLICT";
    }
    return genericSize[1] === requestedSize ? "MATCH" : "CONFLICT";
  }
  if (new RegExp(`\\b${requestedSize}\\s*(?:mm\\b|مم(?=$|[^\\p{L}\\p{N}]))`, "iu").test(text)) {
    return "CONFLICT";
  }
  const bareNumber = new RegExp(
    `(?:^|[^\\p{L}\\p{N}])${requestedSize}(?=$|[^\\p{L}\\p{N}])`,
    "iu",
  );
  return bareNumber.test(text) && gate.sizeDimension !== "unknown"
    ? "POSSIBLE"
    : "UNKNOWN";
}

function containsIdentifier(value: string, identifier: string) {
  if (/^SM-S\d{3,5}$/iu.test(identifier)) {
    return new RegExp(
      `(?:^|[^\\p{L}\\p{N}])${identifier}(?:[a-z])?(?=$|[^\\p{L}\\p{N}])`,
      "iu",
    ).test(normalizeText(value));
  }
  return hasPhrase(normalizeText(value), normalizeText(identifier));
}

function isEditorialWebResult(product: ProviderProduct, exactModelRequest: boolean) {
  if (!/^web(?:_search)?$/iu.test(product.sourceType)) return false;
  const title = normalizeText(product.title);
  const url = normalizeText(product.productUrl ?? "");
  const editorialTitle =
    /\b(review|reviews|comparison|compare|vs\.?|news|article|best\s+\d+|top\s+\d+|guide|buying guide)\b/iu
      .test(title);
  const categoryTitle =
    /\b(category|collection|shop all|all products|all phones|browse|price comparison|price history|prices? (?:in|for|of)|price guide)\b/iu
      .test(title);
  const categoryUrl =
    /\/(?:category|categories|collection|collections|search|compare|prices?)(?:\/|[?#]|$)/iu
      .test(url);
  const isDetailPath = /\/(?:product|products|item|p)(?:\/|[?#]|$)/iu.test(url);
  return editorialTitle ||
    (exactModelRequest && (categoryTitle || (categoryUrl && !isDetailPath)));
}

// This is ranking evidence about a page, not evidence of a product's identity,
// price, stock, or variant availability. Non-web feed entries are product rows.
function webPageQuality(product: ProviderProduct): number {
  if (!/^web(?:_search)?$/iu.test(product.sourceType)) return 1;
  const title = normalizeText(product.title);
  const url = normalizeText(product.productUrl ?? "");
  if (/\b(?:price history|price comparison|compare prices?)\b|كان بكام|تاريخ السعر|مقارنة الأسعار/iu.test(title) ||
      /\/(?:compare|comparison|price-history|prices?)(?:\/|[?#]|$)/iu.test(url)) return 8;
  if (/\b(?:review|reviews|comparison|compare|vs\.?|article|guide|best\s+\d+|top\s+\d+)\b|أفضل\s+(?:\d+\s+)?(?:أنواع?\s+)?(?:ساعات|الساعات)|مقارنة|دليل شامل/iu.test(title) ||
      /\/(?:article|blog|post|reviews?)(?:\/|[?#]|$)/iu.test(url)) return 9;
  // A detail URL is stronger page evidence than a merchant's general "buy" wording.
  if (/\/(?:product|products|item|items|p|itm|listing|dp|pdp)\/[^/?#]+/iu.test(url) ||
      /\/[^/?#]*\d{5,}\.html(?:[?#]|$)/iu.test(url)) {
    return /\b(?:used|secondhand|second-hand|pre-owned|refurbished)\b|مستعمل/iu.test(title) ? 3 : 1;
  }
  if (/\/buy\/?(?:[?#]|$)/iu.test(url) || /\bbuy now\b|اشتري الآن/iu.test(title)) return 2;
  if (/\/(?:market|b)(?:\/|[?#]|$)/iu.test(url)) return 5;
  if (/\b(?:for sale|classifieds|search results|best prices?|all products|all phones)\b|للبيع|أفضل سعر|افضل سعر/iu.test(title) ||
      /\/(?:search|results|s|browse|classifieds)(?:\/|[?#]|$)/iu.test(url)) return 7;
  if (/\b(?:shop all|collection|category|prices? (?:in|for|of))\b|أسعار/iu.test(title) ||
      /\/(?:category|categories|collections?)(?:\/|[?#]|$)/iu.test(url) ||
      /\/(?:denim|joggjeans|jeans|shoes|watches)(?:\.html)?\/?(?:[?#]|$)/iu.test(url) ||
      /(?:^|[-/])(?:jeans|denim|shoes|watches)\/?(?:[?#]|$)/iu.test(url)) return 6;
  // Without a detail or buying signal, a named model can be a merchant model
  // page, not proof of a purchasable variant.
  if (/\b(?:[a-z]{1,5}[-\s]?\d{3,}[a-z0-9-]*|\d{2,4}\s*(?:gb|tb))\b/iu.test(title)) return 4;
  return 6;
}

function identifierCompatibility(product: ProviderProduct, gate: SearchRelevanceGate): RelevanceState {
  if (gate.identifiers.length === 0) return "UNKNOWN";
  const title = product.title ?? "";
  const providerId = product.providerProductId ?? "";
  const preserved = gate.identifiers.every(
    (identifier) =>
      containsIdentifier(title, identifier) ||
      containsIdentifier(providerId, identifier),
  );
  if (!preserved || isEditorialWebResult(product, true)) return "CONFLICT";
  return "MATCH";
}

export function evaluateSearchRelevance(
  product: ProviderProduct,
  gate: SearchRelevanceGate,
): Evidence {
  return {
    productType: productTypeCompatibility(product as ProductWithCanonicalEvidence, gate),
    size: sizeCompatibility(product, gate),
    identifier: identifierCompatibility(product, gate),
  };
}

export function filterSearchRelevance(
  results: NormalizedProduct[],
  gate: SearchRelevanceGate,
  options: { requireProductTypeEvidence?: boolean } = {},
): NormalizedProduct[] {
  return results.filter((product) => {
    if (isEditorialWebResult(product, gate.requiresExactModel)) return false;
    const evidence = evaluateSearchRelevance(product, gate);
    return (
      evidence.productType !== "CONFLICT" &&
      (!options.requireProductTypeEvidence ||
        evidence.productType === "MATCH" ||
        evidence.productType === "POSSIBLE") &&
      evidence.size !== "CONFLICT" &&
      evidence.identifier !== "CONFLICT" &&
      (!gate.requiresExactModel || evidence.identifier === "MATCH")
    );
  });
}

const STATE_ORDER: Record<RelevanceState, number> = {
  MATCH: 0,
  POSSIBLE: 1,
  UNKNOWN: 2,
  CONFLICT: 3,
};

export function sortSearchRelevance(
  results: NormalizedProduct[],
  gate: SearchRelevanceGate,
): NormalizedProduct[] {
  return results
    .map((product, index) => ({
      product,
      index,
      evidence: evaluateSearchRelevance(product, gate),
      pageQuality: webPageQuality(product),
    }))
    .sort((a, b) => {
      // For the same preserved model, weak category evidence ("POSSIBLE")
      // must not let a classifieds collection beat a specific listing whose
      // product type is merely unknown. Neither is an identity assertion.
      const comparableModelPages =
        gate.requiresExactModel &&
        a.evidence.identifier === "MATCH" &&
        b.evidence.identifier === "MATCH" &&
        a.evidence.size === b.evidence.size &&
        a.evidence.productType !== "MATCH" &&
        b.evidence.productType !== "MATCH" &&
        a.evidence.productType !== "CONFLICT" &&
        b.evidence.productType !== "CONFLICT" &&
        /^web(?:_search)?$/iu.test(a.product.sourceType) &&
        /^web(?:_search)?$/iu.test(b.product.sourceType);
      return (
        (comparableModelPages ? a.pageQuality - b.pageQuality : 0) ||
        STATE_ORDER[a.evidence.productType] - STATE_ORDER[b.evidence.productType] ||
        STATE_ORDER[a.evidence.size] - STATE_ORDER[b.evidence.size] ||
        a.pageQuality - b.pageQuality ||
        (b.product.rankScore - a.product.rankScore) ||
        a.index - b.index
      );
    })
    .map(({ product }) => product);
}

export function preserveDistinctiveFallbackQuery(
  original: string,
  planned: string,
  gate: SearchRelevanceGate,
) {
  if (gate.identifiers.length === 0) return planned;
  let preserved = planned.trim();
  for (const identifier of gate.identifiers) {
    if (!containsIdentifier(preserved, identifier)) {
      preserved = `${preserved} ${identifier}`.trim();
    }
  }
  // A planned query may retain a short SKU token while losing model suffixes.
  // Keep the original request intact in that case, so fallback cannot broaden it.
  if (gate.requiresExactModel && !preserved) return original;
  return preserved;
}