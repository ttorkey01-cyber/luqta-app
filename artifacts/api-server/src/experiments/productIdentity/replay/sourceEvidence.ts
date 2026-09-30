import { normalizeIdentifier } from "../identifiers";
import type { IdentityIdentifier } from "../types";

export type SourceEvidenceSource = "source.title" | "source.description";

export type SourceEvidenceValue = {
  kind: "MODEL" | "MODEL_PATTERN" | "STYLE" | "GTIN" | "MPN" | "OEM" | "SKU" | "COLOR" | "STORAGE" | "SIZE" | "VOLUME" | "PACK";
  value: string;
  source: SourceEvidenceSource | "source.model" | "source.styleCode" |
    "source.identifiers.STYLE" | "source.title.pattern.samsung_galaxy_s" |
    "source.title.pattern.apple_iphone" | "source.title.pattern.sony_wh" |
    "source.title.pattern.nike_style" | "source.title.pattern.huawei_model";
  scope?: string;
  canonicalKind?: string;
  valid?: boolean;
};

export type SourceEvidenceVariants = {
  color?: SourceEvidenceValue;
  storage?: SourceEvidenceValue;
  size?: SourceEvidenceValue;
  volume?: SourceEvidenceValue;
  packQuantity?: SourceEvidenceValue;
};

export type ParsedSourceEvidence = {
  brand?: SourceEvidenceValue;
  model?: SourceEvidenceValue;
  styleCode?: SourceEvidenceValue;
  identifiers: IdentityIdentifier[];
  identifierProofs: SourceEvidenceValue[];
  variants: SourceEvidenceVariants;
  editorial: boolean;
};

export type SourceEvidenceInput = {
  title: string;
  description?: string | null;
  brand?: string | null;
  providerId?: string | null;
};

const urlLike = /\b(?:(?:https?|ftp):\/\/|www\.)\S+/giu;
const emailLike = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const secretLike = /(?:bearer\s+[\w.-]+|(?:api[_-]?key|token|secret|password)\s*[:=]\s*[\w./+-]+)/giu;

function sourceText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, " ")
    .replace(/<img\b[^>]*>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(urlLike, " ")
    .replace(emailLike, " ")
    .replace(secretLike, " ")
    .normalize("NFKC")
    .replace(/[‐‑‒–—−]/g, "-");
}

function normalized(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

export function isEditorialSource(input: { title: string; description?: string | null }): boolean {
  return /\b(?:bundle|compatible with|replacement for|review|manual|guide|how to|parts? for|accessor(?:y|ies)|collection|assorted|family(?: pack)?|assortment|comparison|compare|versus|vs\.?|roundup|buying guide)\b/iu
    .test(`${sourceText(input.title)} ${sourceText(input.description)}`);
}

function safeScope(value: string | null | undefined): string | undefined {
  const safe = sourceText(value).replace(/\s+/g, " ").trim();
  if (!safe || /[<>]/u.test(safe)) return undefined;
  return safe.slice(0, 80);
}

function modelPattern(
  title: string,
  brand: string | null | undefined,
): { brand?: string; model?: SourceEvidenceValue; styleCode?: SourceEvidenceValue } {
  const normalizedBrand = normalized(brand ?? "");
  const hasBrand = (name: string) =>
    normalizedBrand === normalized(name) || new RegExp(`\\b${name}\\b`, "iu").test(title);
  const samsung = title.match(/\bGalaxy\s+(S\d{1,2})(?:\s*(\+)|\s+(Ultra|FE|Edge|Plus))?(?=$|[\s,;()[\]{}|])/iu);
  if (samsung && hasBrand("Samsung")) {
    const tier = samsung[2] || samsung[3]?.toLocaleLowerCase("en-US") === "plus"
      ? "+"
      : samsung[3] ? ` ${samsung[3]}` : "";
    return {
      brand: "Samsung",
      model: {
        kind: "MODEL_PATTERN",
        value: `Galaxy ${samsung[1].toUpperCase()}${tier}`,
        source: "source.title.pattern.samsung_galaxy_s",
        scope: "brand:samsung",
      },
    };
  }

  const iphone = title.match(/\biPhone\s+(?:(\d{1,2})(?:\s+(Pro\s+Max|Pro|Plus|mini|e))?|(SE)(?:\s*\((\d+(?:st|nd|rd|th)?)\s+gen(?:eration)?\))?)(?=$|[\s,;()[\]{}|])/iu);
  if (iphone && hasBrand("Apple")) {
    const model = iphone[3]
      ? `iPhone SE${iphone[4] ? ` ${iphone[4]} gen` : ""}`
      : `iPhone ${iphone[1]}${iphone[2] ? ` ${iphone[2].replace(/\s+/g, " ")}` : ""}`;
    return {
      brand: "Apple",
      model: {
        kind: "MODEL_PATTERN",
        value: model,
        source: "source.title.pattern.apple_iphone",
        scope: "brand:apple",
      },
    };
  }

  const sony = title.match(/\b(WH)\s*-?\s*(1000XM\d{1,2})\b/iu);
  if (sony && hasBrand("Sony")) {
    return {
      brand: "Sony",
      model: {
        kind: "MODEL_PATTERN",
        value: `WH-${sony[2].toUpperCase()}`,
        source: "source.title.pattern.sony_wh",
        scope: "brand:sony",
      },
    };
  }

  if (hasBrand("Nike")) {
    const nikeStyle = title.match(/\b([A-Z0-9]{6}-\d{3})\b/iu);
    if (nikeStyle) {
      return {
        brand: "Nike",
        styleCode: {
          kind: "STYLE",
          value: nikeStyle[1].toUpperCase(),
          source: "source.title.pattern.nike_style",
          scope: "brand:nike",
        },
      };
    }
  }

  if (hasBrand("Huawei")) {
    const huaweiCode = title.match(/\b([A-Z]{3}-[A-Z0-9]{3,})\b/iu);
    if (huaweiCode) {
      return {
        brand: "Huawei",
        model: {
          kind: "MODEL_PATTERN",
          value: huaweiCode[1].toUpperCase(),
          source: "source.title.pattern.huawei_model",
          scope: "brand:huawei",
        },
      };
    }
  }
  return {};
}

function identifierScope(
  kind: "MODEL" | "MPN" | "OEM" | "STYLE" | "SKU",
  brand: string | null | undefined,
  providerId: string | null | undefined,
): string | undefined {
  const safeBrand = safeScope(brand);
  const safeProvider = safeScope(providerId);
  if (kind === "SKU") return safeProvider ? `provider:${safeProvider}` : safeBrand ? `brand:${safeBrand}` : undefined;
  return safeBrand ? `brand:${safeBrand}` : safeProvider ? `provider:${safeProvider}` : undefined;
}

function labelledIdentifiers(
  text: string,
  source: SourceEvidenceSource,
  brand: string | null | undefined,
  providerId: string | null | undefined,
): { identifiers: IdentityIdentifier[]; proofs: SourceEvidenceValue[] } {
  const identifiers: IdentityIdentifier[] = [];
  const proofs: SourceEvidenceValue[] = [];
  const gtinLabel = /\b(GTIN(?:[- ]?(?:8|12|13|14))?|EAN(?:[- ]?(?:8|13))?|UPC(?:-?A)?)\b\s*(?:(?:number|code|id)\s*)?[:#=\-]?\s*(\d{8,14})\b/giu;
  for (const match of text.matchAll(gtinLabel)) {
    const label = match[1].toUpperCase().replace(/[\s-]/g, "");
    const kind = label === "UPC" || label === "UPCA"
      ? "UPC"
      : label === "EAN8"
        ? "EAN8"
        : label === "EAN13"
          ? "EAN13"
          : label.startsWith("EAN")
            ? "EAN"
            : label;
    const identifier: IdentityIdentifier = { kind, value: match[2] };
    const validation = normalizeIdentifier(identifier);
    identifiers.push(identifier);
    proofs.push({
      kind: "GTIN",
      value: match[2],
      source,
      canonicalKind: validation.canonicalKind,
      valid: validation.status === "VALID",
    });
  }

  const labeledCode = /\b(MPN|OEM|STYLE(?:\s+CODE)?|SKU|MODEL)\b\s*(?:(?:number|no\.?|code)\s*)?[:#=\-]\s*([A-Z0-9][A-Z0-9._/-]{2,})\b/giu;
  for (const match of text.matchAll(labeledCode)) {
    const label = match[1].toUpperCase().replace(/\s+/g, "");
    const kind = label.startsWith("STYLE")
      ? "STYLE"
      : label as "MODEL" | "MPN" | "OEM" | "SKU";
    const scope = identifierScope(kind, brand, providerId);
    if (!scope) continue;
    const identifier: IdentityIdentifier = { kind, value: match[2], scope };
    if (normalizeIdentifier(identifier).status !== "VALID") continue;
    identifiers.push(identifier);
    proofs.push({ kind, value: match[2], source, scope, valid: true });
  }
  return { identifiers, proofs };
}

function uniqueValue(values: string[]): string | undefined {
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  return unique.length === 1 ? unique[0] : undefined;
}

function parseVariants(title: string, description: string): SourceEvidenceVariants {
  const variants: SourceEvidenceVariants = {};
  const colorNames = [
    "black", "white", "red", "blue", "green", "yellow", "orange", "purple", "pink",
    "brown", "beige", "gray", "grey", "silver", "gold", "navy", "cream",
  ];
  const parseColor = (text: string, source: SourceEvidenceSource, allowUnlabeled: boolean) => {
    const labeled = text.match(/\bcolou?r\s*[:#=]\s*([a-z]+(?:[ /-][a-z]+)?)\b/iu)?.[1];
    const found = labeled
      ? [labeled]
      : allowUnlabeled
        ? [...text.matchAll(new RegExp(`\\b(${colorNames.join("|")})\\b`, "giu"))].map((match) => match[1])
        : [];
    const color = uniqueValue(found);
    if (color && colorNames.includes(color.toLowerCase())) {
      return { kind: "COLOR" as const, value: color.toLowerCase(), source };
    }
    return undefined;
  };
  variants.color = parseColor(title, "source.title", true) ??
    parseColor(description, "source.description", false);

  const storageValue = (text: string) => {
    const tokens = [...text.matchAll(/\b(\d{1,5})\s*(GB|TB)\b/giu)]
      .map((match) => `${match[1]}${match[2].toUpperCase()}`);
    const labeled = text.match(/\b(?:storage|memory)\s*[:#=]\s*(\d{1,5}\s*(?:GB|TB))\b/iu)?.[1]
      ?.replace(/\s+/g, "").toUpperCase();
    return labeled ?? uniqueValue(tokens);
  };
  const storage = storageValue(title) ?? storageValue(description);
  if (storage) {
    variants.storage = {
      kind: "STORAGE",
      value: storage,
      source: storageValue(title) ? "source.title" : "source.description",
    };
  }

  const sizeToken = (text: string) => {
    const matches = [
      ...text.matchAll(/\b(EU|US|UK)\s*(\d{1,2}(?:\.\d+)?)\b/giu),
      ...text.matchAll(/\b(XS|S|M|L|XL|XXL|XXXL)\b/giu),
    ].map((match) => match[2] ? `${match[1].toUpperCase()} ${match[2]}` : match[1].toUpperCase());
    const labeled = text.match(/\bsize\s*[:#=]\s*((?:EU|US|UK)\s*\d{1,2}(?:\.\d+)?|XS|S|M|L|XL|XXL|XXXL)\b/iu)?.[1];
    return labeled || uniqueValue(matches);
  };
  const titleSize = sizeToken(title);
  const descSize = titleSize ? undefined : sizeToken(description);
  const size = titleSize ?? descSize;
  if (size) {
    variants.size = {
      kind: "SIZE",
      value: size.toUpperCase().replace(/\s+/g, " "),
      source: titleSize ? "source.title" : "source.description",
    };
  }

  const volumeTokens = [...title.matchAll(/\b(\d+(?:\.\d+)?)\s*(ml|cl|l|oz)\b/giu)]
    .map((match) => `${match[1]}${match[2].toLowerCase()}`);
  const volume = uniqueValue(volumeTokens);
  if (volume) {
    variants.volume = { kind: "VOLUME", value: volume, source: "source.title" };
    if (!variants.size) variants.size = { kind: "SIZE", value: volume, source: "source.title" };
  } else if (!volumeTokens.length) {
    const descVolumes = [...description.matchAll(/\b(\d+(?:\.\d+)?)\s*(ml|cl|l|oz)\b/giu)]
      .map((match) => `${match[1]}${match[2].toLowerCase()}`);
    const descVolume = uniqueValue(descVolumes);
    if (descVolume) {
      variants.volume = { kind: "VOLUME", value: descVolume, source: "source.description" };
      if (!variants.size) variants.size = { kind: "SIZE", value: descVolume, source: "source.description" };
    }
  }

  const packPattern = /\bpack\s*of\s*(\d{1,3})\b|\b(\d{1,3})\s*[- ]?pack\b|\b(\d{1,3})\s*(?:pcs|pieces|count)\b/iu;
  const pack = title.match(packPattern);
  const descriptionPack = pack ? undefined : description.match(packPattern);
  const packQuantity = pack?.[1] ?? pack?.[2] ?? pack?.[3] ??
    descriptionPack?.[1] ?? descriptionPack?.[2] ?? descriptionPack?.[3];
  if (packQuantity) {
    variants.packQuantity = {
      kind: "PACK",
      value: String(Number(packQuantity)),
      source: pack ? "source.title" : "source.description",
    };
  }
  return variants;
}

export function extractSourceEvidence(input: SourceEvidenceInput): ParsedSourceEvidence {
  const title = sourceText(input.title);
  const description = sourceText(input.description);
  const pattern = modelPattern(title, input.brand);
  const titleIdentifiers = labelledIdentifiers(title, "source.title", input.brand ?? pattern.brand, input.providerId);
  const descriptionIdentifiers = labelledIdentifiers(
    description,
    "source.description",
    input.brand ?? pattern.brand,
    input.providerId,
  );
  const parsedIdentifiers = {
    identifiers: [...titleIdentifiers.identifiers, ...descriptionIdentifiers.identifiers],
    proofs: [...titleIdentifiers.proofs, ...descriptionIdentifiers.proofs],
  };
  const labelledModel = parsedIdentifiers.proofs.find((proof) =>
    proof.kind === "MODEL" || proof.kind === "MPN" || proof.kind === "OEM",
  );
  const labelledStyle = parsedIdentifiers.proofs.find((proof) => proof.kind === "STYLE");
  const allIdentifiers = [
    ...parsedIdentifiers.identifiers,
    ...(pattern.styleCode
      ? [{ kind: "STYLE", value: pattern.styleCode.value, scope: pattern.styleCode.scope }]
      : []),
  ];
  const identifierProofs = [
    ...parsedIdentifiers.proofs,
    ...(pattern.styleCode ? [pattern.styleCode] : []),
  ];
  return {
    ...(pattern.brand ? {
      brand: {
        kind: "MODEL_PATTERN",
        value: pattern.brand,
        source: pattern.model?.source ?? pattern.styleCode?.source ?? "source.title.pattern.nike_style",
      },
    } : {}),
    ...(labelledModel
      ? { model: labelledModel }
      : pattern.model
        ? { model: pattern.model }
        : {}),
    ...(labelledStyle ? { styleCode: labelledStyle } : pattern.styleCode ? { styleCode: pattern.styleCode } : {}),
    identifiers: allIdentifiers,
    identifierProofs,
    variants: parseVariants(title, description),
    editorial: isEditorialSource(input),
  };
}