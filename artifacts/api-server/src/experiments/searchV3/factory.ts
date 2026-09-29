import { BraveWebSearchProvider } from "../../connectors/braveWebSearchProvider";
import { createDefaultProviderRegistry, ProviderRegistry } from "../../connectors/providerRegistry";
import { ExperimentalSearchV3 } from "./index";

/**
 * Construct the experiment on demand. Importing this module has no side
 * effects; without an explicit opt-in, no feed providers or Brave client are
 * constructed and the prototype cannot perform a search.
 */
export function createSearchV3Experiment(
  enabled = process.env.LUQTA_SEARCH_V3_EXPERIMENTAL === "true",
): ExperimentalSearchV3 {
  return new ExperimentalSearchV3({
    registry: enabled
      ? createDefaultProviderRegistry({ startBackgroundRefresh: false })
      : new ProviderRegistry([]),
    brave: enabled ? new BraveWebSearchProvider() : undefined,
    enabled,
  });
}