import assert from "node:assert/strict";
import test from "node:test";
import { BraveWebSearchProvider } from "./braveWebSearchProvider";
import { ProviderRegistry } from "./providerRegistry";
import {
  MAX_EXTERNAL_RETRIEVAL_QUERIES,
  planRetrievalQueries,
} from "./retrievalQueryPlanner";
import { SearchOrchestrator } from "./searchOrchestrator";
import type {
  ProviderMetadata,
  ProviderProduct,
  ProviderSearchRequest,
  SearchProvider,
} from "./types";

const metadata: ProviderMetadata = {
  id: "fixture-feed",
  name: "Fixture feed",
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

function feedProvider(
  search: SearchProvider["search"] = async () => [],
): SearchProvider {
  return { metadata, search };
}

function feedProduct(
  id: string,
  title: string,
  fields: Partial<ProviderProduct> = {},
): ProviderProduct {
  return {
    id,
    title,
    currency: "SAR",
    merchant: "Fixture feed",
    availability: "in_stock",
    sourceType: "affiliate_feed",
    exactMatchScore: 1,
    ...fields,
  };
}

function braveWithResults(
  results: Array<{
    title: string;
    url: string;
    description?: string;
  }>,
  observedQueries: string[] = [],
) {
  return new BraveWebSearchProvider("stub-key", async (input) => {
    const requestUrl =
      typeof input === "string" || input instanceof URL ? input : input.url;
    observedQueries.push(new URL(requestUrl).searchParams.get("q") ?? "");
    return new Response(JSON.stringify({ web: { results } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

function orchestrator(
  provider: SearchProvider,
  fallback: BraveWebSearchProvider,
) {
  return new SearchOrchestrator(
    new ProviderRegistry([provider]),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    fallback,
  );
}

test("external retrieval plans deduplicate queries, cap fanout at three, and retain at most 30 candidates", async () => {
  const request: ProviderSearchRequest = {
    query: "Sony WH-1000XM5 wireless headphones",
    intent: {
      raw: "Sony WH-1000XM5 wireless headphones",
      brand: "Sony",
      productType: "headphones",
      currency: "SAR",
    },
  };
  const planned = planRetrievalQueries(request.query, request.intent);
  assert.ok(planned.length > 0);
  assert.ok(planned.length <= MAX_EXTERNAL_RETRIEVAL_QUERIES);
  assert.equal(
    new Set(planned.map((query) => query.normalize("NFKC").toLocaleLowerCase())).size,
    planned.length,
    "planned external query strings should be deduplicated",
  );

  const queries: string[] = [];
  const results = Array.from({ length: 40 }, (_, index) => ({
    title: `Sony WH-1000XM5 wireless headphones ${index}`,
    url: `https://shop.example.sa/products/sony-wh-1000xm5-${index}`,
  }));
  const brave = braveWithResults(results, queries);
  const products = await brave.search(request);

  assert.equal(queries.length, planned.length);
  assert.ok(queries.length <= 3);
  assert.ok(products.length <= 30, "retained web candidates must be bounded");
});

test("Brave URL deduplication ignores tracking and fragments but preserves SKU variants", async () => {
  const brave = braveWithResults([
    {
      title: "Sony WH-1000XM5 wireless headphones",
      url: "https://shop.example.sa/products/headphones?sku=black&utm_source=one#g",
    },
    {
      title: "Sony WH-1000XM5 wireless headphones",
      url: "https://shop.example.sa/products/headphones?sku=black&gclid=click#details",
    },
    {
      title: "Sony WH-1000XM5 wireless headphones",
      url: "https://shop.example.sa/products/headphones?sku=blue&fbclid=click",
    },
  ]);

  const products = await brave.search({ query: "Sony WH-1000XM5 headphones" });
  assert.equal(products.length, 2);
  assert.deepEqual(
    products.map((product) => new URL(product.productUrl!).searchParams.get("sku")).sort(),
    ["black", "blue"],
    "meaningful variant parameters must remain distinct after canonicalization",
  );
});

test("canonical duplicate snippets keep one coherent variant and do not borrow the loser's image", async () => {
  const brave = new BraveWebSearchProvider("stub-key", async () =>
    new Response(
      JSON.stringify({
        web: {
          results: [
            {
              title: "Nike Air Max blue running shoes size 40",
              url: "https://shop.example.sa/products/air-max?utm_source=old",
              thumbnail: { src: "https://images.example.sa/blue-size-40.jpg" },
            },
            {
              title: "Nike Air Max black running shoes size 42",
              url: "https://shop.example.sa/products/air-max?gclid=tracking#variant",
            },
          ],
        },
      }),
      { status: 200 },
    ),
  );

  const products = await brave.search({
    query: "Nike black shoes size 42",
    intent: { raw: "Nike black shoes size 42", brand: "Nike", productType: "shoes" },
  });

  assert.equal(products.length, 1);
  assert.match(products[0]?.title ?? "", /black.*size 42/iu);
  assert.equal(products[0]?.imageUrl, undefined);
});

test("strict phone budget rejects Brave's unknown price without inventing price evidence", async () => {
  const brave = braveWithResults([
    {
      title: "Samsung Galaxy S24 Ultra smartphone",
      url: "https://retailer.example.sa/products/samsung-galaxy-s24-ultra",
      description: "Samsung Galaxy S24 Ultra phone listing",
    },
    {
      title: "Samsung Galaxy S24 Ultra phone case",
      url: "https://retailer.example.sa/products/samsung-galaxy-s24-ultra-case",
    },
  ]);
  const response = await orchestrator(feedProvider(), brave).searchWithMetadata({
    query: "Samsung Galaxy S24 Ultra phone under 1500 SAR",
    intent: {
      raw: "Samsung Galaxy S24 Ultra phone under 1500 SAR",
      productType: "phone",
      brand: "Samsung",
      maxPrice: 1500,
      currency: "SAR",
    },
  });

  assert.deepEqual(response.products, []);
  assert.equal(response.fallbackStatus, "empty");
  assert.ok(brave.getUsageMetrics().braveRequests > 0);
  assert.ok(
    brave.getUsageMetrics().braveRequests <= MAX_EXTERNAL_RETRIEVAL_QUERIES,
  );
});

test("native Arabic phone-under-budget query preserves phone and SAR 1500 in every Brave request", async () => {
  const actualQueries: string[] = [];
  const brave = braveWithResults(
    [
      {
        title: "Android smartphone",
        url: "https://retailer.example.sa/products/android-smartphone",
        description: "Android mobile phone listing",
      },
      {
        title: "Android phone case",
        url: "https://retailer.example.sa/products/android-phone-case",
        description: "Low-cost phone accessory",
      },
    ],
    actualQueries,
  );
  const query = "جوال أقل من 1500 ريال";
  const braveResponse = await orchestrator(feedProvider(), brave).searchWithMetadata({
    query,
  });

  assert.ok(actualQueries.length > 0);
  assert.ok(actualQueries.length <= MAX_EXTERNAL_RETRIEVAL_QUERIES);
  for (const actualQuery of actualQueries) {
    assert.match(actualQuery, /\b(?:phone|smartphone)\b|جوال|هاتف/iu, actualQuery);
    assert.match(actualQuery, /1500\s+SAR/iu, actualQuery);
  }
  assert.equal(braveResponse.structuredIntent?.productType, "phone");
  assert.equal(braveResponse.structuredIntent?.maxPrice, 1500);
  assert.equal(braveResponse.structuredIntent?.currency, "SAR");
  assert.deepEqual(braveResponse.products, []);
  assert.equal(braveResponse.fallbackStatus, "empty");

  const feed = feedProvider(async () => [
    feedProduct("arabic-query-phone", "Android smartphone", {
      productType: "phone",
      price: 1_499,
    }),
    feedProduct("arabic-query-accessory", "Android phone case", {
      productType: "phone accessory",
      price: 20,
    }),
  ]);
  const feedResponse = await new SearchOrchestrator(
    new ProviderRegistry([feed]),
  ).searchWithMetadata({ query });

  assert.deepEqual(
    feedResponse.products.map((product) => product.id),
    ["arabic-query-phone"],
  );
  assert.equal(feedResponse.products[0]?.price, 1_499);
});

test("a credible feed phone price below a strict budget survives while phone accessories do not", async () => {
  const provider = feedProvider(async () => [
    feedProduct("phone-under-budget", "Samsung Galaxy S24 Ultra smartphone", {
      productType: "phone",
      brand: "Samsung",
      price: 1_200,
    }),
    feedProduct("phone-case", "Samsung Galaxy S24 Ultra phone case", {
      productType: "phone accessory",
      brand: "Samsung",
      price: 30,
    }),
  ]);
  const response = await new SearchOrchestrator(
    new ProviderRegistry([provider]),
  ).searchWithMetadata({
    query: "Samsung Galaxy S24 Ultra phone under 1500 SAR",
    intent: {
      raw: "Samsung Galaxy S24 Ultra phone under 1500 SAR",
      productType: "phone",
      brand: "Samsung",
      maxPrice: 1500,
      currency: "SAR",
    },
  });

  assert.deepEqual(response.products.map((product) => product.id), [
    "phone-under-budget",
  ]);
  assert.equal(response.products[0]?.price, 1_200);
  assert.equal(response.exactMatches, 1, "strict-price result count remains part of the existing contract");
});

test("fallback ranks the watch detail listing above a category page for a soft budget", async () => {
  const brave = braveWithResults([
    {
      title: "Guess black watches collection",
      url: "https://guess.example.sa/collections/watches",
    },
    {
      title: "Guess black wrist watch",
      url: "https://guess.example.sa/products/black-wrist-watch-12345",
    },
  ]);
  const response = await orchestrator(feedProvider(), brave).searchWithMetadata({
    query: "Guess black watch around 500 SAR",
    intent: {
      raw: "Guess black watch around 500 SAR",
      brand: "Guess",
      productType: "watch",
      color: "black",
      approximatePrice: 500,
      currency: "SAR",
    },
  });

  assert.equal(response.fallbackStatus, "used");
  assert.match(response.products[0]?.productUrl ?? "", /products\/black-wrist-watch/u);
  assert.ok(response.products.some((product) => /collections\/watches/u.test(product.productUrl ?? "")));
  assert.equal(response.exactMatches, undefined);
});

test("Diesel waist-32 product detail outranks its broad jeans category page", async () => {
  const brave = braveWithResults([
    {
      title: "Diesel men's jeans collection",
      url: "https://diesel.example/collections/jeans",
    },
    {
      title: "Diesel men's jeans waist 32",
      url: "https://diesel.example/products/diesel-jeans-32-12345",
    },
  ]);
  const response = await orchestrator(feedProvider(), brave).searchWithMetadata({
    query: "Diesel jeans waist 32 size 32",
    intent: {
      raw: "Diesel jeans waist 32 size 32",
      brand: "Diesel",
      productType: "jeans",
    },
  });

  assert.equal(response.fallbackStatus, "used");
  assert.match(response.products[0]?.productUrl ?? "", /products\/diesel-jeans-32/u);
  assert.equal(response.exactMatches, undefined);
});

test("an inseam is not mistaken for waist size and an explicitly different waist is rejected", async () => {
  const brave = braveWithResults([
    {
      title: "Diesel jeans waist 34",
      url: "https://diesel.example/products/jeans-waist-34-12345",
    },
    {
      title: "Diesel jeans inseam 32",
      url: "https://diesel.example/products/jeans-inseam-32-12346",
    },
  ]);
  const response = await orchestrator(feedProvider(), brave).searchWithMetadata({
    query: "Diesel jeans waist 32 size 32",
    intent: {
      raw: "Diesel jeans waist 32 size 32",
      brand: "Diesel",
      productType: "jeans",
    },
  });

  assert.ok(
    response.products.every((product) => !/waist[- ]34/u.test(product.title)),
    "a conflicting waist size must be removed",
  );
  assert.ok(
    response.products.some((product) => /inseam 32/u.test(product.title)),
    "an inseam alone is unknown size evidence, not a false waist-32 match",
  );
});

test("Nike EU 42 is accepted as footwear while a 42 mm watch result is rejected", async () => {
  const brave = braveWithResults([
    {
      title: "Nike Air Max running shoes EU 42",
      url: "https://nike.example.sa/products/air-max-eu-42-12345",
    },
    {
      title: "Nike 42 mm watch",
      url: "https://shop.example.sa/products/nike-watch-42mm",
    },
  ]);
  const response = await orchestrator(feedProvider(), brave).searchWithMetadata({
    query: "Nike shoes size 42",
    intent: {
      raw: "Nike shoes size 42",
      brand: "Nike",
      productType: "shoes",
    },
  });

  assert.ok(response.products.some((product) => /Air Max/u.test(product.title)));
  assert.ok(
    response.products.every((product) => !/42 mm watch/u.test(product.title)),
  );
});

test("strict black-bag intent rejects unrelated Brave results without an identity claim", async () => {
  const brave = braveWithResults([
    {
      title: "Black handbag",
      url: "https://bags.example.sa/products/black-handbag-12345",
    },
    {
      title: "Black shampoo",
      url: "https://beauty.example.sa/products/black-shampoo",
    },
  ]);
  const response = await orchestrator(feedProvider(), brave).searchWithMetadata({
    query: "شنطة سوداء",
    intent: { raw: "شنطة سوداء", productType: "handbag", color: "black" },
  });

  assert.ok(response.products.length > 0);
  assert.ok(response.products.every((product) => /handbag/u.test(product.title)));
  assert.equal(response.exactMatches, undefined);
});

test("every actual Brave query preserves the complete iPhone model", async () => {
  const actualQueries: string[] = [];
  const brave = braveWithResults(
    [
      {
        title: "Apple iPhone 15 Pro Max",
        url: "https://shop.example.sa/products/iphone-15-pro-max-256gb",
      },
    ],
    actualQueries,
  );
  const response = await orchestrator(feedProvider(), brave).searchWithMetadata({
    query: "iPhone 15 Pro Max",
  });

  assert.ok(actualQueries.length > 0);
  assert.ok(actualQueries.length <= MAX_EXTERNAL_RETRIEVAL_QUERIES);
  for (const query of actualQueries) {
    assert.match(query, /iPhone\s+15\s+Pro\s+Max/iu, query);
  }
  assert.ok(response.products.length > 0);
  assert.equal(response.exactMatches, undefined);
});

test("an impossible distinctive SKU stays in every fallback query and yields no generic false match", async () => {
  const actualQueries: string[] = [];
  const brave = braveWithResults(
    [
      {
        title: "Purple seventeen-handle toaster",
        url: "https://shop.example.sa/products/purple-toaster",
      },
    ],
    actualQueries,
  );
  const response = await orchestrator(feedProvider(), brave).searchWithMetadata({
    query: "QZVTR-999 seventeen-handle purple toaster",
  });

  assert.ok(actualQueries.length > 0);
  assert.ok(actualQueries.every((query) => query.includes("QZVTR-999")));
  assert.deepEqual(response.products, []);
  assert.equal(response.fallbackStatus, "empty");
  assert.equal(response.exactMatches, undefined);
});

test("category browsing and explicit safety gates never invoke Brave fallback", async () => {
  const brave = braveWithResults([
    {
      title: "Black handbag",
      url: "https://bags.example.sa/products/black-handbag",
    },
  ]);
  const search = orchestrator(feedProvider(), brave);
  const browseResponse = await search.searchWithMetadata({
    query: "bags",
    category: "bags_accessories",
  });
  assert.equal(brave.getUsageMetrics().braveRequests, 0);
  assert.equal(browseResponse.fallbackStatus, "not_needed");

  await search.searchWithMetadata({
    query: "black handbag",
    imageUri: "data:image/png;base64,ZmFrZQ==",
  });
  await search.searchWithMetadata({
    query: "black handbag",
    preferredProviderIds: ["fixture-feed"],
  });
  assert.equal(brave.getUsageMetrics().braveRequests, 0);
});

test("public search metadata keeps its existing contract and never exposes an EXACT identity claim", async () => {
  const brave = braveWithResults([
    {
      title: "Samsung Galaxy S24 Ultra smartphone",
      url: "https://shop.example.sa/products/galaxy-s24-ultra-12345",
    },
  ]);
  const response = await orchestrator(feedProvider(), brave).searchWithMetadata({
    query: "Samsung Galaxy S24 Ultra",
  });

  assert.equal(response.exactMatches, undefined);
  assert.deepEqual(
    Object.keys(response).sort(),
    [
      "fallbackStatus",
      "products",
      "strongInternalMatchCount",
      "structuredIntent",
    ].sort(),
    "the regression must not add API response fields",
  );
});