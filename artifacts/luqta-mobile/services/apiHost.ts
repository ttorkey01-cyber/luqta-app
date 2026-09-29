export const PRODUCTION_API_BASE_URL =
  'https://luqta-mobile-shopping-app--ttorkey01.replit.app';

export function resolveMobileApiBaseUrl(
  isDevelopment: boolean,
  developmentDomain?: string,
): string | null {
  if (isDevelopment) {
    return developmentDomain ? `https://${developmentDomain}` : null;
  }

  // EAS Update compiles JS independently of the APK build profile. Never use
  // an environment variable (or a relative URL) as the release API fallback.
  const url = new URL(PRODUCTION_API_BASE_URL);
  if (
    url.protocol !== 'https:' ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Production API host is invalid');
  }
  return url.origin;
}