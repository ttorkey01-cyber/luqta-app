import { BraveWebSearchProvider } from "../../connectors/braveWebSearchProvider";
import { createDefaultProviderRegistry, ProviderRegistry } from "../../connectors/providerRegistry";
import type { ProviderProduct } from "../../connectors/types";
import { ExperimentalSearchV3 } from "./index";
import { PixelVisualSimilarityAdapter } from "./visual";
import { createImageUrlLoader } from "./visual/urlLoader";

export type SearchV3FactoryOptions = {
  /** Exact HTTPS hostnames approved for candidate product image loading. */
  candidateImageHostAllowlist?: string[];
  /** Optional pre-indexed catalog used only for photo-only requests. */
  photoOnlyCandidatePool?:
    | readonly ProviderProduct[]
    | ((
        maxCandidates: number,
      ) => Promise<readonly ProviderProduct[]> | readonly ProviderProduct[]);
};

/**
 * Construct the experiment on demand. Importing this module has no side
 * effects; without an explicit opt-in, no feed providers or Brave client are
 * constructed and the prototype cannot perform a search.
 */
export function createSearchV3Experiment(
  enabled = process.env.LUQTA_SEARCH_V3_EXPERIMENTAL === "true",
  options: SearchV3FactoryOptions = {},
): ExperimentalSearchV3 {
  const allowedImageHosts = options.candidateImageHostAllowlist ?? [];
  return new ExperimentalSearchV3({
    registry: enabled
      ? createDefaultProviderRegistry({ startBackgroundRefresh: false })
      : new ProviderRegistry([]),
    brave: enabled ? new BraveWebSearchProvider() : undefined,
    visualAdapter: enabled ? new PixelVisualSimilarityAdapter() : undefined,
    imageLoader:
      enabled && allowedImageHosts.length > 0
        ? createImageUrlLoader({ enabled: true, allowedHosts: allowedImageHosts })
        : undefined,
    photoOnlyCandidatePool: options.photoOnlyCandidatePool,
    enabled,
  });
}