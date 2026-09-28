import assert from "node:assert/strict";
import test from "node:test";
import { ProviderRegistry } from "./providerRegistry";
import { SearchOrchestrator } from "./searchOrchestrator";
import { BraveWebSearchProvider } from "./braveWebSearchProvider";
import {
  getCategoryFilterFacets,
  getCategoryFilterIds,
  matchesLuqtaCategory,
} from "./categoryTaxonomy";
import { normalizeArabicForSearch } from "./queryExpansion";
import { HomeCurationService } from "./homeCurationService";
import type {
  NormalizedProduct,
  ProviderMetadata,
  ProviderProduct,
  ProviderSearchRequest,
  SearchProvider,
} from "./types";

const metadata: ProviderMetadata = {
  id: "catalog",
  name: "Catalog",
  enabled: true,
  searchEnabled: true,
  affiliateEnabled: false,
  priceMonitoringAllowed: false,
  visualSearchAllowed: false,
  country: "SA",
  currency: "SAR",
  integrationType: "affiliate_feed",
  requiresCredentials: false,
  credentialRequirements: [],
  priority: 1,
  lastSuccessfulSync: null,
  affiliateCapability: "not_applicable",
  priceMonitoringCapability: "disabled",
  integrationStatus: "ready",
};

function product(id: string, title: string): ProviderProduct {
  return {
    id,
    title,
    currency: "SAR",
    merchant: "Catalog",
    availability: "in_stock",
    sourceType: "affiliate_feed",
    exactMatchScore: 1,
  };
}

test("translated product matches outrank incidental Arabic mentions", async () => {
  const calls: ProviderSearchRequest[] = [];
  const provider: SearchProvider = {
    metadata,
    async search(request) {
      calls.push(request);
      if (request.query === "ساعة") {
        return [product("incidental", "Hair tool with one-hour timer")];
      }
      if (request.query === "watch") {
        return [product("watch", "Classic wrist watch")];
      }
      return [];
    },
  };
  const orchestrator = new SearchOrchestrator(
    new ProviderRegistry([provider]),
  );

  const results = await orchestrator.search({ query: "ساعة" });

  assert.equal(results[0]?.id, "watch");
  assert.equal(calls[0]?.intent?.raw, "ساعة");
  assert.ok(calls.some((call) => call.query === "watch"));
});

test("Arabic and English searches return equivalent connected-store product sets", async () => {
  const pairs = [
    {
      arabic: "جينز رجالي",
      english: "men's jeans",
      id: "fixture-jeans",
      title: "Men's Jeans",
      terms: ["جينز", "jeans", "denim"],
    },
    {
      arabic: "ساعة جيس رجالية سوداء",
      english: "Guess men's black watch",
      id: "fixture-watch",
      title: "Guess Men's Black Watch",
      terms: ["ساعة", "watch", "wristwatch"],
    },
    {
      arabic: "عطر نسائي",
      english: "women's perfume",
      id: "fixture-perfume",
      title: "Women's Perfume",
      terms: ["عطر", "perfume", "fragrance"],
    },
    {
      arabic: "شنطة سوداء",
      english: "black handbag",
      id: "fixture-handbag",
      title: "Black Handbag",
      terms: ["شنطة", "حقيبة", "handbag", "bag"],
    },
    {
      arabic: "شمعة كامري 2022",
      english: "2022 Camry headlight",
      id: "fixture-headlight",
      title: "Toyota Camry 2022 Headlight",
      terms: ["شمعة", "headlight"],
    },
  ] as const;

  for (const fixture of pairs) {
    const search = async (query: string) => {
      const seenQueries: string[] = [];
      const provider: SearchProvider = {
        metadata: { ...metadata, id: fixture.id },
        async search(request) {
          seenQueries.push(request.query);
          const normalizedQuery = normalizeArabicForSearch(request.query);
          return fixture.terms.some((term) =>
            normalizedQuery.includes(normalizeArabicForSearch(term)),
          )
            ? [product(fixture.id, fixture.title)]
            : [];
        },
      };
      const results = await new SearchOrchestrator(
        new ProviderRegistry([provider]),
      ).search({ query });
      return {
        ids: results.map((result) => result.id).sort(),
        seenQueries,
      };
    };

    const arabicResults = await search(fixture.arabic);
    const englishResults = await search(fixture.english);
    assert.deepEqual(arabicResults.ids, [fixture.id], fixture.arabic);
    assert.deepEqual(englishResults.ids, [fixture.id], fixture.english);
    assert.deepEqual(arabicResults.ids, englishResults.ids);
    assert.ok(
      arabicResults.seenQueries.some((query) => /[a-z]/iu.test(query)),
      `${fixture.arabic} did not issue an English provider query`,
    );
    assert.ok(
      englishResults.seenQueries.some((query) => /[\u0600-\u06ff]/u.test(query)),
      `${fixture.english} did not issue an Arabic provider query`,
    );
  }
});

test("Louis Vuitton abbreviation and transliteration searches reach the same catalog item", async () => {
  const queries = [
    "ابغا شنطة ال في",
    "LV handbag",
    "شنطة لويس فيتون",
  ];

  for (const query of queries) {
    const providerQueries: string[] = [];
    const provider: SearchProvider = {
      metadata,
      async search(request) {
        providerQueries.push(request.query);
        const normalizedQuery = normalizeArabicForSearch(request.query);
        return normalizedQuery.includes("louis vuitton") &&
          normalizedQuery.includes("handbag")
          ? [product("fixture-louis-vuitton-handbag", "Louis Vuitton Handbag")]
          : [];
      },
    };
    const results = await new SearchOrchestrator(
      new ProviderRegistry([provider]),
    ).search({ query });

    assert.deepEqual(
      results.map((result) => result.id),
      ["fixture-louis-vuitton-handbag"],
      query,
    );
    assert.ok(
      providerQueries.includes("Louis Vuitton handbag"),
      `${query} did not issue the canonical connected-store query`,
    );
  }
});

test("uses bilingual Brave fallback only when fewer than five strong matches exist", async () => {
  let braveCalls = 0;
  const provider: SearchProvider = {
    metadata,
    async search() {
      return [product("internal", "Sony WH-1000XM5 Headphones")];
    },
  };
  const fallback = new BraveWebSearchProvider("test-key", async () => {
    braveCalls += 1;
    return new Response(
      JSON.stringify({
        web: {
          results: [
            {
              title: "Sony WH-1000XM5 Wireless Headphones",
              url: "https://retailer.example.sa/sony-wh-1000xm5",
              description: "Sony WH-1000XM5 headphones available in Saudi Arabia",
            },
          ],
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  const orchestrator = new SearchOrchestrator(
    new ProviderRegistry([provider]),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    fallback,
  );

  const results = await orchestrator.search({ query: "Sony WH-1000XM5" });

  assert.equal(braveCalls, 2);
  assert.ok(results.some((result) => result.providerId === "brave-web"));
  assert.equal(
    results.find((result) => result.providerId === "brave-web")?.isAffiliate,
    false,
  );
  assert.equal(fallback.getUsageMetrics().braveFallbackTriggered, 1);
});

test("does not call Brave when five strong provider matches exist", async () => {
  let braveCalls = 0;
  const provider: SearchProvider = {
    metadata,
    async search() {
      return Array.from({ length: 5 }, (_, index) =>
        product(`internal-${index}`, `Nike Air Max ${index}`),
      );
    },
  };
  const fallback = new BraveWebSearchProvider("test-key", async () => {
    braveCalls += 1;
    return new Response(JSON.stringify({ web: { results: [] } }), {
      status: 200,
    });
  });
  const orchestrator = new SearchOrchestrator(
    new ProviderRegistry([provider]),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    fallback,
  );

  const results = await orchestrator.search({ query: "Nike Air Max" });

  assert.equal(results.length, 5);
  assert.equal(braveCalls, 0);
  assert.equal(fallback.getUsageMetrics().braveFallbackTriggered, 0);
});

test("triggers Brave when many watches miss the requested Guess brand", async () => {
  let braveCalls = 0;
  const provider: SearchProvider = {
    metadata,
    async search() {
      return Array.from({ length: 100 }, (_, index) =>
        product(`watch-${index}`, `D-Curve stainless steel watch ${index}`),
      );
    },
  };
  const fallback = new BraveWebSearchProvider("test-key", async () => {
    braveCalls += 1;
    return new Response(
      JSON.stringify({
        web: {
          results: [
            {
              title: "Guess Men's Black Watch",
              url: "https://guess.example.sa/black-watch",
            },
          ],
        },
      }),
      { status: 200 },
    );
  });
  const orchestrator = new SearchOrchestrator(
    new ProviderRegistry([provider]),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    fallback,
  );

  const results = await orchestrator.search({
    query: "Guess men's black watch",
  });

  assert.equal(braveCalls, 2);
  assert.equal(fallback.getUsageMetrics().braveFallbackTriggered, 1);
  assert.ok(results.some((result) => result.providerId === "brave-web"));
});

test("generic handbags cannot satisfy an explicit Louis Vuitton intent", async () => {
  const provider: SearchProvider = {
    metadata,
    async search() {
      return Array.from({ length: 68 }, (_, index) =>
        product(`generic-bag-${index}`, `Imitation leather handbag ${index}`),
      );
    },
  };
  const fallback = new BraveWebSearchProvider("test-key", async () =>
    new Response(
      JSON.stringify({
        web: {
          results: [
            {
              title: "Louis Vuitton Alma Handbag",
              url: "https://louisvuitton.example.sa/alma-handbag",
            },
            {
              title: "محلي - شنطة لويس فيتون M57963",
              url: "https://mahally.example.sa/louis-vuitton-m57963",
            },
            {
              title: "Louis Vuitton Detangling Hairbrush",
              url: "https://louisvuitton.example.sa/detangling-hairbrush",
            },
          ],
        },
      }),
      { status: 200 },
    ),
  );
  const orchestrator = new SearchOrchestrator(
    new ProviderRegistry([provider]),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    fallback,
  );

  const response = await orchestrator.searchWithMetadata({
    query: "Louis Vuitton handbag Saudi Arabia",
  });

  assert.equal(response.strongInternalMatchCount, 0);
  assert.equal(response.fallbackStatus, "used");
  const titles = response.products.map((item) => item.title);
  assert.equal(titles.length, 2);
  assert.ok(titles.includes("Louis Vuitton Alma Handbag"));
  assert.ok(titles.includes("محلي - شنطة لويس فيتون M57963"));
  assert.ok(!titles.some((title) => title.includes("Hairbrush")));
});

test("explicit Guess watch intent removes unrelated Brave discoveries", async () => {
  const provider: SearchProvider = {
    metadata,
    async search() {
      return [];
    },
  };
  const fallback = new BraveWebSearchProvider("test-key", async () =>
    new Response(
      JSON.stringify({
        web: {
          results: [
            {
              title: "Guess Men's Black Watch",
              url: "https://guess.example.sa/mens-black-watch",
            },
            {
              title: "Casio Men's Black Watch",
              url: "https://casio.example.sa/mens-black-watch",
            },
            {
              title: "Guess Women's Silver Watch",
              url: "https://guess.example.sa/womens-silver-watch",
            },
          ],
        },
      }),
      { status: 200 },
    ),
  );
  const orchestrator = new SearchOrchestrator(
    new ProviderRegistry([provider]),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    fallback,
  );

  const response = await orchestrator.searchWithMetadata({
    query: "Guess men's black watch",
  });

  assert.equal(response.fallbackStatus, "used");
  assert.deepEqual(
    response.products.map((item) => item.title),
    ["Guess Men's Black Watch"],
  );
});

test("triggers Brave for Arabic Guess intent when catalog results miss the brand", async () => {
  let braveCalls = 0;
  const braveQueries: string[] = [];
  const provider: SearchProvider = {
    metadata,
    async search() {
      return Array.from({ length: 100 }, (_, index) =>
        product(`watch-ar-${index}`, `D-Curve stainless steel watch ${index}`),
      );
    },
  };
  const fallback = new BraveWebSearchProvider("test-key", async (input) => {
    braveCalls += 1;
    const requestUrl =
      typeof input === "string" || input instanceof URL ? input : input.url;
    braveQueries.push(new URL(requestUrl).searchParams.get("q") ?? "");
    return new Response(
      JSON.stringify({
        web: {
          results: [
            {
              title: "Guess Men's Black Watch",
              url: "https://guess.example.sa/black-watch",
            },
          ],
        },
      }),
      { status: 200 },
    );
  });
  const orchestrator = new SearchOrchestrator(
    new ProviderRegistry([provider]),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    fallback,
  );

  const results = await orchestrator.search({
    query: "ساعة Guess رجالية سوداء",
  });

  assert.equal(braveCalls, 2);
  assert.ok(braveQueries.some((query) => /guess/iu.test(query)));
  assert.ok(braveQueries.some((query) => /black/iu.test(query)));
  assert.ok(braveQueries.some((query) => /men/iu.test(query)));
  assert.ok(braveQueries.some((query) => /[\u0600-\u06ff]/u.test(query)));
  assert.ok(results.some((result) => result.providerId === "brave-web"));
});

test("triggers Brave when many headlights miss the requested Camry year", async () => {
  let braveCalls = 0;
  const provider: SearchProvider = {
    metadata,
    async search() {
      return Array.from({ length: 100 }, (_, index) =>
        product(`bmw-${index}`, `BMW 2022 headlight assembly ${index}`),
      );
    },
  };
  const fallback = new BraveWebSearchProvider("test-key", async () => {
    braveCalls += 1;
    return new Response(
      JSON.stringify({
        web: {
          results: [
            {
              title: "Toyota Camry 2022 Headlight",
              url: "https://parts.example.sa/toyota-camry-2022-headlight",
            },
          ],
        },
      }),
      { status: 200 },
    );
  });
  const orchestrator = new SearchOrchestrator(
    new ProviderRegistry([provider]),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    fallback,
  );

  const results = await orchestrator.search({ query: "Camry 2022 headlight" });

  assert.equal(braveCalls, 2);
  assert.ok(results.some((result) => result.providerId === "brave-web"));
});

test("keeps Brave off when StyleWe has five strong product matches", async () => {
  let braveCalls = 0;
  const provider: SearchProvider = {
    metadata,
    async search() {
      return Array.from({ length: 5 }, (_, index) =>
        product(`dress-${index}`, `StyleWe floral dress ${index}`),
      );
    },
  };
  const fallback = new BraveWebSearchProvider("test-key", async () => {
    braveCalls += 1;
    return new Response(JSON.stringify({ web: { results: [] } }), {
      status: 200,
    });
  });
  const orchestrator = new SearchOrchestrator(
    new ProviderRegistry([provider]),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    fallback,
  );

  await orchestrator.search({ query: "StyleWe floral dress" });

  assert.equal(braveCalls, 0);
  assert.equal(fallback.getUsageMetrics().braveFallbackTriggered, 0);
});

test("category browsing filters by feed taxonomy and never calls Brave", async () => {
  let braveCalls = 0;
  let webProviderCalls = 0;
  const categoryProvider: SearchProvider = {
    metadata,
    async search(request) {
      assert.notEqual(request.category, undefined);
      return [
        {
          ...product("beauty", "Royal Beauty Hair Cream"),
          category: "Hair Care",
          description: "A leave-in hair care treatment",
        },
        {
          ...product("incidental", "Leather Briefcase"),
          category: "Men's Bags, Briefcases",
          description: "A structured bag that protects electronics",
        },
      ];
    },
  };
  const webProvider: SearchProvider = {
    metadata: {
      ...metadata,
      id: "web-search",
      integrationType: "web_search",
    },
    async search() {
      webProviderCalls += 1;
      return [product("web-result", "Beauty salon directory")];
    },
  };
  const fallback = new BraveWebSearchProvider("test-key", async () => {
    braveCalls += 1;
    return new Response(JSON.stringify({ web: { results: [] } }), {
      status: 200,
    });
  });
  const orchestrator = new SearchOrchestrator(
    new ProviderRegistry([categoryProvider, webProvider]),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    fallback,
  );

  const results = await orchestrator.search({
    query: "الجمال والعناية",
    category: "beauty_care",
  });

  assert.deepEqual(results.map((result) => result.id), ["beauty"]);
  assert.equal(webProviderCalls, 0);
  assert.equal(braveCalls, 0);
  assert.equal(fallback.getUsageMetrics().braveFallbackTriggered, 0);
});

test("category browse reports low inventory and only real facet counts", async () => {
  const provider: SearchProvider = {
    metadata,
    async search() {
      return [
        {
          ...product("hair", "Royal Beauty Hair Cream"),
          category: "Hair Care",
          description: "A leave-in hair care treatment",
        },
        {
          ...product("fragrance", "Royal Beauty Eau de Parfum"),
          category: "Fragrance",
          description: "A floral perfume",
        },
        {
          ...product("hair-2", "Royal Beauty Nourishing Hair Oil"),
          category: "Hair Care",
          description: "A nourishing hair care oil",
        },
        {
          ...product("fragrance-2", "Royal Beauty Floral Perfume"),
          category: "Fragrance",
          description: "A floral fragrance",
        },
      ];
    },
  };
  const orchestrator = new SearchOrchestrator(new ProviderRegistry([provider]));

  const response = await orchestrator.searchWithMetadata({
    query: "الجمال والعناية",
    category: "beauty_care",
    searchMode: "category_browse",
  });

  assert.equal(response.categoryState, "low");
  assert.equal(response.categoryInventoryCount, 4);
  assert.deepEqual(
    response.categoryFilters?.map((filter) => filter.id),
    ["fragrance", "hair_care"],
  );
  assert.ok(
    response.products.every((result) => result.categoryFilterIds?.length),
  );
});

test("category browse waits for a cold feed refresh before reporting inventory", async () => {
  let indexed = false;
  let refreshing = true;
  const indexedProduct = {
    ...product("refreshed-hair", "Royal Beauty Hair Cream"),
    category: "Hair Care",
    description: "A leave-in hair care treatment",
  };
  const provider: SearchProvider = {
    metadata,
    async search() {
      return [];
    },
    async refreshIndex() {
      await new Promise((resolve) => setTimeout(resolve, 30));
      indexed = true;
      refreshing = false;
      return 1;
    },
    getSearchIndexReadiness() {
      return {
        ready: indexed,
        productCount: indexed ? 1 : 0,
        refreshing,
        lastSuccessfulSync: indexed ? new Date().toISOString() : null,
      };
    },
    async searchCategory() {
      const products = indexed ? [indexedProduct] : [];
      return {
        products,
        total: products.length,
        facetCounts: {},
        ready: indexed,
      };
    },
  };
  const orchestrator = new SearchOrchestrator(new ProviderRegistry([provider]));

  const response = await orchestrator.searchWithMetadata({
    query: "الجمال والعناية",
    category: "beauty_care",
    searchMode: "category_browse",
  });

  assert.deepEqual(response.products.map((item) => item.id), ["refreshed-hair"]);
  assert.equal(response.categoryInventoryCount, 1);
  assert.notEqual(response.categoryState, "empty");
});

test("a failed category index refresh does not block inventory from another provider", async () => {
  const failedProvider: SearchProvider = {
    metadata: { ...metadata, id: "refresh-failure", name: "Refresh failure" },
    async search() {
      return [];
    },
    async refreshIndex() {
      throw new Error("Feed refresh failed");
    },
    getSearchIndexReadiness() {
      return {
        ready: false,
        productCount: 0,
        refreshing: true,
        lastSuccessfulSync: null,
      };
    },
    async searchCategory() {
      return { products: [], total: 0, facetCounts: {}, ready: false };
    },
  };
  const successfulProvider: SearchProvider = {
    metadata: { ...metadata, id: "available-catalog", name: "Available catalog" },
    async search() {
      return [];
    },
    async searchCategory() {
      const products = [
        {
          ...product("available-hair", "Royal Beauty Hair Cream"),
          category: "Hair Care",
          description: "A leave-in hair care treatment",
        },
      ];
      return {
        products,
        total: products.length,
        facetCounts: {},
        ready: true,
      };
    },
  };
  const orchestrator = new SearchOrchestrator(
    new ProviderRegistry([failedProvider, successfulProvider]),
  );
  const startedAt = Date.now();

  const response = await orchestrator.searchWithMetadata({
    query: "الجمال والعناية",
    category: "beauty_care",
    searchMode: "category_browse",
  });

  assert.deepEqual(response.products.map((item) => item.id), ["available-hair"]);
  assert.equal(response.categoryInventoryCount, 1);
  assert.ok(Date.now() - startedAt < 2_000, "failed refresh should settle promptly");
});

test("category facet selection filters before pagination and enforces secondary parents", async () => {
  const provider: SearchProvider = {
    metadata,
    async search() {
      return [
        {
          ...product("women-dress", "Women summer dress"),
          category: "Women's Clothing > Dresses",
        },
        {
          ...product("women-top", "Women cotton top"),
          category: "Women's Clothing > Tops",
        },
        {
          ...product("men-shirt", "Men oxford shirt"),
          category: "Men's Clothing > Shirts",
        },
        {
          ...product("kids-dress", "Girls party dress"),
          category: "Girls' Clothing > Dresses",
        },
      ];
    },
  };
  const orchestrator = new SearchOrchestrator(new ProviderRegistry([provider]));
  const search = (categoryFilterId: string) =>
    orchestrator.searchWithMetadata({
      query: "fashion",
      category: "fashion",
      categoryFilterId,
      searchMode: "category_browse",
    });

  const women = await search("women");
  const men = await search("men");
  const kids = await search("kids");
  const dresses = await search("dresses");

  assert.equal(women.categoryInventoryCount, 2);
  assert.deepEqual(women.products.map((item) => item.id), [
    "women-dress",
    "women-top",
  ]);
  assert.equal(men.categoryInventoryCount, 1);
  assert.deepEqual(men.products.map((item) => item.id), ["men-shirt"]);
  assert.equal(kids.categoryInventoryCount, 1);
  assert.deepEqual(kids.products.map((item) => item.id), ["kids-dress"]);
  assert.equal(dresses.categoryInventoryCount, 1);
  assert.deepEqual(dresses.products.map((item) => item.id), ["women-dress"]);
  assert.ok(
    dresses.products[0]?.categoryFilterIds?.includes("women"),
  );
});

test("category browsing paginates stable catalog results in 24-item pages", async () => {
  const provider: SearchProvider = {
    metadata,
    async search() {
      return Array.from({ length: 30 }, (_, index) => ({
        ...product(`women-top-${index}`, `Women cotton top ${index}`),
        category: "Women's Clothing > Tops",
      }));
    },
  };
  const orchestrator = new SearchOrchestrator(new ProviderRegistry([provider]));
  const request = {
    query: "fashion",
    category: "fashion" as const,
    searchMode: "category_browse" as const,
    pageSize: 24,
  };

  const firstPage = await orchestrator.searchWithMetadata({
    ...request,
    page: 1,
  });
  const secondPage = await orchestrator.searchWithMetadata({
    ...request,
    page: 2,
  });

  assert.equal(firstPage.total, 30);
  assert.equal(firstPage.page, 1);
  assert.equal(firstPage.pageSize, 24);
  assert.equal(firstPage.hasMore, true);
  assert.equal(firstPage.products.length, 24);
  assert.equal(secondPage.total, 30);
  assert.equal(secondPage.page, 2);
  assert.equal(secondPage.products.length, 6);
  assert.equal(secondPage.hasMore, false);
  assert.equal(
    new Set([...firstPage.products, ...secondPage.products]).size,
    30,
  );
});

test("indexed category pages merge provider windows before global pagination", async () => {
  const categoryCalls: Array<{ providerId: string; page?: number; pageSize?: number }> = [];
  const makeProvider = (
    providerId: string,
    priority: number,
    firstWindowScore: number,
    secondWindowScore: number,
  ): SearchProvider => ({
    metadata: { ...metadata, id: providerId, name: providerId, priority },
    async search() {
      return [];
    },
    async searchCategory(request) {
      categoryCalls.push({
        providerId,
        page: request.page,
        pageSize: request.pageSize,
      });
      const products = Array.from({ length: 48 }, (_, index) => ({
        ...product(`${providerId}-${index}`, `${providerId} women cotton top ${index}`),
        category: "Women's Clothing > Tops",
        exactMatchScore: index < 24 ? firstWindowScore : secondWindowScore,
      }));
      return {
        products: products.slice(0, request.pageSize ?? 24),
        total: products.length,
        facetCounts: { women: products.length },
        ready: true,
      };
    },
  });
  const orchestrator = new SearchOrchestrator(
    new ProviderRegistry([
      makeProvider("catalog-a", 1, 0.95, 0.9),
      makeProvider("catalog-b", 2, 0.94, 0.9),
    ]),
  );
  const request = {
    query: "fashion",
    category: "fashion" as const,
    searchMode: "category_browse" as const,
    pageSize: 24,
  };

  const firstPage = await orchestrator.searchWithMetadata({
    ...request,
    page: 1,
  });
  const secondPage = await orchestrator.searchWithMetadata({
    ...request,
    page: 2,
  });

  assert.deepEqual(
    firstPage.products.map((item) => item.id),
    Array.from({ length: 24 }, (_, index) => `catalog-a-${index}`),
  );
  assert.deepEqual(
    secondPage.products.map((item) => item.id),
    Array.from({ length: 24 }, (_, index) => `catalog-b-${index}`),
  );
  assert.equal(
    new Set([...firstPage.products, ...secondPage.products]).size,
    48,
  );
  assert.ok(
    categoryCalls.some(
      (call) =>
        call.providerId === "catalog-a" &&
        call.page === 1 &&
        call.pageSize === 48,
    ),
  );
  assert.ok(
    categoryCalls.some(
      (call) =>
        call.providerId === "catalog-b" &&
        call.page === 1 &&
        call.pageSize === 48,
    ),
  );
});

test("zero category inventory stays empty and never invokes Brave", async () => {
  let braveCalls = 0;
  const provider: SearchProvider = {
    metadata,
    async search() {
      return [
        {
          ...product("bag", "Leather Briefcase"),
          category: "Men's Bags, Briefcases",
          description: "A structured bag",
        },
      ];
    },
  };
  const fallback = new BraveWebSearchProvider("test-key", async () => {
    braveCalls += 1;
    return new Response(JSON.stringify({ web: { results: [] } }), {
      status: 200,
    });
  });
  const orchestrator = new SearchOrchestrator(
    new ProviderRegistry([provider]),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    fallback,
  );

  const response = await orchestrator.searchWithMetadata({
    query: "الجمال والعناية",
    category: "beauty_care",
    searchMode: "category_browse",
  });

  assert.equal(response.categoryState, "zero");
  assert.equal(response.categoryInventoryCount, 0);
  assert.deepEqual(response.products, []);
  assert.equal(braveCalls, 0);
});

test("explicit category-context intent can use Brave without category filtering", async () => {
  let braveCalls = 0;
  const calls: ProviderSearchRequest[] = [];
  const provider: SearchProvider = {
    metadata,
    async search(request) {
      calls.push(request);
      return [];
    },
  };
  const fallback = new BraveWebSearchProvider("test-key", async () => {
    braveCalls += 1;
    return new Response(
      JSON.stringify({
        web: {
          results: [
            {
              title: "Tom Ford Men's Fragrance",
              url: "https://retailer.example.sa/tom-ford-fragrance",
              description: "Tom Ford fragrance under 600 SAR",
            },
          ],
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  const orchestrator = new SearchOrchestrator(
    new ProviderRegistry([provider]),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    fallback,
  );

  const response = await orchestrator.searchWithMetadata({
    query: "عطر توم فورد رجالي أقل من 600",
    category: "beauty_care",
    searchMode: "intent",
  });

  assert.equal(calls[0]?.category, "beauty_care");
  assert.equal(calls[0]?.searchMode, "intent");
  assert.equal(braveCalls, 2);
  assert.equal(response.categoryState, undefined);
  assert.ok(response.products.some((result) => result.providerId === "brave-web"));
});

test("category matcher does not use incidental description mentions", () => {
  assert.equal(
    matchesLuqtaCategory(
      {
        title: "Leather Briefcase",
        category: "Men's Bags, Briefcases",
        description: "Protects electronics and office devices",
        brand: "Catalog",
      },
      "electronics",
    ),
    false,
  );
  assert.equal(
    matchesLuqtaCategory(
      {
        title: "USB Soldering Iron for Electronics",
        category: undefined,
        description: undefined,
        brand: undefined,
      },
      "electronics",
    ),
    true,
  );
  assert.equal(
    matchesLuqtaCategory(
      {
        title: "Tod's Red/Cream Striped Linen Scarf",
        category: "Women's Accessories, Scarves",
        description: "A lightweight accessory",
        brand: "Tod's",
      },
      "automotive",
    ),
    false,
  );
  assert.equal(
    matchesLuqtaCategory(
      {
        title: "Good Game Mini Leather Top Handle Bag",
        category: "Women's Handbags, Top Handle Bags",
        description: "A structured leather bag",
        brand: "Catalog",
      },
      "games_hobbies",
    ),
    false,
  );
});

test("fashion facets expose primary audiences and supported secondary types", () => {
  const products = [
    {
      ...product("women-dress-1", "Women floral dress"),
      category: "Women's Clothing > Dresses",
    },
    {
      ...product("women-dress-2", "Women evening dress"),
      category: "Women's Clothing > Dresses",
    },
    {
      ...product("men-shirt-1", "Men cotton shirt"),
      category: "Men's Clothing > Shirts",
    },
    {
      ...product("men-shirt-2", "Men linen shirt"),
      category: "Men's Clothing > Shirts",
    },
  ];

  const facets = getCategoryFilterFacets(products, "fashion");
  assert.deepEqual(
    facets.filter((facet) => facet.level === 0).map((facet) => facet.id),
    ["women", "men"],
  );
  assert.ok(
    facets.some(
      (facet) =>
        facet.id === "dresses" &&
        facet.parentId === "women" &&
        facet.count === 2,
    ),
  );
  assert.ok(
    facets.some(
      (facet) =>
        facet.id === "men_shirts" &&
        facet.parentId === "men" &&
        facet.count === 2,
    ),
  );
  assert.deepEqual(
    getCategoryFilterIds(products[0], "fashion"),
    ["women", "dresses"],
  );
});

test("Home picks use feed products with images and destinations without web fallback", async () => {
  const requests: ProviderSearchRequest[] = [];
  const search = {
    async searchWithMetadata(request: ProviderSearchRequest) {
      requests.push(request);
      return {
        products: Array.from({ length: 3 }, (_, index) => ({
          ...product(`pick-${index}`, `Feed pick ${index}`),
          providerId: "catalog",
          providerName: "Catalog",
          imageUrl: `https://images.example.com/pick-${index}.jpg`,
          productUrl: `https://merchant.example.com/pick-${index}`,
          destinationUrl: `https://merchant.example.com/pick-${index}`,
          category: "Watches",
          categoryFilterIds: ["watches"],
          description: "A complete feed product",
          rankScore: 0.8,
          priceScore: 0.5,
          availabilityScore: 1,
          conditionScore: 0.5,
          locationScore: 0.5,
          isAffiliate: index === 0,
          reliabilityScore: 0.8,
        })) as NormalizedProduct[],
        categoryState: "healthy" as const,
        categoryInventoryCount: 3,
        categoryFilters: [],
      };
    },
  };
  const service = new HomeCurationService(
    search as unknown as SearchOrchestrator,
  );

  const response = await service.getPicks();

  assert.equal(response.products.length, 3);
  assert.ok(
    response.products.every(
      (item) =>
        item.providerId !== "brave-web" &&
        item.imageUrl?.startsWith("https://") &&
        item.destinationUrl?.startsWith("https://"),
    ),
  );
  assert.ok(
    requests.every(
      (request) =>
        request.searchMode === "category_browse" &&
        request.category !== undefined,
    ),
  );
});

test("a timed-out intent provider is isolated and healthy results are returned", async () => {
  const slowProvider: SearchProvider = {
    metadata: { ...metadata, id: "slow-catalog", name: "Slow catalog" },
    search: () => new Promise<ProviderProduct[]>(() => undefined),
  };
  const fastProvider: SearchProvider = {
    metadata: { ...metadata, id: "fast-catalog", name: "Fast catalog" },
    async search() {
      return [product("fast-result", "Nike Air Max running shoes")];
    },
  };
  const trace: string[] = [];
  const orchestrator = new SearchOrchestrator(
    new ProviderRegistry([slowProvider, fastProvider]),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { providerSearchMs: 25, intentParserMs: 25, braveSearchMs: 25 },
  );
  const startedAt = performance.now();

  const response = await orchestrator.searchWithMetadata(
    { query: "Nike Air Max", preferredProviderIds: ["slow-catalog", "fast-catalog"] },
    (stage) => trace.push(stage),
  );

  assert.ok(performance.now() - startedAt < 300);
  assert.ok(response.products.some((item) => item.id === "fast-result"));
  assert.equal(
    response.__timings?.providerTimings.find(
      (item) => item.providerId === "slow-catalog",
    )?.timedOut,
    true,
  );
  assert.ok(trace.includes("provider_search_start"));
  assert.ok(trace.includes("provider_search_end"));
  assert.ok(trace.includes("response_composed"));
});

test("a timed-out category provider does not block the indexed category result", async () => {
  const slowProvider: SearchProvider = {
    metadata: { ...metadata, id: "slow-fashion", name: "Slow fashion" },
    search: () => new Promise<ProviderProduct[]>(() => undefined),
  };
  const indexedProvider: SearchProvider = {
    metadata: { ...metadata, id: "indexed-fashion", name: "Indexed fashion" },
    async search() {
      return [];
    },
    async searchCategory() {
      return {
        products: [
          {
            ...product("indexed-jeans", "Blue denim jeans"),
            category: "Women's Clothing > Jeans",
            productType: "jeans",
          },
        ],
        total: 1,
        facetCounts: {},
        ready: true,
        timings: {
          readinessWaitMs: 0,
          categoryIndexMs: 1,
          facetLookupMs: 0,
        },
      };
    },
  };
  const orchestrator = new SearchOrchestrator(
    new ProviderRegistry([slowProvider, indexedProvider]),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { providerSearchMs: 25, intentParserMs: 25, braveSearchMs: 25 },
  );
  const startedAt = performance.now();

  const response = await orchestrator.searchWithMetadata({
    query: "الأزياء والملابس",
    category: "fashion",
    searchMode: "category_browse",
  });

  assert.ok(performance.now() - startedAt < 300);
  assert.deepEqual(
    response.products.map((item) => item.id),
    ["indexed-jeans"],
  );
  assert.equal(
    response.__timings?.providerTimings.find(
      (item) => item.providerId === "slow-fashion",
    )?.timedOut,
    true,
  );
});

test("a stalled Brave fallback returns internal products instead of holding search", async () => {
  const internalProvider: SearchProvider = {
    metadata,
    async search() {
      return [product("internal-watch", "Classic wristwatch")];
    },
  };
  const fallback = new BraveWebSearchProvider(
    "test-key",
    () => new Promise<Response>(() => undefined),
  );
  const orchestrator = new SearchOrchestrator(
    new ProviderRegistry([internalProvider]),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    fallback,
    undefined,
    { providerSearchMs: 25, intentParserMs: 25, braveSearchMs: 25 },
  );
  const startedAt = performance.now();

  const response = await orchestrator.searchWithMetadata({
    query: "rare brand watch",
  });

  assert.ok(performance.now() - startedAt < 300);
  assert.ok(response.products.some((item) => item.id === "internal-watch"));
  assert.equal(response.fallbackStatus, "unavailable");
});

test("Brave completes after the former 1.2-second deadline within its new budget", async () => {
  const internalProvider: SearchProvider = {
    metadata,
    async search() {
      return [];
    },
  };
  const responsePayload = JSON.stringify({
    web: {
      results: [
        {
          title: "Guess Men's Black Watch",
          url: "https://guess.example.sa/black-watch",
        },
      ],
    },
  });
  const fallback = new BraveWebSearchProvider(
    "test-key",
    (_input, init) =>
      new Promise<Response>((resolve, reject) => {
        const timeout = setTimeout(
          () => resolve(new Response(responsePayload, { status: 200 })),
          1_350,
        );
        init?.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timeout);
            reject(new DOMException("The request was aborted", "AbortError"));
          },
          { once: true },
        );
      }),
  );
  const orchestrator = new SearchOrchestrator(
    new ProviderRegistry([internalProvider]),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    fallback,
  );

  const response = await orchestrator.searchWithMetadata({
    query: "Guess men's black watch",
  });

  assert.equal(response.fallbackStatus, "used");
  assert.ok(response.products.some((item) => item.providerId === "brave-web"));
});