export type CustomFetchOptions = RequestInit & {
  responseType?: "json" | "text" | "blob" | "auto";
};

export type ErrorType<T = unknown> = ApiError<T>;

export type BodyType<T> = T;

export type AuthTokenGetter = () => Promise<string | null> | string | null;

const NO_BODY_STATUS = new Set([204, 205, 304]);
const DEFAULT_JSON_ACCEPT = "application/json, application/problem+json";

// ---------------------------------------------------------------------------
// Module-level configuration
// ---------------------------------------------------------------------------

let _baseUrl: string | null = null;
let _authTokenGetter: AuthTokenGetter | null = null;

export type ProductRequestObservation = {
  type: "search" | "category" | "home";
  path: "/api/search" | "/api/home/picks";
  category: string | null;
  source: "network" | "cache";
  status: number | null;
  productCount: number | null;
  total: number | null;
  errorCode: string | null;
  durationMs: number;
  timestamp: string;
};

let _productRequestObserver: ((event: ProductRequestObservation) => void) | null = null;

export function setProductRequestObserver(
  observer: ((event: ProductRequestObservation) => void) | null,
): void {
  _productRequestObserver = observer;
}

export function getBaseUrl(): string | null {
  return _baseUrl;
}

function productRequestTarget(
  url: string,
  body: BodyInit | null | undefined,
): Pick<ProductRequestObservation, "type" | "path" | "category"> | null {
  // Only these two public product endpoints are observed. Never retain a
  // free-form search query, a URL query string, or a request/response body.
  const path = url.split("?")[0];
  if (path.endsWith("/api/home/picks")) {
    return { type: "home", path: "/api/home/picks", category: null };
  }
  if (!path.endsWith("/api/search")) return null;
  let category: string | null = null;
  if (typeof body === "string") {
    try {
      const request = JSON.parse(body) as { category?: unknown; searchMode?: unknown };
      if (request.searchMode === "category_browse" &&
          typeof request.category === "string" &&
          /^[a-z_]{1,32}$/.test(request.category)) {
        category = request.category;
      }
    } catch {
      // Instrumentation must not change request or response handling.
    }
  }
  return { type: category ? "category" : "search", path: "/api/search", category };
}

function safeProductCount(data: unknown): number | null {
  if (!data || typeof data !== "object" || !("products" in data)) return null;
  return Array.isArray(data.products) ? data.products.length : null;
}

function safeTotal(data: unknown): number | null {
  if (!data || typeof data !== "object" || !("total" in data)) return null;
  return typeof data.total === "number" && Number.isFinite(data.total)
    ? data.total : null;
}

function safeErrorCode(data: unknown): string {
  if (!data || typeof data !== "object" || !("code" in data)) return "HTTP_ERROR";
  return typeof data.code === "string" && /^[A-Z_]{1,48}$/.test(data.code)
    ? data.code : "HTTP_ERROR";
}

/**
 * Set a base URL that is prepended to every relative request URL
 * (i.e. paths that start with `/`).
 *
 * Useful for Expo bundles that need to call a remote API server.
 * Pass `null` to clear the base URL.
 */
export function setBaseUrl(url: string | null): void {
  _baseUrl = url ? url.replace(/\/+$/, "") : null;
}

/**
 * Register a getter that supplies a bearer auth token.  Before every fetch
 * the getter is invoked; when it returns a non-null string, an
 * `Authorization: Bearer <token>` header is attached to the request.
 *
 * Useful for Expo bundles making token-gated API calls.
 * Pass `null` to clear the getter.
 *
 * NOTE: This function should never be used in web applications where session
 * token cookies are automatically associated with API calls by the browser.
 */
export function setAuthTokenGetter(getter: AuthTokenGetter | null): void {
  _authTokenGetter = getter;
}

function isRequest(input: RequestInfo | URL): input is Request {
  return typeof Request !== "undefined" && input instanceof Request;
}

function resolveMethod(input: RequestInfo | URL, explicitMethod?: string): string {
  if (explicitMethod) return explicitMethod.toUpperCase();
  if (isRequest(input)) return input.method.toUpperCase();
  return "GET";
}

// Use loose check for URL — some runtimes (e.g. React Native) polyfill URL
// differently, so `instanceof URL` can fail.
function isUrl(input: RequestInfo | URL): input is URL {
  return typeof URL !== "undefined" && input instanceof URL;
}

function applyBaseUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (!_baseUrl) return input;
  const url = resolveUrl(input);
  // Only prepend to relative paths (starting with /)
  if (!url.startsWith("/")) return input;

  const absolute = `${_baseUrl}${url}`;
  if (typeof input === "string") return absolute;
  if (isUrl(input)) return new URL(absolute);
  return new Request(absolute, input as Request);
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (isUrl(input)) return input.toString();
  return input.url;
}

function mergeHeaders(...sources: Array<HeadersInit | undefined>): Headers {
  const headers = new Headers();

  for (const source of sources) {
    if (!source) continue;
    new Headers(source).forEach((value, key) => {
      headers.set(key, value);
    });
  }

  return headers;
}

function getMediaType(headers: Headers): string | null {
  const value = headers.get("content-type");
  return value ? value.split(";", 1)[0].trim().toLowerCase() : null;
}

function isJsonMediaType(mediaType: string | null): boolean {
  return mediaType === "application/json" || Boolean(mediaType?.endsWith("+json"));
}

function isTextMediaType(mediaType: string | null): boolean {
  return Boolean(
    mediaType &&
      (mediaType.startsWith("text/") ||
        mediaType === "application/xml" ||
        mediaType === "text/xml" ||
        mediaType.endsWith("+xml") ||
        mediaType === "application/x-www-form-urlencoded"),
  );
}

// Use strict equality: in browsers, `response.body` is `null` when the
// response genuinely has no content.  In React Native, `response.body` is
// always `undefined` because the ReadableStream API is not implemented —
// even when the response carries a full payload readable via `.text()` or
// `.json()`.  Loose equality (`== null`) matches both `null` and `undefined`,
// which causes every React Native response to be treated as empty.
function hasNoBody(response: Response, method: string): boolean {
  if (method === "HEAD") return true;
  if (NO_BODY_STATUS.has(response.status)) return true;
  if (response.headers.get("content-length") === "0") return true;
  if (response.body === null) return true;
  return false;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function getStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;

  const candidate = (value as Record<string, unknown>)[key];
  if (typeof candidate !== "string") return undefined;

  const trimmed = candidate.trim();
  return trimmed === "" ? undefined : trimmed;
}

function truncate(text: string, maxLength = 300): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function buildErrorMessage(response: Response, data: unknown): string {
  const prefix = `HTTP ${response.status} ${response.statusText}`;

  if (typeof data === "string") {
    const text = data.trim();
    return text ? `${prefix}: ${truncate(text)}` : prefix;
  }

  const title = getStringField(data, "title");
  const detail = getStringField(data, "detail");
  const message =
    getStringField(data, "message") ??
    getStringField(data, "error_description") ??
    getStringField(data, "error");

  if (title && detail) return `${prefix}: ${title} — ${detail}`;
  if (detail) return `${prefix}: ${detail}`;
  if (message) return `${prefix}: ${message}`;
  if (title) return `${prefix}: ${title}`;

  return prefix;
}

export class ApiError<T = unknown> extends Error {
  readonly name = "ApiError";
  readonly status: number;
  readonly statusText: string;
  readonly data: T | null;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;

  constructor(
    response: Response,
    data: T | null,
    requestInfo: { method: string; url: string },
  ) {
    super(buildErrorMessage(response, data));
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = response.statusText;
    this.data = data;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = response.url || requestInfo.url;
  }
}

export class ResponseParseError extends Error {
  readonly name = "ResponseParseError";
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;
  readonly rawBody: string;
  readonly cause: unknown;

  constructor(
    response: Response,
    rawBody: string,
    cause: unknown,
    requestInfo: { method: string; url: string },
  ) {
    super(
      `Failed to parse response from ${requestInfo.method} ${response.url || requestInfo.url} ` +
        `(${response.status} ${response.statusText}) as JSON`,
    );
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = response.statusText;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = response.url || requestInfo.url;
    this.rawBody = rawBody;
    this.cause = cause;
  }
}

async function parseJsonBody(
  response: Response,
  requestInfo: { method: string; url: string },
): Promise<unknown> {
  const raw = await response.text();
  const normalized = stripBom(raw);

  if (normalized.trim() === "") {
    return null;
  }

  try {
    return JSON.parse(normalized);
  } catch (cause) {
    throw new ResponseParseError(response, raw, cause, requestInfo);
  }
}

async function parseErrorBody(response: Response, method: string): Promise<unknown> {
  if (hasNoBody(response, method)) {
    return null;
  }

  const mediaType = getMediaType(response.headers);

  // Fall back to text when blob() is unavailable (e.g. some React Native builds).
  if (mediaType && !isJsonMediaType(mediaType) && !isTextMediaType(mediaType)) {
    return typeof response.blob === "function" ? response.blob() : response.text();
  }

  const raw = await response.text();
  const normalized = stripBom(raw);
  const trimmed = normalized.trim();

  if (trimmed === "") {
    return null;
  }

  if (isJsonMediaType(mediaType) || looksLikeJson(normalized)) {
    try {
      return JSON.parse(normalized);
    } catch {
      return raw;
    }
  }

  return raw;
}

function inferResponseType(response: Response): "json" | "text" | "blob" {
  const mediaType = getMediaType(response.headers);

  if (isJsonMediaType(mediaType)) return "json";
  if (isTextMediaType(mediaType) || mediaType == null) return "text";
  return "blob";
}

async function parseSuccessBody(
  response: Response,
  responseType: "json" | "text" | "blob" | "auto",
  requestInfo: { method: string; url: string },
): Promise<unknown> {
  if (hasNoBody(response, requestInfo.method)) {
    return null;
  }

  const effectiveType =
    responseType === "auto" ? inferResponseType(response) : responseType;

  switch (effectiveType) {
    case "json":
      return parseJsonBody(response, requestInfo);

    case "text": {
      const text = await response.text();
      return text === "" ? null : text;
    }

    case "blob":
      if (typeof response.blob !== "function") {
        throw new TypeError(
          "Blob responses are not supported in this runtime. " +
            "Use responseType \"json\" or \"text\" instead.",
        );
      }
      return response.blob();
  }
}

export async function customFetch<T = unknown>(
  input: RequestInfo | URL,
  options: CustomFetchOptions = {},
): Promise<T> {
  input = applyBaseUrl(input);
  const { responseType = "auto", headers: headersInit, ...init } = options;

  const method = resolveMethod(input, init.method);

  if (init.body != null && (method === "GET" || method === "HEAD")) {
    throw new TypeError(`customFetch: ${method} requests cannot have a body.`);
  }

  const headers = mergeHeaders(isRequest(input) ? input.headers : undefined, headersInit);

  if (
    typeof init.body === "string" &&
    !headers.has("content-type") &&
    looksLikeJson(init.body)
  ) {
    headers.set("content-type", "application/json");
  }

  if (responseType === "json" && !headers.has("accept")) {
    headers.set("accept", DEFAULT_JSON_ACCEPT);
  }

  // Attach bearer token when an auth getter is configured and no
  // Authorization header has been explicitly provided.
  if (_authTokenGetter && !headers.has("authorization")) {
    const token = await _authTokenGetter();
    if (token) {
      headers.set("authorization", `Bearer ${token}`);
    }
  }

  const requestInfo = { method, url: resolveUrl(input) };

  const requestStartedAt =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const target = _productRequestObserver
    ? productRequestTarget(requestInfo.url, init.body)
    : null;
  const observe = (status: number | null, data: unknown, errorCode: string | null) => {
    if (!target || !_productRequestObserver) return;
    try {
      _productRequestObserver({
        ...target,
        source: "network",
        status,
        productCount: status !== null && status >= 200 && status < 300
          ? safeProductCount(data) : null,
        total: status !== null && status >= 200 && status < 300 ? safeTotal(data) : null,
        errorCode,
        durationMs: Math.round(
          (typeof performance !== "undefined" ? performance.now() : Date.now()) -
            requestStartedAt,
        ),
        timestamp: new Date().toISOString(),
      });
    } catch {
      // A diagnostic observer can never change the API request result.
    }
  };
  const isDevelopment =
    (globalThis as { __DEV__?: boolean }).__DEV__ === true;
  const traceSearch = isDevelopment && requestInfo.url.includes("/api/search");
  if (traceSearch) {
    console.log("[luqta-search-network]", {
      phase: "request",
      url: requestInfo.url,
      method,
      body: typeof init.body === "string" ? init.body : "[non-string body]",
    });
  }
  let response: Response;
  try {
    response = await fetch(input, { ...init, method, headers });
  } catch (error) {
    observe(null, null, init.signal?.aborted ? "ABORTED" : "NETWORK_ERROR");
    if (traceSearch) {
      const expectedAbort =
        init.signal?.aborted && error instanceof Error && error.name === "AbortError";
      (expectedAbort ? console.log : console.error)("[luqta-search-network]", {
        phase: "fetch_exception",
        url: requestInfo.url,
        name: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : String(error),
        aborted: init.signal?.aborted ?? false,
        elapsedMs: Number(
          ((typeof performance !== "undefined" ? performance.now() : Date.now()) -
            requestStartedAt).toFixed(1),
        ),
      });
    }
    throw error;
  }
  const responseReceivedAt =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  if (traceSearch) {
    console.log("[luqta-search-network]", {
      phase: "response",
      url: response.url || requestInfo.url,
      status: response.status,
      contentType: response.headers.get("content-type"),
      elapsedMs: Number((responseReceivedAt - requestStartedAt).toFixed(1)),
    });
  }
  if (isDevelopment && requestInfo.url.includes("/api/search")) {
    console.log("[luqta-category-timing]", {
      event: "RESPONSE_RECEIVED",
      at: Number(responseReceivedAt.toFixed(1)),
      status: response.status,
    });
  }

  if (!response.ok) {
    let errorData: unknown;
    try {
      errorData = await parseErrorBody(response, method);
    } catch (error) {
      observe(response.status, null, "PARSE_ERROR");
      throw error;
    }
    observe(response.status, null, safeErrorCode(errorData));
    throw new ApiError(response, errorData, requestInfo);
  }

  let body: unknown;
  try {
    body = await parseSuccessBody(response, responseType, requestInfo);
  } catch (error) {
    observe(response.status, null, "PARSE_ERROR");
    throw error;
  }
  observe(response.status, body, null);
  if (isDevelopment && requestInfo.url.includes("/api/search")) {
    const parsedAt =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    console.log("[luqta-category-timing]", {
      event: "JSON_PARSED",
      at: Number(parsedAt.toFixed(1)),
      status: response.status,
      networkMs: Number((responseReceivedAt - requestStartedAt).toFixed(1)),
      jsonParseMs: Number((parsedAt - responseReceivedAt).toFixed(1)),
    });
  }
  return body as T;
}
