type OutboundProduct = {
  source?: string;
  affiliateUrl?: string | null;
  productUrl?: string | null;
};

function isSafeHttpUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function isDealOutletProductPage(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      (url.hostname === 'www.thedealoutlet.com' || url.hostname === 'thedealoutlet.com') &&
      !url.port && !url.username && !url.password &&
      url.pathname !== '/';
  } catch {
    return false;
  }
}

function dealOutletWebDestination(affiliateUrl: string): string | undefined {
  try {
    const link = new URL(affiliateUrl);
    if (
      link.protocol !== 'https:' ||
      link.hostname !== 'bywiola.com' ||
      link.port || link.username || link.password
    ) {
      return undefined;
    }
    const officialProductPage = link.searchParams.get('ulp');
    return officialProductPage && isDealOutletProductPage(officialProductPage)
      ? officialProductPage
      : undefined;
  } catch {
    return undefined;
  }
}

export function productOutboundUrl(product: OutboundProduct, isAndroid: boolean): string | undefined {
  const original = product.affiliateUrl ?? product.productUrl;
  if (product.source === 'deal-outlet' && isAndroid) {
    if (!original) return undefined;
    // The feed's mobile affiliate redirect sends browsers without the merchant app
    // to Google Play. Its unmodified ulp is the same official product's web page.
    return isDealOutletProductPage(original)
      ? original
      : dealOutletWebDestination(original);
  }
  return isSafeHttpUrl(original) ? original : undefined;
}