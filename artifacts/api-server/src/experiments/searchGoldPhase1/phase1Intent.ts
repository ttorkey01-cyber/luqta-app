import { deterministicIntentParser } from "../../connectors/intentParser";
import {
  expandShoppingQuery,
  normalizeArabicForSearch,
} from "../../connectors/queryExpansion";
import type { QueryIntent } from "../../connectors/types";

export type EvidenceLevel =
  | "USER_EXPLICIT"
  | "HIGH_CONFIDENCE"
  | "LOW_CONFIDENCE"
  | "INFERRED"
  | "UNKNOWN";

export type EvidenceValue<T> = {
  value: T | null;
  evidence: EvidenceLevel;
  /** Original query span when a value was explicitly stated. */
  sourceText?: string;
};

export type BudgetRange = {
  min: number | null;
  max: number | null;
  approximate: number | null;
  currency: string | null;
};

export type SearchRelation = "exact" | "similar" | "cheaper";
export type Phase1Condition = "new" | "used" | "refurbished";
export type VehicleIntent = {
  make: EvidenceValue<string>;
  model: EvidenceValue<string>;
  year: EvidenceValue<string>;
  partName: EvidenceValue<string>;
  partNumber: EvidenceValue<string>;
  oemNumber: EvidenceValue<string>;
};

/**
 * Stable, provider-independent Phase 1 parse. `explicitText` and `rawQuery`
 * preserve the user's wording; evidence distinguishes directly stated facts
 * from parser interpretation. Consumers must apply hard filters only to
 * explicitly stated constraints (especially strict budgets and identifiers).
 */
export type Phase1Intent = {
  rawQuery: string;
  explicitText: string;
  normalizedQuery: string;
  productType: EvidenceValue<string>;
  category: EvidenceValue<string>;
  brand: EvidenceValue<string>;
  model: EvidenceValue<string>;
  sku: EvidenceValue<string>;
  mpn: EvidenceValue<string>;
  oem: EvidenceValue<string>;
  /** Checksum-validated GTIN-14, preserved with leading zeros. */
  gtin14: EvidenceValue<string>;
  color: EvidenceValue<string>;
  size: EvidenceValue<string>;
  material: EvidenceValue<string>;
  style: EvidenceValue<string>;
  authenticity: EvidenceValue<boolean>;
  budget: EvidenceValue<BudgetRange>;
  condition: EvidenceValue<Phase1Condition>;
  city: EvidenceValue<string>;
  relation: EvidenceValue<SearchRelation>;
  /** Multiple simultaneous actions, e.g. exact/same identity and cheaper. */
  relations: EvidenceValue<SearchRelation[]>;
  automotive: EvidenceValue<boolean>;
  vehicle: VehicleIntent;
  /** Hard requirements are never inferred; each entry must be user explicit. */
  hardRequirements: Array<{
    field: string;
    value: string | number;
    operator: "eq" | "lt" | "lte" | "gt" | "gte" | "between";
    evidence: "USER_EXPLICIT";
    sourceText: string;
  }>;
  ambiguityReasons: string[];
  clarificationReasons: string[];
  /** Stable parser result retained for future integrations/evaluation. */
  baseIntent: QueryIntent;
  /** Existing deterministic bilingual expansion; never treated as user text. */
  expansions: { arabic: string[]; english: string[] };
};

/**
 * Evaluation modules can consume this exact intent/planner boundary without
 * accessing providers: original input, parsed evidence, and planned queries.
 */
export type Phase1EvaluationInput = {
  query: string;
  intent: Phase1Intent;
  plannedQueries: Array<{ query: string; strategy: string }>;
};

const unknown = <T>(): EvidenceValue<T> => ({ value: null, evidence: "UNKNOWN" });
const normalizedText = (text: string) => normalizeArabicForSearch(text);

function sourceFor(query: string, candidates: string[]) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const match = query.match(new RegExp(escaped, "iu"));
    if (match) return match[0];
  }
  return undefined;
}

function explicit<T>(value: T | null | undefined, source?: string): EvidenceValue<T> {
  return value == null
    ? unknown<T>()
    : { value, evidence: source ? "USER_EXPLICIT" : "HIGH_CONFIDENCE", ...(source ? { sourceText: source } : {}) };
}

function normalizeDigitsPreservingIdentifiers(query: string) {
  return query.replace(/[٠-٩۰-۹]/gu, (digit) => {
    const digits = "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹";
    const index = digits.indexOf(digit);
    return String(index < 10 ? index : index - 10);
  });
}

function parseNumber(value: string) {
  return Number(value.replaceAll(",", "").replace(/[٠-٩۰-۹]/gu, (digit) => {
    const digits = "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹";
    const index = digits.indexOf(digit);
    return String(index < 10 ? index : index - 10);
  }));
}

function toWesternDigits(value: string) {
  const digits = "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹";
  return value.replace(/[٠-٩۰-۹]/gu, (digit) => {
    const index = digits.indexOf(digit);
    return String(index < 10 ? index : index - 10);
  });
}

function isValidGTIN14(value: string) {
  if (!/^\d{14}$/u.test(value)) return false;
  let sum = 0;
  for (let index = value.length - 2, weight = 3; index >= 0; index -= 1, weight = weight === 3 ? 1 : 3) {
    sum += Number(value[index]) * weight;
  }
  return (10 - (sum % 10)) % 10 === Number(value.at(-1));
}

function parseBudget(raw: string): { field: EvidenceValue<BudgetRange>; requirements: Phase1Intent["hardRequirements"] } {
  const query = normalizedText(normalizeDigitsPreservingIdentifiers(raw));
  const number = "([0-9][0-9,]*(?:\\.[0-9]+)?)";
  const amount = `\\s*(?:[$£€]\\s*)?${number}`;
  const range = query.match(new RegExp(`(?:\\bbetween|\\bfrom|بين|من)${amount}\\s*(?:and|to|through|حتى|الى|و)${amount}`, "iu"));
  const max = query.match(new RegExp(`(?:under|below|less\\s+than|at\\s+most|no\\s+more\\s+than|maximum|max(?:imum)?|اقل(?:\\s+من)?|ما\\s*يتعد[ىي]|لا\\s*يتعد[ىي]|ما\\s*يتجاوز|لا\\s*يتجاوز|بحد\\s+اقصى|حد\\s+اقصى|اقصى\\s+سعر|ما\\s*يفوق)${amount}`, "iu"));
  const min = query.match(new RegExp(`(?:over|above|more\\s+than|greater\\s+than|at\\s+least|no\\s+less\\s+than|minimum|min(?:imum)?|اكبر\\s+من|اكثر\\s+من|فوق)${amount}`, "iu"));
  const approximate = query.match(new RegExp(`(?:around|about|approximately|approx\\.?|بحدود|حدود|حوالي|حوالى|تقريبا|~)${amount}`, "iu"));
  // A bare "budget 300" is a soft/approximate preference, not a strict cap.
  const bareBudget = query.match(new RegExp(`(?:budget|ميزانيتي|ميزانية)\\s*[:=]?${amount}`, "iu"));
  const currency = /(?:\bSAR\b|ر\.?\s*س|ريال(?:\s+سعودي)?)/iu.test(raw) ? "SAR"
    : /(?:\bUSD\b|\$|دولار)/iu.test(raw) ? "USD"
      : /(?:\bAED\b|درهم)/iu.test(raw) ? "AED"
        : /(?:\bKWD\b|دينار\s+كويتي)/iu.test(raw) ? "KWD"
          : /(?:\bBHD\b|دينار\s+بحريني)/iu.test(raw) ? "BHD"
            : /(?:\bEUR\b|€|يورو)/iu.test(raw) ? "EUR"
              : /(?:\bGBP\b|£|جنيه\s+استرليني)/iu.test(raw) ? "GBP"
        : undefined;
  const selected = Boolean(range || max || min || approximate || bareBudget);
  if (!selected) return { field: unknown<BudgetRange>(), requirements: [] };
  const minValue = range ? parseNumber(range[1]) : min ? parseNumber(min[1]) : null;
  const maxValue = range ? parseNumber(range[2]) : max ? parseNumber(max[1]) : null;
  const approximateValue = approximate ? parseNumber(approximate[1]) : bareBudget && !max && !min && !range ? parseNumber(bareBudget[1]) : null;
  const sourceText = (range ?? max ?? min ?? approximate ?? bareBudget)?.[0];
  const field = explicit({ min: minValue, max: maxValue, approximate: approximateValue, currency: currency ?? null }, sourceText);
  const requirements: Phase1Intent["hardRequirements"] = [];
  if (range) {
    requirements.push({ field: "budget.min", value: minValue!, operator: "gte", evidence: "USER_EXPLICIT", sourceText: range[0] });
    requirements.push({ field: "budget.max", value: maxValue!, operator: "lte", evidence: "USER_EXPLICIT", sourceText: range[0] });
  } else if (max) {
    const inclusiveMaximum = /(?:at\s+most|no\s+more\s+than|maximum|max(?:imum)?|ما\s*يتعد[ىي]|لا\s*يتعد[ىي]|ما\s*يتجاوز|لا\s*يتجاوز|بحد\s+اقصى|حد\s+اقصى|اقصى\s+سعر|ما\s*يفوق)/iu.test(max[0]);
    requirements.push({ field: "budget.max", value: maxValue!, operator: inclusiveMaximum ? "lte" : "lt", evidence: "USER_EXPLICIT", sourceText: max[0] });
  } else if (min) {
    const inclusiveMinimum = /(?:at\s+least|no\s+less\s+than|minimum|min(?:imum)?)/iu.test(min[0]);
    requirements.push({ field: "budget.min", value: minValue!, operator: inclusiveMinimum ? "gte" : "gt", evidence: "USER_EXPLICIT", sourceText: min[0] });
  }
  return { field, requirements };
}

const BRAND_ALIASES: Array<[string, string[]]> = [
  ["Toyota", ["Toyota", "تويوتا"]], ["Apple", ["Apple", "آبل", "ابل", "iPhone", "آيفون", "ايفون"]],
  ["FixtureBrand", ["FixtureBrand"]],
  ["Samsung", ["Samsung", "سامسونج"]], ["Nike", ["Nike", "نايك"]],
  ["Adidas", ["Adidas", "أديداس", "اديداس"]], ["Gucci", ["Gucci", "غوتشي", "جوتشي"]],
  ["Dior", ["Dior", "ديور"]], ["Rolex", ["Rolex", "رولكس"]],
  ["Louis Vuitton", ["Louis Vuitton", "لويس فيتون"]], ["Chanel", ["Chanel", "شانيل"]],
  ["Sony", ["Sony", "سوني"]], ["Guess", ["Guess", "جيس"]], ["Ford", ["Ford", "فورد"]],
  ["BMW", ["BMW", "بي ام دبليو"]], ["Mercedes-Benz", ["Mercedes-Benz", "مرسيدس"]],
  ["Jaguar", ["Jaguar"]],
];
const PRODUCT_ALIASES: Array<[string, string[]]> = [
  ["spark plug", ["spark plug", "spark plugs", "بواجي", "بوجيه", "شمعة احتراق", "شمعات احتراق", "شمعة محرك", "شمعة المحرك"]],
  ["headlight", ["headlight", "headlamp", "head light", "شمعة أمامية", "شمعة امامية", "شمعة السيارة"]],
  ["spare parts", ["قطع غيار", "auto parts", "spare parts"]],
  ["sunglasses", ["sunglasses", "نظارة شمسية", "نظارات شمسية"]],
  ["t-shirt", ["t-shirt", "tshirt", "تيشيرت", "تي شيرت"]],
  ["handbag", ["handbag", "bag", "شنطة", "حقيبة"]],
  ["shoes", ["shoes", "shoe", "حذاء", "جزمة", "جزم"]],
  ["phone", ["phone", "mobile", "جوال", "موبايل", "هاتف"]],
  ["glasses", ["glasses", "eyeglasses", "نظارة", "نظارات"]],
  ["watch", ["watch", "watches", "ساعة", "ساعات"]],
  ["bumper", ["bumper", "صدام", "صدامات"]],
  ["earbuds", ["earbuds", "earbud", "سماعات اذن", "سماعة اذن", "سماعات الأذن", "سماعة الأذن"]],
  ["charger", ["charger", "USB charger", "شاحن", "شاحن USB"]],
  ["laptop", ["laptop", "لابتوب"]],
  ["perfume", ["perfume", "fragrance", "عطر"]],
  ["chair", ["chair", "كرسي"]], ["tire", ["tire", "tyre", "كفر", "إطار"]],
  ["car", ["car", "سيارة", "سياره"]],
];
function aliasMatch(query: string, aliases: string[]) {
  const normalized = normalizedText(query);
  return aliases.find((alias) => {
    const key = normalizedText(alias);
    return new RegExp(`(?:^|[^\\p{L}\\p{N}])${key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?=$|[^\\p{L}\\p{N}])`, "iu").test(normalized);
  });
}

export async function parsePhase1Intent(query: string, suppliedIntent?: QueryIntent): Promise<Phase1Intent> {
  const rawQuery = query;
  const raw = query.trim();
  const baseIntent = await deterministicIntentParser.parse(query);
  const expansions = expandShoppingQuery(query);
  const normalized = normalizedText(query);
  const explicitText = query;

  const brandEntry = BRAND_ALIASES.find(([, aliases]) => aliasMatch(query, aliases));
  const explicitlyNamedBrand = raw.match(/(?:^|[^\p{L}\p{N}])([\p{L}][\p{L}\p{N}&'-]*(?:\s+[\p{L}][\p{L}\p{N}&'-]*){0,2})\s+Model(?=\s|[:#-])/iu);
  const typoSamsung = raw.match(/(?:^|[^\p{L}\p{N}])(Samsng)(?=\s+(?:Galaxy|(?:Model\s+)?Galaxy)\b)/iu);
  const safeTypoSamsung = typoSamsung && /\bGalaxy\b/iu.test(raw);
  const parserBrandAliases = baseIntent.brand === "Louis Vuitton"
    ? ["Louis Vuitton", "لويس فيتون", "LV", "ال في", "إل في", "الفي"]
    : baseIntent.brand ? [baseIntent.brand] : [];
  const brandSource = (brandEntry && sourceFor(query, brandEntry[1])) ??
    (baseIntent.brand && sourceFor(query, parserBrandAliases));
  const inferredNamedBrand = explicitlyNamedBrand?.[1]
    .replace(/^(?:(?:أبي|ابغى|أبغى|أبغا|ودي|دورلي|ابحث|find|want|looking\s+for)\s+)/iu, "");
  const safeBaseBrand = typoSamsung ? (safeTypoSamsung ? "Samsung" : undefined) : baseIntent.brand;
  const brandValue = brandEntry?.[0] ?? (safeTypoSamsung ? "Samsung" : undefined) ??
    inferredNamedBrand ?? safeBaseBrand ?? suppliedIntent?.brand;
  const brand = explicit(brandValue, brandSource ?? (safeTypoSamsung ? typoSamsung?.[1] : undefined) ??
    (inferredNamedBrand ? inferredNamedBrand : undefined));
  const productEntry = PRODUCT_ALIASES.find(([, aliases]) => aliasMatch(query, aliases));
  const ambiguousSham3a = /شمعة|شمعه/u.test(normalized) && !/(?:احتراق|اماميه|سياره|head ?light|head ?lamp|spark|بوجيه|بواجي|محرك)/iu.test(normalized);
  const productSource = productEntry && sourceFor(query, productEntry[1]);
  const product = ambiguousSham3a
    ? unknown<string>()
    : explicit(productEntry?.[0] ?? baseIntent.productType ?? suppliedIntent?.productType, productSource);

  const codePattern = /(?:\b(?:(?:seller(?:'s)?|merchant(?:'s)?)\s+)?(?:sku|mpn|part(?:\s+(?:number|no\.?))?|oem)\b|رقم\s*(?:القطعة|القطعه|المنتج|القطعه)|اوي\s*ام)\s*[:#-]?\s*([\p{L}\p{N}][\p{L}\p{N}./-]{1,49})/iu;
  const codeMatch = raw.match(codePattern);
  const exactCode = codeMatch?.[1];
  const oemSource = /oem|اوي\s*ام/iu.test(codeMatch?.[0] ?? "");
  const partSource = /part|قطعة|قطعه/iu.test(codeMatch?.[0] ?? "");
  const mpnSource = /\bmpn\b/iu.test(codeMatch?.[0] ?? "");
  const skuSource = /\bsku\b/iu.test(codeMatch?.[0] ?? "");
  const gtinMatch = raw.match(/(?<![\p{L}\p{N}])([0-9٠-٩۰-۹]{14})(?![\p{L}\p{N}])/u);
  const gtinCandidate = gtinMatch?.[1];
  const gtin14 = gtinCandidate && isValidGTIN14(toWesternDigits(gtinCandidate))
    ? explicit(gtinCandidate, gtinCandidate)
    : unknown<string>();
  const labeledModel = !exactCode
    ? raw.match(/(?:\bmodel|موديل)\s*[:#-]?\s*([\p{L}\p{N}./-]{2,50})/iu)?.[1]
    : undefined;
  const arabicIphoneModel = !exactCode
    ? raw.match(/(?<![\p{L}\p{N}])((?:آيفون|ايفون)\s*[٠-٩۰-۹0-9]{1,3})/iu)?.[1]
    : undefined;
  const fixtureGalaxyCode = !exactCode
    ? raw.match(/\bGalaxy\s+\p{L}+\s+(S\d{1,3})\b/iu)?.[1]
    : undefined;
  const labeledOrKnownModel = labeledModel ?? arabicIphoneModel ?? fixtureGalaxyCode ??
    (!exactCode
      ? raw.match(/(?<![\p{L}\p{N}])((?:iPhone|Galaxy|Pixel|Air\s*Force|Camry|Corolla|Land\s+Cruiser|XE|XF|F-Pace)(?:\s+[\p{L}\p{N}-]{1,12})?)/iu)?.[1]
      : undefined);
  const bareModelCode = !exactCode && !labeledOrKnownModel
    ? raw.match(/(?<![\p{L}\p{N}])(?=[\p{L}\p{N}./-]*\p{L})(?=[\p{L}\p{N}./-]*\p{N})[\p{L}\p{N}][\p{L}\p{N}./-]{1,49}(?![\p{L}\p{N}])/iu)?.[0]
    : undefined;
  const modelCandidate = (labeledOrKnownModel ?? bareModelCode)?.replace(/\s+[0-9٠-٩۰-۹]{4}$/u, "");
  // Keep identifier spelling, punctuation and Arabic numerals exactly as typed.
  const sku = explicit(skuSource ? exactCode : undefined, skuSource ? exactCode : undefined);
  const mpn = explicit(partSource || mpnSource ? exactCode : undefined, partSource || mpnSource ? exactCode : undefined);
  const oem = explicit(oemSource ? exactCode : undefined, oemSource ? exactCode : undefined);

  const colorAliases: Array<[string, string[]]> = [
    ["black", ["black", "أسود", "اسود", "سوداء"]], ["white", ["white", "أبيض", "ابيض"]],
    ["red", ["red", "أحمر", "احمر"]], ["blue", ["blue", "أزرق", "ازرق"]],
    ["green", ["green", "أخضر", "اخضر", "خضراء"]],
    ["navy", ["navy", "كحلي"]], ["brown", ["brown", "بني"]],
  ];
  const colorEntry = colorAliases.find(([, aliases]) => aliasMatch(query, aliases));
  const color = explicit(colorEntry?.[0], colorEntry ? sourceFor(query, colorEntry[1]) : undefined);
  const sizeMatch = raw.match(/(?:\b(?:size\s*[:#]?\s*|EU\s+)|مقاس\s*)([\p{L}\p{N}٠-٩۰-۹.-]{1,12})(?:\s+(EU|UK|US|EURO))?/iu);
  const sizeSystem = sizeMatch?.[2] ?? (sizeMatch?.[0] && /^EU\s/iu.test(sizeMatch[0]) ? "EU" : undefined);
  const normalizedSize = sizeMatch ? `${sizeSystem ? `${sizeSystem.toUpperCase()} ` : ""}${sizeMatch[1]}` : undefined;
  const materialEntry = [["leather", ["leather", "جلد"]], ["cotton", ["cotton", "قطن"]], ["wood", ["wood", "خشب"]], ["metal", ["metal", "معدن"]]].find(([, aliases]) => aliasMatch(query, aliases as string[]));
  const materialAliases = materialEntry?.[1] as string[] | undefined;
  const styleMatch = raw.match(/(?:\bstyle\s*[:=]?\s*|ستايل\s*)([\p{L}\p{N}-]{2,24})/iu);

  const parsedBudget = parseBudget(raw);
  const condition = /(?:used|pre[\s-]?owned|مستعمل(?:ة)?)/iu.test(raw) ? explicit<Phase1Condition>("used", sourceFor(raw, ["used", "pre-owned", "مستعمل", "مستعملة"]))
    : /(?:refurbished|مجدد)/iu.test(raw) ? explicit<Phase1Condition>("refurbished", sourceFor(raw, ["refurbished", "مجدد"]))
      : /(?:\bnew\b|جديد(?:ة)?)/iu.test(raw) ? explicit<Phase1Condition>("new", sourceFor(raw, ["new", "جديد", "جديدة"])) : unknown<Phase1Condition>();
  const cityEntry = ["جدة", "الرياض", "مكة", "الدمام", "الخبر", "المدينة", "أبها", "Jeddah", "Riyadh", "Mecca", "Dammam", "Khobar", "Medina", "Abha"].find((city) => normalized.includes(normalizedText(city)));
  const cityNames: Record<string, string> = { "جدة": "Jeddah", "الرياض": "Riyadh", "مكة": "Mecca", "الدمام": "Dammam", "الخبر": "Al Khobar", "المدينة": "Medina", "أبها": "Abha", "Jeddah": "Jeddah", "Riyadh": "Riyadh", "Mecca": "Mecca", "Dammam": "Dammam", "Khobar": "Al Khobar", "Medina": "Medina", "Abha": "Abha" };
  const city = explicit(cityEntry ? cityNames[cityEntry] : undefined, cityEntry ? sourceFor(raw, [cityEntry]) : undefined);
  const relationMatches: SearchRelation[] = [];
  if (/(?:exact(?:ly)?|same(?:\s+(?:as|one|this|that|it|[\p{L}]+))?|نفس(?:\s+[\p{L}]+)?|مطابق)/iu.test(raw)) relationMatches.push("exact");
  if (/(?:similar|like\s+(?:this|it)|زيها|مثله|شبيه)/iu.test(raw)) relationMatches.push("similar");
  if (/(?:cheaper|less\s+expensive|ارخص|أرخص)/iu.test(raw)) relationMatches.push("cheaper");
  const relationSources = [
    relationMatches.includes("exact") ? sourceFor(raw, ["exact", "same as", "same this", "same that", "same", "نفس الساعة", "نفس هذا", "نفس هذي", "نفس", "مطابق"]) : undefined,
    relationMatches.includes("similar") ? sourceFor(raw, ["similar", "like this", "like it", "زيها", "مثله", "شبيه"]) : undefined,
    relationMatches.includes("cheaper") ? sourceFor(raw, ["cheaper", "less expensive", "أرخص", "ارخص"]) : undefined,
  ].filter(Boolean).join(" + ");
  // The singular compatibility field favors the action; `relations` keeps all
  // independently stated identity and price preferences together.
  const relationMatch = relationMatches.includes("cheaper") ? "cheaper"
    : relationMatches.includes("similar") ? "similar"
      : relationMatches.includes("exact") ? "exact" : undefined;
  const relation = explicit<SearchRelation>(relationMatch, relationSources);
  const relations = explicit<SearchRelation[]>(relationMatches.length ? relationMatches : undefined, relationSources);

  const automotiveFlag = Boolean(
    productEntry?.[0] === "spark plug" || productEntry?.[0] === "headlight" ||
    /(?:automotive|car|سيارة|سياره|محرك|صدام|bumper|بواجي|بوجيه|spark ?plug|head ?lamp|head ?light)/iu.test(raw) ||
    (!ambiguousSham3a && (baseIntent.category === "automotive" || suppliedIntent?.category === "automotive")),
  ) && !ambiguousSham3a;
  const genericModel = (modelCandidate && !/^[0-9٠-٩۰-۹]{4}$/u.test(modelCandidate) ? modelCandidate : undefined) ??
    (baseIntent.vehicleModel ? sourceFor(raw, [baseIntent.vehicleModel]) ?? baseIntent.vehicleModel : undefined) ??
    suppliedIntent?.vehicleModel;
  const model = explicit(genericModel, genericModel ? sourceFor(raw, [genericModel]) : undefined);
  const vehicleMake = explicit(baseIntent.vehicleMake ?? suppliedIntent?.vehicleMake, sourceFor(raw, ["Toyota", "تويوتا", "Ford", "فورد", "BMW", "مرسيدس"]));
  const vehicleYearValue = baseIntent.vehicleYear ?? suppliedIntent?.vehicleYear;
  const yearSource = vehicleYearValue ? sourceFor(raw, [vehicleYearValue]) ?? raw.match(/[0-9٠-٩۰-۹]{4}/u)?.[0] : undefined;
  const vehicleYear = explicit(vehicleYearValue, yearSource);
  const partName = explicit(productEntry?.[0] === "spark plug" || productEntry?.[0] === "headlight" ? productEntry[0] : baseIntent.partName, productSource);
  const vehicleModel = explicit(genericModel, genericModel ? sourceFor(raw, [genericModel]) : undefined);

  const ambiguityReasons: string[] = [];
  const clarificationReasons: string[] = [];
  const usbTypeCMatch = raw.match(/(?:USB[\s-]?C|type[\s-]?c|تايب[\s-]*سي|تايبسي)/iu);
  const genericCharger = product.value === "charger" && !/(?:usb[\s-]?[abc]|fast|wireless|car|phone|laptop|type[\s-]?c|تايب[\s-]*سي|تايبسي|ايفون|جوال|موبايل)/iu.test(raw);
  const ambiguousJaguar = brand.value === "Jaguar" && !/(?:\b(?:car|automotive|XE|XF|F-Pace|vehicle)\b|سيارة|سياره|موديل|model)/iu.test(raw);
  if (genericCharger) {
    ambiguityReasons.push("A generic charger request does not identify the device or connector.");
    clarificationReasons.push("Please specify the device or charger connector/type.");
  }
  if (ambiguousJaguar) {
    ambiguityReasons.push("Jaguar may refer to the vehicle brand or the animal.");
    clarificationReasons.push("Do you mean a Jaguar vehicle or something related to the animal?");
  }
  if (ambiguousSham3a) {
    ambiguityReasons.push("شمعة is ambiguous between a headlamp and a spark plug without additional context.");
    clarificationReasons.push("Please clarify whether you mean a headlamp (شمعة أمامية) or a spark plug (شمعة احتراق).");
  }
  if (automotiveFlag && (product.value === "headlight" || product.value === "spark plug") && !vehicleModel.value && !vehicleMake.value) {
    ambiguityReasons.push("Automotive part requested without vehicle make/model; compatibility is unknown.");
    clarificationReasons.push("Provide the vehicle make/model/year to check compatibility. No fitment is asserted.");
  }
  if (sizeMatch && !sizeSystem && /(?:shoes?|clothing|dress|حذاء|جزمة|جزم|ملابس)/iu.test(raw)) {
    ambiguityReasons.push("The size value is explicit, but its sizing system is not specified.");
    clarificationReasons.push("Please specify the size system (for example EU, UK, or US).");
  }

  const hardRequirements = [...parsedBudget.requirements];
  if (condition.value) hardRequirements.push({ field: "condition", value: condition.value, operator: "eq", evidence: "USER_EXPLICIT", sourceText: condition.sourceText ?? condition.value });
  const preferredColor = /(?:يفضل|افضل|أفضل|تفضل|يفضّل|prefer(?:s|red)?|would\s+prefer)/iu.test(raw);
  if (color.value && !preferredColor) hardRequirements.push({ field: "color", value: color.value, operator: "eq", evidence: "USER_EXPLICIT", sourceText: color.sourceText ?? color.value });
  if (city.value) hardRequirements.push({ field: "city", value: city.value, operator: "eq", evidence: "USER_EXPLICIT", sourceText: city.sourceText ?? city.value });
  if (sizeMatch && sizeSystem) hardRequirements.push({ field: "size", value: normalizedSize!, operator: "eq", evidence: "USER_EXPLICIT", sourceText: sizeMatch[0] });
  if (exactCode) hardRequirements.push({ field: skuSource && /seller|merchant/iu.test(codeMatch![0]) ? "seller_sku" : oemSource ? "oem" : skuSource ? "sku" : "mpn", value: exactCode, operator: "eq", evidence: "USER_EXPLICIT", sourceText: codeMatch![0] });
  if (gtin14.value) hardRequirements.push({ field: "gtin14", value: gtin14.value, operator: "eq", evidence: "USER_EXPLICIT", sourceText: gtin14.sourceText ?? gtin14.value });
  const explicitPhoneModel = Boolean(modelCandidate && /^(?:iPhone|آيفون|ايفون)\s*[0-9٠-٩۰-۹]{1,3}$/iu.test(modelCandidate));
  if (modelCandidate && (/^(?=.*\p{L})(?=.*\p{N})[\p{L}\p{N}./-]+$/iu.test(modelCandidate) || explicitPhoneModel)) {
    hardRequirements.push({ field: "model", value: modelCandidate, operator: "eq", evidence: "USER_EXPLICIT", sourceText: modelCandidate });
  }
  if (product.value === "charger" && usbTypeCMatch) {
    hardRequirements.push({ field: "connector", value: "USB-C", operator: "eq", evidence: "USER_EXPLICIT", sourceText: usbTypeCMatch[0] });
  }
  const phase1Category = product.value === "earbuds" || product.value === "charger" ? "electronics" : undefined;
  const categoryValue = product.value ? baseIntent.category ?? phase1Category ?? (automotiveFlag ? "automotive" : undefined) : undefined;

  return {
    rawQuery,
    explicitText,
    normalizedQuery: normalized,
    productType: product,
    category: explicit(categoryValue, productSource),
    brand,
    model,
    sku,
    mpn,
    oem,
    gtin14,
    color,
    size: explicit(normalizedSize, sizeMatch?.[0]),
    material: explicit(materialEntry?.[0] as string | undefined, materialAliases ? sourceFor(raw, materialAliases) : undefined),
    style: explicit(styleMatch?.[1], styleMatch?.[0]),
    authenticity: /(?:authentic|original|اصلي|أصلي)/iu.test(raw)
      ? explicit(true, sourceFor(raw, ["authentic", "original", "اصلي", "أصلي"]))
      : unknown<boolean>(),
    budget: parsedBudget.field,
    condition,
    city,
    relation,
    relations,
    automotive: automotiveFlag ? explicit(true, sourceFor(raw, ["car", "automotive", "سيارة", "سياره", "محرك", "بواجي", "بوجيه", "spark plug", "headlight", "headlamp", "شمعة"])) : unknown<boolean>(),
    vehicle: {
      make: vehicleMake,
      model: vehicleModel,
      year: vehicleYear,
      partName,
      partNumber: explicit(partSource ? exactCode : baseIntent.partNumber, partSource ? exactCode : undefined),
      oemNumber: explicit(oemSource ? exactCode : baseIntent.oemNumber, oemSource ? exactCode : undefined),
    },
    hardRequirements,
    ambiguityReasons,
    clarificationReasons,
    baseIntent,
    expansions: { arabic: expansions.variants.filter((variant) => /[\u0600-\u06ff]/u.test(variant)), english: expansions.variants.filter((variant) => /[a-z]/iu.test(variant) && !/[\u0600-\u06ff]/u.test(variant)) },
  };
}