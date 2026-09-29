import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import type { VisualImage } from "./index";

export type ImageUrlLoader = (url: string) => Promise<VisualImage>;

export type ImageUrlFetch = (
  url: string,
  init: { redirect: "manual"; signal: AbortSignal },
) => Promise<Response>;

export type ResolvedHostAddress = { address: string; family: 4 | 6 };
export type HostnameResolver = (hostname: string) => Promise<ResolvedHostAddress[]>;

export type ImageUrlLoaderOptions = {
  /** Must be explicitly true before any request can be made. */
  enabled?: boolean;
  /** Exact HTTPS hostnames approved to serve candidate images. */
  allowedHosts: string[];
  /** Injectable no-network test transport. Production defaults to pinned HTTPS. */
  fetch?: ImageUrlFetch;
  /** Injectable DNS resolver for tests; production defaults to system DNS. */
  resolveHostname?: HostnameResolver;
  timeoutMs?: number;
  maxImageBytes?: number;
  maxConcurrency?: number;
  cacheMaxBytes?: number;
  cacheTtlMs?: number;
};

export type ImageUrlLoaderErrorCode =
  | "DISABLED"
  | "INVALID_URL"
  | "HOST_NOT_ALLOWED"
  | "HOST_RESOLUTION_FAILED"
  | "TOO_MANY_REQUESTS"
  | "TIMEOUT"
  | "FETCH_FAILED"
  | "REDIRECT_REJECTED"
  | "HTTP_ERROR"
  | "NON_IMAGE_CONTENT"
  | "IMAGE_TOO_LARGE"
  | "EMPTY_BODY";

export class ImageUrlLoaderError extends Error {
  constructor(readonly code: ImageUrlLoaderErrorCode, message: string) {
    super(message);
    this.name = "ImageUrlLoaderError";
  }
}

type CacheEntry = {
  image: VisualImage;
  bytes: number;
  expiresAt: number;
};

const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
};

function ipv4IsPublic(address: string) {
  if (isIP(address) !== 4) return false;
  const octets = address.split(".").map(Number);
  const [first, second, third] = octets;
  if (first === undefined || second === undefined || third === undefined) return false;
  if (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second! >= 64 && second! <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second! >= 16 && second! <= 31) ||
    (first === 192 && second === 168) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113)
  ) {
    return false;
  }
  return true;
}

function ipv6Bytes(address: string): number[] | undefined {
  let source = address.toLowerCase().split("%", 1)[0]!;
  if (source.includes(".")) {
    const lastColon = source.lastIndexOf(":");
    const embedded = source.slice(lastColon + 1);
    if (isIP(embedded) !== 4) return undefined;
    const octets = embedded.split(".").map(Number);
    const high = ((octets[0]! << 8) | octets[1]!).toString(16);
    const low = ((octets[2]! << 8) | octets[3]!).toString(16);
    source = `${source.slice(0, lastColon)}:${high}:${low}`;
  }
  const halves = source.split("::");
  if (halves.length > 2) return undefined;
  const left = halves[0] ? halves[0]!.split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1]!.split(":") : [];
  const groups = halves.length === 2
    ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
    : left;
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/u.test(group))) {
    return undefined;
  }
  return groups.flatMap((group) => {
    const value = Number.parseInt(group, 16);
    return [value >> 8, value & 0xff];
  });
}

function ipv6IsPublic(address: string) {
  if (isIP(address) !== 6) return false;
  const bytes = ipv6Bytes(address);
  if (!bytes) return false;
  const isV4Mapped = bytes.slice(0, 10).every((byte) => byte === 0) &&
    bytes[10] === 0xff && bytes[11] === 0xff;
  if (isV4Mapped) {
    return ipv4IsPublic(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
  }
  // Only global unicast (2000::/3) is accepted. Exclude protocol assignment,
  // documentation, and 6to4 ranges that can tunnel to non-public IPv4 hosts.
  return (
    bytes[0]! >= 0x20 &&
    bytes[0]! <= 0x3f &&
    !(bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2]! <= 0x01) &&
    !(bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) &&
    !(bytes[0] === 0x20 && bytes[1] === 0x02) &&
    !(bytes[0] === 0x3f && bytes[1] === 0xff)
  );
}

function isPublicAddress({ address, family }: ResolvedHostAddress) {
  return family === 4 ? ipv4IsPublic(address) : family === 6 && ipv6IsPublic(address);
}

async function systemResolveHostname(hostname: string): Promise<ResolvedHostAddress[]> {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses
    .filter((item): item is typeof item & { family: 4 | 6 } => item.family === 4 || item.family === 6)
    .map(({ address, family }) => ({ address, family }));
}

function pinnedHttpsFetch(url: URL, pinnedAddress: ResolvedHostAddress, signal: AbortSignal) {
  return new Promise<Response>((resolve, reject) => {
    const hostname = url.hostname;
    const request = httpsRequest(
      url,
      {
        agent: false,
        servername: hostname,
        lookup: (_host, lookupOptions, callback) => {
          // Do not perform a second DNS lookup: this is the verified address.
          if (lookupOptions.all) {
            callback(null, [{ address: pinnedAddress.address, family: pinnedAddress.family }]);
          } else {
            callback(null, pinnedAddress.address, pinnedAddress.family);
          }
        },
        signal,
      },
      (incoming) => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
        }
        const body = incoming.statusCode === 204 || incoming.statusCode === 304
          ? null
          : Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
        resolve({
          status: incoming.statusCode ?? 0,
          headers,
          body,
        } as Response);
      },
    );
    request.once("error", reject);
    request.end();
  });
}

function normalizedHostname(hostname: string) {
  return hostname.toLowerCase().replace(/\.$/u, "");
}

function isLocalHostname(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".lan") ||
    hostname.endsWith(".home") ||
    hostname.endsWith(".home.arpa") ||
    hostname.endsWith(".test") ||
    hostname.endsWith(".invalid") ||
    hostname.endsWith(".corp") ||
    hostname.endsWith(".intranet") ||
    hostname.endsWith(".private") ||
    hostname.endsWith(".onion") ||
    hostname.endsWith(".arpa") ||
    !hostname.includes(".")
  );
}

function isPublicImageBytes(bytes: Uint8Array, expected: string) {
  if (expected === "jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (expected === "png") {
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}

function parseAllowedUrl(rawUrl: string, allowedHosts: Set<string>) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ImageUrlLoaderError("INVALID_URL", "Candidate image URL is invalid");
  }
  const hostname = normalizedHostname(url.hostname);
  const ipHost = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  ) {
    throw new ImageUrlLoaderError("INVALID_URL", "Only credential-free HTTPS URLs on port 443 are allowed");
  }
  if (isIP(ipHost) || isLocalHostname(hostname)) {
    throw new ImageUrlLoaderError("HOST_NOT_ALLOWED", "IP and local/private hostnames are not allowed");
  }
  if (!allowedHosts.has(hostname)) {
    throw new ImageUrlLoaderError("HOST_NOT_ALLOWED", "Candidate image hostname is not allowlisted");
  }
  return url;
}

/**
 * Creates an opt-in loader for provider-supplied candidate photo URLs.
 * Only exact, explicitly allowlisted HTTPS hostnames are fetched. Uploads
 * from users should be passed to the visual adapter as bytes instead.
 */
export function createImageUrlLoader(options: ImageUrlLoaderOptions): ImageUrlLoader {
  const allowedHosts = new Set(
    options.allowedHosts.map(normalizedHostname).filter((host) => host.length > 0),
  );
  const enabled = options.enabled === true;
  const maxImageBytes = Math.max(1, Math.floor(options.maxImageBytes ?? 5 * 1024 * 1024));
  const maxConcurrency = Math.max(1, Math.floor(options.maxConcurrency ?? 4));
  const cacheMaxBytes = Math.max(0, Math.floor(options.cacheMaxBytes ?? 16 * 1024 * 1024));
  const cacheTtlMs = Math.max(0, options.cacheTtlMs ?? 60_000);
  const timeoutMs = Math.max(1, options.timeoutMs ?? 3_000);
  const injectedFetch = options.fetch;
  const resolveHostname = options.resolveHostname ?? systemResolveHostname;
  const cache = new Map<string, CacheEntry>();
  let cacheBytes = 0;
  let activeRequests = 0;

  const load: ImageUrlLoader = async (rawUrl) => {
    if (!enabled) {
      throw new ImageUrlLoaderError("DISABLED", "Candidate image URL loading is disabled");
    }
    const url = parseAllowedUrl(rawUrl, allowedHosts);
    const cacheKey = url.href;
    const now = Date.now();
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      cache.delete(cacheKey);
      cache.set(cacheKey, cached);
      return { ...cached.image, bytes: Uint8Array.from(cached.image.bytes) };
    }
    if (cached) {
      cache.delete(cacheKey);
      cacheBytes -= cached.bytes;
    }
    if (activeRequests >= maxConcurrency) {
      throw new ImageUrlLoaderError("TOO_MANY_REQUESTS", "Image URL loader concurrency limit reached");
    }

    activeRequests += 1;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const download = async () => {
        let response: Response;
        try {
          let pinnedAddress: ResolvedHostAddress | undefined;
          if (resolveHostname) {
            let addresses: ResolvedHostAddress[];
            try {
              addresses = await resolveHostname(url.hostname);
            } catch (error) {
              if (controller.signal.aborted) {
                throw new ImageUrlLoaderError("TIMEOUT", "Candidate image request timed out");
              }
              throw new ImageUrlLoaderError(
                "HOST_RESOLUTION_FAILED",
                error instanceof Error ? `Hostname resolution failed: ${error.message}` : "Hostname resolution failed",
              );
            }
            if (controller.signal.aborted) {
              throw new ImageUrlLoaderError("TIMEOUT", "Candidate image request timed out");
            }
            if (
              !addresses.length ||
              addresses.some((address) => !isPublicAddress(address))
            ) {
              throw new ImageUrlLoaderError(
                "HOST_RESOLUTION_FAILED",
                "Hostname resolved to no public addresses or included a private address",
              );
            }
            pinnedAddress = addresses[0];
          }
          response = injectedFetch
            ? await injectedFetch(url.href, { redirect: "manual", signal: controller.signal })
            : await pinnedHttpsFetch(url, pinnedAddress!, controller.signal);
        } catch (error) {
          if (error instanceof ImageUrlLoaderError) throw error;
          if (controller.signal.aborted) {
            throw new ImageUrlLoaderError("TIMEOUT", "Candidate image request timed out");
          }
          throw new ImageUrlLoaderError(
            "FETCH_FAILED",
            error instanceof Error ? error.message : "Candidate image request failed",
          );
        }
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel().catch(() => undefined);
          throw new ImageUrlLoaderError("REDIRECT_REJECTED", "Candidate image redirects are not followed");
        }
        if (response.status < 200 || response.status >= 300) {
          await response.body?.cancel().catch(() => undefined);
          throw new ImageUrlLoaderError("HTTP_ERROR", `Candidate image returned HTTP ${response.status}`);
        }
        const contentType = (response.headers.get("content-type") ?? "")
          .split(";", 1)[0]!
          .trim()
          .toLowerCase();
        const expectedFormat = IMAGE_TYPES[contentType];
        if (!expectedFormat) {
          throw new ImageUrlLoaderError("NON_IMAGE_CONTENT", "Response must be JPEG, PNG, or WebP");
        }
        const contentLength = response.headers.get("content-length");
        if (contentLength && /^\d+$/u.test(contentLength) && Number(contentLength) > maxImageBytes) {
          throw new ImageUrlLoaderError("IMAGE_TOO_LARGE", "Candidate image exceeds the configured byte limit");
        }
        if (!response.body) {
          throw new ImageUrlLoaderError("EMPTY_BODY", "Candidate image response has no body");
        }
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          total += value.byteLength;
          if (total > maxImageBytes) {
            await reader.cancel().catch(() => undefined);
            throw new ImageUrlLoaderError("IMAGE_TOO_LARGE", "Candidate image exceeds the configured byte limit");
          }
          chunks.push(value);
        }
        if (total === 0) throw new ImageUrlLoaderError("EMPTY_BODY", "Candidate image response is empty");
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        if (!isPublicImageBytes(bytes, expectedFormat)) {
          throw new ImageUrlLoaderError("NON_IMAGE_CONTENT", "Image body does not match its declared image type");
        }
        const image: VisualImage = { bytes, url: url.href, mimeType: contentType };
        if (cacheMaxBytes > 0 && cacheTtlMs > 0 && total <= cacheMaxBytes) {
          while (cache.size > 0 && cacheBytes + total > cacheMaxBytes) {
            const oldestKey = cache.keys().next().value as string | undefined;
            if (oldestKey === undefined) break;
            const oldest = cache.get(oldestKey);
            cache.delete(oldestKey);
            if (oldest) cacheBytes -= oldest.bytes;
          }
          cache.set(cacheKey, {
            image: { ...image, bytes: Uint8Array.from(bytes) },
            bytes: total,
            expiresAt: Date.now() + cacheTtlMs,
          });
          cacheBytes += total;
        }
        return image;
      };

      const timedOut = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new ImageUrlLoaderError("TIMEOUT", "Candidate image request timed out"));
        }, timeoutMs);
      });
      return await Promise.race([download(), timedOut]);
    } finally {
      if (timeout) clearTimeout(timeout);
      activeRequests -= 1;
    }
  };
  return load;
}