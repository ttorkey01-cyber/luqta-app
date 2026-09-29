export type ImageCandidate = {
  name: string;
  query: string;
  confidence: number;
  productType: string | null;
  brand: string | null;
  color: string | null;
  attributes: string[];
};

export type ImageUnderstanding = {
  primaryCandidate: ImageCandidate | null;
  alternatives: ImageCandidate[];
  confidence: number;
  needsConfirmation: boolean;
};

export const MAX_IMAGE_DATA_URL_LENGTH = 1_400_000;
const CONFIDENT_IMAGE_THRESHOLD = 0.8;
const MIN_CANDIDATE_MARGIN = 0.12;

export type VisionAdmission =
  | { admitted: true; release: () => void }
  | { admitted: false; reason: "rate" | "capacity" };

export function visionLimitResponse(reason: "rate" | "capacity") {
  return {
    status: 429,
    retryAfter: "60",
    error:
      reason === "rate"
        ? "وصلت إلى الحد المؤقت لتحليل الصور. حاول بعد دقيقة."
        : "خدمة تحليل الصور مشغولة الآن. حاول بعد قليل.",
  } as const;
}

type VisionRateWindow = { startedAt: number; requests: number };

export function createVisionLimiter(options?: {
  maxConcurrent?: number;
  maxRequestsPerClientPerWindow?: number;
  maxRequestsGloballyPerWindow?: number;
  maxTrackedClients?: number;
  windowMs?: number;
}) {
  const maxConcurrent = options?.maxConcurrent ?? 3;
  const maxRequestsPerClientPerWindow =
    options?.maxRequestsPerClientPerWindow ?? 60;
  const maxRequestsGloballyPerWindow =
    options?.maxRequestsGloballyPerWindow ?? 60;
  const maxTrackedClients = options?.maxTrackedClients ?? 1024;
  const windowMs = options?.windowMs ?? 60_000;
  const clientWindows = new Map<string, VisionRateWindow>();
  let globalWindow: VisionRateWindow = { startedAt: 0, requests: 0 };
  let activeRequests = 0;

  return {
    acquire(clientId: string, now = Date.now()): VisionAdmission {
      for (const [key, window] of clientWindows) {
        if (now - window.startedAt >= windowMs) clientWindows.delete(key);
      }
      if (now - globalWindow.startedAt >= windowMs) {
        globalWindow = { startedAt: now, requests: 0 };
      }

      let clientWindow = clientWindows.get(clientId);
      if (!clientWindow) {
        if (clientWindows.size >= maxTrackedClients) {
          return { admitted: false, reason: "capacity" };
        }
        clientWindow = { startedAt: now, requests: 0 };
        clientWindows.set(clientId, clientWindow);
      } else if (now - clientWindow.startedAt >= windowMs) {
        clientWindow.startedAt = now;
        clientWindow.requests = 0;
      }

      if (
        clientWindow.requests >= maxRequestsPerClientPerWindow ||
        globalWindow.requests >= maxRequestsGloballyPerWindow
      ) {
        return { admitted: false, reason: "rate" };
      }
      if (activeRequests >= maxConcurrent) {
        return { admitted: false, reason: "capacity" };
      }

      clientWindow.requests += 1;
      globalWindow.requests += 1;
      activeRequests += 1;
      let released = false;
      return {
        admitted: true,
        release() {
          if (released) return;
          released = true;
          activeRequests = Math.max(0, activeRequests - 1);
        },
      };
    },
  };
}

export const visionLimiter = createVisionLimiter();

export function isBoundedJpegDataUrl(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length > MAX_IMAGE_DATA_URL_LENGTH
  ) {
    return false;
  }
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match?.[1] || match[1].length % 4 !== 0) return false;
  const imageBytes = Buffer.from(match[1], "base64");
  return (
    imageBytes.length >= 4 &&
    imageBytes[0] === 0xff &&
    imageBytes[1] === 0xd8 &&
    imageBytes[imageBytes.length - 2] === 0xff &&
    imageBytes[imageBytes.length - 1] === 0xd9
  );
}

function stringOrNull(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().slice(0, maxLength);
  return normalized || null;
}

function removeClaimedBrand(value: string, brand: string | null): string {
  if (!brand) return value;
  const escapedBrand = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const boundary = String.raw`(^|[^\p{L}\p{N}])${escapedBrand}(?=$|[^\p{L}\p{N}])`;
  return value
    .replace(new RegExp(boundary, "giu"), "$1")
    .replace(/\s+/g, " ")
    .replace(/^[\s,،;:|–-]+|[\s,،;:|–-]+$/g, "")
    .trim();
}

function normalizeCandidate(value: unknown): ImageCandidate | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const name = stringOrNull(candidate.name, 80);
  const query = stringOrNull(candidate.query, 120);
  if (!name || !query) return null;

  const rawConfidence =
    typeof candidate.confidence === "number" &&
    Number.isFinite(candidate.confidence)
      ? candidate.confidence
      : 0;
  const confidence = Math.min(1, Math.max(0, rawConfidence));
  const reportedBrand = stringOrNull(candidate.brand, 80);
  const trustedBrand = confidence >= 0.95 ? reportedBrand : null;
  const cleanedQuery = removeClaimedBrand(query, trustedBrand ? null : reportedBrand);
  const cleanedName = removeClaimedBrand(name, trustedBrand ? null : reportedBrand);
  const productType = stringOrNull(candidate.productType, 80);
  const cleanedProductType = productType
    ? removeClaimedBrand(productType, trustedBrand ? null : reportedBrand)
    : null;
  const attributes = Array.isArray(candidate.attributes)
    ? candidate.attributes
        .filter((attribute): attribute is string => typeof attribute === "string")
        .map((attribute) => attribute.trim().slice(0, 60))
        .filter(Boolean)
        .slice(0, 8)
    : [];

  return {
    name: cleanedName || cleanedProductType || cleanedQuery || "منتج",
    query: cleanedQuery || cleanedProductType || "منتج",
    confidence,
    productType: cleanedProductType,
    brand: trustedBrand,
    color: stringOrNull(candidate.color, 40),
    attributes,
  };
}

export function normalizeImageUnderstanding(value: unknown): ImageUnderstanding {
  const result =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const primaryCandidate = normalizeCandidate(result.primaryCandidate);
  const alternatives = Array.isArray(result.alternatives)
    ? result.alternatives
        .map(normalizeCandidate)
        .filter((candidate): candidate is ImageCandidate => candidate !== null)
        .slice(0, 3)
    : [];
  const confidence = primaryCandidate?.confidence ?? 0;
  const runnerUpConfidence = alternatives[0]?.confidence ?? 0;
  const needsConfirmation =
    !primaryCandidate ||
    confidence < CONFIDENT_IMAGE_THRESHOLD ||
    confidence - runnerUpConfidence < MIN_CANDIDATE_MARGIN;

  return {
    primaryCandidate,
    alternatives,
    confidence,
    needsConfirmation,
  };
}