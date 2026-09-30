import type {
  IdentityIdentifier,
  IdentifierKind,
  NormalizedIdentifier,
} from "./types";

const GTIN_LENGTHS: Record<string, number> = {
  GTIN8: 8,
  GTIN12: 12,
  GTIN13: 13,
  GTIN14: 14,
};

export function canonicalIdentifierKind(kind: string): string {
  const compactKind = normalizeToken(kind).replace(/[^A-Z0-9]/g, "");
  if (["GTIN", "GTIN8", "GTIN12", "GTIN13", "GTIN14"].includes(compactKind)) {
    return compactKind;
  }
  if (compactKind === "UPC" || compactKind === "UPCA") return "GTIN12";
  if (compactKind === "EAN8") return "GTIN8";
  if (compactKind === "EAN13") return "GTIN13";
  if (compactKind === "EAN") return "EAN";
  if (compactKind === "OEMPART") return "OEM";
  if (compactKind === "STYLECODE") return "STYLE";
  return normalizeToken(kind);
}

function normalizeToken(value: string): string {
  return value.normalize("NFKC").trim().toLocaleUpperCase("en-US")
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[\s#]+|[\s#]+$/g, "");
}

function isValidGtin(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let weight = 3;
  for (let index = digits.length - 2; index >= 0; index -= 1) {
    sum += Number(digits[index]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

function gtinLength(kind: string, raw: string): number | undefined {
  if (GTIN_LENGTHS[kind]) return GTIN_LENGTHS[kind];
  if (kind !== "GTIN" && kind !== "EAN") return undefined;
  const digits = raw.replace(/[\s-]/g, "");
  const supportedLengths = kind === "EAN" ? [8, 13] : [8, 12, 13, 14];
  return supportedLengths.includes(digits.length) ? digits.length : undefined;
}

/**
 * Canonicalizes an identifier without silently repairing bad data.
 * GTINs are VALID only when both their length and check digit are valid.
 */
export function normalizeIdentifier(
  identifier: IdentityIdentifier,
): NormalizedIdentifier {
  const kind = identifier.kind;
  const raw = identifier.value;
  const scope = identifier.scope?.trim() || undefined;
  let normalizedKind = canonicalIdentifierKind(String(kind));
  if (normalizedKind === "EAN") {
    const length = raw.replace(/[\s-]/g, "").length;
    if (length === 8) normalizedKind = "GTIN8";
    else if (length === 13) normalizedKind = "GTIN13";
  }
  const expectedLength = gtinLength(normalizedKind, raw);

  if (normalizedKind === "GTIN" || normalizedKind === "EAN" || normalizedKind in GTIN_LENGTHS) {
    const normalized = raw.replace(/[\s-]/g, "");
    const status =
      expectedLength !== undefined &&
      normalized.length === expectedLength &&
      /^\d+$/.test(normalized) &&
      isValidGtin(normalized)
        ? "VALID"
        : "INVALID";
    return {
      kind,
      canonicalKind: normalizedKind,
      raw,
      normalized: status === "VALID" ? normalized.padStart(14, "0") : normalized,
      scope,
      status,
    };
  }

  const normalized = normalizeToken(raw);
  if (["MPN", "SKU", "OEM", "MODEL", "STYLE"].includes(normalizedKind)) {
    return {
      kind,
      canonicalKind: normalizedKind,
      raw,
      normalized: normalized.replace(/\s*-\s*/g, "-"),
      scope,
      status: normalized ? "VALID" : "INVALID",
    };
  }

  return {
    kind,
    canonicalKind: normalizedKind,
    raw,
    normalized,
    scope,
    status: normalized ? "UNKNOWN_FORMAT" : "INVALID",
  };
}

export function normalizeIdentifiers(
  identifiers: readonly IdentityIdentifier[] = [],
): NormalizedIdentifier[] {
  return identifiers.map(normalizeIdentifier);
}