import {
  InventoryUnavailableError,
  type SearchOrchestrationResult,
} from "../../connectors/searchOrchestrator";
import type { NormalizedProduct, ProviderSearchRequest, QueryIntent } from "../../connectors/types";
import { evaluatePhase1Candidates, type EvaluatedPhase1Candidate, type RejectedPhase1Candidate } from "./candidateEvaluation";
import { parsePhase1Intent, type Phase1Intent } from "./phase1Intent";
import { planPhase1Queries, type PlannedQuery } from "./queryPlanner";

export type Phase1SearchState =
  | "RESULTS_FOUND"
  | "NO_CONFIDENT_MATCH"
  | "PROVIDER_UNAVAILABLE"
  | "INVALID_QUERY";

export type Phase1SearchResult = {
  state: Phase1SearchState;
  intent: Phase1Intent | null;
  plannedQueries: PlannedQuery[];
  executedQueries: PlannedQuery[];
  results: EvaluatedPhase1Candidate[];
  alternatives: EvaluatedPhase1Candidate[];
  rejected: RejectedPhase1Candidate[];
  providerErrors: string[];
  partialCoverage: boolean;
  clarificationReasons: string[];
};

/** An injected V2 instance keeps this experiment off the production search route. */
export type SearchV2 = (request: ProviderSearchRequest) => Promise<SearchOrchestrationResult>;

function suppliedV2Intent(intent: Phase1Intent): QueryIntent {
  const existing = intent.baseIntent;
  const budget = intent.budget.value;
  return {
    ...existing,
    raw: intent.rawQuery,
    brand: intent.brand.value ?? existing.brand,
    color: intent.color.value ?? existing.color,
    condition: intent.condition.value ?? existing.condition,
    location: intent.city.value ?? existing.location,
    // V2 uses inclusive prices; the experimental evidence gate applies the
    // actual strict (<, >) or inclusive (<=, >=) operator after retrieval.
    minPrice: budget?.min ?? existing.minPrice,
    maxPrice: budget?.max ?? existing.maxPrice,
    approximatePrice: budget?.approximate ?? existing.approximatePrice,
    currency: budget?.currency ?? existing.currency ?? (budget ? "SAR" : undefined),
  };
}

function empty(
  state: Phase1SearchState,
  intent: Phase1Intent | null,
  plannedQueries: PlannedQuery[] = [],
  clarificationReasons: string[] = [],
): Phase1SearchResult {
  return {
    state, intent, plannedQueries, executedQueries: [], results: [],
    alternatives: [], rejected: [], providerErrors: [],
    partialCoverage: false, clarificationReasons,
  };
}

/**
 * Bounded experimental wrapper around the current V2 orchestration contract.
 * It reuses V2's provider registry, network budgets, normalization, caching,
 * links, and existing Brave eligibility. It is NOT wired into routes/search.ts.
 * No merchant or candidate image is sent to Gemini (there is no image call).
 */
export async function searchGoldPhase1(
  request: ProviderSearchRequest,
  searchV2: SearchV2,
): Promise<Phase1SearchResult> {
  if (!request.query?.trim()) {
    return empty("INVALID_QUERY", null, [], ["Enter a product or shopping request."]);
  }
  const intent = await parsePhase1Intent(request.query, request.intent);
  const plannedQueries = planPhase1Queries(intent);
  if (intent.ambiguityReasons.length) {
    return empty("NO_CONFIDENT_MATCH", intent, plannedQueries, intent.clarificationReasons);
  }
  if (intent.relations.value?.includes("cheaper")) {
    // The existing V2 request contract carries neither a reference offer
    // identity nor its comparable total price. Never invent a saving.
    return empty("NO_CONFIDENT_MATCH", intent, plannedQueries, [
      "Provide the reference item and its comparable current price to verify a cheaper offer.",
    ]);
  }

  const executedQueries: PlannedQuery[] = [];
  const candidates = new Map<string, NormalizedProduct>();
  const strategyById = new Map<string, string>();
  const providerErrors = new Set<string>();
  let partialCoverage = false;
  let evaluated = evaluatePhase1Candidates(intent, []);

  // A planned query can trigger V2's own bounded variants, so execute only
  // the primary and at most one fallback, and stop once relevant results exist.
  for (const plan of plannedQueries.slice(0, 2)) {
    executedQueries.push(plan);
    try {
      const response = await searchV2({
        ...request,
        query: plan.query,
        searchMode: "intent",
        intent: { ...request.intent, ...suppliedV2Intent(intent), raw: intent.rawQuery },
      });
      for (const timing of response.__timings?.providerTimings ?? []) {
        if (timing.timedOut || timing.errorType || timing.ready === false) {
          partialCoverage = true;
          providerErrors.add(timing.providerId);
        }
      }
      // V2 reports "unavailable" even when its optional Brave fallback is
      // deliberately disabled by preferredProviderIds (as in these isolated
      // fixtures). It is not evidence that a selected provider failed.
      for (const product of response.products) {
        const key = `${product.providerId}:${product.canonical.id}`;
        if (candidates.has(key)) continue;
        candidates.set(key, product);
        // This names the OUTER plan yielding the candidate. V2 may expand
        // that query internally; do not claim its specific subquery is known.
        strategyById.set(product.canonical.id, plan.strategy);
      }
      evaluated = evaluatePhase1Candidates(intent, [...candidates.values()], strategyById);
      const relevantAlternative = evaluated.alternatives.some(
        (candidate) => candidate.classification !== "WEAK",
      );
      if (evaluated.qualifying.length || relevantAlternative) break;
    } catch (error) {
      if (!(error instanceof InventoryUnavailableError)) throw error;
      partialCoverage = true;
      if (error.providerIds.length) {
        for (const providerId of error.providerIds) providerErrors.add(providerId);
      } else {
        providerErrors.add("provider_unavailable");
      }
      // Another query against the same unavailable provider cohort cannot
      // turn that outage into a verified inventory no-match.
      break;
    }
  }

  const requestedExact = Boolean(
    intent.relations.value?.includes("exact") ||
    [intent.model, intent.sku, intent.mpn, intent.oem, intent.gtin14]
      .some((field) => field.evidence === "USER_EXPLICIT" && field.value !== null),
  );
  const alternatives = evaluated.alternatives.filter(
    (candidate) => candidate.classification !== "WEAK",
  );
  const results = requestedExact
    ? evaluated.qualifying
    : [...evaluated.qualifying, ...alternatives];
  const state: Phase1SearchState = results.length
    ? "RESULTS_FOUND"
    : partialCoverage
      ? "PROVIDER_UNAVAILABLE"
      : "NO_CONFIDENT_MATCH";

  return {
    state, intent, plannedQueries, executedQueries, results, alternatives,
    rejected: evaluated.rejected, providerErrors: [...providerErrors],
    partialCoverage, clarificationReasons: intent.clarificationReasons,
  };
}