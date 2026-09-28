import { createHash } from "node:crypto";
import { expandShoppingQuery } from "./queryExpansion";
import { filterExplicitIntentResults } from "./searchOrchestrator";
import type { NormalizedProduct, QueryIntent } from "./types";

export type MonitorableHunt = {
  id: string;
  query: string;
  originalQuery: string;
  structuredIntent: QueryIntent;
  targetPrice: number | null;
  currency: string;
  condition: "any" | "new" | "used";
};

export type HuntMonitoringEvaluation = {
  discoveryMatches: Array<{
    id: string;
    title: string;
    merchant: string | null;
    productUrl: string | null;
    affiliateUrl: string | null;
    price: number | null;
    currency: string | null;
    priceStatus: "within_budget" | "above_budget" | "known" | "unavailable";
  }>;
  bestMatch: NormalizedProduct | null;
  matchStatus: "matched" | "no_reliable_match" | "no_verified_price";
  notificationCandidates: NormalizedProduct[];
};

const ORIGINAL_CLAIM_TERMS =
  /\b(?:original|genuine|authentic|oem)\b|اصلي|اصلية|أصلي|أصلية|وكالة|وكاله/u;
const REPLICA_CLAIM_TERMS =
  /\b(?:replica|fake|copy|imitation|counterfeit)\b|تقليد|مقلد|مقلدة|كوبي|غير\s+أصلي|غير\s+اصلي|هاي\s+كوبي/u;
const ARABIC_DIACRITICS = /[\u064B-\u065F\u0670\u0640]/gu;

function normalizeEvidence(value: string): string {
  return value
    .normalize("NFKD")
    .replace(ARABIC_DIACRITICS, "")
    .toLocaleLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

function textEvidence(product: NormalizedProduct): string {
  return normalizeEvidence(
    [
      product.title,
      product.description,
      product.brand,
      product.productType,
      product.category,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function intentEvidence(intent: QueryIntent): string {
  return normalizeEvidence(
    [
      intent.raw,
      intent.normalized,
      ...(intent.keywords ?? []),
      intent.partName,
      intent.partNumber,
      intent.oemNumber,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function listingSupportsOriginalClaim(
  intent: QueryIntent,
  product: NormalizedProduct,
): boolean {
  const requested = intentEvidence(intent);
  const listing = textEvidence(product);
  const asksForOriginal = ORIGINAL_CLAIM_TERMS.test(requested);
  const asksForOemNumber = Boolean(intent.oemNumber?.trim());

  if (
    asksForOemNumber &&
    !listing.includes(normalizeEvidence(intent.oemNumber!))
  ) {
    return false;
  }
  if (asksForOriginal && !ORIGINAL_CLAIM_TERMS.test(listing)) {
    return false;
  }
  return !REPLICA_CLAIM_TERMS.test(listing);
}

function matchesRequestedCondition(
  hunt: MonitorableHunt,
  product: NormalizedProduct,
): boolean {
  const intentCondition =
    hunt.structuredIntent.condition === "new" ||
    hunt.structuredIntent.condition === "used"
      ? hunt.structuredIntent.condition
      : null;
  const requested = hunt.condition === "any" ? intentCondition : hunt.condition;
  if (!requested) return true;
  if (requested === "new") return product.condition === "new";
  return product.condition === "used" || product.condition === "refurbished";
}

function hasVerifiedPrice(
  product: NormalizedProduct,
  currency: string,
): product is NormalizedProduct & { price: number } {
  return (
    product.price != null &&
    Number.isFinite(product.price) &&
    product.price >= 0 &&
    product.currency?.toUpperCase() === currency.toUpperCase()
  );
}

export function evaluateHuntResults(
  hunt: MonitorableHunt,
  products: NormalizedProduct[],
): HuntMonitoringEvaluation {
  const intent = hunt.structuredIntent;
  const expansion = expandShoppingQuery(
    intent.normalized || intent.raw || hunt.originalQuery || hunt.query,
  );
  const relevant = filterExplicitIntentResults(products, expansion, intent)
    .filter((product) => matchesRequestedCondition(hunt, product))
    .filter((product) => listingSupportsOriginalClaim(intent, product));
  const targetPrice = hunt.targetPrice ?? intent.maxPrice ?? null;
  const priced = relevant.filter((product) =>
    hasVerifiedPrice(product, hunt.currency),
  );
  const inBudget =
    targetPrice == null
      ? priced
      : priced.filter((product) => product.price <= targetPrice);
  const bestCandidates = inBudget.length > 0 ? inBudget : priced;
  const bestMatch =
    [...bestCandidates].sort(
      (a, b) => (a.price ?? Number.POSITIVE_INFINITY) - (b.price ?? Number.POSITIVE_INFINITY),
    )[0] ?? null;

  const discoveryMatches = relevant.slice(0, 5).map((product) => {
    const verified = hasVerifiedPrice(product, hunt.currency);
    const price = verified ? product.price : null;
    const priceStatus: HuntMonitoringEvaluation["discoveryMatches"][number]["priceStatus"] = !verified
      ? "unavailable"
      : targetPrice == null
        ? "known"
        : price! <= targetPrice
          ? "within_budget"
          : "above_budget";

    return {
      id: product.id,
      title: product.title,
      merchant: product.merchant ?? null,
      productUrl: product.productUrl ?? null,
      affiliateUrl: product.affiliateUrl ?? null,
      price,
      currency: product.currency ?? null,
      priceStatus,
    };
  });

  return {
    discoveryMatches,
    bestMatch,
    matchStatus:
      relevant.length === 0
        ? "no_reliable_match"
        : priced.length === 0
          ? "no_verified_price"
          : "matched",
    notificationCandidates: inBudget,
  };
}

function canonicalIntent(intent: QueryIntent): Record<string, unknown> {
  const keywords = (intent.keywords ?? [])
    .map(normalizeEvidence)
    .filter(Boolean)
    .sort();
  return {
    fallbackQuery: normalizeEvidence(intent.normalized || intent.raw || "")
      .replace(
        /\b(?:under|below|less than|up to|at most|maximum|max)\s*(?:sar|riyal|riyals)?\s*[\d,.]+/giu,
        " ",
      )
      .replace(
        /(?:اقل من|تحت|بحد اقصى|لا يتجاوز)\s*[\d,.]+/gu,
        " ",
      )
      .replace(/\s+/gu, " ")
      .trim(),
    keywords,
    category: intent.category?.toLowerCase() ?? null,
    productType: intent.productType?.toLowerCase() ?? null,
    audience: intent.audience ?? null,
    brand: intent.brand?.toLowerCase() ?? null,
    color: intent.color?.toLowerCase() ?? null,
    minPrice: intent.minPrice ?? null,
    currency: intent.currency ?? null,
    condition: intent.condition ?? null,
    location: intent.location?.toLowerCase() ?? null,
    vehicleMake: intent.vehicleMake?.toLowerCase() ?? null,
    vehicleModel: intent.vehicleModel?.toLowerCase() ?? null,
    vehicleYear: intent.vehicleYear ?? null,
    partName: intent.partName?.toLowerCase() ?? null,
    partNumber: intent.partNumber?.toLowerCase() ?? null,
    oemNumber: intent.oemNumber?.toLowerCase() ?? null,
    newOrUsed: intent.newOrUsed ?? null,
  };
}

export function huntSearchCacheKey(
  intent: QueryIntent,
  providerIds: string[] = [],
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        intent: canonicalIntent(intent),
        providerIds: [...providerIds].sort(),
      }),
    )
    .digest("hex");
}

export function huntNotificationResultKey(product: NormalizedProduct): string {
  const merchant = normalizeEvidence(product.merchant || "");
  const title = normalizeEvidence(product.title);
  if (
    merchant &&
    title.length >= 8 &&
    product.price != null &&
    Number.isFinite(product.price) &&
    product.currency
  ) {
    const identity = [
      merchant,
      title,
      product.price.toFixed(2),
      product.currency.toUpperCase(),
      product.condition ?? "unknown",
    ].join("|");
    return `listing:${createHash("sha256").update(identity).digest("hex")}`;
  }
  return `${product.providerId}:${product.providerProductId || product.id}`;
}

export function intentForUnboundedSearch(intent: QueryIntent): QueryIntent {
  const { maxPrice: _maxPrice, ...unbounded } = intent;
  return unbounded;
}