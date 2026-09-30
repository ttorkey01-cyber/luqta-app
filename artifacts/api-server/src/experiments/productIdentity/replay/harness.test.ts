import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { NormalizedProduct } from "../../../connectors/types";
import {
  buildBlindPacket,
  comparabilityFlags,
  evaluateArm,
  loadFrozenCases,
  preflightSourceIndexes,
  runReplay,
  safeText,
  type ReplayCase,
  type ReplaySearch,
} from "./harness";
import type { IdentityIdentifier } from "../types";
import { main as replayCliMain } from "./cli";

function candidate(
  id: string,
  title: string,
  sourceFields: {
    model?: string;
    storage?: string;
    styleCode?: string;
    brand?: string;
    identifiers?: IdentityIdentifier[];
    providerId?: string;
    providerName?: string;
    merchant?: string;
  } = {},
): NormalizedProduct {
  return {
    id,
    title,
    providerId: "fixture",
    providerName: "Fixture",
    providerProductId: id,
    availability: "in_stock",
    sourceType: "fixture",
    canonical: {
      id,
      providerId: "fixture",
      providerProductId: id,
      title,
      description: null,
      brand: sourceFields.brand ?? "Sample",
      productType: null,
      category: "electronics",
      subcategory: null,
      audience: null,
      color: null,
      imageUrl: null,
      alternateImageUrls: null,
      price: 20,
      originalPrice: null,
      discount: null,
      currency: "SAR",
      merchant: "Shop",
      productUrl: null,
      affiliateUrl: null,
      destinationUrl: null,
      availability: "in_stock",
      condition: "new",
      location: null,
      rating: null,
      reviewCount: null,
      updatedAt: null,
      sourceType: "fixture",
    },
    isAffiliate: false,
    rankScore: 0,
    priceScore: 0,
    availabilityScore: 0,
    conditionScore: 0,
    locationScore: 0,
    ...sourceFields,
  } as NormalizedProduct;
}

test("replay calls V2 once and preserves the full candidate cohort in both arms", async () => {
  let calls = 0;
  let receivedRequest: Parameters<ReplaySearch["searchWithMetadata"]>[0] | undefined;
  const fixture: ReplaySearch = {
    async searchWithMetadata(request) {
      calls += 1;
      receivedRequest = request;
      return {
        products: [
          candidate("one", "First item"),
          candidate("two", "Second item"),
          candidate("one", "First item"),
        ],
      };
    },
  };
  const cases: ReplayCase[] = [{ id: "case-01", query: "sample item" }];
  const [observation] = await runReplay(cases, { search: fixture });
  assert.equal(calls, 1);
  assert.deepEqual(receivedRequest, { query: "sample item", searchMode: "intent" });
  assert.deepEqual(
    observation.baseline.map((item) => item.observationId),
    observation.identityAware.map((item) => item.observationId),
  );
  assert.equal(observation.decisions.length, 3);
  assert.equal(observation.groups.length, 3);
  assert.deepEqual(comparabilityFlags([observation], []), ["not_40_cases", "judgment_case_count_mismatch"]);
});

test("frozen corpus loader verifies and returns exactly the immutable 40 cases", async () => {
  const cases = await loadFrozenCases();
  assert.equal(cases.length, 40);
  assert.equal(cases[0].id, "1");
  assert.equal(cases[0].query, "Samsung Galaxy S24 256GB");
});

test("CLI refuses an existing output directory before any provider import", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "identity-replay-test-"));
  const existingOutput = join(temporary, "already-used");
  await mkdir(existingOutput);
  try {
    await assert.rejects(
      () => replayCliMain([
        "--live",
        "--independent-benchmark-judged",
        "--out",
        existingOutput,
      ]),
      (error: NodeJS.ErrnoException) => error.code === "EEXIST",
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("live execution is gated and blind packets contain no arm or rank fields", async () => {
  await assert.rejects(() => runReplay([{ id: "case-01", query: "sample" }]), /Live replay is disabled/);
  await assert.rejects(
    () => runReplay([{ id: "case-01", query: "sample" }], { allowLive: true }),
    /requires explicit confirmation/,
  );
  await assert.rejects(
    () => runReplay(
      [{ id: "case-01", query: "sample" }],
      { allowLive: true, independentBenchmarkJudged: true },
    ),
    /requires a completed bounded source\/index readiness preflight/,
  );
  const fixture: ReplaySearch = {
    async searchWithMetadata(_request, trace) {
      trace?.("fixture", {
        nested: {
          productUrl: "https://example.test/p",
          auth: { token: "token=abc" },
          note: "credential api_key=secret",
        },
      });
      const item = candidate("one", "Item https://example.test/p?token=abc");
      item.description = "ftp://example.test/ manual token=abc";
      return { products: [item] };
    },
  };
  const [observation] = await runReplay([{ id: "case-01", query: "find item" }], { search: fixture });
  const packet = buildBlindPacket([observation]);
  assert.equal(packet.cases[0].caseId, "case-01");
  assert.equal("baseline" in packet.cases[0].observations[0], false);
  assert.equal("rank" in packet.cases[0].observations[0], false);
  assert.doesNotMatch(packet.cases[0].observations[0].title, /https?:/);
  assert.equal(packet.cases[0].observations[0].availability, "in_stock");
  assert.equal(packet.cases[0].observations[0].source.providerName, "Fixture");
  assert.ok(packet.cases[0].observations[0].variant);
  assert.doesNotMatch(JSON.stringify(packet), /https?:\/\/|token=abc/);
  assert.doesNotMatch(JSON.stringify(observation), /https?:\/\/|ftp:\/\/|token=abc/);
  assert.match(JSON.stringify(observation.trace), /OMITTED/);
  assert.equal(safeText("api_key=secret"), "[REDACTED]");
});

test("only explicit source-backed query identity can assert exact and only that match may move up", async () => {
  const fixture: ReplaySearch = {
    async searchWithMetadata() {
      return {
        products: [
          candidate("unverified", "Sample Galaxy S24 256GB"),
          candidate("verified", "Sample Galaxy S24 256GB", { model: "Galaxy S24", storage: "256GB" }),
          candidate("family", "Sample Galaxy S24 family pack", { model: "Galaxy S24", storage: "256GB" }),
        ],
      };
    },
  };
  const [observation] = await runReplay([{
    id: "case-identity",
    query: "Sample Galaxy S24 256GB",
    hardConstraints: [
      { field: "brand", op: "eq", value: "Sample" },
      { field: "model", op: "eq", value: "Galaxy S24" },
      { field: "storage", op: "eq", value: "256GB" },
    ],
  }], { search: fixture });
  assert.equal(observation.decisions[0].queryIdentity.assertion, "NO_EXACT");
  const verified = observation.decisions.find((item) => item.baselineRank === 2)!;
  const family = observation.decisions.find((item) => item.baselineRank === 3)!;
  assert.equal(verified.queryIdentity.assertion, "EXACT");
  assert.equal(verified.assertedExactByArm.baseline, false);
  assert.equal(verified.assertedExactByArm.identityAware, true);
  assert.equal(family.queryIdentity.assertion, "NO_EXACT");
  assert.equal(observation.baseline[2].identityRecord.model, undefined);
  assert.equal(observation.identityAware[0].rank, 2);
  assert.equal(observation.identityAware[1].rank, 1);
  assert.deepEqual(
    observation.baseline.map((item) => item.observationId).sort(),
    observation.identityAware.map((item) => item.observationId).sort(),
  );
});

test("title-backed model and variant proof supports exact while siblings and editorial pages abstain", async () => {
  const fixture: ReplaySearch = {
    async searchWithMetadata() {
      return {
        products: [
          candidate("s24-exact", "Samsung Galaxy S24 256GB Black", { brand: "Samsung" }),
          candidate("s24-plus", "Samsung Galaxy S24+ 256GB Black", { brand: "Samsung" }),
          candidate("s24-small-storage", "Samsung Galaxy S24 128GB Black", { brand: "Samsung" }),
          candidate("s24-editorial", "Samsung Galaxy S24 256GB Black comparison guide", { brand: "Samsung" }),
        ],
      };
    },
  };
  const [observation] = await runReplay([{
    id: "case-title-evidence",
    query: "Samsung Galaxy S24 256GB black",
    hardConstraints: [
      { field: "brand", op: "eq", value: "Samsung" },
      { field: "model", op: "eq", value: "Galaxy S24" },
      { field: "storage", op: "eq", value: "256GB" },
      { field: "color", op: "eq", value: "black" },
    ],
  }], { search: fixture });
  const decisionFor = (rank: number) => observation.decisions.find((item) => item.baselineRank === rank)!;
  const exact = decisionFor(1);
  assert.equal(exact.queryIdentity.assertion, "EXACT");
  assert.equal(observation.baseline[0].identityRecord.model, "Galaxy S24");
  assert.ok(exact.queryIdentity.evidence.some((item) =>
    item.field === "model" && item.source === "source.title.pattern.samsung_galaxy_s",
  ));
  assert.ok(exact.queryIdentity.evidence.some((item) =>
    item.field === "storage" && item.source === "source.title",
  ));
  assert.equal(decisionFor(2).queryIdentity.assertion, "NO_EXACT");
  assert.equal(decisionFor(3).queryIdentity.assertion, "NO_EXACT");
  assert.equal(decisionFor(4).queryIdentity.assertion, "NO_EXACT");
  assert.ok(decisionFor(4).queryIdentity.reasons.includes("family_or_editorial_page"));
});

test("brand-specific iPhone model pattern can verify the requested tier only", async () => {
  const fixture: ReplaySearch = {
    async searchWithMetadata() {
      return {
        products: [
          candidate("iphone-15", "Apple iPhone 15 128GB", { brand: "Apple" }),
          candidate("iphone-15-pro", "Apple iPhone 15 Pro 128GB", { brand: "Apple" }),
        ],
      };
    },
  };
  const [observation] = await runReplay([{
    id: "case-iphone",
    query: "iPhone 15",
    hardConstraints: [{ field: "model", op: "eq", value: "iPhone 15" }],
  }], { search: fixture });
  assert.equal(observation.decisions[0].queryIdentity.assertion, "EXACT");
  assert.equal(observation.decisions[1].queryIdentity.assertion, "NO_EXACT");
  assert.equal(
    observation.decisions[0].queryIdentity.evidence.find((item) => item.field === "model")?.source,
    "source.title.pattern.apple_iphone",
  );
});

test("pairwise grouping uses scoped source evidence without merging siblings or ambiguous titles", async () => {
  const fixture: ReplaySearch = {
    async searchWithMetadata() {
      return {
        products: [
          candidate("same-a", "Samsung Galaxy S24 256GB Black", {
            brand: "Samsung",
            providerId: "merchant-a",
            merchant: "Merchant A",
          }),
          candidate("same-b", "Samsung Galaxy S24 256GB Black", {
            brand: "Samsung",
            providerId: "merchant-b",
            merchant: "Merchant B",
          }),
          candidate("sibling", "Samsung Galaxy S24+ 256GB Black", {
            brand: "Samsung",
            providerId: "merchant-c",
            merchant: "Merchant C",
          }),
          candidate("ambiguous-a", "Sample Phone 256GB", { providerId: "merchant-d" }),
          candidate("ambiguous-b", "Sample Phone 256GB", { providerId: "merchant-e" }),
        ],
      };
    },
  };
  const [observation] = await runReplay([{ id: "case-pairwise-source", query: "Samsung phone" }], {
    search: fixture,
  });
  const sameAId = observation.baseline[0].observationId;
  const sameBId = observation.baseline[1].observationId;
  const sharedModelGroup = observation.groups.find((group) =>
    group.records.some((record) => record.id === sameAId),
  )!;
  assert.equal(sharedModelGroup.records.length, 2);
  assert.ok(sharedModelGroup.records.some((record) => record.id === sameBId));
  assert.equal(observation.groups.length, 4);
  const sameComparison = observation.decisions
    .find((decision) => decision.baselineRank === 1)!
    .pairwiseComparisons.find((comparison) =>
      comparison.otherObservationId === observation.baseline[1].observationId,
    )!;
  assert.equal(sameComparison.decision.classification, "SAME_PRODUCT_SAME_VARIANT");
  assert.ok(sameComparison.sourceProof.candidate.some((proof) =>
    proof.field === "model" && proof.source === "source.title.pattern.samsung_galaxy_s",
  ));
  assert.ok(sameComparison.sourceProof.candidate.some((proof) =>
    proof.field === "variant.storage" && proof.source === "source.title",
  ));
  const siblingComparison = observation.decisions
    .find((decision) => decision.baselineRank === 1)!
    .pairwiseComparisons.find((comparison) =>
      comparison.otherObservationId === observation.baseline[2].observationId,
    )!;
  assert.equal(siblingComparison.decision.classification, "DIFFERENT_PRODUCT");
  const ambiguousA = observation.baseline[3].identityRecord;
  const ambiguousB = observation.baseline[4].identityRecord;
  assert.equal(ambiguousA.model, undefined);
  assert.equal(ambiguousB.model, undefined);
  const ambiguousGroupA = observation.groups.find((group) =>
    group.records.some((record) => record.id === ambiguousA.id),
  );
  const ambiguousGroupB = observation.groups.find((group) =>
    group.records.some((record) => record.id === ambiguousB.id),
  );
  assert.ok(ambiguousGroupA);
  assert.ok(ambiguousGroupB);
  assert.notEqual(ambiguousGroupA, ambiguousGroupB);
});

test("pairwise records retain only valid scoped labels and suppress seller SKU and editorial evidence", async () => {
  const fixture: ReplaySearch = {
    async searchWithMetadata() {
      return {
        products: [
          candidate("labeled", "Sample device GTIN-13: 4006381333931 MPN: ABC-123 SKU: SELLER-44"),
          candidate("labeled-copy", "Sample device EAN-13: 4006381333931 MPN: ABC-123 SKU: SELLER-55"),
          candidate("invalid-gtin", "Sample item EAN-13: 4006381333932 MPN: ABC-123"),
          candidate("editorial", "Sample device bundle MPN: ABC-123 SKU: SELLER-44"),
        ],
      };
    },
  };
  const [observation] = await runReplay([{ id: "case-pairwise-labels", query: "Sample device" }], {
    search: fixture,
  });
  const labeled = observation.baseline[0].identityRecord;
  assert.deepEqual(
    labeled.identifiers?.map((identifier) => identifier.kind).sort(),
    ["GTIN13", "MPN"],
  );
  assert.equal(labeled.identifiers?.find((identifier) => identifier.kind === "MPN")?.scope, "brand:Sample");
  assert.equal(labeled.identifiers?.some((identifier) => identifier.kind === "SKU"), false);
  assert.equal(
    observation.baseline[2].identityRecord.identifiers?.some((identifier) =>
      /^GTIN/u.test(String(identifier.kind)),
    ),
    false,
  );
  assert.equal(observation.baseline[3].identityRecord.identifiers, undefined);
  const proof = observation.decisions[0].pairwiseComparisons[0].sourceProof.candidate;
  assert.ok(proof.some((item) =>
    item.field === "identifier:GTIN13" && item.source === "source.title",
  ));
  assert.ok(proof.some((item) =>
    item.field === "identifier:MPN" && item.scope === "brand:Sample",
  ));
  assert.equal(proof.some((item) => item.field.includes("SKU")), false);
});

test("candidate IDs are stable source-provider/canonical IDs and false EXACT rate uses asserted candidates", async () => {
  const products = [candidate("source-a", "Sample model", { model: "Model A" }), candidate("source-b", "Other")];
  let index = 0;
  const fixture: ReplaySearch = {
    async searchWithMetadata() {
      const result = index++ === 0 ? products : [...products].reverse();
      return { products: result };
    },
  };
  const replayCase: ReplayCase = {
    id: "case-model",
    query: "Sample Model A",
    hardConstraints: [
      { field: "brand", op: "eq", value: "Sample" },
      { field: "model", op: "eq", value: "Model A" },
    ],
  };
  const first = (await runReplay([replayCase], { search: fixture }))[0];
  const second = (await runReplay([replayCase], { search: fixture }))[0];
  assert.equal(first.baseline[0].observationId, second.baseline[1].observationId);
  assert.equal(first.baseline[1].observationId, second.baseline[0].observationId);
  assert.deepEqual(
    new Set(first.baseline.map((item) => item.observationId)),
    new Set(second.baseline.map((item) => item.observationId)),
  );
  const judgments = [{
    caseId: "case-model",
    candidateJudgments: Object.fromEntries(first.baseline.map((item) => [item.observationId, "IRRELEVANT" as const])),
    coverage: "JUDGED" as const,
    inventoryAvailabilityAssessment: "found" as const,
  }];
  const baselineMetrics = evaluateArm([first], judgments, "baseline");
  const identityMetrics = evaluateArm([first], judgments, "identityAware");
  assert.equal(baselineMetrics.falseExactRate, null);
  assert.equal(identityMetrics.falseExactRate, 1);
});

test("valid query GTIN can support exact while invalid GTIN evidence abstains", async () => {
  const fixture: ReplaySearch = {
    async searchWithMetadata() {
      return {
        products: [
          candidate("gtin-valid", "Catalog listing", {
            identifiers: [{ kind: "GTIN13", value: "4006381333931" }],
          }),
          candidate("gtin-invalid", "Invalid identifier listing", {
            identifiers: [{ kind: "GTIN13", value: "4006381333932" }],
          }),
        ],
      };
    },
  };
  const [observation] = await runReplay([{
    id: "case-gtin",
    query: "barcode 4006381333931",
    hardConstraints: [{ field: "gtin13", op: "eq", value: "4006381333931" }],
  }], { search: fixture });
  assert.equal(observation.decisions[0].queryIdentity.assertion, "EXACT");
  assert.equal(observation.decisions[1].queryIdentity.assertion, "NO_EXACT");
});

test("labeled title GTIN proof is validated and recorded without exposing source URLs", async () => {
  const fixture: ReplaySearch = {
    async searchWithMetadata() {
      return {
        products: [
          candidate("gtin-labeled", "Catalog item GTIN-13: 4006381333931 https://shop.test/p"),
          candidate("gtin-bad-label", "Bad item EAN-13: 4006381333932"),
        ],
      };
    },
  };
  const [observation] = await runReplay([{
    id: "case-labeled-gtin",
    query: "GTIN 4006381333931",
    hardConstraints: [{ field: "gtin13", op: "eq", value: "4006381333931" }],
  }], { search: fixture });
  assert.equal(observation.decisions[0].queryIdentity.assertion, "EXACT");
  assert.equal(observation.decisions[1].queryIdentity.assertion, "NO_EXACT");
  assert.ok(observation.decisions[0].queryIdentity.evidence.some((item) =>
    item.field === "gtin13" && item.source === "source.title",
  ));
  assert.doesNotMatch(JSON.stringify(observation), /https?:\/\/shop\.test/);
});

test("provider-unavailable search failures are retained as sanitized case observations", async () => {
  const fixture: ReplaySearch = {
    async searchWithMetadata() {
      throw Object.assign(new Error("request failed at https://private.example?token=secret"), {
        name: "InventoryUnavailableError",
        providerIds: ["fixture-provider"],
      });
    },
  };
  const [observation] = await runReplay([{ id: "case-unavailable", query: "phone" }], { search: fixture });
  assert.equal(observation.baseline.length, 0);
  assert.equal(observation.identityAware.length, 0);
  assert.equal(observation.sourceAvailability.failures[0].errorType, "InventoryUnavailableError");
  assert.deepEqual(observation.sourceAvailability.failures[0].providerIds, ["fixture-provider"]);
  assert.doesNotMatch(JSON.stringify(observation), /https?:\/\/|token=secret/);
});

test("bounded source preflight waits for indexed providers and marks unavailable inventory as partial", async () => {
  let coldReady = false;
  let ensureCalls = 0;
  const report = await preflightSourceIndexes({
    getSearchProviders: () => [
      {
        metadata: { id: "warm", name: "Warm", integrationType: "affiliate_feed" },
        getSearchIndexReadiness: () => ({
          ready: true, productCount: 4, refreshing: false, lastSuccessfulSync: null,
        }),
      },
      {
        metadata: { id: "cold", name: "Cold", integrationType: "generic_feed" },
        getSearchIndexReadiness: () => ({
          ready: coldReady, productCount: coldReady ? 8 : 0, refreshing: !coldReady, lastSuccessfulSync: null,
        }),
        async ensureSearchIndexReady() {
          ensureCalls += 1;
          coldReady = true;
          return 8;
        },
      },
      {
        metadata: { id: "stuck", name: "Stuck", integrationType: "affiliate_feed" },
        getSearchIndexReadiness: () => ({
          ready: false, productCount: 0, refreshing: true, lastSuccessfulSync: null,
        }),
      },
      {
        metadata: { id: "mock", name: "Mock", integrationType: "mock_local" },
      },
    ],
  }, 100);
  assert.equal(ensureCalls, 1);
  assert.deepEqual(report.sources.map((source) => source.providerId), ["warm", "cold", "stuck"]);
  assert.deepEqual(report.sources.map((source) => source.status), [
    "READY", "READY_BY_ENSURE", "UNREADY_NO_WAITER",
  ]);
  assert.equal(report.partialCoverage, true);

  const [observation] = await runReplay([{ id: "case-partial", query: "lamp" }], {
    search: {
      async searchWithMetadata() {
        return { products: [] };
      },
    },
    readinessPreflight: report,
  });
  assert.equal(observation.sourceAvailability.partialCoverage, true);
  assert.equal(observation.sourceAvailability.readinessPreflight?.partialCoverage, true);
  assert.ok(observation.sourceAvailability.coverageNotes.includes("stuck:preflight:unready_no_waiter"));
  assert.ok(observation.sourceAvailability.failures.some((failure) => failure.errorType === "IndexReadiness_UNREADY_NO_WAITER"));
  assert.ok(comparabilityFlags([observation], []).includes("partial_provider_coverage"));
});

test("source preflight bounds a cold index wait and records timeout rather than no-match", async () => {
  const report = await preflightSourceIndexes({
    getSearchProviders: () => [{
      metadata: { id: "slow-index", name: "Slow", integrationType: "affiliate_feed" },
      getSearchIndexReadiness: () => ({
        ready: false, productCount: 0, refreshing: true, lastSuccessfulSync: null,
      }),
      ensureSearchIndexReady: () => new Promise<number>(() => undefined),
    }],
  }, 10);
  assert.equal(report.timedOut, true);
  assert.equal(report.partialCoverage, true);
  assert.equal(report.sources[0].status, "TIMED_OUT");
});

test("explicit source STYLE identifier can satisfy a query model/style code", async () => {
  const fixture: ReplaySearch = {
    async searchWithMetadata() {
      return {
        products: [candidate("style", "Nike shoe", {
          brand: "Nike",
          identifiers: [{ kind: "STYLE", value: "CW2288-111" }],
        })],
      };
    },
  };
  const [observation] = await runReplay([{
    id: "case-style",
    query: "Nike CW2288-111",
    hardConstraints: [
      { field: "brand", op: "eq", value: "Nike" },
      { field: "model", op: "eq", value: "CW2288-111" },
    ],
  }], { search: fixture });
  assert.equal(observation.decisions[0].queryIdentity.assertion, "EXACT");
  assert.ok(observation.decisions[0].queryIdentity.evidence.some((item) =>
    item.source === "source.identifiers.STYLE",
  ));
});

test("per-arm metrics use only judged cases and retain abstentions as coverage metadata", async () => {
  const fixture: ReplaySearch = {
    async searchWithMetadata() {
      return { products: [candidate("one", "Item")] };
    },
  };
  const [observation] = await runReplay([{ id: "case-01", query: "find item" }], { search: fixture });
  const result = evaluateArm([observation], [{
    caseId: "case-01",
    candidateJudgments: { [observation.baseline[0].observationId]: "RELEVANT" },
    coverage: "JUDGED",
    inventoryAvailabilityAssessment: "found",
  }], "baseline");
  assert.equal(result.precisionAt1, 1);
  assert.equal(result.successAt5, 1);
  assert.equal(result.coverage, 1);
  const abstained = evaluateArm([observation], [], "baseline");
  assert.equal(abstained.precisionAt1, null);
  assert.equal(abstained.abstentionRate, 1);
});

test("unknown inventory never enters ranking denominators and false EXACT uses asserted candidates", async () => {
  const fixture: ReplaySearch = {
    async searchWithMetadata() {
      return { products: [candidate("model", "Sample model", { model: "Model M" })] };
    },
  };
  const cases = ["found-case", "unknown-case"].map((id) => ({
    id,
    query: "Sample Model M",
    hardConstraints: [
      { field: "brand", op: "eq", value: "Sample" },
      { field: "model", op: "eq", value: "Model M" },
    ],
  }));
  const observations = await runReplay(cases, { search: fixture });
  const foundId = observations[0].identityAware[0].observationId;
  const unknownId = observations[1].identityAware[0].observationId;
  const metrics = evaluateArm(observations, [
    {
      caseId: "found-case",
      candidateJudgments: { [foundId]: "IRRELEVANT" },
      coverage: "JUDGED",
      inventoryAvailabilityAssessment: "found",
    },
    {
      caseId: "unknown-case",
      candidateJudgments: { [unknownId]: "EXACT" },
      coverage: "JUDGED",
      inventoryAvailabilityAssessment: "unknown",
    },
  ], "identityAware");
  assert.equal(metrics.precisionAt1, 0);
  assert.equal(metrics.precisionAt1Denominator, 1);
  assert.equal(metrics.successAt5, 0);
  assert.equal(metrics.successAt5Denominator, 1);
  assert.equal(metrics.supportedExactRank1, 0);
  assert.equal(metrics.supportedExactRank1Denominator, 1);
  assert.equal(metrics.falseExactRate, 0.5);
  assert.equal(metrics.falseExactRateDenominator, 2);
  assert.deepEqual(metrics.inventoryAvailabilityCounts, { found: 1, none: 0, unknown: 1 });
});

test("empty result windows and legacy missing inventory assessments remain unknown, not none", async () => {
  const [observation] = await runReplay([{ id: "empty-case", query: "nothing" }], {
    search: {
      async searchWithMetadata() {
        return { products: [] };
      },
    },
  });
  const metrics = evaluateArm([observation], [{
    caseId: "empty-case",
    candidateJudgments: {},
    coverage: "JUDGED",
  }], "baseline");
  assert.equal(metrics.precisionAt1, null);
  assert.equal(metrics.precisionAt1Denominator, 0);
  assert.equal(metrics.successAt5, null);
  assert.equal(metrics.successAt5Denominator, 0);
  assert.deepEqual(metrics.inventoryAvailabilityCounts, { found: 0, none: 0, unknown: 1 });
});

test("blind packet candidate order is deterministic by ID and independent of baseline rank", async () => {
  const items = ["one", "two", "three", "four"].map((id) => candidate(id, `${id} item`));
  let calls = 0;
  const fixture: ReplaySearch = {
    async searchWithMetadata() {
      calls += 1;
      return { products: calls === 1 ? items : [...items].reverse() };
    },
  };
  const replayCase = [{ id: "blind-order-case", query: "items" }];
  const first = (await runReplay(replayCase, { search: fixture }))[0];
  const second = (await runReplay(replayCase, { search: fixture }))[0];
  const firstBaselineOrder = first.baseline.map((item) => item.observationId);
  const secondBaselineOrder = second.baseline.map((item) => item.observationId);
  assert.notDeepEqual(firstBaselineOrder, secondBaselineOrder);
  const firstBlindOrder = buildBlindPacket([first]).cases[0].observations
    .map((item) => item.observationId);
  const secondBlindOrder = buildBlindPacket([second]).cases[0].observations
    .map((item) => item.observationId);
  assert.deepEqual(firstBlindOrder, secondBlindOrder);
  assert.ok(
    JSON.stringify(firstBlindOrder) !== JSON.stringify(firstBaselineOrder) ||
      JSON.stringify(firstBlindOrder) !== JSON.stringify(secondBaselineOrder),
  );
});