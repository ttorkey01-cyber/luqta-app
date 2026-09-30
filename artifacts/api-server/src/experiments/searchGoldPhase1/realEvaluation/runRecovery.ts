import { createHash } from "node:crypto";
import { appendFile, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  NormalizedProduct,
  ProviderSearchRequest,
  SearchProvider,
} from "../../../connectors/types";
import type {
  SearchOrchestrationResult,
  SearchStageLogger,
} from "../../../connectors/searchOrchestrator";

const CASES_SHA256 =
  "4359419400333f3a2831cc30efe65c9be4bea90cf19732b3e4e51dceb6a895f8";
const IMPLEMENTATION_SHA256 =
  "185c7de62040c06516983028a7d4807cfb7411efd95e8ddbbda9f62becc41450";
const PREFLIGHT_MAX_WAIT_MS = 4 * 60 * 1_000;
const IMPLEMENTATION_FILES = [
  "src/experiments/searchGoldPhase1/phase1Intent.ts",
  "src/experiments/searchGoldPhase1/queryPlanner.ts",
  "src/experiments/searchGoldPhase1/candidateEvaluation.ts",
  "src/experiments/searchGoldPhase1/phase1Search.ts",
  "src/connectors/searchOrchestrator.ts",
  "src/connectors/providerRegistry.ts",
  "src/connectors/intentParser.ts",
  "src/connectors/queryExpansion.ts",
  "src/connectors/rankingService.ts",
  "src/connectors/braveWebSearchProvider.ts",
] as const;
const FROZEN_HEADER =
  "/** Immutable evaluation control copied from the frozen Phase 1B implementation. Do not edit behavior. */\n";
const ARM_ORDERS = [
  ["v2", "phase1b", "recovery"],
  ["v2", "recovery", "phase1b"],
  ["phase1b", "v2", "recovery"],
  ["phase1b", "recovery", "v2"],
  ["recovery", "v2", "phase1b"],
  ["recovery", "phase1b", "v2"],
] as const;

type ArmName = (typeof ARM_ORDERS)[number][number];
type SafeProviderMetadata = {
  id: string;
  name: string;
  enabled: boolean;
  searchEnabled: boolean;
  integrationType: string;
  country: string;
  currency: string;
  integrationStatus: string;
};
type SafeError = { type: string; message: string | null };
type ProviderMetrics = {
  braveRequests: number;
  braveCacheHits: number;
  braveFallbackTriggered: number;
};
type PhaseCandidate = {
  product: NormalizedProduct;
  classification: string;
  score: number;
  strategy: string | null;
  constraints: Record<string, unknown>;
  evidence: string[];
  source: string;
  diagnostics?: string[];
};
type PhaseResult = {
  state: string;
  results: PhaseCandidate[];
  alternatives: PhaseCandidate[];
  rejected: PhaseCandidate[];
  intent: unknown;
  plannedQueries: unknown;
  executedQueries: unknown;
  providerErrors: string[];
  partialCoverage: boolean;
  clarificationReasons: string[];
  comparisonEvidence: Array<{
    cheaperOfferId: string;
    referenceOfferId: string;
    currency: string;
    difference: number;
  }>;
  candidateTransitions?: Array<{
    candidateId: string;
    stage: string;
    reasonCode: string;
  }>;
};
type SearchFunction = (
  request: ProviderSearchRequest,
  searchV2: (request: ProviderSearchRequest) => Promise<SearchOrchestrationResult>,
) => Promise<unknown>;

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(moduleDirectory, "../../../../../../");
const apiRoot = resolve(repositoryRoot, "artifacts/api-server");
const casesPath = resolve(moduleDirectory, "cases.json");
const URL_PATTERN =
  /\b(?:https?:\/\/|www\.)\S+|\b(?:[\w-]+\.)+(?:com|net|org|sa|co|io|shop|store)(?:\/\S*)?/giu;

function cleanText(value: unknown, maxLength = 500): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(URL_PATTERN, "[URL removed]").replace(/\s+/gu, " ").trim();
  return cleaned.slice(0, maxLength);
}

function safeError(error: unknown): SafeError {
  return {
    type: error instanceof Error ? error.name : "UnknownError",
    message: cleanText(error instanceof Error ? error.message : String(error)),
  };
}

function safeMetadata(metadata: SafeProviderMetadata) {
  return {
    id: cleanText(metadata.id),
    name: cleanText(metadata.name),
    enabled: metadata.enabled,
    searchEnabled: metadata.searchEnabled,
    integrationType: metadata.integrationType,
    country: metadata.country,
    currency: metadata.currency,
    integrationStatus: metadata.integrationStatus,
  };
}

function safeProductId(product: NormalizedProduct) {
  const idMaterial = `${product.providerId}\u0000${product.canonical.id}\u0000${product.id}`;
  return createHash("sha256").update(idMaterial).digest("hex").slice(0, 24);
}

function safeProduct(product: NormalizedProduct) {
  const canonical = product.canonical;
  return {
    id: safeProductId(product),
    providerId: cleanText(product.providerId),
    title: cleanText(canonical.title || product.title, 300),
    description: cleanText(canonical.description || product.description, 300),
    brand: cleanText(canonical.brand || product.brand, 160),
    productType: cleanText(canonical.productType || product.productType, 160),
    category: cleanText(canonical.category || product.category, 100),
    color: cleanText(canonical.color || product.color, 100),
    price: canonical.price ?? product.price ?? null,
    currency: cleanText(canonical.currency || product.currency, 12),
    condition: canonical.condition ?? product.condition ?? null,
    location: cleanText(canonical.location || product.location, 160),
    availability: canonical.availability ?? product.availability ?? null,
    updatedAt: cleanText(canonical.updatedAt || product.updatedAt, 80),
    sourceType: cleanText(canonical.sourceType || product.sourceType, 100),
    merchant: cleanText(canonical.merchant || product.merchant, 160),
  };
}

function safeJsonValue(value: unknown): unknown {
  if (typeof value === "string") return cleanText(value);
  if (Array.isArray(value)) return value.map(safeJsonValue);
  if (value && typeof value === "object") {
    const safe: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (/(?:url|affiliate|image|secret|api.?key|token|credential)/iu.test(key)) continue;
      safe[key] = safeJsonValue(child);
    }
    return safe;
  }
  return value;
}

function safeTrace(trace: Array<{ stage: string; details: Record<string, unknown> }>) {
  return trace.map(({ stage, details }) => ({
    stage: cleanText(stage, 100),
    details: safeJsonValue(details),
  }));
}

function providerContributions(
  products: Array<{ providerId: string | null }>,
  providerTypes: Map<string, string>,
) {
  const counts: Record<string, number> = {};
  let feedProducts = 0;
  let webProducts = 0;
  for (const product of products) {
    const providerId = product.providerId ?? "unknown";
    counts[providerId] = (counts[providerId] ?? 0) + 1;
    const type = providerTypes.get(providerId);
    if (type === "web_search") webProducts += 1;
    else if (type && type !== "mock_local") feedProducts += 1;
  }
  return { providerProductCounts: counts, feedProducts, webProducts };
}

function parseArguments(args: string[]) {
  let limit = 40;
  let offset = 0;
  let outputPath: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--limit" || argument === "--offset" || argument === "--output") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
      index += 1;
      if (argument === "--output") outputPath = resolve(value);
      else {
        const numeric = Number(value);
        if (!Number.isInteger(numeric)) throw new Error(`${argument} must be an integer`);
        if (argument === "--limit") limit = numeric;
        else offset = numeric;
      }
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (limit < 1 || limit > 40) throw new Error("--limit must be between 1 and 40");
  if (offset < 0 || offset > 39 || offset + limit > 40) {
    throw new Error("--offset and --limit must select cases within the 40 preregistered cases");
  }
  return { limit, offset, outputPath };
}

function normalizedFrozenImplementationBytes(bytes: Buffer, file: string) {
  const source = bytes.toString("utf8");
  if (!source.startsWith(FROZEN_HEADER)) {
    throw new Error(`Refusing to search: unexpected frozen clone header in ${file}`);
  }
  return Buffer.from(
    source.slice(FROZEN_HEADER.length).replaceAll("../../../connectors/", "../../connectors/"),
    "utf8",
  );
}

export async function verifyFrozenInputs() {
  const casesBytes = await readFile(casesPath);
  const casesSha = createHash("sha256").update(casesBytes).digest("hex");
  if (casesSha !== CASES_SHA256) {
    throw new Error(`Refusing to search: cases.json SHA-256 mismatch (${casesSha})`);
  }

  let checksumOutput = "";
  for (const file of IMPLEMENTATION_FILES) {
    const isFrozenClone = file.startsWith("src/experiments/searchGoldPhase1/");
    const path = isFrozenClone
      ? resolve(apiRoot, "src/experiments/searchGoldPhase1/frozenPhase1b", file.split("/").at(-1)!)
      : resolve(apiRoot, file);
    const bytes = await readFile(path);
    const normalized = isFrozenClone
      ? normalizedFrozenImplementationBytes(bytes, file)
      : bytes;
    const fileSha = createHash("sha256").update(normalized).digest("hex");
    checksumOutput += `${fileSha}  artifacts/api-server/${file}\n`;
  }
  const implementationSha = createHash("sha256").update(checksumOutput).digest("hex");
  if (implementationSha !== IMPLEMENTATION_SHA256) {
    throw new Error(
      `Refusing to search: frozen implementation fingerprint mismatch (${implementationSha})`,
    );
  }
  return JSON.parse(casesBytes.toString("utf8")) as {
    schemaVersion: number;
    implementationCommit: string;
    cases: Array<{ id: number; query: string }>;
  };
}

function usageMetrics(brave: { getUsageMetrics(): ProviderMetrics }) {
  return brave.getUsageMetrics();
}

function metricDelta(before: ProviderMetrics, after: ProviderMetrics) {
  return {
    braveRequests: after.braveRequests - before.braveRequests,
    braveCacheHits: after.braveCacheHits - before.braveCacheHits,
    braveFallbackTriggered: after.braveFallbackTriggered - before.braveFallbackTriggered,
  };
}

function preflightReadiness(provider: {
  getSearchIndexReadiness?: () => {
    ready: boolean;
    productCount: number;
    refreshing: boolean;
    lastSuccessfulSync: string | null;
  };
}) {
  try {
    const readiness = provider.getSearchIndexReadiness?.();
    return {
      ready: readiness?.ready ?? null,
      indexedProductCount: readiness?.productCount ?? null,
      refreshing: readiness?.refreshing ?? null,
      lastSuccessfulSync: readiness?.lastSuccessfulSync ?? null,
      error: null as SafeError | null,
    };
  } catch (error) {
    return {
      ready: null,
      indexedProductCount: null,
      refreshing: null,
      lastSuccessfulSync: null,
      error: safeError(error),
    };
  }
}

async function preflightSearchIndexes(providers: SearchProvider[]) {
  const eligible = providers.filter(
    (provider) =>
      provider.metadata.integrationType !== "mock_local" &&
      typeof provider.ensureSearchIndexReady === "function",
  );
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const entries = eligible.map((provider) => ({
    providerId: cleanText(provider.metadata.id, 150),
    startedAt: new Date().toISOString(),
    startReadiness: preflightReadiness(provider),
    endReadiness: null as ReturnType<typeof preflightReadiness> | null,
    endedAt: null as string | null,
    durationMs: null as number | null,
    error: null as SafeError | null,
    timedOut: false,
    completed: false,
  }));
  const tasks = eligible.map(async (provider, index) => {
    const entry = entries[index];
    const providerStarted = performance.now();
    try {
      await provider.ensureSearchIndexReady?.();
    } catch (error) {
      entry.error = safeError(error);
    } finally {
      entry.durationMs = Number((performance.now() - providerStarted).toFixed(2));
      entry.endReadiness = preflightReadiness(provider);
      entry.endedAt = new Date().toISOString();
      entry.completed = true;
    }
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const allSettled = Promise.all(tasks).then(() => "complete" as const);
  const timedOut = await Promise.race([
    allSettled.then(() => false),
    new Promise<boolean>((resolveTimeout) => {
      timer = setTimeout(() => resolveTimeout(true), PREFLIGHT_MAX_WAIT_MS);
    }),
  ]);
  if (timer) clearTimeout(timer);
  if (timedOut) {
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (entry.completed) continue;
      entry.timedOut = true;
      entry.durationMs = Number((performance.now() - started).toFixed(2));
      entry.endReadiness = preflightReadiness(eligible[index]);
      entry.endedAt = new Date().toISOString();
    }
  }
  const endedAt = new Date().toISOString();
  const records = entries.map(({ completed: _completed, ...entry }) => entry);
  return {
    startedAt,
    endedAt,
    durationMs: Number((performance.now() - started).toFixed(2)),
    timeoutMs: PREFLIGHT_MAX_WAIT_MS,
    timedOut,
    importAttemptCount: eligible.length,
    importAttemptCountNote:
      "Count of ensureSearchIndexReady invocations only; not a count of HTTP feed fetches.",
    errorCount: entries.filter(
      (entry) =>
        entry.error !== null ||
        entry.startReadiness.error !== null ||
        entry.endReadiness?.error !== null,
    ).length,
    errors: entries.flatMap((entry) =>
      [
        entry.error
          ? { providerId: entry.providerId, stage: "ensureSearchIndexReady", error: entry.error }
          : null,
        entry.startReadiness.error
          ? { providerId: entry.providerId, stage: "startReadiness", error: entry.startReadiness.error }
          : null,
        entry.endReadiness?.error
          ? { providerId: entry.providerId, stage: "endReadiness", error: entry.endReadiness.error }
          : null,
      ].filter((item): item is NonNullable<typeof item> => item !== null),
    ),
    providers: records,
  };
}

async function runV2(
  query: string,
  orchestrator: {
    searchWithMetadata(
      request: ProviderSearchRequest,
      trace?: SearchStageLogger,
    ): Promise<SearchOrchestrationResult>;
  },
  brave: { getUsageMetrics(): ProviderMetrics },
  providerTypes: Map<string, string>,
) {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const metricsBefore = usageMetrics(brave);
  const trace: Array<{ stage: string; details: Record<string, unknown> }> = [];
  try {
    const response = await orchestrator.searchWithMetadata(
      { query, searchMode: "intent" },
      (stage, details) => trace.push({ stage, details: details ?? {} }),
    );
    const products = response.products;
    const providerTimings = response.__timings?.providerTimings ?? [];
    return {
      state: "COMPLETED",
      startedAt,
      endedAt: new Date().toISOString(),
      products: products.map(safeProduct),
      elapsedMs: Number((performance.now() - started).toFixed(2)),
      fallbackStatus: response.fallbackStatus ?? null,
      timings: safeJsonValue(response.__timings ?? null),
      trace: safeTrace(trace),
      providerErrors: providerTimings
        .filter((timing) => timing.timedOut || timing.errorType || timing.ready === false)
        .map((timing) => ({
          providerId: cleanText(timing.providerId, 150),
          errorType: timing.errorType ?? null,
          errorMessage: cleanText(timing.errorMessage),
          timedOut: timing.timedOut,
          ready: timing.ready,
        })),
      partialCoverage: providerTimings.some(
        (timing) => timing.timedOut || timing.errorType || timing.ready === false,
      ),
      contributions: providerContributions(products, providerTypes),
      braveUsage: metricDelta(metricsBefore, usageMetrics(brave)),
    };
  } catch (error) {
    return {
      state: "ERROR",
      startedAt,
      endedAt: new Date().toISOString(),
      products: [] as NormalizedProduct[],
      elapsedMs: Number((performance.now() - started).toFixed(2)),
      error: safeError(error),
      trace: safeTrace(trace),
      partialCoverage: true,
      contributions: providerContributions([], providerTypes),
      braveUsage: metricDelta(metricsBefore, usageMetrics(brave)),
    };
  }
}

async function runPhaseArm(
  query: string,
  search: SearchFunction,
  orchestrator: {
    searchWithMetadata(
      request: ProviderSearchRequest,
      trace?: SearchStageLogger,
    ): Promise<SearchOrchestrationResult>;
  },
  brave: { getUsageMetrics(): ProviderMetrics },
  providerTypes: Map<string, string>,
) {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const metricsBefore = usageMetrics(brave);
  const calls: Array<Record<string, unknown>> = [];
  const contributedProducts: NormalizedProduct[] = [];
  const searchV2 = async (request: ProviderSearchRequest) => {
    const callStartedAt = new Date().toISOString();
    const callStarted = performance.now();
    const trace: Array<{ stage: string; details: Record<string, unknown> }> = [];
    try {
      const response = await orchestrator.searchWithMetadata(request, (stage, details) =>
        trace.push({ stage, details: details ?? {} }),
      );
      contributedProducts.push(...response.products);
      calls.push({
        startedAt: callStartedAt,
        endedAt: new Date().toISOString(),
        query: cleanText(request.query, 300),
        elapsedMs: Number((performance.now() - callStarted).toFixed(2)),
        fallbackStatus: response.fallbackStatus ?? null,
        timings: safeJsonValue(response.__timings ?? null),
        trace: safeTrace(trace),
        productCount: response.products.length,
        contributions: providerContributions(response.products, providerTypes),
        providerErrors: response.__timings?.providerTimings
          .filter((timing) => timing.timedOut || timing.errorType || timing.ready === false)
          .map((timing) => ({
            providerId: cleanText(timing.providerId, 150),
            errorType: timing.errorType ?? null,
            errorMessage: cleanText(timing.errorMessage),
            timedOut: timing.timedOut,
            ready: timing.ready,
          })) ?? [],
      });
      return response;
    } catch (error) {
      calls.push({
        startedAt: callStartedAt,
        endedAt: new Date().toISOString(),
        query: cleanText(request.query, 300),
        elapsedMs: Number((performance.now() - callStarted).toFixed(2)),
        error: safeError(error),
        trace: safeTrace(trace),
      });
      throw error;
    }
  };
  try {
    const result = (await search({ query, searchMode: "intent" }, searchV2)) as PhaseResult;
    const visible = result.results;
    const idByOfferId = new Map<string, string>();
    for (const candidate of [...result.results, ...result.alternatives, ...result.rejected]) {
      idByOfferId.set(candidate.product.id, safeProductId(candidate.product));
    }
    for (const product of contributedProducts) {
      idByOfferId.set(product.id, safeProductId(product));
    }
    const annotations = (candidates: PhaseCandidate[]) =>
      candidates.map((candidate) => ({
        id: safeProductId(candidate.product),
        classification: candidate.classification,
        score: candidate.score,
        strategy: candidate.strategy,
        constraints: safeJsonValue(candidate.constraints),
        evidence: candidate.evidence.map((item) => cleanText(item, 300)),
        source: cleanText(candidate.source, 150),
        ...(candidate.diagnostics
          ? { diagnostics: candidate.diagnostics.map((item) => cleanText(item, 300)) }
          : {}),
      }));
    const safeTransitions = (result.candidateTransitions ?? []).map((transition) => ({
      candidateId: idByOfferId.get(transition.candidateId) ?? createHash("sha256")
        .update(transition.candidateId)
        .digest("hex")
        .slice(0, 24),
      stage: cleanText(transition.stage, 80),
      reasonCode: cleanText(transition.reasonCode, 150),
    }));
    const displayedAnnotations = annotations(visible);
    return {
      state: result.state,
      startedAt,
      endedAt: new Date().toISOString(),
      products: visible.map((candidate) => safeProduct(candidate.product)),
      elapsedMs: Number((performance.now() - started).toFixed(2)),
      partialCoverage: result.partialCoverage,
      intent: safeJsonValue(result.intent),
      plannedQueries: safeJsonValue(result.plannedQueries),
      executedQueries: safeJsonValue(result.executedQueries),
      providerErrors: result.providerErrors.map((item) => cleanText(item, 150)),
      clarificationReasons: result.clarificationReasons.map((item) => cleanText(item, 300)),
      calls,
      fallbackStatus: calls.map((call) => call.fallbackStatus ?? null),
      contributions: providerContributions(contributedProducts, providerTypes),
      displayedContributions: providerContributions(
        visible.map((candidate) => candidate.product),
        providerTypes,
      ),
      braveUsage: metricDelta(metricsBefore, usageMetrics(brave)),
      candidateAnnotations: {
        displayed: displayedAnnotations,
        rejected: annotations(result.rejected),
        comparisonEvidence: result.comparisonEvidence.map((item) => ({
          cheaperOfferId: idByOfferId.get(item.cheaperOfferId) ?? null,
          referenceOfferId: idByOfferId.get(item.referenceOfferId) ?? null,
          currency: cleanText(item.currency, 12),
          difference: item.difference,
        })),
        exactAssertions: displayedAnnotations
          .filter((candidate) => candidate.classification === "EXACT")
          .map((candidate) => ({
            candidateId: candidate.id,
            assertedExact: true,
            evidence: candidate.evidence,
          })),
      },
      candidateTransitions: safeTransitions,
    };
  } catch (error) {
    return {
      state: "ERROR",
      startedAt,
      endedAt: new Date().toISOString(),
      products: [] as NormalizedProduct[],
      elapsedMs: Number((performance.now() - started).toFixed(2)),
      error: safeError(error),
      calls,
      partialCoverage: true,
      contributions: providerContributions(contributedProducts, providerTypes),
      braveUsage: metricDelta(metricsBefore, usageMetrics(brave)),
      candidateTransitions: [] as Array<{
        candidateId: string;
        stage: string;
        reasonCode: string;
      }>,
    };
  }
}

export async function runRecovery(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  // Verify both preregistered inputs before importing the warmed live registry.
  const preregistration = await verifyFrozenInputs();
  if (preregistration.cases.length !== 40) {
    throw new Error(`Refusing to search: expected 40 cases, found ${preregistration.cases.length}`);
  }
  const startedAt = new Date().toISOString();
  const outputPath =
    options.outputPath ??
    resolve(moduleDirectory, `recovery-observations-${startedAt.replace(/[:.]/gu, "-")}.json`);
  await stat(dirname(outputPath)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      throw new Error(`Output directory does not exist: ${dirname(outputPath)}`);
    }
    throw error;
  });
  try {
    await stat(outputPath);
    throw new Error(`Refusing to search: output file already exists (${outputPath})`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const [
    { providerRegistry, searchOrchestrator, braveWebSearchProvider },
    { searchGoldPhase1: searchRecovery },
    { searchGoldPhase1: searchPhase1B },
  ] = await Promise.all([
    import("../../../connectors/index"),
    import("../phase1Search"),
    import("../frozenPhase1b/phase1Search"),
  ]);
  const sourceProviders: SafeProviderMetadata[] = providerRegistry
    .list()
    .filter((provider) => provider.enabled && provider.searchEnabled)
    .map((provider) => ({
      id: provider.id,
      name: provider.name,
      enabled: provider.enabled,
      searchEnabled: provider.searchEnabled,
      integrationType: provider.integrationType,
      country: provider.country,
      currency: provider.currency,
      integrationStatus: provider.integrationStatus,
    }));
  if (
    braveWebSearchProvider.metadata.enabled &&
    braveWebSearchProvider.metadata.searchEnabled &&
    !sourceProviders.some((provider) => provider.id === braveWebSearchProvider.metadata.id)
  ) {
    sourceProviders.push({
      id: braveWebSearchProvider.metadata.id,
      name: braveWebSearchProvider.metadata.name,
      enabled: braveWebSearchProvider.metadata.enabled,
      searchEnabled: braveWebSearchProvider.metadata.searchEnabled,
      integrationType: braveWebSearchProvider.metadata.integrationType,
      country: braveWebSearchProvider.metadata.country,
      currency: braveWebSearchProvider.metadata.currency,
      integrationStatus: braveWebSearchProvider.metadata.integrationStatus,
    });
  }
  const providerTypes = new Map(sourceProviders.map((provider) => [provider.id, provider.integrationType]));
  // One shared registry is preflighted exactly once before any of the three arms.
  const sourceAvailability = await preflightSearchIndexes(providerRegistry.getSearchProviders());
  const selectedCases = preregistration.cases.slice(options.offset, options.offset + options.limit);
  const header = {
    schemaVersion: 1,
    runStartedAt: startedAt,
    preregisteredSchemaVersion: preregistration.schemaVersion,
    implementationCommit: preregistration.implementationCommit,
    caseSha256: CASES_SHA256,
    implementationSha256: IMPLEMENTATION_SHA256,
    selectedCaseIds: selectedCases.map((item) => item.id),
    selectedArmOrders: selectedCases.map((item) => ARM_ORDERS[(item.id - 1) % ARM_ORDERS.length]),
    sourceProviders: sourceProviders.map(safeMetadata),
    sourceAvailability,
  };
  await writeFile(
    outputPath,
    `${JSON.stringify(header).slice(0, -1)},"observations":[`,
    { encoding: "utf8", flag: "wx" },
  );

  try {
    for (let index = 0; index < selectedCases.length; index += 1) {
      const evaluationCase = selectedCases[index];
      const armOrder = ARM_ORDERS[(evaluationCase.id - 1) % ARM_ORDERS.length];
      const arms: Partial<Record<ArmName, Record<string, unknown>>> = {};
      const annotations: Partial<Record<ArmName, unknown>> = {};
      for (const arm of armOrder) {
        if (arm === "v2") {
          arms.v2 = await runV2(
            evaluationCase.query,
            searchOrchestrator,
            braveWebSearchProvider,
            providerTypes,
          );
        } else {
          const result = await runPhaseArm(
            evaluationCase.query,
            arm === "phase1b" ? searchPhase1B : searchRecovery,
            searchOrchestrator,
            braveWebSearchProvider,
            providerTypes,
          );
          const { candidateAnnotations, ...blindArm } = result;
          arms[arm] = blindArm;
          annotations[arm] = candidateAnnotations;
        }
      }
      const observation = {
        caseId: evaluationCase.id,
        query: evaluationCase.query,
        armOrder,
        arms,
        annotations,
      };
      await appendFile(
        outputPath,
        `${index === 0 ? "" : ","}${JSON.stringify(observation)}`,
        "utf8",
      );
    }
    await appendFile(
      outputPath,
      `],"runCompletedAt":${JSON.stringify(new Date().toISOString())}}`,
      "utf8",
    );
  } catch (error) {
    await appendFile(
      outputPath,
      `],"runCompletedAt":null,"runError":${JSON.stringify(safeError(error))}}`,
      "utf8",
    ).catch(() => undefined);
    throw error;
  }
  return { outputPath, observationCount: selectedCases.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runRecovery().then(
    ({ outputPath, observationCount }) => {
      process.stdout.write(`Recorded ${observationCount} recovery cases to ${outputPath}\n`);
    },
    (error: unknown) => {
      process.stderr.write(`${safeError(error).message ?? "Recovery evaluation failed"}\n`);
      process.exitCode = 1;
    },
  );
}