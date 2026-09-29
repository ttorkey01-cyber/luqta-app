/**
 * Offline-first provenance/reachability audit for the frozen benchmark.
 *
 * Usage:
 *   pnpm --dir artifacts/api-server exec tsx src/experiments/searchV3/benchmark30/referenceAudit.ts
 *   pnpm --dir artifacts/api-server exec tsx src/experiments/searchV3/benchmark30/referenceAudit.ts --check-references
 *
 * The optional check performs bounded GET requests only to Wikimedia image
 * hosts. HTTP reachability never verifies the visual identity of an image.
 */
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { REAL_WORLD_IMAGE_CASES } from "../realWorld/manifest";
import { SEARCH_V3_BENCHMARK_30 } from "./groundTruth";

const GROUP_COUNTS = {
  "exact-product-identity": 6,
  "visually-similar": 6,
  "hard-constraints": 5,
  automotive: 4,
  "saudi-arabic": 4,
  "difficult-ambiguous-image": 3,
  "negative-no-match": 2,
} as const;

const ALLOWED_IMAGE_HOSTS = new Set(["upload.wikimedia.org", "thumb.wikimedia.org"]);
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const ARMS = ["v2", "v3", "geminiV3"] as const;

type ReferenceFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

type ReferenceAuditOptions = {
  checkReferences?: boolean;
  fetch?: ReferenceFetch;
  date?: string;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

export function canonicalDefinitionsSha256(): string {
  const canonical = JSON.stringify(canonicalize(SEARCH_V3_BENCHMARK_30));
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function validateAllowedImageUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || !ALLOWED_IMAGE_HOSTS.has(url.hostname)) {
    throw new Error(`Blocked non-Wikimedia image host: ${url.hostname}`);
  }
  return url;
}

async function readBoundedBody(response: Response, controller: AbortController): Promise<number> {
  if (!response.body) return 0;
  const reader = response.body.getReader();
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return bytes;
      bytes += value.byteLength;
      if (bytes > MAX_IMAGE_BYTES) {
        controller.abort();
        await reader.cancel("Image response exceeded audit transfer limit");
        throw new Error(`Image response exceeded ${MAX_IMAGE_BYTES} byte transfer limit`);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function checkReferenceImage(imageUrl: string, fetcher: ReferenceFetch) {
  let currentUrl = validateAllowedImageUrl(imageUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let responseStatus: number | null = null;
  let contentType: string | null = null;

  try {
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      const response = await fetcher(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": "search-v3-benchmark30-reference-audit/1.0" },
      });
      responseStatus = response.status;
      contentType = response.headers.get("content-type");

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location || redirectCount === MAX_REDIRECTS) {
          return {
            status: "redirect-limit-or-missing-location",
            httpStatus: responseStatus,
            contentType,
            bytesRead: 0,
            error: "Redirect could not be safely followed",
          };
        }
        currentUrl = validateAllowedImageUrl(new URL(location, currentUrl).toString());
        continue;
      }

      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
        await response.body?.cancel();
        return {
          status: "transfer-limit-exceeded",
          httpStatus: responseStatus,
          contentType,
          bytesRead: 0,
          error: `Content-Length exceeds ${MAX_IMAGE_BYTES} byte transfer limit`,
        };
      }
       const bytesRead = await readBoundedBody(response, controller);
       const isImage = contentType?.toLowerCase().startsWith("image/") === true;
      return {
         status: !response.ok ? "http-error" : isImage && bytesRead > 0 ? "reachable" : "invalid-image-response",
        httpStatus: responseStatus,
        contentType,
        bytesRead,
         error: response.ok && isImage && bytesRead > 0
           ? null
           : "Expected a successful, nonempty image response",
      };
    }
    throw new Error("Redirect limit exceeded");
  } catch (error) {
    return {
      status: "error",
      httpStatus: responseStatus,
      contentType,
      bytesRead: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function buildReferenceAudit(options: ReferenceAuditOptions = {}) {
  const manifestById = new Map(REAL_WORLD_IMAGE_CASES.map((item) => [item.id, item]));
  const linkedCases = SEARCH_V3_BENCHMARK_30.filter(({ imageReference }) => imageReference);
   const references: Array<{
     benchmarkCaseId: string;
     manifestCaseId: string;
     imageUrl: string;
     sourcePageUrl: string;
     source: string;
     author: string;
     license: string;
     licenseUrl: string;
     metadataCheckedAt: string;
     network: Awaited<ReturnType<typeof checkReferenceImage>> | {
       status: string; httpStatus: null; contentType: null; bytesRead: number; error: null;
     };
     visualIdentityVerification: string;
   }> = [];
   // Avoid a burst of simultaneous requests to the public Commons image service.
   for (const benchmarkCase of linkedCases) {
    const imageReference = benchmarkCase.imageReference!;
    const manifest = manifestById.get(imageReference.manifestCaseId);
    if (!manifest) throw new Error(`Missing real-world manifest reference: ${imageReference.manifestCaseId}`);

    const network = options.checkReferences
      ? await checkReferenceImage(manifest.imageUrl, options.fetch ?? fetch)
      : {
        status: "not-checked",
        httpStatus: null,
        contentType: null,
        bytesRead: 0,
        error: null,
      };

     references.push({
      benchmarkCaseId: benchmarkCase.id,
      manifestCaseId: manifest.id,
      imageUrl: manifest.imageUrl,
      sourcePageUrl: manifest.sourcePageUrl,
      source: manifest.source,
      author: manifest.author,
      license: manifest.license,
      licenseUrl: manifest.licenseUrl,
      metadataCheckedAt: manifest.metadataCheckedAt,
      network,
      visualIdentityVerification: "UNVERIFIED",
     });
   }

  return {
    audit: "search-v3-benchmark30-reference-audit",
    date: options.date ?? new Date().toISOString().slice(0, 10),
    frozenDefinitionsSha256: canonicalDefinitionsSha256(),
    caseCount: SEARCH_V3_BENCHMARK_30.length,
    groupCounts: GROUP_COUNTS,
    caseIds: SEARCH_V3_BENCHMARK_30.map(({ id }) => id),
    references,
    referenceCount: references.length,
    evaluation: {
      arms: ARMS.map((name) => ({ name, status: "NOT RUN" })),
       perCaseScores: SEARCH_V3_BENCHMARK_30.map(({ id }) => ({ caseId: id, status: "NOT RUN", score: null })),
      actualActivity: {
        modelCalls: 0,
         queryImageCalls: 0,
         candidateImageCalls: 0,
         cacheHits: 0,
         cacheMisses: 0,
         embeddingDimension: 768,
         estimatedCostUsd: 0,
      },
      execution: "No model, cache, catalog, or production service was invoked.",
    },
    blockers: [
       "Merchant photos must not be sent to Gemini without confirmed permission; no approved merchant-image catalog is available.",
      "No independent relevance judgments are available.",
       "Wikimedia reference photos are not a merchant inventory or independently verified product labels.",
    ],
    visualIdentityVerification: "UNVERIFIED",
    networkCheckEnabled: options.checkReferences === true,
  };
}

async function main(args: string[]): Promise<void> {
  const checkReferences = args.includes("--check-references");
  const invalidArgs = args.filter((arg) => arg !== "--check-references");
  if (invalidArgs.length > 0) {
    throw new Error(`Unknown argument(s): ${invalidArgs.join(", ")}. Usage: referenceAudit.ts [--check-references]`);
  }
  const report = await buildReferenceAudit({ checkReferences });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}