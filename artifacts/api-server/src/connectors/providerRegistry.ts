import {
  AmazonSAProvider,
  GenericFeedProvider,
  HarajProvider,
  MockProvider,
  NamshiProvider,
  NextSAProvider,
  NoonProvider,
  SheinProvider,
  TemuProvider,
} from "./adapters";
import { AliExpressProvider } from "./aliExpressProvider";
import { NazihProvider } from "./nazihProvider";
import { DieselProvider } from "./dieselProvider";
import { StyleWeProvider } from "./styleWeProvider";
import { LuxuryClosetProvider } from "./luxuryClosetProvider";
import { DealOutletProvider } from "./dealOutletProvider";
import { HuaweiProvider } from "./huaweiProvider";
import type { ProviderMetadata, SearchProvider } from "./types";

export class ProviderRegistry {
  private readonly providers = new Map<string, SearchProvider>();

  constructor(providers: SearchProvider[]) {
    for (const provider of providers) {
      if (this.providers.has(provider.metadata.id)) {
        throw new Error(`Duplicate provider id: ${provider.metadata.id}`);
      }
      this.providers.set(provider.metadata.id, provider);
    }
  }

  list(): ProviderMetadata[] {
    return [...this.providers.values()]
      .map((provider) => provider.metadata)
      .sort((a, b) => a.priority - b.priority);
  }

  get(id: string): SearchProvider | undefined {
    return this.providers.get(id);
  }

  getSearchProviders(preferredProviderIds?: string[]): SearchProvider[] {
    const preferred = preferredProviderIds?.length
      ? new Set(preferredProviderIds)
      : undefined;

    return [...this.providers.values()]
      .filter(
        (provider) =>
          provider.metadata.enabled &&
          provider.metadata.searchEnabled &&
          (!preferred || preferred.has(provider.metadata.id)),
      )
      .sort((a, b) => a.metadata.priority - b.metadata.priority);
  }
}

export function createDefaultProviderRegistry(options?: {
  startBackgroundRefresh?: boolean;
}): ProviderRegistry {
  const startBackgroundRefresh = options?.startBackgroundRefresh ?? true;
  return new ProviderRegistry([
    new MockProvider(),
    new AliExpressProvider(undefined, startBackgroundRefresh),
    new NazihProvider(undefined, startBackgroundRefresh),
    new DieselProvider(undefined, startBackgroundRefresh),
    new StyleWeProvider(undefined, startBackgroundRefresh),
    new LuxuryClosetProvider(undefined, startBackgroundRefresh),
    new DealOutletProvider(undefined, startBackgroundRefresh),
    new HuaweiProvider(undefined, startBackgroundRefresh),
    new NoonProvider(),
    new AmazonSAProvider(),
    new NextSAProvider(),
    new NamshiProvider(),
    new SheinProvider(),
    new TemuProvider(),
    new HarajProvider(),
    new GenericFeedProvider(),
  ]);
}