import assert from "node:assert/strict";
import test from "node:test";
import {
  createGeminiV3BenchmarkAdapter,
} from "./adapters";
import {
  runRealWorldBenchmark,
  summarizeRealWorldObservations,
  unavailableRealWorldReport,
  type AdapterSearchResult,
  type BenchmarkObservation,
  type BenchmarkCaseReview,
  type RealWorldSearchAdapter,
} from "./benchmark";
import { REAL_WORLD_IMAGE_CASES } from "./manifest";

const reviewedAt = "2026-09-29T12:00:00.000Z";
const fingerprint = "catalog-sha256:test";

function reviewEvidence(caseId: string, candidateIds: string[], relevance: Record<string, "exact" | "close" | "irrelevant">): BenchmarkCaseReview {
  const benchmarkCase = REAL_WORLD_IMAGE_CASES.find(({ id }) => id === caseId)!;
  return {
    caseId,
    referenceImageVerification: {
      available: true,
      verifiedBy: "independent-image-reviewer",
      verifiedAt: reviewedAt,
      method: "human-opened-image" as const,
      imageUrl: benchmarkCase.imageUrl,
    },
    catalogReview: {
      reviewerId: "independent-catalog-reviewer",
      reviewedAt,
      candidateCatalogFingerprint: fingerprint,
      reviewedCandidateIds: candidateIds,
    },
    adjudication: {
      reviewerId: "independent-catalog-reviewer",
      reviewedAt,
      exactCandidateIds: Object.entries(relevance).filter(([, value]) => value === "exact").map(([id]) => id),
      closeCandidateIds: Object.entries(relevance).filter(([, value]) => value === "close").map(([id]) => id),
      relevanceByCandidateId: relevance,
    },
  };
}

test("real-image manifest has 30+ unique publicly licensed Commons images", () => {
  assert.ok(REAL_WORLD_IMAGE_CASES.length >= 30);
  assert.equal(new Set(REAL_WORLD_IMAGE_CASES.map(({ id }) => id)).size, REAL_WORLD_IMAGE_CASES.length);
  assert.equal(new Set(REAL_WORLD_IMAGE_CASES.map(({ imageUrl }) => imageUrl)).size, REAL_WORLD_IMAGE_CASES.length);
  for (const item of REAL_WORLD_IMAGE_CASES) {
    assert.equal(item.source, "Wikimedia Commons");
    assert.equal(item.provenanceStatus, "commons-api-metadata-checked");
    assert.equal(item.scenarioIsPromptOnly, true);
    assert.equal(item.relevanceJudgments, "unavailable");
    assert.ok(item.author.trim().length > 0);
    assert.match(item.imageUrl, /^https:\/\/(?:thumb|upload)\.wikimedia\.org\/wikipedia\/commons\//u);
    assert.match(item.sourcePageUrl, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/u);
    assert.match(item.licenseUrl, /^https:\/\/creativecommons\.org\//u);
    assert.match(item.license, /^(?:CC0|CC BY(?:-SA)? \d+(?:\.\d+)?)$/u);
    assert.equal(item.metadataCheckedAt, "2026-09-29");
    assert.ok(!item.imageUrl.includes(".invalid"));
  }
  assert.ok(REAL_WORLD_IMAGE_CASES.some(({ category }) => category === "automotive-parts"));
  assert.ok(REAL_WORLD_IMAGE_CASES.some(({ category }) => category === "screenshot-context"));
  assert.ok(REAL_WORLD_IMAGE_CASES.some(({ scenario }) => scenario === "multiple-objects-prompt-only"));
  assert.ok(!REAL_WORLD_IMAGE_CASES.some(({ scenario }) => String(scenario).includes("low-quality")));
});

test("no-configuration report uses unavailable/null values rather than fabricated scores", () => {
  const report = unavailableRealWorldReport();
  assert.equal(report.imageCases, REAL_WORLD_IMAGE_CASES.length);
  assert.equal(report.v2.status, "unavailable");
  assert.equal(report.v3.status, "unavailable");
  assert.equal(report.geminiV3.status, "unavailable");
  for (const version of [report.v2, report.v3, report.geminiV3]) {
    assert.equal(version.summary.top1.rate, null);
    assert.equal(version.summary.visualQualityMean1To5.mean, null);
    assert.equal(version.summary.providerCalls, null);
    assert.equal(version.summary.braveCalls, null);
    assert.equal(version.summary.modelCalls, null);
    assert.equal(version.summary.cacheHits, null);
    assert.equal(version.summary.cacheMisses, null);
  }
});

test("metric calculations use only reviewed judgments and explicit instrumentation", () => {
  const [first, second] = REAL_WORLD_IMAGE_CASES;
  assert.ok(first && second);
  const observations: BenchmarkObservation[] = [
    {
      caseId: first.id,
      adapterId: "v2-adapter",
      candidateCatalogFingerprint: fingerprint,
      rankedCandidateIds: ["irrelevant", "close"],
      latencyMs: 10,
      providerCalls: 1,
      braveCalls: 0,
      modelCalls: 2,
      firstPassSuccess: false,
      secondPassAttempted: true,
      secondPassRecovery: true,
      review: {
        ...reviewEvidence(first.id, ["irrelevant", "close", "exact"], {
          irrelevant: "irrelevant",
          close: "close",
          exact: "exact",
        }),
        adjudication: {
          ...reviewEvidence(first.id, ["irrelevant", "close", "exact"], {
            irrelevant: "irrelevant",
            close: "close",
            exact: "exact",
          }).adjudication,
          visualQualityRatings: [
            { candidateId: "irrelevant", score: 1, evaluator: "independent-catalog-reviewer" },
            { candidateId: "close", score: 4, evaluator: "independent-catalog-reviewer" },
          ],
          violationsByCandidateId: {
            irrelevant: { wrongProduct: true, wrongBrand: false, price: true, constraint: true },
            close: { wrongProduct: false, wrongBrand: false, price: false, constraint: false },
          },
        },
      },
    },
    {
      caseId: second.id,
      adapterId: "v2-adapter",
      candidateCatalogFingerprint: fingerprint,
      rankedCandidateIds: ["exact"],
      latencyMs: 20,
      providerCalls: 2,
      braveCalls: 1,
      modelCalls: 1,
      firstPassSuccess: true,
      secondPassAttempted: false,
      review: {
        ...reviewEvidence(second.id, ["irrelevant", "close", "exact"], {
          irrelevant: "irrelevant",
          close: "close",
          exact: "exact",
        }),
        adjudication: {
          ...reviewEvidence(second.id, ["irrelevant", "close", "exact"], {
            irrelevant: "irrelevant",
            close: "close",
            exact: "exact",
          }).adjudication,
          visualQualityRatings: [{ candidateId: "exact", score: 5, evaluator: "independent-catalog-reviewer" }],
        },
      },
    },
  ];

  const summary = summarizeRealWorldObservations([first, second], observations, fingerprint, new Set(["irrelevant", "close", "exact"]));
  assert.deepEqual(summary.top1, { rate: 0.5, numerator: 1, denominator: 2 });
  assert.deepEqual(summary.top3, { rate: 1, numerator: 2, denominator: 2 });
  assert.deepEqual(summary.top5, { rate: 1, numerator: 2, denominator: 2 });
  assert.deepEqual(summary.exactProductTop5, { rate: 0.5, numerator: 1, denominator: 2 });
  assert.deepEqual(summary.closeMatchTop3, { rate: 0.5, numerator: 1, denominator: 2 });
  assert.deepEqual(summary.irrelevantResultRate, { rate: 0.3333, numerator: 1, denominator: 3 });
  assert.equal(summary.visualQualityMean1To5.mean, 3.33);
  assert.equal(summary.violations.price.rate, 0.5);
  assert.equal(summary.violations.constraint.rate, 0.5);
  assert.equal(summary.constraintCompliance.rate, 0.5);
  assert.deepEqual(summary.latencyMs, { mean: 15, p95: 20, measuredCases: 2 });
  assert.equal(summary.providerCalls, 3);
  assert.equal(summary.braveCalls, 1);
  assert.equal(summary.modelCalls, 3);
  assert.deepEqual(summary.firstPassSuccess, { rate: 0.5, numerator: 1, denominator: 2 });
  assert.deepEqual(summary.secondPassRecovery, { rate: 1, numerator: 1, denominator: 1 });

  const unreviewed = summarizeRealWorldObservations([first], [{
    caseId: first.id,
    adapterId: "v2-adapter",
    candidateCatalogFingerprint: fingerprint,
    rankedCandidateIds: ["not-adjudicated"],
    latencyMs: 3,
  }], fingerprint, new Set(["not-adjudicated"]));
  assert.equal(unreviewed.top1.rate, null);
  assert.equal(unreviewed.irrelevantResultRate.rate, null);
  assert.equal(unreviewed.providerCalls, null);
});

test("paired runner supplies identical real image and catalog inputs to both adapters", async () => {
  const benchmarkCase = REAL_WORLD_IMAGE_CASES[0]!;
  const candidates = [{ id: "candidate-1", imageUrl: "https://example.org/public-image.jpg" }] as const;
  const seen: Array<{ version: string; imageUrl: string; catalog: unknown; fingerprint: string }> = [];
  const makeAdapter = (version: "v2" | "v3" | "gemini-v3"): RealWorldSearchAdapter => ({
    version,
    id: `${version}-adapter`,
    async search(input) {
      seen.push({
        version,
        imageUrl: input.benchmarkCase.imageUrl,
        catalog: input.candidateCatalog,
        fingerprint: input.candidateCatalogFingerprint,
      });
      return {
        caseId: input.benchmarkCase.id,
        candidateCatalogFingerprint: input.candidateCatalogFingerprint,
        rankedCandidateIds: ["candidate-1"],
        latencyMs: 4,
      };
    },
  });
  const report = await runRealWorldBenchmark({
    cases: [benchmarkCase],
    candidateCatalog: candidates,
    candidateCatalogFingerprint: "stable-real-catalog-v1",
    v2: makeAdapter("v2"),
    v3: makeAdapter("v3"),
    geminiV3: makeAdapter("gemini-v3"),
  });
  assert.equal(report.v2.status, "unavailable");
  assert.equal(report.v3.status, "unavailable");
  assert.equal(report.geminiV3.status, "unavailable");
  assert.deepEqual(seen.map(({ imageUrl }) => imageUrl), [benchmarkCase.imageUrl, benchmarkCase.imageUrl, benchmarkCase.imageUrl]);
  assert.equal(seen[0]!.catalog, seen[1]!.catalog);
  assert.equal(seen[0]!.fingerprint, seen[1]!.fingerprint);
  assert.equal(seen[1]!.catalog, seen[2]!.catalog);
  assert.equal(seen[1]!.fingerprint, seen[2]!.fingerprint);
  assert.equal(report.v2.summary.top1.rate, null, "an unjudged result is not credited as success");
});

test("paired runner rejects catalog mismatch and makes no default network/model calls", async () => {
  const report = await runRealWorldBenchmark({});
  assert.equal(report.v2.status, "unavailable");
  assert.equal(report.v3.status, "unavailable");
  assert.equal(report.geminiV3.status, "unavailable");

  const one = REAL_WORLD_IMAGE_CASES[0]!;
  const badAdapter: RealWorldSearchAdapter = {
    version: "v2",
    id: "v2-adapter",
    async search(input) {
      return {
        caseId: input.benchmarkCase.id,
        candidateCatalogFingerprint: "wrong-catalog",
        rankedCandidateIds: [],
        latencyMs: 1,
      };
    },
  };
  const invalidResultReport = await runRealWorldBenchmark({
    cases: [one],
    candidateCatalog: [{ id: "candidate-1" }],
    candidateCatalogFingerprint: "right-catalog",
    v2: badAdapter,
  });
  assert.equal(invalidResultReport.v2.errors.length, 1);
  assert.equal(invalidResultReport.v2.errors[0]!.message, "ADAPTER_CALL_FAILED");
});

test("Gemini V3 is explicit opt-in; failures are surfaced without fake rankings or totals", async () => {
  const benchmarkCase = REAL_WORLD_IMAGE_CASES[0]!;
  const report = await runRealWorldBenchmark({
    cases: [benchmarkCase],
    candidateCatalog: [{ id: "candidate-1" }],
    candidateCatalogFingerprint: fingerprint,
    geminiV3: {
      version: "gemini-v3",
      id: "gemini-v3-adapter",
      async search() {
        throw new Error("Gemini credential unavailable: secret-token-do-not-serialize");
      },
    },
  });
  assert.equal(report.geminiV3.status, "unavailable");
  assert.equal(report.geminiV3.observations.length, 0);
  assert.equal(report.geminiV3.errors.length, 1);
  assert.equal(report.geminiV3.errors[0]!.message, "ADAPTER_CALL_FAILED");
  assert.ok(!report.geminiV3.errors[0]!.message.includes("secret-token-do-not-serialize"));
  assert.ok(report.geminiV3.summary.latencyMs.measuredCases >= 1);
  assert.equal(report.geminiV3.summary.top1.rate, null);
  assert.equal(report.geminiV3.summary.modelCalls, null);
  assert.equal(report.geminiV3.summary.estimatedCostPerSearch, null);

  await assert.rejects(runRealWorldBenchmark({
    geminiV3: {
      version: "v3",
      id: "wrong-version",
      async search() { throw new Error("should not run"); },
    },
  }), /Expected a Gemini V3 adapter/u);
});

test("all three arms preserve cache and cost instrumentation", async () => {
  const benchmarkCase = REAL_WORLD_IMAGE_CASES[0]!;
  const adapter = (version: "v2" | "v3" | "gemini-v3"): RealWorldSearchAdapter => ({
    version,
    id: `${version}-adapter`,
    async search(input) {
      return {
        caseId: input.benchmarkCase.id,
        candidateCatalogFingerprint: input.candidateCatalogFingerprint,
        rankedCandidateIds: ["candidate-1"],
        latencyMs: 7,
        modelCalls: 1,
        cacheHits: 2,
        cacheMisses: 1,
        estimatedCostPerSearch: 0.002,
      };
    },
  });
  const report = await runRealWorldBenchmark({
    cases: [benchmarkCase],
    candidateCatalog: [{ id: "candidate-1" }],
    candidateCatalogFingerprint: fingerprint,
    v2: adapter("v2"),
    v3: adapter("v3"),
    geminiV3: adapter("gemini-v3"),
  });
  for (const arm of [report.v2, report.v3, report.geminiV3]) {
    assert.equal(arm.observations[0]?.cacheHits, 2);
    assert.equal(arm.observations[0]?.cacheMisses, 1);
    assert.equal(arm.observations[0]?.estimatedCostPerSearch, 0.002);
    assert.equal(arm.summary.modelCalls, 1);
    assert.equal(arm.summary.cacheHits, 2);
    assert.equal(arm.summary.cacheMisses, 1);
    assert.equal(arm.summary.estimatedCostPerSearch, 0.002);
  }
});

test("concrete Gemini V3 builder is opt-in, requires its explicit key, and reports provider metric deltas", async () => {
  let disabledTransportCalls = 0;
  const transport = (async () => {
    disabledTransportCalls += 1;
    return new Response(JSON.stringify({ embedding: { values: Array(768).fill(1) } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;

  assert.equal(createGeminiV3BenchmarkAdapter({
    enabled: false,
    fetch: transport,
    candidateCatalog: [{ id: "candidate-1", imageUrl: "https://catalog.test/1.png" }],
    candidateCatalogFingerprint: fingerprint,
    imageLoader: async () => ({ bytes: Uint8Array.of(1) }),
  }), undefined);
  assert.equal(disabledTransportCalls, 0);
  assert.throws(() => createGeminiV3BenchmarkAdapter({
    enabled: true,
    fetch: transport,
    candidateCatalog: [{ id: "candidate-1", imageUrl: "https://catalog.test/1.png" }],
    candidateCatalogFingerprint: fingerprint,
    imageLoader: async () => ({ bytes: Uint8Array.of(1) }),
  }), /explicit server-side API key/u);
  assert.equal(disabledTransportCalls, 0);

  const requests: Array<{ url: string; headers: Headers }> = [];
  const mockFetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    requests.push({ url: String(input), headers: new Headers(init?.headers) });
    return new Response(JSON.stringify({ embedding: { values: Array(768).fill(1) } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  const png = (tail: number) => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, tail, 1, 2]);
  const imageBytes = new Map([
    [REAL_WORLD_IMAGE_CASES[0]!.imageUrl, png(1)],
    ["https://catalog.test/1.png", png(2)],
    ["https://catalog.test/2.png", png(3)],
  ]);
  const candidateCatalog = [
    { id: "candidate-1", imageUrl: "https://catalog.test/1.png" },
    { id: "candidate-2", imageUrl: "https://catalog.test/2.png" },
  ] as const;
  const adapter = createGeminiV3BenchmarkAdapter({
    enabled: true,
    apiKey: "explicit-test-key",
    fetch: mockFetch,
    candidateCatalog,
    candidateCatalogFingerprint: fingerprint,
    imageLoader: async (url) => {
      const bytes = imageBytes.get(url);
      if (!bytes) throw new Error("test image not found");
      return { bytes, url, mimeType: "image/png" };
    },
  });
  assert.ok(adapter);
  assert.equal(requests.length, 0, "construction is inert until an explicitly opted-in search");
  const report = await runRealWorldBenchmark({
    cases: [REAL_WORLD_IMAGE_CASES[0]!],
    candidateCatalog,
    candidateCatalogFingerprint: fingerprint,
    geminiV3: adapter,
  });
  assert.equal(report.geminiV3.observations.length, 1);
  assert.equal(report.geminiV3.observations[0]?.rankedCandidateIds.length, 2);
  assert.equal(report.geminiV3.observations[0]?.modelCalls, requests.length);
  assert.equal(report.geminiV3.observations[0]?.cacheMisses, 3);
  assert.equal(report.geminiV3.observations[0]?.estimatedCostPerSearch, 3 * 0.00012);
  assert.ok(requests.length > 0);
  assert.ok(requests.every(({ url }) => url.includes("gemini-embedding-2")));
  assert.ok(requests.every(({ headers }) => headers.get("x-goog-api-key") === "explicit-test-key"));
  assert.ok(report.geminiV3.observations[0]!.latencyMs >= 0);
});

test("runner withholds quality metrics for missing image or missing adjudications", async () => {
  const benchmarkCase = REAL_WORLD_IMAGE_CASES[0]!;
  let adapterCalls = 0;
  const adapter: RealWorldSearchAdapter = {
    version: "v2",
    id: "v2-adapter",
    async search(input) {
      adapterCalls += 1;
      return {
        caseId: input.benchmarkCase.id,
        candidateCatalogFingerprint: input.candidateCatalogFingerprint,
        rankedCandidateIds: ["candidate-1"],
        latencyMs: 5,
      };
    },
  };
  const catalog = [{ id: "candidate-1" }];
  const noImageCase = { ...benchmarkCase, imageUrl: "" };
  const noImage = await runRealWorldBenchmark({
    cases: [noImageCase],
    candidateCatalog: catalog,
    candidateCatalogFingerprint: "real-catalog",
    v2: adapter,
  });
  assert.equal(adapterCalls, 0);
  assert.equal(noImage.v2.status, "unavailable");
  assert.equal(noImage.v2.summary.top1.rate, null);

  const noAdjudication = await runRealWorldBenchmark({
    cases: [benchmarkCase],
    candidateCatalog: catalog,
    candidateCatalogFingerprint: "real-catalog",
    v2: adapter,
    reviews: [{
      caseId: benchmarkCase.id,
      referenceImageVerification: {
        available: true,
        verifiedBy: "independent-image-reviewer",
        verifiedAt: reviewedAt,
        method: "human-opened-image",
        imageUrl: benchmarkCase.imageUrl,
      },
      catalogReview: {
        reviewerId: "independent-catalog-reviewer",
        reviewedAt,
        candidateCatalogFingerprint: "real-catalog",
        reviewedCandidateIds: ["candidate-1"],
      },
      adjudication: {
        reviewerId: "independent-catalog-reviewer",
        reviewedAt,
        exactCandidateIds: [],
        closeCandidateIds: [],
        relevanceByCandidateId: {},
      },
    }],
  });
  assert.equal(noAdjudication.v2.status, "unavailable");
  assert.equal(noAdjudication.v2.summary.top1.rate, null);
  assert.equal(noAdjudication.v2.summary.visualQualityMean1To5.mean, null);
  assert.equal(noAdjudication.v2.summary.latencyMs.mean, 5, "instrumented latency remains distinct from unavailable quality");
  assert.match(noAdjudication.v2.unavailableReason ?? "", /relevance judgments/u);
});

test("only external, complete catalog and relevance evidence can make a run available", async () => {
  const benchmarkCase = REAL_WORLD_IMAGE_CASES[0]!;
  const catalog = [{ id: "candidate-1" }];
  const adapter: RealWorldSearchAdapter = {
    version: "v2",
    id: "v2-adapter",
    async search(input) {
      return {
        caseId: input.benchmarkCase.id,
        candidateCatalogFingerprint: input.candidateCatalogFingerprint,
        rankedCandidateIds: ["candidate-1"],
        latencyMs: 6,
      };
    },
  };
  const reviewed = reviewEvidence(benchmarkCase.id, ["candidate-1"], { "candidate-1": "exact" });
  const complete = await runRealWorldBenchmark({
    cases: [benchmarkCase],
    candidateCatalog: catalog,
    candidateCatalogFingerprint: fingerprint,
    v2: adapter,
    reviews: [reviewed],
  });
  assert.equal(complete.v2.status, "available");
  assert.equal(complete.v2.summary.top1.rate, 1);

  const adapterClaimedReference = await runRealWorldBenchmark({
    cases: [benchmarkCase],
    candidateCatalog: catalog,
    candidateCatalogFingerprint: fingerprint,
    v2: adapter,
    reviews: [{
      ...reviewed,
      referenceImageVerification: {
        ...reviewed.referenceImageVerification,
        verifiedBy: "v2-adapter",
      },
    }],
  });
  assert.equal(adapterClaimedReference.v2.status, "unavailable");

  const adapterClaimedJudgment = await runRealWorldBenchmark({
    cases: [benchmarkCase],
    candidateCatalog: catalog,
    candidateCatalogFingerprint: fingerprint,
    v2: adapter,
    reviews: [{
      ...reviewed,
      catalogReview: { ...reviewed.catalogReview, reviewerId: "v2-adapter" },
      adjudication: { ...reviewed.adjudication, reviewerId: "v2-adapter" },
    }],
  });
  assert.equal(adapterClaimedJudgment.v2.status, "unavailable");

  const secondCase = REAL_WORLD_IMAGE_CASES[1]!;
  const partial = await runRealWorldBenchmark({
    cases: [benchmarkCase, secondCase],
    candidateCatalog: catalog,
    candidateCatalogFingerprint: fingerprint,
    v2: adapter,
    reviews: [reviewed],
  });
  assert.equal(partial.v2.status, "partial");
  assert.equal(partial.v2.summary.evaluatedCases, 1);

  const incomplete: BenchmarkCaseReview = {
    ...reviewed,
    adjudication: { ...reviewed.adjudication, relevanceByCandidateId: {} },
  };
  const missingRankJudgment = await runRealWorldBenchmark({
    cases: [benchmarkCase],
    candidateCatalog: catalog,
    candidateCatalogFingerprint: fingerprint,
    v2: adapter,
    reviews: [incomplete],
  });
  assert.equal(missingRankJudgment.v2.status, "unavailable");
  assert.equal(missingRankJudgment.v2.summary.top1.rate, null);

  const adapterClaimedPoolReview = await runRealWorldBenchmark({
    cases: [benchmarkCase],
    candidateCatalog: catalog,
    candidateCatalogFingerprint: fingerprint,
    v2: adapter,
  });
  assert.equal(adapterClaimedPoolReview.v2.status, "unavailable");
  assert.equal(adapterClaimedPoolReview.v2.summary.evaluatedCases, 0);

  const selfClaimingAdapter: RealWorldSearchAdapter = {
    ...adapter,
    async search(input) {
      return {
        caseId: input.benchmarkCase.id,
        candidateCatalogFingerprint: input.candidateCatalogFingerprint,
        rankedCandidateIds: ["candidate-1"],
        latencyMs: 6,
        review: reviewed,
      } as unknown as AdapterSearchResult;
    },
  };
  const ignoredAdapterReview = await runRealWorldBenchmark({
    cases: [benchmarkCase],
    candidateCatalog: catalog,
    candidateCatalogFingerprint: fingerprint,
    v2: selfClaimingAdapter,
  });
  assert.equal(ignoredAdapterReview.v2.status, "unavailable");
  assert.equal(ignoredAdapterReview.v2.observations[0]?.review, undefined);
});