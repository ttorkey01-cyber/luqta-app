import type { NormalizedProduct } from "../../connectors/types";
import type { Phase1Intent } from "./phase1Intent";

export type CandidateClassification =
  | "EXACT"
  | "PROBABLE_EXACT"
  | "CLOSE_ALTERNATIVE"
  | "SIMILAR"
  | "WEAK"
  | "IRRELEVANT";

export type ConstraintStatus = "verified_pass" | "verified_fail" | "unknown";

export type ConstraintEvaluation = {
  status: ConstraintStatus;
  reason: string;
};

export type EvaluatedPhase1Candidate = {
  product: NormalizedProduct;
  classification: CandidateClassification;
  /** Deterministic, provider-independent relevance score (0..1). */
  score: number;
  constraints: Record<string, ConstraintEvaluation>;
  evidence: string[];
  source: string;
  strategy: string | null;
};

export type RejectedPhase1Candidate = EvaluatedPhase1Candidate & {
  diagnostics: string[];
};

export type Phase1CandidateEvaluation = {
  /** Only candidates that passed every explicit hard constraint. */
  qualifying: EvaluatedPhase1Candidate[];
  /** Relevant non-exact discovery suggestions; identity uncertainty is never qualification. */
  alternatives: EvaluatedPhase1Candidate[];
  /** Hard-constraint failures and candidates that are not meaningfully relevant. */
  rejected: RejectedPhase1Candidate[];
};

type StrategyLookup = Record<string, string> | Map<string, string>;

const isExplicit = (field: Phase1Intent["brand"]) =>
  field.value !== null && field.evidence === "USER_EXPLICIT";

const normalized = (value: string) =>
  value
    .toLocaleLowerCase()
    .replace(/[٠-٩۰-۹]/gu, (digit) => {
      const digits = "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹";
      const index = digits.indexOf(digit);
      return String(index < 10 ? index : index - 10);
    })
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[ـ]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");

const same = (left: string, right: string) => normalized(left) === normalized(right);
const identifierKey = (value: string) => normalized(value).replace(/\s+/gu, "");

function westernDigits(value: string) {
  return value.replace(/[٠-٩۰-۹]/gu, (digit) => {
    const digits = "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹";
    const index = digits.indexOf(digit);
    return String(index < 10 ? index : index - 10);
  });
}

function isValidGTIN14(value: string) {
  const digits = westernDigits(value);
  if (!/^\d{14}$/u.test(digits)) return false;
  let sum = 0;
  for (let index = digits.length - 2, weight = 3; index >= 0; index -= 1, weight = weight === 3 ? 1 : 3) {
    sum += Number(digits[index]) * weight;
  }
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1));
}

function addConstraint(
  constraints: Record<string, ConstraintEvaluation>,
  name: string,
  status: ConstraintStatus,
  reason: string,
) {
  constraints[name] = { status, reason };
}

function resultFor(
  product: NormalizedProduct,
  classification: CandidateClassification,
  score: number,
  constraints: Record<string, ConstraintEvaluation>,
  evidence: string[],
  strategy: string | null,
): EvaluatedPhase1Candidate {
  return {
    product,
    classification,
    score,
    constraints,
    evidence,
    source: product.canonical.sourceType || product.sourceType || product.providerName,
    strategy,
  };
}

const CATEGORY_ALIASES: Record<string, string[]> = {
  automotive: [
    "auto", "car", "automotive", "vehicle", "headlight", "headlamp",
    "spark plug", "spare parts", "tire", "tyre", "قطع غيار", "سيارة",
    "شمعة امامية", "شمعة احتراق", "بواجي", "كفر",
  ],
  beauty_care: ["beauty", "cosmetic", "perfume", "fragrance", "عطر", "تجميل"],
  fashion: ["fashion", "clothing", "apparel", "shirt", "t shirt", "تيشيرت"],
  bags_accessories: ["bag", "handbag", "backpack", "شنطة", "حقيبة"],
  watches_jewelry: ["watch", "jewelry", "jewellery", "ساعة", "مجوهرات"],
  electronics: [
    "phone", "mobile", "laptop", "electronics", "charger", "charging adapter",
    "earbuds", "wireless earbuds", "headphones", "headset", "سماعات", "سماعة",
    "شاحن", "جوال", "هاتف", "لابتوب",
  ],
  home_living: ["home", "chair", "furniture", "كرسي", "منزل"],
  shoes: ["shoe", "shoes", "footwear", "حذاء", "جزم"],
  eyewear: ["eyewear", "sunglasses", "glasses", "نظارة"],
  kids_baby: ["baby", "kids", "children", "أطفال"],
  sports_fitness: ["sports", "fitness", "رياضة"],
  games_hobbies: ["game", "games", "hobby", "ألعاب"],
};

function categoryFor(value: string | null | undefined) {
  if (!value) return null;
  const key = normalized(value).replace(/ /gu, "_");
  if (key in CATEGORY_ALIASES) return key;
  const plain = normalized(value);
  for (const [category, aliases] of Object.entries(CATEGORY_ALIASES)) {
    if (aliases.some((alias) => normalized(alias) === plain)) return category;
  }
  return null;
}

function candidateCategory(product: NormalizedProduct) {
  return (
    categoryFor(product.canonical.category) ??
    categoryFor(product.category) ??
    categoryFor(product.canonical.productType) ??
    categoryFor(product.productType) ??
    categoryFor(product.canonical.subcategory) ??
    categoryFor(product.subcategory)
  );
}

function queryCategory(intent: Phase1Intent) {
  if (intent.automotive.value === true) return "automotive";
  return (
    categoryFor(intent.productType.value) ??
    categoryFor(intent.category.value) ??
    categoryFor(intent.baseIntent.productType) ??
    categoryFor(intent.baseIntent.category) ??
    categoryFor(kindFromText(intent.explicitText))
  );
}

const PRODUCT_KINDS: Record<string, string[]> = {
  headlight: ["headlight", "headlamp", "head light", "head lamp", "شمعة أمامية", "شمعة امامية"],
  spark_plug: ["spark plug", "spark plugs", "بواجي", "بوجيه", "شمعة احتراق", "شمعة المحرك"],
  phone_case: [
    "phone case", "phone cover", "mobile case", "mobile cover", "case for phone",
    "case for mobile", "smartphone case", "حافظة جوال", "كفر جوال", "جراب هاتف",
  ],
  phone: ["phone", "mobile phone", "smartphone", "جوال", "هاتف"],
  laptop: ["laptop", "notebook computer", "لابتوب"],
  earbuds: [
    "earbuds", "earbud", "wireless earbuds", "headphones", "headphone", "headset",
    "wireless headphones", "bluetooth earbuds", "سماعات", "سماعة", "سماعات أذن",
    "سماعة أذن", "سماعات لاسلكية", "سماعات بلوتوث",
  ],
  charger: ["charger", "charging adapter", "power adapter", "شاحن", "شواحن"],
  handbag: ["handbag", "bag", "purse", "شنطة", "حقيبة"],
  shoes: ["shoes", "shoe", "footwear", "حذاء", "جزم"],
  sunglasses: ["sunglasses", "نظارة شمسية", "نظارات شمسية"],
  perfume: ["perfume", "fragrance", "عطر"],
  tire: ["tire", "tyre", "كفر", "إطار"],
  spare_parts: ["spare parts", "auto parts", "قطع غيار"],
};

function kindFromText(value: string | null | undefined) {
  if (!value) return null;
  const text = normalized(value);
  // Prefer specific accessory/part kinds before broader product kinds.
  for (const [kind, aliases] of Object.entries(PRODUCT_KINDS)) {
    if (aliases.some((alias) => {
      const token = normalized(alias);
      return text === token || new RegExp(`(?:^| )${token.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?=$| )`, "u").test(text);
    })) return kind;
  }
  return null;
}

function requestedKind(intent: Phase1Intent) {
  return kindFromText(intent.productType.value) ??
    kindFromText(intent.baseIntent.productType) ??
    kindFromText(intent.category.value) ??
    kindFromText(intent.explicitText);
}

function candidateKind(product: NormalizedProduct) {
  return kindFromText(product.canonical.productType) ??
    kindFromText(product.productType) ??
    kindFromText(product.canonical.subcategory) ??
    kindFromText(product.subcategory) ??
    kindFromText(product.canonical.title);
}

function structuredCandidateKind(product: NormalizedProduct) {
  return kindFromText(product.canonical.productType) ??
    kindFromText(product.productType) ??
    kindFromText(product.canonical.subcategory) ??
    kindFromText(product.subcategory);
}

function queryTerms(intent: Phase1Intent) {
  const stop = new Set([
    "a", "an", "the", "for", "in", "with", "and", "of", "to", "at", "from",
    "أبي", "ابغى", "أبغى", "أبغا", "ودي", "في", "من", "على", "و",
  ]);
  return normalized(intent.explicitText || intent.rawQuery)
    .split(" ")
    .filter((term) => term.length > 1 && !stop.has(term));
}

type ConnectorKind = "usb_c" | "micro_usb" | "ambiguous" | null;

function connectorInText(text: string): ConnectorKind {
  const value = normalized(text);
  const hasMicroUsb = /(?:^| )micro\s*usb(?:$| )/u.test(value);
  const hasUsbC = /(?:^| )(?:usb\s*c|type\s*c)(?=$| )/u.test(value) ||
    /(?:^| )(?:تايب\s*سي|يو\s*اس\s*بي\s*سي)(?=$| )/u.test(value);
  if (hasMicroUsb && hasUsbC) return "ambiguous";
  if (hasMicroUsb) return "micro_usb";
  if (hasUsbC) return "usb_c";
  return null;
}

function requestedConnector(intent: Phase1Intent): ConnectorKind {
  return connectorInText(`${intent.explicitText} ${intent.rawQuery}`);
}

function candidateConnector(product: NormalizedProduct): ConnectorKind {
  return connectorInText([
    product.canonical.title,
    product.canonical.description ?? "",
    product.canonical.productType ?? "",
    product.canonical.subcategory ?? "",
  ].join(" "));
}

function recognizedQueryTokens(intent: Phase1Intent) {
  const known = new Set<string>();
  const values: Array<string | null> = [
    intent.productType.value,
    intent.category.value,
    intent.brand.value,
    intent.model.value,
    intent.color.value,
    intent.size.value,
    intent.material.value,
    intent.style.value,
    intent.condition.value,
    intent.city.value,
    intent.vehicle.make.value,
    intent.vehicle.model.value,
    intent.vehicle.partName.value,
    intent.vehicle.partNumber.value,
    intent.vehicle.oemNumber.value,
    intent.baseIntent.productType ?? null,
    intent.baseIntent.category ?? null,
    intent.baseIntent.brand ?? null,
    intent.baseIntent.color ?? null,
  ];
  for (const value of values) {
    if (value) for (const token of normalized(value).split(" ")) known.add(token);
  }
  for (const aliases of Object.values(CATEGORY_ALIASES)) {
    for (const alias of aliases) for (const token of normalized(alias).split(" ")) known.add(token);
  }
  for (const aliases of Object.values(PRODUCT_KINDS)) {
    for (const alias of aliases) for (const token of normalized(alias).split(" ")) known.add(token);
  }
  for (const token of ["new", "used", "refurbished", "original", "authentic", "أصلي", "اصلي", "مستعمل", "جديد"]) {
    known.add(normalized(token));
  }
  for (const token of ["usb", "type", "c", "wireless", "current", "stale", "offer"]) {
    known.add(token);
  }
  return known;
}

function labeledIdentifiers(product: NormalizedProduct) {
  const text = `${product.canonical.title}\n${product.canonical.description ?? ""}`;
  const identifiers: Record<"sku" | "mpn" | "oem" | "gtin14", Set<string>> = {
    sku: new Set(),
    mpn: new Set(),
    oem: new Set(),
    gtin14: new Set(),
  };
  const pattern =
    /(\bsku\b|\bmpn\b|\boem\b|\bpart\s*(?:number|no\.?)\b|رقم\s*(?:القطعة|القطعه|المنتج)|اوي\s*ام)\s*[:#-]?\s*([\p{L}\p{N}][\p{L}\p{N}./-]{1,39})/giu;
  for (const match of text.matchAll(pattern)) {
    const label = normalized(match[1]);
    const kind = label === "sku"
      ? "sku"
      : label === "oem" || label === "اوي ام"
        ? "oem"
        : "mpn";
    identifiers[kind].add(identifierKey(match[2]));
  }
  const gtinPattern = /\bgtin(?:-?14)?\b\s*[:#-]?\s*([0-9٠-٩۰-۹]{14})(?![\p{L}\p{N}])/giu;
  for (const match of text.matchAll(gtinPattern)) {
    if (isValidGTIN14(match[1])) {
      identifiers.gtin14.add(identifierKey(westernDigits(match[1])));
    }
  }
  return identifiers;
}

function requestedGtin(intent: Phase1Intent) {
  const value = intent.gtin14.value;
  return value && intent.gtin14.evidence === "USER_EXPLICIT" && isValidGTIN14(value)
    ? westernDigits(value)
    : null;
}
const MODEL_SUFFIXES = new Set(["pro", "plus", "ultra", "max", "mini", "fe", "lite", "se", "edge"]);

function modelAppearsBounded(intentModel: string, product: NormalizedProduct) {
  const title = normalized(product.canonical.title);
  const model = normalized(intentModel);
  const index = title.indexOf(model);
  if (index < 0) return false;
  const before = title[index - 1];
  const after = title[index + model.length];
  if ((before && before !== " ") || (after && after !== " ")) return false;
  const suffix = title.slice(index + model.length).trim().split(" ")[0];
  return !MODEL_SUFFIXES.has(suffix);
}

function modelConflict(intentModel: string, product: NormalizedProduct) {
  const title = normalized(product.canonical.title);
  const model = normalized(intentModel);
  if (!model) return false;
  const match = model.match(/^(.*?)(?:\s+)([a-z]*\d[\w-]*)$/u);
  if (!match) return false;
  const family = match[1].trim();
  const requestedVariant = match[2];
  if (!family || !new RegExp(`(?:^| )${family.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?=$| )`, "u").test(title)) return false;
  const variants = [...title.matchAll(new RegExp(`(?:^| )${family.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")} ([a-z]*\\d[\\w-]*)(?=$| )`, "gu"))]
    .map((entry) => entry[1]);
  return variants.some((variant) => variant !== requestedVariant) ||
    (modelAppearsBounded(intentModel, product) === false &&
      title.includes(`${family} ${requestedVariant}`) &&
      MODEL_SUFFIXES.has(title.slice(title.indexOf(`${family} ${requestedVariant}`) + `${family} ${requestedVariant}`.length).trim().split(" ")[0]));
}

function priceConstraint(
  intent: Phase1Intent,
  product: NormalizedProduct,
  constraints: Record<string, ConstraintEvaluation>,
  evidence: string[],
) {
  const budget = intent.budget.value;
  const strictRequirements = intent.hardRequirements.filter((item) =>
    item.field.toLocaleLowerCase().includes("budget") ||
    item.field.toLocaleLowerCase().includes("price"),
  );
  const strictBudget = strictRequirements.length > 0 ||
    (intent.budget.evidence === "USER_EXPLICIT" && (budget?.min != null || budget?.max != null));
  if (!strictBudget) return;

  const price = product.canonical.price ?? product.price ?? null;
  // The experiment runs in the Saudi market by default. Do not accept an
  // unlabelled amount (or silently perform an FX conversion) for a hard cap.
  const expectedCurrency = budget?.currency ?? "SAR";
  const actualCurrency = product.canonical.currency ?? product.currency ?? null;
  if (price === null || !Number.isFinite(price)) {
    addConstraint(constraints, "price", "unknown", "Candidate has no verifiable current price.");
    return;
  }
  if (!actualCurrency || !same(expectedCurrency, actualCurrency)) {
    addConstraint(
      constraints,
      "price",
      actualCurrency ? "verified_fail" : "unknown",
      actualCurrency
        ? `Currency ${actualCurrency} does not match requested ${expectedCurrency}${budget?.currency ? "." : " (implicit Saudi-market SAR policy)."}`
        : `Currency is missing; ${budget?.currency ? `requested ${expectedCurrency}` : "implicit Saudi-market policy requires SAR"}; no unknown FX conversion is accepted.`,
    );
    return;
  }

  let pass = true;
  const reasons: string[] = [];
  for (const requirement of strictRequirements) {
    const operator = requirement.operator as string;
    const value = Number(requirement.value);
    if (!Number.isFinite(value)) continue;
    if (operator === "lt" && !(price < value)) pass = false;
    else if (operator === "lte" && !(price <= value)) pass = false;
    else if (operator === "gt" && !(price > value)) pass = false;
    else if (operator === "gte" && !(price >= value)) pass = false;
    else if (operator === "between" && !(
      budget?.min !== null && budget?.max !== null &&
      budget?.min !== undefined && budget?.max !== undefined &&
      price >= budget.min && price <= budget.max
    )) pass = false;
  }
  if (!strictRequirements.length && budget) {
    if (budget.min !== null && price < budget.min) pass = false;
    if (budget.max !== null && price > budget.max) pass = false;
  }
  reasons.push(`Price ${price} ${actualCurrency ?? ""} ${pass ? "satisfies" : "violates"} the explicit price requirement.`);
  addConstraint(constraints, "price", pass ? "verified_pass" : "verified_fail", reasons.join(" "));
  if (pass) evidence.push(reasons[0]);
}

function evaluateHardConstraints(
  intent: Phase1Intent,
  product: NormalizedProduct,
  evidence: string[],
) {
  const constraints: Record<string, ConstraintEvaluation> = {};
  const canonical = product.canonical;

  priceConstraint(intent, product, constraints, evidence);

  if (isExplicit(intent.color)) {
    const color = canonical.color ?? product.color ?? null;
    addConstraint(
      constraints,
      "color",
      color === null ? "unknown" : same(color, intent.color.value!) ? "verified_pass" : "verified_fail",
      color === null
        ? "Candidate has no structured color evidence."
        : same(color, intent.color.value!)
          ? `Structured color ${color} matches.`
          : `Structured color ${color} conflicts with requested ${intent.color.value}.`,
    );
  }

  if (isExplicit(intent.size)) {
    // Size is absent from CanonicalProduct/ProviderProduct; title text is not
    // promoted to authoritative size metadata.
    addConstraint(constraints, "size", "unknown", "No structured size field is available for verification.");
  }

  if (isExplicit(intent.condition)) {
    const condition = canonical.condition ?? product.condition ?? null;
    addConstraint(
      constraints,
      "condition",
      condition === null ? "unknown" : condition === intent.condition.value ? "verified_pass" : "verified_fail",
      condition === null
        ? "Candidate condition is unknown."
        : condition === intent.condition.value
          ? `Structured condition ${condition} matches.`
          : `Structured condition ${condition} conflicts with requested ${intent.condition.value}.`,
    );
  }

  if (isExplicit(intent.city)) {
    const location = canonical.location ?? product.location ?? null;
    addConstraint(
      constraints,
      "city",
      location === null ? "unknown" : normalized(location).includes(normalized(intent.city.value!)) ? "verified_pass" : "verified_fail",
      location === null
        ? "Candidate has no seller/city location."
        : normalized(location).includes(normalized(intent.city.value!))
          ? `Seller location ${location} includes requested city ${intent.city.value}.`
          : `Seller location ${location} does not match requested city ${intent.city.value}.`,
    );
  }

  const requestedProductKind = isExplicit(intent.productType)
    ? kindFromText(intent.productType.value)
    : kindFromText(intent.explicitText);
  if (requestedProductKind) {
    const foundKind = candidateKind(product);
    addConstraint(
      constraints,
      "product_type",
      foundKind === null ? "unknown" : foundKind === requestedProductKind ? "verified_pass" : "verified_fail",
      foundKind === null
        ? `No candidate evidence verifies requested product type ${intent.productType.value}.`
        : foundKind === requestedProductKind
          ? `Candidate product type ${foundKind} matches the requested type.`
          : `Candidate product type ${foundKind} conflicts with requested type ${requestedProductKind}.`,
    );
  }

  const connector = requestedConnector(intent);
  if (connector) {
    const candidateConnectorKind = candidateConnector(product);
    const status: ConstraintStatus =
      connector === "ambiguous" || candidateConnectorKind === null || candidateConnectorKind === "ambiguous"
        ? "unknown"
        : candidateConnectorKind === connector
          ? "verified_pass"
          : "verified_fail";
    addConstraint(
      constraints,
      "connector",
      status,
      status === "verified_pass"
        ? `Source listing identifies requested connector ${connector === "usb_c" ? "USB-C" : "Micro-USB"}.`
        : status === "verified_fail"
          ? `Source listing identifies ${candidateConnectorKind === "micro_usb" ? "Micro-USB" : "USB-C"}, conflicting with requested ${connector === "usb_c" ? "USB-C" : "Micro-USB"}.`
        : `No unambiguous source-backed connector is available for the requested connector.`,
    );
  }

  if (isExplicit(intent.brand)) {
    const brand = canonical.brand ?? product.brand ?? null;
    if (brand !== null) {
      addConstraint(
        constraints,
        "brand",
        same(brand, intent.brand.value!) ? "verified_pass" : "verified_fail",
        same(brand, intent.brand.value!)
          ? `Structured brand ${brand} matches.`
          : `Structured brand ${brand} conflicts with requested ${intent.brand.value}.`,
      );
    } else {
      addConstraint(constraints, "brand", "unknown", "Candidate has no structured brand evidence.");
    }
  }

  const requestedModel = isExplicit(intent.model) ? intent.model.value : null;
  if (requestedModel) {
    const candidateBrand = canonical.brand ?? product.brand ?? null;
    const brandMatches = Boolean(
      candidateBrand &&
      intent.brand.value &&
      same(candidateBrand, intent.brand.value),
    );
    const requestedModelKind = requestedKind(intent);
    const modelTypeAgreement = requestedModelKind
      ? structuredCandidateKind(product) === requestedModelKind
      : Boolean(queryCategory(intent) && candidateCategory(product) === queryCategory(intent));
    const boundedMatch = modelAppearsBounded(requestedModel, product);
    const conflictingModel = modelConflict(requestedModel, product);
    const modelPass = boundedMatch && brandMatches && modelTypeAgreement;
    addConstraint(
      constraints,
      "model",
      conflictingModel ? "verified_fail" : modelPass ? "verified_pass" : "unknown",
      conflictingModel
        ? `Title identifies a conflicting near-model rather than ${requestedModel}.`
        : modelPass
          ? `Bounded model token ${requestedModel} agrees with structured brand and product type/category evidence.`
          : "Model is not verified: bounded title token, matching structured brand, and compatible structured type/category evidence are all required.",
    );
  }

  const idFields = [
    ["sku", intent.sku],
    ["mpn", intent.mpn],
    ["oem", intent.oem],
  ] as const;
  const candidateIds = labeledIdentifiers(product);
  for (const [name, field] of idFields) {
    if (!isExplicit(field)) continue;
    const match = candidateIds[name].has(identifierKey(field.value!));
    addConstraint(
      constraints,
      name,
      match ? "verified_pass" : "unknown",
      match
        ? `Source listing contains an explicitly labeled ${name.toUpperCase()} matching the request.`
        : `No matching, explicitly labeled ${name.toUpperCase()} is available; provider product IDs are not treated as global identifiers.`,
    );
    if (match) evidence.push(`Labeled ${name.toUpperCase()} matches the requested identifier.`);
  }
  const gtin = requestedGtin(intent);
  if (gtin) {
    const match = candidateIds.gtin14.has(identifierKey(gtin));
    addConstraint(
      constraints,
      "gtin14",
      match ? "verified_pass" : "unknown",
      match
        ? "Source listing explicitly labels a checksum-valid GTIN-14 matching the requested global identifier."
        : "No matching, explicitly labeled checksum-valid GTIN-14 is available.",
    );
    if (match) evidence.push("Labeled checksum-valid GTIN-14 matches the requested global identifier.");
  }

  if (intent.authenticity.value === true && intent.authenticity.evidence === "USER_EXPLICIT") {
    addConstraint(
      constraints,
      "authenticity",
      "unknown",
      "No structured authoritative authenticity evidence is available.",
    );
  }

  const hasVehicleFitmentConstraint =
    intent.automotive.value === true &&
    intent.automotive.evidence === "USER_EXPLICIT" &&
    [intent.vehicle.make, intent.vehicle.model, intent.vehicle.year, intent.vehicle.partName, intent.vehicle.partNumber, intent.vehicle.oemNumber]
      .some((field) => field.value !== null && field.evidence === "USER_EXPLICIT");
  if (hasVehicleFitmentConstraint) {
    addConstraint(
      constraints,
      "vehicle_fitment",
      "unknown",
      "Canonical products contain no authoritative vehicle-fitment/OEM-source field; title text cannot verify fitment.",
    );
  }

  const constraintFields = new Set([
    "budget", "price", "condition", "color", "city", "location", "size", "product_type",
    "brand", "model", "sku", "mpn", "oem", "gtin", "gtin14", "authenticity", "automotive",
    "vehicle", "vehicle_fitment", "connector",
  ]);
  for (const requirement of intent.hardRequirements) {
    // Price constraints are evaluated above, including range and inclusive
    // operators emitted by the parser.
    if (constraintFields.has(requirement.field.toLocaleLowerCase()) ||
        /price|budget/iu.test(requirement.field)) continue;
    const name = `requirement:${requirement.field}`;
    addConstraint(constraints, name, "unknown", `No structured candidate field verifies explicit requirement ${requirement.field}.`);
  }

  return constraints;
}

function relevance(
  intent: Phase1Intent,
  product: NormalizedProduct,
  evidence: string[],
  constraints: Record<string, ConstraintEvaluation>,
) {
  const expectedCategory = queryCategory(intent);
  const actualCategory = candidateCategory(product);
  const title = normalized(product.canonical.title);
  const productText = normalized([
    product.canonical.title,
    product.canonical.description ?? "",
    product.canonical.productType ?? "",
    product.canonical.subcategory ?? "",
    product.canonical.category ?? "",
  ].join(" "));
  let score = 0;
  let relevantSignal = false;

  if (expectedCategory && actualCategory === expectedCategory) {
    score += 0.58;
    relevantSignal = true;
    evidence.push(`Candidate category ${actualCategory} matches requested category.`);
  } else if (expectedCategory && actualCategory && actualCategory !== expectedCategory) {
    return { score: 0, incompatibleCategory: true };
  }

  const knownTokens = recognizedQueryTokens(intent);
  const terms = queryTerms(intent).filter((term) => knownTokens.has(term));
  const explicitType = intent.productType.value && intent.productType.evidence !== "UNKNOWN"
    ? normalized(intent.productType.value)
    : "";
  if (explicitType && (productText.includes(explicitType) || title.includes(explicitType))) {
    score += 0.22;
    relevantSignal = true;
  }

  const brand = intent.brand.value;
  if (brand && (same(product.canonical.brand ?? product.brand ?? "", brand) || title.includes(normalized(brand)))) {
    score += 0.18;
    relevantSignal = true;
    evidence.push(`Candidate listing contains requested brand ${brand}.`);
  }
  const model = intent.model.value;
  if (model && title.includes(normalized(model))) {
    score += 0.18;
    relevantSignal = true;
    // This contributes relevance only, never model identity verification.
  }

  const substantiveTerms = terms.filter((term) => term.length >= 3);
  const matched = substantiveTerms.filter((term) => productText.includes(term));
  if (substantiveTerms.length) {
    const tokenScore = matched.length / substantiveTerms.length;
    score += Math.min(0.28, tokenScore * 0.28);
    if (matched.length) relevantSignal = true;
  }

  const matchedStableIdentifier = ["gtin14", "mpn", "oem"].some(
    (key) => constraints[key]?.status === "verified_pass",
  );
  if (matchedStableIdentifier) {
    score = Math.max(score, 0.96);
    relevantSignal = true;
  }

  const attributeOnly =
    !expectedCategory &&
    !intent.productType.value &&
    !intent.brand.value &&
    !intent.model.value &&
    ["color", "condition", "city"].some(
      (key) => constraints[key]?.status === "verified_pass",
    );
  if (attributeOnly) {
    score = Math.max(score, 0.62);
    relevantSignal = true;
    evidence.push("Verified explicit color/condition/location constraint grounds this attribute-only query.");
  }

  return { score: Math.min(1, score), incompatibleCategory: false, relevantSignal };
}

function strategyFor(lookup: StrategyLookup | undefined, id: string) {
  if (!lookup) return null;
  return lookup instanceof Map ? lookup.get(id) ?? null : lookup[id] ?? null;
}

function compareCandidates(left: EvaluatedPhase1Candidate, right: EvaluatedPhase1Candidate) {
  const order: CandidateClassification[] = [
    "EXACT", "PROBABLE_EXACT", "CLOSE_ALTERNATIVE", "SIMILAR", "WEAK", "IRRELEVANT",
  ];
  return order.indexOf(left.classification) - order.indexOf(right.classification) ||
    right.score - left.score ||
    left.product.providerId.localeCompare(right.product.providerId) ||
    left.product.canonical.id.localeCompare(right.product.canonical.id);
}

/**
 * Evaluates only locally supplied, normalized candidates. Explicit constraints
 * are gated before ranking; unknown values never pass a hard requirement.
 */
export function evaluatePhase1Candidates(
  intent: Phase1Intent,
  products: NormalizedProduct[],
  strategyById?: StrategyLookup,
): Phase1CandidateEvaluation {
  const qualifying: EvaluatedPhase1Candidate[] = [];
  const alternatives: EvaluatedPhase1Candidate[] = [];
  const rejected: RejectedPhase1Candidate[] = [];

  for (const product of products) {
    const evidence: string[] = [];
    const constraints = evaluateHardConstraints(intent, product, evidence);
    const relevanceResult = relevance(intent, product, evidence, constraints);
    const strategy = strategyFor(strategyById, product.canonical.id) ??
      strategyFor(strategyById, product.id);
    const hardFailures = Object.entries(constraints).filter(([, value]) => value.status !== "verified_pass");
    const unverifiedModelAlternative =
      hardFailures.length > 0 &&
      hardFailures.every(([name]) => name === "model") &&
      constraints.model?.status === "unknown" &&
      isExplicit(intent.model) &&
      modelAppearsBounded(intent.model.value!, product) &&
      !modelConflict(intent.model.value!, product);

    let classification: CandidateClassification;
    if (relevanceResult.incompatibleCategory || relevanceResult.score < 0.12) {
      classification = "IRRELEVANT";
    } else {
      const hasStrongStableId =
        (isExplicit(intent.mpn) && constraints.mpn?.status === "verified_pass") ||
        (isExplicit(intent.oem) && constraints.oem?.status === "verified_pass") ||
        constraints.gtin14?.status === "verified_pass";
      const expectedCategory = queryCategory(intent);
      const actualCategory = candidateCategory(product);
      const expectedKind = requestedKind(intent);
      const actualStructuredKind = structuredCandidateKind(product);
      const categoryCompatible = expectedCategory
        ? actualCategory === expectedCategory
        : expectedKind
          ? actualStructuredKind === expectedKind && Boolean(actualCategory)
          : true;
      const typeCompatible = !expectedKind || actualStructuredKind === expectedKind;
      const sourceBacked = Boolean(
        product.canonical.providerId.trim() &&
        product.canonical.sourceType.trim(),
      );
      if (hasStrongStableId && categoryCompatible && typeCompatible && sourceBacked) classification = "EXACT";
      else if (
        (isExplicit(intent.sku) && constraints.sku?.status === "verified_pass") ||
        (isExplicit(intent.mpn) && constraints.mpn?.status === "verified_pass") ||
        (isExplicit(intent.oem) && constraints.oem?.status === "verified_pass") ||
        (isExplicit(intent.model) && constraints.model?.status === "verified_pass") ||
        (intent.brand.value && same(product.canonical.brand ?? product.brand ?? "", intent.brand.value) && relevanceResult.score >= 0.5)
      ) classification = "PROBABLE_EXACT";
      else if (relevanceResult.score >= 0.55) classification = "CLOSE_ALTERNATIVE";
      else if (relevanceResult.score >= 0.3) classification = "SIMILAR";
      else classification = "WEAK";
    }

    const score = Math.round(relevanceResult.score * 1000) / 1000;
    const evaluated = resultFor(product, classification, score, constraints, evidence, strategy);
    if (hardFailures.length && !unverifiedModelAlternative) {
      const diagnostics = hardFailures.map(([name, value]) => `${name}: ${value.status} — ${value.reason}`);
      rejected.push({ ...evaluated, diagnostics });
    } else if (classification === "IRRELEVANT") {
      rejected.push({
        ...evaluated,
        diagnostics: ["Candidate is unrelated to the requested product/category."],
      });
    } else if (classification === "EXACT" || classification === "PROBABLE_EXACT") {
      qualifying.push(evaluated);
    } else {
      if (unverifiedModelAlternative) {
        evidence.push("Exact bounded model text is relevant for discovery only; identity remains unverified and is not qualifying.");
      }
      alternatives.push(evaluated);
    }
  }

  const hasPurchasableAlternative = [...qualifying, ...alternatives].some(
    (candidate) =>
      (candidate.product.canonical.availability ?? candidate.product.availability) === "in_stock",
  );
  if (hasPurchasableAlternative) {
    for (const collection of [qualifying, alternatives]) {
      for (let index = collection.length - 1; index >= 0; index -= 1) {
        const candidate = collection[index];
        if ((candidate.product.canonical.availability ?? candidate.product.availability) !== "out_of_stock") continue;
        collection.splice(index, 1);
        const unresolved = Object.entries(candidate.constraints)
          .filter(([, constraint]) => constraint.status !== "verified_pass")
          .map(([name, constraint]) => `${name}: ${constraint.status} — ${constraint.reason}`);
        rejected.push({
          ...candidate,
          diagnostics: [
            ...unresolved,
            "Candidate is out of stock; an in-stock relevant alternative is available.",
          ],
        });
      }
    }
  }

  qualifying.sort(compareCandidates);
  alternatives.sort(compareCandidates);
  rejected.sort(compareCandidates);
  return { qualifying, alternatives, rejected };
}