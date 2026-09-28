import { CacheService } from "./cacheService";
import { DeduplicationService } from "./deduplicationService";
import { AffiliateLinkService } from "./affiliateLinkService";
import { HuntService } from "./huntService";
import { HomeCurationService } from "./homeCurationService";
import { createDefaultProviderRegistry } from "./providerRegistry";
import { RankingService } from "./rankingService";
import { ResultNormalizer } from "./resultNormalizer";
import { SearchOrchestrator } from "./searchOrchestrator";
import { BraveWebSearchProvider } from "./braveWebSearchProvider";
import { deterministicIntentParser } from "./intentParser";

export * from "./adapters";
export * from "./affiliateLinkService";
export * from "./cacheService";
export * from "./categoryTaxonomy";
export * from "./braveWebSearchProvider";
export * from "./aliExpressProvider";
export * from "./nazihProvider";
export * from "./dieselProvider";
export * from "./styleWeProvider";
export * from "./luxuryClosetProvider";
export * from "./dealOutletProvider";
export * from "./huaweiProvider";
export * from "./deduplicationService";
export * from "./huntService";
export * from "./homeCurationService";
export * from "./intentParser";
export * from "./providerRegistry";
export * from "./queryExpansion";
export * from "./rankingService";
export * from "./resultNormalizer";
export * from "./searchOrchestrator";
export * from "./types";

export const providerRegistry = createDefaultProviderRegistry();
export const braveWebSearchProvider = new BraveWebSearchProvider();
export const searchOrchestrator = new SearchOrchestrator(
  providerRegistry,
  new ResultNormalizer(),
  new DeduplicationService(),
  new RankingService(),
  new AffiliateLinkService(),
  new CacheService(),
  braveWebSearchProvider,
  deterministicIntentParser,
);
export const huntService = new HuntService(providerRegistry);
export const homeCurationService = new HomeCurationService(searchOrchestrator);