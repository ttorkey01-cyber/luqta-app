import assert from "node:assert/strict";
import test from "node:test";
import { ProviderRegistry } from "../../../connectors/providerRegistry";
import type { NormalizedProduct, ProviderSearchRequest, SearchProvider } from "../../../connectors/types";
import type { V3Diagnostics, V3Request } from "../index";
import {
  runBenchmark30,
  type Benchmark30RunnerDependencies,
} from "./liveRunner";
import { SEARCH_V3_BENCHMARK_30 } from "./groundTruth";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

function feedProvider(options: {
  id?: string;
  initialReady?: boolean;
  ensure?: () => Promise<number>;
} = {}): SearchProvider {
  let ready = options.initialReady ?? true;
  return {
    metadata: {
      id: options.id ?? "fixture-feed",
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
    },
    search: async () => [],
    getSearchIndexReadiness: () => ({
      ready,
      productCount: ready ? 3 : 0,
      refreshing: false,
      lastSuccessfulSync: ready ? "2026-01-01T00:00:00.000Z" : null,
    }),
    ensureSearchIndexReady: async () => {
      const count = await (options.ensure?.() ?? Promise.resolve(3));
      ready = true;
      return count;
    },
  };
}

function readySourceRegistry() {
  return new ProviderRegistry([feedProvider()]);
}

function diagnostics(overrides: Partial<V3Diagnostics["visual"]> = {}): V3Diagnostics {
  return {
    enabled: true,
    parsedIntent: {} as V3Diagnostics["parsedIntent"],
    generatedQueries: [],
    selectedQueries: [],
    sourceRouting: { relevantProviders: [], broadProviders: [] },
    sourcesSearched: [],
    resultCountPerSource: {},
    totalCandidates: 0,
    deduplicatedCandidates: 0,
    removedByConstraints: 0,
    rerankedCandidates: 0,
    confidenceScores: [],
    visual: {
      status: "unavailable",
      unavailableReason: "VISUAL_ADAPTER_UNAVAILABLE",
      candidates: [],
      stageLatencyMs: 0,
      comparisonsAttempted: 0,
      comparisonsCompleted: 0,
      comparisonsFailed: 0,
      imageLoadCalls: 0,
      adapterCallCount: 0,
      ...overrides,
    },
    photoOnlyDiscovery: { status: "not_requested", candidateCount: 0, eligibleCount: 0 },
    passes: [],
    stageLatencyMs: {
      intentParsing: 0,
      queryExpansion: 0,
      sourceRouting: 0,
      firstPass: 0,
      secondPass: 0,
      reranking: 0,
      photoOnlyCatalog: 0,
    },
    totalLatencyMs: 0,
    providerInvocationCount: 0,
    externalApiCallCount: 0,
  };
}

function mockDependencies(
  observed: { v2: ProviderSearchRequest[]; v3: V3Request[]; geminiCalls: number },
  unsafeVisual = false,
): Benchmark30RunnerDependencies {
  return {
    sourceRegistry: readySourceRegistry(),
    fetchQueryImage: async () => new Response(JPEG, {
      status: 200,
      headers: { "content-type": "image/jpeg", "content-length": String(JPEG.length) },
    }),
    interpretV2Image: async () => ({
      primaryCandidate: {
        name: "shoe",
        query: "shoe",
        confidence: 0.99,
        productType: "shoe",
        brand: null,
        color: "black",
        attributes: [],
      },
      alternatives: [],
      confidence: 0.99,
      needsConfirmation: false,
    }),
    interpretGeminiImage: async () => {
      observed.geminiCalls += 1;
      return {
        category: "shoe",
        productType: "casual low-top sneaker",
        brand: null,
        model: null,
        color: "dark",
        style: "casual",
        material: null,
        attributes: ["white sole"],
        extractedText: [],
        uncertainty: [],
        confidence: 0.8,
        description: "A dark casual sneaker.",
        v3Image: {
          identities: [{ label: "casual low-top sneaker", confidence: 0.8, brand: "unverified", model: "unverified" }],
          description: "A dark casual sneaker.",
          extractedText: "",
        },
      };
    },
    searchV2: async (request) => {
      observed.v2.push(request);
      return { products: [], fallbackStatus: "empty", providerTimings: [] };
    },
    searchV3: async (request) => {
      observed.v3.push(request);
      return {
        products: [],
        diagnostics: diagnostics(unsafeVisual ? { imageLoadCalls: 1 } : {}),
      };
    },
  };
}

function options(dependencies: Benchmark30RunnerDependencies) {
  return {
    geminiApiKey: "injected-test-key",
    openAiApiKey: "injected-test-key",
    openAiBaseUrl: "https://test.invalid/v1",
    dependencies,
  };
}

test("live runner returns all 30 cases, freezes the two image exclusions, and caps Gemini to permitted query images", async () => {
  const observed = { v2: [] as ProviderSearchRequest[], v3: [] as V3Request[], geminiCalls: 0 };
  const report = await runBenchmark30(options(mockDependencies(observed)));

  assert.equal(report.cases.length, 30);
  assert.equal(report.caseCount, 30);
  assert.equal(report.unscorableCaseCount, 2);
  assert.deepEqual(report.prewarm.cohortProviderIds, ["fixture-feed"]);
  assert.equal(report.prewarm.providers[0]?.status, "ready");
  assert.ok(report.prewarm.durationMs >= 0);
  assert.equal(report.candidateImageCalls, 0);
  assert.equal(report.automaticScoring, false);
  assert.equal(report.geminiMetrics.queryImageCalls, 9);
  assert.equal(report.geminiMetrics.candidateImageCalls, 0);
  assert.equal(observed.geminiCalls, 9);
  assert.equal(observed.v2.length, 28);
  assert.equal(observed.v3.length, 56);
  assert.equal(report.cases.filter((record) => record.v2.status === "unscorable").length, 2);
  assert.ok(report.cases.filter((record) => record.scorable).every((record) =>
    record.v2.status === "success" &&
    record.v3Local.status === "success" &&
    record.v3Gemini.status === "success",
  ));
  assert.equal(report.cases.filter((record) => record.v3Gemini.status === "unscorable").length, 2);
  assert.ok(report.cases.some((record) =>
    record.caseId === "b30-auto-camry-headlamp" &&
    record.unscorableReason?.includes("fitment"),
  ));
});

test("runner supplies only local query-image bytes to V3 and strips all candidate image URLs from output", async () => {
  const observed = { v2: [] as ProviderSearchRequest[], v3: [] as V3Request[], geminiCalls: 0 };
  const imageBearingProduct = {
    id: "p1",
    title: "Example product",
    imageUrl: "https://merchant.invalid/product.jpg",
    providerProductId: "one",
    availability: "in_stock",
    sourceType: "fixture",
    canonical: { imageUrl: "https://merchant.invalid/canonical.jpg" },
    providerId: "fixture",
    providerName: "Fixture",
    isAffiliate: false,
    rankScore: 0,
    priceScore: 0,
    availabilityScore: 0,
    conditionScore: 0,
    locationScore: 0,
  } as unknown as NormalizedProduct;
  const dependencies = mockDependencies(observed);
  dependencies.searchV2 = async (request) => {
    observed.v2.push(request);
    return { products: [imageBearingProduct] };
  };
  const report = await runBenchmark30({ ...options(dependencies), limit: 8 });

  const textImageRequest = observed.v3.find((request) => request.image?.imageBytes);
  assert.ok(textImageRequest);
  assert.deepEqual(Object.keys(textImageRequest.image ?? {}).sort(), ["identities", "imageBytes", "mimeType"]);
  assert.deepEqual(textImageRequest.image?.identities, []);
  assert.ok(observed.v3.every((request) => request.image?.imageUri === undefined));
  assert.ok(report.cases.flatMap((record) => record.v2.products ?? []).every((product) =>
    !("imageUrl" in product) && !("canonical" in product),
  ));
  assert.equal(report.cases.length, 30);
  assert.equal(report.cases[0]?.v2.status, "success");
  assert.equal(report.cases[8]?.v2.status, "not_attempted");
  assert.equal(report.cases[0]?.v3Gemini.status, "success");
});

test("V3 image diagnostics fail closed if any candidate image load or adapter call occurs", async () => {
  const observed = { v2: [] as ProviderSearchRequest[], v3: [] as V3Request[], geminiCalls: 0 };
  await assert.rejects(
    () => runBenchmark30(options(mockDependencies(observed, true))),
    /no-candidate-image safety invariant/u,
  );
});

test("image download rejects invalid formats and marks the case unscorable", async () => {
  const observed = { v2: [] as ProviderSearchRequest[], v3: [] as V3Request[], geminiCalls: 0 };
  const dependencies = mockDependencies(observed);
  dependencies.fetchQueryImage = async () => new Response(new Uint8Array([1, 2, 3, 4]), {
    status: 200,
    headers: { "content-type": "image/jpeg" },
  });
  const report = await runBenchmark30({ ...options(dependencies), limit: 8 });
  const row = report.cases[7]!;

  assert.equal(row.queryImage.available, false);
  assert.match(row.queryImage.error ?? "", /validated JPEG/u);
  assert.equal(row.scorable, false);
  assert.equal(row.v2.status, "unscorable");
  assert.equal(row.v2.products, null);
  assert.equal(row.v3Local.status, "unscorable");
  assert.equal(row.v3Gemini.status, "unscorable");
  assert.equal(observed.geminiCalls, 0);
  assert.equal(report.unscorableCaseCount, 3);
});

test("explicit dry-run limit preserves every frozen case and clearly marks the rest unattempted", async () => {
  const observed = { v2: [] as ProviderSearchRequest[], v3: [] as V3Request[], geminiCalls: 0 };
  const report = await runBenchmark30({ ...options(mockDependencies(observed)), limit: 2 });

  assert.equal(report.cases.length, 30);
  assert.equal(report.attemptedCaseCount, 2);
  assert.equal(report.cases[2]?.v2.status, "not_attempted");
  assert.equal(report.cases.filter((record) => record.v2.status === "unscorable").length, 2);
  assert.equal(observed.v2.length, 2);
  assert.equal(observed.v3.length, 4);
  assert.equal(observed.geminiCalls, 0);
});

test("prewarm settles cold feeds before searches and freezes one ready provider cohort for all arms", async () => {
  const observed = { v2: [] as ProviderSearchRequest[], v3: [] as V3Request[], geminiCalls: 0 };
  let prewarmCalls = 0;
  const cold = feedProvider({
    id: "cold-feed",
    initialReady: false,
    ensure: async () => {
      prewarmCalls += 1;
      return 11;
    },
  });
  const mock = feedProvider({ id: "mock-local" });
  mock.metadata.integrationType = "mock_local";
  let mockPrewarmCalls = 0;
  mock.ensureSearchIndexReady = async () => {
    mockPrewarmCalls += 1;
    return 1;
  };
  const dependencies = mockDependencies(observed);
  dependencies.sourceRegistry = new ProviderRegistry([mock, cold]);
  const report = await runBenchmark30({ ...options(dependencies), limit: 1 });

  assert.equal(prewarmCalls, 1);
  assert.equal(mockPrewarmCalls, 0);
  assert.deepEqual(report.prewarm.cohortProviderIds, ["cold-feed"]);
  assert.equal(report.prewarm.providers[0]?.productCount, 3);
  assert.equal(report.cases[0]?.v2.status, "success");
  assert.equal(observed.v2.length, 1);
  assert.equal(observed.v3.length, 2);
});

test("no ready official provider reports a blocker and does not attempt any arm or image/model call", async () => {
  const observed = { v2: [] as ProviderSearchRequest[], v3: [] as V3Request[], geminiCalls: 0 };
  const dependencies = mockDependencies(observed);
  dependencies.sourceRegistry = new ProviderRegistry([
    feedProvider({
      id: "cold-blocked",
      initialReady: false,
      ensure: async () => {
        throw new Error("Feed unavailable at https://private.invalid/path");
      },
    }),
  ]);
  dependencies.fetchQueryImage = async () => {
    throw new Error("No image download expected");
  };
  const report = await runBenchmark30({ ...options(dependencies), limit: 8 });

  assert.match(report.blocker ?? "", /No enabled official provider/u);
  assert.deepEqual(report.prewarm.cohortProviderIds, []);
  assert.equal(report.prewarm.providers[0]?.status, "error");
  assert.doesNotMatch(JSON.stringify(report), /private\.invalid/u);
  assert.equal(report.cases.length, 30);
  assert.equal(report.unscorableCaseCount, 2);
  assert.equal(report.attemptedCaseCount, 0);
  assert.equal(report.cases[0]?.v2.status, "not_attempted");
  assert.match(report.cases[0]?.v2.error ?? "", /official provider was ready/u);
  assert.equal(observed.v2.length, 0);
  assert.equal(observed.v3.length, 0);
  assert.equal(observed.geminiCalls, 0);
});

test("prewarm timeout excludes still-cold providers from the frozen cohort", async () => {
  const observed = { v2: [] as ProviderSearchRequest[], v3: [] as V3Request[], geminiCalls: 0 };
  const dependencies = mockDependencies(observed);
  dependencies.sourceRegistry = new ProviderRegistry([
    feedProvider({
      id: "slow-feed",
      initialReady: false,
      ensure: () => new Promise<number>(() => {}),
    }),
  ]);
  dependencies.prewarmTimeoutMs = 2;
  const report = await runBenchmark30({ ...options(dependencies), limit: 1 });

  assert.equal(report.prewarm.timedOut, true);
  assert.equal(report.prewarm.providers[0]?.status, "timeout");
  assert.deepEqual(report.prewarm.cohortProviderIds, []);
  assert.equal(report.cases[0]?.v2.status, "not_attempted");
  assert.equal(observed.v2.length, 0);
});
