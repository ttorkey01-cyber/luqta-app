import assert from "node:assert/strict";
import test from "node:test";
import {
  BraveWebSearchProvider,
  buildBraveShoppingQuery,
  buildBraveShoppingQueries,
} from "./braveWebSearchProvider";
import { MAX_EXTERNAL_RETRIEVAL_QUERIES } from "./retrievalQueryPlanner";

test("builds focused Arabic and English Saudi shopping queries", () => {
  const watchQuery = buildBraveShoppingQuery("ساعة جيس رجالية سوداء");
  const watchQueries = buildBraveShoppingQueries("ساعة جيس رجالية سوداء");
  const carQueries = buildBraveShoppingQueries("شمعة كامري 2022");

  assert.match(watchQuery, /Guess/iu);
  assert.match(watchQuery, /watch/iu);
  assert.match(watchQuery, /Saudi Arabia/iu);
  assert.equal(watchQueries.length, 2);
  assert.ok(watchQueries.some((query) => /[\u0600-\u06ff]/u.test(query)));
  assert.ok(watchQueries.some((query) => /Saudi Arabia/iu.test(query)));
  assert.ok(carQueries.some((query) => /headlight/iu.test(query)));
  assert.ok(carQueries.some((query) => /Camry/iu.test(query)));
  assert.ok(carQueries.some((query) => /2022/u.test(query)));
  assert.ok(carQueries.some((query) => /شمعة.*كامري.*السعودية/u.test(query)));
});

test("uses canonical Louis Vuitton queries for contextual LV shopping requests", () => {
  for (const query of [
    "ابغا شنطة ال في",
    "LV handbag",
    "شنطة لويس فيتون",
  ]) {
    const braveQueries = buildBraveShoppingQueries(query);

    assert.equal(braveQueries.length, 2, query);
    assert.match(braveQueries[0] ?? "", /Louis Vuitton.*handbag.*Saudi Arabia/iu);
    assert.match(braveQueries[1] ?? "", /شنطة.*لويس فيتون.*السعودية/u);
  }

  const ambiguousQueries = buildBraveShoppingQueries("LV in a low voltage circuit");
  assert.ok(
    !ambiguousQueries.some((query) => /Louis Vuitton/iu.test(query)),
  );
});

test("merges and deduplicates bilingual web results and caches them", async () => {
  let fetchCalls = 0;
  const searchQueries: string[] = [];
  const provider = new BraveWebSearchProvider(
    "test-key",
    async (input) => {
      fetchCalls += 1;
      const requestUrl =
        typeof input === "string" || input instanceof URL ? input : input.url;
      searchQueries.push(new URL(requestUrl).searchParams.get("q") ?? "");
      return new Response(
        JSON.stringify({
          web: {
            results: [
              {
                title: "Sony WH-1000XM5 Wireless Headphones",
                url: "https://shop.example.sa/products/sony-wh-1000xm5",
                description: "Buy Sony WH-1000XM5 headphones in Saudi Arabia.",
                thumbnail: { src: "https://images.example.sa/sony.png" },
              },
              {
                title: "Sony headphones discussion",
                url: "https://reddit.com/r/headphones/example",
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  );

  const first = await provider.search({ query: "Sony WH-1000XM5" });
  const second = await provider.search({ query: "Sony WH-1000XM5" });
  const metrics = provider.getUsageMetrics();

  assert.ok(fetchCalls > 0 && fetchCalls <= MAX_EXTERNAL_RETRIEVAL_QUERIES);
  assert.equal(searchQueries.length, fetchCalls);
  assert.equal(new Set(searchQueries).size, fetchCalls);
  assert.ok(searchQueries.some((query) => /[\u0600-\u06ff]/u.test(query)));
  assert.ok(searchQueries.some((query) => /[a-z]/iu.test(query)));
  assert.equal(first.length, 1);
  assert.deepEqual(second, first);
  assert.equal(first[0]?.source, "brave_web");
  assert.equal(first[0]?.sourceType, "web");
  assert.equal(first[0]?.affiliateUrl, null);
  assert.equal(first[0]?.merchant, "shop.example.sa");
  assert.equal(first[0]?.price, undefined);
  assert.equal(first[0]?.availability, "unknown");
  assert.equal(metrics.braveRequests, fetchCalls);
  assert.equal(metrics.braveCacheHits, 1);
});

test("isolates Brave failures", async () => {
  const provider = new BraveWebSearchProvider(
    "test-key",
    async () => {
      throw new Error("network unavailable");
    },
  );

  assert.deepEqual(await provider.search({ query: "Nike Air Max" }), []);
  assert.ok(provider.getUsageMetrics().braveRequests > 0);
  assert.ok(provider.getUsageMetrics().braveRequests <= MAX_EXTERNAL_RETRIEVAL_QUERIES);
});