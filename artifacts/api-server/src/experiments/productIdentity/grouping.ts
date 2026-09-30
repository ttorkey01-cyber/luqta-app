import { classifyPair, canonicalOffer, canonicalVariant } from "./engine";
import type {
  IdentityRecord,
  OfferGroup,
  ProductGroup,
  VariantGroup,
} from "./types";

function groupKey(record: IdentityRecord, index: number): string {
  const decision = classifyPair(record, record);
  return decision.productIdentity ?? `unresolved:${record.id}:${index}`;
}

function canJoin(records: IdentityRecord[], candidate: IdentityRecord): boolean {
  if (!records.length) return false;
  return records.every((record) => {
    const decision = classifyPair(record, candidate);
    const classification = decision.classification;
    return classification === "SAME_PRODUCT_SAME_VARIANT" ||
      classification === "SAME_PRODUCT_DIFFERENT_VARIANT" ||
      (classification === "PROBABLE_SAME_PRODUCT" && decision.productIdentity !== null);
  });
}

function makeOfferGroups(records: IdentityRecord[]): OfferGroup[] {
  const groups = new Map<string, IdentityRecord[]>();
  for (const record of records) {
    const key = canonicalOffer(record) || `record:${record.id}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  return [...groups].map(([key, groupedRecords]) => ({
    offerIdentity: key.startsWith("record:") ? key : `offer:${key}`,
    records: groupedRecords,
  }));
}

function makeVariantGroups(records: IdentityRecord[]): VariantGroup[] {
  const groups = new Map<string, IdentityRecord[]>();
  for (const record of records) {
    const key = canonicalVariant(record) || "variant:unspecified";
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  return [...groups].map(([key, groupedRecords]) => ({
    variantIdentity: key,
    records: groupedRecords,
    offers: makeOfferGroups(groupedRecords),
  }));
}

/**
 * Groups only records with a mutually supported identity. Unresolved records
 * stay separate, and complete-link checks prevent transitive false merges.
 */
export function groupCandidates(records: readonly IdentityRecord[]): ProductGroup[] {
  const products: Array<{ key: string; records: IdentityRecord[] }> = [];
  records.forEach((record, index) => {
    const key = groupKey(record, index);
    if (key.startsWith("unresolved:")) {
      products.push({ key, records: [record] });
      return;
    }
    const existing = products.find((group) => canJoin(group.records, record));
    if (existing) existing.records.push(record);
    else products.push({ key, records: [record] });
  });
  return products.map((product) => ({
    productIdentity: product.key,
    records: product.records,
    variants: makeVariantGroups(product.records),
  }));
}