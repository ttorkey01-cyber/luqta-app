import { canonicalVariant, classifyPair } from "./engine";
import type { CheaperAssessment, IdentityEvidence, IdentityRecord } from "./types";

const evidence = (code: string, source: string, detail: string): IdentityEvidence => ({
  code, source, detail,
});

function parsedDate(value?: string): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/**
 * Only compares the exact same product and compatible variant, with current
 * in-stock offers and valid same-currency prices. Missing data is UNKNOWN;
 * mismatches are alternatives rather than savings claims.
 */
export function assessSameProductCheaper(
  reference: IdentityRecord,
  candidate: IdentityRecord,
  options: { now?: Date | string; maxAgeMs?: number } = {},
): CheaperAssessment {
  const decision = classifyPair(reference, candidate);
  const evidenceItems: IdentityEvidence[] = [];
  if (decision.classification === "SAME_PRODUCT_DIFFERENT_VARIANT") {
    return {
      classification: "ALTERNATIVE",
      isCheaper: false,
      savings: null,
      savingsPercent: null,
      explanation: "The candidate is a different product variant, so it is not a comparable cheaper offer.",
      evidence: [evidence("VARIANT_MISMATCH", "identity", "Variants are explicitly incompatible")],
    };
  }
  if (decision.classification !== "SAME_PRODUCT_SAME_VARIANT") {
    const alternative = ["DIFFERENT_PRODUCT", "RELATED_PRODUCT"].includes(decision.classification);
    return {
      classification: alternative ? "ALTERNATIVE" : "UNKNOWN",
      isCheaper: false,
      savings: null,
      savingsPercent: null,
      explanation: alternative
        ? "Identity evidence does not establish the exact same product and variant."
        : "Product identity is uncertain; no savings comparison is safe.",
      evidence: [evidence("IDENTITY_NOT_EXACT", "identity", "Exact same-product/same-variant evidence is required")],
    };
  }

  const referenceVariant = canonicalVariant(reference);
  const candidateVariant = canonicalVariant(candidate);
  if ((referenceVariant || candidateVariant) && referenceVariant !== candidateVariant) {
    return unknown(
      "VARIANT_DETAILS_INCOMPLETE",
      "variant",
      "Variant details are incomplete or differ, so a safe price comparison cannot be made.",
    );
  }

  const referenceOffer = reference.offer;
  const candidateOffer = candidate.offer;
  if (!referenceOffer || !candidateOffer) {
    return unknown("OFFER_MISSING", "offer", "Both records must include a comparable offer.");
  }
  const priceA = referenceOffer.price;
  const priceB = candidateOffer.price;
  if (typeof priceA !== "number" || !Number.isFinite(priceA) || priceA <= 0 ||
      typeof priceB !== "number" || !Number.isFinite(priceB) || priceB <= 0) {
    return unknown("PRICE_INVALID", "offer.price", "Both prices must be finite positive numbers.");
  }
  const currencyA = referenceOffer.currency?.trim().toUpperCase();
  const currencyB = candidateOffer.currency?.trim().toUpperCase();
  if (!currencyA || !currencyB || currencyA !== currencyB) {
    return unknown("CURRENCY_MISMATCH_OR_MISSING", "offer.currency", "Offers must have the same explicit currency.");
  }
  if (!isInStock(referenceOffer.availability) || !isInStock(candidateOffer.availability)) {
    return unknown("AVAILABILITY_UNSAFE", "offer.availability", "Both offers must be explicitly in stock.");
  }
  const nowValue = options.now ?? new Date();
  const now = typeof nowValue === "string" ? Date.parse(nowValue) : nowValue.getTime();
  const maxAgeMs = options.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000;
  const updatedA = parsedDate(referenceOffer.updatedAt);
  const updatedB = parsedDate(candidateOffer.updatedAt);
  if (updatedA === null || updatedB === null || !Number.isFinite(now) ||
      now - updatedA < 0 || now - updatedB < 0 ||
      now - updatedA > maxAgeMs || now - updatedB > maxAgeMs) {
    return unknown("OFFER_STALE_OR_UNDATED", "offer.updatedAt", "Both offers must have valid, recent timestamps.");
  }

  evidenceItems.push(evidence("SAME_PRODUCT_VARIANT", "identity", "Exact product and compatible variant established"));
  evidenceItems.push(evidence("FRESH_IN_STOCK_SAME_CURRENCY", "offer", "Both offers are fresh, in stock, and priced in the same currency"));
  const savings = priceA - priceB;
  return {
    classification: savings > 0 ? "SAME_PRODUCT_CHEAPER" : "ALTERNATIVE",
    isCheaper: savings > 0,
    savings: savings > 0 ? Number(savings.toFixed(2)) : 0,
    savingsPercent: savings > 0 ? Number(((savings / priceA) * 100).toFixed(2)) : 0,
    explanation: savings > 0
      ? `Candidate is ${savings.toFixed(2)} ${currencyA} cheaper for the same fresh, in-stock product variant.`
      : "Candidate is not cheaper than the reference offer.",
    evidence: evidenceItems,
  };

  function isInStock(value?: string): boolean {
    return !!value && ["in_stock", "instock", "available"].includes(value.trim().toLowerCase());
  }

  function unknown(code: string, source: string, explanation: string): CheaperAssessment {
    return {
      classification: "UNKNOWN",
      isCheaper: false,
      savings: null,
      savingsPercent: null,
      explanation,
      evidence: [evidence(code, source, explanation)],
    };
  }
}