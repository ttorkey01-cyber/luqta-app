import assert from "node:assert/strict";
import test from "node:test";
import { AliExpressProvider } from "./aliExpressProvider";

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