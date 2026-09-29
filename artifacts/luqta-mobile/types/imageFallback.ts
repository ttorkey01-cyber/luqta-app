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

export function luxuryClosetAndroidImageUri(
  imageUrl: string,
  providerId: string | undefined,
  isAndroid: boolean,
): string {
  if (providerId !== 'luxury-closet' || !isAndroid) return imageUrl;
  try {
    const url = new URL(imageUrl);
    if (
      url.protocol === 'http:' &&
      url.hostname === 'cdn.theluxurycloset.com' &&
      !url.port &&
      !url.username &&
      !url.password
    ) {
      // The merchant's HTTP URL redirects to this exact HTTPS image.
      return imageUrl.replace(/^http:\/\//i, 'https://');
    }
  } catch {
    // Leave malformed URLs to the normal image-error placeholder.
  }
  return imageUrl;
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