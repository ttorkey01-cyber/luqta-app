import assert from "node:assert/strict";
import test from "node:test";
import { logger } from "../lib/logger";
import { AliExpressProvider } from "./aliExpressProvider";

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

test("intent search returns promptly while the initial AliExpress feed refresh is pending", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Promise<Response>(() => undefined)) as typeof fetch;

  try {
    const instance = new AliExpressProvider(
      "https://feeds.example.test/aliexpress.csv",
    );
    const search = instance.search({ query: "watch" });
    const returnedPromptly = await Promise.race([
      search.then(() => true),
      new Promise<boolean>((resolve) =>
        setTimeout(() => resolve(false), 100),
      ),
    ]);

    assert.equal(returnedPromptly, true);
    assert.deepEqual(await search, []);
    assert.equal(instance.getSearchIndexReadiness().ready, false);
    assert.equal(instance.getSearchIndexReadiness().refreshing, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AliExpress publishes readiness only after category indexing and retains the old index on build failure", async () => {
  const feedUrl = "https://feeds.example.test/aliexpress-refresh-safety.csv";
  const body = [
    "id;name;url;category;currencyId;param;picture;oldprice;price",
    "safety-item;Safety item;https://shop.example.test/safety;Electronics;USD;;https://images.example.test/safety.jpg;;35",
  ].join("\n");
  const originalFetch = globalThis.fetch;
  let feedRequests = 0;
  globalThis.fetch = (async (input) => {
    if (String(input) !== feedUrl) throw new Error("Unexpected request");
    feedRequests += 1;
    return new Response(body);
  }) as typeof fetch;

  try {
    const instance = new AliExpressProvider(feedUrl, false);
    const categoryBuild = categoryIndexBuildStub(instance);
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

    const successfulRefresh = instance.refreshIndex();
    await buildStarted;
    assert.equal(instance.getSearchIndexReadiness().ready, false);
    assert.equal(instance.getSearchIndexReadiness().refreshing, true);
    finishBuild();
    assert.equal(await successfulRefresh, 1);
    assert.equal(instance.getSearchIndexReadiness().ready, true);
    assert.equal(instance.getSearchIndexReadiness().refreshing, false);

    categoryBuild.replace(async () => {
      throw new Error("category build failed");
    });
    await assert.rejects(instance.refreshIndex(), /category build failed/);
    assert.equal(instance.getSearchIndexReadiness().ready, true);
    assert.equal(instance.getSearchIndexReadiness().productCount, 1);
    assert.equal(instance.getSearchIndexReadiness().refreshing, false);
    assert.equal((await instance.search({ query: "Safety item" })).length, 1);
    assert.equal(feedRequests, 2);
    categoryBuild.restore();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("refresh timing diagnostics include only provider, durations, and product count", async () => {
  const feedUrl = "https://feeds.example.test/aliexpress-timing.csv";
  const feedBody = [
    "id;name;url;category;currencyId;param;picture;oldprice;price",
    "safe-id;Safe product;https://shop.example.test/safe;Electronics;USD;;https://images.example.test/safe.jpg;;35",
  ].join("\n");
  const originalFetch = globalThis.fetch;
  const originalInfo = logger.info;
  const infoCalls: unknown[][] = [];
  globalThis.fetch = (async (input) => {
    if (String(input) === feedUrl) return new Response(feedBody);
    throw new Error("Unexpected request");
  }) as typeof fetch;
  logger.info = ((...args: unknown[]) => {
    infoCalls.push(args);
  }) as typeof logger.info;

  try {
    const provider = new AliExpressProvider(feedUrl, false);
    assert.equal(await provider.refreshIndex(), 1);

    const expectedEvents = [
      ["Provider feed download and parse complete", ["feedDownloadParseDurationMs"]],
      [
        "Provider category-index build started",
        ["feedDownloadParseDurationMs", "categoryIndexBuildDurationMs"],
      ],
      [
        "Provider category-index build finished",
        ["feedDownloadParseDurationMs", "categoryIndexBuildDurationMs"],
      ],
      [
        "Provider product-index published",
        [
          "feedDownloadParseDurationMs",
          "categoryIndexBuildDurationMs",
          "totalRefreshDurationMs",
        ],
      ],
    ] as const;
    for (const [message, durationKeys] of expectedEvents) {
      const event = infoCalls.find(([, loggedMessage]) => loggedMessage === message);
      assert.ok(event, `expected timing event: ${message}`);
      const fields = event[0] as Record<string, unknown>;
      assert.deepEqual(
        Object.keys(fields).sort(),
        ["indexedProductCount", "providerId", ...durationKeys].sort(),
      );
      assert.equal(fields.providerId, "aliexpress");
      assert.equal(fields.indexedProductCount, 1);
      for (const key of durationKeys) {
        assert.equal(typeof fields[key], "number");
        assert.ok((fields[key] as number) >= 0);
      }
      assert.doesNotMatch(
        JSON.stringify(event),
        /aliexpress-timing|safe-id|Safe product|shop\.example/,
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
    logger.info = originalInfo;
  }
});

test("AliExpress retains official categories and indexes electronics beyond an apparel-heavy prefix", async () => {
  const feedUrl = "https://feeds.example.test/aliexpress-hot.csv";
  const header = "id;name;url;category;currencyId;param;picture;oldprice;price";
  const row = (id: number, title: string, category: string) =>
    `${id};${title};https://store.example.test/${id};${category};USD;;https://images.example.test/${id}.jpg;;35`;
  const shirts = Array.from({ length: 3_010 }, (_, index) =>
    row(index, `Laptop graphic cotton T-shirt ${index}`, "Tops & Tees"));
  const body = [
    header,
    ...shirts,
    row(3_010, "Wireless Bluetooth headphones", "Audio & Video"),
    row(3_011, "USB-C laptop charger 65W", "Tool Parts"),
    row(3_012, "Silicone curing agent for motors and electronics", "Tool Parts"),
    row(3_013, "Leather phone case", "Electronics"),
  ].join("\n");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    if (String(input) === feedUrl) return new Response(body);
    throw new Error("Unexpected request");
  }) as typeof fetch;
  try {
    const provider = new AliExpressProvider(feedUrl, false);
    assert.ok(await provider.refreshIndex() >= 3_002);
    const category = await provider.searchCategory({
      query: "electronics", category: "electronics", searchMode: "category_browse",
      page: 1, pageSize: 50,
    });
    assert.equal(category.ready, true);
    assert.equal(category.total, 2);
    assert.deepEqual(category.products.map((item) => item.id), ["3010", "3011"]);
    assert.equal(category.products[0]?.category, "Audio & Video");
    assert.equal(category.products[1]?.category, "Tool Parts");
  } finally {
    globalThis.fetch = originalFetch;
  }
});