import {
  expandShoppingQuery,
  hasConfidentLouisVuittonShoppingContext,
  normalizeArabicForSearch,
} from "./queryExpansion";
import type { QueryIntent } from "./types";

type ProductTypeDefinition = {
  value: string;
  category: string;
  aliases: string[];
};

const PRODUCT_TYPES: ProductTypeDefinition[] = [
  {
    value: "sunglasses",
    category: "eyewear",
    aliases: ["sunglasses", "نظارة شمسية", "نظارات شمسية"],
  },
  {
    value: "t-shirt",
    category: "fashion",
    aliases: ["t-shirt", "tshirt", "tee", "تيشيرت", "تي شيرت", "تشيرت"],
  },
  {
    value: "spare parts",
    category: "automotive",
    aliases: ["spare parts", "auto parts", "قطع غيار"],
  },
  {
    value: "headlight",
    category: "automotive",
    aliases: ["headlight", "headlights", "headlamp", "headlamps", "شمعة", "شمعه", "شمعات"],
  },
  { value: "jeans", category: "fashion", aliases: ["jeans", "jean", "denim", "جينز"] },
  {
    value: "handbag",
    category: "bags_accessories",
    aliases: ["handbag", "handbags", "bag", "bags", "purse", "شنطة", "شنطه", "حقيبة", "حقيبه", "شنط", "حقائب"],
  },
  {
    value: "shoes",
    category: "shoes",
    aliases: ["shoes", "shoe", "sneakers", "حذاء", "احذية", "أحذية", "جزم", "جزمة"],
  },
  {
    value: "watch",
    category: "watches_jewelry",
    aliases: ["watch", "watches", "ساعة", "ساعه", "ساعات"],
  },
  {
    value: "jacket",
    category: "fashion",
    aliases: ["jacket", "jackets", "جاكيت", "جاكيتات"],
  },
  {
    value: "dress",
    category: "fashion",
    aliases: ["dress", "dresses", "فستان", "فساتين"],
  },
  {
    value: "shirt",
    category: "fashion",
    aliases: ["shirt", "shirts", "قميص", "قمصان"],
  },
  {
    value: "pants",
    category: "fashion",
    aliases: ["pants", "trousers", "بنطلون", "بناطيل"],
  },
  {
    value: "perfume",
    category: "beauty_care",
    aliases: ["perfume", "fragrance", "parfum", "cologne", "عطر", "عطور"],
  },
  {
    value: "makeup",
    category: "beauty_care",
    aliases: ["makeup", "cosmetics", "مكياج"],
  },
  {
    value: "cream",
    category: "beauty_care",
    aliases: ["cream", "skincare", "كريم"],
  },
  {
    value: "shampoo",
    category: "beauty_care",
    aliases: ["shampoo", "شامبو"],
  },
  {
    value: "phone",
    category: "electronics",
    aliases: ["phone", "smartphone", "mobile", "جوال", "موبايل", "هاتف"],
  },
  {
    value: "laptop",
    category: "electronics",
    aliases: ["laptop", "notebook", "لابتوب", "حاسوب محمول"],
  },
  {
    value: "headphones",
    category: "electronics",
    aliases: ["headphones", "earphones", "headset", "سماعات", "سماعة"],
  },
  {
    value: "television",
    category: "electronics",
    aliases: ["television", "tv", "display", "تلفزيون", "شاشة"],
  },
  {
    value: "chair",
    category: "home_living",
    aliases: ["chair", "chairs", "كرسي", "كراسي"],
  },
  {
    value: "table",
    category: "home_living",
    aliases: ["table", "desk", "طاولة", "طاوله"],
  },
  {
    value: "sofa",
    category: "home_living",
    aliases: ["sofa", "couch", "كنبة", "كنبه", "اريكة", "أريكة"],
  },
  {
    value: "car",
    category: "automotive",
    aliases: ["car", "automotive", "سيارة", "سياره"],
  },
  {
    value: "tire",
    category: "automotive",
    aliases: ["tire", "tyre", "كفر", "اطار", "إطار"],
  },
];

const AUDIENCES = [
  { value: "men" as const, english: "men", aliases: ["men", "mens", "men's", "male", "رجالي", "رجالية", "رجاليه", "رجال"] },
  { value: "women" as const, english: "women", aliases: ["women", "womens", "women's", "female", "نسائي", "نسائية", "نسائيه", "نساء", "حريمي"] },
  { value: "boys" as const, english: "boys", aliases: ["boys", "boy", "ولادي", "اولاد", "أولاد"] },
  { value: "girls" as const, english: "girls", aliases: ["girls", "girl", "بناتي", "بنات"] },
  { value: "kids" as const, english: "kids", aliases: ["kids", "children", "اطفال", "أطفال"] },
];

const COLORS = [
  { value: "black", aliases: ["black", "اسود", "أسود", "سوداء"] },
  { value: "white", aliases: ["white", "ابيض", "أبيض", "بيضاء"] },
  { value: "navy", aliases: ["navy", "navy blue", "كحلي"] },
  { value: "brown", aliases: ["brown", "بني"] },
  { value: "red", aliases: ["red", "احمر", "أحمر", "حمراء"] },
  { value: "blue", aliases: ["blue", "ازرق", "أزرق", "زرقاء"] },
  { value: "green", aliases: ["green", "اخضر", "أخضر", "خضراء"] },
];

const BRANDS = [
  { value: "Guess", aliases: ["guess", "جيس"] },
  { value: "Louis Vuitton", aliases: ["louis vuitton", "لويس فيتون"] },
  { value: "Dior", aliases: ["dior", "ديور"] },
  { value: "Rolex", aliases: ["rolex", "رولكس"] },
  { value: "Toyota", aliases: ["toyota", "تويوتا"] },
  { value: "Chanel", aliases: ["chanel", "شانيل"] },
  { value: "Gucci", aliases: ["gucci", "غوتشي", "جوتشي"] },
  { value: "Diesel", aliases: ["diesel", "ديزل"] },
  { value: "Adidas", aliases: ["adidas", "أديداس", "اديداس"] },
  { value: "Nike", aliases: ["nike", "نايك"] },
  { value: "SHEIN", aliases: ["shein", "شي ان", "شي إن"] },
  { value: "Apple", aliases: ["apple", "آبل", "ابل"] },
  { value: "Samsung", aliases: ["samsung", "سامسونج"] },
  { value: "Sony", aliases: ["sony", "سوني"] },
];

const CONTEXTUAL_BRANDS = [
  { value: "Louis Vuitton", aliases: ["lv", "ال في", "إل في", "الفي"] },
];

const STOP_WORDS = new Set([
  "a", "an", "and", "for", "in", "of", "on", "the", "to", "with",
  "want", "need", "buy", "shop", "purchase", "looking", "search", "please",
  "ابحث", "ابغا", "ابغي", "ابي", "اريد", "اشتري", "شراء", "دورلي",
  "عن", "من", "في", "لل", "و",
]);

function normalizeDigits(value: string) {
  const digits = "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹";
  return value.replace(/[٠-٩۰-۹]/gu, (digit) => {
    const index = digits.indexOf(digit);
    return String(index < 10 ? index : index - 10);
  });
}

function includesAlias(query: string, alias: string) {
  const normalizedAlias = normalizeArabicForSearch(alias);
  if (!normalizedAlias) return false;
  const escaped = normalizedAlias.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    `(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`,
    "iu",
  ).test(query);
}

function findMatch<T extends { aliases: string[] }>(
  query: string,
  definitions: T[],
) {
  for (const definition of definitions) {
    if (definition.aliases.some((alias) => includesAlias(query, alias))) {
      return definition;
    }
  }
  return undefined;
}

function parsePrice(query: string, marker: RegExp) {
  const match = query.match(marker);
  if (!match?.[1]) return undefined;
  const value = Number(match[1].replaceAll(",", ""));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function parseCurrency(query: string) {
  if (/\b(?:sar|ر\.?\s*س)\b|ريال(?:\s+سعودي)?/iu.test(query)) return "SAR";
  if (/\b(?:usd|us\$)\b|\$|دولار(?:\s+امريكي)?/iu.test(query)) return "USD";
  if (/\bAED\b|درهم(?:\s+اماراتي)?/iu.test(query)) return "AED";
  if (/\bKWD\b|دينار\s+كويتي/iu.test(query)) return "KWD";
  if (/\bBHD\b|دينار\s+بحريني/iu.test(query)) return "BHD";
  if (/\bEUR\b|€|يورو/iu.test(query)) return "EUR";
  if (/\bGBP\b|£|جنيه\s+استرليني/iu.test(query)) return "GBP";
  return undefined;
}

function cleanKeywords(query: string) {
  return [...new Set(
    query
      .split(/[\s/_,;:()[\]{}]+/u)
      .map((token) => token.replace(/[^\p{L}\p{N}-]/gu, ""))
      .filter((token) => token.length > 1 && !STOP_WORDS.has(token)),
  )];
}

function parseContextualPhoneModel(query: string) {
  const match = query.match(
    /(?:^|[^\p{L}\p{N}])(?:iphone|ايفون|اي\s+فون)\s+(\d{1,3})(?:\s+(pro(?:\s+max)?|plus|mini))?(?=$|[^\p{L}\p{N}])/iu,
  );
  if (!match) return undefined;
  const suffix = match[2]?.toLocaleLowerCase();
  const canonicalSuffix =
    suffix === "pro max" ? "Pro Max" :
      suffix === "pro" ? "Pro" :
        suffix === "plus" ? "Plus" :
          suffix === "mini" ? "Mini" : "";
  return `iPhone ${match[1]}${canonicalSuffix ? ` ${canonicalSuffix}` : ""}`;
}

function parseLabeledSizes(query: string) {
  return [...query.matchAll(
    /(?:^|[^\p{L}\p{N}])(مقاس|size)\s*(\d{1,3})(?=$|[^\p{L}\p{N}])/giu,
  )].map((match) => `${match[1].toLocaleLowerCase()} ${match[2]}`);
}

/**
 * The interface allows a future authorized AI parser to be injected without
 * coupling the search pipeline to one provider. This project currently uses
 * the deterministic implementation and makes no external AI requests.
 */
export interface AIIntentParser {
  parse(query: string): Promise<QueryIntent>;
}

export class DeterministicIntentParser implements AIIntentParser {
  async parse(query: string): Promise<QueryIntent> {
    const raw = query.trim();
    const normalizedQuery = normalizeDigits(normalizeArabicForSearch(raw));
    const productType = findMatch(normalizedQuery, PRODUCT_TYPES);
    const audience = findMatch(normalizedQuery, AUDIENCES);
    const color = findMatch(normalizedQuery, COLORS);
    const confidentLouisVuittonContext =
      CONTEXTUAL_BRANDS[0].aliases.some((alias) =>
        includesAlias(normalizedQuery, alias),
      ) && hasConfidentLouisVuittonShoppingContext(normalizedQuery);
    const brand =
      findMatch(normalizedQuery, BRANDS) ??
      (confidentLouisVuittonContext
        ? findMatch(normalizedQuery, CONTEXTUAL_BRANDS)
        : undefined);
    const normalizedExpansion = expandShoppingQuery(raw).variants.find(
      (variant) => /[a-z]/iu.test(variant) && !/[\u0600-\u06ff]/u.test(variant),
    );
    const queryTokens = cleanKeywords(normalizedQuery);
    const phoneModel = parseContextualPhoneModel(normalizedQuery);
    const labeledSizes = parseLabeledSizes(normalizedQuery);

    const priceNumber = "([0-9][0-9,]*(?:\\.[0-9]+)?)";
    const range = normalizedQuery.match(
      new RegExp(
        `(?:\\bfrom|من)\\s*${priceNumber}\\s*(?:to|through|until|الي|الى|حتي|حتى|-)\\s*${priceNumber}`,
        "iu",
      ),
    );
    const approximatePrice = parsePrice(
      normalizedQuery,
      new RegExp(
        `(?:around|about|approximately|approx\\.?|حوالي|حوالى|حدود|تقريبا|تقريباً|~)\\s*${priceNumber}`,
        "iu",
      ),
    );
    const maxPrice = range
      ? Number(range[2].replaceAll(",", ""))
      : parsePrice(
          normalizedQuery,
          new RegExp(
            `(?:under|below|less\\s+than|at\\s+most|no\\s+more\\s+than|maximum|max(?:imum)?\\s+price|اقل(?:\\s+من)?|ما\\s*يتعد[ىي]|لا\\s*يتعد[ىي]|ما\\s*يتجاوز|لا\\s*يتجاوز|بحد\\s+اقصى|حد\\s+اقصى|اقصى\\s+سعر|ميزانيتي|ميزانية)\\s*${priceNumber}`,
            "iu",
          ),
        );
    const minPrice = range
      ? Number(range[1].replaceAll(",", ""))
      : parsePrice(
          normalizedQuery,
          new RegExp(
            `(?:over|above|more\\s+than|اكبر\\s+من|اكثر\\s+من|فوق)\\s*${priceNumber}`,
            "iu",
          ),
        );
    const priceCurrency =
      maxPrice !== undefined || minPrice !== undefined || approximatePrice !== undefined
        ? parseCurrency(normalizedQuery) ?? "SAR"
        : undefined;
    const condition =
      /(?:^|[^a-z])(?:used|pre[\s-]?owned|مستعمل)(?=$|[^a-z])/iu.test(normalizedQuery)
        ? "used"
        : /(?:^|[^a-z])refurbished(?=$|[^a-z])/iu.test(normalizedQuery)
          ? "refurbished"
          : /(?:^|[^a-z])(?:new|جديد|جديدة)(?=$|[^a-z])/iu.test(normalizedQuery)
            ? "new"
            : undefined;

    const vehicleYear = normalizedQuery.match(/\b(19[89]\d|20[0-3]\d)\b/u)?.[1];
    const vehicleModel =
      includesAlias(normalizedQuery, "camry") ||
      includesAlias(normalizedQuery, "كامري")
      ? "Camry"
      : undefined;
    const vehicleMake =
      includesAlias(normalizedQuery, "toyota") || vehicleModel
        ? "Toyota"
        : undefined;
    const partNumberMatch = raw.match(
      /(?:part(?:\s+number|\s*#)?|رقم\s*القطعة|رقم\s*القطعه)\s*[:#-]?\s*([a-z0-9-]{5,24})/iu,
    );
    const oemNumberMatch = raw.match(
      /(?:oem|اوي\s*ام)\s*[:#-]?\s*([a-z0-9-]{5,24})/iu,
    );
    const partNumber = partNumberMatch?.[1]?.toUpperCase();
    const oemNumber = oemNumberMatch?.[1]?.toUpperCase();
    const recognizedWords = new Set(
      [
        ...PRODUCT_TYPES,
        ...AUDIENCES,
        ...COLORS,
        ...BRANDS,
        ...(confidentLouisVuittonContext ? CONTEXTUAL_BRANDS : []),
      ].flatMap((definition) =>
        definition.aliases.flatMap((alias) =>
          normalizeArabicForSearch(alias).split(/\s+/u),
        ),
      ),
    );
    const remainingKeywords = queryTokens.filter(
      (token) =>
        !recognizedWords.has(token) &&
        !STOP_WORDS.has(token) &&
        !(phoneModel && phoneModel.toLocaleLowerCase().split(/\s+/u).includes(token)) &&
        !(labeledSizes.length && /^(?:مقاس|size)$/u.test(token)) &&
        !/^\d+$/u.test(token),
    );
    const normalized = [
      brand?.value,
      color?.value,
      audience?.english,
      condition,
      vehicleMake,
      vehicleModel,
      vehicleYear,
      partNumber,
      oemNumber,
      ...remainingKeywords,
      phoneModel,
      ...labeledSizes,
      productType?.value,
      maxPrice === undefined ? undefined : `under ${maxPrice}`,
      minPrice === undefined ? undefined : `above ${minPrice}`,
      approximatePrice === undefined ? undefined : `around ${approximatePrice}`,
    ]
      .filter(Boolean)
      .join(" ") || normalizedExpansion || normalizedQuery;

    const intent: QueryIntent = {
      raw,
      normalized,
      keywords: queryTokens,
    };
    if (productType) {
      intent.productType = productType.value;
      intent.category = productType.category;
    }
    if (audience) intent.audience = audience.value;
    if (brand) intent.brand = brand.value;
    if (color) intent.color = color.value;
    if (maxPrice !== undefined) intent.maxPrice = maxPrice;
    if (minPrice !== undefined) intent.minPrice = minPrice;
    if (approximatePrice !== undefined) intent.approximatePrice = approximatePrice;
    if (priceCurrency !== undefined) intent.currency = priceCurrency;
    if (condition) intent.condition = condition;
    if (vehicleMake) intent.vehicleMake = vehicleMake;
    if (vehicleModel) intent.vehicleModel = vehicleModel;
    if (vehicleYear) intent.vehicleYear = vehicleYear;
    if (productType?.category === "automotive") {
      intent.partName = productType.value;
    }
    if (partNumber) intent.partNumber = partNumber;
    if (oemNumber) intent.oemNumber = oemNumber;
    return intent;
  }
}

export const deterministicIntentParser = new DeterministicIntentParser();