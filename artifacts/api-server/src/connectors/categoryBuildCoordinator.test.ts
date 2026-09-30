import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { logger } from "../lib/logger";
import { CategoryProductIndex } from "./categoryProductIndex";
import { withCategoryBuildSlot } from "./categoryBuildCoordinator";
import { withFeedRefreshSlot } from "./feedRefreshCoordinator";
import { HuaweiProvider } from "./huaweiProvider";
import { NazihProvider } from "./nazihProvider";
import type { ProviderProduct } from "./types";

const inventories = [
  { name: "Nazih", count: 500 },
  { name: "Diesel", count: 2_700 },
  { name: "Stylewe", count: 1_700 },
  { name: "AliExpress", count: 3_600 },
  { name: "Luxury", count: 5_000 },
  { name: "Deal", count: 5_000 },
  { name: "Huawei", count: 0 },
] as const;

const productExamples = [
  {
    title: "Hydrating face moisturizer and serum",
    category: "Beauty & Personal Care > Skincare",
    productType: "Skincare",
  },
  {
    title: "Women's blue denim jeans",
    category: "Women's Clothing > Jeans",
    productType: "jeans",
  },
  {
    title: "Leather crossbody handbag",
    category: "Bags & Luggage > Handbags",
    productType: "handbag",
  },
  {
    title: "Gold necklace and diamond ring",
    category: "Jewelry > Necklaces & Rings",
    productType: "necklace",
  },
  {
    title: "Wireless smartphone with camera",
    category: "Electronics > Mobile Phones",
    productType: "smartphone",
  },
  {
    title: "Ceramic dining table lamp",
    category: "Home & Living > Lighting",
    productType: "lamp",
  },
  {
    title: "Men's leather running shoes",
    category: "Shoes > Sneakers",
    productType: "sneakers",
  },
] as const;

function syntheticProducts(provider: string, count: number): ProviderProduct[] {
  return Array.from({ length: count }, (_, index) => {
    const example = productExamples[index % productExamples.length];
    return {
      ...example,
      id: `${provider}-${index}`,
      availability: "in_stock",
      sourceType: "affiliate_feed",
    };
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function categoryIndexBuildStub(instance: object) {
  const index = (instance as unknown as { categoryProductIndex: object })
    .categoryProductIndex;
  const original = Reflect.get(index, "setProductsYielding") as (
    ...args: unknown[]
  ) => Promise<void>;
  return {
    replace(build: (...args: unknown[]) => Promise<void>) {
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

test("Admitad provider refreshes queue category builds after parsing without occupying feed slots", async () => {
  const nazihFeedUrl = "https://feeds.example.test/nazih-concurrent.csv";
  const huaweiFeedUrl = "https://feeds.example.test/huawei-concurrent.csv";
  const nazihCsv = [
    "id,name,url,image_url,category,product_type",
    "nazih-1,Women's blue jeans,https://shop.example.test/nazih,https://images.example.test/nazih.jpg,Women's Clothing > Jeans,jeans",
  ].join("\n");
  const huaweiCsv = [
    "available;categoryId;country;currency;currencyId;description;id;language;modified_time;name;oldprice;param;picture;price;type;url;vendor",
    "true;Electronics;SA;SAR;SAR;Smartphone;huawei-1;ar;;Huawei Mate 70 Smartphone;;;https://images.example.test/huawei.jpg;2499.00;;https://shop.example.test/huawei;Huawei",
  ].join("\n");
  const firstBuildGate = deferred();
  const firstBuildStarted = deferred();
  const originalFetch = globalThis.fetch;
  const originalInfo = logger.info;
  const parsedProviders = new Set<string>();
  const queuedProviders = new Set<string>();
  const buildStarts: string[] = [];
  let activeBuilds = 0;
  let maxActiveBuilds = 0;
  let nazihBuild: ReturnType<typeof categoryIndexBuildStub> | undefined;
  let huaweiBuild: ReturnType<typeof categoryIndexBuildStub> | undefined;

  logger.info = ((fields: unknown, message?: unknown) => {
    if (
      message === "Provider feed download and parse complete" ||
      message === "Provider category-index build queued"
    ) {
      const providerId = (fields as { providerId?: string }).providerId;
      if (providerId) {
        if (message === "Provider feed download and parse complete") {
          parsedProviders.add(providerId);
        } else {
          queuedProviders.add(providerId);
        }
      }
    }
  }) as typeof logger.info;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url === nazihFeedUrl) return new Response(nazihCsv);
    if (url === huaweiFeedUrl) return new Response(huaweiCsv);
    if (init?.method === "HEAD") return new Response(null, { status: 200 });
    throw new Error(`Unexpected synthetic integration fetch: ${url}`);
  }) as typeof fetch;

  const nazih = new NazihProvider(nazihFeedUrl, false);
  const huawei = new HuaweiProvider(huaweiFeedUrl, false);
  nazihBuild = categoryIndexBuildStub(nazih);
  huaweiBuild = categoryIndexBuildStub(huawei);
  const replaceBuild = (
    name: string,
    stub: ReturnType<typeof categoryIndexBuildStub>,
    holdFirst: boolean,
  ) => {
    stub.replace(async (...args: unknown[]) => {
      activeBuilds += 1;
      maxActiveBuilds = Math.max(maxActiveBuilds, activeBuilds);
      buildStarts.push(name);
      if (holdFirst) firstBuildStarted.resolve();
      try {
        if (holdFirst) await firstBuildGate.promise;
        await stub.runOriginal(...args);
      } finally {
        activeBuilds -= 1;
      }
    });
  };
  replaceBuild("Nazih", nazihBuild, true);
  replaceBuild("Huawei", huaweiBuild, false);

  let nazihRefresh: Promise<number> | undefined;
  let huaweiRefresh: Promise<number> | undefined;
  try {
    assert.equal(nazih.getSearchIndexReadiness().ready, false);
    assert.equal(huawei.getSearchIndexReadiness().ready, false);
    nazihRefresh = nazih.refreshIndex();
    await firstBuildStarted.promise;
    huaweiRefresh = huawei.refreshIndex();

    const waitFor = async (condition: () => boolean, description: string) => {
      const deadline = Date.now() + 2_000;
      while (Date.now() < deadline) {
        if (condition()) return;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      assert.fail(`Timed out waiting for ${description}`);
    };
    await waitFor(
      () => parsedProviders.has("huawei") && queuedProviders.has("huawei"),
      "Huawei feed parse and queued category build",
    );

    assert.deepEqual(buildStarts, ["Nazih"]);
    assert.equal(nazih.getSearchIndexReadiness().ready, false);
    assert.equal(huawei.getSearchIndexReadiness().ready, false);
    assert.equal(nazih.getSearchIndexReadiness().refreshing, true);
    assert.equal(huawei.getSearchIndexReadiness().refreshing, true);

    let feedSlotWasAvailable = false;
    await withFeedRefreshSlot(async () => {
      feedSlotWasAvailable = true;
    });
    assert.equal(
      feedSlotWasAvailable,
      true,
      "a parsed refresh waiting for a build must release its feed-download slot",
    );

    firstBuildGate.resolve();
    assert.deepEqual(await Promise.all([nazihRefresh, huaweiRefresh]), [1, 1]);
    assert.deepEqual(buildStarts, ["Nazih", "Huawei"]);
    assert.equal(maxActiveBuilds, 1);
    assert.equal(activeBuilds, 0);
    assert.equal(nazih.getSearchIndexReadiness().ready, true);
    assert.equal(huawei.getSearchIndexReadiness().ready, true);
    assert.equal(nazih.getSearchIndexReadiness().productCount, 1);
    assert.equal(huawei.getSearchIndexReadiness().productCount, 1);
  } finally {
    firstBuildGate.resolve();
    nazihBuild.restore();
    huaweiBuild.restore();
    globalThis.fetch = originalFetch;
    logger.info = originalInfo;
    await Promise.allSettled(
      [nazihRefresh, huaweiRefresh].filter(
        (refresh): refresh is Promise<number> => refresh !== undefined,
      ),
    );
  }
});

test("category builds serialize FIFO and release their slot after success, failure, and abort", async () => {
  const firstBuildGate = deferred();
  const events: string[] = [];
  let activeBuilds = 0;
  let maxActiveBuilds = 0;

  const runBuild = (name: string, work: () => Promise<void>) =>
    withCategoryBuildSlot(async () => {
      activeBuilds += 1;
      maxActiveBuilds = Math.max(maxActiveBuilds, activeBuilds);
      events.push(`start:${name}`);
      try {
        await work();
      } finally {
        events.push(`end:${name}`);
        activeBuilds -= 1;
      }
    });

  const first = runBuild("first", () => firstBuildGate.promise);
  const success = runBuild("success", async () => {});
  const failureAssertion = assert.rejects(
    runBuild("failure", async () => {
      throw new Error("synthetic build failure");
    }),
    (error: unknown) =>
      error instanceof Error && /synthetic build failure/.test(error.message),
  );
  const abortAssertion = assert.rejects(
    runBuild("abort", async () => {
      throw new DOMException("synthetic cancellation", "AbortError");
    }),
    (error: unknown) =>
      error instanceof Error && error.name === "AbortError",
  );
  const last = runBuild("last", async () => {});

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["start:first"]);
  firstBuildGate.resolve();
  await first;
  await success;
  await Promise.all([failureAssertion, abortAssertion]);
  await last;

  assert.deepEqual(events, [
    "start:first",
    "end:first",
    "start:success",
    "end:success",
    "start:failure",
    "end:failure",
    "start:abort",
    "end:abort",
    "start:last",
    "end:last",
  ]);
  assert.equal(maxActiveBuilds, 1);
  assert.equal(activeBuilds, 0);
});

test("feed-download limit remains two and independent from the category-build slot", async () => {
  const firstFeedGate = deferred();
  const secondFeedGate = deferred();
  const categoryBuildGate = deferred();
  const startedFeeds: string[] = [];
  let activeFeeds = 0;
  let maxActiveFeeds = 0;

  const download = (name: string, gate: Promise<void>) =>
    withFeedRefreshSlot(async () => {
      activeFeeds += 1;
      maxActiveFeeds = Math.max(maxActiveFeeds, activeFeeds);
      startedFeeds.push(name);
      try {
        await gate;
      } finally {
        activeFeeds -= 1;
      }
    });

  const firstFeed = download("feed-1", firstFeedGate.promise);
  const secondFeed = download("feed-2", secondFeedGate.promise);
  const thirdFeed = download("feed-3", Promise.resolve());
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(startedFeeds, ["feed-1", "feed-2"]);

  let buildStarted = false;
  const categoryBuild = withCategoryBuildSlot(async () => {
    buildStarted = true;
    await categoryBuildGate.promise;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(buildStarted, true, "a held feed download must not hold the build slot");
  assert.deepEqual(startedFeeds, ["feed-1", "feed-2"]);

  firstFeedGate.resolve();
  await firstFeed;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(startedFeeds, ["feed-1", "feed-2", "feed-3"]);
  assert.equal(maxActiveFeeds, 2);

  secondFeedGate.resolve();
  categoryBuildGate.resolve();
  await Promise.all([secondFeed, thirdFeed, categoryBuild]);
  assert.equal(activeFeeds, 0);
});

test("queued refresh remains ready, and failed refresh keeps the previous index or leaves cold state unready", async () => {
  const previousProducts = syntheticProducts("previous", 12);
  const readyIndex = new CategoryProductIndex();
  readyIndex.setProducts(previousProducts);
  const previousFashionCount = readyIndex.getCount(
    previousProducts,
    "fashion",
  );
  let ready = true;
  let refreshing = false;

  const buildGate = deferred();
  const currentBuild = withCategoryBuildSlot(() => buildGate.promise);
  const queuedRefresh = (async () => {
    refreshing = true;
    try {
      await withCategoryBuildSlot(async () => {
        throw new Error("synthetic refresh failure");
      });
    } finally {
      refreshing = false;
    }
  })();

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(ready, true);
  assert.equal(refreshing, true);
  assert.equal(
    readyIndex.getCount(previousProducts, "fashion"),
    previousFashionCount,
  );
  buildGate.resolve();
  await currentBuild;
  await assert.rejects(queuedRefresh, /synthetic refresh failure/);
  assert.equal(ready, true);
  assert.equal(refreshing, false);
  assert.equal(
    readyIndex.getCount(previousProducts, "fashion"),
    previousFashionCount,
  );

  const coldIndex = new CategoryProductIndex();
  let coldReady = false;
  await assert.rejects(
    withCategoryBuildSlot(async () => {
      throw new Error("synthetic cold-start failure");
    }),
    /synthetic cold-start failure/,
  );
  assert.equal(coldReady, false);
  assert.equal(coldIndex.getCount([], "fashion"), 0);
});

test("seven synthetic provider inventories build FIFO-equivalently to direct indexes", async (t) => {
  const reference = new Map<string, { products: ProviderProduct[]; index: CategoryProductIndex }>();
  for (const { name, count } of inventories) {
    const products = syntheticProducts(name, count);
    const index = new CategoryProductIndex();
    index.setProducts(products);
    reference.set(name, { products, index });
  }
  const startedAt = performance.now();
  const buildOrder: string[] = [];
  let activeBuilds = 0;
  let maxActiveBuilds = 0;

  const results = await Promise.all(
    inventories.map(async ({ name, count }) => {
      // Synthetic inventory loading is intentionally local: this exercises the
      // feed slot without issuing HTTP requests or reading provider feeds.
      const products = await withFeedRefreshSlot(async () =>
        syntheticProducts(name, count),
      );
      const yieldingIndex = new CategoryProductIndex();

      await withCategoryBuildSlot(async () => {
        activeBuilds += 1;
        maxActiveBuilds = Math.max(maxActiveBuilds, activeBuilds);
        buildOrder.push(name);
        try {
          await yieldingIndex.setProductsYielding(products);
        } finally {
          activeBuilds -= 1;
        }
      });
      return { name, products, yieldingIndex };
    }),
  );
  const startupElapsedMs = performance.now() - startedAt;
  t.diagnostic(`Synthetic concurrent startup: ${startupElapsedMs.toFixed(1)} ms (local fixtures only)`);

  for (const { name, products, yieldingIndex } of results) {
    const directIndex = reference.get(name)!.index;
    for (const category of [
        "beauty_care",
        "fashion",
        "bags_accessories",
        "watches_jewelry",
        "electronics",
        "home_living",
        "shoes",
      ] as const) {
        assert.equal(
          yieldingIndex.getCount(products, category),
          directIndex.getCount(products, category),
          `${name} ${category} count`,
        );
        assert.deepEqual(
          [...yieldingIndex.getFacetCounts(products, category)],
          [...directIndex.getFacetCounts(products, category)],
          `${name} ${category} facets`,
        );
        assert.deepEqual(
          yieldingIndex.getProducts(products, category, undefined, 1, 12),
          directIndex.getProducts(products, category, undefined, 1, 12),
          `${name} ${category} product order`,
        );
    }
  }

  assert.deepEqual(
    [...buildOrder].sort(),
    inventories.map(({ name }) => name).sort(),
  );
  assert.equal(maxActiveBuilds, 1);
  assert.equal(activeBuilds, 0);
  assert.ok(Number.isFinite(startupElapsedMs) && startupElapsedMs >= 0);
});