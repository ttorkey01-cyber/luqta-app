import type { NormalizedProduct, ProviderMetadata } from "./types";

function isSafeHttpUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export class AffiliateLinkService {
  attach(
    product: NormalizedProduct,
    provider: ProviderMetadata | undefined,
  ): NormalizedProduct {
    const authorizedAffiliateUrl =
      provider?.affiliateEnabled && isSafeHttpUrl(product.affiliateUrl)
        ? product.affiliateUrl
        : undefined;
    const directProductUrl = isSafeHttpUrl(product.productUrl)
      ? product.productUrl
      : undefined;
    const productUrl =
      !authorizedAffiliateUrl &&
      product.affiliateUrl &&
      directProductUrl === product.affiliateUrl
        ? undefined
        : directProductUrl;
    const destinationUrl = authorizedAffiliateUrl ?? productUrl;
    const canonical = {
      ...product.canonical,
      productUrl: productUrl ?? null,
      affiliateUrl: authorizedAffiliateUrl ?? null,
      destinationUrl: destinationUrl ?? null,
    };

    return {
      ...product,
      productUrl,
      affiliateUrl: authorizedAffiliateUrl ?? null,
      canonical,
      destinationUrl,
      isAffiliate: Boolean(authorizedAffiliateUrl),
    };
  }
}