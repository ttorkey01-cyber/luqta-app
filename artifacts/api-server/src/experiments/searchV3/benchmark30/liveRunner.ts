import { pathToFileURL } from "node:url";
import { writeFile } from "node:fs/promises";
import { AffiliateLinkService } from "../../../connectors/affiliateLinkService";
import { BraveWebSearchProvider } from "../../../connectors/braveWebSearchProvider";
import { CacheService } from "../../../connectors/cacheService";
import { DeduplicationService } from "../../../connectors/deduplicationService";
import { createDefaultProviderRegistry, ProviderRegistry } from "../../../connectors/providerRegistry";
import { RankingService } from "../../../connectors/rankingService";
import { ResultNormalizer } from "../../../connectors/resultNormalizer";
import { SearchOrchestrator } from "../../../connectors/searchOrchestrator";
import type { NormalizedProduct, ProviderSearchRequest, SearchProvider } from "../../../connectors/types";
import { deterministicIntentParser } from "../../../connectors/intentParser";
import {
  ExperimentalSearchV3,
  type V3Request,
  type V3Diagnostics,
  type V3ProductResult,
} from "../index";
import { GeminiQueryImageInterpreter } from "./queryImageInterpreter";
import { REAL_WORLD_IMAGE_CASES } from "../realWorld/manifest";
import { normalizeImageUnderstanding } from "../../../routes/visionHelpers";
import { QUERY_IMAGE_REVIEWS } from "./imageReview";
import { SEARCH_V3_BENCHMARK_30, type Benchmark30Case } from "./groundTruth";

const MAX_IMAGE_BYTES = 1_000_000;
const IMAGE_TIMEOUT_MS = 12_000;
const GLOBAL_WALL_CLOCK_MS = 12 * 60_000;
const MAX_QUERY_IMAGE_INTERPRETATIONS = 9;
const MAX_PREWARM_MS = 90_000;
const REDIRECT_LIMIT = 3;
const WIKIMEDIA_HOSTS = new Set(["upload.wikimedia.org", "thumb.wikimedia.org"]);

type ImageType = "image/jpeg" | "image/png" | "image/webp";

export type Benchmark30ProductMetadata = {
  id: string;
  providerId: string;
  providerName: string;
  providerProductId: string | null;
  title: string;
  description: string | null;
  brand: string | null;
  productType: string | null;
  category: string | null;
  subcategory: string | null;
  audience: string | null;
  color: string | null;
  price: number | null;
  originalPrice: number | null;
  discount: number | null;
  currency: string | null;
  merchant: string | null;
  availability: string;
  condition: string | null;
  location: string | null;
  rating: number | null;
  reviewCount: number | null;
  score?: number;
  textScore?: number;
  identityScore?: number;
  hybridScore?: number;
  confidence?: string;
  visualStatus?: string;
};

export type Benchmark30Arm<TDiagnostics = unknown> = {
  status: "success" | "error" | "unscorable" | "not_attempted";
  latencyMs: number | null;
  products: Benchmark30ProductMetadata[] | null;
  diagnostics: TDiagnostics | null;
  error?: string;
};

type Benchmark30V2Diagnostics = {
  fallbackStatus?: string;
  providerTimings?: unknown;
  vision: {
    attempted: boolean;
    status: "success" | "error" | "not_applicable";
    interpretation?: unknown;
    error?: string;
  };
};

type Benchmark30V3GeminiDiagnostics = V3Diagnostics & {
  imageInterpretation?: unknown;
  geminiMetrics?: ReturnType<GeminiQueryImageInterpreter["getMetrics"]> | null;
};

export type Benchmark30Record = {
  caseId: string;
  group: Benchmark30Case["group"];
  query: string;
  scorable: boolean;
  unscorableReason?: string;
  queryImage: {
    available: boolean;
    mimeType?: ImageType;
    byteLength?: number;
    error?: string;
  };
  v2: Benchmark30Arm<Benchmark30V2Diagnostics>;
  v3Local: Benchmark30Arm<V3Diagnostics>;
  v3Gemini: Benchmark30Arm<Benchmark30V3GeminiDiagnostics>;
};

export type Benchmark30Report = {
  experiment: "search-v3-benchmark-30-live";
  generatedAt: string;
  caseCount: number;
  attemptedCaseCount: number;
  unscorableCaseCount: number;
  queryImageGeminiCallCeiling: number;
  geminiMetrics: {
    queryImageCalls: number;
    candidateImageCalls: 0;
    textCalls: 0;
    cacheHits: number;
    cacheMisses: number;
    failures: number;
    inputTokens: number;
    outputTokens: number;
  };
  candidateImageCalls: 0;
  automaticScoring: false;
  prewarm: {
    durationMs: number;
    timeoutMs: number;
    timedOut: boolean;
    providers: Array<{
      providerId: string;
      status: "ready" | "not_ready" | "error" | "timeout";
      ready: boolean;
      productCount: number | null;
      refreshing: boolean | null;
      error?: string;
    }>;
    cohortProviderIds: string[];
    blocker?: string;
  };
  blocker?: string;
  cases: Benchmark30Record[];
};

export type VisionInterpretation = {
  primaryCandidate: {
    name: string;
    query: string;
    confidence: number;
    productType: string | null;
    brand: string | null;
    color: string | null;
    attributes: string[];
  } | null;
  alternatives: Array<{
    name: string;
    query: string;
    confidence: number;
    productType: string | null;
    brand: string | null;
    color: string | null;
    attributes: string[];
  }>;
  confidence: number;
  needsConfirmation: boolean;
};

export type Benchmark30RunnerDependencies = {
  /** A fake registry can be supplied by offline tests; production creates one source registry. */
  sourceRegistry?: ProviderRegistry;
  prewarmTimeoutMs?: number;
  fetchQueryImage?: typeof fetch;
  interpretV2Image?: (input: {
    imageBytes: Uint8Array;
    mimeType: ImageType;
    apiKey: string;
    baseUrl: string;
    fetch?: typeof fetch;
  }) => Promise<VisionInterpretation>;
  interpretGeminiImage?: (input: {
    imageBytes: Uint8Array;
    apiKey: string;
    fetch?: typeof fetch;
  }) => ReturnType<GeminiQueryImageInterpreter["interpret"]>;
  searchV2?: (request: ProviderSearchRequest) => Promise<{
    products: NormalizedProduct[];
    fallbackStatus?: string;
    providerTimings?: unknown;
  }>;
  searchV3?: (request: V3Request) => Promise<{
    products: V3ProductResult[];
    diagnostics: V3Diagnostics;
  }>;
  now?: () => number;
};

export type RunBenchmark30Options = {
  /** Required by the Gemini image arm. Read by the CLI only; library callers inject it explicitly. */
  geminiApiKey: string;
  /** Required by the exact V2 /vision/interpret image-only duplicate. */
  openAiApiKey: string;
  openAiBaseUrl: string;
  braveApiKey?: string;
  fetch?: typeof fetch;
  limit?: number;
  dependencies?: Benchmark30RunnerDependencies;
};

function detectImageType(bytes: Uint8Array): ImageType | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "image/png";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "image/webp";
  return undefined;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown experiment error";
  return message
    .replace(/https?:\/\/[^\s)]+/giu, "[url]")
    .replace(/\b(key|token|authorization)\s*[:=]\s*\S+/giu, "$1=[redacted]")
    .slice(0, 180);
}

function imageManifestUrl(item: Benchmark30Case): string | undefined {
  const ref = item.imageReference;
  if (!ref) return undefined;
  const entry = REAL_WORLD_IMAGE_CASES.find((candidate) => candidate.id === ref.manifestCaseId);
  if (!entry) throw new Error(`Missing Wikimedia manifest entry for ${ref.manifestCaseId}`);
  const parsed = new URL(entry.imageUrl);
  if (parsed.protocol !== "https:" || !WIKIMEDIA_HOSTS.has(parsed.hostname)) {
    throw new Error(`Non-allowlisted Wikimedia URL for ${ref.manifestCaseId}`);
  }
  return entry.imageUrl;
}

async function readBoundedImage(response: Response): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
    throw new Error("Wikimedia query image exceeds the 1 MB limit");
  }
  if (!response.body) throw new Error("Wikimedia returned an empty image response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new Error("Wikimedia query image exceeds the 1 MB limit");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  const signatureType = detectImageType(bytes);
  if (!signatureType || (contentType && contentType !== signatureType)) {
    throw new Error("Wikimedia query image is not a validated JPEG, PNG, or WebP");
  }
  return bytes;
}

async function downloadQueryImage(url: string, fetcher: typeof fetch): Promise<{ bytes: Uint8Array; mimeType: ImageType }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  try {
    let currentUrl = url;
    for (let redirects = 0; redirects <= REDIRECT_LIMIT; redirects += 1) {
      const parsed = new URL(currentUrl);
      if (parsed.protocol !== "https:" || !WIKIMEDIA_HOSTS.has(parsed.hostname)) {
        throw new Error("Wikimedia redirect left the query-image allowlist");
      }
      const response = await fetcher(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects === REDIRECT_LIMIT) throw new Error("Wikimedia redirect limit exceeded");
        const location = response.headers.get("location");
        if (!location) throw new Error("Wikimedia redirect omitted its location");
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }
      if (!response.ok) throw new Error(`Wikimedia query image failed (HTTP ${response.status})`);
      const bytes = await readBoundedImage(response);
      const mimeType = detectImageType(bytes);
      if (!mimeType) throw new Error("Wikimedia query image format could not be validated");
      return { bytes, mimeType };
    }
    throw new Error("Wikimedia redirect limit exceeded");
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Wikimedia query image exceeded its 12 second deadline");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const V2_IMAGE_PROMPT = [
  "Identify only the physical product genuinely visible in the supplied photo.",
  "Do not infer a product from the accompanying user text; that text is handled separately by search.",
  "If the object is unclear, small, occluded, or ambiguous, return primaryCandidate null or a low confidence score and provide at most three plausible alternatives.",
  "Never guess a brand or model. Set brand to null unless its mark is clearly legible in the image.",
  "Use concise Arabic labels and product-only search queries. Queries must never contain a brand or model; keep the product type generic and provide any clearly visible brand separately. Include only visually supported colors and attributes.",
  "Do not identify scenery, a room, a person, or a generic furniture item unless that object is actually the product in focus.",
  "Return one JSON object with primaryCandidate (name, query, confidence, productType, brand, color, attributes), alternatives (same candidate shape), and confidence.",
  "Use null for unsupported optional candidate facts and an empty array when there are no alternatives.",
].join(" ");

async function interpretV2Image(input: {
  imageBytes: Uint8Array;
  mimeType: ImageType;
  apiKey: string;
  baseUrl: string;
  fetch?: typeof fetch;
}): Promise<VisionInterpretation> {
  if (input.imageBytes.byteLength > MAX_IMAGE_BYTES) throw new Error("V2 query image exceeds the 1 MB limit");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await (input.fetch ?? fetch)(
      `${input.baseUrl.replace(/\/+$/u, "")}/chat/completions`,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-5-mini",
          reasoning_effort: "low",
          max_completion_tokens: 1800,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: V2_IMAGE_PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: "حلّل المنتج الظاهر في هذه الصورة." },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${input.mimeType};base64,${Buffer.from(input.imageBytes).toString("base64")}`,
                    detail: "low",
                  },
                },
              ],
            },
          ],
        }),
      },
    );
    if (!response.ok) throw new Error(`V2 image interpretation failed (HTTP ${response.status})`);
    const payload: unknown = await response.json();
    const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("V2 image interpretation returned invalid content");
    let modelResult: unknown;
    try {
      modelResult = JSON.parse(content);
    } catch {
      throw new Error("V2 image interpretation returned invalid JSON");
    }
    return normalizeImageUnderstanding(modelResult);
  } catch (error) {
    if (controller.signal.aborted) throw new Error("V2 image interpretation exceeded its 20 second deadline");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeProduct(product: NormalizedProduct | V3ProductResult["product"], scores?: V3ProductResult): Benchmark30ProductMetadata {
  return {
    id: product.id,
    providerId: "providerId" in product ? product.providerId : product.source ?? "unknown",
    providerName: "providerName" in product ? product.providerName : product.source ?? "unknown",
    providerProductId: product.providerProductId ?? null,
    title: product.title,
    description: product.description ?? null,
    brand: product.brand ?? null,
    productType: product.productType ?? null,
    category: product.category ?? null,
    subcategory: product.subcategory ?? null,
    audience: product.audience ?? null,
    color: product.color ?? null,
    price: product.price ?? null,
    originalPrice: product.originalPrice ?? null,
    discount: product.discount ?? null,
    currency: product.currency ?? null,
    merchant: product.merchant ?? null,
    availability: product.availability,
    condition: product.condition ?? null,
    location: product.location ?? null,
    rating: product.rating ?? null,
    reviewCount: product.reviewCount ?? null,
    ...(scores ? {
      score: scores.score,
      textScore: scores.textScore,
      identityScore: scores.identityScore,
      hybridScore: scores.hybridScore,
      confidence: scores.confidence,
      visualStatus: scores.visualStatus,
    } : {}),
  };
}

function safeImageInterpretation(value: VisionInterpretation) {
  return {
    primaryCandidate: value.primaryCandidate,
    alternatives: value.alternatives,
    confidence: value.confidence,
    needsConfirmation: value.needsConfirmation,
  };
}

function buildV2VisualQuery(query: string, interpretation: VisionInterpretation | undefined): string {
  // The stable camera flow searches the vision candidate's generic product query
  // together with the user's text; the explicit user text remains in the request.
  const visualQuery = interpretation?.primaryCandidate?.query?.trim();
  return visualQuery ? `${visualQuery} ${query}`.trim() : query;
}

function freezeUnscorable(caseId: string) {
  return QUERY_IMAGE_REVIEWS.find((review) => review.caseId === caseId && !review.usable);
}

function emptyArm<T>(
  status: "unscorable" | "not_attempted" | "error",
  error?: string,
): Benchmark30Arm<T> {
  return {
    status,
    latencyMs: null,
    products: null,
    diagnostics: null,
    ...(error ? { error } : {}),
  };
}

type ProviderPrewarmResult = Benchmark30Report["prewarm"] & {
  registry: ProviderRegistry;
};

async function prewarmProviderRegistry(
  sourceRegistry: ProviderRegistry,
  timeoutMs: number,
  now: () => number,
): Promise<ProviderPrewarmResult> {
  const providers = sourceRegistry.getSearchProviders().filter((provider) =>
    provider.metadata.integrationType !== "mock_local" &&
    provider.metadata.integrationType !== "web_search",
  );
  const startedAt = now();
  const completed = new Set<string>();
  const errors = new Map<string, string>();
  const tasks = providers.map(async (provider) => {
    try {
      if (provider.ensureSearchIndexReady) {
        await provider.ensureSearchIndexReady();
      } else if (provider.refreshIndex) {
        await provider.refreshIndex(false);
      }
      completed.add(provider.metadata.id);
    } catch (error) {
      completed.add(provider.metadata.id);
      errors.set(provider.metadata.id, safeError(error));
    }
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = await Promise.race([
    Promise.all(tasks).then(() => false),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), timeoutMs);
    }),
  ]);
  if (timer !== undefined) clearTimeout(timer);

  const statuses: Benchmark30Report["prewarm"]["providers"] = providers.map((provider) => {
    let readiness: ReturnType<NonNullable<SearchProvider["getSearchIndexReadiness"]>> | undefined;
    try {
      readiness = provider.getSearchIndexReadiness?.();
    } catch (error) {
      errors.set(provider.metadata.id, safeError(error));
    }
    const error = errors.get(provider.metadata.id);
    const incompleteAtTimeout = timedOut && !completed.has(provider.metadata.id);
    const ready = !error && !incompleteAtTimeout && (readiness?.ready ?? true);
    return {
      providerId: provider.metadata.id,
      status: error ? "error" : incompleteAtTimeout ? "timeout" : ready ? "ready" : "not_ready",
      ready,
      productCount: readiness?.productCount ?? null,
      refreshing: readiness?.refreshing ?? null,
      ...(error ? { error } : {}),
    };
  });
  const cohortProviderIds = statuses.filter((item) => item.status === "ready").map((item) => item.providerId);
  const blocker = cohortProviderIds.length
    ? undefined
    : "No enabled official provider was ready after bounded prewarm; search arms were not run";
  const readyIds = new Set(cohortProviderIds);
  const registry = new ProviderRegistry(providers.filter((provider) => readyIds.has(provider.metadata.id)));
  return {
    durationMs: Math.max(0, Number((now() - startedAt).toFixed(2))),
    timeoutMs,
    timedOut,
    providers: statuses,
    cohortProviderIds,
    ...(blocker ? { blocker } : {}),
    registry,
  };
}

function makeDefaultSearchers(
  options: RunBenchmark30Options,
  registry: ProviderRegistry,
  brave: BraveWebSearchProvider,
) {
  const v2 = new SearchOrchestrator(
    registry,
    new ResultNormalizer(),
    new DeduplicationService(),
    new RankingService(),
    new AffiliateLinkService(),
    new CacheService(),
    brave,
    deterministicIntentParser,
  );
  const v3 = new ExperimentalSearchV3({ registry, brave, enabled: true });
  return {
    searchV2: async (request: ProviderSearchRequest) => {
      const result = await v2.searchWithMetadata(request);
      return {
        products: result.products,
        fallbackStatus: result.fallbackStatus,
        providerTimings: result.__timings?.providerTimings,
      };
    },
    searchV3: (request: V3Request) => v3.search(request),
  };
}

export async function runBenchmark30(options: RunBenchmark30Options): Promise<Benchmark30Report> {
  if (!options || typeof options.geminiApiKey !== "string" || !options.geminiApiKey.trim()) {
    throw new Error("An explicit Gemini API key is required for the live benchmark");
  }
  if (typeof options.openAiApiKey !== "string" || !options.openAiApiKey.trim() || !options.openAiBaseUrl?.trim()) {
    throw new Error("Explicit OpenAI vision configuration is required for the live benchmark");
  }
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > SEARCH_V3_BENCHMARK_30.length)) {
    throw new Error(`--limit must be an integer from 1 to ${SEARCH_V3_BENCHMARK_30.length}`);
  }
  const dependencies = options.dependencies ?? {};
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  const sourceRegistry = dependencies.sourceRegistry ??
    createDefaultProviderRegistry({ startBackgroundRefresh: false });
  const prewarmTimeoutMs = Math.min(
    MAX_PREWARM_MS,
    Math.max(0, dependencies.prewarmTimeoutMs ?? MAX_PREWARM_MS),
  );
  const { registry, ...prewarm } = await prewarmProviderRegistry(
    sourceRegistry,
    prewarmTimeoutMs,
    now,
  );
  const imageInterpreter = new GeminiQueryImageInterpreter();
  const selectedLimit = options.limit ?? SEARCH_V3_BENCHMARK_30.length;
  if (!registry.list().length) {
    const cases = SEARCH_V3_BENCHMARK_30.map((item, index): Benchmark30Record => {
      const review = item.imageReference
        ? QUERY_IMAGE_REVIEWS.find((entry) => entry.caseId === item.id)
        : undefined;
      const unscorable = review && !review.usable ? review.exclusionReason ?? "Excluded by frozen image review" : undefined;
      const status = unscorable ? "unscorable" : "not_attempted";
      const reason = unscorable ??
        (index >= selectedLimit
          ? "Excluded by explicit --limit"
          : prewarm.blocker ?? "No ready official provider cohort");
      return {
        caseId: item.id,
        group: item.group,
        query: item.query,
        scorable: !unscorable,
        ...(unscorable ? { unscorableReason: unscorable } : {}),
        queryImage: { available: false },
        v2: unscorable ? emptyArm("unscorable") : emptyArm("not_attempted", reason),
        v3Local: unscorable ? emptyArm("unscorable") : emptyArm("not_attempted", reason),
        v3Gemini: unscorable ? emptyArm("unscorable") : emptyArm("not_attempted", reason),
      };
    });
    return {
      experiment: "search-v3-benchmark-30-live",
      generatedAt: new Date().toISOString(),
      caseCount: cases.length,
      attemptedCaseCount: 0,
      unscorableCaseCount: cases.filter((item) => !item.scorable).length,
      queryImageGeminiCallCeiling: MAX_QUERY_IMAGE_INTERPRETATIONS,
      geminiMetrics: imageInterpreter.getMetrics(),
      candidateImageCalls: 0,
      automaticScoring: false,
      prewarm,
      blocker: prewarm.blocker,
      cases,
    };
  }
  const fetcher = dependencies.fetchQueryImage ?? options.fetch ?? fetch;
  const brave = new BraveWebSearchProvider(options.braveApiKey);
  const defaultSearchers = dependencies.searchV2 && dependencies.searchV3
    ? undefined
    : makeDefaultSearchers(options, registry, brave);
  const searchV2 = dependencies.searchV2 ?? defaultSearchers!.searchV2;
  const searchV3 = dependencies.searchV3 ?? defaultSearchers!.searchV3;
  let queryGeminiCallBudget = 0;
  let geminiCalls = 0;
  let geminiStoppedReason: string | undefined;
  const imageCache = new Map<string, Promise<{ bytes: Uint8Array; mimeType: ImageType }>>();
  const records: Benchmark30Record[] = [];
  let injectedGeminiFailures = 0;
  let injectedGeminiCalls = 0;

  const runArm = async <T>(
    action: () => Promise<T>,
  ): Promise<{ status: "success" | "error"; latencyMs: number | null; result?: T; error?: string }> => {
    const now = dependencies.now ?? Date.now;
    if (now() - startedAt >= GLOBAL_WALL_CLOCK_MS) {
      return { status: "error", latencyMs: null, error: "Global 12 minute benchmark wall-clock limit reached" };
    }
    const armStarted = now();
    try {
      const result = await action();
      return { status: "success", latencyMs: Number((now() - armStarted).toFixed(2)), result };
    } catch (error) {
      return { status: "error", latencyMs: Number((now() - armStarted).toFixed(2)), error: safeError(error) };
    }
  };

  for (const [caseIndex, item] of SEARCH_V3_BENCHMARK_30.entries()) {
    const review = item.imageReference
      ? QUERY_IMAGE_REVIEWS.find((candidate) => candidate.caseId === item.id)
      : undefined;
    if (item.imageReference && !review) {
      throw new Error(`Frozen image review is missing for ${item.id}`);
    }
    const unscorable = review ? freezeUnscorable(item.id) : undefined;
    if (unscorable) {
      records.push({
        caseId: item.id,
        group: item.group,
        query: item.query,
        scorable: false,
        unscorableReason: unscorable.exclusionReason ?? "Excluded by frozen image review",
        queryImage: { available: false },
        v2: emptyArm("unscorable"),
        v3Local: emptyArm("unscorable"),
        v3Gemini: emptyArm("unscorable"),
      });
      continue;
    }
    if (caseIndex >= selectedLimit) {
      records.push({
        caseId: item.id,
        group: item.group,
        query: item.query,
        scorable: true,
        queryImage: { available: false },
        v2: emptyArm("not_attempted"),
        v3Local: emptyArm("not_attempted"),
        v3Gemini: emptyArm("not_attempted"),
      });
      continue;
    }
    if ((dependencies.now ?? Date.now)() - startedAt >= GLOBAL_WALL_CLOCK_MS) {
      records.push({
        caseId: item.id,
        group: item.group,
        query: item.query,
        scorable: true,
        queryImage: { available: false },
        v2: emptyArm("not_attempted", "Global 12 minute benchmark wall-clock limit reached before this case"),
        v3Local: emptyArm("not_attempted", "Global 12 minute benchmark wall-clock limit reached before this case"),
        v3Gemini: emptyArm("not_attempted", "Global 12 minute benchmark wall-clock limit reached before this case"),
      });
      continue;
    }
    let queryImage: Benchmark30Record["queryImage"] = { available: false };
    let image: { bytes: Uint8Array; mimeType: ImageType } | undefined;
    let imageFetchLatencyMs = 0;
    if (item.imageReference && !unscorable) {
      const fetchStartedAt = (dependencies.now ?? Date.now)();
      try {
        const url = imageManifestUrl(item);
        if (!url) throw new Error("Query image URL is missing");
        let pending = imageCache.get(url);
        if (!pending) {
          pending = downloadQueryImage(url, fetcher);
          imageCache.set(url, pending);
        }
        image = await pending;
        queryImage = { available: true, mimeType: image.mimeType, byteLength: image.bytes.byteLength };
      } catch (error) {
        queryImage = { available: false, error: safeError(error) };
      } finally {
        imageFetchLatencyMs = Number(((dependencies.now ?? Date.now)() - fetchStartedAt).toFixed(2));
      }
    }
    if (item.imageReference && !image) {
      records.push({
        caseId: item.id,
        group: item.group,
        query: item.query,
        scorable: false,
        unscorableReason: queryImage.error ?? "Verified query image was unavailable during this run",
        queryImage,
        v2: emptyArm("unscorable"),
        v3Local: emptyArm("unscorable"),
        v3Gemini: emptyArm("unscorable"),
      });
      continue;
    }

    let vision: VisionInterpretation | undefined;
    const visionResult = image
      ? await runArm(() => (dependencies.interpretV2Image ?? interpretV2Image)({
          imageBytes: image!.bytes,
          mimeType: image!.mimeType,
          apiKey: options.openAiApiKey,
          baseUrl: options.openAiBaseUrl,
          fetch: options.fetch,
        }))
      : undefined;
    if (visionResult?.status === "success") vision = visionResult.result;
    const v2Result = image && visionResult?.status !== "success"
      ? { status: "error" as const, latencyMs: null, error: "V2 query-image interpretation failed" }
      : await runArm(() => searchV2({
          query: buildV2VisualQuery(item.query, vision),
          searchMode: "intent",
        }));
    const v2: Benchmark30Arm<Benchmark30V2Diagnostics> = {
      status: v2Result.status,
      latencyMs: v2Result.latencyMs === null
        ? (visionResult?.latencyMs === null || visionResult?.latencyMs === undefined)
          ? null
          : Number((visionResult.latencyMs + imageFetchLatencyMs).toFixed(2))
        : Number((v2Result.latencyMs + (visionResult?.latencyMs ?? 0) + imageFetchLatencyMs).toFixed(2)),
      products: v2Result.result?.products.map((product) => normalizeProduct(product)) ?? null,
      diagnostics: {
        ...(v2Result.result?.fallbackStatus ? { fallbackStatus: v2Result.result.fallbackStatus } : {}),
        ...(v2Result.result?.providerTimings ? { providerTimings: v2Result.result.providerTimings } : {}),
        vision: image
          ? {
              attempted: true,
              status: visionResult?.status ?? "error",
              ...(vision ? { interpretation: safeImageInterpretation(vision) } : {}),
              ...(visionResult?.error ? { error: visionResult.error } : {}),
            }
          : { attempted: false, status: "not_applicable" },
      },
      ...(v2Result.error ? { error: v2Result.error } : {}),
    };

    const v3LocalRequest: V3Request = {
      query: item.query,
      ...(image ? { image: { identities: [], imageBytes: image.bytes, mimeType: image.mimeType } } : {}),
    };
    const localResult = await runArm(() => searchV3(v3LocalRequest));
    const localDiagnostics = localResult.result?.diagnostics;
    if (localDiagnostics && (localDiagnostics.visual.imageLoadCalls !== 0 || localDiagnostics.visual.adapterCallCount !== 0)) {
      throw new Error("V3-local violated the no-candidate-image safety invariant");
    }
    const v3Local: Benchmark30Arm<V3Diagnostics> = {
      status: localResult.status,
      latencyMs: localResult.latencyMs === null ? null : Number((localResult.latencyMs + imageFetchLatencyMs).toFixed(2)),
      products: localResult.result?.products.map((product) => normalizeProduct(product.product, product)) ?? null,
      diagnostics: localDiagnostics ?? null,
      ...(localResult.error ? { error: localResult.error } : {}),
    };

    let geminiInterpretation: Awaited<ReturnType<GeminiQueryImageInterpreter["interpret"]>> | undefined;
    let geminiInterpretationError: string | undefined;
    let geminiInterpretationLatency = 0;
    if (image) {
      if (geminiStoppedReason) {
        geminiInterpretationError = `Gemini calls stopped after an earlier failure: ${geminiStoppedReason}`;
      } else if (queryGeminiCallBudget >= MAX_QUERY_IMAGE_INTERPRETATIONS) {
        geminiInterpretationError = "Global query-image Gemini call ceiling reached";
      } else {
        queryGeminiCallBudget += 1;
        const interpretationStarted = (dependencies.now ?? Date.now)();
        try {
          injectedGeminiCalls += 1;
          geminiCalls += 1;
          geminiInterpretation = await (
            dependencies.interpretGeminiImage
              ? dependencies.interpretGeminiImage({ imageBytes: image.bytes, apiKey: options.geminiApiKey, fetch: options.fetch })
              : imageInterpreter.interpret({ imageBytes: image.bytes, apiKey: options.geminiApiKey, fetch: options.fetch })
          );
        } catch (error) {
          injectedGeminiFailures += 1;
          geminiInterpretationError = safeError(error);
          geminiStoppedReason = geminiInterpretationError;
        } finally {
          geminiInterpretationLatency = Number(((dependencies.now ?? Date.now)() - interpretationStarted).toFixed(2));
        }
      }
    }
    const explicitIdentity = Boolean(item.identityEvidence);
    const inferredImage = geminiInterpretation?.v3Image;
    const interpretedAttributes = geminiInterpretation
      ? [
          geminiInterpretation.category,
          geminiInterpretation.productType,
          geminiInterpretation.color,
          geminiInterpretation.style,
          geminiInterpretation.material,
          ...geminiInterpretation.attributes,
        ].filter((attribute): attribute is string => Boolean(attribute?.trim()))
      : [];
    const safeV3Image = inferredImage
      ? {
          ...inferredImage,
          description: [
            inferredImage.description,
            ...(interpretedAttributes.length
              ? [`Visually supported attributes: ${interpretedAttributes.join(", ")}`]
              : []),
          ].filter(Boolean).join(" "),
          // User-entered identifiers remain authoritative; do not add a competing inferred identity.
          identities: explicitIdentity
            ? inferredImage.identities.map((identity) => ({ label: identity.label, confidence: identity.confidence, color: identity.color }))
            : inferredImage.identities,
        }
      : undefined;
    const v3GeminiRequest: V3Request = {
      query: item.query,
      ...(image ? {
        image: {
          imageBytes: image.bytes,
          mimeType: image.mimeType,
          identities: [],
          ...(safeV3Image ? {
            identities: safeV3Image.identities,
            description: safeV3Image.description,
            extractedText: safeV3Image.extractedText,
          } : {}),
        },
      } : {}),
    };
    const geminiResult = image && !geminiInterpretation
      ? {
          status: geminiStoppedReason && queryGeminiCallBudget > 0 &&
            geminiInterpretationError?.startsWith("Gemini calls stopped")
            ? "not_attempted" as const
            : "error" as const,
          latencyMs: null,
          result: undefined,
          error: geminiInterpretationError ?? "Gemini query-image interpretation failed",
        }
      : await runArm(() => searchV3(v3GeminiRequest));
    const geminiDiagnostics = geminiResult.result?.diagnostics;
    if (geminiDiagnostics && (geminiDiagnostics.visual.imageLoadCalls !== 0 || geminiDiagnostics.visual.adapterCallCount !== 0)) {
      throw new Error("V3+Gemini violated the no-candidate-image safety invariant");
    }
    const metrics = dependencies.interpretGeminiImage
      ? null
      : imageInterpreter.getMetrics();
    const v3Gemini: Benchmark30Arm<Benchmark30V3GeminiDiagnostics> = {
      status: geminiResult.status,
      latencyMs: geminiResult.latencyMs === null
        ? null
        : Number((geminiResult.latencyMs + geminiInterpretationLatency + imageFetchLatencyMs).toFixed(2)),
      products: geminiResult.result?.products.map((product) => normalizeProduct(product.product, product)) ?? null,
      diagnostics: geminiDiagnostics
        ? {
            ...geminiDiagnostics,
            ...(geminiInterpretation ? { imageInterpretation: {
              category: geminiInterpretation.category,
              productType: geminiInterpretation.productType,
              brand: geminiInterpretation.brand,
              model: geminiInterpretation.model,
              color: geminiInterpretation.color,
              style: geminiInterpretation.style,
              material: geminiInterpretation.material,
              attributes: geminiInterpretation.attributes,
              extractedText: geminiInterpretation.extractedText,
              uncertainty: geminiInterpretation.uncertainty,
              confidence: geminiInterpretation.confidence,
              description: geminiInterpretation.description,
            } } : {}),
            geminiMetrics: metrics,
          }
        : null,
      ...(geminiInterpretationError ? { error: geminiInterpretationError } : {}),
      ...(geminiResult.error ? { error: geminiResult.error } : {}),
    };
    records.push({
      caseId: item.id,
      group: item.group,
      query: item.query,
      scorable: true,
      queryImage,
      v2,
      v3Local,
      v3Gemini,
    });
  }

  if (geminiCalls > MAX_QUERY_IMAGE_INTERPRETATIONS) {
    throw new Error("Global query-image Gemini call ceiling was exceeded");
  }
  const reviewsById = new Map(QUERY_IMAGE_REVIEWS.map((review) => [review.caseId, review]));
  const expectedUnscorable = SEARCH_V3_BENCHMARK_30.filter((item) => {
    const review = reviewsById.get(item.id);
    return Boolean(review && !review.usable);
  }).length;
  return {
    experiment: "search-v3-benchmark-30-live",
    generatedAt: new Date().toISOString(),
    caseCount: records.length,
    attemptedCaseCount: records.filter((record) =>
      record.scorable && [record.v2.status, record.v3Local.status, record.v3Gemini.status]
        .some((status) => status === "success" || status === "error"),
    ).length,
    unscorableCaseCount: records.filter((record) => !record.scorable).length,
    queryImageGeminiCallCeiling: MAX_QUERY_IMAGE_INTERPRETATIONS,
    geminiMetrics: dependencies.interpretGeminiImage
      ? {
          queryImageCalls: injectedGeminiCalls,
          candidateImageCalls: 0,
          textCalls: 0,
          cacheHits: 0,
          cacheMisses: injectedGeminiCalls,
          failures: injectedGeminiFailures,
          inputTokens: 0,
          outputTokens: 0,
        }
      : imageInterpreter.getMetrics(),
    candidateImageCalls: 0,
    automaticScoring: false,
    prewarm,
    ...(prewarm.blocker ? { blocker: prewarm.blocker } : {}),
    cases: records,
  };
}

async function cliMain(args: string[]) {
  if (!args.includes("--run")) {
    throw new Error("Live benchmark is opt-in. Rerun with --run; optionally add --limit N for a bounded dry run.");
  }
  const limitArg = args.indexOf("--limit");
  const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : undefined;
  const outputIndex = args.indexOf("--output");
  const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
  if (outputIndex >= 0 && (!outputPath || outputPath.startsWith("--"))) {
    throw new Error("--output requires a file path");
  }
  // Credentials are intentionally read only after explicit --run and are never logged.
  const geminiApiKey = process.env.GEMINI_API_KEY?.trim();
  const openAiApiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY?.trim();
  const openAiBaseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL?.trim();
  if (!geminiApiKey || !openAiApiKey || !openAiBaseUrl) {
    throw new Error("Set GEMINI_API_KEY and AI_INTEGRATIONS_OPENAI_API_KEY/AI_INTEGRATIONS_OPENAI_BASE_URL to run the image arms.");
  }
  const report = await runBenchmark30({
    geminiApiKey,
    openAiApiKey,
    openAiBaseUrl,
    braveApiKey: process.env.BRAVE_SEARCH_API_KEY?.trim(),
    limit,
  });
  if (outputPath) {
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write("Benchmark report saved.\n");
  } else {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cliMain(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${safeError(error)}\n`);
    process.exitCode = 1;
  });
}
