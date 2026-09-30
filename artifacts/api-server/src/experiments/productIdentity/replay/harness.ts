import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { classifyPair } from "../engine";
import { groupCandidates } from "../grouping";
import { normalizeIdentifier } from "../identifiers";
import type { IdentityIdentifier, IdentityRecord, ProductIdentityDecision } from "../types";
import {
  extractSourceEvidence,
  isEditorialSource,
  type ParsedSourceEvidence,
  type SourceEvidenceValue,
} from "./sourceEvidence";
import type {
  NormalizedProduct,
  ProviderIndexReadiness,
  ProviderSearchRequest,
} from "../../../connectors/types";

export const FROZEN_CASES_SHA256 =
  "4359419400333f3a2831cc30efe65c9be4bea90cf19732b3e4e51dceb6a895f8";

export type ReplayCase = {
  id: string;
  query: string;
  category?: ProviderSearchRequest["category"];
  hardConstraints?: Array<{ field: string; op: string; value: string | number }>;
};

export type CandidateJudgment = "EXACT" | "RELEVANT" | "IRRELEVANT" | "UNVERIFIABLE" | "ABSTAIN";

export type CaseJudgment = {
  caseId: string;
  candidateJudgments: Record<string, CandidateJudgment>;
  coverage: "JUDGED" | "ABSTAINED";
  /** Missing only in legacy fixtures; absence is treated as unknown, never as none. */
  inventoryAvailabilityAssessment?: "found" | "none" | "unknown";
};

export type BlindPacket = {
  packetId: string;
  cases: Array<{
    caseId: string;
    query: string;
    observations: Array<{
      observationId: string;
      title: string;
      description?: string;
      brand?: string;
      category?: string;
      merchant?: string;
      price?: number;
      currency?: string;
      variant: Record<string, string | number | boolean | null>;
      availability?: string;
      source: {
        providerId?: string;
        providerName?: string;
        sourceType?: string;
        condition?: string;
        model?: string;
        styleCode?: string;
        identifiers?: IdentityIdentifier[];
      };
    }>;
  }>;
};

type SearchResult = {
  products: NormalizedProduct[];
  fallbackStatus?: string;
  __timings?: {
    providerTimings?: Array<{
      providerId?: string;
      ready?: boolean | null;
      resultCount?: number;
      durationMs?: number;
      timedOut?: boolean;
      errorType?: string;
      refreshing?: boolean | null;
      indexedProductCount?: number | null;
      lastSuccessfulSync?: string | null;
    }>;
  };
};

export type ReplaySearch = {
  searchWithMetadata(
    request: ProviderSearchRequest,
    trace?: (stage: string, details: Record<string, unknown>) => void,
  ): Promise<SearchResult>;
};

export type ReadinessStatus =
  | "READY"
  | "READY_BY_ENSURE"
  | "READY_BY_REFRESH"
  | "NOT_SUPPORTED"
  | "UNREADY_NO_WAITER"
  | "UNREADY_AFTER_WAIT"
  | "FAILED"
  | "TIMED_OUT";

export type SourceReadinessEntry = {
  providerId: string;
  providerName: string;
  integrationType: string;
  status: ReadinessStatus;
  ready: boolean | null;
  productCount: number | null;
  refreshing: boolean | null;
  lastSuccessfulSync: string | null;
  waitMs: number;
  errorType?: string;
};

export type SourceReadinessReport = {
  timeoutMs: number;
  durationMs: number;
  timedOut: boolean;
  partialCoverage: boolean;
  sources: SourceReadinessEntry[];
};

type ReadinessProvider = {
  metadata: { id: string; name: string; integrationType: string };
  getSearchIndexReadiness?: () => ProviderIndexReadiness;
  ensureSearchIndexReady?: () => Promise<number>;
  refreshIndex?: (force?: boolean) => Promise<number>;
};

export type ReadinessRegistry = {
  getSearchProviders(): ReadinessProvider[];
};

function readinessSnapshot(provider: ReadinessProvider) {
  return provider.getSearchIndexReadiness?.();
}

function readinessIsIncomplete(status: ReadinessStatus): boolean {
  return status === "UNREADY_NO_WAITER" ||
    status === "UNREADY_AFTER_WAIT" ||
    status === "FAILED" ||
    status === "TIMED_OUT";
}

/** Waits once for already-registered search indexes, bounded to four minutes by default. */
export async function preflightSourceIndexes(
  registry: ReadinessRegistry,
  timeoutMs = 240_000,
): Promise<SourceReadinessReport> {
  const startedAt = performance.now();
  const providers = registry.getSearchProviders()
    .filter((provider) => provider.metadata.integrationType !== "mock_local");
  const entries: SourceReadinessEntry[] = providers.map((provider) => {
    const readiness = readinessSnapshot(provider);
    return {
      providerId: safeText(provider.metadata.id) ?? "unknown-provider",
      providerName: safeText(provider.metadata.name) ?? "Unknown provider",
      integrationType: safeText(provider.metadata.integrationType) ?? "unknown",
      status: readiness?.ready
        ? "READY"
        : provider.ensureSearchIndexReady || provider.refreshIndex
          ? "UNREADY_AFTER_WAIT"
          : provider.getSearchIndexReadiness
            ? "UNREADY_NO_WAITER"
            : "NOT_SUPPORTED",
      ready: readiness?.ready ?? null,
      productCount: readiness?.productCount ?? null,
      refreshing: readiness?.refreshing ?? null,
      lastSuccessfulSync: safeText(readiness?.lastSuccessfulSync) ?? null,
      waitMs: 0,
    };
  });
  const pending: Array<{
    provider: ReadinessProvider;
    entry: SourceReadinessEntry;
    startedAt: number;
    promise: Promise<void>;
  }> = [];
  providers.forEach((provider, index) => {
    const entry = entries[index];
    if (entry.status === "READY" || entry.status === "NOT_SUPPORTED" ||
        entry.status === "UNREADY_NO_WAITER") return;
    const ensure = provider.ensureSearchIndexReady;
    const refresh = provider.refreshIndex;
    if (!ensure && !refresh) return;
    const sourceStarted = performance.now();
    const promise = Promise.resolve().then(async () => {
      try {
        const ensuredProductCount = ensure
          ? await ensure.call(provider)
          : await refresh!.call(provider, false);
        if (timedOut) return;
        const readiness = readinessSnapshot(provider);
        entry.ready = readiness?.ready ?? true;
        entry.productCount = readiness?.productCount ?? ensuredProductCount ?? null;
        entry.refreshing = readiness?.refreshing ?? null;
        entry.lastSuccessfulSync = safeText(readiness?.lastSuccessfulSync) ?? null;
        entry.status = readiness?.ready === false
          ? "UNREADY_AFTER_WAIT"
          : ensure ? "READY_BY_ENSURE" : "READY_BY_REFRESH";
      } catch (error) {
        if (timedOut) return;
        entry.status = "FAILED";
        entry.errorType = safeText(error instanceof Error ? error.name : "UnknownError") ?? "UnknownError";
        const readiness = readinessSnapshot(provider);
        entry.ready = readiness?.ready ?? null;
        entry.productCount = readiness?.productCount ?? null;
        entry.refreshing = readiness?.refreshing ?? null;
        entry.lastSuccessfulSync = safeText(readiness?.lastSuccessfulSync) ?? null;
      } finally {
        if (!timedOut) entry.waitMs = Number((performance.now() - sourceStarted).toFixed(2));
      }
    });
    pending.push({ provider, entry, startedAt: sourceStarted, promise });
  });
  let timedOut = false;
  if (pending.length) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolveTimeout) => {
      timer = setTimeout(() => resolveTimeout(), Math.max(0, timeoutMs));
    });
    timedOut = await Promise.race([
      Promise.all(pending.map((item) => item.promise)).then(() => false),
      timeout.then(() => true),
    ]);
    if (timer) clearTimeout(timer);
    if (timedOut) {
      pending.forEach(({ entry, provider, startedAt: sourceStarted }) => {
        if (entry && entry.status === "UNREADY_AFTER_WAIT") {
          entry.waitMs = Number((performance.now() - sourceStarted).toFixed(2));
          const readiness = readinessSnapshot(provider);
          if (readiness?.ready === true) {
            entry.status = "READY";
            entry.ready = true;
          } else {
            entry.status = "TIMED_OUT";
            entry.ready = readiness?.ready ?? false;
          }
        }
      });
    }
  }
  return {
    timeoutMs,
    durationMs: Number((performance.now() - startedAt).toFixed(2)),
    timedOut,
    partialCoverage: entries.some((entry) => readinessIsIncomplete(entry.status)),
    sources: entries,
  };
}

type FrozenCasesDocument = {
  schemaVersion: number;
  cases: Array<{
    id: string | number;
    query: string;
    category?: ProviderSearchRequest["category"];
    hard?: ReplayCase["hardConstraints"];
  }>;
};

/** Verify exact bytes before parsing or importing the production provider registry. */
export async function loadFrozenCases(
  fileUrl: URL = new URL("./cases.json", import.meta.url),
): Promise<ReplayCase[]> {
  const bytes = await readFile(fileUrl);
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (actualHash !== FROZEN_CASES_SHA256) {
    throw new Error(`Frozen corpus SHA256 mismatch: expected ${FROZEN_CASES_SHA256}, received ${actualHash}`);
  }
  const document = JSON.parse(bytes.toString("utf8")) as FrozenCasesDocument;
  if (document.schemaVersion !== 1 || !Array.isArray(document.cases) || document.cases.length !== 40) {
    throw new Error("Frozen corpus must be schemaVersion 1 with exactly 40 cases.");
  }
  const cases = document.cases.map((item) => ({
    id: String(item.id),
    query: item.query,
    ...(item.category ? { category: item.category } : {}),
    ...(item.hard ? { hardConstraints: item.hard } : {}),
  }));
  if (cases.some((item) => !item.id || typeof item.query !== "string" || !item.query.trim())) {
    throw new Error("Frozen corpus contains a case without a valid id or query.");
  }
  if (new Set(cases.map((item) => item.id)).size !== 40) {
    throw new Error("Frozen corpus case IDs must be unique.");
  }
  return cases;
}

export type SafeCandidate = {
  observationId: string;
  rank: number;
  title: string;
  description?: string;
  brand?: string;
  category?: string;
  merchant?: string;
  price?: number;
  currency?: string;
  availability?: string;
  variant: Record<string, string | number | boolean | null>;
  source: {
    providerId?: string;
    providerName?: string;
    sourceType?: string;
    condition?: string;
    model?: string;
    styleCode?: string;
    identifiers?: IdentityIdentifier[];
  };
  identityRecord: IdentityRecord;
};

export type QueryIdentityEvidence = {
  assertion: "EXACT" | "NO_EXACT";
  status: "VERIFIED" | "ABSTAIN";
  evidence: Array<{
    field: string;
    queryValue: string;
    candidateValue: string;
    source: string;
    scope?: string;
  }>;
  reasons: string[];
};

export type CandidateAudit = {
  observationId: string;
  baselineRank: number;
  identityRank: number;
  queryIdentity: QueryIdentityEvidence;
  assertedExactByArm: { baseline: boolean; identityAware: boolean };
  pairwiseComparisons: Array<{
    scope: "candidate-to-candidate-only; not query identity";
    otherObservationId: string;
    decision: ProductIdentityDecision;
    sourceProof: {
      candidate: Array<{ field: string; value: string; source: string; scope?: string }>;
      other: Array<{ field: string; value: string; source: string; scope?: string }>;
    };
  }>;
};

export type ReplayObservation = {
  caseId: string;
  query: string;
  durationMs: number;
  sourceAvailability: {
    resultCount: number;
    fallbackStatus?: string;
    readinessPreflight?: SourceReadinessReport;
    partialCoverage: boolean;
    coverageNotes: string[];
    providers: Array<{
      providerId?: string;
      ready?: unknown;
      resultCount?: unknown;
      durationMs?: unknown;
      timedOut?: unknown;
      errorType?: unknown;
      refreshing?: unknown;
      indexedProductCount?: unknown;
      lastSuccessfulSync?: unknown;
    }>;
    failures: Array<{
      errorType: string;
      message?: string;
      providerIds: string[];
    }>;
  };
  trace: Array<{ stage: string; details: Record<string, unknown> }>;
  baseline: SafeCandidate[];
  identityAware: SafeCandidate[];
  decisions: CandidateAudit[];
  groups: ReturnType<typeof groupCandidates>;
};

const secretLike = /(?:bearer\s+[\w.-]+|(?:api[_-]?key|token|secret|password)\s*[:=]\s*[\w./+-]+)/giu;
const urlLike = /\b(?:(?:https?|ftp):\/\/|www\.)\S+/giu;
const emailLike = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;

export function safeText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const safe = value
    .replace(urlLike, "[URL]")
    .replace(emailLike, "[EMAIL]")
    .replace(secretLike, "[REDACTED]")
    .replace(/\s+/g, " ")
    .trim();
  return safe || undefined;
}

function safeEvidenceText(value: unknown): string | undefined {
  const safe = safeText(value);
  return safe && !/\[(?:URL|EMAIL|REDACTED)\]/iu.test(safe) ? safe : undefined;
}

type ExtendedProduct = NormalizedProduct & {
  model?: string;
  styleCode?: string;
  identifiers?: IdentityIdentifier[];
  size?: string;
  storage?: string;
  capacity?: string;
  volume?: string;
  packQuantity?: number | string;
  material?: string;
  region?: string;
  authenticity?: string;
  connectivity?: string;
  connector?: string;
  voltage?: string;
  vehicle?: string;
  part?: string;
  oem?: string;
  sku?: string;
  city?: string;
};

const sourceEvidenceCache = new WeakMap<NormalizedProduct, ParsedSourceEvidence>();

function sourceEvidenceFor(product: NormalizedProduct): ParsedSourceEvidence {
  const cached = sourceEvidenceCache.get(product);
  if (cached) return cached;
  const parsed = extractSourceEvidence({
    title: product.title,
    description: product.description,
    brand: product.brand ?? product.canonical.brand,
    providerId: product.providerId,
  });
  sourceEvidenceCache.set(product, parsed);
  return parsed;
}

function candidateObservationId(product: NormalizedProduct): string {
  const digest = createHash("sha256")
    .update(`${product.providerId}\u0000${product.canonical.id}`, "utf8")
    .digest("hex")
    .slice(0, 64);
  return `obs-${digest}`;
}

function safeIdentityRecord(record: IdentityRecord): IdentityRecord {
  return sanitizeTraceValue("", record) as IdentityRecord;
}

function validPairwiseIdentifier(
  identifier: IdentityIdentifier,
  product: NormalizedProduct,
  brand?: string,
): IdentityIdentifier | undefined {
  const value = safeEvidenceText(identifier.value);
  if (!value) return undefined;
  const normalized = normalizeIdentifier(identifier);
  if (normalized.status !== "VALID") return undefined;
  const kind = String(normalized.canonicalKind).toUpperCase();
  const isGtin = /^GTIN(?:8|12|13|14)?$/u.test(kind);
  if (isGtin) return { kind: identifier.kind, value };
  if (!["MODEL", "MPN", "OEM", "STYLE"].includes(kind)) return undefined;
  const suppliedScope = safeEvidenceText(identifier.scope);
  const brandScope = brand ? `brand:${brand}` : undefined;
  const providerScope = safeEvidenceText(product.providerId)
    ? `provider:${safeEvidenceText(product.providerId)}`
    : undefined;
  const scope = suppliedScope ?? brandScope ?? providerScope;
  if (!scope) return undefined;
  if (kind === "MODEL" && !scope.toLocaleLowerCase("en-US").startsWith("brand:")) return undefined;
  return { kind: identifier.kind, value, scope };
}

function identityRecordFor(product: NormalizedProduct, observationId: string): IdentityRecord {
  const source = product as ExtendedProduct;
  const canonical = product.canonical;
  const parsed = sourceEvidenceFor(product);
  const editorial = parsed.editorial;
  const directBrand = safeEvidenceText(product.brand ?? canonical.brand);
  const parsedBrand = !editorial ? safeEvidenceText(parsed.brand?.value) : undefined;
  const brand = directBrand ?? parsedBrand;
  const directModel = safeEvidenceText(source.model);
  const parsedTitleModel = parsed.model?.kind === "MODEL_PATTERN"
    ? safeEvidenceText(parsed.model.value)
    : undefined;
  const brandConflict = Boolean(
    directBrand && parsed.brand &&
    normalizeEvidence(directBrand) !== normalizeEvidence(parsed.brand.value),
  );
  const modelConflict = Boolean(
    directModel && parsedTitleModel &&
    normalizeEvidence(directModel) !== normalizeEvidence(parsedTitleModel),
  );
  const directStyle = safeEvidenceText(source.styleCode);
  const styleConflict = Boolean(
    directStyle && parsed.styleCode &&
    normalizeEvidence(directStyle) !== normalizeEvidence(parsed.styleCode.value),
  );
  const canUseSourceIdentity = !editorial && !brandConflict;
  const modelEvidence = directModel
    ? { value: directModel, scope: brand ? `brand:${brand}` : undefined }
    : parsed.model;
  const model = canUseSourceIdentity && !modelConflict && modelEvidence?.value &&
      modelEvidence.scope?.toLocaleLowerCase("en-US").startsWith("brand:") &&
      brand
    ? safeEvidenceText(modelEvidence.value)
    : undefined;
  const styleEvidence = directStyle
    ? { value: directStyle, scope: brand ? `brand:${brand}` : undefined }
    : parsed.styleCode;
  const styleCode = canUseSourceIdentity && !styleConflict && styleEvidence?.value &&
      styleEvidence.scope?.toLocaleLowerCase("en-US").startsWith("brand:") &&
      brand
    ? safeEvidenceText(styleEvidence.value)
    : undefined;
  const identifiers: IdentityIdentifier[] = [];
  if (!editorial) {
    for (const identifier of [
      ...(source.identifiers ?? []),
      ...parsed.identifiers,
      ...(directStyle ? [{ kind: "STYLE" as const, value: directStyle, scope: brand ? `brand:${brand}` : undefined }] : []),
    ]) {
      const allowed = validPairwiseIdentifier(identifier, product, brand);
      if (!allowed || (brandConflict && !/^GTIN(?:8|12|13|14)?$/iu.test(String(allowed.kind)))) continue;
      if (modelConflict && !/^GTIN(?:8|12|13|14)?$/iu.test(String(allowed.kind))) continue;
      if (styleConflict && String(allowed.kind).toUpperCase() === "STYLE") continue;
      const key = `${allowed.kind}\u0000${allowed.value}\u0000${allowed.scope ?? ""}`;
      if (!identifiers.some((item) => `${item.kind}\u0000${item.value}\u0000${item.scope ?? ""}` === key)) {
        identifiers.push(allowed);
      }
    }
  }
  const pairwiseVariantValue = (direct: unknown, proof?: SourceEvidenceValue) => {
    const directValue = typeof direct === "number" ? direct : safeEvidenceText(direct);
    const parsedValue = safeEvidenceText(proof?.value);
    if (directValue !== undefined && parsedValue &&
        normalizeEvidence(directValue) !== normalizeEvidence(parsedValue)) return undefined;
    return directValue ?? parsedValue;
  };
  const variant = !editorial ? {
    color: pairwiseVariantValue(product.color ?? canonical.color, parsed.variants.color)?.toString(),
    size: pairwiseVariantValue(source.size, parsed.variants.size)?.toString(),
    storage: pairwiseVariantValue(source.storage, parsed.variants.storage)?.toString(),
    capacity: pairwiseVariantValue(source.capacity ?? source.volume, parsed.variants.volume)?.toString(),
    packQuantity: pairwiseVariantValue(source.packQuantity, parsed.variants.packQuantity),
    material: safeEvidenceText(source.material),
    region: safeEvidenceText(source.region),
  } : {};
  const stringField = (value: unknown) => safeEvidenceText(value);
  return safeIdentityRecord({
    id: observationId,
    title: product.title,
    description: product.description ?? undefined,
    brand,
    ...(model ? { model } : {}),
    ...(styleCode ? { styleCode } : {}),
    ...(identifiers.length ? { identifiers } : {}),
    category: safeEvidenceText(product.category ?? canonical.category),
    providerId: safeEvidenceText(product.providerId),
    variant,
    offer: {
      merchant: stringField(product.merchant ?? canonical.merchant),
      price: product.price ?? canonical.price ?? undefined,
      currency: stringField(product.currency ?? canonical.currency),
      availability: stringField(product.availability),
      updatedAt: stringField(product.updatedAt ?? canonical.updatedAt),
    },
  });
}

type PairwiseSourceProof = {
  field: string;
  value: string;
  source: string;
  scope?: string;
};

function pairwiseSourceProof(
  product: NormalizedProduct,
  record: IdentityRecord,
): PairwiseSourceProof[] {
  const source = product as ExtendedProduct;
  const canonical = product.canonical;
  const parsed = sourceEvidenceFor(product);
  const proof: PairwiseSourceProof[] = [];
  const add = (field: string, value: unknown, path: string, scope?: string) => {
    const safeValue = typeof value === "number" ? String(value) : safeEvidenceText(value);
    if (!safeValue) return;
    const entry = {
      field,
      value: safeValue,
      source: path,
      ...(scope ? { scope: safeText(scope) ?? "" } : {}),
    };
    if (!proof.some((item) =>
      item.field === entry.field && item.value === entry.value &&
      item.source === entry.source && item.scope === entry.scope,
    )) proof.push(entry);
  };
  if (record.brand) {
    const directBrand = safeEvidenceText(product.brand ?? canonical.brand);
    add("brand", record.brand, directBrand ? "canonical.brand" : parsed.brand?.source ?? "source.title", parsed.brand?.scope);
  }
  if (record.model) {
    const modelProof = parsed.model && normalizeEvidence(parsed.model.value) === normalizeEvidence(record.model)
      ? parsed.model
      : undefined;
    add("model", record.model, modelProof?.source ?? "source.model", modelProof?.scope ?? (record.brand ? `brand:${record.brand}` : undefined));
  }
  if (record.styleCode) {
    const styleProof = parsed.styleCode && normalizeEvidence(parsed.styleCode.value) === normalizeEvidence(record.styleCode)
      ? parsed.styleCode
      : undefined;
    add("styleCode", record.styleCode, styleProof?.source ?? "source.styleCode", styleProof?.scope ?? (record.brand ? `brand:${record.brand}` : undefined));
  }
  for (const identifier of record.identifiers ?? []) {
    const parsedProof = parsed.identifierProofs.find((candidate) => {
      const proofId = normalizeIdentifier({
        kind: candidate.canonicalKind ?? candidate.kind,
        value: candidate.value,
        ...(candidate.scope ? { scope: candidate.scope } : {}),
      });
      const recordId = normalizeIdentifier(identifier);
      return proofId.status === "VALID" && recordId.status === "VALID" &&
        proofId.canonicalKind === recordId.canonicalKind &&
        proofId.normalized === recordId.normalized;
    });
    add(
      `identifier:${identifier.kind}`,
      identifier.value,
      parsedProof?.source ?? `source.identifiers.${identifier.kind}`,
      parsedProof?.scope ?? identifier.scope,
    );
  }
  const variants: Array<[keyof NonNullable<IdentityRecord["variant"]>, unknown, SourceEvidenceValue | undefined, string]> = [
    ["color", record.variant?.color, parsed.variants.color, "canonical.color"],
    ["size", record.variant?.size, parsed.variants.size, "source.size"],
    ["storage", record.variant?.storage, parsed.variants.storage, "source.storage"],
    ["capacity", record.variant?.capacity, parsed.variants.volume, "source.capacity"],
    ["packQuantity", record.variant?.packQuantity, parsed.variants.packQuantity, "source.packQuantity"],
    ["material", record.variant?.material, undefined, "source.material"],
    ["region", record.variant?.region, undefined, "source.region"],
  ];
  for (const [field, value, parsedProof, directSource] of variants) {
    const selectedProof = parsedProof && normalizeEvidence(parsedProof.value) === normalizeEvidence(value)
      ? parsedProof
      : undefined;
    add(`variant.${field}`, value, selectedProof?.source ?? directSource);
  }
  return proof;
}

function relevantPairwiseSourceProof(
  proof: PairwiseSourceProof[],
  decision: ProductIdentityDecision,
  candidate: IdentityRecord,
  other: IdentityRecord,
): PairwiseSourceProof[] {
  const relevant = new Set<string>();
  const codes = [
    ...decision.positiveEvidence.map((item) => item.code),
    ...decision.conflictingEvidence.map((item) => item.code),
  ];
  for (const code of codes) {
    if (code.includes("GTIN")) {
      for (const kind of ["GTIN", "GTIN8", "GTIN12", "GTIN13", "GTIN14"]) {
        relevant.add(`identifier:${kind}`);
      }
    }
    for (const kind of ["MODEL", "MPN", "OEM", "STYLE"]) {
      if (code.endsWith(`_${kind}`)) relevant.add(`identifier:${kind}`);
    }
    if (code.includes("BRAND")) relevant.add("brand");
    if (code.includes("MODEL")) relevant.add("model");
    if (code.includes("STYLE")) relevant.add("styleCode");
    const variantConflict = code.match(/^VARIANT_([A-Z]+)_CONFLICT$/u)?.[1];
    if (variantConflict) {
      const field = variantConflict === "PACKQUANTITY"
        ? "packQuantity"
        : variantConflict.toLocaleLowerCase("en-US");
      relevant.add(`variant.${field}`);
    }
  }
  if (decision.classification === "SAME_PRODUCT_SAME_VARIANT") {
    for (const field of ["color", "size", "storage", "capacity", "packQuantity", "material", "region"] as const) {
      const left = candidate.variant?.[field];
      const right = other.variant?.[field];
      if (left !== undefined && right !== undefined && normalizeEvidence(left) === normalizeEvidence(right)) {
        relevant.add(`variant.${field}`);
      }
    }
  }
  return proof.filter((item) =>
    relevant.has(item.field) || relevant.has(item.field.toLocaleUpperCase("en-US")),
  );
}

function safeCandidate(product: NormalizedProduct, rank: number): SafeCandidate {
  const source = product as ExtendedProduct;
  const sourceEvidence = sourceEvidenceFor(product);
  const parsedVariants = sourceEvidence.variants;
  const observationId = candidateObservationId(product);
  const canonical = product.canonical;
  const sourceModel = safeEvidenceText(source.model) ?? safeEvidenceText(sourceEvidence.model?.value);
  const sourceStyle = safeEvidenceText(source.styleCode) ?? safeEvidenceText(sourceEvidence.styleCode?.value);
  const sourceIdentifiers = [
    ...(source.identifiers ?? []),
    ...sourceEvidence.identifiers,
  ];
  const variant = {
    ...(safeText(product.color ?? canonical.color ?? parsedVariants.color?.value)
      ? { color: safeText(product.color ?? canonical.color ?? parsedVariants.color?.value)! }
      : {}),
    ...(safeText(source.size ?? parsedVariants.size?.value)
      ? { size: safeText(source.size ?? parsedVariants.size?.value)! }
      : {}),
    ...(safeText(source.storage ?? parsedVariants.storage?.value)
      ? { storage: safeText(source.storage ?? parsedVariants.storage?.value)! }
      : {}),
    ...(safeText(source.capacity) ? { capacity: safeText(source.capacity)! } : {}),
    ...(safeText(source.volume ?? parsedVariants.volume?.value)
      ? { volume: safeText(source.volume ?? parsedVariants.volume?.value)! }
      : {}),
    ...(typeof source.packQuantity === "number"
      ? { packQuantity: source.packQuantity }
      : safeText(source.packQuantity)
        ? { packQuantity: safeText(source.packQuantity)! }
        : parsedVariants.packQuantity
          ? { packQuantity: Number(parsedVariants.packQuantity.value) }
        : {}),
    ...(safeText(source.material) ? { material: safeText(source.material)! } : {}),
    ...(safeText(source.region) ? { region: safeText(source.region)! } : {}),
    ...(safeText(source.connectivity) ? { connectivity: safeText(source.connectivity)! } : {}),
    ...(safeText(source.connector) ? { connector: safeText(source.connector)! } : {}),
    ...(safeText(source.voltage) ? { voltage: safeText(source.voltage)! } : {}),
    ...(safeText(product.condition ?? canonical.condition) ? {
      condition: safeText(product.condition ?? canonical.condition)!,
    } : {}),
    ...(safeText(product.audience ?? canonical.audience) ? {
      audience: safeText(product.audience ?? canonical.audience)!,
    } : {}),
  };
  return {
    observationId,
    rank,
    title: safeText(product.title) ?? "",
    ...(safeText(product.description) ? { description: safeText(product.description) } : {}),
    ...(safeText(product.brand ?? canonical.brand) ? { brand: safeText(product.brand ?? canonical.brand)! } : {}),
    ...(safeText(product.category ?? canonical.category) ? { category: safeText(product.category ?? canonical.category)! } : {}),
    ...(safeText(product.merchant ?? canonical.merchant) ? { merchant: safeText(product.merchant ?? canonical.merchant)! } : {}),
    ...(Number.isFinite(product.price) ? { price: product.price! } : {}),
    ...(safeText(product.currency ?? canonical.currency) ? { currency: safeText(product.currency ?? canonical.currency)! } : {}),
    ...(safeText(product.availability) ? { availability: safeText(product.availability)! } : {}),
    variant,
    source: {
      ...(safeText(product.providerId) ? { providerId: safeText(product.providerId)! } : {}),
      ...(safeText(product.providerName) ? { providerName: safeText(product.providerName)! } : {}),
      ...(safeText(product.sourceType) ? { sourceType: safeText(product.sourceType)! } : {}),
      ...(safeText(canonical.condition) ? { condition: safeText(canonical.condition)! } : {}),
      ...(sourceModel ? { model: sourceModel } : {}),
      ...(sourceStyle ? { styleCode: sourceStyle } : {}),
      ...(sourceIdentifiers.length ? { identifiers: safeIdentityRecord({
        id: observationId,
        title: "",
        identifiers: sourceIdentifiers,
      }).identifiers ?? [] } : {}),
    },
    identityRecord: identityRecordFor(product, observationId),
  };
}

function normalizeEvidence(value: unknown): string {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/[‐‑‒–—−]/g, "-").replace(/\s+/g, " ")
    : String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function sourceStyleEvidence(product: NormalizedProduct): SourceEvidenceValue | undefined {
  const source = product as ExtendedProduct;
  const labeledStyle = (source.identifiers ?? [])
    .map((identifier) => normalizeIdentifier(identifier))
    .find((identifier) =>
      String(identifier.kind).toUpperCase() === "STYLE" && identifier.status === "VALID",
    );
  if (safeEvidenceText(source.styleCode)) {
    return { kind: "STYLE", value: safeEvidenceText(source.styleCode)!, source: "source.styleCode" };
  }
  if (labeledStyle) {
    return {
      kind: "STYLE",
      value: labeledStyle.raw,
      source: "source.identifiers.STYLE",
      ...(labeledStyle.scope ? { scope: labeledStyle.scope } : {}),
    };
  }
  return sourceEvidenceFor(product).styleCode;
}

function sourceModelEvidence(product: NormalizedProduct): SourceEvidenceValue | undefined {
  const directModel = safeEvidenceText((product as ExtendedProduct).model);
  if (directModel) return { kind: "MODEL", value: directModel, source: "source.model" };
  const parsed = sourceEvidenceFor(product).model;
  if (parsed) return parsed;
  return sourceStyleEvidence(product);
}

type SourceValue = {
  value?: string | number;
  source?: string;
  proof?: SourceEvidenceValue;
  conflict?: boolean;
};

function sourceValue(product: NormalizedProduct, field: string): SourceValue {
  const source = product as ExtendedProduct;
  const canonical = product.canonical;
  const evidence = sourceEvidenceFor(product);
  const styleEvidence = sourceStyleEvidence(product);
  const modelEvidence = sourceModelEvidence(product);
  const brandValue = safeEvidenceText(product.brand ?? canonical.brand) ?? safeEvidenceText(evidence.brand?.value);
  const variantValue = (directValue: unknown, directSource: string, proof?: SourceEvidenceValue): SourceValue => {
    if (typeof directValue === "string" || typeof directValue === "number") {
      if (proof && normalizeEvidence(directValue) !== normalizeEvidence(proof.value)) {
        return { conflict: true };
      }
      return { value: directValue, source: directSource };
    }
    return proof ? { value: proof.value, source: proof.source, proof } : {};
  };
  const direct: Record<string, SourceValue> = {
    brand: {
      value: brandValue,
      source: safeEvidenceText(product.brand ?? canonical.brand) ? "canonical.brand" : evidence.brand?.source ?? "",
      ...(evidence.brand && !safeEvidenceText(product.brand ?? canonical.brand) ? { proof: evidence.brand } : {}),
    },
    model: modelEvidence
      ? { value: modelEvidence.value, source: modelEvidence.source, proof: modelEvidence }
      : {},
    styleCode: styleEvidence
      ? { value: styleEvidence.value, source: styleEvidence.source, proof: styleEvidence }
      : {},
    productType: { value: product.productType ?? canonical.productType ?? undefined, source: "canonical.productType" },
    product: { value: product.title, source: "source.title" },
    audience: { value: product.audience ?? canonical.audience ?? undefined, source: "canonical.audience" },
    condition: { value: product.condition ?? canonical.condition ?? undefined, source: "canonical.condition" },
    color: variantValue(
      product.color ?? canonical.color ?? undefined,
      "canonical.color",
      evidence.variants.color,
    ),
    size: variantValue(source.size, "source.size", evidence.variants.size),
    storage: variantValue(source.storage, "source.storage", evidence.variants.storage),
    capacity: variantValue(
      source.capacity ?? source.volume,
      "source.capacity",
      evidence.variants.volume,
    ),
    volume: variantValue(source.volume, "source.volume", evidence.variants.volume),
    packQuantity: typeof source.packQuantity === "number" || typeof source.packQuantity === "string"
      ? { value: source.packQuantity, source: "source.packQuantity" }
      : evidence.variants.packQuantity
        ? {
          value: Number(evidence.variants.packQuantity.value),
          source: evidence.variants.packQuantity.source,
          proof: evidence.variants.packQuantity,
        }
        : {},
    material: { value: source.material, source: "source.material" },
    region: { value: source.region, source: "source.region" },
    city: { value: source.city, source: "source.city" },
    authenticity: { value: source.authenticity, source: "source.authenticity" },
    connectivity: { value: source.connectivity, source: "source.connectivity" },
    connector: { value: source.connector, source: "source.connector" },
    voltage: { value: source.voltage, source: "source.voltage" },
    vehicle: { value: source.vehicle, source: "source.vehicle" },
    part: { value: source.part, source: "source.part" },
    oem: { value: source.oem, source: "source.oem" },
    sku: { value: source.sku, source: "source.sku" },
    priceSAR: { value: product.price ?? canonical.price ?? undefined, source: "canonical.price" },
  };
  const found = direct[field];
  if (field === "priceSAR" &&
      String(product.currency ?? canonical.currency ?? "").toUpperCase() !== "SAR") {
    return {};
  }
  const value = typeof found?.value === "string"
    ? safeEvidenceText(found.value)
    : found?.value;
  return found && (typeof value === "string" || typeof value === "number")
    ? {
      value,
      ...(found.source ? { source: found.source } : {}),
      ...(found.proof ? { proof: found.proof } : {}),
    }
    : {};
}

function sourceIdentifierProof(
  product: NormalizedProduct,
  candidateId: ReturnType<typeof normalizeIdentifier>,
): SourceEvidenceValue | undefined {
  return sourceEvidenceFor(product).identifierProofs.find((proof) => {
    const proofId = normalizeIdentifier({
      kind: proof.canonicalKind ?? proof.kind,
      value: proof.value,
      ...(proof.scope ? { scope: proof.scope } : {}),
    });
    return proofId.status === "VALID" &&
      proofId.canonicalKind === candidateId.canonicalKind &&
      proofId.normalized === candidateId.normalized;
  });
}

function constraintMatches(
  product: NormalizedProduct,
  constraint: NonNullable<ReplayCase["hardConstraints"]>[number],
): { matched: boolean; candidate: SourceValue } {
  if (/^gtin(?:8|12|13|14)?$/iu.test(constraint.field)) {
    const queryId = normalizeIdentifier({
      kind: constraint.field.toUpperCase(),
      value: String(constraint.value),
    });
    const candidateId = [
      ...((product as ExtendedProduct).identifiers ?? []),
      ...sourceEvidenceFor(product).identifiers,
    ]
      .map((identifier) => normalizeIdentifier(identifier))
      .find((identifier) => identifier.status === "VALID" &&
        queryId.status === "VALID" &&
        identifier.normalized === queryId.normalized);
    return {
      matched: Boolean(candidateId),
      candidate: candidateId
        ? {
          value: candidateId.raw,
          source: sourceIdentifierProof(product, candidateId)?.source ?? "source.identifiers",
          ...(sourceIdentifierProof(product, candidateId)
            ? { proof: sourceIdentifierProof(product, candidateId)! }
            : {}),
        }
        : {},
    };
  }
  const candidate = sourceValue(product, constraint.field);
  if (candidate.value === undefined) return { matched: false, candidate };
  if (typeof constraint.value === "string" && !safeEvidenceText(constraint.value)) {
    return { matched: false, candidate };
  }
  if (constraint.op === "eq") {
    return {
      matched: normalizeEvidence(candidate.value) === normalizeEvidence(constraint.value),
      candidate,
    };
  }
  if (constraint.op === "lt" || constraint.op === "gt") {
    const actual = Number(candidate.value);
    const target = Number(constraint.value);
    if (!Number.isFinite(actual) || !Number.isFinite(target)) return { matched: false, candidate };
    return {
      matched: constraint.op === "lt" ? actual < target : actual > target,
      candidate,
    };
  }
  return { matched: false, candidate };
}

const variantConstraintFields = new Set([
  "color", "size", "storage", "capacity", "packQuantity", "material",
  "region", "connectivity", "connector", "voltage", "condition",
]);

function assessQueryIdentity(replayCase: ReplayCase, product: NormalizedProduct): QueryIdentityEvidence {
  const constraints = replayCase.hardConstraints ?? [];
  const evidence: QueryIdentityEvidence["evidence"] = [];
  const reasons: string[] = [];
  const parsedEvidence = sourceEvidenceFor(product);
  if (parsedEvidence.editorial || isEditorialSource({
    title: product.title,
    description: product.description,
  })) reasons.push("family_or_editorial_page");
  if (!constraints.length) reasons.push("no_explicit_query_identity_constraints");

  const constraintMap = new Map(constraints.map((constraint) => [constraint.field, constraint]));
  const brandConstraint = constraintMap.get("brand");
  const modelConstraint = constraintMap.get("model");
  const styleConstraint = constraintMap.get("styleCode");
  let strongIdentityMatched = false;
  const directBrand = safeEvidenceText(product.brand ?? product.canonical.brand);
  const candidateBrand = directBrand ?? safeEvidenceText(parsedEvidence.brand?.value);
  const candidateBrandSource = directBrand ? "canonical.brand" : parsedEvidence.brand?.source;
  const queryBrand = safeEvidenceText(brandConstraint?.value);
  const queryModel = safeEvidenceText(modelConstraint?.value);
  const candidateStyle = sourceStyleEvidence(product);
  const candidateModelProof = sourceModelEvidence(product);
  const candidateStyleCode = safeEvidenceText(candidateStyle?.value);
  const candidateModel = safeEvidenceText(candidateModelProof?.value);
  const titleModel = parsedEvidence.model?.kind === "MODEL_PATTERN"
    ? parsedEvidence.model.value
    : undefined;
  const directModel = safeEvidenceText((product as ExtendedProduct).model);
  const directStyle = safeEvidenceText((product as ExtendedProduct).styleCode);
  if (directBrand && parsedEvidence.brand &&
      normalizeEvidence(directBrand) !== normalizeEvidence(parsedEvidence.brand.value)) {
    reasons.push("source_brand_conflicts_with_title_pattern");
  }
  if (directModel && titleModel && normalizeEvidence(directModel) !== normalizeEvidence(titleModel)) {
    reasons.push("source_model_conflicts_with_title_pattern");
  }
  if (directStyle && parsedEvidence.styleCode &&
      normalizeEvidence(directStyle) !== normalizeEvidence(parsedEvidence.styleCode.value)) {
    reasons.push("source_style_conflicts_with_title_evidence");
  }
  if (brandConstraint && modelConstraint && candidateBrand && candidateModel &&
      queryBrand && queryModel &&
      normalizeEvidence(candidateBrand) === normalizeEvidence(queryBrand) &&
      normalizeEvidence(candidateModel) === normalizeEvidence(queryModel)) {
    strongIdentityMatched = true;
    evidence.push(
      {
        field: "brand",
        queryValue: String(brandConstraint.value),
        candidateValue: candidateBrand,
        source: candidateBrandSource ?? "canonical.brand",
        ...(parsedEvidence.brand?.scope ? { scope: parsedEvidence.brand.scope } : {}),
      },
      {
        field: "model",
        queryValue: queryModel,
        candidateValue: candidateModel,
        source: candidateModelProof?.source ?? "source.model",
        ...(candidateModelProof?.scope ? { scope: candidateModelProof.scope } : {}),
      },
    );
  } else if (brandConstraint && modelConstraint) {
    reasons.push(!candidateModel ? "source_model_or_style_code_missing" : "brand_model_mismatch");
  }
  const brandlessModelHasScopedProof = Boolean(
    candidateModelProof &&
      (candidateModelProof.kind === "MODEL_PATTERN" || candidateModelProof.scope),
  );
  if (!brandConstraint && modelConstraint && candidateBrand &&
      candidateModel && queryModel &&
      normalizeEvidence(candidateModel) === normalizeEvidence(queryModel) &&
      brandlessModelHasScopedProof) {
    strongIdentityMatched = true;
    evidence.push({
      field: "model",
      queryValue: queryModel,
      candidateValue: candidateModel,
      source: candidateModelProof?.source ?? "source.model",
      ...(candidateModelProof?.scope ? { scope: candidateModelProof.scope } : {}),
    });
  }
  if (brandConstraint && styleConstraint && candidateBrand && candidateStyleCode &&
      queryBrand && safeEvidenceText(styleConstraint.value) &&
      normalizeEvidence(candidateBrand) === normalizeEvidence(queryBrand) &&
      normalizeEvidence(candidateStyleCode) === normalizeEvidence(styleConstraint.value)) {
    strongIdentityMatched = true;
    evidence.push(
      {
        field: "brand",
        queryValue: String(brandConstraint.value),
        candidateValue: candidateBrand,
        source: candidateBrandSource ?? "canonical.brand",
        ...(parsedEvidence.brand?.scope ? { scope: parsedEvidence.brand.scope } : {}),
      },
      {
        field: "styleCode",
        queryValue: safeEvidenceText(styleConstraint.value)!,
        candidateValue: candidateStyleCode,
        source: candidateStyle?.source ?? "source.styleCode",
        ...(candidateStyle?.scope ? { scope: candidateStyle.scope } : {}),
      },
    );
  } else if (styleConstraint) {
    reasons.push(!candidateStyleCode ? "source_style_code_missing" : "style_code_mismatch");
  }
  if (!brandConstraint && styleConstraint && candidateStyleCode &&
      safeEvidenceText(styleConstraint.value) &&
      normalizeEvidence(candidateStyleCode) === normalizeEvidence(styleConstraint.value) &&
      candidateStyle?.scope) {
    strongIdentityMatched = true;
    evidence.push({
      field: "styleCode",
      queryValue: safeEvidenceText(styleConstraint.value)!,
      candidateValue: candidateStyleCode,
      source: candidateStyle.source,
      scope: candidateStyle.scope,
    });
  }

  const gtinConstraint = constraints.find((constraint) => /^gtin(?:8|12|13|14)?$/iu.test(constraint.field));
  if (gtinConstraint) {
    const queryIdentifier = normalizeIdentifier({
      kind: gtinConstraint.field.toUpperCase(),
      value: String(gtinConstraint.value),
    });
    const productGtin = [
      ...((product as ExtendedProduct).identifiers ?? []),
      ...parsedEvidence.identifiers,
    ]
      .map((identifier) => normalizeIdentifier(identifier))
      .find((identifier) => /^GTIN(?:8|12|13|14)?$/iu.test(String(identifier.kind)) &&
        identifier.status === "VALID" &&
        queryIdentifier.status === "VALID" &&
        identifier.normalized === queryIdentifier.normalized);
    if (productGtin) {
      strongIdentityMatched = true;
      const proof = sourceIdentifierProof(product, productGtin);
      evidence.push({
        field: gtinConstraint.field,
        queryValue: String(gtinConstraint.value),
        candidateValue: productGtin.raw,
        source: proof?.source ?? "source.identifiers",
        ...(proof?.scope ? { scope: proof.scope } : {}),
      });
    } else {
      reasons.push(queryIdentifier.status !== "VALID" ? "query_gtin_invalid" : "matching_valid_gtin_missing");
    }
  }
  const supportedWithoutBrand = Boolean(
    (!brandConstraint && modelConstraint && brandlessModelHasScopedProof) ||
      (!brandConstraint && styleConstraint && candidateStyle?.scope),
  );
  if (!brandConstraint && !gtinConstraint && !supportedWithoutBrand) {
    reasons.push("query_has_no_supported_brand_model_style_or_gtin");
  }

  for (const constraint of constraints) {
    const { matched, candidate } = constraintMatches(product, constraint);
    if (!matched || candidate.value === undefined) {
      reasons.push(candidate.conflict
        ? `source_variant_conflict:${constraint.field}`
        : `hard_constraint_unverified:${constraint.field}`);
      continue;
    }
    if (candidate.source && !evidence.some((item) => item.field === constraint.field)) {
      evidence.push({
        field: constraint.field,
        queryValue: String(constraint.value),
        candidateValue: String(candidate.value),
        source: candidate.source,
        ...(candidate.proof?.scope ? { scope: candidate.proof.scope } : {}),
      });
    }
  }

  const requiredVariants = constraints.filter((constraint) => variantConstraintFields.has(constraint.field));
  const variantVerified = requiredVariants.every((constraint) => {
    return constraintMatches(product, constraint).matched;
  });
  const verified = strongIdentityMatched && variantVerified && !reasons.length;
  if (!reasons.length && !strongIdentityMatched) reasons.push("source_identity_not_verified_against_query");
  return {
    assertion: verified ? "EXACT" : "NO_EXACT",
    status: verified ? "VERIFIED" : "ABSTAIN",
    evidence: evidence.map((item) => ({
      field: safeText(item.field) ?? "",
      queryValue: safeText(item.queryValue) ?? "",
      candidateValue: safeText(item.candidateValue) ?? "",
      source: safeText(item.source) ?? "",
      ...(item.scope ? { scope: safeText(item.scope) ?? "" } : {}),
    })),
    reasons: [...new Set(reasons.map((reason) => safeText(reason) ?? reason))],
  };
}

function identityOrder(
  candidates: SafeCandidate[],
  assessments: Map<SafeCandidate, QueryIdentityEvidence>,
): SafeCandidate[] {
  const verified = candidates.filter((candidate) =>
    assessments.get(candidate)?.assertion === "EXACT",
  );
  const unverified = candidates.filter((candidate) =>
    assessments.get(candidate)?.assertion !== "EXACT",
  );
  return [...verified, ...unverified].sort((a, b) => {
    const aVerified = assessments.get(a)?.assertion === "EXACT";
    const bVerified = assessments.get(b)?.assertion === "EXACT";
    return aVerified === bVerified ? a.rank - b.rank : aVerified ? -1 : 1;
  });
}

function sanitizeTraceValue(key: string, value: unknown): unknown {
  if (/url|image|credential|token|secret|password|message/i.test(key)) return "[OMITTED]";
  if (typeof value === "string") return safeText(value) ?? "";
  if (Array.isArray(value)) return value.map((item) => sanitizeTraceValue("", item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) =>
      [childKey, sanitizeTraceValue(childKey, child)],
    ));
  }
  return value;
}

function safeTraceDetails(details: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(details).map(([key, value]) =>
    [key, sanitizeTraceValue(key, value)],
  ));
}

/**
 * One V2 invocation per case supplies both orderings. No candidates are filtered,
 * removed, or deduplicated by this experimental layer.
 */
export async function runReplay(
  cases: readonly ReplayCase[],
  options: {
    search?: ReplaySearch;
    allowLive?: boolean;
    independentBenchmarkJudged?: boolean;
    readinessPreflight?: SourceReadinessReport;
  } = {},
): Promise<ReplayObservation[]> {
  if (!options.search && !options.allowLive) {
    throw new Error("Live replay is disabled; pass a fixture search or explicitly set allowLive.");
  }
  if (options.allowLive && options.independentBenchmarkJudged !== true) {
    throw new Error("Live replay requires explicit confirmation that the independent identity benchmark has been judged.");
  }
  if (options.allowLive && !options.readinessPreflight) {
    throw new Error("Live replay requires a completed bounded source/index readiness preflight.");
  }
  const orchestrator = options.search ?? (await import("../../../connectors")).searchOrchestrator;
  const output: ReplayObservation[] = [];
  for (const replayCase of cases) {
    const trace: ReplayObservation["trace"] = [];
    const started = performance.now();
    let response: SearchResult;
    let searchFailure: ReplayObservation["sourceAvailability"]["failures"][number] | undefined;
    try {
      response = await orchestrator.searchWithMetadata(
        { query: replayCase.query, searchMode: "intent" },
        (stage, details) => trace.push({
          stage: safeText(stage) ?? "stage",
          details: safeTraceDetails(details ?? {}),
        }),
      );
    } catch (error) {
      const failure = error as { name?: unknown; message?: unknown; providerIds?: unknown };
      const providerIds = Array.isArray(failure?.providerIds)
        ? failure.providerIds.filter((id): id is string => typeof id === "string")
        : [];
      searchFailure = {
        errorType: safeText(failure?.name) ?? "SearchError",
        ...(safeText(failure?.message) ? { message: safeText(failure.message) } : {}),
        providerIds: providerIds.map((id) => safeText(id) ?? "").filter(Boolean),
      };
      trace.push({
        stage: "search_error",
        details: {
          errorType: searchFailure.errorType,
          ...(searchFailure.message ? { message: searchFailure.message } : {}),
          providerIds: searchFailure.providerIds,
        },
      });
      response = { products: [], fallbackStatus: "unavailable" };
    }
    const durationMs = Number((performance.now() - started).toFixed(2));
    const baseline = response.products.map((product, index) =>
      safeCandidate(product, index + 1),
    );
    const records = baseline.map((candidate) => candidate.identityRecord);
    const groups = sanitizeTraceValue("", groupCandidates(records)) as ReturnType<typeof groupCandidates>;
    const pairwiseProofs = new Map(baseline.map((candidate) => [
      candidate,
      pairwiseSourceProof(response.products[candidate.rank - 1], candidate.identityRecord),
    ]));
    const queryIdentity = new Map(baseline.map((candidate) => [
      candidate,
      assessQueryIdentity(replayCase, response.products[candidate.rank - 1]),
    ]));
    const identityAware = identityOrder(baseline, queryIdentity);
    const idMultiset = (candidates: SafeCandidate[]) => {
      const counts = new Map<string, number>();
      for (const candidate of candidates) {
        counts.set(candidate.observationId, (counts.get(candidate.observationId) ?? 0) + 1);
      }
      return [...counts].sort(([left], [right]) => left.localeCompare(right));
    };
    if (JSON.stringify(idMultiset(identityAware)) !== JSON.stringify(idMultiset(baseline))) {
      throw new Error(`Identity ordering changed candidate cohort for case ${replayCase.id}.`);
    }
    const identityRank = new Map(identityAware.map((candidate, index) => [candidate, index + 1]));
    const decisions = baseline.map((candidate) => {
      const comparisons = baseline
        .filter((other) => other !== candidate)
        .map((other) => {
          const decision = classifyPair(candidate.identityRecord, other.identityRecord);
          return {
            scope: "candidate-to-candidate-only; not query identity" as const,
            otherObservationId: other.observationId,
            decision,
            sourceProof: {
              candidate: relevantPairwiseSourceProof(
                pairwiseProofs.get(candidate) ?? [],
                decision,
                candidate.identityRecord,
                other.identityRecord,
              ),
              other: relevantPairwiseSourceProof(
                pairwiseProofs.get(other) ?? [],
                decision,
                other.identityRecord,
                candidate.identityRecord,
              ),
            },
          };
        });
      const assessment = queryIdentity.get(candidate)!;
      return {
        observationId: candidate.observationId,
        baselineRank: candidate.rank,
        identityRank: identityRank.get(candidate)!,
        queryIdentity: assessment,
        assertedExactByArm: {
          baseline: false,
          identityAware: assessment.assertion === "EXACT",
        },
        pairwiseComparisons: comparisons,
      };
    });
    const runtimeProviderTimings = response.__timings?.providerTimings ?? [];
    const incompleteSources = options.readinessPreflight?.sources.filter((source) =>
      readinessIsIncomplete(source.status),
    ) ?? [];
    const runtimeIssues = runtimeProviderTimings.flatMap((provider) => {
      const providerId = typeof provider.providerId === "string"
        ? safeText(provider.providerId) ?? "unknown-provider"
        : "unknown-provider";
      const notes: string[] = [];
      if (provider.errorType) notes.push(`${providerId}:provider_error:${safeText(provider.errorType) ?? "UnknownError"}`);
      if (provider.timedOut) notes.push(`${providerId}:provider_timeout`);
      if (provider.ready === false) notes.push(`${providerId}:index_unready_during_search`);
      if (provider.refreshing === true) notes.push(`${providerId}:index_refreshing_during_search`);
      return notes;
    });
    const readinessFailures = incompleteSources.map((source) => ({
      errorType: `IndexReadiness_${source.status}`,
      message: `Provider index ${source.status.toLocaleLowerCase("en-US")} during replay preflight.`,
      providerIds: [source.providerId],
    }));
    const runtimeFailures = runtimeProviderTimings.flatMap((provider) => {
      if (!provider.errorType && !provider.timedOut &&
          provider.ready !== false && provider.refreshing !== true) return [];
      const providerId = typeof provider.providerId === "string"
        ? safeText(provider.providerId) ?? "unknown-provider"
        : "unknown-provider";
      return [{
        errorType: safeText(provider.errorType) ??
          (provider.timedOut
            ? "ProviderTimeout"
            : provider.refreshing
              ? "ProviderIndexRefreshing"
              : "ProviderIndexUnready"),
        providerIds: [providerId],
      }];
    });
    const partialCoverage = Boolean(
      searchFailure ||
      options.readinessPreflight?.partialCoverage ||
      runtimeIssues.length,
    );
    output.push({
      caseId: replayCase.id,
      query: safeText(replayCase.query) ?? "",
      durationMs,
      sourceAvailability: {
        resultCount: response.products.length,
        ...(response.fallbackStatus ? { fallbackStatus: response.fallbackStatus } : {}),
        ...(options.readinessPreflight ? { readinessPreflight: options.readinessPreflight } : {}),
        partialCoverage,
        coverageNotes: [
          ...incompleteSources.map((source) =>
            `${source.providerId}:preflight:${source.status.toLocaleLowerCase("en-US")}`,
          ),
          ...runtimeIssues,
          ...(searchFailure ? [`search_failure:${searchFailure.errorType}`] : []),
        ],
        failures: [
          ...(searchFailure ? [searchFailure] : []),
          ...readinessFailures,
          ...runtimeFailures,
        ],
        providers: (response.__timings?.providerTimings ?? []).map((provider) => ({
          ...(typeof provider.providerId === "string" ? { providerId: safeText(provider.providerId) } : {}),
          ...("ready" in provider ? { ready: provider.ready } : {}),
          ...("resultCount" in provider ? { resultCount: provider.resultCount } : {}),
          ...("durationMs" in provider ? { durationMs: provider.durationMs } : {}),
          ...("timedOut" in provider ? { timedOut: provider.timedOut } : {}),
          ...("errorType" in provider && typeof provider.errorType === "string"
            ? { errorType: safeText(provider.errorType) }
            : {}),
          ...("refreshing" in provider ? { refreshing: provider.refreshing } : {}),
          ...("indexedProductCount" in provider ? { indexedProductCount: provider.indexedProductCount } : {}),
          ...("lastSuccessfulSync" in provider && typeof provider.lastSuccessfulSync === "string"
            ? { lastSuccessfulSync: safeText(provider.lastSuccessfulSync) }
            : {}),
        })),
      },
      trace,
      baseline,
      identityAware,
      decisions,
      groups,
    });
  }
  return output;
}

export type ArmMetrics = {
  precisionAt1: number | null;
  precisionAt1Denominator: number;
  successAt5: number | null;
  successAt5Denominator: number;
  supportedExactRank1: number | null;
  supportedExactRank1Denominator: number;
  falseExactRate: number | null;
  falseExactRateDenominator: number;
  irrelevantRate: number | null;
  coverage: number;
  abstentionRate: number;
  inventoryAvailabilityCounts: { found: number; none: number; unknown: number };
};

export function evaluateArm(
  observations: readonly ReplayObservation[],
  judgments: readonly CaseJudgment[],
  arm: "baseline" | "identityAware",
): ArmMetrics {
  const judgmentsByCase = new Map(judgments.map((judgment) => [judgment.caseId, judgment]));
  const evaluated = observations.map((observation) => {
    const judgment = judgmentsByCase.get(observation.caseId);
    const candidates = observation[arm];
    return { observation, judgment, candidates };
  });
  const covered = evaluated.filter(({ judgment }) => judgment?.coverage === "JUDGED");
  const independentlyFound = ({ judgment }: (typeof evaluated)[number]) =>
    judgment?.inventoryAvailabilityAssessment === "found";
  const topCandidateAdequatelyJudged = ({
    judgment, candidates,
  }: (typeof evaluated)[number]) => {
    if (!candidates.length) return false;
    const label = judgment?.candidateJudgments[candidates[0].observationId];
    return label !== undefined && label !== "ABSTAIN";
  };
  const rank1Eligible = covered.filter((row) =>
    independentlyFound(row) && topCandidateAdequatelyJudged(row),
  );
  const successWindowAdequatelyJudged = ({
    judgment, candidates,
  }: (typeof evaluated)[number]) => {
    const window = candidates.slice(0, 5);
    return window.length > 0 && window.every((candidate) => {
      const label = judgment?.candidateJudgments[candidate.observationId];
      return label !== undefined && label !== "ABSTAIN";
    });
  };
  const successEligible = covered.filter((row) =>
    independentlyFound(row) && successWindowAdequatelyJudged(row),
  );
  const isRelevant = (label: CandidateJudgment | undefined) =>
    label === "EXACT" || label === "RELEVANT";
  const relevantTop = rank1Eligible.filter(({ judgment, candidates }) =>
    isRelevant(judgment?.candidateJudgments[candidates[0].observationId]),
  );
  const success = successEligible.filter(({ judgment, candidates }) =>
    candidates.slice(0, 5).some((candidate) =>
      isRelevant(judgment?.candidateJudgments[candidate.observationId]),
    ),
  );
  const allJudged = covered.flatMap(({ judgment, candidates }) =>
    candidates.map((candidate) => judgment?.candidateJudgments[candidate.observationId]),
  );
  const adjudicatedLabels = allJudged.filter((label) =>
    label !== undefined && label !== "ABSTAIN",
  );
  const exactSupported = (
    observation: ReplayObservation,
    candidate: SafeCandidate,
  ): boolean => {
    const audit = observation.decisions.find((item) =>
      item.observationId === candidate.observationId &&
      item.baselineRank === candidate.rank,
    );
    return audit?.queryIdentity.status === "VERIFIED";
  };
  const supportedExactRank1 = rank1Eligible.filter(({ observation, judgment, candidates }) =>
    judgment?.candidateJudgments[candidates[0]?.observationId] === "EXACT" &&
    Boolean(candidates[0] && exactSupported(observation, candidates[0])),
  ).length;
  const assertedExactAdjudications = covered.flatMap(({ observation, judgment, candidates }) =>
    candidates.flatMap((candidate) => {
      const audit = observation.decisions.find((item) =>
        item.observationId === candidate.observationId &&
        item.baselineRank === candidate.rank,
      );
      const asserted = audit?.assertedExactByArm[arm] === true;
      const label = judgment?.candidateJudgments[candidate.observationId];
      return asserted && label !== undefined && label !== "ABSTAIN" ? [label] : [];
    }),
  );
  const falseExactCount = assertedExactAdjudications.filter((label) => label !== "EXACT").length;
  const inventoryAvailabilityCounts = evaluated.reduce(
    (counts, { judgment }) => {
      const assessment = judgment?.inventoryAvailabilityAssessment ?? "unknown";
      counts[assessment] += 1;
      return counts;
    },
    { found: 0, none: 0, unknown: 0 },
  );
  return {
    precisionAt1: rank1Eligible.length ? relevantTop.length / rank1Eligible.length : null,
    precisionAt1Denominator: rank1Eligible.length,
    successAt5: successEligible.length ? success.length / successEligible.length : null,
    successAt5Denominator: successEligible.length,
    supportedExactRank1: rank1Eligible.length ? supportedExactRank1 / rank1Eligible.length : null,
    supportedExactRank1Denominator: rank1Eligible.length,
    falseExactRate: assertedExactAdjudications.length
      ? falseExactCount / assertedExactAdjudications.length
      : null,
    falseExactRateDenominator: assertedExactAdjudications.length,
    irrelevantRate: adjudicatedLabels.length
      ? adjudicatedLabels.filter((label) => label === "IRRELEVANT").length / adjudicatedLabels.length
      : null,
    coverage: observations.length ? covered.length / observations.length : 0,
    abstentionRate: observations.length ? (observations.length - covered.length) / observations.length : 0,
    inventoryAvailabilityCounts,
  };
}

/** Hides arm and rank, presenting each candidate as an independent judgment unit. */
export function buildBlindPacket(
  observations: readonly ReplayObservation[],
  packetId = "identity-replay-blind",
): BlindPacket {
  return {
    packetId,
    cases: observations.map((observation) => ({
      caseId: observation.caseId,
      query: observation.query,
      observations: [...observation.baseline]
        .sort((a, b) => {
          const orderKey = (observationId: string) =>
            createHash("sha256")
              .update(`${observation.caseId}\u0000${observationId}`, "utf8")
              .digest("hex");
          return orderKey(a.observationId).localeCompare(orderKey(b.observationId)) ||
            a.observationId.localeCompare(b.observationId);
        })
        .map((candidate) => ({
          observationId: candidate.observationId,
          title: candidate.title,
          ...(candidate.description ? { description: candidate.description } : {}),
          ...(candidate.brand ? { brand: candidate.brand } : {}),
          ...(candidate.category ? { category: candidate.category } : {}),
          ...(candidate.merchant ? { merchant: candidate.merchant } : {}),
          ...(candidate.price !== undefined ? { price: candidate.price } : {}),
          ...(candidate.currency ? { currency: candidate.currency } : {}),
          ...(candidate.availability ? { availability: candidate.availability } : {}),
          variant: { ...candidate.variant },
          source: { ...candidate.source },
        })),
    })),
  };
}

export type HistoricalContext = {
  label: string;
  metrics: Record<string, number | string | null>;
};

export function comparabilityFlags(
  observations: readonly ReplayObservation[],
  judgments: readonly CaseJudgment[],
): string[] {
  const flags: string[] = [];
  if (observations.length !== 40) flags.push("not_40_cases");
  if (judgments.length !== observations.length) flags.push("judgment_case_count_mismatch");
  if (new Set(observations.map((item) => item.caseId)).size !== observations.length) flags.push("duplicate_case_ids");
  if (observations.some((item) => item.baseline.length !== item.identityAware.length)) flags.push("candidate_cohort_mismatch");
  if (observations.some((item) => item.baseline.length !== item.decisions.length)) flags.push("decision_coverage_mismatch");
  if (observations.some((item) => item.sourceAvailability.partialCoverage)) flags.push("partial_provider_coverage");
  if (observations.some((item) => item.sourceAvailability.readinessPreflight?.partialCoverage)) {
    flags.push("preflight_index_readiness_incomplete");
  }
  return flags;
}

/** Kept explicitly separate from current replay metrics; never included in arm denominators. */
export function reportEvaluation(
  observations: readonly ReplayObservation[],
  judgments: readonly CaseJudgment[],
  historicalContext: readonly HistoricalContext[] = [],
) {
  return {
    baseline: evaluateArm(observations, judgments, "baseline"),
    identityAware: evaluateArm(observations, judgments, "identityAware"),
    comparabilityFlags: comparabilityFlags(observations, judgments),
    historicalContext: historicalContext.map((item) => ({
      label: item.label,
      metrics: { ...item.metrics },
      pooled: false as const,
    })),
  };
}