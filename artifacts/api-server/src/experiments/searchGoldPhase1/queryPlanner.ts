import { expandShoppingQuery, normalizeArabicForSearch } from "../../connectors/queryExpansion";
import type { Phase1Intent } from "./phase1Intent";

export type QueryStrategy =
  | "EXACT_ID"
  | "BRAND_MODEL"
  | "ARABIC_LEXICAL"
  | "ENGLISH_LEXICAL"
  | "ATTRIBUTE"
  | "CATEGORY_FALLBACK";

export type PlannedQuery = {
  query: string;
  strategy: QueryStrategy;
  /** Primary is always first; fallbacks never contain invented requirements. */
  role: "PRIMARY" | "FALLBACK";
};

const hasArabic = (value: string) => /[\u0600-\u06ff]/u.test(value);
const clean = (...parts: Array<string | null | undefined>) =>
  parts.map((part) => part?.trim()).filter((part): part is string => Boolean(part)).join(" ").trim();

/**
 * Pure offline planner: does not contact providers and returns at most three
 * distinct strings. Hard constraints remain in the intent for the caller to
 * enforce; fallback wording never removes or weakens them.
 */
export function planPhase1Queries(intent: Phase1Intent): PlannedQuery[] {
  const original = intent.explicitText.trim() || intent.rawQuery.trim();
  const modelCode = intent.model.value &&
    /^(?=.*\p{L})(?=.*\p{N})[\p{L}\p{N}./-]+$/iu.test(intent.model.value)
    ? intent.model.value
    : undefined;
  const exactIdentifier = intent.gtin14.value ?? intent.oem.value ?? intent.mpn.value ?? intent.sku.value ??
    intent.vehicle.oemNumber.value ?? intent.vehicle.partNumber.value ?? modelCode;
  const core = clean(
    intent.brand.value,
    intent.model.value,
    intent.vehicle.make.value,
    intent.vehicle.model.value,
    intent.vehicle.year.value,
    intent.productType.value,
    exactIdentifier,
  );
  const attributes = clean(intent.color.value, intent.size.value, intent.material.value, intent.style.value);
  const withAttributes = clean(core, attributes);
  const expansion = expandShoppingQuery(original);
  const bilingual = [
    ...intent.expansions.arabic,
    ...intent.expansions.english,
    ...expansion.variants,
  ];
  const idRegex = /(?:\b(?:sku|mpn|part|oem)\b|رقم\s*(?:القطعة|القطعه|المنتج)|اوي\s*ام)/iu;
  const rawContainsIdentifier = Boolean(exactIdentifier && idRegex.test(original));

  let primaryStrategy: QueryStrategy;
  if (exactIdentifier || rawContainsIdentifier) primaryStrategy = "EXACT_ID";
  else if (intent.brand.value && (intent.model.value || intent.vehicle.model.value)) primaryStrategy = "BRAND_MODEL";
  else if (attributes && !intent.productType.value) primaryStrategy = "ATTRIBUTE";
  else if (hasArabic(original)) primaryStrategy = "ARABIC_LEXICAL";
  else if (/[a-z]/iu.test(original)) primaryStrategy = "ENGLISH_LEXICAL";
  else primaryStrategy = "CATEGORY_FALLBACK";

  // Identifiers are emitted verbatim, never Arabic-digit-normalized, expanded,
  // uppercased, or mixed into translated alternatives.
  const primaryQuery = exactIdentifier
    ? exactIdentifier
    : original || withAttributes || intent.category.value || "shopping";
  const planned: PlannedQuery[] = [{ query: primaryQuery, strategy: primaryStrategy, role: "PRIMARY" }];
  const seen = new Set([normalizeArabicForSearch(primaryQuery)]);
  const add = (query: string | undefined, strategy: QueryStrategy) => {
    const value = query?.trim();
    const key = value && normalizeArabicForSearch(value);
    if (!value || !key || seen.has(key) || planned.length >= 3) return;
    seen.add(key);
    planned.push({ query: value, strategy, role: "FALLBACK" });
  };

  // A relaxed lexical variant can omit a strict price, condition, or other
  // explicit requirement. Keep those searches single-query rather than
  // silently broadening the user's request.
  if (intent.hardRequirements.length > 0 || intent.ambiguityReasons.length > 0) return planned;

  if (!exactIdentifier) {
    if (core && attributes) add(withAttributes, "ATTRIBUTE");
    const preferArabic = hasArabic(original);
    const firstLexical = preferArabic
      ? bilingual.find(hasArabic)
      : bilingual.find((value) => /[a-z]/iu.test(value) && !hasArabic(value));
    const oppositeLexical = preferArabic
      ? bilingual.find((value) => /[a-z]/iu.test(value) && !hasArabic(value))
      : bilingual.find(hasArabic);
    if (firstLexical && primaryStrategy !== (preferArabic ? "ARABIC_LEXICAL" : "ENGLISH_LEXICAL")) {
      add(firstLexical, preferArabic ? "ARABIC_LEXICAL" : "ENGLISH_LEXICAL");
    }
    if (oppositeLexical) {
      add(oppositeLexical, hasArabic(oppositeLexical) ? "ARABIC_LEXICAL" : "ENGLISH_LEXICAL");
    }
    if (planned.length === 1) {
      add(clean(intent.brand.value, intent.productType.value, intent.category.value), "CATEGORY_FALLBACK");
    }
  } else {
    // An alternate only adds the explicit product/category context; identifier
    // is retained byte-for-byte to prevent model/SKU truncation or mutation.
    add(clean(exactIdentifier, intent.brand.value, intent.model.value, intent.productType.value), "BRAND_MODEL");
    if (planned.length < 3) add(clean(exactIdentifier, intent.productType.value, intent.category.value), "CATEGORY_FALLBACK");
  }
  return planned.slice(0, 3);
}