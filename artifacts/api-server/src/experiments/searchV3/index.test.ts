import assert from "node:assert/strict";
import test from "node:test";
import { ProviderRegistry } from "../../connectors/providerRegistry";
import { expandShoppingQuery } from "../../connectors/queryExpansion";
import type { ProviderMetadata, ProviderProduct, SearchProvider } from "../../connectors/types";
import {
  ExperimentalSearchV3,
  type MultimodalReranker,
  type RerankContext,
} from "./index";

function provider(
  id: string,
  search: SearchProvider["search"],
  overrides: Partial<ProviderMetadata> = {},
): SearchProvider {
  return {
    metadata: {
      id,
      name: id,
      enabled: true,
      searchEnabled: true,
      affiliateEnabled: false,
      priceMonitoringAllowed: false,
      visualSearchAllowed: false,
      country: "SA",
      currency: "SAR",
      integrationType: "mock_local",
      requiresCredentials: false,
      credentialRequirements: [],
      priority: 1,
      lastSuccessfulSync: null,
      affiliateCapability: "not_applicable",
      priceMonitoringCapability: "disabled",
      integrationStatus: "ready",
      ...overrides,
    },
    search,
  };
}

function product(overrides: Partial<ProviderProduct> = {}): ProviderProduct {
  return {
    id: "p1",
    title: "Nike Air Max 90",
    brand: "Nike",
    productType: "shoes",
    color: "black",
    price: 450,
    currency: "SAR",
    condition: "new",
    availability: "in_stock",
    productUrl: "https://shop.example/p1?sku=123",
    sourceType: "feed",
    ...overrides,
  };
}

test("V3 is disabled by default and performs no provider searches", async () => {
  let calls = 0;
  const registry = new ProviderRegistry([
    provider("official", async () => {
      calls += 1;
      return [product()];
    }),
  ]);
  const result = await new ExperimentalSearchV3({ registry }).search({ query: "black Nike shoes" });

  assert.equal(calls, 0);
  assert.equal(result.products.length, 0);
  assert.equal(result.diagnostics.enabled, false);
  assert.equal(result.diagnostics.externalApiCallCount, 0);
  assert.equal(result.diagnostics.providerInvocationCount, 0);
});

test("an explicitly named catalog brand and product category exclude unrelated matches", async () => {
  const registry = new ProviderRegistry([
    provider("official", async () => [
      product({
        id: "coach",
        title: "Coach Tabby Black Handbag",
        brand: "Coach",
        category: "bags_accessories",
        color: "black",
        productUrl: "https://shop.example/coach",
      }),
      product({
        id: "zara",
        title: "Zara Black Handbag",
        brand: "Zara",
        category: "bags_accessories",
        color: "black",
        productUrl: "https://shop.example/zara",
      }),
      product({
        id: "camera",
        title: "Black Camera",
        brand: "Sony",
        category: "electronics",
        color: "black",
        productUrl: "https://shop.example/camera",
      }),
    ]),
  ]);
  const result = await new ExperimentalSearchV3({ registry, enabled: true }).search({
    query: "black Coach handbag",
  });
  assert.deepEqual(result.products.map(({ product }) => product.id), ["coach"]);
  assert.equal(result.diagnostics.parsedIntent.brand, "Coach");
});

test("explicit color, price, and condition constraints are enforced and URLs preserved", async () => {
  const registry = new ProviderRegistry([
    provider("official", async () => [
      product(),
      product({
        id: "red",
        title: "Nike Air Max 90",
        color: "red",
        price: 400,
        productUrl: "https://shop.example/red",
      }),
      product({ id: "expensive", color: "black", price: 501, productUrl: "https://shop.example/expensive" }),
      product({
        id: "unknown-condition",
        color: "black",
        condition: "unknown",
        productUrl: "https://shop.example/unknown",
      }),
      product({
        id: "unknown-currency",
        color: "black",
        currency: undefined,
        productUrl: "https://shop.example/unknown-currency",
      }),
      product({
        id: "wrong-currency",
        color: "black",
        currency: "USD",
        productUrl: "https://shop.example/wrong-currency",
      }),
    ]),
  ]);
  const result = await new ExperimentalSearchV3({ registry, enabled: true }).search({
    query: "new black Nike shoes under 500 SAR",
  });

  assert.equal(result.products.length, 1);
  assert.equal(result.products[0]?.product.productUrl, "https://shop.example/p1?sku=123");
  assert.equal(result.diagnostics.removedByConstraints, 5);
  assert.equal(result.products[0]?.confidence, "close");
});

test("uses a single second pass when the first pass has weak candidates", async () => {
  const searches: string[] = [];
  const registry = new ProviderRegistry([
    provider("official", async (request) => {
      searches.push(request.query);
      return [];
    }),
  ]);
  const result = await new ExperimentalSearchV3({ registry, enabled: true }).search({
    query: "rare item",
    image: {
      identities: [{ label: "rare item", confidence: 0.6 }],
      description: "unusual blue object",
    },
  });

  assert.equal(searches.length, 2);
  assert.equal(result.diagnostics.passes.length, 2);
  assert.equal(result.diagnostics.providerInvocationCount, 2);
  assert.equal(result.diagnostics.externalApiCallCount, 0);
});

test("passes image inputs to an injected reranker without putting them in diagnostics", async () => {
  let receivedContext: RerankContext | undefined;
  const reranker: MultimodalReranker = {
    async rerank(context, candidates) {
      receivedContext = context;
      return candidates.map((item) => ({
        product: item,
        score: 0.7,
        reasons: ["Injected visual rank"],
      }));
    },
  };
  const registry = new ProviderRegistry([
    provider("official", async () => [product()]),
  ]);
  const result = await new ExperimentalSearchV3({ registry, reranker, enabled: true }).search({
    query: "shoes",
    image: {
      identities: [{ label: "shoe", confidence: 0.7 }],
      imageUri: "https://images.example/private-image",
      description: "black running shoe",
    },
  });

  assert.equal(receivedContext?.request.image?.imageUri, "https://images.example/private-image");
  assert.equal(JSON.stringify(result.diagnostics).includes("private-image"), false);
  assert.equal(result.products[0]?.reasons[0], "Injected visual rank");
});

test("Brave discovery is separate and does not override product destination URLs", async () => {
  let braveCalls = 0;
  const official = provider("official", async () => [
    product({ id: "official", productUrl: "https://merchant.example/item" }),
  ]);
  const brave = provider(
    "brave",
    async () => {
      braveCalls += 1;
      return [product({ id: "web", productUrl: "https://discovered.example/item", sourceType: "web" })];
    },
    { integrationType: "web_search" },
  );
  const registry = new ProviderRegistry([official]);
  const result = await new ExperimentalSearchV3({
    registry,
    brave,
    enabled: true,
  }).search({ query: "Nike shoes" });

  assert.equal(braveCalls, 1);
  assert.deepEqual(result.diagnostics.sourcesSearched, ["official", "brave"]);
  assert.ok(result.products.some((item) => item.product.productUrl === "https://discovered.example/item"));
});

test("cheaper relation requires reference brand and model and a lower price", async () => {
  const registry = new ProviderRegistry([
    provider("official", async () => [
      product({ id: "cheaper", price: 300, productUrl: "https://shop.example/cheaper" }),
      product({ id: "same-price", price: 450, productUrl: "https://shop.example/same" }),
      product({
        id: "wrong-model",
        title: "Nike Air Max 95",
        price: 250,
        productUrl: "https://shop.example/wrong-model",
      }),
      product({
        id: "wrong-brand",
        title: "Adidas Air Max 90",
        brand: "Adidas",
        price: 250,
        productUrl: "https://shop.example/wrong-brand",
      }),
      product({
        id: "unknown-currency",
        price: 250,
        currency: undefined,
        productUrl: "https://shop.example/unknown-currency",
      }),
      product({
        id: "wrong-currency",
        price: 250,
        currency: "USD",
        productUrl: "https://shop.example/wrong-currency",
      }),
    ]),
  ]);
  const result = await new ExperimentalSearchV3({ registry, enabled: true }).search({
    query: "cheaper",
    relation: "cheaper",
    reference: { brand: "Nike", model: "Air Max 90", price: 450, currency: "SAR" },
  });

  assert.deepEqual(result.products.map(({ product: item }) => item.id), ["cheaper"]);
  assert.equal(result.diagnostics.removedByConstraints, 5);
});

test("different-color relation matches the reference product without enforcing inferred target color", async () => {
  const registry = new ProviderRegistry([
    provider("official", async () => [
      product({ id: "red", color: "red", productUrl: "https://shop.example/red" }),
      product({ id: "same", color: "black", productUrl: "https://shop.example/same" }),
      product({
        id: "different-model",
        title: "Nike Air Max 95",
        color: "red",
        productUrl: "https://shop.example/different-model",
      }),
    ]),
  ]);
  const result = await new ExperimentalSearchV3({ registry, enabled: true }).search({
    query: "different color",
    relation: "different_color",
    reference: { brand: "Nike", model: "Air Max 90", color: "black" },
    image: { identities: [{ label: "shoe", confidence: 0.55, color: "blue" }] },
  });

  assert.deepEqual(result.products.map(({ product: item }) => item.id), ["red"]);
  assert.equal(result.diagnostics.removedByConstraints, 2);
});

test("explicit location and automotive part/model/SKU constraints require verified product fields", async () => {
  const locationRegistry = new ProviderRegistry([
    provider("location", async () => [
      product({ id: "riyadh", location: "Riyadh", productUrl: "https://shop.example/riyadh" }),
      product({ id: "jeddah", location: "Jeddah", productUrl: "https://shop.example/jeddah" }),
      product({ id: "unknown", location: undefined, productUrl: "https://shop.example/unknown-location" }),
    ]),
  ]);
  const locationResult = await new ExperimentalSearchV3({
    registry: locationRegistry,
    enabled: true,
  }).search({ query: "shoes in Riyadh" });
  assert.deepEqual(locationResult.products.map(({ product: item }) => item.id), ["riyadh"]);
  assert.equal(locationResult.diagnostics.parsedIntent.location, "Riyadh");

  const automotiveRegistry = new ProviderRegistry([
    provider("parts", async () => [
      product({
        id: "matching-part",
        title: "Toyota RAV4 2018 Headlight 81150-06C10",
        brand: "Toyota",
        productType: "headlight",
        providerProductId: "81150-06C10",
        productUrl: "https://parts.example/match",
      }),
      product({
        id: "wrong-part",
        title: "Toyota RAV4 2018 Headlight 81150-06C11",
        brand: "Toyota",
        productType: "headlight",
        providerProductId: "81150-06C11",
        productUrl: "https://parts.example/wrong",
      }),
      product({
        id: "wrong-model",
        title: "Toyota Corolla 2018 Headlight 81150-06C10",
        brand: "Toyota",
        productType: "headlight",
        providerProductId: "81150-06C10",
        productUrl: "https://parts.example/wrong-model",
      }),
    ]),
  ]);
  const automotiveResult = await new ExperimentalSearchV3({
    registry: automotiveRegistry,
    enabled: true,
  }).search({ query: "Toyota model RAV4 2018 headlight SKU 81150-06C10" });

  assert.deepEqual(automotiveResult.products.map(({ product: item }) => item.id), ["matching-part"]);
  assert.equal(automotiveResult.diagnostics.removedByConstraints, 2);
});

test("searches alternate image identities as separate bounded passes and uses existing bilingual expansion", async () => {
  const queries: string[] = [];
  const registry = new ProviderRegistry([
    provider("official", async (request) => {
      queries.push(request.query);
      assert.equal(request.intent?.raw, request.query);
      return [];
    }),
  ]);
  const result = await new ExperimentalSearchV3({ registry, enabled: true }).search({
    query: "",
    image: {
      identities: [
        { label: "first frame", brand: "Brand A", confidence: 0.9 },
        { label: "second frame", brand: "Brand B", confidence: 0.8 },
      ],
    },
  });
  assert.equal(queries.length, 2);
  assert.equal(queries[0], "Brand A first frame");
  assert.equal(queries[1], "Brand B second frame");
  assert.equal(result.diagnostics.passes.length, 2);

  queries.length = 0;
  const expansionResult = await new ExperimentalSearchV3({
    registry,
    enabled: true,
  }).search({ query: "sunglasses" });
  const expectedExpansion = expandShoppingQuery("sunglasses").variants.find(
    (variant) => variant !== "sunglasses",
  );

  assert.equal(queries.length, 2);
  assert.ok(expectedExpansion);
  assert.ok(expansionResult.diagnostics.generatedQueries.includes(expectedExpansion));
});

test("image-only Brave discovery uses identity text and reports only measured Brave HTTP requests", async () => {
  const braveQueries: string[] = [];
  let braveRequests = 0;
  const brave = provider(
    "brave",
    async (request) => {
      braveQueries.push(request.query);
      assert.equal(request.imageUri, undefined);
      assert.ok(request.intent?.raw);
      braveRequests += 2;
      return [];
    },
    { integrationType: "web_search" },
  ) as SearchProvider & { getUsageMetrics: () => { braveRequests: number } };
  brave.getUsageMetrics = () => ({ braveRequests });
  const registry = new ProviderRegistry([]);
  const result = await new ExperimentalSearchV3({ registry, brave, enabled: true }).search({
    query: "",
    image: {
      identities: [{ label: "silver running shoe", brand: "Nike", model: "Air Zoom", confidence: 0.91 }],
      imageUri: "https://images.example/do-not-forward",
    },
  });

  assert.equal(braveQueries.length, 2);
  assert.match(braveQueries[0] ?? "", /Nike.*Air Zoom/u);
  assert.equal(result.diagnostics.providerInvocationCount, 2);
  assert.equal(result.diagnostics.externalApiCallCount, 4);
  assert.deepEqual(result.diagnostics.sourcesSearched, ["brave"]);
  assert.equal(JSON.stringify(result.diagnostics).includes("do-not-forward"), false);
});

test("V3 intent retains bilingual attributes, visible text, and uncertain image hypotheses", async () => {
  const registry = new ProviderRegistry([
    provider("official", async () => []),
  ]);
  const result = await new ExperimentalSearchV3({ registry, enabled: true }).search({
    query: "أبحث عن Nike shoes جلد أسود للنساء",
    image: {
      identities: [
        { label: "black leather sneaker", confidence: 0.48, brand: "Nike", color: "black" },
        { label: "dark running shoe", confidence: 0.31, brand: "Adidas", color: "navy" },
      ],
      extractedText: "NIKE AIR\nMADE IN ITALY",
      description: "A leather shoe with a dark upper",
      imageUri: "https://images.example/private",
    },
  });
  const intent = result.diagnostics.parsedIntent;

  assert.equal(intent.material, "leather");
  assert.ok(intent.visibleText.includes("NIKE AIR"));
  assert.ok(intent.attributes.includes("leather"));
  assert.ok(intent.attributes.includes("black"));
  assert.equal(intent.identityHypotheses.length, 2);
  assert.equal(intent.identityHypotheses[1]?.confidence, 0.31);
  assert.ok(intent.confidence > 0 && intent.confidence < 1);
  assert.equal(JSON.stringify(result.diagnostics).includes("private"), false);
});

test("inferred material attributes affect ranking without becoming strict filters", async () => {
  const registry = new ProviderRegistry([
    provider("official", async () => [
      product({
        id: "leather",
        title: "Running Shoes",
        description: "Leather upper",
        productUrl: "https://shoes.example/leather",
      }),
      product({
        id: "mesh",
        title: "Running Shoes",
        description: "Breathable mesh upper",
        productUrl: "https://shoes.example/mesh",
      }),
    ]),
  ]);
  const result = await new ExperimentalSearchV3({ registry, enabled: true }).search({
    query: "running shoes",
    image: {
      identities: [],
      description: "Leather upper",
    },
  });

  assert.equal(result.products.length, 2);
  assert.equal(result.products[0]?.product.id, "leather");
  assert.equal(result.diagnostics.parsedIntent.material, "leather");
});

test("verified typed SKU may be exact only with brand and product-type corroboration", async () => {
  const registry = new ProviderRegistry([
    provider("official", async () => [
      product({
        id: "headphones",
        title: "Sony WH-1000XM5 Wireless Headphones",
        brand: "Sony",
        productType: "headphones",
        providerProductId: "WH-1000XM5",
        productUrl: "https://audio.example/headphones",
      }),
      product({
        id: "case",
        title: "Sony WH-1000XM5 Headphone Case",
        brand: "Sony",
        productType: "headphone case",
        providerProductId: "WH-1000XM5",
        productUrl: "https://audio.example/case",
      }),
    ]),
  ]);
  const result = await new ExperimentalSearchV3({ registry, enabled: true }).search({
    query: "Sony WH-1000XM5 headphones",
  });

  assert.equal(result.products[0]?.product.id, "headphones");
  assert.equal(result.products[0]?.confidence, "exact");
  assert.notEqual(
    result.products.find(({ product: item }) => item.id === "case")?.confidence,
    "exact",
  );
});

test("unknown text model without corroborated brand is never classified exact", async () => {
  const registry = new ProviderRegistry([
    provider("official", async () => [
      product({
        id: "unknown-model",
        title: "Acme ZX-9999 Phone",
        brand: "Acme",
        productType: "phone",
        productUrl: "https://devices.example/unknown",
      }),
    ]),
  ]);
  const result = await new ExperimentalSearchV3({ registry, enabled: true }).search({
    query: "Acme ZX-9999 phone",
  });

  assert.equal(result.products.length, 1);
  assert.notEqual(result.products[0]?.confidence, "exact");
});