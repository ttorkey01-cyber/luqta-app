import assert from "node:assert/strict";
import { test } from "node:test";
import { LuxuryClosetProvider } from "./luxuryClosetProvider";

test("Luxury Closet uses only official product photos, not its shared store icon", async () => {
  const feedUrl = "https://feeds.example.test/luxury-closet.csv";
  const productPhoto = "http://cdn.theluxurycloset.com/products/bag.jpg";
  const storeIcon = "https://cdn.theluxurycloset.com/store-icon.png";
  const affiliateLink = "https://merchant.example.test/bag";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    if (String(input) === feedUrl) {
      return new Response(
        [
          "id;name;price;currencyId;picture;icon_media_url;url",
          `bag-1;Official Bag;100;USD;${productPhoto};${storeIcon};${affiliateLink}`,
          `bag-2;Missing Photo Bag;120;USD;;${storeIcon};${affiliateLink}`,
        ].join("\n"),
        { headers: { "content-type": "text/csv" } },
      );
    }
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  try {
    const provider = new LuxuryClosetProvider(feedUrl, false);
    assert.equal(await provider.refreshIndex(), 2);
    const [photo] = await provider.search({ query: "Official Bag", searchMode: "intent" });
    assert.equal(photo?.imageUrl, productPhoto);
    assert.deepEqual(photo?.alternateImageUrls, null);
    assert.equal(photo?.affiliateUrl, affiliateLink);
    const [missing] = await provider.search({ query: "Missing Photo Bag", searchMode: "intent" });
    assert.equal(missing?.imageUrl, undefined);
    assert.equal(missing?.alternateImageUrls, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});