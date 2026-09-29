import { createHash } from "node:crypto";
import type { ImageEmbeddingProvider, VisualImage } from "./index";

const ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent";
const MODEL = "models/gemini-embedding-2";
const DEFAULT_DIMENSIONALITY = 768;
const MIN_DIMENSIONALITY = 128;
const MAX_DIMENSIONALITY = 3072;
const DEFAULT_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_CACHE_ENTRIES = 128;
const DEFAULT_CACHE_TTL_MS = 5 * 60_000;
const ESTIMATED_IMAGE_COST_USD = 0.00012;

type GeminiEmbedding2Options = {
  /** Requested Gemini embedding vector size. Defaults to 768. */
  outputDimensionality?: number;
  /** Maximum encoded image bytes sent to the API. */
  maxImageBytes?: number;
  /** Request deadline in milliseconds. */
  timeoutMs?: number;
  /** Maximum number of cached image embeddings. */
  cacheMaxEntries?: number;
  /** Cached embeddings expire after this many milliseconds. */
  cacheTtlMs?: number;
  /** Injectable transport for tests; defaults to server-side global fetch. */
  fetch?: typeof fetch;
};

export type GeminiEmbedding2Counters = Readonly<{
  imageCalls: number;
  queryImageCalls: number;
  candidateImageCalls: number;
  imageCacheHits: number;
  imageCacheMisses: number;
  imageInFlightDeduplications: number;
  textCalls: number;
  /** Estimate only, using $0.00012/image; this is not billing data. */
  estimatedImageCostUsd: number;
  /** Query and candidate contributions are reported separately. */
  estimatedQueryImageCostUsd: number;
  estimatedCandidateImageCostUsd: number;
}>;

type ImageFormat = { mimeType: "image/jpeg" | "image/png" | "image/webp" };
type CacheEntry = { vector: number[]; expiresAt: number };
type ImageRole = "query" | "candidate";

export class GeminiEmbedding2Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiEmbedding2Error";
  }
}

function imageFormat(bytes: Uint8Array): ImageFormat | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mimeType: "image/jpeg" };
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { mimeType: "image/png" };
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { mimeType: "image/webp" };
  }
  return undefined;
}

/**
 * Isolated real Gemini Embedding 2 adapter. The API key is supplied explicitly
 * by server-side construction and is never included in errors or counters.
 */
export class GeminiEmbedding2Provider implements ImageEmbeddingProvider {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<number[]>>();
  private readonly outputDimensionality: number;
  private readonly maxImageBytes: number;
  private readonly timeoutMs: number;
  private readonly cacheMaxEntries: number;
  private readonly cacheTtlMs: number;
  private readonly fetcher: typeof fetch;
  private imageCalls = 0;
  private queryImageCalls = 0;
  private candidateImageCalls = 0;
  private imageCacheHits = 0;
  private imageCacheMisses = 0;
  private imageInFlightDeduplications = 0;
  private textCalls = 0;
  private searchLockTail: Promise<void> = Promise.resolve();

  constructor(private readonly apiKey: string, options: GeminiEmbedding2Options = {}) {
    if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
      throw new GeminiEmbedding2Error("A server-side Gemini API key is required");
    }
    this.apiKey = apiKey.trim();
    this.outputDimensionality = options.outputDimensionality ?? DEFAULT_DIMENSIONALITY;
    if (
      !Number.isInteger(this.outputDimensionality) ||
      this.outputDimensionality < MIN_DIMENSIONALITY ||
      this.outputDimensionality > MAX_DIMENSIONALITY
    ) {
      throw new GeminiEmbedding2Error("Embedding dimensionality must be an integer from 128 to 3072");
    }
    this.maxImageBytes = options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.cacheMaxEntries = options.cacheMaxEntries ?? DEFAULT_CACHE_ENTRIES;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    if (!Number.isInteger(this.maxImageBytes) || this.maxImageBytes < 1) {
      throw new GeminiEmbedding2Error("Maximum image bytes must be a positive integer");
    }
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new GeminiEmbedding2Error("Request deadline must be a positive number of milliseconds");
    }
    if (!Number.isInteger(this.cacheMaxEntries) || this.cacheMaxEntries < 0) {
      throw new GeminiEmbedding2Error("Image cache capacity must be a non-negative integer");
    }
    if (!Number.isFinite(this.cacheTtlMs) || this.cacheTtlMs < 0) {
      throw new GeminiEmbedding2Error("Image cache TTL must be a non-negative number of milliseconds");
    }
    this.fetcher = options.fetch ?? fetch;
  }

  /** ImageEmbeddingProvider default role is candidate; use explicit methods when available. */
  embedImage(image: VisualImage): Promise<number[]> {
    return this.embedCandidateImage(image);
  }

  embedQueryImage(image: VisualImage): Promise<number[]> {
    return this.embedImageForRole(image, "query");
  }

  embedCandidateImage(image: VisualImage): Promise<number[]> {
    return this.embedImageForRole(image, "candidate");
  }

  async embedText(text: string): Promise<number[]> {
    if (typeof text !== "string" || text.trim().length === 0) {
      throw new GeminiEmbedding2Error("Text input must be a non-empty string");
    }
    return this.requestEmbedding({
      parts: [{ text }],
    });
  }

  compare(left: unknown, right: unknown): number {
    const leftVector = this.validateVector(left);
    const rightVector = this.validateVector(right);
    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;
    for (let index = 0; index < leftVector.length; index += 1) {
      const a = leftVector[index]!;
      const b = rightVector[index]!;
      dot += a * b;
      leftNorm += a * a;
      rightNorm += b * b;
    }
    if (leftNorm === 0 || rightNorm === 0) {
      throw new GeminiEmbedding2Error("Cannot compare a zero-length embedding vector");
    }
    const cosine = Math.max(-1, Math.min(1, dot / Math.sqrt(leftNorm * rightNorm)));
    return (cosine + 1) / 2;
  }

  getCounters(): GeminiEmbedding2Counters {
    return Object.freeze({
      imageCalls: this.imageCalls,
      queryImageCalls: this.queryImageCalls,
      candidateImageCalls: this.candidateImageCalls,
      imageCacheHits: this.imageCacheHits,
      imageCacheMisses: this.imageCacheMisses,
      imageInFlightDeduplications: this.imageInFlightDeduplications,
      textCalls: this.textCalls,
      estimatedImageCostUsd: this.imageCalls * ESTIMATED_IMAGE_COST_USD,
      estimatedQueryImageCostUsd: this.queryImageCalls * ESTIMATED_IMAGE_COST_USD,
      estimatedCandidateImageCostUsd: this.candidateImageCalls * ESTIMATED_IMAGE_COST_USD,
    });
  }

  resetCounters(): void {
    this.imageCalls = 0;
    this.queryImageCalls = 0;
    this.candidateImageCalls = 0;
    this.imageCacheHits = 0;
    this.imageCacheMisses = 0;
    this.imageInFlightDeduplications = 0;
    this.textCalls = 0;
  }

  /**
   * Serialize measurement windows that share this provider instance. The queue
   * remains usable if an action rejects.
   */
  withSearchLock<T>(action: () => T | Promise<T>): Promise<T> {
    const result = this.searchLockTail.then(action, action);
    this.searchLockTail = result.then(() => undefined, () => undefined);
    return result;
  }

  /** Clear cached image vectors. Pending requests may finish but won't repopulate it. */
  clearCache(): void {
    this.cache.clear();
    this.inFlight.clear();
  }

  /** Invalidate every cached representation of this exact image byte sequence. */
  invalidateImage(image: VisualImage): void {
    const snapshot = this.validateAndSnapshot(image);
    const key = this.cacheKey(snapshot.bytes);
    this.cache.delete(key);
    this.inFlight.delete(key);
  }

  private embedImageForRole(image: VisualImage, role: ImageRole): Promise<number[]> {
    const snapshot = this.validateAndSnapshot(image);
    const key = this.cacheKey(snapshot.bytes);
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      this.imageCacheHits += 1;
      return Promise.resolve([...cached.vector]);
    }
    if (cached) this.cache.delete(key);
    const pending = this.inFlight.get(key);
    if (pending) {
      this.imageInFlightDeduplications += 1;
      return pending.then((vector) => [...vector]);
    }

    this.imageCacheMisses += 1;
    const request = this.requestEmbedding({
      parts: [{
        inline_data: {
          mime_type: snapshot.format.mimeType,
          data: Buffer.from(snapshot.bytes).toString("base64"),
        },
      }],
    }).then((vector) => {
      if (this.inFlight.get(key) === request && this.cacheMaxEntries > 0 && this.cacheTtlMs > 0) {
        this.cache.set(key, { vector: [...vector], expiresAt: Date.now() + this.cacheTtlMs });
        while (this.cache.size > this.cacheMaxEntries) {
          const oldest = this.cache.keys().next().value as string | undefined;
          if (oldest === undefined) break;
          this.cache.delete(oldest);
        }
      }
      return vector;
    }).finally(() => {
      if (this.inFlight.get(key) === request) this.inFlight.delete(key);
    });
    this.inFlight.set(key, request);
    // Track the role at the actual request boundary, not when a cache hit or
    // duplicate caller joins an existing request.
    if (role === "query") this.queryImageCalls += 1;
    else this.candidateImageCalls += 1;
    this.imageCalls += 1;
    return request.then((vector) => [...vector]);
  }

  private validateAndSnapshot(image: VisualImage) {
    if (!image || !(image.bytes instanceof Uint8Array) || image.bytes.byteLength === 0) {
      throw new GeminiEmbedding2Error("Image bytes are empty or invalid");
    }
    if (image.bytes.byteLength > this.maxImageBytes) {
      throw new GeminiEmbedding2Error("Image exceeds the configured byte limit");
    }
    const bytes = Uint8Array.from(image.bytes);
    const format = imageFormat(bytes);
    if (!format) {
      throw new GeminiEmbedding2Error("Only JPEG, PNG, and WebP image signatures are supported");
    }
    return { bytes, format };
  }

  private cacheKey(bytes: Uint8Array): string {
    return `${this.outputDimensionality}:${createHash("sha256").update(bytes).digest("hex")}`;
  }

  private validateVector(value: unknown): number[] {
    if (
      !Array.isArray(value) ||
      value.length !== this.outputDimensionality ||
      !value.every((item) => typeof item === "number" && Number.isFinite(item))
    ) {
      throw new GeminiEmbedding2Error("Embedding vector has an invalid dimension or non-finite values");
    }
    return value as number[];
  }

  private async requestEmbedding(content: { parts: Array<Record<string, unknown>> }): Promise<number[]> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let deadlineExpired = false;
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        deadlineExpired = true;
        controller.abort();
        reject(new GeminiEmbedding2Error("Gemini Embedding 2 request exceeded its deadline"));
      }, this.timeoutMs);
    });
    try {
      const isImage = content.parts.some((part) => "inline_data" in part);
      if (!isImage) this.textCalls += 1;
      const responsePromise = Promise.resolve()
        .then(() => this.fetcher(ENDPOINT, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": this.apiKey,
          },
          body: JSON.stringify({
            model: MODEL,
            content,
            output_dimensionality: this.outputDimensionality,
          }),
          signal: controller.signal,
        }))
        .catch(() => {
          throw new GeminiEmbedding2Error("Gemini Embedding 2 request failed");
        });
      const response = await Promise.race([responsePromise, deadline]);
      if (!response.ok) {
        throw new GeminiEmbedding2Error(`Gemini Embedding 2 request failed (HTTP ${response.status})`);
      }
      let payload: unknown;
      try {
        payload = await Promise.race([response.json(), deadline]);
      } catch {
        if (deadlineExpired) {
          throw new GeminiEmbedding2Error("Gemini Embedding 2 request exceeded its deadline");
        }
        throw new GeminiEmbedding2Error("Gemini Embedding 2 returned invalid JSON");
      }
      const embedding = payload && typeof payload === "object"
        ? (payload as { embedding?: { values?: unknown } }).embedding
        : undefined;
      return this.validateVector(embedding?.values);
    } catch (error) {
      if (deadlineExpired) {
        throw new GeminiEmbedding2Error("Gemini Embedding 2 request exceeded its deadline");
      }
      if (error instanceof GeminiEmbedding2Error) throw error;
      // Do not propagate transport errors; some fetch implementations include
      // request options (including headers) in their messages.
      throw new GeminiEmbedding2Error("Gemini Embedding 2 request failed");
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }
}

export { ESTIMATED_IMAGE_COST_USD as GEMINI_EMBEDDING_2_ESTIMATED_IMAGE_COST_USD };