import assert from "node:assert/strict";
import { test } from "node:test";
import { HuaweiProvider } from "./huaweiProvider";

const FEED_URL = "https://feeds.example.test/huawei-main-ar.csv";
const HEADER = "available;categoryId;country;currency;currencyId;description;id;language;modified_time;name;oldprice;param;picture;price;type;url;vendor";
const DEEPLINK = "https://ad.example.test/click?ulp=https%3A%2F%2Fstore.example%2Fp%3Fa%3D1%26b%3D2";
const PRODUCT = [
  "true", "Electronics", "SA", "SAR", "SAR", "هاتف ذكي", "sku-123", "ar", "",
  "هواوي Mate 70 هاتف", "", "", "https://images.example.test/phone.jpg",
  "2499.00", "", DEEPLINK, "Huawei",
].join(";");

function categoryIndexBuildStub(instance: object) {
  const index = (instance as unknown as { categoryProductIndex: object })
    .categoryProductIndex;
  const original = Reflect.get(index, "setProductsYielding") as (
    ...args: unknown[]
  ) => Promise<void>;
  return {
    replace(build: () => Promise<void>) {
      Reflect.set(index, "setProductsYielding", build);
    },
    runOriginal(...args: unknown[]) {
      return original.call(index, ...args);
    },
    restore() {
      Reflect.set(index, "setProductsYielding", original);
    },
  };
}

test("Huawei's valid header-only feed is ready and does not repeatedly refresh or block categories", async () => {
  const originalFetch = globalThis.fetch;
  let feedRequests = 0;
  globalThis.fetch = (async (input) => {
    if (String(input) === FEED_URL) {
      feedRequests += 1;
      return new Response(`${HEADER}\n`, { headers: { "content-type": "text/csv" } });
    }
    throw new Error("Empty feed must not probe images");
  }) as typeof fetch;

  try {
    const provider = new HuaweiProvider(FEED_URL, false);
    const categoryBuild = categoryIndexBuildStub(provider);
    let reachedBuild!: () => void;
    let finishBuild!: () => void;
    const buildStarted = new Promise<void>((resolve) => {
      reachedBuild = resolve;
    });
    const buildGate = new Promise<void>((resolve) => {
      finishBuild = resolve;
    });
    categoryBuild.replace(async (...args: unknown[]) => {
      reachedBuild();
      await buildGate;
      await categoryBuild.runOriginal(...args);
    });

    assert.equal(provider.getSearchIndexReadiness().ready, false);
    const successfulRefresh = provider.refreshIndex(false);
    await buildStarted;
    assert.equal(provider.getSearchIndexReadiness().ready, false);
    assert.equal(provider.getSearchIndexReadiness().refreshing, true);
    finishBuild();
    assert.equal(await successfulRefresh, 0);
    assert.deepEqual(provider.getSearchIndexReadiness().ready, true);
    assert.equal(provider.getSearchIndexReadiness().refreshing, false);
    assert.equal(provider.getSearchIndexReadiness().productCount, 0);
    categoryBuild.restore();
    assert.ok(provider.metadata.lastSuccessfulSync);
    assert.equal(provider.metadata.integrationStatus, "ready");
    assert.equal(provider.metadata.currency, "SAR");
    assert.deepEqual(await provider.search({ query: "هواوي" }), []);
    const category = await provider.searchCategory({
      query: "electronics", category: "electronics", searchMode: "category_browse",
    });
    assert.equal(category.ready, true);
    assert.equal(category.total, 0);
    assert.deepEqual(category.products, []);
    assert.equal(await provider.refreshIndex(false), 0);
    assert.equal(feedRequests, 1, "a valid empty feed is not retried before the refresh interval");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Huawei ingests future real products, preserves deeplinks, and retains the index after a failed refresh", async () => {
  const originalFetch = globalThis.fetch;
  let feedRequests = 0;
  globalThis.fetch = (async (input) => {
    if (String(input) === FEED_URL) {
      feedRequests += 1;
      if (feedRequests === 1) return new Response(`${HEADER}\n`);
      if (feedRequests === 2) return new Response(`${HEADER}\n${PRODUCT}\n`);
      if (feedRequests === 3) return new Response(`${HEADER}\n${PRODUCT}\n`);
      throw new Error("Unexpected additional feed refresh");
    }
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  try {
    const provider = new HuaweiProvider(FEED_URL, false);
    assert.equal(await provider.refreshIndex(), 0);
    assert.equal(await provider.refreshIndex(), 1);
    const products = await provider.search({ query: "هواوي" });
    assert.equal(products.length, 1);
    assert.equal(products[0]?.title, "هواوي Mate 70 هاتف");
    assert.equal(products[0]?.description, "هاتف ذكي");
    assert.equal(products[0]?.providerProductId, "sku-123");
    assert.equal(products[0]?.price, 2499);
    assert.equal(products[0]?.currency, "SAR");
    assert.equal(products[0]?.imageUrl, "https://images.example.test/phone.jpg");
    assert.equal(products[0]?.affiliateUrl, DEEPLINK);
    assert.equal(products[0]?.productUrl, DEEPLINK);
    assert.equal(products[0]?.brand, undefined, "vendor is not automatically a product brand");
    const category = await provider.searchCategory({
      query: "electronics", category: "electronics", searchMode: "category_browse",
    });
    assert.equal(category.ready, true);
    assert.equal(category.total, 1);
    assert.equal(category.products[0]?.id, "sku-123");
    const categoryBuild = categoryIndexBuildStub(provider);
    categoryBuild.replace(async () => {
      throw new Error("category build failed");
    });
    await assert.rejects(provider.refreshIndex(), /category build failed/);
    assert.equal(provider.getSearchIndexReadiness().ready, true);
    assert.equal(provider.getSearchIndexReadiness().productCount, 1);
    assert.equal(provider.getSearchIndexReadiness().refreshing, false);
    assert.equal((await provider.search({ query: "هواوي" })).length, 1);
    categoryBuild.restore();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Huawei rejects malformed or non-empty-but-invalid feeds instead of treating them as valid empty inventory", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (async () => {
    requests += 1;
    return new Response(requests === 1 ? "not,a,product,feed\n" : `${HEADER}\n${PRODUCT.replace("2499.00", "")}\n`);
  }) as typeof fetch;
  try {
    const provider = new HuaweiProvider(FEED_URL, false);
    await assert.rejects(provider.refreshIndex(), /invalid CSV header/);
    assert.equal(provider.getSearchIndexReadiness().ready, false);
    await assert.rejects(provider.refreshIndex(), /no valid products/);
    assert.equal(provider.getSearchIndexReadiness().ready, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a subsequent valid empty Huawei feed does not erase an already usable index", async () => {
  const originalFetch = globalThis.fetch;
  let feedRequests = 0;
  globalThis.fetch = (async (input) => {
    if (String(input) === FEED_URL) {
      feedRequests++;
      return new Response(feedRequests === 1 ? `${HEADER}\n${PRODUCT}\n` : `${HEADER}\n`);
    }
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  try {
    const provider = new HuaweiProvider(FEED_URL, false);
    assert.equal(await provider.refreshIndex(), 1);
    const lastSync = provider.metadata.lastSuccessfulSync;
    assert.equal(await provider.refreshIndex(), 1);
    assert.equal(provider.getSearchIndexReadiness().productCount, 1);
    assert.equal(provider.metadata.lastSuccessfulSync, lastSync);
    assert.equal((await provider.searchCategory({
      query: "electronics", category: "electronics", searchMode: "category_browse",
    })).total, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});