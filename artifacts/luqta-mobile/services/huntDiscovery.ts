import type { ProductResult } from '../types/search';

export type HuntDiscoveryPriceStatus =
  | 'within_budget'
  | 'above_budget'
  | 'known'
  | 'unavailable';

export type HuntDiscoveryMatch = {
  id: string;
  title: string;
  merchant?: string | null;
  productUrl?: string | null;
  affiliateUrl?: string | null;
  price: number | null;
  currency?: string | null;
  priceStatus: HuntDiscoveryPriceStatus;
};

export function buildHuntDiscoveryMatches(
  products: ProductResult[],
  targetPrice: number | undefined,
  currency: string,
  limit = 5,
): HuntDiscoveryMatch[] {
  return products.slice(0, Math.max(0, limit)).map((product) => {
    const hasVerifiedPrice =
      product.price != null &&
      Number.isFinite(product.price) &&
      product.price >= 0 &&
      product.currency?.toUpperCase() === currency.toUpperCase();
    const price = hasVerifiedPrice ? product.price! : null;
    const priceStatus: HuntDiscoveryPriceStatus = !hasVerifiedPrice
      ? 'unavailable'
      : targetPrice == null
        ? 'known'
        : price! <= targetPrice
          ? 'within_budget'
          : 'above_budget';

    return {
      id: product.id,
      title: product.title,
      merchant: product.merchant,
      productUrl: product.productUrl,
      affiliateUrl: product.affiliateUrl,
      price,
      currency: product.currency,
      priceStatus,
    };
  });
}