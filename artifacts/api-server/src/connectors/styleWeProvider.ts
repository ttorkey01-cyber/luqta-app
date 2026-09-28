import { AdmitadFeedProvider } from "./nazihProvider";

export class StyleWeProvider extends AdmitadFeedProvider {
  constructor(
    feedUrl = process.env.ADMITAD_STYLEWE_FEED_URL,
    startBackgroundRefresh = true,
  ) {
    super(feedUrl, {
      providerId: "stylewe",
      providerName: "StyleWe",
      merchant: "StyleWe",
      feedSecret: "ADMITAD_STYLEWE_FEED_URL",
      priority: 25,
    }, startBackgroundRefresh);
  }
}