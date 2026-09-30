import {
  canonicalIdentifierKind as normalizeIdentifierKind,
  normalizeIdentifier,
  normalizeIdentifiers,
} from "./identifiers";
import type {
  IdentityEvidence,
  IdentityQuery,
  IdentityRecord,
  NormalizedIdentifier,
  PairClassification,
  ProductIdentityDecision,
  ProductVariant,
} from "./types";

const normalize = (value: unknown): string =>
  typeof value === "string"
    ? value.normalize("NFKC").toLocaleLowerCase("en-US")
        .replace(/[‐‑‒–—−]/g, "-")
        .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ")
    : typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : "";

const compact = (value: unknown): string => normalize(value).replace(/\s+/g, "");
const evidence = (
  code: string,
  source: string,
  detail: string,
  value?: string,
): IdentityEvidence => ({ code, source, detail, ...(value ? { value } : {}) });

function identifierEntries(record: IdentityRecord): NormalizedIdentifier[] {
  const entries = normalizeIdentifiers(record.identifiers ?? []);
  if (record.styleCode) {
    entries.push(normalizeIdentifier({ kind: "STYLE", value: record.styleCode }));
  }
  if (record.model) {
    entries.push(normalizeIdentifier({
      kind: "MODEL",
      value: record.model,
      scope: record.brand,
    }));
  }
  return entries.filter((entry) => entry.status === "VALID");
}

function identityKind(id: NormalizedIdentifier): string {
  return /^GTIN(?:8|12|13|14)?$/.test(id.canonicalKind)
    ? "GTIN"
    : canonicalIdentifierKind(id.kind);
}

function scopeOf(record: IdentityRecord, id: NormalizedIdentifier): string {
  return normalize(id.scope || (["MPN", "OEM", "MODEL", "STYLE", "SKU"].includes(identityKind(id))
    ? record.brand
    : ""));
}

function idKey(record: IdentityRecord, id: NormalizedIdentifier): string {
  return `${identityKind(id)}|${scopeOf(record, id)}|${id.normalized}`;
}

function canonicalIdentifierKind(kind: string): string {
  const canonicalKind = normalizeIdentifierKind(kind);
  return /^GTIN(?:8|12|13|14)?$/.test(canonicalKind) ? "GTIN" : canonicalKind;
}

function categoryFamily(value?: string): string {
  const category = normalize(value);
  if (!category) return "";
  const families: Array<[RegExp, string]> = [
    [/(phone|smartphone|mobile|tablet|laptop|computer|electronics)/, "electronics"],
    [/(fashion|clothing|apparel|dress|shoe|footwear|bag)/, "fashion"],
    [/(beauty|cosmetic|skincare|personal care)/, "beauty"],
    [/(automotive|auto|vehicle|car|motor)/, "automotive"],
  ];
  return families.find(([pattern]) => pattern.test(category))?.[1] ?? category;
}

const VARIANT_KEYS: (keyof ProductVariant)[] = [
  "color", "size", "storage", "capacity", "packQuantity", "material", "region",
];

export function canonicalVariant(record: IdentityRecord): string {
  const entries = VARIANT_KEYS.flatMap((key) => {
    const value = record.variant?.[key];
    const normalized = normalize(value);
    return normalized ? [`${key}=${normalized}`] : [];
  });
  return entries.join("|");
}

export function canonicalOffer(record: IdentityRecord): string {
  const offerId = record.offer?.providerOfferId?.trim();
  if (!offerId || !record.providerId?.trim()) return "";
  return `source:${normalize(record.providerId)}|offer:${normalize(offerId)}`;
}

function variantsConflict(left: IdentityRecord, right: IdentityRecord): string[] {
  const conflicts: string[] = [];
  for (const key of VARIANT_KEYS) {
    const a = normalize(left.variant?.[key]);
    const b = normalize(right.variant?.[key]);
    if (a && b && a !== b) conflicts.push(key);
  }
  return conflicts;
}

function queryVariant(query?: IdentityQuery): Partial<ProductVariant> {
  if (!query) return {};
  if (typeof query === "string") {
    const text = normalize(query);
    const colors = [
      "black", "white", "red", "blue", "green", "yellow", "orange",
      "purple", "pink", "brown", "gray", "grey", "beige", "navy",
      "silver", "gold", "clear",
    ];
    const color = colors.find((candidate) =>
      new RegExp(`(?:^| )${candidate}(?:$| )`).test(text));
    const storageMatch = text.match(/\b(\d+(?:\.\d+)?)\s*(tb|gb|mb)\b/);
    const capacityMatch = text.match(/\b(\d+(?:\.\d+)?)\s*(ml|l|fl oz|oz)\b/);
    const packMatch = text.match(/\b(?:pack of\s*|)(\d+)\s*[- ]?pack\b|\b(\d+)\s*pack\b/);
    const result: Partial<ProductVariant> = {};
    if (color) result.color = color;
    if (storageMatch) result.storage = `${storageMatch[1]} ${storageMatch[2]}`;
    if (capacityMatch) result.capacity = `${capacityMatch[1]} ${capacityMatch[2]}`;
    const packQuantity = packMatch?.[1] ?? packMatch?.[2];
    if (packQuantity) result.packQuantity = packQuantity;
    return result;
  }
  return {
    color: query.color,
    size: query.size,
    storage: query.storage,
    capacity: query.capacity,
    packQuantity: query.packQuantity,
    material: query.material,
    region: query.region,
  };
}

function tokenSimilarity(left: string, right: string): number {
  const stopWords = new Set(["the", "for", "with", "and", "new", "original", "genuine", "product"]);
  const a = new Set(normalize(left).split(" ").filter((token) => token.length > 1 && !stopWords.has(token)));
  const b = new Set(normalize(right).split(" ").filter((token) => token.length > 1 && !stopWords.has(token)));
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const token of a) if (b.has(token)) common += 1;
  return common / (a.size + b.size - common);
}

function looksLikeNonProductPage(record: IdentityRecord): boolean {
  return /\b(bundle|compatible with|replacement for|review|manual|guide|how to|parts? for|accessor(?:y|ies)|collection|assorted)\b/i
    .test(`${record.title} ${record.description ?? ""}`);
}

function explicitIdentityKeys(record: IdentityRecord): Map<string, string> {
  return new Map(identifierEntries(record).map((entry) => [
    identityKind(entry),
    idKey(record, entry),
  ]));
}

function titleModelCode(record: IdentityRecord): { family: string; code: string } | null {
  const title = record.title;
  const brand = normalize(record.brand);
  if (brand.includes("samsung") || /\bsamsung\b|\bgalaxy\b/i.test(title)) {
    const match = title.match(/\bgalaxy\s+(s\d{1,2})(?:\s*(\+|plus|fe|ultra))?(?=$|[\s,|])/i);
    if (match) {
      const suffix = (match[2] ?? "").replace("+", "plus").toLowerCase();
      return { family: "samsung-galaxy-s", code: `${match[1].toLowerCase()}${suffix}` };
    }
  }
  if (brand.includes("apple") || /\biphone\b/i.test(title)) {
    const match = title.match(/\biphone\s*(\d{1,2})(?:\s*(pro\s*max|pro|max|plus|mini))?(?=$|[\s,|])/i);
    if (match) {
      const suffix = (match[2] ?? "").toLowerCase().replace(/\s+/g, "");
      return { family: "apple-iphone", code: `${match[1]}${suffix}` };
    }
  }
  if (brand.includes("nike") || /\bnike\b/i.test(title)) {
    const match = title.match(/\b([a-z]{2,4}\d{3,5})[- ](\d{2,3})\b/i);
    if (match) return { family: "nike-style", code: `${match[1]}-${match[2]}`.toLowerCase() };
  }
  return null;
}

function compareIdentity(
  left: IdentityRecord,
  right: IdentityRecord,
): { matched: string[]; conflicts: string[] } {
  const a = explicitIdentityKeys(left);
  const b = explicitIdentityKeys(right);
  const matched: string[] = [];
  const conflicts: string[] = [];
  for (const kind of new Set([...a.keys(), ...b.keys()])) {
    const av = a.get(kind);
    const bv = b.get(kind);
    if (av && bv) {
      if (av === bv) matched.push(kind);
      else conflicts.push(kind);
    }
  }
  const brandA = normalize(left.brand);
  const brandB = normalize(right.brand);
  if (brandA && brandB && brandA !== brandB) conflicts.push("BRAND");
  if (left.styleCode && right.styleCode &&
      compact(left.styleCode) !== compact(right.styleCode)) conflicts.push("STYLE");
  if (left.model && right.model && brandA && brandA === brandB &&
      compact(left.model) !== compact(right.model)) conflicts.push("MODEL");
  const titleModelA = titleModelCode(left);
  const titleModelB = titleModelCode(right);
  if (titleModelA && titleModelB &&
      titleModelA.family === titleModelB.family &&
      titleModelA.code !== titleModelB.code) {
    conflicts.push("TITLE_MODEL_CODE");
  }
  return { matched, conflicts: [...new Set(conflicts)] };
}

function stableIdentity(record: IdentityRecord): string {
  const preferred = ["GTIN", "GTIN8", "GTIN12", "GTIN13", "GTIN14", "STYLE", "OEM", "MPN", "MODEL"];
  const ids = identifierEntries(record);
  const selected = ids.sort((a, b) =>
    preferred.indexOf(String(a.kind).toUpperCase()) -
    preferred.indexOf(String(b.kind).toUpperCase()))[0];
  if (selected) return `product:${idKey(record, selected)}`;
  if (record.styleCode) return `product:STYLE|${normalize(record.brand)}|${compact(record.styleCode)}`;
  if (record.model && record.brand) return `product:MODEL|${normalize(record.brand)}|${compact(record.model)}`;
  if (record.providerId && record.providerProductId) {
    return `product:PROVIDER|${normalize(record.providerId)}|${normalize(record.providerProductId)}`;
  }
  return `product:record|${record.id}`;
}

function hasMatchingValidGtin(left: IdentityRecord, right: IdentityRecord): boolean {
  const gtinValues = (record: IdentityRecord) => identifierEntries(record)
    .filter((entry) => identityKind(entry) === "GTIN")
    .map((entry) => entry.normalized);
  const rightValues = new Set(gtinValues(right));
  return gtinValues(left).some((value) => rightValues.has(value));
}

function hasSufficientMatchingVariantEvidence(
  left: IdentityRecord,
  right: IdentityRecord,
  category: string,
): boolean {
  const same = (key: keyof ProductVariant) => {
    const leftValue = normalize(left.variant?.[key]);
    const rightValue = normalize(right.variant?.[key]);
    return !!leftValue && leftValue === rightValue;
  };
  if (category === "fashion") return same("color") && same("size");
  if (category === "beauty") return same("capacity") && same("packQuantity");
  if (category === "electronics") return same("storage") || same("capacity");
  if (category === "automotive") return false;
  const leftVariant = canonicalVariant(left);
  return !!leftVariant && leftVariant === canonicalVariant(right);
}

/**
 * Compares catalog records using source-backed fields. Text similarity can
 * support a probable/related decision, but never establishes exact identity.
 */
export function classifyPair(
  left: IdentityRecord,
  right: IdentityRecord,
  query?: IdentityQuery,
): ProductIdentityDecision {
  const positiveEvidence: IdentityEvidence[] = [];
  const conflictingEvidence: IdentityEvidence[] = [];
  const unknownEvidence: IdentityEvidence[] = [];
  const { matched, conflicts } = compareIdentity(left, right);

  for (const kind of matched) {
    positiveEvidence.push(evidence(`MATCHED_${kind}`, "identifiers", `Matching ${kind} identifier`, kind));
  }
  for (const kind of conflicts) {
    conflictingEvidence.push(evidence(`CONFLICTING_${kind}`, "catalog_fields", `Conflicting ${kind} values`));
  }
  if (left.providerId && right.providerId && left.providerId === right.providerId &&
      left.providerProductId && right.providerProductId &&
      left.providerProductId === right.providerProductId) {
    positiveEvidence.push(evidence("MATCHED_PROVIDER_PRODUCT_ID", "providerId+providerProductId", "Same product ID within the same provider scope"));
  } else if (left.providerProductId && right.providerProductId &&
      left.providerProductId === right.providerProductId) {
    unknownEvidence.push(evidence("PROVIDER_ID_UNSCOPED", "providerProductId", "Provider product IDs are not globally comparable without the same providerId"));
  }

  const brandA = normalize(left.brand);
  const brandB = normalize(right.brand);
  const categoryA = categoryFamily(left.category);
  const categoryB = categoryFamily(right.category);
  if (brandA && brandA === brandB && left.model && right.model &&
      compact(left.model) === compact(right.model)) {
    positiveEvidence.push(evidence("MATCHED_BRAND_MODEL", "brand+model", "Matching model scoped to the same brand"));
  }
  const knownConflict = conflicts.length > 0;
  const strongMatch = matched.length > 0 ||
    positiveEvidence.some((item) => item.code === "MATCHED_PROVIDER_PRODUCT_ID" || item.code === "MATCHED_BRAND_MODEL");

  const variantConflicts = variantsConflict(left, right);
  for (const key of variantConflicts) {
    conflictingEvidence.push(evidence(`VARIANT_${key.toUpperCase()}_CONFLICT`, `variant.${key}`, `Different ${key} values identify incompatible variants`));
  }

  const titleScore = tokenSimilarity(left.title, right.title);
  if (titleScore > 0) {
    positiveEvidence.push(evidence("TITLE_TOKEN_OVERLAP", "title", "Titles share descriptive tokens; title evidence alone is not exact identity", titleScore.toFixed(2)));
  }
  if (looksLikeNonProductPage(left) || looksLikeNonProductPage(right)) {
    unknownEvidence.push(evidence("NON_PRODUCT_OR_FAMILY_PAGE", "title/description", "Editorial, family, compatibility, or assortment wording prevents title-only identity"));
  }
  if (!brandA || !brandB) unknownEvidence.push(evidence("BRAND_INCOMPLETE", "brand", "Brand evidence is missing on at least one record"));
  if (!categoryA || !categoryB) unknownEvidence.push(evidence("CATEGORY_INCOMPLETE", "category", "Category evidence is missing on at least one record"));
  else if (categoryA !== categoryB) conflictingEvidence.push(evidence("CATEGORY_CONFLICT", "category", "Records belong to different category families"));

  let classification: PairClassification;
  let confidence: number;
  let productIdentity: string | null = null;
  if (knownConflict) {
    classification = "DIFFERENT_PRODUCT";
    confidence = 0.98;
  } else if (strongMatch) {
    productIdentity = stableIdentity(left);
    if (variantConflicts.length) {
      classification = "SAME_PRODUCT_DIFFERENT_VARIANT";
      confidence = 0.96;
    } else if (
      hasMatchingValidGtin(left, right) ||
      hasSufficientMatchingVariantEvidence(left, right, categoryA || categoryB)
    ) {
      classification = "SAME_PRODUCT_SAME_VARIANT";
      confidence = hasMatchingValidGtin(left, right) ? 0.995 : 0.9;
    } else {
      classification = "PROBABLE_SAME_PRODUCT";
      confidence = 0.82;
      unknownEvidence.push(evidence(
        "VARIANT_DETAILS_INCOMPLETE",
        "variant",
        "Product identity is supported, but available variant evidence cannot establish the same trade variant.",
      ));
    }
  } else if (titleScore >= 0.45 && (!categoryA || !categoryB || categoryA === categoryB)) {
    classification = "PROBABLE_SAME_PRODUCT";
    confidence = Math.min(0.79, 0.52 + titleScore * 0.25);
  } else if (titleScore >= 0.18 || (brandA && brandA === brandB && categoryA && categoryA === categoryB)) {
    classification = "RELATED_PRODUCT";
    confidence = Math.min(0.65, 0.35 + titleScore * 0.25);
  } else if (titleScore === 0 && (categoryA || categoryB || brandA || brandB)) {
    classification = "DIFFERENT_PRODUCT";
    confidence = 0.78;
  } else {
    classification = "UNKNOWN";
    confidence = 0.2;
  }

  // Query preferences annotate compatibility without changing either catalog identity.
  const requestedVariant = queryVariant(query);
  for (const key of VARIANT_KEYS) {
    const wanted = requestedVariant[key];
    if (wanted !== undefined) {
      const leftValue = left.variant?.[key];
      const rightValue = right.variant?.[key];
      const leftMatches = normalize(leftValue) === normalize(wanted);
      const rightMatches = normalize(rightValue) === normalize(wanted);
      if (leftMatches !== rightMatches) {
        positiveEvidence.push(evidence(
          "QUERY_VARIANT_PREFERENCE",
          `query.${key}`,
          `Query prefers the ${key} on one record; catalog variant identities remain distinct`,
          String(wanted),
        ));
      }
    }
  }
  if (typeof query === "object" && query) {
    const queryBrand = normalize(query.brand);
    const queryModel = compact(query.model);
    if (queryBrand || queryModel || query.styleCode) {
      unknownEvidence.push(evidence("QUERY_CONTEXT_ONLY", "query", "Query constraints are contextual and do not rewrite catalog identity"));
    }
  }

  const variantIdentity = (strongMatch || productIdentity) ? canonicalVariant(left) || canonicalVariant(right) || null : null;
  const offer = canonicalOffer(left) || canonicalOffer(right);
  return {
    classification,
    confidence,
    positiveEvidence,
    conflictingEvidence,
    unknownEvidence,
    productIdentity,
    variantIdentity,
    offerIdentity: offer ? `offer:${offer}` : null,
    explanation: classification === "SAME_PRODUCT_SAME_VARIANT"
      ? "A scoped, source-backed identifier or matching brand/model supports product identity; no variant conflict was observed."
      : classification === "SAME_PRODUCT_DIFFERENT_VARIANT"
        ? "Product identity is supported, but explicit variant fields conflict."
        : classification === "DIFFERENT_PRODUCT"
          ? "Conflicting strong identity evidence or clearly distinct records outweighs descriptive similarity."
          : classification === "PROBABLE_SAME_PRODUCT"
            ? "Descriptive evidence suggests a possible match, but no authoritative identity evidence supports an exact match."
            : classification === "RELATED_PRODUCT"
              ? "Records share limited descriptive or category context without sufficient evidence of the same product."
              : "Available evidence is insufficient to decide product identity.",
  };
}