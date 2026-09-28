import { ProviderRegistry } from "./providerRegistry";

export type HuntProviderSelection = {
  preferredSources?: string[];
};

export class HuntService {
  constructor(private readonly registry: ProviderRegistry) {}

  eligibleProviderIds(hunt: HuntProviderSelection = {}): string[] {
    const preferred = hunt.preferredSources?.length
      ? new Set(hunt.preferredSources)
      : undefined;

    return this.registry
      .list()
      .filter(
        (provider) =>
          provider.enabled &&
          provider.priceMonitoringAllowed &&
          (!preferred || preferred.has(provider.id)),
      )
      .map((provider) => provider.id);
  }
}