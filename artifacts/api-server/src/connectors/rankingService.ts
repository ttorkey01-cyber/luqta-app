import type { NormalizedProduct, QueryIntent } from "./types";
import { getElectronicsCategoryQuality } from "./categoryTaxonomy";

export class RankingService {
  rank(
    results: NormalizedProduct[],
    intent?: QueryIntent,
    electronicsCategoryBrowse = false,
  ): NormalizedProduct[] {
    return [...results]
      .map((result) => {
        const requestedCondition = intent?.condition;
        const conditionScore = requestedCondition
          ? result.condition === requestedCondition
            ? 1
            : 0
          : 0.5;
        const locationScore = intent?.location
          ? result.location === intent.location
            ? 1
            : 0
          : 0.5;
        const priceScore = this.priceScore(result.price, result.currency, intent);
        const baseRankScore =
          (result.exactMatchScore ?? 0.5) * 0.3 +
          (result.visualScore ?? 0.5) * 0.15 +
          (result.specificationScore ?? 0.5) * 0.15 +
          priceScore * 0.12 +
          result.availabilityScore * 0.1 +
          (result.reliabilityScore ?? 0.5) * 0.08 +
          conditionScore * 0.06 +
          locationScore * 0.04;

        const dataQuality =
          (result.imageUrl ? 0.35 : 0) +
          (result.price !== null && result.price !== undefined ? 0.3 : 0) +
          (result.affiliateUrl || result.productUrl ? 0.2 : 0) +
          (result.description && result.description.trim().length > 20 ? 0.15 : 0);
        const rankScore = electronicsCategoryBrowse
          ? getElectronicsCategoryQuality(result) * 0.58 +
            dataQuality * 0.24 +
            baseRankScore * 0.18
          : baseRankScore;
        return {
          ...result,
          priceScore,
          conditionScore,
          locationScore,
          rankScore,
        };
      })
      .sort((a, b) => b.rankScore - a.rankScore);
  }

  private priceScore(
    price: number | null | undefined,
    currency: string | null | undefined,
    intent?: QueryIntent,
  ) {
    if (price === undefined || price === null) return 0.5;
    if (intent?.maxPrice !== undefined) {
      return price <= intent.maxPrice
        ? 1
        : Math.max(0, intent.maxPrice / price);
    }
    if (intent?.minPrice !== undefined) {
      return price >= intent.minPrice
        ? 1
        : Math.max(0, price / intent.minPrice);
    }
    // A stated approximate budget is a small preference, never a price gate.
    // Keep unknown prices neutral and preserve the original strict-bound priority.
    const target = intent?.approximatePrice;
    if (target !== undefined && Number.isFinite(target) && target > 0) {
      // Never compare nominal amounts in different or unknown currencies.
      if (currency?.trim().toUpperCase() !== (intent?.currency ?? "SAR").trim().toUpperCase()) {
        return 0.5;
      }
      const relativeDistance = Math.min(1, Math.abs(price - target) / target);
      return 0.6 - relativeDistance * 0.2;
    }
    return 0.5;
  }
}