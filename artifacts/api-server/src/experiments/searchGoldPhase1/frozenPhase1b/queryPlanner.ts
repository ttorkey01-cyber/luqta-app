/** Immutable evaluation control copied from the frozen Phase 1B implementation. Do not edit behavior. */
import { expandShoppingQuery, normalizeArabicForSearch } from "../../../connectors/queryExpansion";
import type { Phase1Intent } from "./phase1Intent";

export type QueryStrategy =
  | "EXACT_ID"
  | "BRAND_MODEL"
  | "ARABIC_LEXICAL"
  | "ENGLISH_LEXICAL"
  | "ATTRIBUTE"
  | "CATEGORY_FALLBACK";

/** Ordered retrieval stages. A wrapper must explicitly opt into later stages. */
export type PlannerStage = "EXACT" | "LEXICAL" | "EXPANSION" | "BROAD";

export type PlannedQuery = {
  query: string;
  strategy: QueryStrategy;
  stage: PlannerStage;
  /** Primary is always first; fallbacks never contain invented requirements. */
  role: "PRIMARY" | "FALLBACK";
};

const hasArabic = (value: string) => /[\u0600-\u06ff]/u.test(value);
const clean = (...parts: Array<string | null | undefined>) =>
  parts.map((part) => part?.trim()).filter((part): part is string => Boolean(part)).join(" ").trim();
const STAGE_ORDER: PlannerStage[] = ["EXACT", "LEXICAL", "EXPANSION", "BROAD"];

/**
 * Pure offline, staged planner. By default it returns only the exact-stage
 * query. A wrapper may request a later stage after earlier retrieval is
 * insufficient. Results are capped at four distinct outer plans.
 */
export function planPhase1Queries(
  intent: Phase1Intent,
  throughStage: PlannerStage = "EXACT",
): PlannedQuery[] {
  const original = intent.explicitText.trim() || intent.rawQuery.trim();
  const modelCode = intent.model.value &&
    /^(?=.*\p{L})(?=.*\p{N})[\p{L}\p{N}./-]+$/iu.test(intent.model.value)
    ? intent.model.value
    : undefined;
  const explicitModelIdentifier = Boolean(
    modelCode && intent.model.evidence === "USER_EXPLICIT" && intent.model.sourceText,
  );
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
  const lexicalQuery = clean(core, attributes);
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

  // Identifiers are emitted verbatim, never normalized or translated.
  const primaryQuery = exactIdentifier
    ? exactIdentifier
    : original || lexicalQuery || intent.category.value || "shopping";
  const planned: PlannedQuery[] = [{ query: primaryQuery, strategy: primaryStrategy, stage: "EXACT", role: "PRIMARY" }];
  const seen = new Set([normalizeArabicForSearch(primaryQuery)]);
  const add = (query: string | undefined, strategy: QueryStrategy, stage: PlannerStage) => {
    const value = query?.trim();
    const key = value && normalizeArabicForSearch(value);
    if (!value || !key || seen.has(key) || planned.length >= 4) return;
    seen.add(key);
    planned.push({ query: value, strategy, stage, role: "FALLBACK" });
  };
  const requestedStageIndex = Math.max(0, STAGE_ORDER.indexOf(throughStage));

  // An explicit model code may get one contextual lexical pass using the exact
  // original wording. Evaluation still enforces the stated requirements.
  const restrictedExpansion = intent.hardRequirements.length > 0 || intent.ambiguityReasons.length > 0;
  if (restrictedExpansion && !explicitModelIdentifier) return planned;

  if (requestedStageIndex >= 1) {
    if (explicitModelIdentifier) {
      add(original, "BRAND_MODEL", "LEXICAL");
    } else if (exactIdentifier) {
      // Preserve identifier bytes in every plan that carries it.
      add(clean(exactIdentifier, intent.brand.value, intent.model.value, intent.productType.value, attributes), "BRAND_MODEL", "LEXICAL");
    } else if (!restrictedExpansion && lexicalQuery) {
      const strategy = intent.brand.value && intent.model.value ? "BRAND_MODEL"
        : attributes ? "ATTRIBUTE" : hasArabic(lexicalQuery) ? "ARABIC_LEXICAL" : "ENGLISH_LEXICAL";
      add(lexicalQuery, strategy, "LEXICAL");
    }
  }

  if (restrictedExpansion) return planned.slice(0, 4);

  if (requestedStageIndex >= 2 && !exactIdentifier) {
    const preferArabic = hasArabic(original);
    const translated = bilingual.find((value) => preferArabic
      ? /[a-z]/iu.test(value) && !hasArabic(value)
      : hasArabic(value));
    if (translated) add(translated, hasArabic(translated) ? "ARABIC_LEXICAL" : "ENGLISH_LEXICAL", "EXPANSION");
  }

  if (requestedStageIndex >= 3) {
    const broad = exactIdentifier
      ? undefined
      : clean(intent.brand.value, intent.productType.value, intent.category.value);
    add(broad, "CATEGORY_FALLBACK", "BROAD");
  }
  return planned.slice(0, 4);
}
