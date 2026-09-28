import type { NormalizedProduct } from "./types";

function normalizeKey(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[إأآا]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export class DeduplicationService {
  deduplicate(results: NormalizedProduct[]): NormalizedProduct[] {
    const seen = new Set<string>();

    return results.filter((result) => {
      const key = result.productUrl
        ? `url:${result.productUrl}`
        : `title:${normalizeKey(`${result.title} ${result.merchant}`)}`;

      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}