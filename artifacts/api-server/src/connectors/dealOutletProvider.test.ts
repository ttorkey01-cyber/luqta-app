import assert from "node:assert/strict";
import { test } from "node:test";
import { DealOutletProvider } from "./dealOutletProvider";

const FEED_URL = "https://feeds.example.test/deal-outlet.csv";
const DEEPLINK = "https://ad.admitad.com/g/official?ulp=https%3A%2F%2Fshop.example%2Fp%3Fa%3D1%26b%3D2";
const HEADER = "id;name;description;categoryId;price;currencyId;picture;url;brand;vendor";
const ROWS = [
  ["sku-1", "كونفيرس أبيض Sneakers", "حذاء نسائي", "Fashion", "125.00", "SAR", "https://images.example.test/shoe.jpg", DEEPLINK, "Converse", "The Deal"],
  ["sku-2", "Michael Kors Bag", "حقيبة رجالية", "Fashion", "240.00", "SAR", "https://images.example.test/bag.jpg", DEEPLINK, "", "The Deal"],
  ["sku-3", "No price", "حذاء", "Fashion", "", "SAR", "https://images.example.test/other.jpg", DEEPLINK, "", "The Deal"],
  ["sku-4", "No image", "حذاء", "Fashion", "50.00", "SAR", "", DEEPLINK, "", "The Deal"],
  ["sku-5", "Bad link", "حذاء", "Fashion", "50.00", "SAR", "https://images.example.test/other.jpg", "javascript:alert(1)", "", "The Deal"],
].map((cells) => cells.join(";"));

test("The Deal Outlet indexes real SA CSV products with unchanged deeplinks, without inventing data", async () => {
  const originalFetch = globalThis.fetch;
  let feedRequests = 0;
  globalThis.fetch = (async (input) => {
    if (String(input) === FEED_URL) {
      feedRequests += 1;
      if (feedRequests > 1) throw new Error("feed temporarily unavailable");
      return new Response([HEADER, ...ROWS].join("\n"), {
        headers: { "content-type": "text/csv" },
      });
    }
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  try {
    const provider = new DealOutletProvider(FEED_URL, false);
    assert.equal(provider.metadata.id, "deal-outlet");
    assert.equal(provider.metadata.priceMonitoringAllowed, false);
    assert.equal(await provider.refreshIndex(), 2);
    const arabic = await provider.search({ query: "كونفيرس", searchMode: "intent" });
    const english = await provider.search({ query: "Sneakers", searchMode: "intent" });
    assert.equal(arabic.length, 1);
    assert.equal(english.length, 1);
    assert.equal(arabic[0]?.affiliateUrl, DEEPLINK);
    assert.equal(arabic[0]?.productUrl, DEEPLINK);
    assert.equal(arabic[0]?.providerProductId, "sku-1");
    assert.equal(arabic[0]?.price, 125);
    assert.equal(arabic[0]?.currency, "SAR");
    assert.equal(arabic[0]?.imageUrl, "https://images.example.test/shoe.jpg");
    assert.equal(arabic[0]?.brand, "Converse");
    const bag = await provider.search({ query: "Michael Kors", searchMode: "intent" });
    assert.equal(bag[0]?.brand, undefined, "merchant vendor must not become product brand");
    const category = await provider.searchCategory({
      query: "الحقائب والإكسسوارات",
      category: "bags_accessories",
      searchMode: "category_browse",
    });
    assert.equal(category.total, 1);
    assert.equal(category.products[0]?.id, "sku-2");

    await assert.rejects(provider.refreshIndex(), /temporarily unavailable/);
    assert.equal(provider.getSearchIndexReadiness().productCount, 2);
    assert.equal((await provider.search({ query: "Sneakers", searchMode: "intent" })).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("The Deal Outlet is disabled without the official SA Arabic feed URL", () => {
  const provider = new DealOutletProvider("", false);
  assert.equal(provider.metadata.enabled, false);
  assert.equal(provider.metadata.searchEnabled, false);
  assert.deepEqual(provider.metadata.credentialRequirements, [
    "ADMITAD_THE_DEAL_OUTLET_SA_AR_FEED_URL",
  ]);
});