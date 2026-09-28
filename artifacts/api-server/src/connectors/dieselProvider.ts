import { AdmitadFeedProvider } from "./nazihProvider";

export class DieselProvider extends AdmitadFeedProvider {
  constructor(
    feedUrl = process.env.ADMITAD_DIESEL_KSA_EN_FEED_URL,
    startBackgroundRefresh = true,
  ) {
    super(feedUrl, {
      providerId: "diesel",
      providerName: "Diesel",
      merchant: "Diesel",
      feedSecret: "ADMITAD_DIESEL_KSA_EN_FEED_URL",
      country: "SA",
      currency: "SAR",
      priority: 20,
    }, startBackgroundRefresh);
  }
}