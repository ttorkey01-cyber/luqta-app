import { createHash } from "node:crypto";

const ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent";
const MAX_IMAGE_BYTES = 1_000_000;
const MAX_RESPONSE_BYTES = 32_000;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_CACHE_ENTRIES = 256;

const IMAGE_ONLY_PROMPT = [
  "Interpret only the pixels in the attached query image.",
  "Do not use or infer any user query, candidate/product image, product listing, URL, title, or merchant metadata.",
  "Report only details visibly supported by the image. Use null or empty arrays when not visible or uncertain.",
  "Do not invent or infer vehicle fitment, compatibility, or other unsupported specifications.",
  "Read visible text verbatim when legible. Brand and model must be visually evidenced, not guessed.",
  "Return JSON matching the supplied schema. Confidence is 0 to 1 and must reflect visual certainty; describe unresolved ambiguity in uncertainty.",
].join(" ");

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    category: { type: "STRING", nullable: true },
    productType: { type: "STRING", nullable: true },
    brand: { type: "STRING", nullable: true },
    model: { type: "STRING", nullable: true },
    color: { type: "STRING", nullable: true },
    style: { type: "STRING", nullable: true },
    material: { type: "STRING", nullable: true },
    attributes: { type: "ARRAY", items: { type: "STRING" } },
    extractedText: { type: "ARRAY", items: { type: "STRING" } },
    uncertainty: { type: "ARRAY", items: { type: "STRING" } },
    confidence: { type: "NUMBER" },
    description: { type: "STRING" },
  },
  required: [
    "category", "productType", "brand", "model", "color", "style", "material",
    "attributes", "extractedText", "uncertainty", "confidence", "description",
  ],
} as const;

export type QueryImageInput = {
  imageBytes: Uint8Array;
  /** Explicit server-side credential. This module never reads environment variables. */
  apiKey: string;
  fetch?: typeof fetch;
};

export type QueryImageV3Image = {
  identities: Array<{
    label: string;
    confidence: number;
    brand?: string;
    model?: string;
    color?: string;
  }>;
  description: string;
  extractedText: string;
};

export type QueryImageInterpretation = {
  category: string | null;
  productType: string | null;
  brand: string | null;
  model: string | null;
  color: string | null;
  style: string | null;
  material: string | null;
  attributes: string[];
  extractedText: string[];
  uncertainty: string[];
  confidence: number;
  description: string;
  /** Ready to map to V3Request.image; it contains no image bytes or URI. */
  v3Image: QueryImageV3Image;
};

export type QueryImageInterpreterMetrics = Readonly<{
  queryImageCalls: number;
  candidateImageCalls: 0;
  textCalls: 0;
  cacheHits: number;
  cacheMisses: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
}>;

export class QueryImageInterpreterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryImageInterpreterError";
  }
}

type ImageFormat = "image/jpeg" | "image/png" | "image/webp";

function detectImageFormat(bytes: Uint8Array): ImageFormat | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return undefined;
}

function boundedString(value: unknown, maxLength: number, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > maxLength || (!allowEmpty && !value.trim())) {
    throw new QueryImageInterpreterError("Gemini returned an invalid image interpretation");
  }
  return value.trim();
}

function nullableString(value: unknown, maxLength: number): string | null {
  return value === null ? null : boundedString(value, maxLength);
}

function stringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new QueryImageInterpreterError("Gemini returned an invalid image interpretation");
  }
  return value.map((item) => boundedString(item, maxLength));
}

function validateInterpretation(value: unknown): QueryImageInterpretation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new QueryImageInterpreterError("Gemini returned an invalid image interpretation");
  }
  const data = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "category", "productType", "brand", "model", "color", "style", "material",
    "attributes", "extractedText", "uncertainty", "confidence", "description",
  ]);
  if (Object.keys(data).some((key) => !allowedKeys.has(key))) {
    throw new QueryImageInterpreterError("Gemini returned an invalid image interpretation");
  }
  const confidence = data.confidence;
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new QueryImageInterpreterError("Gemini returned an invalid image interpretation");
  }
  const category = nullableString(data.category, 100);
  const productType = nullableString(data.productType, 100);
  const brand = nullableString(data.brand, 100);
  const model = nullableString(data.model, 100);
  const color = nullableString(data.color, 80);
  const style = nullableString(data.style, 120);
  const material = nullableString(data.material, 100);
  const attributes = stringArray(data.attributes, 16, 100);
  const extractedText = stringArray(data.extractedText, 24, 160);
  const uncertainty = stringArray(data.uncertainty, 8, 180);
  const description = boundedString(data.description, 500, true);

  const identityLabel = productType ?? category;
  const identities = identityLabel
    ? [{
        label: identityLabel,
        confidence,
        ...(brand ? { brand } : {}),
        ...(model ? { model } : {}),
        ...(color ? { color } : {}),
      }]
    : [];

  return {
    category,
    productType,
    brand,
    model,
    color,
    style,
    material,
    attributes,
    extractedText,
    uncertainty,
    confidence,
    description,
    v3Image: {
      identities,
      description,
      extractedText: extractedText.join("\n"),
    },
  };
}

function responseText(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new QueryImageInterpreterError("Gemini returned an invalid response");
  }
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || !candidates.length) {
    throw new QueryImageInterpreterError("Gemini returned no image interpretation");
  }
  const content = (candidates[0] as { content?: unknown } | null)?.content;
  const parts = content && typeof content === "object"
    ? (content as { parts?: unknown }).parts
    : undefined;
  const text = Array.isArray(parts)
    ? parts.map((part) => part && typeof part === "object" ? (part as { text?: unknown }).text : undefined)
        .find((part): part is string => typeof part === "string")
    : undefined;
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
    throw new QueryImageInterpreterError("Gemini returned an invalid image interpretation");
  }
  return text;
}

async function readBoundedResponseText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new QueryImageInterpreterError("Gemini response exceeds the 32 KB limit");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new QueryImageInterpreterError("Gemini response exceeds the 32 KB limit");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new QueryImageInterpreterError("Gemini returned invalid JSON");
  }
}

/**
 * Explicitly invoked, query-image-only Gemini experiment. Constructing this
 * class is offline; the only network call is made by interpret().
 */
export class GeminiQueryImageInterpreter {
  private readonly cache = new Map<string, Promise<QueryImageInterpretation>>();
  private readonly timeoutMs: number;
  private queryImageCalls = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private failures = 0;
  private inputTokens = 0;
  private outputTokens = 0;

  constructor(options: { timeoutMs?: number } = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > DEFAULT_TIMEOUT_MS) {
      throw new QueryImageInterpreterError("Timeout must be an integer from 1 to 20000 milliseconds");
    }
  }

  interpret(input: QueryImageInput): Promise<QueryImageInterpretation> {
    if (!input || !(input.imageBytes instanceof Uint8Array) || input.imageBytes.byteLength === 0) {
      this.failures += 1;
      return Promise.reject(new QueryImageInterpreterError("Image bytes are empty or invalid"));
    }
    if (input.imageBytes.byteLength > MAX_IMAGE_BYTES) {
      this.failures += 1;
      return Promise.reject(new QueryImageInterpreterError("Image exceeds the 1 MB byte limit"));
    }
    const bytes = Uint8Array.from(input.imageBytes);
    const mimeType = detectImageFormat(bytes);
    if (!mimeType) {
      this.failures += 1;
      return Promise.reject(new QueryImageInterpreterError("Only JPEG, PNG, and WebP image signatures are supported"));
    }
    if (typeof input.apiKey !== "string" || !input.apiKey.trim()) {
      this.failures += 1;
      return Promise.reject(new QueryImageInterpreterError("An explicit server-side Gemini API key is required"));
    }

    const key = createHash("sha256").update(bytes).digest("hex");
    const cached = this.cache.get(key);
    if (cached) {
      this.cacheHits += 1;
      return cached;
    }

    this.cacheMisses += 1;
    const pending = this.request(bytes, mimeType, input.apiKey.trim(), input.fetch ?? fetch);
    this.cache.set(key, pending);
    while (this.cache.size > MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    return pending;
  }

  getMetrics(): QueryImageInterpreterMetrics {
    return Object.freeze({
      queryImageCalls: this.queryImageCalls,
      candidateImageCalls: 0,
      textCalls: 0,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      failures: this.failures,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
    });
  }

  private async request(
    bytes: Uint8Array,
    mimeType: ImageFormat,
    apiKey: string,
    fetcher: typeof fetch,
  ): Promise<QueryImageInterpretation> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expired = false;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        expired = true;
        controller.abort();
        reject(new QueryImageInterpreterError("Gemini query-image request exceeded its 20 second deadline"));
      }, this.timeoutMs);
    });
    try {
      this.queryImageCalls += 1;
      const request = Promise.resolve().then(() => fetcher(ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [
              { text: IMAGE_ONLY_PROMPT },
              { inlineData: { mimeType, data: Buffer.from(bytes).toString("base64") } },
            ],
          }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
            maxOutputTokens: 1024,
          },
        }),
        signal: controller.signal,
      })).catch(() => {
        throw new QueryImageInterpreterError("Gemini query-image request failed");
      });
      const response = await Promise.race([request, deadline]);
      if (!response.ok) {
        throw new QueryImageInterpreterError(`Gemini query-image request failed (HTTP ${response.status})`);
      }
      const payloadPromise = readBoundedResponseText(response).then((text) => {
        try {
          return JSON.parse(text) as unknown;
        } catch {
          throw new QueryImageInterpreterError("Gemini returned invalid JSON");
        }
      });
      const payload = await Promise.race([payloadPromise, deadline]);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new QueryImageInterpreterError("Gemini returned an invalid response");
      }
      const usage = (payload as { usageMetadata?: unknown }).usageMetadata;
      if (usage && typeof usage === "object") {
        const metadata = usage as {
          promptTokenCount?: unknown;
          candidatesTokenCount?: unknown;
          thoughtsTokenCount?: unknown;
        };
        if (typeof metadata.promptTokenCount === "number" && Number.isSafeInteger(metadata.promptTokenCount) && metadata.promptTokenCount >= 0) {
          this.inputTokens += metadata.promptTokenCount;
        }
        if (typeof metadata.candidatesTokenCount === "number" && Number.isSafeInteger(metadata.candidatesTokenCount) && metadata.candidatesTokenCount >= 0) {
          this.outputTokens += metadata.candidatesTokenCount;
        }
        // Gemini 3.x thinking tokens are billed as output tokens too.
        if (typeof metadata.thoughtsTokenCount === "number" && Number.isSafeInteger(metadata.thoughtsTokenCount) && metadata.thoughtsTokenCount >= 0) {
          this.outputTokens += metadata.thoughtsTokenCount;
        }
      }
      const parsed: unknown = JSON.parse(responseText(payload));
      return validateInterpretation(parsed);
    } catch (error) {
      this.failures += 1;
      if (expired) {
        throw new QueryImageInterpreterError("Gemini query-image request exceeded its 20 second deadline");
      }
      if (error instanceof QueryImageInterpreterError) throw error;
      throw new QueryImageInterpreterError("Gemini query-image request failed");
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
