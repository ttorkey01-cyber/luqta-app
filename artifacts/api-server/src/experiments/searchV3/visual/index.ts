import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

const PIXEL_SIZE = 32;
const PIXEL_BYTES = PIXEL_SIZE * PIXEL_SIZE * 3;
const FEATURE_VERSION = "pixel-v1";
const DEFAULT_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 1_500;
const MAX_CONCURRENT_DECODES = 2;
const MAX_QUEUED_DECODES = 32;

type DecoderWaiter = {
  resolve: (release: () => void) => void;
  reject: (error: VisualSimilarityError) => void;
  timer: ReturnType<typeof setTimeout>;
};

let activeDecodes = 0;
const decoderQueue: DecoderWaiter[] = [];

export type VisualImage = {
  /** Encoded JPEG, PNG, or WebP bytes. The adapter never retrieves URLs. */
  bytes: Uint8Array;
  /** Optional source identity for cache reuse; it is never dereferenced. */
  url?: string;
  mimeType?: string;
};

export type ImageEmbeddingProvider = {
  embedImage(image: VisualImage): Promise<unknown>;
  embedText(text: string): Promise<unknown>;
  /** Return a similarity in [0, 1] for two provider-produced embeddings. */
  compare(left: unknown, right: unknown): number | Promise<number>;
};

export type VisualSimilarityOptions = {
  /** Local ImageMagick executable. Defaults to `magick`, then `convert`. */
  executable?: string;
  /** Upper bound for each encoded image. */
  maxImageBytes?: number;
  /** Hard subprocess deadline, including image decoding. */
  decodeTimeoutMs?: number;
  /** Maximum time to wait for the module-wide decoder slot. */
  decodeQueueTimeoutMs?: number;
  /** Bounded in-memory LRU feature cache. */
  cacheMaxEntries?: number;
  cacheTtlMs?: number;
  /** Optional provider; failures do not replace or conceal pixel scores. */
  embeddingProvider?: ImageEmbeddingProvider;
};

export type VisualSimilarityResult = {
  /** Always pixel-derived; no text metadata is used in this score. */
  visualScore: number;
  pixelScore: number;
  embeddingScore?: number;
  embeddingError?: string;
};

export type VisualSimilarityErrorCode =
  | "IMAGE_TOO_LARGE"
  | "UNSUPPORTED_IMAGE"
  | "IMAGE_DECODE_UNAVAILABLE"
  | "IMAGE_DECODE_TIMEOUT"
  | "IMAGE_DECODE_QUEUE_TIMEOUT"
  | "IMAGE_DECODE_QUEUE_FULL"
  | "IMAGE_DECODE_FAILED";

export class VisualSimilarityError extends Error {
  constructor(
    readonly code: VisualSimilarityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "VisualSimilarityError";
  }
}

type PixelFeatures = {
  hash: bigint;
  /** 8x8 RGB samples from the normalized center crop. */
  samples: Uint8Array;
  /** Per-channel 16-bin color histograms. */
  histogram: Uint16Array;
};

type CacheEntry = { features: PixelFeatures; expiresAt: number };

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function makeDecoderRelease() {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = decoderQueue.shift();
    if (next) {
      clearTimeout(next.timer);
      next.resolve(makeDecoderRelease());
      return;
    }
    activeDecodes -= 1;
  };
}

function acquireDecoderSlot(queueTimeoutMs: number): Promise<() => void> {
  if (activeDecodes < MAX_CONCURRENT_DECODES) {
    activeDecodes += 1;
    return Promise.resolve(makeDecoderRelease());
  }
  if (decoderQueue.length >= MAX_QUEUED_DECODES) {
    return Promise.reject(
      new VisualSimilarityError("IMAGE_DECODE_QUEUE_FULL", "Image decoder queue is full"),
    );
  }
  return new Promise((resolve, reject) => {
    const waiter: DecoderWaiter = {
      resolve,
      reject,
      timer: setTimeout(() => {
        const index = decoderQueue.indexOf(waiter);
        if (index >= 0) decoderQueue.splice(index, 1);
        reject(
          new VisualSimilarityError(
            "IMAGE_DECODE_QUEUE_TIMEOUT",
            "Image decode waited too long for a local decoder slot",
          ),
        );
      }, queueTimeoutMs),
    };
    decoderQueue.push(waiter);
  });
}

async function withDecoderSlot<T>(queueTimeoutMs: number, action: () => Promise<T>): Promise<T> {
  const release = await acquireDecoderSlot(queueTimeoutMs);
  try {
    return await action();
  } finally {
    release();
  }
}

function detectFormat(bytes: Uint8Array): "jpeg" | "png" | "webp" | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
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
    return "png";
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
    return "webp";
  }
  return undefined;
}

function averageHash(gray: Uint8Array) {
  // Low-frequency 8x8 DCT coefficients form a compact perceptual hash.
  const coefficients: number[] = [];
  for (let v = 0; v < 8; v += 1) {
    for (let u = 0; u < 8; u += 1) {
      let sum = 0;
      for (let y = 0; y < PIXEL_SIZE; y += 1) {
        for (let x = 0; x < PIXEL_SIZE; x += 1) {
          sum +=
            gray[y * PIXEL_SIZE + x] *
            Math.cos(((2 * x + 1) * u * Math.PI) / (2 * PIXEL_SIZE)) *
            Math.cos(((2 * y + 1) * v * Math.PI) / (2 * PIXEL_SIZE));
        }
      }
      coefficients.push(sum);
    }
  }
  const nonDc = coefficients.slice(1);
  const sorted = [...nonDc].sort((left, right) => left - right);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  let hash = 0n;
  for (let index = 0; index < coefficients.length; index += 1) {
    if (coefficients[index]! > median) hash |= 1n << BigInt(index);
  }
  return hash;
}

function buildFeatures(rgb: Buffer) {
  if (rgb.length !== PIXEL_BYTES) {
    throw new VisualSimilarityError("IMAGE_DECODE_FAILED", "Image decoder returned invalid pixel data");
  }
  const gray = new Uint8Array(PIXEL_SIZE * PIXEL_SIZE);
  const samples = new Uint8Array(8 * 8 * 3);
  const histogram = new Uint16Array(3 * 16);
  for (let y = 0; y < PIXEL_SIZE; y += 1) {
    for (let x = 0; x < PIXEL_SIZE; x += 1) {
      const pixel = y * PIXEL_SIZE + x;
      const offset = pixel * 3;
      const red = rgb[offset]!;
      const green = rgb[offset + 1]!;
      const blue = rgb[offset + 2]!;
      gray[pixel] = Math.round(0.299 * red + 0.587 * green + 0.114 * blue);
      histogram[Math.min(15, red >> 4)]! += 1;
      histogram[16 + Math.min(15, green >> 4)]! += 1;
      histogram[32 + Math.min(15, blue >> 4)]! += 1;
      if (x % 4 === 2 && y % 4 === 2) {
        const sampleOffset = ((y >> 2) * 8 + (x >> 2)) * 3;
        samples[sampleOffset] = red;
        samples[sampleOffset + 1] = green;
        samples[sampleOffset + 2] = blue;
      }
    }
  }
  return { hash: averageHash(gray), samples, histogram };
}

function decodeWithImageMagick(
  bytes: Uint8Array,
  format: "jpeg" | "png" | "webp",
  executable: string,
  timeoutMs: number,
) {
  return new Promise<Buffer>((resolve, reject) => {
    const args = [
      "-limit", "memory", "64MiB",
      "-limit", "map", "128MiB",
      "-limit", "disk", "0",
      `${format}:-[0]`,
      "-auto-orient",
      "-thumbnail", `${PIXEL_SIZE}x${PIXEL_SIZE}^`,
      "-gravity", "center",
      "-extent", `${PIXEL_SIZE}x${PIXEL_SIZE}`,
      "-depth", "8",
      "RGB:-",
    ];
    let child;
    try {
      child = spawn(executable, args, { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    } catch {
      reject(new VisualSimilarityError("IMAGE_DECODE_UNAVAILABLE", "Local image decoder is unavailable"));
      return;
    }
    const chunks: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    const finish = (error?: VisualSimilarityError, output?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(output!);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new VisualSimilarityError("IMAGE_DECODE_TIMEOUT", "Image decoding exceeded its time limit"));
    }, timeoutMs);
    child.on("error", (error: NodeJS.ErrnoException) => {
      finish(
        new VisualSimilarityError(
          error.code === "ENOENT" ? "IMAGE_DECODE_UNAVAILABLE" : "IMAGE_DECODE_FAILED",
          error.code === "ENOENT" ? "Local image decoder is unavailable" : "Could not start image decoder",
        ),
      );
    });
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > PIXEL_BYTES) {
        child.kill("SIGKILL");
        finish(new VisualSimilarityError("IMAGE_DECODE_FAILED", "Image decoder output exceeded its limit"));
        return;
      }
      chunks.push(chunk);
    });
    child.stdin.on("error", () => {
      // The close event provides the useful decoder status.
    });
    child.on("close", (code: number | null) => {
      if (settled) return;
      if (code !== 0 || outputBytes !== PIXEL_BYTES) {
        finish(new VisualSimilarityError("IMAGE_DECODE_FAILED", "Image bytes could not be decoded"));
      } else {
        finish(undefined, Buffer.concat(chunks, outputBytes));
      }
    });
    child.stdin.end(Buffer.from(bytes));
  });
}

function popcount(value: bigint) {
  let bits = value;
  let count = 0;
  while (bits) {
    bits &= bits - 1n;
    count += 1;
  }
  return count;
}

function compareFeatures(left: PixelFeatures, right: PixelFeatures) {
  const hashSimilarity = 1 - popcount(left.hash ^ right.hash) / 64;
  let pixelDistance = 0;
  for (let index = 0; index < left.samples.length; index += 1) {
    pixelDistance += Math.abs(left.samples[index]! - right.samples[index]!);
  }
  const spatialSimilarity = 1 - pixelDistance / (left.samples.length * 255);
  let histogramDistance = 0;
  for (let channel = 0; channel < 3; channel += 1) {
    for (let bin = 0; bin < 16; bin += 1) {
      const offset = channel * 16 + bin;
      histogramDistance += Math.abs(left.histogram[offset]! - right.histogram[offset]!);
    }
  }
  // Each channel histogram has 1024 samples, hence 6144 is the maximum L1 distance.
  const colorSimilarity = 1 - histogramDistance / (3 * 2 * PIXEL_SIZE * PIXEL_SIZE);
  return clamp01(0.45 * hashSimilarity + 0.35 * spatialSimilarity + 0.2 * colorSimilarity);
}

export class PixelVisualSimilarityAdapter {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly maxBytes: number;
  private readonly timeoutMs: number;
  private readonly queueTimeoutMs: number;
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly executable: string;

  constructor(private readonly options: VisualSimilarityOptions = {}) {
    this.maxBytes = options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;
    this.timeoutMs = options.decodeTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.queueTimeoutMs = Math.max(1, options.decodeQueueTimeoutMs ?? DEFAULT_TIMEOUT_MS);
    this.maxEntries = Math.max(0, Math.floor(options.cacheMaxEntries ?? 128));
    this.ttlMs = Math.max(0, options.cacheTtlMs ?? 5 * 60_000);
    this.executable = options.executable ?? "magick";
  }

  async compareImages(reference: VisualImage, candidate: VisualImage): Promise<VisualSimilarityResult> {
    const [referenceFeatures, candidateFeatures] = await Promise.all([
      this.featuresFor(reference),
      this.featuresFor(candidate),
    ]);
    const pixelScore = compareFeatures(referenceFeatures, candidateFeatures);
    const result: VisualSimilarityResult = { visualScore: pixelScore, pixelScore };
    const provider = this.options.embeddingProvider;
    if (!provider) return result;
    try {
      const [leftEmbedding, rightEmbedding] = await Promise.all([
        provider.embedImage(reference),
        provider.embedImage(candidate),
      ]);
      const score = await provider.compare(leftEmbedding, rightEmbedding);
      if (!Number.isFinite(score)) throw new Error("Embedding provider returned a non-finite score");
      const embeddingScore = clamp01(score);
      return {
        // Keep the published visualScore strictly grounded in local pixels;
        // injected model scores are returned separately for caller policy.
        visualScore: pixelScore,
        pixelScore,
        embeddingScore,
      };
    } catch (error) {
      return {
        ...result,
        embeddingError: error instanceof Error ? error.message : "Embedding provider failed",
      };
    }
  }

  async compareImageToText(image: VisualImage, text: string): Promise<{
    pixelScore: undefined;
    embeddingScore: number;
  }> {
    this.validateImage(image);
    const provider = this.options.embeddingProvider;
    if (!provider) {
      throw new VisualSimilarityError(
        "IMAGE_DECODE_UNAVAILABLE",
        "Text comparison requires an injected image embedding provider",
      );
    }
    const [imageEmbedding, textEmbedding] = await Promise.all([
      provider.embedImage(image),
      provider.embedText(text),
    ]);
    const score = await provider.compare(imageEmbedding, textEmbedding);
    if (!Number.isFinite(score)) throw new Error("Embedding provider returned a non-finite score");
    return { pixelScore: undefined, embeddingScore: clamp01(score) };
  }

  clearCache() {
    this.cache.clear();
  }

  private async featuresFor(image: VisualImage): Promise<PixelFeatures> {
    const format = this.validateImage(image);
    const contentHash = createHash("sha256").update(image.bytes).digest("hex");
    const urlKey = image.url ? createHash("sha256").update(image.url).digest("hex") : "no-url";
    const cacheKey = `${FEATURE_VERSION}:${urlKey}:${contentHash}`;
    const now = Date.now();
    const existing = this.cache.get(cacheKey);
    if (existing && existing.expiresAt > now) {
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, existing);
      return existing.features;
    }
    if (existing) this.cache.delete(cacheKey);
    const executableCandidates = this.options.executable
      ? [this.executable]
      : [this.executable, "convert"];
    const decoded = await withDecoderSlot(this.queueTimeoutMs, async () => {
      let output: Buffer | undefined;
      let lastError: unknown;
      for (let index = 0; index < executableCandidates.length; index += 1) {
        try {
          output = await decodeWithImageMagick(
            image.bytes,
            format,
            executableCandidates[index]!,
            this.timeoutMs,
          );
          break;
        } catch (error) {
          lastError = error;
          if (
            !(error instanceof VisualSimilarityError) ||
            error.code !== "IMAGE_DECODE_UNAVAILABLE" ||
            index === executableCandidates.length - 1
          ) {
            throw error;
          }
        }
      }
      if (!output) throw lastError;
      return output;
    });
    const features = buildFeatures(decoded);
    if (this.maxEntries > 0 && this.ttlMs > 0) {
      this.cache.set(cacheKey, { features, expiresAt: now + this.ttlMs });
      while (this.cache.size > this.maxEntries) {
        const oldest = this.cache.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        this.cache.delete(oldest);
      }
    }
    return features;
  }

  private validateImage(image: VisualImage) {
    if (!(image.bytes instanceof Uint8Array) || image.bytes.byteLength === 0) {
      throw new VisualSimilarityError("UNSUPPORTED_IMAGE", "Image bytes are empty or invalid");
    }
    if (image.bytes.byteLength > this.maxBytes) {
      throw new VisualSimilarityError("IMAGE_TOO_LARGE", "Image exceeds the configured byte limit");
    }
    const format = detectFormat(image.bytes);
    if (!format) {
      throw new VisualSimilarityError("UNSUPPORTED_IMAGE", "Only JPEG, PNG, and WebP image bytes are supported");
    }
    return format;
  }
}

/** Short alias for consumers constructing an isolated V3 visual adapter. */
export { PixelVisualSimilarityAdapter as VisualSimilarityAdapter };