export function nextProductImageUrl(
  candidates: readonly string[],
  failed: ReadonlySet<string>,
): string | undefined {
  return candidates.find((url) => {
    if (failed.has(url)) return false;
    try {
      const parsed = new URL(url);
      return (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
        Boolean(parsed.hostname);
    } catch {
      return false;
    }
  });
}

export function shouldTryNazihImageProxy(
  providerId: string,
  isAndroid: boolean,
  imageUrl: string,
  attemptedProxies: ReadonlySet<string>,
  approvedProxyUrl: string | undefined,
): boolean {
  return providerId === 'nazih' && isAndroid &&
    !attemptedProxies.has(imageUrl) && Boolean(approvedProxyUrl);
}

export function shouldShowDieselLogo(
  providerId: string,
  hasRenderableProductImage: boolean,
): boolean {
  return providerId === 'diesel' && !hasRenderableProductImage;
}