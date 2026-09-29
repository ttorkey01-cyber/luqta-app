export type ProviderIntegrationType =
  | "mock_local"
  | "affiliate_feed"
  | "creators_api"
  | "authorized_api"
  | "generic_feed"
  | "web_search";

export type LuqtaCategory =
  | "beauty_care"
  | "fashion"
  | "bags_accessories"
  | "watches_jewelry"
  | "electronics"
  | "home_living"
  | "shoes"
  | "eyewear"
  | "automotive"
  | "kids_baby"
  | "sports_fitness"
  | "games_hobbies";

export type ProductAudience = "women" | "men" | "boys" | "girls" | "kids";

export type CanonicalProduct = {
  id: string;
  providerId: string;
  providerProductId: string | null;
  title: string;
  description: string | null;
  brand: string | null;
  productType: string | null;
  category: LuqtaCategory | null;
  subcategory: string | null;
  audience: ProductAudience | null;
  color: string | null;
  imageUrl: string | null;
  alternateImageUrls: string[] | null;
  price: number | null;
  originalPrice: number | null;
  discount: number | null;
  currency: string | null;
  merchant: string | null;
  productUrl: string | null;
  affiliateUrl: string | null;
  destinationUrl: string | null;
  availability: "in_stock" | "out_of_stock" | null;
  condition: "new" | "used" | "refurbished" | null;
  location: string | null;
  rating: number | null;
  reviewCount: number | null;
  updatedAt: string | null;
  sourceType: string;
};

export const LUQTA_CATEGORIES: readonly LuqtaCategory[] = [
  "beauty_care",
  "fashion",
  "bags_accessories",
  "watches_jewelry",
  "electronics",
  "home_living",
  "shoes",
  "eyewear",
  "automotive",
  "kids_baby",
  "sports_fitness",
  "games_hobbies",
];

export type AffiliateCapability =
  | "active"
  | "available_pending_access"
  | "not_verified"
  | "not_applicable";

export type PriceMonitoringCapability =
  | "allowed"
  | "disabled"
  | "restricted_by_policy"
  | "requires_authorization";

export type IntegrationStatus = "mock" | "disabled" | "authorized" | "ready";

export type ProviderImageHealthStatus =
  | "not_checked"
  | "healthy"
  | "degraded"
  | "unhealthy";

export type ProviderImageHealth = {
  populatedImageCount: number;
  sampledImageCount: number;
  reachableImageCount: number;
  status: ProviderImageHealthStatus;
  lastCheckedAt: string | null;
};

export type ProviderMetadata = {
  id: string;
  name: string;
  enabled: boolean;
  searchEnabled: boolean;
  affiliateEnabled: boolean;
  priceMonitoringAllowed: boolean;
  visualSearchAllowed: boolean;
  country: string;
  currency: string;
  integrationType: ProviderIntegrationType;
  requiresCredentials: boolean;
  credentialRequirements: string[];
  priority: number;
  lastSuccessfulSync: string | null;
  affiliateCapability: AffiliateCapability;
  priceMonitoringCapability: PriceMonitoringCapability;
  integrationStatus: IntegrationStatus;
  imageHealth?: ProviderImageHealth;
};

export type QueryIntent = {
  raw?: string;
  normalized?: string;
  keywords?: string[];
  category?: string;
  productType?: string;
  audience?: "women" | "men" | "boys" | "girls" | "kids";
  brand?: string;
  color?: string;
  maxPrice?: number;
  minPrice?: number;
  approximatePrice?: number;
  currency?: string;
  condition?: "new" | "used" | "refurbished" | "unknown";
  location?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleYear?: string;
  partName?: string;
  partNumber?: string;
  oemNumber?: string;
  newOrUsed?: "new" | "used" | "refurbished" | "unknown";
};

export type ProviderSearchRequest = {
  query: string;
  category?: LuqtaCategory;
  categoryFilterId?: string;
  page?: number;
  pageSize?: number;
  searchMode?: "category_browse" | "intent";
  intent?: QueryIntent;
  imageUri?: string;
  preferredProviderIds?: string[];
};

export type ProviderCategorySearchResult = {
  products: ProviderProduct[];
  total: number;
  facetCounts: Record<string, number>;
  ready?: boolean;
  timings?: {
    readinessWaitMs: number;
    categoryIndexMs: number;
    facetLookupMs: number;
  };
};

export type ProviderIndexReadiness = {
  ready: boolean;
  productCount: number;
  refreshing: boolean;
  lastSuccessfulSync: string | null;
};

export type ProviderProduct = {
  id: string;
  providerProductId?: string | null;
  title: string;
  description?: string;
  productUrl?: string;
  affiliateUrl?: string | null;
  imageUrl?: string;
  alternateImageUrls?: string[] | null;
  price?: number | null;
  originalPrice?: number | null;
  discount?: number | null;
  currency?: string | null;
  merchant?: string | null;
  category?: string;
  productType?: string | null;
  subcategory?: string | null;
  audience?: string | null;
  color?: string | null;
  brand?: string;
  availability: "in_stock" | "out_of_stock" | "unknown";
  condition?: "new" | "used" | "refurbished" | "unknown";
  location?: string;
  source?: string;
  sourceType: string;
  rating?: number | null;
  reviewCount?: number | null;
  updatedAt?: string | null;
  visualScore?: number;
  specificationScore?: number;
  exactMatchScore?: number;
  reliabilityScore?: number;
  categoryFilterIds?: string[];
};

export type NormalizedProduct = ProviderProduct & {
  canonical: CanonicalProduct;
  providerId: string;
  providerName: string;
  isAffiliate: boolean;
  destinationUrl?: string;
  rankScore: number;
  priceScore: number;
  availabilityScore: number;
  conditionScore: number;
  locationScore: number;
  categoryFilterIds?: string[];
};

export interface SearchProvider {
  readonly metadata: ProviderMetadata;
  search(request: ProviderSearchRequest): Promise<ProviderProduct[]>;
  refreshIndex?(force?: boolean): Promise<number>;
  getSearchIndexReadiness?(): ProviderIndexReadiness;
  searchCategory?(
    request: ProviderSearchRequest,
  ): Promise<ProviderCategorySearchResult>;
}