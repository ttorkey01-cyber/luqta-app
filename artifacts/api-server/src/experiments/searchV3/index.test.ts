import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync } from "node:zlib";
import { ProviderRegistry } from "../../connectors/providerRegistry";
import { expandShoppingQuery } from "../../connectors/queryExpansion";
import type { ProviderMetadata, ProviderProduct, SearchProvider } from "../../connectors/types";
import {
  ExperimentalSearchV3,
  type MultimodalReranker,
  type RerankContext,
} from "./index";
import { PixelVisualSimilarityAdapter } from "./visual";
import { createImageUrlLoader } from "./visual/urlLoader";

function pngCrc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(name: string, data: Buffer) {
  const type = Buffer.from(name, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(pngCrc32(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, checksum]);
}

function makeLocalPng(color: readonly [number, number, number]) {
  const width = 32;
  const height = 32;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const scanlines = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 3);
    scanlines[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 3;
      scanlines[offset] = color[0];
      scanlines[offset + 1] = color[1];
      scanlines[offset + 2] = color[2];
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

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

test("photo-only search ranks an injected catalog using real local PNG pixels and the safe URL loader", async () => {
  const redPng = makeLocalPng([238, 24, 18]);
  const bluePng = makeLocalPng([18, 34, 238]);
  const providerCalls: string[] = [];
  const registry = new ProviderRegistry([
    provider("official", async () => {
      providerCalls.push("official");
      return [];
    }),
  ]);
  const candidates = [
    product({
      id: "blue-item",
      imageUrl: "https://images.example/blue.png",
      productUrl: "https://shop.example/blue-item",
    }),
    product({
      id: "red-item",
      imageUrl: "https://images.example/red.png",
      productUrl: "https://shop.example/red-item",
    }),
  ];
  const safeLoader = createImageUrlLoader({
    enabled: true,
    allowedHosts: ["images.example"],
    resolveHostname: async () => [{ address: "8.8.8.8", family: 4 }],
    fetch: async (url) =>
      new Response(new Uint8Array(url.endsWith("/red.png") ? redPng : bluePng), {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
  });
  const result = await new ExperimentalSearchV3({
    registry,
    enabled: true,
    photoOnlyCandidatePool: (maxCandidates) => {
      assert.equal(maxCandidates, 100);
      return candidates;
    },
    imageLoader: safeLoader,
    visualAdapter: new PixelVisualSimilarityAdapter(),
  }).search({
    query: "",
    image: { identities: [], imageBytes: redPng },
  });

  assert.deepEqual(providerCalls, []);
  assert.deepEqual(result.diagnostics.sourcesSearched, []);
  assert.equal(result.diagnostics.providerInvocationCount, 0);
  assert.equal(result.diagnostics.passes.length, 0);
  assert.equal(result.diagnostics.photoOnlyDiscovery.status, "available", JSON.stringify(result.diagnostics));
  assert.equal(result.diagnostics.photoOnlyDiscovery.candidateCount, 2);
  assert.equal(result.diagnostics.visual.comparisonsCompleted, 2);
  assert.equal(result.products[0]?.product.id, "red-item");
  assert.equal(result.products[0]?.visualScore, 1);
  assert.ok((result.products[1]?.visualScore ?? 1) < 1);
  assert.ok(result.products.every(({ confidence }) => confidence !== "exact"));
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
  assert.equal(result.products[0]?.confidence, "high");
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

test("visual image evidence reranks candidates and reports component scores without leaking inputs", async () => {
  const candidates = [
    product({
      id: "text-first",
      title: "Nike Air Max Shoes",
      imageUrl: "https://images.example/candidate-a.png",
      productUrl: "https://shop.example/a",
    }),
    product({
      id: "visual-first",
      title: "Nike Air Max Shoes",
      imageUrl: "https://images.example/candidate-b.png",
      productUrl: "https://shop.example/b",
    }),
  ];
  const registry = new ProviderRegistry([
    provider("official", async () => candidates),
  ]);
  let loaderCalls = 0;
  let adapterCalls = 0;
  const referenceBytes = new Uint8Array([11, 12, 13]);
  const result = await new ExperimentalSearchV3({
    registry,
    enabled: true,
    imageLoader: async (url) => {
      loaderCalls += 1;
      return { bytes: new Uint8Array([21]), url };
    },
    visualAdapter: {
      async compareImages(reference, candidate) {
        adapterCalls += 1;
        assert.deepEqual(reference.bytes, referenceBytes);
        return {
          visualScore: candidate.url?.endsWith("candidate-b.png") ? 0.99 : 0.01,
          pixelScore: candidate.url?.endsWith("candidate-b.png") ? 0.99 : 0.01,
        };
      },
    },
  }).search({
    query: "Nike shoes",
    image: { identities: [], imageBytes: referenceBytes, imageUri: "https://private.example/upload?token=secret" },
  });

  assert.equal(result.products[0]?.product.id, "visual-first");
  assert.equal(result.products[0]?.visualStatus, "compared");
  assert.equal(result.products[0]?.visualScore, 0.99);
  assert.ok(result.products[0]?.textScore !== undefined);
  assert.ok(result.products[0]?.identityScore !== undefined);
  assert.equal(result.products[0]?.hybridScore, result.products[0]?.score);
  assert.equal(loaderCalls, 2);
  assert.equal(adapterCalls, 2);
  assert.equal(result.diagnostics.visual.comparisonsAttempted, 2);
  assert.equal(result.diagnostics.visual.comparisonsCompleted, 2);
  assert.equal(result.diagnostics.visual.status, "available");
  assert.ok(result.diagnostics.visual.stageLatencyMs >= 0);
  assert.equal(result.diagnostics.visual.imageLoadCalls, 2);
  assert.equal(result.diagnostics.visual.adapterCallCount, 2);
  assert.equal(result.diagnostics.visual.candidates.length, 2);
  assert.equal(result.diagnostics.visual.candidates[0]?.visualScore, 0.99);
  assert.equal(JSON.stringify(result.diagnostics).includes("secret"), false);
  assert.equal(JSON.stringify(result.diagnostics).includes("imageBytes"), false);
  assert.equal(JSON.stringify(result.diagnostics).includes("candidate-a.png"), false);
});

test("Gemini semantic evidence breaks a local-pixel tie without classifying a lookalike as exact", async () => {
  const result = await new ExperimentalSearchV3({
    registry: new ProviderRegistry([
      provider("official", async () => [
        product({ id: "a", title: "Nike trainer A", imageUrl: "https://images.example/a.png", productUrl: "https://shop.example/a" }),
        product({ id: "b", title: "Nike trainer B", imageUrl: "https://images.example/b.png", productUrl: "https://shop.example/b" }),
      ]),
    ]),
    enabled: true,
    imageLoader: async (url) => ({ bytes: new Uint8Array([1]), url }),
    visualAdapter: {
      async compareImages(_reference, candidate) {
        return {
          pixelScore: 0.5,
          visualScore: 0.5,
          embeddingScore: candidate.url?.endsWith("/b.png") ? 0.99 : 0.01,
        };
      },
    },
  }).search({
    query: "Nike trainer",
    image: { identities: [], imageBytes: new Uint8Array([2]) },
  });
  assert.equal(result.products[0]?.product.id, "b");
  assert.equal(result.products[0]?.embeddingScore, 0.99);
  assert.equal(result.diagnostics.visual.candidates[0]?.embeddingScore, 0.99);
  assert.notEqual(result.products[0]?.confidence, "exact");
});

test("experimental photo-only visual ranking never compares more than its configured 20 candidates", async () => {
  let comparisons = 0;
  const catalog = Array.from({ length: 25 }, (_, index) => product({
    id: `catalog-${index}`,
    title: `Catalog shoe ${index}`,
    productUrl: `https://shop.example/${index}`,
    imageUrl: `https://images.example/${index}.png`,
  }));
  const result = await new ExperimentalSearchV3({
    registry: new ProviderRegistry([]),
    enabled: true,
    photoOnlyCandidatePool: catalog,
    visualRankingOptions: { candidateLimit: 20 },
    imageLoader: async (url) => ({ bytes: new Uint8Array([1]), url }),
    visualAdapter: {
      async compareImages() {
        comparisons += 1;
        return { visualScore: 0.5, pixelScore: 0.5, embeddingScore: 0.5 };
      },
    },
  }).search({ query: "", image: { identities: [], imageBytes: new Uint8Array([2]) } });
  assert.equal(comparisons, 20);
  assert.equal(result.diagnostics.visual.comparisonsAttempted, 20);
  assert.equal(result.diagnostics.visual.imageLoadCalls, 20);
});

test("verified SKU outranks a visually favored lookalike and remains the only eligible product", async () => {
  const registry = new ProviderRegistry([
    provider("official", async () => [
      product({
        id: "sku-match",
        title: "Sony WH-1000XM5 Wireless Headphones",
        brand: "Sony",
        productType: "headphones",
        providerProductId: "WH-1000XM5",
        imageUrl: "https://images.example/exact.png",
        productUrl: "https://audio.example/exact",
      }),
      product({
        id: "lookalike",
        title: "Sony WH-1000XM4 Wireless Headphones",
        brand: "Sony",
        productType: "headphones",
        imageUrl: "https://images.example/lookalike.png",
        productUrl: "https://audio.example/lookalike",
      }),
    ]),
  ]);
  const compared: string[] = [];
  const result = await new ExperimentalSearchV3({
    registry,
    enabled: true,
    imageLoader: async (url) => ({ bytes: new Uint8Array([1]), url }),
    visualAdapter: {
      async compareImages(_reference, candidate) {
        compared.push(candidate.url ?? "");
        return {
          visualScore: candidate.url?.endsWith("lookalike.png") ? 1 : 0,
          pixelScore: candidate.url?.endsWith("lookalike.png") ? 1 : 0,
        };
      },
    },
  }).search({
    query: "Sony headphones SKU WH-1000XM5",
    image: { identities: [], imageBytes: new Uint8Array([2]) },
  });

  assert.deepEqual(result.products.map(({ product: item }) => item.id), ["sku-match"]);
  assert.equal(result.products[0]?.confidence, "exact");
  assert.deepEqual(compared, ["https://images.example/exact.png"]);
});

test("explicit text color remains a hard filter against conflicting visual evidence", async () => {
  const registry = new ProviderRegistry([
    provider("official", async () => [
      product({
        id: "black",
        title: "Nike Air Max 90",
        brand: "Nike",
        productType: "shoes",
        color: "black",
        imageUrl: "https://images.example/black.png",
        productUrl: "https://shop.example/black-visual",
      }),
      product({
        id: "white",
        title: "Nike Air Max 90",
        brand: "Nike",
        productType: "shoes",
        color: "white",
        imageUrl: "https://images.example/white.png",
        productUrl: "https://shop.example/white-visual",
      }),
    ]),
  ]);
  const compared: string[] = [];
  const result = await new ExperimentalSearchV3({
    registry,
    enabled: true,
    imageLoader: async (url) => ({ bytes: new Uint8Array([1]), url }),
    visualAdapter: {
      async compareImages() {
        compared.push("compared");
        return { visualScore: 0.01, pixelScore: 0.01 };
      },
    },
  }).search({
    query: "black Nike shoes",
    image: {
      identities: [{ label: "white Nike Air Max 90", confidence: 0.99, brand: "Nike", model: "Air Max 90", color: "white" }],
      imageBytes: new Uint8Array([2]),
    },
  });

  assert.deepEqual(result.products.map(({ product: item }) => item.id), ["black"]);
  assert.equal(compared.length, 1);
  assert.equal(result.diagnostics.removedByConstraints, 1);
});

test("visual ranking reports explicit unavailability instead of inventing a score", async () => {
  const registry = new ProviderRegistry([
    provider("official", async () => [
      product({
        id: "candidate",
        imageUrl: "https://images.example/candidate.png",
        productUrl: "https://shop.example/candidate",
      }),
    ]),
  ]);
  const missingAdapter = await new ExperimentalSearchV3({ registry, enabled: true }).search({
    query: "Nike shoes",
    image: { identities: [], imageBytes: new Uint8Array([1]) },
  });
  assert.equal(missingAdapter.diagnostics.visual.unavailableReason, "VISUAL_ADAPTER_UNAVAILABLE");
  assert.equal(missingAdapter.products[0]?.visualStatus, "unavailable");
  assert.equal(missingAdapter.products[0]?.visualScore, undefined);

  const missingBytes = await new ExperimentalSearchV3({
    registry,
    enabled: true,
    imageLoader: async (url) => ({ bytes: new Uint8Array([1]), url }),
    visualAdapter: {
      async compareImages() {
        throw new Error("must not compare without uploaded image bytes");
      },
    },
  }).search({ query: "Nike shoes", image: { identities: [] } });
  assert.equal(missingBytes.diagnostics.visual.unavailableReason, "REFERENCE_IMAGE_BYTES_MISSING");
  assert.equal(missingBytes.diagnostics.visual.adapterCallCount, 0);
});

test("strong official results skip unnecessary Brave discovery", async () => {
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

  assert.equal(braveCalls, 0);
  assert.deepEqual(result.diagnostics.sourcesSearched, ["official"]);
  assert.deepEqual(result.diagnostics.passes.map(({ sources }) => sources), [["official"]]);
  assert.ok(result.products.some((item) => item.product.productUrl === "https://merchant.example/item"));
});

test("category routing prioritizes a relevant permitted provider while retaining broad feeds", async () => {
  const calls: string[] = [];
  const registry = new ProviderRegistry([
    provider("general-feed", async () => {
      calls.push("general-feed");
      return [];
    }),
    provider(
      "beauty-specialist",
      async () => {
        calls.push("beauty-specialist");
        return [];
      },
      { priority: 99 },
    ),
  ]);
  const result = await new ExperimentalSearchV3({ registry, enabled: true }).search({
    query: "Dior perfume",
  });

  assert.deepEqual(calls.slice(0, 2), ["beauty-specialist", "general-feed"]);
  assert.deepEqual(result.diagnostics.sourceRouting.relevantProviders, ["beauty-specialist"]);
  assert.deepEqual(result.diagnostics.sourceRouting.broadProviders, ["general-feed"]);
  assert.deepEqual(result.diagnostics.passes[0]?.sources, ["beauty-specialist", "general-feed"]);
});

test("weak first pass uses one alternate-query Brave discovery fallback", async () => {
  let officialCalls = 0;
  let braveRequests = 0;
  const queries: string[] = [];
  const registry = new ProviderRegistry([
    provider("official", async () => {
      officialCalls += 1;
      return [];
    }),
  ]);
  const brave = provider(
    "brave",
    async (request) => {
      queries.push(request.query);
      braveRequests += 1;
      return [
        product({
          id: "discovered",
          title: "Obscure Jeans",
          productUrl: "https://discovery.example/gadget",
          sourceType: "web",
        }),
      ];
    },
    { integrationType: "web_search" },
  ) as SearchProvider & { getUsageMetrics: () => { braveRequests: number } };
  brave.getUsageMetrics = () => ({ braveRequests });
  const result = await new ExperimentalSearchV3({ registry, brave, enabled: true }).search({
    query: "obscure jeans",
  });

  assert.equal(officialCalls, 2);
  assert.equal(queries.length, 1);
  assert.equal(result.diagnostics.passes.length, 2);
  assert.equal(result.diagnostics.passes[0]?.sources.includes("brave"), false);
  assert.equal(result.diagnostics.passes[1]?.sources.includes("brave"), true);
  assert.equal(result.diagnostics.providerInvocationCount, 3);
  assert.equal(result.diagnostics.externalApiCallCount, 1);
  assert.deepEqual(result.diagnostics.sourcesSearched, ["official", "brave"]);
  assert.ok(result.diagnostics.passes[1]?.query !== result.diagnostics.passes[0]?.query);
  assert.equal(result.products[0]?.product.productUrl, "https://discovery.example/gadget");
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

test("same-product cheaper and similar-product cheaper use distinct identity rules", async () => {
  const candidates = [
    product({
      id: "same-model",
      title: "Nike Air Max 90",
      brand: "Nike",
      productType: "shoes",
      price: 300,
      productUrl: "https://shop.example/same-model",
    }),
    product({
      id: "different-model",
      title: "Nike Air Max 270",
      brand: "Nike",
      productType: "shoes",
      price: 250,
      productUrl: "https://shop.example/different-model",
    }),
    product({
      id: "similar-brand",
      title: "Adidas Running Shoes",
      brand: "Adidas",
      productType: "shoes",
      price: 200,
      productUrl: "https://shop.example/similar-brand",
    }),
  ];
  const makeRegistry = () =>
    new ProviderRegistry([provider("official", async () => candidates)]);
  const reference = { brand: "Nike", model: "Air Max 90", price: 450, currency: "SAR" };

  const sameProduct = await new ExperimentalSearchV3({
    registry: makeRegistry(),
    enabled: true,
  }).search({
    query: "cheaper Nike shoes",
    relation: "cheaper",
    reference,
  });
  assert.deepEqual(sameProduct.products.map(({ product: item }) => item.id), ["same-model"]);

  const similarProduct = await new ExperimentalSearchV3({
    registry: makeRegistry(),
    enabled: true,
  }).search({
    query: "similar cheaper shoes",
    relation: "similar_cheaper",
    reference,
  });
  assert.ok(similarProduct.products.some(({ product: item }) => item.id === "similar-brand"));
  assert.ok(!similarProduct.products.some(({ product: item }) => item.id === "same-model"));
  assert.ok(similarProduct.products.every(({ confidence }) => confidence !== "exact"));
});

test("similar-cheaper can relax a high-confidence image reference model", async () => {
  const registry = new ProviderRegistry([
    provider("official", async () => [
      product({
        id: "same-reference-model",
        title: "Nike Air Max 90",
        brand: "Nike",
        productType: "shoes",
        price: 300,
        productUrl: "https://shop.example/reference-model",
      }),
      product({
        id: "different-model",
        title: "Nike Air Max 270",
        brand: "Nike",
        productType: "shoes",
        price: 250,
        productUrl: "https://shop.example/alternative-model",
      }),
    ]),
  ]);
  const result = await new ExperimentalSearchV3({ registry, enabled: true }).search({
    query: "similar cheaper shoes",
    relation: "similar_cheaper",
    reference: { price: 450, currency: "SAR" },
    image: {
      identities: [
        { label: "Nike Air Max 90", confidence: 0.99, brand: "Nike", model: "Air Max 90" },
      ],
    },
  });

  assert.deepEqual(result.products.map(({ product: item }) => item.id), ["different-model"]);
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

test("explicit text color overrides conflicting image color inference", async () => {
  const registry = new ProviderRegistry([
    provider("official", async () => [
      product({
        id: "black",
        title: "Nike Air Max 90",
        brand: "Nike",
        productType: "shoes",
        color: "black",
        productUrl: "https://shop.example/black",
      }),
      product({
        id: "white",
        title: "Nike Air Max 90",
        brand: "Nike",
        productType: "shoes",
        color: "white",
        productUrl: "https://shop.example/white",
      }),
    ]),
  ]);
  const result = await new ExperimentalSearchV3({ registry, enabled: true }).search({
    query: "black Nike shoes",
    image: {
      identities: [
        { label: "white Nike Air Max 90", confidence: 0.99, brand: "Nike", model: "Air Max 90", color: "white" },
      ],
    },
  });

  assert.equal(result.diagnostics.parsedIntent.color, "black");
  assert.deepEqual(result.products.map(({ product: item }) => item.id), ["black"]);
});

test("low-confidence image color hypothesis is retained but not hard-enforced or called exact", async () => {
  const registry = new ProviderRegistry([
    provider("official", async () => [
      product({ id: "black", color: "black", productUrl: "https://shop.example/black-low" }),
      product({ id: "white", color: "white", productUrl: "https://shop.example/white-low" }),
    ]),
  ]);
  const result = await new ExperimentalSearchV3({ registry, enabled: true }).search({
    query: "Nike shoes",
    image: {
      identities: [{ label: "white shoe", confidence: 0.32, color: "white" }],
    },
  });

  assert.equal(result.products.length, 2);
  assert.notEqual(result.products[0]?.confidence, "exact");
  assert.equal(result.diagnostics.parsedIntent.identityHypotheses[0]?.confidence, 0.32);
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

  assert.equal(braveQueries.length, 1);
  assert.match(braveQueries[0] ?? "", /Nike.*Air Zoom/iu);
  assert.equal(result.diagnostics.providerInvocationCount, 1);
  assert.equal(result.diagnostics.externalApiCallCount, 2);
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

test("URL deduplication happens across official sources before ranking", async () => {
  const shared = product({
    id: "shared",
    productUrl: "https://shop.example/shared",
  });
  const registry = new ProviderRegistry([
    provider("feed-a", async () => [shared]),
    provider("feed-b", async () => [{ ...shared, id: "duplicate" }]),
  ]);
  const result = await new ExperimentalSearchV3({ registry, enabled: true }).search({
    query: "Nike shoes",
  });

  assert.equal(result.diagnostics.totalCandidates, 2);
  assert.equal(result.diagnostics.deduplicatedCandidates, 1);
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0]?.product.productUrl, "https://shop.example/shared");
});

test("close-match diversification limits repeated merchants without changing hard eligibility", async () => {
  const registry = new ProviderRegistry([
    provider("catalog", async () => [
      product({
        id: "m1a",
        title: "Running Shoes",
        productType: "shoes",
        merchant: "Merchant One",
        productUrl: "https://one.example/a",
      }),
      product({
        id: "m1b",
        title: "Running Shoes",
        productType: "shoes",
        merchant: "Merchant One",
        productUrl: "https://one.example/b",
      }),
      product({
        id: "m1c",
        title: "Running Shoes",
        productType: "shoes",
        merchant: "Merchant One",
        productUrl: "https://one.example/c",
      }),
      product({
        id: "m2",
        title: "Running Shoes",
        productType: "shoes",
        merchant: "Merchant Two",
        productUrl: "https://two.example/a",
      }),
    ]),
  ]);
  const result = await new ExperimentalSearchV3({ registry, enabled: true }).search({
    query: "uncommon comfortable waterproof lightweight running shoes",
  });

  assert.equal(result.products.length, 4);
  assert.equal(result.products[0]?.product.merchant, "Merchant One");
  assert.equal(result.products[1]?.product.merchant, "Merchant One");
  assert.equal(result.products[2]?.product.merchant, "Merchant Two");
  assert.equal(result.diagnostics.rerankedCandidates, 4);
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

test("reference models and seller-description mentions are not independent exact-identity evidence", async () => {
  const referenceModelRegistry = new ProviderRegistry([
    provider("catalog", async () => [
      product({
        id: "reference-only-model",
        title: "Sony WH-1000XM5 Wireless Headphones",
        brand: "Sony",
        productType: "headphones",
        providerProductId: undefined,
        productUrl: "https://audio.example/reference-only",
      }),
    ]),
  ]);
  const referenceOnly = await new ExperimentalSearchV3({
    registry: referenceModelRegistry,
    enabled: true,
  }).search({
    query: "Sony headphones",
    reference: { brand: "Sony", model: "WH-1000XM5" },
  });
  assert.equal(referenceOnly.products.length, 1);
  assert.notEqual(referenceOnly.products[0]?.confidence, "exact");

  const descriptionRegistry = new ProviderRegistry([
    provider("catalog", async () => [
      product({
        id: "description-model",
        title: "Sony Wireless Headphones",
        description: "Seller notes compatibility with model WH-1000XM5",
        brand: "Sony",
        productType: "headphones",
        providerProductId: undefined,
        productUrl: "https://audio.example/description-model",
      }),
    ]),
  ]);
  const descriptionOnly = await new ExperimentalSearchV3({
    registry: descriptionRegistry,
    enabled: true,
  }).search({ query: "Sony WH-1000XM5 headphones" });

  assert.equal(descriptionOnly.products.length, 1);
  assert.notEqual(descriptionOnly.products[0]?.confidence, "exact");
});