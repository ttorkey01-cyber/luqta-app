import assert from "node:assert/strict";
import test from "node:test";
import { ProviderRegistry } from "./providerRegistry";
import {
  assessSearchQuality,
  filterExplicitIntentResults,
  InventoryUnavailableError,
  ProviderSearchError,
  SearchOrchestrator,
} from "./searchOrchestrator";
import { BraveWebSearchProvider } from "./braveWebSearchProvider";
import {
  getCategoryFilterFacets,
  getCategoryFilterIds,
  matchesLuqtaCategory,
} from "./categoryTaxonomy";
import { expandShoppingQuery, normalizeArabicForSearch } from "./queryExpansion";
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

test("empty ready-provider failure is distinct from a healthy no-match", async () => {
  const failedProvider: SearchProvider = {
    metadata,
    getSearchIndexReadiness() {
      return {
        ready: true,
        productCount: 0,
        refreshing: false,
        lastSuccessfulSync: null,
      };
    },
    async search() {
      throw new Error("stubbed provider failure");
    },
  };
  const failedSearch = new SearchOrchestrator(
    new ProviderRegistry([failedProvider]),
  );
  await assert.rejects(
    failedSearch.searchWithMetadata({ query: "rare product" }),
    (error: unknown) =>
      error instanceof ProviderSearchError &&
      error.providerIds.includes(metadata.id),
  );

  const emptyProvider: SearchProvider = {
    metadata,
    async search() {
      return [];
    },
    getSearchIndexReadiness() {
      return {
        ready: true,
        productCount: 0,
        refreshing: false,
        lastSuccessfulSync: null,
      };
    },
  };
  const noMatch = await new SearchOrchestrator(
    new ProviderRegistry([emptyProvider]),
  ).searchWithMetadata({ query: "rare product" });
  assert.deepEqual(noMatch.products, []);

  await assert.rejects(
    new SearchOrchestrator(new ProviderRegistry([])).searchWithMetadata({
      query: "rare product",
    }),
    InventoryUnavailableError,
  );
});

test("partial healthy provider products are returned when another ready provider fails", async () => {
  const failedProvider: SearchProvider = {
    metadata: { ...metadata, id: "failed-provider" },
    async search() {
      throw new Error("stubbed provider failure");
    },
    getSearchIndexReadiness() {
      return {
        ready: true,
        productCount: 0,
        refreshing: false,
        lastSuccessfulSync: null,
      };
    },
  };
  const healthyProvider: SearchProvider = {
    metadata: { ...metadata, id: "healthy-provider", priority: 2 },
    async search() {
      return [product("healthy-result", "Sony Wireless Headphones")];
    },
    getSearchIndexReadiness() {
      return {
        ready: true,
        productCount: 1,
        refreshing: false,
        lastSuccessfulSync: null,
      };
    },
  };
  const response = await new SearchOrchestrator(
    new ProviderRegistry([failedProvider, healthyProvider]),
  ).searchWithMetadata({ query: "Sony Wireless Headphones" });

  assert.ok(response.products.some((result) => result.id === "healthy-result"));
});

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

test("description-only color on broad pages does not suppress Brave fallback", async () => {
  let braveCalls = 0;
  const provider: SearchProvider = {
    metadata,
    async search() {
      return Array.from({ length: 5 }, (_, index) => ({
        ...product(`family-${index}`, `Guess Handbag Collection ${index}`),
        description: "A black handbag in the seasonal collection",
        brand: "Guess",
        productType: "handbag",
        color: null,
      }));
    },
  };
  const fallback = new BraveWebSearchProvider("test-key", async () => {
    braveCalls += 1;
    return new Response(JSON.stringify({ web: { results: [] } }), {
      status: 200,
    });
  });
  const response = await new SearchOrchestrator(
    new ProviderRegistry([provider]),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    fallback,
  ).searchWithMetadata({
    query: "Guess black handbag",
    intent: { brand: "Guess", color: "black", productType: "handbag" },
  });

  assert.equal(response.strongInternalMatchCount, 0);
  assert.ok(braveCalls > 0, "unknown title/structured color must not suppress fallback");
  assert.equal(
    response.products.filter((result) => result.id.startsWith("family-")).length,
    5,
    "fallback triggering must not remove V2 family-page candidates",
  );

  let matchedColorBraveCalls = 0;
  const matchedColorProvider: SearchProvider = {
    metadata,
    async search() {
      return Array.from({ length: 5 }, (_, index) => ({
        ...product(`black-bag-${index}`, `Guess Black Handbag ${index}`),
        brand: "Guess",
        productType: "handbag",
        color: "black",
      }));
    },
  };
  const matchedColorFallback = new BraveWebSearchProvider("test-key", async () => {
    matchedColorBraveCalls += 1;
    return new Response(JSON.stringify({ web: { results: [] } }), {
      status: 200,
    });
  });
  const matchedResponse = await new SearchOrchestrator(
    new ProviderRegistry([matchedColorProvider]),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    matchedColorFallback,
  ).searchWithMetadata({
    query: "Guess black handbag",
    intent: { brand: "Guess", color: "black", productType: "handbag" },
  });

  assert.equal(matchedResponse.strongInternalMatchCount, 5);
  assert.equal(matchedColorBraveCalls, 0);
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
    query: "الجمال والعناية أقل من 100 ريال",
    category: "beauty_care",
    searchMode: "category_browse",
  });

  assert.equal(response.categoryState, "low");
  assert.equal(response.categoryInventoryCount, 4);
  assert.equal(response.products.length, 4);
  assert.equal(response.exactMatches, undefined);
  assert.deepEqual(
    response.categoryFilters?.map((filter) => filter.id),
    ["fragrance", "hair_care"],
  );
  assert.ok(
    response.products.every((result) => result.categoryFilterIds?.length),
  );
});

test("strict Arabic maximum excludes over-budget and unknown-price products and preserves merged intent", async () => {
  const provider: SearchProvider = {
    metadata,
    async search() {
      return [
        {
          ...product("bag-299", "Black handbag"),
          productType: "handbag",
          color: "black",
          price: 299,
          currency: "SAR",
        },
        {
          ...product("bag-300", "Black handbag at budget"),
          productType: "handbag",
          color: "black",
          price: 300,
          currency: "SAR",
        },
        {
          ...product("bag-301", "Black handbag above budget"),
          productType: "handbag",
          color: "black",
          price: 301,
          currency: "SAR",
        },
        {
          ...product("bag-unknown", "Black handbag without a listed price"),
          productType: "handbag",
          color: "black",
          price: null,
          currency: "SAR",
        },
        {
          ...product("bag-usd", "Black handbag priced in dollars"),
          productType: "handbag",
          color: "black",
          price: 10,
          currency: "USD",
        },
      ];
    },
  };
  const response = await new SearchOrchestrator(
    new ProviderRegistry([provider]),
  ).searchWithMetadata({
    query: "شنطة سوداء أقل من 300 ريال",
    intent: { brand: "Guess", condition: "used", location: "Riyadh" },
  });

  assert.deepEqual(
    response.products.map((result) => result.id),
    ["bag-299", "bag-300"],
  );
  assert.equal(response.exactMatches, 2);
  assert.equal(response.constraintRelaxationAvailable, false);
  assert.equal(response.structuredIntent?.brand, "Guess");
  assert.equal(response.structuredIntent?.color, "black");
  assert.equal(response.structuredIntent?.productType, "handbag");
  assert.equal(response.structuredIntent?.condition, "used");
  assert.equal(response.structuredIntent?.location, "Riyadh");
});

test("Arabic black handbag intent rejects cheap beauty and false Hand Bag brush matches before strict price ranking", async () => {
  const fixtures: ProviderProduct[] = [
    {
      ...product("black-bag-299", "Black leather handbag"),
      productType: "handbag",
      color: "black",
      price: 299,
      currency: "SAR",
    },
    {
      ...product("black-bag-300", "Black handbag at the limit"),
      productType: "handbag",
      color: "black",
      price: 300,
      currency: "SAR",
    },
    {
      ...product("black-bag-unknown-price", "Black handbag price unavailable"),
      productType: "handbag",
      color: "black",
      price: null,
      currency: "SAR",
    },
    {
      ...product("black-bag-over-budget", "Black handbag over budget"),
      productType: "handbag",
      color: "black",
      price: 301,
      currency: "SAR",
    },
    {
      ...product("hand-bag-paddle-brush", "Hand Bag paddle brush"),
      productType: "paddle brush",
      price: 25,
      currency: "SAR",
    },
    {
      ...product("cheap-shampoo", "Black shampoo"),
      productType: "shampoo",
      color: "black",
      price: 15,
      currency: "SAR",
    },
    {
      ...product("incidental-bag-shampoo", "Black shampoo for handbag care"),
      productType: "shampoo",
      color: "black",
      price: 20,
      currency: "SAR",
    },
    {
      ...product("cheap-black-headphones", "Black headphones"),
      productType: "headphones",
      color: "black",
      price: 100,
      currency: "SAR",
    },
  ];
  const provider: SearchProvider = {
    metadata,
    async search() {
      return fixtures;
    },
  };

  const response = await new SearchOrchestrator(
    new ProviderRegistry([provider]),
  ).searchWithMetadata({ query: "شنطة سوداء أقل من 300 ريال" });

  assert.deepEqual(
    response.products.map((result) => result.id),
    ["black-bag-299", "black-bag-300"],
  );
  assert.ok(response.products.every((result) => result.price !== null && result.price! <= 300));
  assert.equal(response.exactMatches, 2, "exactMatches remains a strict-price count, not an identity claim");
  assert.equal(response.constraintRelaxationAvailable, false);
});

test("Arabic phone maximum cannot make inexpensive grooming products relevant", async () => {
  const fixtures: ProviderProduct[] = [
    {
      ...product("phone-under-1500", "Samsung Galaxy phone"),
      productType: "phone",
      price: 1_499,
      currency: "SAR",
    },
    {
      ...product("cheap-beard-trimmer", "Beard trimmer"),
      productType: "grooming",
      price: 40,
      currency: "SAR",
    },
    {
      ...product("cheap-shaver", "Electric shaver"),
      productType: "grooming",
      price: 80,
      currency: "SAR",
    },
    {
      ...product("cheap-hair-cream", "Hair cream"),
      productType: "cream",
      price: 20,
      currency: "SAR",
    },
  ];
  const provider: SearchProvider = {
    metadata,
    async search() {
      return fixtures;
    },
  };

  const response = await new SearchOrchestrator(
    new ProviderRegistry([provider]),
  ).searchWithMetadata({ query: "جوال أقل من 1500 ريال" });

  assert.deepEqual(response.products.map((result) => result.id), ["phone-under-1500"]);
  assert.ok(response.products.every((result) => result.price !== null && result.price! <= 1_500));
  assert.equal(response.structuredIntent?.productType, "phone");
});

test("Nike size 42 treats millimeters as conflicting evidence while retaining an unknown-size shoe", async () => {
  const provider: SearchProvider = {
    metadata,
    async search() {
      return [
        {
          ...product("nike-eu-42-shoe", "Nike black running shoe EU 42"),
          productType: "shoes",
          brand: "Nike",
          color: "black",
        },
        {
          ...product("nike-42mm-band", "Nike black 42 mm watch band"),
          productType: "watch band",
          brand: "Nike",
          color: "black",
        },
        {
          ...product("nike-unknown-size-shoe", "Nike black running shoe"),
          productType: "shoes",
          brand: "Nike",
          color: "black",
        },
      ];
    },
  };

  const response = await new SearchOrchestrator(
    new ProviderRegistry([provider]),
  ).searchWithMetadata({ query: "Nike أسود مقاس 42" });

  assert.deepEqual(
    response.products.map((result) => result.id),
    ["nike-eu-42-shoe", "nike-unknown-size-shoe"],
  );
  assert.equal(response.products[0]?.title.includes("EU 42"), true);
  assert.equal(response.products[1]?.title.includes("42"), false);
  assert.equal(response.exactMatches, undefined);
});

test("Diesel jeans size 32 distinguishes waist from inseam and keeps unknown waist discoverable", async () => {
  const provider: SearchProvider = {
    metadata,
    async search() {
      return [
        {
          ...product("diesel-waist-32", "Diesel jeans waist 32"),
          productType: "jeans",
          brand: "Diesel",
        },
        {
          ...product("diesel-waist-34-inseam-32", "Diesel jeans waist 34 inseam 32"),
          productType: "jeans",
          brand: "Diesel",
        },
        {
          ...product("diesel-unknown-waist", "Diesel denim jeans"),
          productType: "jeans",
          brand: "Diesel",
        },
      ];
    },
  };

  const response = await new SearchOrchestrator(
    new ProviderRegistry([provider]),
  ).searchWithMetadata({ query: "Diesel jeans مقاس 32" });

  assert.deepEqual(
    response.products.map((result) => result.id),
    ["diesel-waist-32", "diesel-unknown-waist"],
  );
  assert.equal(response.products[0]?.title.includes("waist 32"), true);
  assert.equal(response.products[1]?.title.includes("waist"), false);
  assert.equal(response.exactMatches, undefined);
});

test("distinctive SKU is preserved through fallback and generic toasters remain an honest no-match", async () => {
  const provider: SearchProvider = {
    metadata,
    async search() {
      return [
        {
          ...product("generic-purple-toaster", "Purple seventeen-handle toaster"),
          productType: "toaster",
          color: "purple",
        },
      ];
    },
  };
  const fallbackQueries: string[] = [];
  const fallback = new BraveWebSearchProvider("test-key", async (input) => {
    const requestUrl =
      typeof input === "string" || input instanceof URL ? input : input.url;
    fallbackQueries.push(new URL(requestUrl).searchParams.get("q") ?? "");
    return new Response(
      JSON.stringify({
        web: {
          results: [
            {
              title: "Purple seventeen-handle toaster",
              url: "https://retailer.example.sa/purple-toaster",
            },
          ],
        },
      }),
      { status: 200 },
    );
  });

  const response = await new SearchOrchestrator(
    new ProviderRegistry([provider]),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    fallback,
  ).searchWithMetadata({
    query: "QZVTR-999 seventeen-handle purple toaster",
  });

  assert.ok(fallbackQueries.length > 0, "a no-match must attempt the stubbed fallback");
  assert.ok(
    fallbackQueries.every((query) => query.includes("QZVTR-999")),
    "each planned fallback query must retain the distinctive identifier",
  );
  assert.deepEqual(response.products, []);
  assert.equal(response.fallbackStatus, "empty");
  assert.equal(response.exactMatches, undefined);
});

test("Samsung S24 Ultra and iPhone 15 Pro Max preserve complete models and reject family pages", async () => {
  const cases = [
    {
      query: "Samsung S24 Ultra",
      model: "Samsung Galaxy S24 Ultra",
      family: "Samsung Galaxy S24 family",
      identifier: "S24 Ultra",
    },
    {
      query: "iPhone 15 Pro Max",
      model: "Apple iPhone 15 Pro Max",
      family: "Apple iPhone 15 family",
      identifier: "iPhone 15 Pro Max",
    },
  ];

  for (const fixture of cases) {
    const providerQueries: string[] = [];
    const provider: SearchProvider = {
      metadata,
      async search(request) {
        providerQueries.push(request.query);
        return [
          product(`${fixture.identifier}-exact`, fixture.model),
          {
            ...product(`${fixture.identifier}-accessory`, `${fixture.model} case`),
            productType: "phone case",
            category: "electronics",
          },
          {
            ...product(`${fixture.identifier}-family`, fixture.family),
            productUrl: "https://retailer.example.sa/collections/phones",
          },
        ];
      },
    };
    const response = await new SearchOrchestrator(
      new ProviderRegistry([provider]),
    ).searchWithMetadata({ query: fixture.query });

    assert.ok(
      providerQueries.some((query) => query.includes(fixture.identifier)),
      `${fixture.query} must be issued intact to the connected provider`,
    );
    assert.deepEqual(
      response.products.map((result) => result.id),
      [`${fixture.identifier}-exact`],
      `${fixture.query} must not be broadened to a family page`,
    );
    assert.equal(response.exactMatches, undefined, "a preserved model is not an identity EXACT claim");
  }
});

test("soft Arabic watch budget cannot make a nearby-priced grooming product outrank relevance", async () => {
  const provider: SearchProvider = {
    metadata,
    async search() {
      return [
        {
          ...product("watch-near-budget", "Classic wrist watch"),
          productType: "watch",
          price: 500,
          currency: "SAR",
        },
        {
          ...product("watch-over-budget", "Automatic wrist watch"),
          productType: "watch",
          price: 1_800,
          currency: "SAR",
        },
        {
          ...product("brush-near-budget", "Paddle hair brush"),
          productType: "paddle brush",
          price: 495,
          currency: "SAR",
        },
      ];
    },
  };

  const response = await new SearchOrchestrator(
    new ProviderRegistry([provider]),
  ).searchWithMetadata({ query: "ساعة حدود 500 ريال" });

  assert.equal(response.products[0]?.id, "watch-near-budget");
  assert.deepEqual(
    response.products.map((result) => result.id),
    ["watch-near-budget", "watch-over-budget"],
  );
  assert.equal(response.structuredIntent?.approximatePrice, 500);
  assert.equal(response.structuredIntent?.maxPrice, undefined);
  assert.equal(response.exactMatches, undefined);
});

test("plain Arabic black bag search rejects unrelated products without claiming exact identity", async () => {
  const provider: SearchProvider = {
    metadata,
    async search() {
      return [
        {
          ...product("plain-black-handbag", "Black handbag"),
          productType: "handbag",
          color: "black",
        },
        {
          ...product("plain-black-shampoo", "Black shampoo"),
          productType: "shampoo",
          color: "black",
        },
      ];
    },
  };

  const response = await new SearchOrchestrator(
    new ProviderRegistry([provider]),
  ).searchWithMetadata({ query: "شنطة سوداء" });

  assert.deepEqual(response.products.map((result) => result.id), ["plain-black-handbag"]);
  assert.equal(response.exactMatches, undefined);
});

test("requested color accepts UNKNOWN evidence but filters explicit conflicts without making identity claims", async () => {
  const provider: SearchProvider = {
    metadata,
    async search() {
      return [
        {
          ...product("color-unknown-family", "Guess Handbag Collection"),
          productUrl: "https://guess.example.sa/collections/handbags",
          brand: "Guess",
          productType: "handbag",
          color: null,
        },
        {
          ...product("color-structured-match", "Guess Leather Handbag"),
          brand: "Guess",
          productType: "handbag",
          color: "black",
        },
        {
          ...product("color-title-conflict", "Guess Blue Handbag"),
          brand: "Guess",
          productType: "handbag",
        },
        {
          ...product("color-structured-conflict", "Guess Handbag"),
          brand: "Guess",
          productType: "handbag",
          color: "red",
        },
        {
          ...product("wrong-brand", "Other Leather Handbag"),
          brand: "Other",
          productType: "handbag",
        },
        {
          ...product("wrong-product", "Guess Leather Wallet"),
          brand: "Guess",
          productType: "handbag",
        },
      ];
    },
  };
  const response = await new SearchOrchestrator(
    new ProviderRegistry([provider]),
  ).searchWithMetadata({
    query: "Guess black handbag",
    intent: { brand: "Guess", color: "black", productType: "handbag" },
  });

  const qualityQuery = expandShoppingQuery("Guess black handbag");
  const explicitIntent = {
    brand: "Guess",
    color: "black",
    productType: "handbag",
  };
  assert.deepEqual(
    filterExplicitIntentResults(
      response.products,
      qualityQuery,
      explicitIntent,
    )
      .map((result) => result.id)
      .sort(),
    ["color-structured-match", "color-unknown-family"],
  );
  const unknownColorResult = response.products.filter(
    (result) => result.id === "color-unknown-family",
  );
  assert.equal(
    assessSearchQuality(unknownColorResult, qualityQuery, explicitIntent)
      .stronglyRelevantCount,
    0,
    "unknown color evidence must not count as a strong color match or suppress fallback",
  );
  // Identity EXACT is not an emitted label; ordinary searches make no exact claim.
  assert.equal(response.exactMatches, undefined);
  assert.equal(
    response.products.find((result) => result.id === "color-unknown-family")
      ?.productUrl?.includes("/collections/"),
    true,
  );
});

test("unusable nonempty Brave results do not discard an in-budget unknown-color internal candidate", async () => {
  const provider: SearchProvider = {
    metadata,
    async search() {
      return [
        {
          ...product("internal-unknown-color", "Guess Handbag Collection"),
          description: "A collection page for Guess handbags",
          brand: "Guess",
          productType: "handbag",
          color: null,
          price: 80,
          currency: "SAR",
        },
      ];
    },
  };
  const fallback = new BraveWebSearchProvider("test-key", async () =>
    new Response(
      JSON.stringify({
        web: {
          results: [
            {
              title: "Guess Blue Handbag",
              url: "https://guess.example.sa/blue-handbag",
              description: "Blue Guess handbag",
            },
          ],
        },
      }),
      { status: 200 },
    ),
  );
  const response = await new SearchOrchestrator(
    new ProviderRegistry([provider]),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    fallback,
  ).searchWithMetadata({
    query: "Guess black handbag under 100 SAR",
    intent: {
      brand: "Guess",
      color: "black",
      productType: "handbag",
      maxPrice: 100,
      currency: "SAR",
    },
  });

  assert.equal(response.fallbackStatus, "empty");
  assert.equal(fallback.getUsageMetrics().braveFallbackTriggered, 1);
  assert.deepEqual(
    response.products.map((result) => result.id),
    ["internal-unknown-color"],
  );
});

test("known structured condition can satisfy condition intent but UNKNOWN condition still needs label evidence", async () => {
  const provider: SearchProvider = {
    metadata,
    async search() {
      return [
        {
          ...product("condition-structured-match", "Guess Handbag"),
          brand: "Guess",
          productType: "handbag",
          condition: "used",
        },
        {
          ...product("condition-unknown", "Guess Handbag"),
          brand: "Guess",
          productType: "handbag",
          condition: "unknown",
        },
        {
          ...product("condition-structured-conflict", "Guess Used Handbag"),
          brand: "Guess",
          productType: "handbag",
          condition: "new",
        },
      ];
    },
  };
  const response = await new SearchOrchestrator(
    new ProviderRegistry([provider]),
  ).searchWithMetadata({
    query: "Guess used handbag",
    intent: { brand: "Guess", condition: "used", productType: "handbag" },
  });

  assert.deepEqual(
    filterExplicitIntentResults(
      response.products,
      expandShoppingQuery("Guess used handbag"),
      { brand: "Guess", condition: "used", productType: "handbag" },
    ).map((result) => result.id),
    ["condition-structured-match"],
  );
  assert.equal(response.exactMatches, undefined);
});

test("unknown color metadata does not relax strict maximum-price filtering", async () => {
  const provider: SearchProvider = {
    metadata,
    async search() {
      return [
        {
          ...product("color-under-budget", "Guess Handbag"),
          brand: "Guess",
          productType: "handbag",
          color: null,
          price: 99,
          currency: "SAR",
        },
        {
          ...product("color-over-budget", "Guess Handbag"),
          brand: "Guess",
          productType: "handbag",
          color: null,
          price: 101,
          currency: "SAR",
        },
        {
          ...product("color-price-unknown", "Guess Handbag"),
          brand: "Guess",
          productType: "handbag",
          color: null,
          price: null,
          currency: "SAR",
        },
      ];
    },
  };
  const response = await new SearchOrchestrator(
    new ProviderRegistry([provider]),
  ).searchWithMetadata({
    query: "Guess black handbag",
    intent: {
      brand: "Guess",
      color: "black",
      productType: "handbag",
      maxPrice: 100,
      currency: "SAR",
    },
  });

  assert.deepEqual(
    response.products.map((result) => result.id),
    ["color-under-budget"],
  );
  assert.equal(response.exactMatches, 1);
  assert.equal(response.constraintRelaxationAvailable, false);
});

test("strict Arabic price range keeps in-range prices and reports zero exact matches separately", async () => {
  const provider: SearchProvider = {
    metadata,
    async search() {
      return [
        { ...product("shoe-199", "Running shoes"), productType: "shoes", price: 199, currency: "SAR" },
        { ...product("shoe-200", "Running shoes at lower limit"), productType: "shoes", price: 200, currency: "SAR" },
        { ...product("shoe-400", "Running shoes at upper limit"), productType: "shoes", price: 400, currency: "SAR" },
        { ...product("shoe-401", "Running shoes above range"), productType: "shoes", price: 401, currency: "SAR" },
        { ...product("shoe-unknown", "Running shoes without price"), productType: "shoes", price: null, currency: "SAR" },
      ];
    },
  };
  const response = await new SearchOrchestrator(
    new ProviderRegistry([provider]),
  ).searchWithMetadata({ query: "جزمة من 200 إلى 400" });

  assert.deepEqual(
    response.products.map((result) => result.id),
    ["shoe-200", "shoe-400"],
  );
  assert.equal(response.exactMatches, 2);
  assert.equal(response.constraintRelaxationAvailable, false);

  const emptyProvider: SearchProvider = {
    metadata,
    async search() {
      return [{ ...product("shoe-unknown-only", "Running shoes"), productType: "shoes", price: null, currency: null }];
    },
  };
  const empty = await new SearchOrchestrator(
    new ProviderRegistry([emptyProvider]),
  ).searchWithMetadata({ query: "جزمة من 200 إلى 400" });

  assert.deepEqual(empty.products, []);
  assert.equal(empty.exactMatches, 0);
  assert.equal(empty.constraintRelaxationAvailable, true);
});

test("strict price limits also filter web fallback products with missing or out-of-budget prices", async () => {
  const provider: SearchProvider = { metadata, async search() { return []; } };
  const fallback = {
    metadata: { ...metadata, id: "brave-web", integrationType: "web_search" as const, searchEnabled: true },
    noteFallbackTriggered() {},
    async search() {
      return [
        { ...product("web-unknown", "Black handbag"), price: null, currency: "SAR", sourceType: "web" },
        { ...product("web-over", "Black handbag"), price: 400, currency: "SAR", sourceType: "web" },
      ];
    },
  } as unknown as BraveWebSearchProvider;
  const response = await new SearchOrchestrator(
    new ProviderRegistry([provider]),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    fallback,
  ).searchWithMetadata({ query: "شنطة سوداء ما يتعدى 300 ريال" });

  assert.deepEqual(response.products, []);
  assert.equal(response.exactMatches, 0);
  assert.equal(response.constraintRelaxationAvailable, true);
});

test("approximate prices do not become strict price limits", async () => {
  const provider: SearchProvider = {
    metadata,
    async search() {
      return [{ ...product("bag-500", "Handbag"), productType: "handbag", price: 500, currency: "SAR" }];
    },
  };
  const response = await new SearchOrchestrator(
    new ProviderRegistry([provider]),
  ).searchWithMetadata({ query: "شنطة حوالي 300 ريال" });

  assert.deepEqual(response.products.map((result) => result.id), ["bag-500"]);
  assert.equal(response.structuredIntent?.approximatePrice, 300);
  assert.equal(response.structuredIntent?.maxPrice, undefined);
  assert.equal(response.exactMatches, undefined);
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

test("concurrent cold requests reuse one import and do not cache a false zero", async () => {
  let imports = 0;
  let indexed = false;
  let inFlight: Promise<number> | undefined;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const provider: SearchProvider = {
    metadata,
    async search() { return indexed ? [product("cold", "Royal Beauty Hair Cream")] : []; },
    getSearchIndexReadiness() {
      return { ready: indexed, refreshing: !indexed, productCount: indexed ? 1 : 0, lastSuccessfulSync: null };
    },
    ensureSearchIndexReady() {
      if (!inFlight) {
        imports++;
        inFlight = pending.then(() => {
          indexed = true;
          return 1;
        });
      }
      return inFlight;
    },
    async searchCategory() {
      return { products: indexed ? [product("cold", "Royal Beauty Hair Cream")] : [],
        total: indexed ? 1 : 0, facetCounts: {}, ready: indexed };
    },
  };
  const orchestrator = new SearchOrchestrator(new ProviderRegistry([provider]));
  const request = { query: "beauty_care", category: "beauty_care" as const,
    searchMode: "category_browse" as const };
  const first = orchestrator.searchWithMetadata(request);
  const second = orchestrator.searchWithMetadata(request);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(imports, 1, "concurrent cold requests must share a single import");
  release();
  const responses = await Promise.all([first, second]);
  assert.ok(responses.every((result) => result.categoryInventoryCount === 1));
  assert.ok(responses.every((result) => result.products.length === 1));
});

test("a cold instance reports unavailable rather than a genuine zero when recovery times out", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const provider: SearchProvider = {
    metadata,
    async search() { return []; },
    getSearchIndexReadiness() {
      return { ready: false, refreshing: true, productCount: 0, lastSuccessfulSync: null };
    },
    async refreshIndex() { await pending; return 0; },
    async searchCategory() { return { products: [], total: 0, facetCounts: {}, ready: false }; },
  };
  const orchestrator = new SearchOrchestrator(
    new ProviderRegistry([provider]), undefined, undefined, undefined,
    undefined, undefined, undefined, undefined,
    { providerSearchMs: 50, intentParserMs: 50, braveSearchMs: 50, indexReadinessMs: 20 },
  );
  try {
    await assert.rejects(
      orchestrator.searchWithMetadata({
        query: "beauty_care", category: "beauty_care", searchMode: "category_browse",
      }),
      InventoryUnavailableError,
    );
    await assert.rejects(
      orchestrator.searchWithMetadata({ query: "phone", searchMode: "intent" }),
      InventoryUnavailableError,
    );
  } finally {
    release();
  }
});

test("partial category and search results remain unavailable until every feed index is ready", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let coldReady = false;
  let imports = 0;
  let inFlight: Promise<number> | undefined;
  const availableProduct = {
    ...product("available-hair", "Royal Beauty Hair Cream"),
    category: "Hair Care",
    description: "A leave-in hair care treatment",
  };
  const available: SearchProvider = {
    metadata: { ...metadata, id: "available-catalog" },
    async search() { return [availableProduct]; },
    getSearchIndexReadiness() {
      return { ready: true, productCount: 2, refreshing: false, lastSuccessfulSync: null };
    },
    async searchCategory() {
      return { products: [availableProduct, { ...availableProduct, id: "second-hair", title: "Royal Beauty Hair Serum" }],
        total: 2, facetCounts: {}, ready: true };
    },
  };
  const cold: SearchProvider = {
    metadata: { ...metadata, id: "cold-catalog" },
    async search() { return []; },
    getSearchIndexReadiness() {
      return { ready: coldReady, productCount: 0, refreshing: !coldReady, lastSuccessfulSync: null };
    },
    ensureSearchIndexReady() {
      if (!inFlight) {
        imports++;
        inFlight = pending.then(() => { coldReady = true; return 0; });
      }
      return inFlight;
    },
    async searchCategory() {
      return { products: [], total: 0, facetCounts: {}, ready: coldReady };
    },
  };
  const orchestrator = new SearchOrchestrator(
    new ProviderRegistry([available, cold]), undefined, undefined, undefined,
    undefined, undefined, undefined, undefined,
    { providerSearchMs: 50, intentParserMs: 50, braveSearchMs: 50, indexReadinessMs: 15 },
  );
  const category = {
    query: "الجمال والعناية", category: "beauty_care" as const,
    searchMode: "category_browse" as const,
  };
  try {
    const requests = [
      orchestrator.searchWithMetadata(category),
      orchestrator.searchWithMetadata(category),
      orchestrator.searchWithMetadata({ query: "hair", searchMode: "intent" }),
      new HomeCurationService(orchestrator).getPicks(),
    ];
    const settled = await Promise.allSettled(requests);
    assert.ok(settled.every((result) =>
      result.status === "rejected" && result.reason instanceof InventoryUnavailableError,
    ));
    assert.equal(imports, 1, "concurrent requests share the cold import");
  } finally {
    release();
  }
  await inFlight;
  const genuinelySmall = await orchestrator.searchWithMetadata(category);
  assert.equal(genuinelySmall.categoryInventoryCount, 2);
  assert.equal(genuinelySmall.categoryState, "low");
  assert.equal(genuinelySmall.products.length, 2);
});

test("web fallback cannot certify a search while a relevant feed is unready", async () => {
  const provider: SearchProvider = {
    metadata,
    async search() { return []; },
    getSearchIndexReadiness() {
      return { ready: false, refreshing: false, productCount: 0, lastSuccessfulSync: null };
    },
    async refreshIndex() { return 0; },
  };
  let fallbackCalls = 0;
  const fallback = new BraveWebSearchProvider("test-key", async () => {
    fallbackCalls++;
    return new Response(JSON.stringify({ web: { results: [
      { title: "Phone", url: "https://retailer.example.sa/phone" },
    ] } }), { status: 200 });
  });
  const orchestrator = new SearchOrchestrator(
    new ProviderRegistry([provider]), undefined, undefined, undefined,
    undefined, undefined, fallback, undefined,
    { providerSearchMs: 50, intentParserMs: 50, braveSearchMs: 50, indexReadinessMs: 10 },
  );
  await assert.rejects(
    orchestrator.searchWithMetadata({ query: "phone", searchMode: "intent" }),
    InventoryUnavailableError,
  );
  assert.equal(fallbackCalls, 0);
});

test("a failed category index refresh cannot certify partial inventory from another provider", async () => {
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

  await assert.rejects(
    orchestrator.searchWithMetadata({
      query: "الجمال والعناية",
      category: "beauty_care",
      searchMode: "category_browse",
    }),
    InventoryUnavailableError,
  );
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
  assert.deepEqual(response.products, []);
  assert.equal(response.exactMatches, 0);
  assert.equal(response.constraintRelaxationAvailable, true);
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