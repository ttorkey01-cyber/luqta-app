import assert from "node:assert/strict";
import { test } from "node:test";
import { logger } from "../lib/logger";
import { AdmitadFeedProvider } from "./nazihProvider";

const FEED_URL = "https://feeds.example.test/nazih.csv";
const IMAGE_HOST = "https://images.example.test/";

type ImageProbe = {
  url: string;
  method: string | undefined;
};

type FeedProduct = {
  id: string;
  imageUrl?: string;
};

type ImageDelay = number | ((url: string) => number);

type ProbeHarness = {
  imageProbes: ImageProbe[];
  maxConcurrentImageProbes: number;
  warnings: unknown[][];
  infos: unknown[][];
  restore: () => void;
};

function feedResponse(products: FeedProduct[]) {
  const rows = products.map(
    ({ id, imageUrl }) =>
      [id, `Product ${id}`, `https://shop.example.test/${id}`, imageUrl ?? ""]
        .map((value) => `"${value.replaceAll('"', '""')}"`)
        .join(","),
  );
  return new Response(
    ["id,name,url,image_url", ...rows].join("\n"),
    { headers: { "content-type": "text/csv" } },
  );
}

function createHarness(
  feeds: FeedProduct[][],
  imageReachability: (url: string) => boolean,
  imageDelayMs: ImageDelay = 0,
): ProbeHarness {
  const imageProbes: ImageProbe[] = [];
  const warnings: unknown[][] = [];
  const infos: unknown[][] = [];
  let activeImageProbes = 0;
  let maxConcurrentImageProbes = 0;
  const feedResponses = feeds.map(feedResponse);
  const originalFetch = globalThis.fetch;
  const originalWarn = logger.warn;
  const originalInfo = logger.info;

  logger.warn = ((...args: unknown[]) => {
    warnings.push(args);
  }) as typeof logger.warn;
  logger.info = ((...args: unknown[]) => {
    infos.push(args);
  }) as typeof logger.info;

  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url === FEED_URL) {
      const response = feedResponses.shift();
      if (!response) {
        throw new Error("Unexpected additional feed refresh");
      }
      return response;
    }

    imageProbes.push({
      url,
      method: init?.method,
    });
    activeImageProbes += 1;
    maxConcurrentImageProbes = Math.max(
      maxConcurrentImageProbes,
      activeImageProbes,
    );

    return new Promise<Response>((resolve) => {
      setTimeout(() => {
        activeImageProbes -= 1;
        resolve(
          new Response(null, {
            status: imageReachability(url) ? 200 : 503,
          }),
        );
      }, typeof imageDelayMs === "function" ? imageDelayMs(url) : imageDelayMs);
    });
  }) as typeof fetch;

  return {
    imageProbes,
    get maxConcurrentImageProbes() {
      return maxConcurrentImageProbes;
    },
    warnings,
    infos,
    restore() {
      globalThis.fetch = originalFetch;
      logger.warn = originalWarn;
      logger.info = originalInfo;
    },
  };
}

function provider() {
  return new AdmitadFeedProvider(FEED_URL, {
    providerId: "nazih-test",
    providerName: "Nazih Test",
    merchant: "Nazih",
    feedSecret: "TEST_FEED_URL",
    country: "SA",
    currency: "SAR",
    priority: 1,
  });
}

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

async function waitForHealth(
  instance: AdmitadFeedProvider,
  expected: {
    status: string;
    sampledImageCount: number;
    reachableImageCount: number;
  },
  previousLastCheckedAt?: string | null,
) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const imageHealth = instance.metadata.imageHealth;
    if (
      imageHealth?.status === expected.status &&
      imageHealth.sampledImageCount === expected.sampledImageCount &&
      imageHealth.reachableImageCount === expected.reachableImageCount &&
      (previousLastCheckedAt === undefined ||
        imageHealth.lastCheckedAt !== previousLastCheckedAt)
    ) {
      return imageHealth;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(
    `Timed out waiting for image health ${JSON.stringify(expected)}; got ${JSON.stringify(instance.metadata.imageHealth)}`,
  );
}

test("caps image reachability checks at 12 URLs and four concurrent requests", async () => {
  const products = Array.from({ length: 15 }, (_, index) => ({
    id: `product-${index}`,
    imageUrl: `${IMAGE_HOST}product-${index}.jpg`,
  }));
  const harness = createHarness(
    [products],
    (url) => !url.endsWith("product-10.jpg") && !url.endsWith("product-11.jpg"),
    10,
  );

  try {
    const instance = provider();
    await instance.refreshIndex(false);
    const imageHealth = await waitForHealth(instance, {
      status: "degraded",
      sampledImageCount: 12,
      reachableImageCount: 10,
    });

    assert.equal(imageHealth.populatedImageCount, 15);
    assert.equal(harness.imageProbes.length, 12);
    assert.equal(new Set(harness.imageProbes.map(({ url }) => url)).size, 12);
    assert.ok(
      harness.maxConcurrentImageProbes <= 4,
      `expected at most four concurrent probes, got ${harness.maxConcurrentImageProbes}`,
    );
    assert.ok(
      harness.imageProbes.every(({ method }) => method === "HEAD"),
      "image probes should use HEAD requests",
    );
  } finally {
    harness.restore();
  }
});


test("keeps newer image health when older probes finish later", async () => {
  const olderProducts = [
    { id: "older-1", imageUrl: `${IMAGE_HOST}older-1.jpg` },
    { id: "older-2", imageUrl: `${IMAGE_HOST}older-2.jpg` },
  ];
  const newerProducts = [
    { id: "newer-1", imageUrl: `${IMAGE_HOST}newer-1.jpg` },
    { id: "newer-2", imageUrl: `${IMAGE_HOST}newer-2.jpg` },
    { id: "newer-3", imageUrl: `${IMAGE_HOST}newer-3.jpg` },
  ];
  const harness = createHarness(
    [olderProducts, newerProducts],
    (url) => !url.endsWith("newer-3.jpg"),
    (url) => (url.includes("older") ? 50 : 1),
  );

  try {
    const instance = provider();

    await instance.refreshIndex(false);
    await instance.refreshIndex(true);
    await waitForHealth(instance, {
      status: "degraded",
      sampledImageCount: 3,
      reachableImageCount: 2,
    });

    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.deepEqual(
      instance.metadata.imageHealth && {
        populatedImageCount: instance.metadata.imageHealth.populatedImageCount,
        sampledImageCount: instance.metadata.imageHealth.sampledImageCount,
        reachableImageCount: instance.metadata.imageHealth.reachableImageCount,
        status: instance.metadata.imageHealth.status,
      },
      {
        populatedImageCount: 3,
        sampledImageCount: 3,
        reachableImageCount: 2,
        status: "degraded",
      },
    );
  } finally {
    harness.restore();
  }
});

test("reports health states and warns only after repeated failures without logging URLs", async () => {
  const healthyProducts = [
    { id: "healthy-1", imageUrl: `${IMAGE_HOST}healthy-1.jpg` },
    { id: "healthy-2", imageUrl: `${IMAGE_HOST}healthy-2.jpg` },
  ];
  const degradedProducts = [
    { id: "degraded-1", imageUrl: `${IMAGE_HOST}degraded-1.jpg` },
    { id: "degraded-2", imageUrl: `${IMAGE_HOST}degraded-2.jpg` },
  ];
  const unreachableProducts = [
    { id: "unreachable-1", imageUrl: `${IMAGE_HOST}unreachable-1.jpg` },
    { id: "unreachable-2", imageUrl: `${IMAGE_HOST}unreachable-2.jpg` },
  ];
  const harness = createHarness(
    [healthyProducts, degradedProducts, unreachableProducts, unreachableProducts],
    (url) => url.includes("healthy") || url.endsWith("degraded-1.jpg"),
    5,
  );

  try {
    const instance = provider();

    await instance.refreshIndex(false);
    await waitForHealth(instance, {
      status: "healthy",
      sampledImageCount: 2,
      reachableImageCount: 2,
    });
    assert.equal(harness.warnings.length, 0);

    const healthyCheckedAt = instance.metadata.imageHealth?.lastCheckedAt;
    await instance.refreshIndex(true);
    await waitForHealth(instance, {
      status: "degraded",
      sampledImageCount: 2,
      reachableImageCount: 1,
    }, healthyCheckedAt);
    assert.equal(
      harness.warnings.length,
      0,
      "a single failed refresh must not warn",
    );

    const degradedCheckedAt = instance.metadata.imageHealth?.lastCheckedAt;
    await instance.refreshIndex(true);
    await waitForHealth(instance, {
      status: "unhealthy",
      sampledImageCount: 2,
      reachableImageCount: 0,
    }, degradedCheckedAt);
    assert.equal(
      harness.warnings.length,
      1,
      "the second consecutive failed refresh should warn",
    );

    const warningText = JSON.stringify(harness.warnings);
    assert.match(
      warningText,
      /Provider image health warning: sampled merchant images are not all reachable/,
    );
    assert.doesNotMatch(warningText, new RegExp(FEED_URL));
    assert.doesNotMatch(warningText, new RegExp(IMAGE_HOST));

    const firstUnhealthyCheckedAt = instance.metadata.imageHealth?.lastCheckedAt;
    await instance.refreshIndex(true);
    await waitForHealth(instance, {
      status: "unhealthy",
      sampledImageCount: 2,
      reachableImageCount: 0,
    }, firstUnhealthyCheckedAt);
    assert.equal(
      harness.warnings.length,
      1,
      "continued failures should not repeat the same warning every refresh",
    );
  } finally {
    harness.restore();
  }
});

test("resets image health and failure streak when a refresh has no image URLs", async () => {
  const unreachableProducts = [
    { id: "unreachable-1", imageUrl: `${IMAGE_HOST}unreachable-1.jpg` },
    { id: "unreachable-2", imageUrl: `${IMAGE_HOST}unreachable-2.jpg` },
  ];
  const emptyImageProducts = [
    { id: "empty-1" },
    { id: "empty-2" },
  ];
  const isolatedFailureProducts = [
    {
      id: "isolated-failure-1",
      imageUrl: `${IMAGE_HOST}isolated-failure-1.jpg`,
    },
    {
      id: "isolated-failure-2",
      imageUrl: `${IMAGE_HOST}isolated-failure-2.jpg`,
    },
  ];
  const harness = createHarness(
    [
      unreachableProducts,
      unreachableProducts,
      emptyImageProducts,
      isolatedFailureProducts,
    ],
    () => false,
    5,
  );

  try {
    const instance = provider();

    await instance.refreshIndex(false);
    const firstFailedHealth = await waitForHealth(instance, {
      status: "unhealthy",
      sampledImageCount: 2,
      reachableImageCount: 0,
    });
    await instance.refreshIndex(true);
    await waitForHealth(
      instance,
      {
        status: "unhealthy",
        sampledImageCount: 2,
        reachableImageCount: 0,
      },
      firstFailedHealth.lastCheckedAt,
    );
    assert.equal(
      harness.warnings.length,
      1,
      "the prior consecutive failures should have warned once",
    );

    await instance.refreshIndex(true);
    const emptyImageHealth = await waitForHealth(
      instance,
      {
        status: "not_checked",
        sampledImageCount: 0,
        reachableImageCount: 0,
      },
    );
    assert.equal(emptyImageHealth.populatedImageCount, 0);
    assert.equal(harness.imageProbes.length, 4);
    assert.equal(
      harness.warnings.length,
      1,
      "an empty-image refresh should not add a warning",
    );

    await instance.refreshIndex(true);
    await waitForHealth(
      instance,
      {
        status: "unhealthy",
        sampledImageCount: 2,
        reachableImageCount: 0,
      },
    );
    assert.equal(
      harness.warnings.length,
      1,
      "an isolated failure after an empty-image refresh must not warn",
    );
  } finally {
    harness.restore();
  }
});

test("preserves official image URLs when sampled image health is unhealthy", async () => {
  const products = [
    { id: "unreachable-1", imageUrl: `${IMAGE_HOST}unreachable-1.jpg` },
    { id: "unreachable-2", imageUrl: `${IMAGE_HOST}unreachable-2.jpg` },
  ];
  const harness = createHarness([products], () => false);

  try {
    const instance = provider();
    await instance.refreshIndex(false);
    await waitForHealth(instance, {
      status: "unhealthy",
      sampledImageCount: 2,
      reachableImageCount: 0,
    });

    const results = await instance.search({ query: "Product" });
    assert.equal(results.length, 2);
    assert.deepEqual(
      results.map((product) => product.imageUrl),
      products.map((product) => product.imageUrl),
    );
  } finally {
    harness.restore();
  }
});

test("intent search returns promptly while the initial feed refresh is still running", async () => {
  const originalFetch = globalThis.fetch;
  let feedFetchStarted = false;
  globalThis.fetch = (async (input) => {
    if (String(input) === FEED_URL) {
      feedFetchStarted = true;
      return new Promise<Response>(() => undefined);
    }
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  try {
    const instance = provider();
    const results = await Promise.race([
      instance.search({ query: "Product" }),
      new Promise<symbol>((resolve) =>
        setTimeout(() => resolve(Symbol.for("search-timeout")), 100),
      ),
    ]);

    assert.deepEqual(results, []);
    assert.equal(feedFetchStarted, true);
    assert.equal(instance.getSearchIndexReadiness().ready, false);
    assert.equal(instance.getSearchIndexReadiness().refreshing, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider refresh timing diagnostics omit feed and product details", async () => {
  const harness = createHarness([[{ id: "safe-product" }]], () => true);

  try {
    const instance = provider();
    assert.equal(await instance.refreshIndex(false), 1);

    const expectedEvents = [
      ["Provider feed download and parse complete", ["feedDownloadParseDurationMs"]],
      ["Provider category-index build queued", ["feedDownloadParseDurationMs"]],
      [
        "Provider category-index build started",
        ["feedDownloadParseDurationMs", "categoryIndexBuildWaitDurationMs", "categoryIndexBuildDurationMs"],
      ],
      [
        "Provider category-index build finished",
        ["feedDownloadParseDurationMs", "categoryIndexBuildWaitDurationMs", "categoryIndexBuildDurationMs"],
      ],
      [
        "Provider product-index published",
        [
          "feedDownloadParseDurationMs",
          "categoryIndexBuildWaitDurationMs",
          "categoryIndexBuildDurationMs",
          "totalRefreshDurationMs",
        ],
      ],
    ] as const;
    for (const [message, durationKeys] of expectedEvents) {
      const event = harness.infos.find(([, loggedMessage]) =>
        loggedMessage === message,
      );
      assert.ok(event, `expected timing event: ${message}`);
      const fields = event[0] as Record<string, unknown>;
      assert.deepEqual(
        Object.keys(fields).sort(),
        ["indexedProductCount", "providerId", ...durationKeys].sort(),
      );
      assert.equal(fields.providerId, "nazih-test");
      assert.equal(fields.indexedProductCount, 1);
      for (const key of durationKeys) {
        assert.equal(typeof fields[key], "number");
        assert.ok((fields[key] as number) >= 0);
      }
      assert.doesNotMatch(
        JSON.stringify(event),
        /nazih\.csv|safe-product|Product safe-product/,
      );
    }
  } finally {
    harness.restore();
  }
});

test("feed provider keeps readiness pending through category build and retains its index after build failure", async () => {
  const harness = createHarness(
    [[{ id: "safety-item" }], [{ id: "replacement-item" }]],
    () => true,
  );

  try {
    const instance = provider();
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

    const successfulRefresh = instance.refreshIndex(false);
    await buildStarted;
    assert.equal(instance.getSearchIndexReadiness().ready, false);
    assert.equal(instance.getSearchIndexReadiness().refreshing, true);
    finishBuild();
    assert.equal(await successfulRefresh, 1);
    assert.equal(instance.getSearchIndexReadiness().ready, true);
    assert.equal(instance.getSearchIndexReadiness().refreshing, false);
    categoryBuild.restore();

    categoryBuild.replace(async () => {
      throw new Error("category build failed");
    });
    await assert.rejects(instance.refreshIndex(true), /category build failed/);
    assert.equal(instance.getSearchIndexReadiness().ready, true);
    assert.equal(instance.getSearchIndexReadiness().productCount, 1);
    assert.equal(instance.getSearchIndexReadiness().refreshing, false);
    assert.equal((await instance.search({ query: "Product safety-item" })).length, 1);
  } finally {
    harness.restore();
  }
});
