import { AdmitadFeedProvider } from "./nazihProvider";

export class DealOutletProvider extends AdmitadFeedProvider {
  constructor(
    feedUrl = process.env.ADMITAD_THE_DEAL_OUTLET_SA_AR_FEED_URL,
    startBackgroundRefresh = true,
  ) {
    super(feedUrl, {
      providerId: "deal-outlet",
      providerName: "The Deal Outlet",
      merchant: "The Deal Outlet",
      feedSecret: "ADMITAD_THE_DEAL_OUTLET_SA_AR_FEED_URL",
      country: "SA",
      currency: "SAR",
      priority: 35,
      maxIndexedProducts: 5_000,
      // The official feed can exceed the shared 30-second download deadline
      // when all providers refresh concurrently at a cold production start.
      feedFetchTimeoutMs: 90_000,
      requireCompleteProductData: true,
      fieldMappings: {
        category: ["categoryid", "category_id"],
        // This feed's "vendor" is "The Deal", not the product's brand.
        brand: ["brand"],
      },
    }, startBackgroundRefresh);
  }
}