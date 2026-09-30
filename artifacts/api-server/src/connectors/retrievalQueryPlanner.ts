import {
  expandShoppingQuery,
  getShoppingVocabularyAliases,
  hasConfidentLouisVuittonShoppingContext,
  normalizeArabicForSearch,
} from "./queryExpansion";
import { createSearchRelevanceGate } from "./relevanceGate";
import type { ProviderSearchRequest } from "./types";

export const MAX_EXTERNAL_RETRIEVAL_QUERIES = 3;

const ARABIC_SCRIPT = /[\u0600-\u06ff]/u;
const SHOPPING_FILLER = new Set([
  "a", "an", "and", "buy", "find", "for", "i", "looking", "need", "of",
  "please", "search", "shop", "the", "to", "want", "ابحث", "ابغا", "ابغي",
  "ابي", "اريد", "اشتري", "شراء", "دورلي", "عن", "في", "من", "و",
]);
const PRICE_OR_LABEL_WORDS = new Set([
  "about", "above", "approx", "approximately", "around", "at", "below",
  "budget", "eu", "less", "max", "maximum", "min", "minimum", "mm", "over",
  "price", "size", "than", "under", "uk", "us", "waist", "inseam",
]);
const PRICE_AND_SIZE_PHRASES =
  /\b(?:under|below|less\s+than|at\s+most|no\s+more\s+than|maximum|max(?:imum)?\s+price|above|over|more\s+than|around|about|approximately|approx\.?|size|waist)\s*[:#-]?\s*[$€£]?\s*[\d,]+(?:\.\d+)?/giu;
const ARABIC_PRICE_PHRASES =
  /(?:^|[^\p{L}\p{N}])(?:أقل(?:\s+من)?|اقل(?:\s+من)?|ما\s*يتعد[ىي]|لا\s*يتعد[ىي]|ما\s*يتجاوز|لا\s*يتجاوز|بحد\s+اقصى|حد\s+اقصى|اقصى\s+سعر|ميزانيتي|ميزانية|أكبر\s+من|اكبر\s+من|أكثر\s+من|اكثر\s+من|فوق|حوالي|حوالى|حدود|تقريبا|تقريباً)\s*[0-9٠-٩۰-۹,]+(?:[.,][0-9٠-٩۰-۹]+)?/giu;
const ARABIC_SIZE_PHRASES =
  /(?:^|[^\p{L}\p{N}])مقاس\s*[-:]?\s*[0-9٠-٩۰-۹,]+(?:[.,][0-9٠-٩۰-۹]+)?(?=$|[^\p{L}\p{N}])/giu;
const ARABIC_PRICE_FILLER_WORDS =
  /(?:^|[^\p{L}\p{N}])(?:أقل|اقل|من|ميزانيتي|ميزانية|سعر|تقريبا|تقريباً|حدود|بحد|اقصى|حتى|حتي)(?=$|[^\p{L}\p{N}])/giu;
const CURRENCY_TOKENS =
  /(?:\b(?:sar|usd|aed|kwd|bhd|eur|gbp|ksa)\b|ر\.?\s*س|ريال(?:\s+سعودي)?|دولار(?:\s+امريكي)?|درهم(?:\s+اماراتي)?|دينار\s+(?:كويتي|بحريني)|يورو|جنيه\s+استرليني|[$€£])/giu;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function normalizePlannerDigits(value: string) {
  const digits = "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹";
  return value.replace(/[٠-٩۰-۹]/gu, (digit) => {
    const index = digits.indexOf(digit);
    return String(index < 10 ? index : index - 10);
  });
}

function removePhrase(value: string, phrase: string) {
  const escaped = escapeRegExp(phrase.trim());
  if (!escaped) return value;
  return value.replace(
    new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "giu"),
    " ",
  );
}

function cleanResidual(
  value: string,
  intent: ProviderSearchRequest["intent"],
  identifiers: readonly string[],
  options: { preserveGenericSize?: boolean } = {},
) {
  let residual = value;
  const protectedMeasurements: string[] = [];
  const protectedDimensions: string[] = [];
  residual = residual.replace(
    options.preserveGenericSize
      ? /(?:^|[^\p{L}\p{N}])(?:waist|size|مقاس)\s*[-:]?\s*[\d,]+(?:\.\d+)?(?=$|[^\p{L}\p{N}])/giu
      : /(?:^|[^\p{L}\p{N}])waist\s*[-:]?\s*[\d,]+(?:\.\d+)?(?=$|[^\p{L}\p{N}])/giu,
    (dimension) => {
      const token = `__PLANNER_DIMENSION_${protectedDimensions.length}__`;
      protectedDimensions.push(dimension);
      return token;
    },
  );
  residual = residual.replace(
    /(?:^|[^\p{L}\p{N}])(?:size|waist|inseam|مقاس)\s*[-:]?\s*[0-9٠-٩۰-۹]+(?:[.,][0-9٠-٩۰-۹]+)?\s*(?:mm|cm|inches?|in|مم|سم)(?=$|[^\p{L}\p{N}])/giu,
    (measurement) => {
      const token = `__PLANNER_MEASUREMENT_${protectedMeasurements.length}__`;
      protectedMeasurements.push(measurement);
      return token;
    },
  );
  const knownFields = [
    intent?.brand,
    intent?.productType,
    intent?.audience,
    intent?.color,
    intent?.condition,
    intent?.vehicleMake,
    intent?.vehicleModel,
    intent?.partName,
  ].filter((field): field is string => Boolean(field));

  residual = residual.replace(
    /(?:^|[^\p{L}\p{N}])(?:sku|model(?:\s+(?:number|no\.?))?|part(?:\s+(?:number|no\.?))?|oem)\s*[:#=]?\s*[a-z0-9](?:[a-z0-9._/-]*[a-z0-9])?(?=$|[^\p{L}\p{N}])/giu,
    " ",
  );
  for (const token of residual.split(/\s+/u)) {
    const aliases = getShoppingVocabularyAliases(token);
    if (
      aliases.length > 1 &&
      !PRICE_OR_LABEL_WORDS.has(normalizeArabicForSearch(token))
    ) {
      residual = removePhrase(residual, token);
    }
  }
  for (const field of knownFields) {
    for (const alias of getShoppingVocabularyAliases(field)) {
      residual = removePhrase(residual, alias);
    }
    residual = removePhrase(residual, field);
  }
  for (const identifier of identifiers) {
    residual = removePhrase(residual, identifier);
  }

  residual = residual
    .replace(PRICE_AND_SIZE_PHRASES, " ")
    .replace(ARABIC_PRICE_PHRASES, " ")
    .replace(ARABIC_SIZE_PHRASES, " ")
    .replace(CURRENCY_TOKENS, " ")
    .replace(/\b(?:maximum|max|min(?:imum)?|price|budget|approximately|approx\.?|under|below|above|over|around|about|less|than)\b/giu, " ")
    .replace(ARABIC_PRICE_FILLER_WORDS, " ");

  residual = residual.replace(
    /__PLANNER_MEASUREMENT_(\d+)__/gu,
    (_placeholder, index: string) => protectedMeasurements[Number(index)] ?? "",
  );
  residual = residual.replace(
    /__PLANNER_DIMENSION_(\d+)__/gu,
    (_placeholder, index: string) => protectedDimensions[Number(index)] ?? "",
  );

  return residual
    .split(/[\s/_,;:()[\]{}]+/u)
    .map((token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}-]+$/gu, ""))
    .filter((token) => {
      const normalized = normalizeArabicForSearch(token);
      return (
        (token.length > 1 || /^\d{1,4}$/u.test(token)) &&
        !SHOPPING_FILLER.has(normalized)
      );
    })
    .join(" ");
}

function extractLabeledOpaqueIdentifiers(query: string) {
  const identifiers: string[] = [];
  const pattern =
    /(?:^|[^\p{L}\p{N}])(?:sku|model(?:\s+(?:number|no\.?))?|part(?:\s+(?:number|no\.?))?|oem)\s*[:#=]?\s*([a-z0-9](?:[a-z0-9._/-]*[a-z0-9])?)(?=$|[^\p{L}\p{N}])/giu;
  for (const match of query.matchAll(pattern)) {
    if (match[1] && !identifiers.includes(match[1])) identifiers.push(match[1]);
  }
  return identifiers;
}

function originalIdentifierSpelling(identifier: string, query: string) {
  const escaped = escapeRegExp(identifier);
  const match = query.match(
    new RegExp(`(?:^|[^\\p{L}\\p{N}])(${escaped})(?=$|[^\\p{L}\\p{N}])`, "iu"),
  );
  return match?.[1] ?? identifier;
}

function englishProductSynonym(productType: string | undefined) {
  if (!productType) return undefined;
  const aliases = getShoppingVocabularyAliases(productType);
  const canonical = normalizeArabicForSearch(productType);
  return aliases.find(
    (alias) =>
      /[a-z]/iu.test(alias) &&
      !ARABIC_SCRIPT.test(alias) &&
      normalizeArabicForSearch(alias) !== canonical,
  );
}

function arabicAlias(value: string | undefined, originalQuery: string) {
  if (!value) return undefined;
  const normalizedQuery = normalizeArabicForSearch(originalQuery);
  const arabicAliases = getShoppingVocabularyAliases(value).filter((alias) =>
    ARABIC_SCRIPT.test(alias),
  );
  const exactAlias = arabicAliases.find((alias) => {
    const escaped = escapeRegExp(alias.trim());
    return new RegExp(
      `(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`,
      "iu",
    ).test(originalQuery);
  });
  return exactAlias ?? arabicAliases.find((alias) => {
    const normalizedAlias = normalizeArabicForSearch(alias);
    const escaped = escapeRegExp(normalizedAlias);
    return new RegExp(
      `(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`,
      "iu",
    ).test(normalizedQuery);
  }) ?? arabicAliases[0];
}

function bilingualStructuredTerm(value: string | undefined, originalQuery: string) {
  if (!value) return [];
  const translation = arabicAlias(value, originalQuery);
  return translation &&
      normalizeArabicForSearch(translation) !== normalizeArabicForSearch(value)
    ? [value, translation]
    : [value];
}

function priceTerms(
  intent: ProviderSearchRequest["intent"],
  query: string,
) {
  const numberPattern = "([0-9][0-9,]*(?:\\.[0-9]+)?)";
  const parseNumber = (value: string | undefined) =>
    value ? Number(value.replaceAll(",", "")) : undefined;
  const rawMax = query.match(
    new RegExp(`(?:under|below|less\\s+than|at\\s+most|max(?:imum)?\\s+price|اقل(?:\\s+من)?)\\s*[$€£]?\\s*${numberPattern}`, "iu"),
  )?.[1];
  const rawMin = query.match(
    new RegExp(`(?:over|above|more\\s+than|اكبر\\s+من|اكثر\\s+من|فوق)\\s*[$€£]?\\s*${numberPattern}`, "iu"),
  )?.[1];
  const rawApproximate = query.match(
    new RegExp(`(?:around|about|approximately|approx\\.?|حوالي|حوالى|حدود|تقريبا|تقريباً)\\s*[$€£]?\\s*${numberPattern}`, "iu"),
  )?.[1];
  const maxPrice = intent?.maxPrice ?? parseNumber(rawMax);
  const minPrice = intent?.minPrice ?? parseNumber(rawMin);
  const approximatePrice =
    intent?.approximatePrice ?? parseNumber(rawApproximate);
  const currency =
    intent?.currency ??
    (/\b(?:sar|ر\.?\s*س)\b|ريال/iu.test(query)
      ? "SAR"
      : /\b(?:usd|us\$)\b|\$|دولار/iu.test(query)
        ? "USD"
        : /\bAED\b|درهم/iu.test(query)
          ? "AED"
          : undefined);
  const english: string[] = [];
  const arabic: string[] = [];
  if (minPrice !== undefined && maxPrice !== undefined) {
    english.push(`between ${minPrice} and ${maxPrice}`);
    arabic.push(`من ${minPrice} إلى ${maxPrice}`);
  } else if (maxPrice !== undefined) {
    english.push(`under ${maxPrice}`);
    arabic.push(`أقل من ${maxPrice}`);
  } else if (minPrice !== undefined) {
    english.push(`above ${minPrice}`);
    arabic.push(`أكثر من ${minPrice}`);
  } else if (approximatePrice !== undefined) {
    english.push(`around ${approximatePrice}`);
    arabic.push(`حوالي ${approximatePrice}`);
  }
  if (currency) {
    if (english.length) english[0] += ` ${currency}`;
    if (arabic.length) arabic[0] += ` ${currency}`;
  }
  return { english, arabic };
}

function normalizeDedupeKey(value: string) {
  return normalizeArabicForSearch(value)
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

/**
 * Builds at most three stable search strings from the request and its parsed
 * intent. The structured query preserves constraints; legacy expansion and
 * relevance helpers supply bilingual concepts and inferred type/size/models.
 */
export function planRetrievalQueries(
  query: string,
  intent: ProviderSearchRequest["intent"] = {},
): string[] {
  const gateQuery = intent.normalized?.trim() || query;
  const gate = createSearchRelevanceGate(gateQuery, intent);
  const expansion = expandShoppingQuery(query);
  const productType = intent.productType ?? gate.requestedType ??
    expansion.productTerms[0];
  const product = productType ?? "";
  const hasLVAbbreviation =
    /(?:^|[^\p{L}\p{N}])(?:lv|ال\s*في|إل\s*في|الفي)(?=$|[^\p{L}\p{N}])/iu.test(query);
  const brand = intent.brand ??
    (hasLVAbbreviation && hasConfidentLouisVuittonShoppingContext(query)
      ? "Louis Vuitton"
      : undefined);
  const identifiers = [...gate.identifiers];
  const modelIdentifiers = identifiers.filter((identifier) =>
    /\d/u.test(identifier),
  );
  const opaqueIdentifiers = extractLabeledOpaqueIdentifiers(
    [query, intent.raw].filter(Boolean).join(" "),
  );
  const opaqueKeys = new Set(opaqueIdentifiers.map(normalizeDedupeKey));
  const rawModelIdentifiers = modelIdentifiers.map((identifier) =>
    originalIdentifierSpelling(identifier, query),
  );
  const modelTerms = [
    ...opaqueIdentifiers,
    ...rawModelIdentifiers.filter(
      (identifier) => !opaqueKeys.has(normalizeDedupeKey(identifier)),
    ),
  ];
  const jeansProduct = /jean|denim/iu.test(productType ?? "");
  const normalizedRawQuery = normalizePlannerDigits(query);
  const hasExplicitWaist = jeansProduct &&
    /(?:^|[^\p{L}\p{N}])waist\s*[-:]?\s*\d+(?:\.\d+)?(?=$|[^\p{L}\p{N}])/iu.test(normalizedRawQuery);
  const explicitMeasurementForRequestedSize =
    gate.requestedSize !== undefined &&
    [...normalizedRawQuery.matchAll(
      /(?:^|[^\p{L}\p{N}])(?:size|waist|inseam|مقاس)?\s*[-:]?(\d+(?:\.\d+)?)\s*(?:mm|cm|inches?|in|مم|سم)(?=$|[^\p{L}\p{N}])/giu,
    )].some((match) => {
      const measurement = Number(match[1]);
      const requested = Number(gate.requestedSize);
      return measurement === requested || Math.floor(measurement) === requested;
    });
  const explicitInseamForRequestedSize =
    gate.requestedSize !== undefined &&
    new RegExp(`\\binseam\\s*[-:]?\\s*${gate.requestedSize}\\b`, "iu").test(normalizedRawQuery) &&
    !new RegExp(`\\bwaist\\s*[-:]?\\s*${gate.requestedSize}\\b`, "iu").test(normalizedRawQuery);
  const size = explicitMeasurementForRequestedSize ||
      explicitInseamForRequestedSize ||
      hasExplicitWaist
    ? undefined
    : gate.requestedSize;
  const isJeans = jeansProduct;
  const shoeSizeMatch = query.match(
    /(?:^|[^\p{L}\p{N}])(?:size\s*)?(EU|UK|US)\s*(?:size\s*)?[-:]?\s*\d{1,3}(?=$|[^\p{L}\p{N}])|(?:^|[^\p{L}\p{N}])(?:size\s*)?\d{1,3}\s*(EU|UK|US)(?=$|[^\p{L}\p{N}])/iu,
  );
  const shoeSizeSystem = (shoeSizeMatch?.[1] ?? shoeSizeMatch?.[2])
    ?.toLocaleUpperCase();
  const sizeTerm = size
    ? isJeans && gate.sizeDimension === "apparel"
      ? `waist ${size}`
      : gate.sizeDimension === "shoe"
        ? `${shoeSizeSystem ?? "size"} ${size}`
        : `size ${size}`
    : undefined;
  let residual = cleanResidual(
    query,
    { ...intent, brand },
    [...identifiers, ...opaqueIdentifiers],
    { preserveGenericSize: hasExplicitWaist },
  );
  if (size && shoeSizeSystem) {
    residual = removePhrase(residual, shoeSizeSystem);
  }
  const modelTerm = modelTerms.join(" ");
  const audience = intent.audience;
  const color = intent.color;
  const condition = intent.condition && intent.condition !== "unknown"
    ? intent.condition
    : intent.newOrUsed && intent.newOrUsed !== "unknown"
      ? intent.newOrUsed
      : undefined;
  const price = priceTerms(intent, query);

  const commonEnglish = [
    brand,
    modelTerm,
    audience,
    color,
    product,
    sizeTerm,
    condition,
    intent.vehicleMake,
    intent.vehicleModel,
    intent.vehicleYear,
    intent.partName,
    intent.partNumber,
    intent.oemNumber,
    intent.location,
    residual,
    ...price.english,
  ].filter(Boolean).join(" ");
  const englishQuery = [
    commonEnglish,
    product ? "product listing" : undefined,
    "Saudi Arabia",
  ].filter(Boolean).join(" ").replace(/\s+/gu, " ").trim();

  const synonym = englishProductSynonym(productType);
  const synonymQuery = synonym
    ? [
        brand,
        modelTerm,
        audience,
        color,
        synonym,
        sizeTerm,
        condition,
        intent.vehicleMake,
        intent.vehicleModel,
        intent.vehicleYear,
        intent.partName,
        intent.partNumber,
        intent.oemNumber,
        intent.location,
        residual,
        ...price.english,
        "product listing",
        "Saudi Arabia",
      ].filter(Boolean).join(" ").replace(/\s+/gu, " ").trim()
    : undefined;

  const arabicBase = [
    ...bilingualStructuredTerm(productType, query),
    ...bilingualStructuredTerm(brand, query),
    modelTerm,
    ...bilingualStructuredTerm(audience, query),
    ...bilingualStructuredTerm(color, query),
    sizeTerm
      ? isJeans && gate.sizeDimension === "apparel"
        ? `مقاس ${size}`
        : gate.sizeDimension === "shoe"
          ? `${shoeSizeSystem ? `${shoeSizeSystem} ` : "مقاس "}${size}`
          : `مقاس ${size}`
      : undefined,
    ...bilingualStructuredTerm(condition, query),
    ...bilingualStructuredTerm(intent.vehicleMake, query),
    intent.vehicleModel,
    intent.vehicleYear,
    ...bilingualStructuredTerm(intent.partName, query),
    intent.partNumber,
    intent.oemNumber,
    intent.location,
    residual,
    ...price.arabic,
    "السعودية",
  ].filter(Boolean).join(" ").replace(/\s+/gu, " ").trim();

  const candidates = [
    englishQuery || query.trim(),
    synonymQuery,
    arabicBase,
  ];
  const results: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const value = candidate?.replace(/\s+/gu, " ").trim();
    if (!value) continue;
    const key = normalizeDedupeKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    results.push(value);
    if (results.length === MAX_EXTERNAL_RETRIEVAL_QUERIES) break;
  }

  return results;
}