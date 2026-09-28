import assert from "node:assert/strict";
import { test } from "node:test";
import { DieselProvider } from "./dieselProvider";

test("Diesel retains the exact official image and deeplink even when the image host returns 404", async () => {
  const feedUrl = "https://feeds.example.test/diesel-main.csv";
  const imageUrl = "https://images.example.test/official-product.jpg?size=large";
  const affiliateUrl = "https://ad.example.test/click?ulp=https%3A%2F%2Fstore.example%2Fp%3Fa%3D1%26b%3D2";
  const originalFetch = globalThis.fetch;
  let imageProbes = 0;
  globalThis.fetch = (async (input) => {
    if (String(input) === feedUrl) {
      return new Response(
        `id;name;description;categoryId;price;currencyId;picture;url\n` +
        `diesel-sku;Diesel Jeans;Men's denim;Fashion;400;SAR;${imageUrl};${affiliateUrl}\n`,
      );
    }
    if (String(input) === imageUrl) {
      imageProbes += 1;
      return new Response(null, { status: 404 });
    }
    throw new Error("Unexpected request");
  }) as typeof fetch;

  try {
    const provider = new DieselProvider(feedUrl, false);
    assert.equal(await provider.refreshIndex(), 1);
    const results = await provider.search({ query: "Jeans" });
    assert.equal(results[0]?.imageUrl, imageUrl);
    assert.equal(results[0]?.affiliateUrl, affiliateUrl);
    assert.equal(results[0]?.productUrl, affiliateUrl);
    assert.equal(results[0]?.providerProductId, "diesel-sku");
    assert.equal(results[0]?.price, 400);
    assert.equal(results[0]?.merchant, "Diesel");
    assert.ok(imageProbes <= 1, "image health probing must not retry a 404 during search");
  } finally {
    globalThis.fetch = originalFetch;
  }
});