export type IdentifierKind =
  | "GTIN"
  | "GTIN8"
  | "GTIN12"
  | "GTIN13"
  | "GTIN14"
  | "MPN"
  | "SKU"
  | "OEM"
  | "MODEL"
  | (string & {});

export type IdentityIdentifier = {
  kind: IdentifierKind;
  value: string;
  scope?: string;
};

export type ProductVariant = {
  color?: string;
  size?: string;
  storage?: string;
  capacity?: string;
  packQuantity?: number | string;
  material?: string;
  region?: string;
};

export type ProductOffer = {
  merchant?: string;
  providerOfferId?: string;
  price?: number;
  currency?: string;
  availability?: string;
  updatedAt?: string;
};

export type IdentityRecord = {
  id: string;
  title: string;
  description?: string;
  brand?: string;
  model?: string;
  category?: string;
  styleCode?: string;
  providerId?: string;
  providerProductId?: string;
  identifiers?: IdentityIdentifier[];
  variant?: ProductVariant;
  offer?: ProductOffer;
};

export type IdentifierValidationStatus = "VALID" | "INVALID" | "UNKNOWN_FORMAT";

export type NormalizedIdentifier = {
  kind: IdentifierKind;
  canonicalKind: string;
  raw: string;
  normalized: string;
  scope?: string;
  status: IdentifierValidationStatus;
};

export type PairClassification =
  | "SAME_PRODUCT_SAME_VARIANT"
  | "SAME_PRODUCT_DIFFERENT_VARIANT"
  | "PROBABLE_SAME_PRODUCT"
  | "RELATED_PRODUCT"
  | "DIFFERENT_PRODUCT"
  | "UNKNOWN";

export type IdentityEvidence = {
  code: string;
  source: string;
  value?: string;
  detail: string;
};

export type ProductIdentityDecision = {
  classification: PairClassification;
  confidence: number;
  positiveEvidence: IdentityEvidence[];
  conflictingEvidence: IdentityEvidence[];
  unknownEvidence: IdentityEvidence[];
  productIdentity: string | null;
  variantIdentity: string | null;
  offerIdentity: string | null;
  explanation: string;
};

export type IdentityQuery = string | {
  text?: string;
  brand?: string;
  model?: string;
  category?: string;
  styleCode?: string;
  color?: string;
  size?: string;
  storage?: string;
  capacity?: string;
  packQuantity?: number | string;
  material?: string;
  region?: string;
};

export type OfferGroup = {
  offerIdentity: string;
  records: IdentityRecord[];
};

export type VariantGroup = {
  variantIdentity: string;
  records: IdentityRecord[];
  offers: OfferGroup[];
};

export type ProductGroup = {
  productIdentity: string;
  records: IdentityRecord[];
  variants: VariantGroup[];
};

export type CheaperAssessment = {
  classification: "SAME_PRODUCT_CHEAPER" | "ALTERNATIVE" | "UNKNOWN";
  isCheaper: boolean;
  savings: number | null;
  savingsPercent: number | null;
  explanation: string;
  evidence: IdentityEvidence[];
};