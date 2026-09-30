import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ProviderRegistry } from "../../connectors/providerRegistry";
import { SearchOrchestrator } from "../../connectors/searchOrchestrator";
import type {
  ProviderMetadata,
  ProviderProduct,
  ProviderSearchRequest,
  SearchProvider,
} from "../../connectors/types";
import {
  acceptanceCases,
  runAcceptance,
  type CaseSnapshot,
  type SearchAdapter,
  type SearchAdapterResult,
} from "./runner";
import {
  searchGoldPhase1,
  type Phase1SearchResult,
} from "./phase1Search";
import type { Phase1Intent } from "./phase1Intent";

const BASELINE_FILE = new URL("./baseline-v2.2-expanded.json", import.meta.url);
const EXPECTED_BASELINE_SHA256 =
  "9cb6ad9b4e254131f511d67530e89536247df461daf8419e52300996654b06b7";
const FIXTURE_PROVIDER_ID = "search-gold-controlled-fixture";
const FIXTURE_METADATA: ProviderMetadata = {
  id: FIXTURE_PROVIDER_ID,
  name: "Search gold controlled fixtures",
  enabled: true,
  searchEnabled: true,
  affiliateEnabled: true,
  priceMonitoringAllowed: false,
  visualSearchAllowed: false,
  country: "SA",
  currency: "SAR",
  integrationType: "generic_feed",
  requiresCredentials: false,
  credentialRequirements: [],
  priority: 1,
  lastSuccessfulSync: null,
  affiliateCapability: "not_verified",
  priceMonitoringCapability: "disabled",
  integrationStatus: "mock",
};

type AdapterDiagnostics = {
  phase1State: Phase1SearchResult["state"];
  phase1Intent: Phase1Intent | null;
  plannedQueries: Phase1SearchResult["plannedQueries"];
  executedQueries: Phase1SearchResult["executedQueries"];
  providerErrors: string[];
  partialCoverage: boolean;
  clarificationReasons: string[];
  identityGroups: Phase1SearchResult["identityGroups"];
  comparisonEvidence: Phase1SearchResult["comparisonEvidence"];
  candidates: Array<{
    id: string;
    classification: string;
    score: number;
    constraints: Record<string, unknown>;
    evidence: string[];
    diagnostics?: string[];
  }>;
  rejectedIds: string[];
  qualifyingIds: string[];
  alternativeIds: string[];
};

type AdaptedResult = SearchAdapterResult & {
  diagnostics: AdapterDiagnostics;
};

function classifyPhase1(value: string) {
  switch (value) {
    case "EXACT":
      return "exact" as const;
    case "CLOSE_ALTERNATIVE":
    case "PROBABLE_EXACT":
      // A probable identity is never upgraded to exact by the benchmark.
      return "close" as const;
    case "SIMILAR":
      return "similar" as const;
    case "WEAK":
    case "IRRELEVANT":
    default:
      return "irrelevant" as const;
  }
}

function interactionState(result: Phase1SearchResult) {
  if (result.state === "PROVIDER_UNAVAILABLE") return "retrieval_failure" as const;
  if (result.state === "CONFLICTING_EVIDENCE") return "conflicting_evidence" as const;
  if (result.state === "INVALID_QUERY") return "clarification" as const;
  if (
    result.state === "NO_CONFIDENT_MATCH" &&
    (result.clarificationReasons.length > 0 ||
      Boolean(result.intent?.ambiguityReasons.length))
  ) {
    return "clarification" as const;
  }
  if (result.state === "NO_CONFIDENT_MATCH") return "no_match" as const;
  const relevantAlternatives = result.results.filter((candidate) =>
    ["SIMILAR", "CLOSE_ALTERNATIVE"].includes(candidate.classification),
  );
  if (
    relevantAlternatives.length > 0 &&
    result.results.every((candidate) =>
      ["SIMILAR", "CLOSE_ALTERNATIVE", "WEAK", "IRRELEVANT"].includes(
        candidate.classification,
      ),
    )
  ) {
    return "similar_alternative" as const;
  }
  return "results" as const;
}

function toFixtureResult(product: ProviderProduct) {
  const availability = product.availability ?? null;
  return {
    id: product.id,
    title: product.title,
    description: product.description ?? null,
    merchant: product.merchant ?? null,
    price: product.price ?? null,
    currency: product.currency ?? null,
    sourceType: product.sourceType,
    brand: product.brand ?? null,
    color: product.color ?? null,
    productType: product.productType ?? null,
    condition: product.condition ?? null,
    location: product.location ?? null,
    availability,
    updatedAt: product.updatedAt ?? null,
    rating: product.rating ?? null,
    reviewCount: product.reviewCount ?? null,
    isAffiliate: Boolean(product.affiliateUrl),
  };
}

/**
 * Inject the same closed in-memory fixture corpus and throwing sentinel used
 * by runner.runV2Search. Phase 1's wrapper sees only this injected V2 search;
 * it never uses the production provider registry or external providers.
 */
export const phase1Adapter: SearchAdapter = async (
  request: ProviderSearchRequest,
  fixtureProducts: ProviderProduct[],
): Promise<AdaptedResult> => {
  const fixtureProvider: SearchProvider = {
    metadata: FIXTURE_METADATA,
    async search() {
      if (
        fixtureProducts.some(
          (product) => product.id === "fixture-provider-failure",
        )
      ) {
        throw new Error("Synthetic controlled-fixture retrieval failure.");
      }
      return fixtureProducts;
    },
  };
  const searchV2 = (innerRequest: ProviderSearchRequest) =>
    new SearchOrchestrator(new ProviderRegistry([fixtureProvider]))
      .searchWithMetadata({
        ...innerRequest,
        preferredProviderIds: [FIXTURE_PROVIDER_ID],
      });

  const phase1 = await searchGoldPhase1(request, searchV2);
  const candidatesById = new Map<
    string,
    Phase1SearchResult["results"][number]
  >();
  for (const candidate of [
    ...phase1.results,
    ...phase1.alternatives,
    ...phase1.rejected,
  ]) {
    candidatesById.set(candidate.product.id, candidate);
  }
  const presentedById = new Map<string, Phase1SearchResult["results"][number]>();
  // Alternatives in diagnostics are not necessarily eligible to display.
  // In particular, an exact-only request can retain a near match as an
  // explanation while correctly presenting NO_CONFIDENT_MATCH.
  for (const candidate of phase1.results) {
    presentedById.set(candidate.product.id, candidate);
  }
  const classifications = Object.fromEntries(
    [...candidatesById].map(([id, candidate]) => [
      id,
      classifyPhase1(candidate.classification),
    ]),
  );
  const products = [...presentedById.values()].map((candidate) =>
    toFixtureResult(candidate.product),
  );
  const state = interactionState(phase1);
  const phase1Budget = phase1.intent?.budget.value;
  const parsedStructuredIntent = phase1.intent
    ? {
        ...phase1.intent.baseIntent,
        brand: phase1.intent.brand.value ?? phase1.intent.baseIntent.brand,
        color: phase1.intent.color.value ?? phase1.intent.baseIntent.color,
        condition:
          phase1.intent.condition.value ?? phase1.intent.baseIntent.condition,
        location: phase1.intent.city.value ?? phase1.intent.baseIntent.location,
        minPrice: phase1Budget?.min ?? phase1.intent.baseIntent.minPrice,
        maxPrice: phase1Budget?.max ?? phase1.intent.baseIntent.maxPrice,
        approximatePrice:
          phase1Budget?.approximate ??
          phase1.intent.baseIntent.approximatePrice,
        currency: phase1Budget?.currency ?? phase1.intent.baseIntent.currency,
      }
    : undefined;
  const diagnostics: AdapterDiagnostics = {
    phase1State: phase1.state,
    phase1Intent: phase1.intent,
    plannedQueries: phase1.plannedQueries,
    executedQueries: phase1.executedQueries,
    providerErrors: phase1.providerErrors,
    partialCoverage: phase1.partialCoverage,
    clarificationReasons: phase1.clarificationReasons,
    identityGroups: phase1.identityGroups,
    comparisonEvidence: phase1.comparisonEvidence,
    candidates: [...candidatesById.values()].map((candidate) => ({
      id: candidate.product.id,
      classification: candidate.classification,
      score: candidate.score,
      constraints: candidate.constraints,
      evidence: candidate.evidence,
      ...("diagnostics" in candidate && Array.isArray(candidate.diagnostics)
        ? {
            diagnostics: candidate.diagnostics.filter(
              (entry): entry is string => typeof entry === "string",
            ),
          }
        : {}),
    })),
    rejectedIds: phase1.rejected.map((candidate) => candidate.product.id),
    qualifyingIds: phase1.results.map((candidate) => candidate.product.id),
    alternativeIds: phase1.alternatives.map((candidate) => candidate.product.id),
  };
  return {
    products,
    classifications,
    interactionState: state,
    identityGroups: Object.fromEntries(phase1.identityGroups.map((group) => [
      group.id,
      group.variants.flatMap((variant) => variant.offers.map((offer) =>
        offer.id.slice(offer.id.indexOf(":") + 1))),
    ])),
    exactMatches: products.filter(
      (product) => classifications[product.id] === "exact",
    ).length,
    structuredIntent: parsedStructuredIntent,
    ...(phase1.state === "PROVIDER_UNAVAILABLE"
      ? {
          retrievalError: {
            name: "Phase1ProviderUnavailable",
            message: phase1.providerErrors.join(", ") || "Provider unavailable",
          },
        }
      : {}),
    diagnostics,
  };
};

function parsedBaseline() {
  const raw = readFileSync(BASELINE_FILE);
  const hash = createHash("sha256").update(raw).digest("hex");
  if (hash !== EXPECTED_BASELINE_SHA256) {
    throw new Error(
      `Frozen V2 baseline hash mismatch: expected ${EXPECTED_BASELINE_SHA256}, got ${hash}`,
    );
  }
  return {
    hash,
    report: JSON.parse(raw.toString("utf8")) as {
      baselineVersion: string;
      counts: { executableControlledCases: number; pass: number; fail: number };
      cases: Array<{
        caseId: number;
        status: "PASS" | "FAIL";
        response?: SearchAdapterResult;
      }>;
    },
  };
}

function unscorableBlueprintCases() {
  const manifest = JSON.parse(
    readFileSync(new URL("./MANIFEST.json", import.meta.url), "utf8"),
  ) as {
    cases: Array<{ id: number; classification: string }>;
  };
  if (manifest.cases.length !== 63) {
    throw new Error(`Expected manifest for 63 cases, found ${manifest.cases.length}`);
  }
  return manifest.cases
    .filter((item) => item.classification === "UNSCORABLE")
    .map((item) => item.id);
}

function goldRelevantIds(caseId: number, gold: Record<string, unknown>) {
  const ids = new Set<string>();
  const addString = (value: unknown) => {
    if (typeof value === "string") ids.add(value);
  };
  const addArray = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(addString);
  };
  for (const key of [
    "exactProductId",
    "exactRelevantId",
    "relevantId",
    "cheaperSameIdentityOffer",
    "closeProductId",
    "resultId",
  ]) {
    addString(gold[key]);
  }
  for (const key of [
    "relevantIds",
    "qualifyingIds",
    "offerIds",
    "purchasableOfferIds",
  ]) {
    addArray(gold[key]);
  }
  addArray(gold["offerIds"]);
  if (typeof gold.closeAlternative === "string") ids.add(gold.closeAlternative);
  if (gold.canonicalOfferId) {
    const testCase = acceptanceCases.find((item) => item.id === caseId);
    testCase?.fixture.forEach((product) => ids.add(product.id));
  }
  return [...ids];
}

function goldExactIds(gold: Record<string, unknown>) {
  const ids = new Set<string>();
  for (const key of [
    "exactProductId",
    "exactRelevantId",
    "cheaperSameIdentityOffer",
  ]) {
    if (typeof gold[key] === "string") ids.add(gold[key] as string);
  }
  if (gold.identity && Array.isArray(gold.offerIds)) {
    gold.offerIds.forEach((id) => {
      if (typeof id === "string") ids.add(id);
    });
  }
  return [...ids];
}

function resultOf(snapshot: CaseSnapshot): AdaptedResult | undefined {
  return snapshot.response as AdaptedResult | undefined;
}

function metric(
  numerator: number,
  denominator: number,
  target: { operator: ">=" | "<="; value: number } | null,
  note?: string,
) {
  const value = denominator ? numerator / denominator : null;
  const targetStatus =
    value === null || target === null
      ? "NOT_SCOREABLE"
      : target.operator === ">="
        ? value >= target.value
          ? "REACHED"
          : "NOT_REACHED"
        : value <= target.value
          ? "REACHED"
          : "NOT_REACHED";
  return {
    classification: "CONTROLLED FIXTURE",
    numerator,
    denominator,
    value,
    target,
    targetStatus,
    ...(note ? { note } : {}),
  };
}

function percentile(values: number[], fraction: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)];
}

const HARD_CONSTRAINT_CASES = new Set([
  13, 33, 34, 35, 36, 37, 39, 40, 41, 58,
]);
const NO_MATCH_CASES = new Set([22, 36, 55, 56, 58]);
const IDENTIFIER_CASES = new Set([1, 2, 3, 4, 6, 14, 19, 20]);
const ARABIC_INTENT_CASES = new Set([
  7, 10, 13, 14, 17, 18, 19, 20, 21, 22, 23, 33, 34, 35, 36, 37, 38, 40, 41,
  58,
]);

function textHas(value: unknown, ...needles: string[]) {
  if (typeof value !== "string") return false;
  const normalized = value.toLocaleLowerCase().replace(/[ـ]/gu, "");
  return needles.some((needle) => normalized.includes(needle.toLocaleLowerCase()));
}

function parsedArabicIntentCorrect(
  caseId: number,
  snapshot: CaseSnapshot,
) {
  const response = resultOf(snapshot);
  const intent = response?.diagnostics?.phase1Intent;
  if (!intent) return false;
  const base = intent.baseIntent;
  switch (caseId) {
    case 7:
      return (
        intent.category.value === "electronics" ||
        textHas(intent.productType.value, "audio", "headphone", "earbud")
      );
    case 10:
      return (
        intent.budget.value?.approximate === 250 &&
        intent.budget.value.max === null &&
        !intent.hardRequirements.some((requirement) =>
          ["lt", "lte"].includes(requirement.operator),
        )
      );
    case 13:
    case 35:
    case 36:
    case 58:
      return intent.color.value === (caseId === 13 ? "white" : caseId === 36 ? "green" : "blue");
    case 14:
      return intent.brand.value === "FixtureBrand" && intent.model.value === "QX-750";
    case 17:
      return textHas(intent.normalizedQuery, "usb-c", "usb c", "type c");
    case 18:
      return (
        intent.category.value === "electronics" ||
        base.category === "electronics" ||
        textHas(intent.productType.value, "phone", "mobile")
      );
    case 19:
      return textHas(intent.normalizedQuery, "15") && !textHas(intent.normalizedQuery, "14");
    case 20:
      return intent.brand.value === "Samsung" || base.brand === "Samsung";
    case 21:
    case 23:
    case 38:
      return (
        intent.ambiguityReasons.length > 0 ||
        intent.clarificationReasons.length > 0
      );
    case 22:
      return !intent.brand.value && !intent.model.value;
    case 33:
    case 34:
      return (
        intent.budget.value?.max === 300 &&
        intent.hardRequirements.some(
          (requirement) =>
            requirement.operator === "lt" && Number(requirement.value) === 300,
        )
      );
    case 37:
      return intent.size.value === "38";
    case 40:
      return intent.condition.value === "used";
    case 41:
      return (
        intent.condition.value === "used" &&
        textHas(intent.city.value, "jeddah", "جدة")
      );
    default:
      return false;
  }
}

function scorecard(
  phaseSnapshots: CaseSnapshot[],
  regressionSummary: Record<string, number>,
  unscorableCaseIds: number[],
) {
  const caseSnapshots = new Map(phaseSnapshots.map((snapshot) => [snapshot.caseId, snapshot]));
  const answerable = acceptanceCases.flatMap((testCase) => {
    const relevant = goldRelevantIds(testCase.id, testCase.goldLabels);
    return relevant.length ? [{ testCase, relevant }] : [];
  });
  let p1Hits = 0;
  let p3Hits = 0;
  let success5 = 0;
  let p3Slots = 0;
  let p1Slots = 0;
  for (const { testCase, relevant } of answerable) {
    const ids =
      resultOf(caseSnapshots.get(testCase.id)!)?.products.map((product) => product.id) ??
      [];
    if (ids[0] && relevant.includes(ids[0])) p1Hits += 1;
    p1Slots += 1;
    p3Hits += ids.slice(0, 3).filter((id) => relevant.includes(id)).length;
    p3Slots += 3;
    if (ids.slice(0, 5).some((id) => relevant.includes(id))) success5 += 1;
  }

  const exactCases = acceptanceCases.flatMap((testCase) => {
    const ids = goldExactIds(testCase.goldLabels);
    return ids.length ? [{ testCase, ids }] : [];
  });
  const exactRank1 = exactCases.filter(({ testCase, ids }) => {
    const result = resultOf(caseSnapshots.get(testCase.id)!);
    const first = result?.products[0];
    return Boolean(
      first &&
        ids.includes(first.id) &&
        result?.classifications?.[first.id] === "exact",
    );
  }).length;

  let hardResultDenominator = 0;
  let hardResultNumerator = 0;
  let hardQueryNumerator = 0;
  let hardQueryDenominator = 0;
  for (const testCase of acceptanceCases.filter((item) =>
    HARD_CONSTRAINT_CASES.has(item.id),
  )) {
    const expected = Array.isArray(testCase.goldLabels.qualifyingIds)
      ? (testCase.goldLabels.qualifyingIds as string[])
      : [];
    const result = resultOf(caseSnapshots.get(testCase.id)!);
    const products = result?.products ?? [];
    // Measure actual displayed offers, not only offers the evaluator itself
    // labeled "qualifying". Otherwise a bad displayed alternative disappears
    // from the denominator and makes the safety rate look artificially good.
    hardResultDenominator += products.length;
    hardResultNumerator += products.filter((product) =>
      expected.includes(product.id)
    ).length;
    hardQueryDenominator += 1;
    const everyDisplayedIsGoldCompliant = products.every((product) =>
      expected.includes(product.id),
    );
    const fulfilledOrCorrectlyAbstained = expected.length
      ? products.some((product) => expected.includes(product.id))
      : products.length === 0 && result?.interactionState === "no_match";
    if (everyDisplayedIsGoldCompliant && fulfilledOrCorrectlyAbstained) {
      hardQueryNumerator += 1;
    }
  }

  let irrelevantCount = 0;
  let relevanceResultDenominator = 0;
  for (const { testCase, relevant } of answerable) {
    const products =
      resultOf(caseSnapshots.get(testCase.id)!)?.products.slice(0, 5) ?? [];
    relevanceResultDenominator += products.length;
    irrelevantCount += products.filter((product) => !relevant.includes(product.id)).length;
  }

  let exactAssertions = 0;
  let adjudicatedExactAssertions = 0;
  let unadjudicatedExactAssertions = 0;
  let falseExact = 0;
  const unadjudicatedExactCases: number[] = [];
  for (const testCase of acceptanceCases) {
    const result = resultOf(caseSnapshots.get(testCase.id)!);
    const goldExact = new Set(goldExactIds(testCase.goldLabels));
    for (const product of result?.products ?? []) {
      if (result?.classifications?.[product.id] !== "exact") continue;
      exactAssertions += 1;
      if (goldExact.size === 0) {
        // A case testing ranking, freshness or conflicting evidence is not an
        // independent identity adjudication. Neither a pass nor a false-exact
        // judgment can be inferred from the absence of an exact gold ID.
        unadjudicatedExactAssertions += 1;
        unadjudicatedExactCases.push(testCase.id);
      } else {
        adjudicatedExactAssertions += 1;
        if (!goldExact.has(product.id)) falseExact += 1;
      }
    }
  }

  const correctNoMatch = [...NO_MATCH_CASES].filter((id) => {
    const response = resultOf(caseSnapshots.get(id)!);
    return (
      response?.interactionState === "no_match" &&
      (response?.products.length ?? 0) === 0
    );
  }).length;
  const noMatchMetric = metric(correctNoMatch, NO_MATCH_CASES.size, {
    operator: ">=",
    value: 0.9,
  });

  const identifierRows = [...IDENTIFIER_CASES].map((id) => {
    const testCase = acceptanceCases.find((item) => item.id === id)!;
    const expectedIds = goldExactIds(testCase.goldLabels);
    const response = resultOf(caseSnapshots.get(id)!);
    const first = response?.products[0];
    return {
      caseId: id,
      expectedIds,
      observedFirstId: first?.id ?? null,
      pass: Boolean(
        first &&
          expectedIds.includes(first.id) &&
          response?.classifications?.[first.id] === "exact",
      ),
    };
  });
  const arabicRows = [...ARABIC_INTENT_CASES].map((id) => {
    const snapshot = caseSnapshots.get(id)!;
    return {
      caseId: id,
      query: snapshot.query,
      pass: parsedArabicIntentCorrect(id, snapshot),
      observedIntent: resultOf(snapshot)?.diagnostics?.phase1Intent ?? null,
    };
  });
  const noMatchAndFailureRows = [
    ...[...NO_MATCH_CASES].map((caseId) => {
      const response = resultOf(caseSnapshots.get(caseId)!);
      return {
        caseId,
        expected: "NO_CONFIDENT_MATCH/no_match",
        observed: `${response?.diagnostics?.phase1State ?? "missing"}/${response?.interactionState ?? "missing"}`,
        pass:
          response?.diagnostics?.phase1State === "NO_CONFIDENT_MATCH" &&
          response.interactionState === "no_match" &&
          response.products.length === 0,
      };
    }),
    (() => {
      const response = resultOf(caseSnapshots.get(63)!);
      return {
        caseId: 63,
        expected: "PROVIDER_UNAVAILABLE/retrieval_failure",
        observed: `${response?.diagnostics?.phase1State ?? "missing"}/${response?.interactionState ?? "missing"}`,
        pass:
          response?.diagnostics?.phase1State === "PROVIDER_UNAVAILABLE" &&
          response.interactionState === "retrieval_failure" &&
          response.products.length === 0,
      };
    })(),
  ];
  const p50 = percentile(
    phaseSnapshots.map((snapshot) => snapshot.elapsedMs),
    0.5,
  );
  const p95 = percentile(
    phaseSnapshots.map((snapshot) => snapshot.elapsedMs),
    0.95,
  );
  const visibleExactCount = exactAssertions;

  return {
    scope: {
      classification: "CONTROLLED FIXTURE",
      approvedBlueprintCaseCount: 63,
      executedFixtureCaseCount: phaseSnapshots.length,
      unscorableCaseCount: unscorableCaseIds.length,
      unscorableCaseIds,
      realObservedCount: 0,
      productionThresholdClaim: false,
      fixtureMetricsAreNotProductionEstimates: true,
    },
    metrics: {
      precisionAt1: metric(p1Hits, p1Slots, { operator: ">=", value: 0.7 }),
      precisionAt3: metric(p3Hits, p3Slots, { operator: ">=", value: 0.6 }),
      successAt5: metric(success5, answerable.length, {
        operator: ">=",
        value: 0.75,
      }),
      exactProductIdentificationRank1: metric(
        exactRank1,
        exactCases.length,
        { operator: ">=", value: 0.8 },
        "Exact identity requires an explicit adapter classification of exact; probable-exact is not upgraded.",
      ),
      hardConstraintCompliance: {
        resultLevel: metric(
          hardResultNumerator,
          hardResultDenominator,
          null,
          "Safety among displayed offers only. Abstained queries are excluded here and counted as missed fulfillment in queryLevel.",
        ),
        queryLevel: metric(
          hardQueryNumerator,
          hardQueryDenominator,
          { operator: ">=", value: 0.97 },
          "A query with known eligible fixture offers counts only when an eligible offer is returned; abstention is not successful fulfillment.",
        ),
      },
      irrelevantResultRate: metric(
        irrelevantCount,
        relevanceResultDenominator,
        { operator: "<=", value: 0.2 },
      ),
      falseExactMatchRate: {
        ...metric(
          falseExact,
          adjudicatedExactAssertions,
          { operator: "<=", value: 0.005 },
          "Only independently gold-labeled identity cases are scored. Unannotated exact assertions are reported separately, not assumed false or true. This controlled sample cannot establish a production rate.",
        ),
        unadjudicatedExactAssertions,
        targetStatus: adjudicatedExactAssertions && falseExact / adjudicatedExactAssertions > 0.005
          ? "NOT_REACHED"
          : unadjudicatedExactAssertions
            ? "NOT_ESTABLISHED"
            : adjudicatedExactAssertions
              ? "REACHED"
              : "NOT_SCOREABLE",
      },
      correctNoMatchRate: noMatchMetric,
      arabicIntentAccuracy: metric(
        arabicRows.filter((row) => row.pass).length,
        arabicRows.length,
        { operator: ">=", value: 0.82 },
      ),
      identifierAccuracy: metric(
        identifierRows.filter((row) => row.pass).length,
        identifierRows.length,
        null,
        "Diagnostic controlled-fixture measure; no separate identifier-accuracy threshold is defined in the blueprint scorecard.",
      ),
      providerErrorNoMatchDistinction: metric(
        noMatchAndFailureRows.filter((row) => row.pass).length,
        noMatchAndFailureRows.length,
        { operator: ">=", value: 1 },
        "Sentinel provider failure must be PROVIDER_UNAVAILABLE/retrieval_failure; each finite-snapshot no-match must remain NO_CONFIDENT_MATCH/no_match.",
      ),
      fixtureHarnessLatencyMs: {
        classification: "CONTROLLED FIXTURE",
        samples: phaseSnapshots.length,
        median: p50,
        p95,
        target: null,
        targetStatus: "NOT_APPLICABLE_FIXTURE_HARNESS",
        note: "Measured end-to-end around the local Phase 1 wrapper plus in-memory fixture adapter, not production server latency.",
      },
    },
    details: {
      relevantCaseCountForRanking: answerable.length,
      rankingCases: answerable.map(({ testCase, relevant }) => {
        const observed =
          resultOf(caseSnapshots.get(testCase.id)!)?.products
            .slice(0, 5)
            .map((product) => product.id) ?? [];
        return {
          caseId: testCase.id,
          goldRelevantIds: relevant,
          observedTop5Ids: observed,
          successAt5: observed.some((id) => relevant.includes(id)),
        };
      }),
      independentGoldLabelsByCase: acceptanceCases.map((testCase) => ({
        caseId: testCase.id,
        goldLabels: testCase.goldLabels,
      })),
      exactIdentityCaseCount: exactCases.length,
      exactAssertionsOnDisplayedResults: visibleExactCount,
      exactAssertionsWithIndependentGold: adjudicatedExactAssertions,
      unadjudicatedExactAssertions,
      unadjudicatedExactCases,
      arabicIntentCases: arabicRows,
      identifierCases: identifierRows,
      providerErrorNoMatchCases: noMatchAndFailureRows,
      baselineComparison: regressionSummary,
    },
  };
}

export async function runPhase1Benchmark() {
  const { hash: baselineHash, report: baseline } = parsedBaseline();
  const unscorableCaseIds = unscorableBlueprintCases();
  const phaseSnapshots = await runAcceptance(phase1Adapter);
  const baselineById = new Map(
    baseline.cases.map((snapshot) => [snapshot.caseId, snapshot]),
  );
  const comparisons = phaseSnapshots.map((snapshot) => {
    const prior = baselineById.get(snapshot.caseId);
    if (!prior) throw new Error(`No frozen V2 case ${snapshot.caseId}`);
    const change =
      prior.status === "FAIL" && snapshot.status === "PASS"
        ? "IMPROVED"
        : prior.status === "PASS" && snapshot.status === "FAIL"
          ? "REGRESSION"
          : prior.status === "PASS"
            ? "UNCHANGED_PASS"
            : "UNCHANGED_FAIL";
    return {
      caseId: snapshot.caseId,
      title: snapshot.title,
      baselineV2: prior.status,
      phase1: snapshot.status,
      change,
      phase1Failure: snapshot.error ?? null,
      response: snapshot.response,
    };
  });
  const comparisonSummary = {
    casesCompared: comparisons.length,
    regressions: comparisons.filter((item) => item.change === "REGRESSION").length,
    improvements: comparisons.filter((item) => item.change === "IMPROVED").length,
    unchangedPass: comparisons.filter((item) => item.change === "UNCHANGED_PASS").length,
    unchangedFail: comparisons.filter((item) => item.change === "UNCHANGED_FAIL").length,
  };
  return {
    schemaVersion: 1,
    benchmarkVersion: "phase1-controlled-fixture-2026-09-30",
    generatedAt: new Date().toISOString(),
    classification: "CONTROLLED FIXTURE",
    realObservedCount: 0,
    baseline: {
      file: "baseline-v2.2-expanded.json",
      sha256: baselineHash,
      version: baseline.baselineVersion,
    },
    phase1: {
      adapter: "searchGoldPhase1(request, injectedInMemoryV2)",
      pass: phaseSnapshots.filter((snapshot) => snapshot.status === "PASS").length,
      fail: phaseSnapshots.filter((snapshot) => snapshot.status === "FAIL").length,
      cases: phaseSnapshots,
    },
    comparison: {
      summary: comparisonSummary,
      cases: comparisons,
    },
    scorecard: scorecard(
      phaseSnapshots,
      comparisonSummary,
      unscorableCaseIds,
    ),
    caveat:
      "All records and metrics are controlled synthetic fixtures. They are not real inventory, production quality, deployment latency, or production threshold claims.",
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const result = await runPhase1Benchmark();
  writeFileSync(
    fileURLToPath(new URL("./phase1-results.json", import.meta.url)),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  writeFileSync(
    fileURLToPath(new URL("./scorecard.json", import.meta.url)),
    `${JSON.stringify(
      {
        schemaVersion: result.schemaVersion,
        benchmarkVersion: result.benchmarkVersion,
        generatedAt: result.generatedAt,
        classification: result.classification,
        baseline: result.baseline,
        phase1Summary: {
          pass: result.phase1.pass,
          fail: result.phase1.fail,
          comparedCaseCount: result.phase1.cases.length,
        },
        comparison: {
          summary: result.comparison.summary,
          cases: result.comparison.cases.map((item) => ({
            caseId: item.caseId,
            title: item.title,
            baselineV2: item.baselineV2,
            phase1: item.phase1,
            change: item.change,
          })),
        },
        scorecard: result.scorecard,
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}