import {
  InventoryUnavailableError,
  type SearchOrchestrationResult,
} from "../../connectors/searchOrchestrator";
import type { NormalizedProduct, ProviderSearchRequest, QueryIntent } from "../../connectors/types";
import { evaluatePhase1Candidates, type CandidateIdentityGroup, type EvaluatedPhase1Candidate, type RejectedPhase1Candidate } from "./candidateEvaluation";
import { parsePhase1Intent, type Phase1Intent } from "./phase1Intent";
import { planPhase1Queries, type PlannedQuery } from "./queryPlanner";

export type Phase1SearchState =
  | "RESULTS_FOUND"
  | "CONFLICTING_EVIDENCE"
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
  identityGroups: CandidateIdentityGroup[];
  /** Comparisons are between observed, currently priced offers, not an inferred user-owned item. */
  comparisonEvidence: Array<{ cheaperOfferId: string; referenceOfferId: string; currency: string; difference: number }>;
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
    alternatives: [], rejected: [], identityGroups: [], comparisonEvidence: [], providerErrors: [],
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
  const plannedQueries = planPhase1Queries(intent, "BROAD");
  if (intent.ambiguityReasons.length) {
    return empty("NO_CONFIDENT_MATCH", intent, plannedQueries, intent.clarificationReasons);
  }
  const executedQueries: PlannedQuery[] = [];
  const candidates = new Map<string, NormalizedProduct>();
  const strategyById = new Map<string, string>();
  const providerErrors = new Set<string>();
  let partialCoverage = false;
  let evaluated = evaluatePhase1Candidates(intent, []);

  // V2 itself uses bounded variants. At most four outer plans are permitted;
  // later stages run only when exact/lexical evidence remains insufficient.
  for (const plan of plannedQueries.slice(0, 4)) {
    executedQueries.push(plan);
    try {
      const v2Intent = suppliedV2Intent(intent);
      if (plan.stage !== "EXACT" && intent.budget.value?.approximate != null &&
          intent.budget.value.min == null && intent.budget.value.max == null) {
        // V2 may use approximatePrice to narrow retrieval. The later lexical
        // pass may omit that *preference* to see useful nearby prices; parsed
        // intent and all genuinely hard requirements remain unchanged.
        v2Intent.approximatePrice = undefined;
        v2Intent.raw = plan.query;
      }
      const response = await searchV2({
        ...request,
        query: plan.query,
        searchMode: "intent",
        intent: { ...request.intent, ...v2Intent },
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
        strategyById.set(product.canonical.id, `${plan.stage}:${plan.strategy}`);
      }
      evaluated = evaluatePhase1Candidates(intent, [...candidates.values()], strategyById);
      const relevantAlternative = evaluated.alternatives.some(
        (candidate) => candidate.classification !== "WEAK",
      );
      const verified = evaluated.qualifying.some((candidate) =>
        candidate.classification === "EXACT" || candidate.classification === "PROBABLE_EXACT",
      );
      // Always inspect the lexical stage for an explicit identifier: the exact
      // ID alone can miss another merchant's offer or a stronger title match.
      const identifier = [intent.model, intent.sku, intent.mpn, intent.oem, intent.gtin14]
        .some((field) => field.evidence === "USER_EXPLICIT" && field.value !== null);
      if (verified && (!identifier || plan.stage !== "EXACT")) break;
      // An approximate price is a preference, not a hard cap. A lexical
      // second pass can surface a useful offer just beyond that preference.
      const needsSoftBudgetComparison = intent.budget.value?.approximate != null &&
        plan.stage === "EXACT";
      if (!identifier && !needsSoftBudgetComparison &&
          (evaluated.qualifying.length || relevantAlternative)) break;
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

  const alternatives = evaluated.alternatives.filter(
    (candidate) => candidate.classification === "CLOSE_ALTERNATIVE" ||
      candidate.classification === "SIMILAR",
  );
  const identityGroups = evaluated.identityGroups ?? [];
  const byOffer = new Map(
    [...evaluated.qualifying, ...alternatives].map((candidate) =>
      [`${candidate.product.providerId}:${candidate.product.canonical.id}`, candidate]),
  );
  const comparisonEvidence: Phase1SearchResult["comparisonEvidence"] = [];
  if (intent.relations.value?.includes("cheaper")) {
    // Descriptive title/variant grouping alone is NOT proof of a comparable
    // product. Demand a checksum-valid GTIN-14 explicitly verified on both
    // listings, current prices, explicit stock and agreeing condition/color.
    // A lower listed price is never presented as a saving against an inferred
    // user-owned reference offer.
    for (const group of identityGroups) {
      for (const variant of group.variants) {
        const eligible = variant.offers.flatMap((offer) => {
          const candidate = byOffer.get(offer.id);
          if (!candidate || !["EXACT", "PROBABLE_EXACT"].includes(candidate.classification) ||
              candidate.constraints.gtin14?.status !== "verified_pass") return [];
          const product = candidate.product.canonical;
          const age = product.updatedAt ? Date.now() - Date.parse(product.updatedAt) : NaN;
          if (product.availability !== "in_stock" || product.price == null ||
              !Number.isFinite(product.price) || product.price <= 0 || !product.currency ||
              !Number.isFinite(age) || age < -300_000 || age > 30 * 24 * 60 * 60 * 1000) return [];
          return [{
            candidate, price: product.price, currency: product.currency,
            condition: product.condition, color: product.color,
          }];
        });
        for (const cheaper of eligible) {
          const reference = eligible
            .filter((other) =>
              other.currency === cheaper.currency && other.price > cheaper.price &&
              other.condition === cheaper.condition && other.color === cheaper.color)
            .sort((a, b) => b.price - a.price)[0];
          if (!reference) continue;
          comparisonEvidence.push({
            cheaperOfferId: cheaper.candidate.product.id,
            referenceOfferId: reference.candidate.product.id,
            currency: cheaper.currency,
            difference: reference.price - cheaper.price,
          });
        }
      }
    }
  }
  const cheaperIds = new Set(comparisonEvidence.map((item) => item.cheaperOfferId));
  const results = intent.relations.value?.includes("cheaper")
    ? [...evaluated.qualifying, ...alternatives].filter((candidate) => cheaperIds.has(candidate.product.id))
    : [...evaluated.qualifying, ...alternatives];
  const sourceConflicts = new Map<string, Set<string>>();
  for (const product of candidates.values()) {
    const key = `${product.canonical.merchant ?? product.merchant ?? ""}|${product.canonical.title}`;
    const conditions = sourceConflicts.get(key) ?? new Set<string>();
    if (product.canonical.condition) conditions.add(product.canonical.condition);
    sourceConflicts.set(key, conditions);
  }
  const conflicting = [...sourceConflicts.values()].some((conditions) => conditions.size > 1);
  // Source disagreement about the same merchant/listing means product-level
  // identity is at most probable until the offer's condition is reconciled.
  const visibleResults = results.map((candidate) => {
    if (conflicting && candidate.classification === "EXACT") {
      return {
        ...candidate,
        classification: "PROBABLE_EXACT" as const,
        evidence: [...candidate.evidence, "The same merchant/title has conflicting condition reports across sources."],
      };
    }
    return candidate;
  });
  const state: Phase1SearchState = conflicting
    ? "CONFLICTING_EVIDENCE"
    : visibleResults.length
      ? "RESULTS_FOUND"
    : partialCoverage
      ? "PROVIDER_UNAVAILABLE"
      : "NO_CONFIDENT_MATCH";

  return {
    state, intent, plannedQueries, executedQueries, results: visibleResults, alternatives,
    identityGroups, comparisonEvidence,
    rejected: evaluated.rejected, providerErrors: [...providerErrors],
    partialCoverage, clarificationReasons: [
      ...intent.clarificationReasons,
      ...(conflicting ? ["Listings with the same merchant and title report conflicting conditions; verify the offer."] : []),
      ...(intent.relations.value?.includes("cheaper") && !comparisonEvidence.length
        ? ["No verified lower-priced same-variant offer is available; provide a comparable reference offer if needed."] : []),
    ],
  };
}