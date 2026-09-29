import { AdmitadFeedProvider } from "./nazihProvider";

export class LuxuryClosetProvider extends AdmitadFeedProvider {
  constructor(
    feedUrl = process.env.ADMITAD_LUXURY_CLOSET_WW_FEED_URL,
    startBackgroundRefresh = true,
  ) {
    super(feedUrl, {
      providerId: "luxury-closet",
      providerName: "The Luxury Closet",
      merchant: "The Luxury Closet",
      feedSecret: "ADMITAD_LUXURY_CLOSET_WW_FEED_URL",
      priority: 30,
      maxFeedBytes: 128 * 1_024 * 1_024,
      feedFetchTimeoutMs: 120_000,
      maxIndexedProducts: 5_000,
      fieldMappings: {
        image: ["picture"],
        category: ["categories", "categoryid"],
        condition: ["condition_detail"],
      },
    }, startBackgroundRefresh);
  }
}