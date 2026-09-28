import type {
  ProviderMetadata,
  ProviderProduct,
  ProviderSearchRequest,
  SearchProvider,
} from "./types";

const disabledMetadata = (
  metadata: Omit<ProviderMetadata, "enabled" | "searchEnabled" | "affiliateEnabled">,
): ProviderMetadata => ({
  ...metadata,
  enabled: false,
  searchEnabled: false,
  affiliateEnabled: false,
});

abstract class DisabledProvider implements SearchProvider {
  readonly metadata: ProviderMetadata;

  protected constructor(metadata: ProviderMetadata) {
    this.metadata = metadata;
  }

  async search(_request: ProviderSearchRequest): Promise<ProviderProduct[]> {
    // Disabled adapters never make network requests. They become live only
    // after their subclass is given an authorized adapter implementation.
    return [];
  }
}

export class MockProvider implements SearchProvider {
  readonly metadata: ProviderMetadata = {
    id: "mock-local",
    name: "MockProvider",
    enabled: false,
    searchEnabled: false,
    affiliateEnabled: false,
    priceMonitoringAllowed: true,
    visualSearchAllowed: true,
    country: "SA",
    currency: "SAR",
    integrationType: "mock_local",
    requiresCredentials: false,
    credentialRequirements: [],
    priority: 0,
    lastSuccessfulSync: null,
    affiliateCapability: "not_applicable",
    priceMonitoringCapability: "allowed",
    integrationStatus: "mock",
  };

  private readonly fixtures: ProviderProduct[] = [
    {
      id: "mock-chair-green",
      title: "كرسي مخمل أخضر",
      description: "نتيجة محلية تجريبية للبحث والاختبار.",
      productUrl: "https://example.com/luqta/mock-chair-green",
      imageUrl: undefined,
      price: 249,
      currency: "SAR",
      merchant: "LUQTA Mock",
      availability: "in_stock",
      condition: "new",
      sourceType: "mock",
      exactMatchScore: 0.92,
      specificationScore: 0.8,
      reliabilityScore: 0.5,
    },
  ];

  async search(request: ProviderSearchRequest): Promise<ProviderProduct[]> {
    const normalizedQuery = request.query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return this.fixtures;
    return this.fixtures.filter((product) =>
      `${product.title} ${product.description ?? ""}`
        .toLocaleLowerCase()
        .includes(normalizedQuery),
    );
  }
}

export class NoonProvider extends DisabledProvider {
  constructor() {
    super(
      disabledMetadata({
        id: "noon",
        name: "Noon",
        priceMonitoringAllowed: false,
        visualSearchAllowed: false,
        country: "SA",
        currency: "SAR",
        integrationType: "affiliate_feed",
        requiresCredentials: true,
        credentialRequirements: [
          "Official Noon affiliate account",
          "Authorized machine-readable catalog or product feed",
          "Approved affiliate/deep-link access",
        ],
        priority: 10,
        lastSuccessfulSync: null,
        affiliateCapability: "available_pending_access",
        priceMonitoringCapability: "requires_authorization",
        integrationStatus: "disabled",
      }),
    );
  }
}

export class AmazonSAProvider extends DisabledProvider {
  constructor() {
    super(
      disabledMetadata({
        id: "amazon-sa",
        name: "Amazon Saudi Arabia",
        priceMonitoringAllowed: false,
        visualSearchAllowed: false,
        country: "SA",
        currency: "SAR",
        integrationType: "creators_api",
        requiresCredentials: true,
        credentialRequirements: [
          "Approved Amazon Associates Saudi Arabia account",
          "Authorized Creators API credentials",
          "Mobile application approval where applicable",
          "Policy review before any price tracking or alerts",
        ],
        priority: 20,
        lastSuccessfulSync: null,
        affiliateCapability: "available_pending_access",
        priceMonitoringCapability: "restricted_by_policy",
        integrationStatus: "disabled",
      }),
    );
  }
}

export class NextSAProvider extends DisabledProvider {
  constructor() {
    super(
      disabledMetadata({
        id: "next-sa",
        name: "NEXT Saudi Arabia",
        priceMonitoringAllowed: false,
        visualSearchAllowed: false,
        country: "SA",
        currency: "SAR",
        integrationType: "affiliate_feed",
        requiresCredentials: true,
        credentialRequirements: [
          "Authorized NEXT Saudi affiliate account",
          "Approved product feed, API, or deep-link source",
        ],
        priority: 30,
        lastSuccessfulSync: null,
        affiliateCapability: "available_pending_access",
        priceMonitoringCapability: "requires_authorization",
        integrationStatus: "disabled",
      }),
    );
  }
}

export class NamshiProvider extends DisabledProvider {
  constructor() {
    super(
      disabledMetadata({
        id: "namshi",
        name: "Namshi",
        priceMonitoringAllowed: false,
        visualSearchAllowed: false,
        country: "SA",
        currency: "SAR",
        integrationType: "authorized_api",
        requiresCredentials: true,
        credentialRequirements: [
          "Verified Namshi partner or affiliate access",
          "Authorized product feed or API",
        ],
        priority: 40,
        lastSuccessfulSync: null,
        affiliateCapability: "not_verified",
        priceMonitoringCapability: "requires_authorization",
        integrationStatus: "disabled",
      }),
    );
  }
}

export class SheinProvider extends DisabledProvider {
  constructor() {
    super(
      disabledMetadata({
        id: "shein",
        name: "SHEIN",
        priceMonitoringAllowed: false,
        visualSearchAllowed: false,
        country: "SA",
        currency: "SAR",
        integrationType: "affiliate_feed",
        requiresCredentials: true,
        credentialRequirements: [
          "Verified SHEIN affiliate access",
          "Authorized product feed or API",
        ],
        priority: 50,
        lastSuccessfulSync: null,
        affiliateCapability: "available_pending_access",
        priceMonitoringCapability: "requires_authorization",
        integrationStatus: "disabled",
      }),
    );
  }
}

export class TemuProvider extends DisabledProvider {
  constructor() {
    super(
      disabledMetadata({
        id: "temu",
        name: "Temu",
        priceMonitoringAllowed: false,
        visualSearchAllowed: false,
        country: "SA",
        currency: "SAR",
        integrationType: "affiliate_feed",
        requiresCredentials: true,
        credentialRequirements: [
          "Authorized Temu affiliate/product access",
          "Confirmed scope for the Open Platform or affiliate feed",
        ],
        priority: 60,
        lastSuccessfulSync: null,
        affiliateCapability: "available_pending_access",
        priceMonitoringCapability: "requires_authorization",
        integrationStatus: "disabled",
      }),
    );
  }
}

export class HarajProvider extends DisabledProvider {
  constructor() {
    super(
      disabledMetadata({
        id: "haraj",
        name: "Haraj",
        priceMonitoringAllowed: false,
        visualSearchAllowed: false,
        country: "SA",
        currency: "SAR",
        integrationType: "authorized_api",
        requiresCredentials: true,
        credentialRequirements: [
          "Authorized Haraj integration or legally permitted data source",
          "Explicit permission to use and republish listing data",
        ],
        priority: 70,
        lastSuccessfulSync: null,
        affiliateCapability: "not_verified",
        priceMonitoringCapability: "requires_authorization",
        integrationStatus: "disabled",
      }),
    );
  }
}

export class GenericFeedProvider extends DisabledProvider {
  constructor() {
    super(
      disabledMetadata({
        id: "generic-feed",
        name: "Generic authorized feed",
        priceMonitoringAllowed: false,
        visualSearchAllowed: false,
        country: "MULTI",
        currency: "SAR",
        integrationType: "generic_feed",
        requiresCredentials: true,
        credentialRequirements: [
          "Authorized feed/API/deep-link access for the source",
          "Documented permission for catalog use",
        ],
        priority: 100,
        lastSuccessfulSync: null,
        affiliateCapability: "not_verified",
        priceMonitoringCapability: "requires_authorization",
        integrationStatus: "disabled",
      }),
    );
  }
}