import { AdmitadFeedProvider } from "./nazihProvider";

export class HuaweiProvider extends AdmitadFeedProvider {
  constructor(
    feedUrl = process.env.ADMITAD_HUAWEI_SA_AR_FEED_URL,
    startBackgroundRefresh = true,
  ) {
    super(feedUrl, {
      providerId: "huawei",
      providerName: "Huawei",
      merchant: "Huawei",
      feedSecret: "ADMITAD_HUAWEI_SA_AR_FEED_URL",
      country: "SA",
      currency: "SAR",
      priority: 40,
      maxIndexedProducts: 5_000,
      requireCompleteProductData: true,
      allowEmptyFeed: true,
      fieldMappings: {
        category: ["categoryid", "category_id"],
        // The CSV's vendor field identifies the merchant, not necessarily a product brand.
        brand: ["brand"],
      },
    }, startBackgroundRefresh);
  }
}