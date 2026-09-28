import type {
  CanonicalProduct,
  NormalizedProduct,
  ProductAudience,
  ProviderMetadata,
  ProviderProduct,
} from "./types";
import { classifyLuqtaCategory } from "./categoryTaxonomy";

function cleanText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function cleanNumber(value: number | null | undefined) {
  return value !== null && value !== undefined && Number.isFinite(value)
    ? value
    : null;
}

function cleanCount(value: number | null | undefined) {
  return value !== null &&
    value !== undefined &&
    Number.isInteger(value) &&
    value >= 0
    ? value
    : null;
}

function cleanHttpUrl(value: string | null | undefined) {
  const normalized = cleanText(value);
  if (!normalized) return null;
  try {
    const parsed = new URL(normalized);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? normalized
      : null;
  } catch {
    return null;
  }
}

function normalizeAudience(value: string | null | undefined): ProductAudience | null {
  const normalized = value?.trim().toLocaleLowerCase();
  if (!normalized) return null;
  if (["women", "woman", "female", "ladies", "نساء", "نسائي", "حريمي"].includes(normalized)) {
    return "women";
  }
  if (["men", "man", "male", "رجال", "رجالي"].includes(normalized)) return "men";
  if (["boys", "boy", "أولاد", "اولاد", "ولد"].includes(normalized)) return "boys";
  if (["girls", "girl", "بنات", "بنت"].includes(normalized)) return "girls";
  if (["kids", "children", "child", "أطفال", "اطفال", "طفل", "رضيع"].includes(normalized)) {
    return "kids";
  }
  return null;
}

function canonicalProduct(
  product: ProviderProduct,
  provider: ProviderMetadata,
): CanonicalProduct {
  const images = [
    product.imageUrl,
    ...(product.alternateImageUrls ?? []),
  ]
    .map(cleanHttpUrl)
    .filter((image): image is string => image !== null);
  const uniqueImages = [...new Set(images)];
  const classifiedCategory = classifyLuqtaCategory(product) ?? null;

  return {
    id: product.id,
    providerId: provider.id,
    providerProductId:
      product.providerProductId !== undefined
        ? cleanText(product.providerProductId)
        : cleanText(product.id),
    title: product.title,
    description: cleanText(product.description),
    brand: cleanText(product.brand),
    productType: cleanText(product.productType),
    category: classifiedCategory,
    subcategory: cleanText(product.subcategory),
    audience: normalizeAudience(product.audience),
    color: cleanText(product.color),
    imageUrl: uniqueImages[0] ?? null,
    alternateImageUrls:
      uniqueImages.length > 1 ? uniqueImages.slice(1) : null,
    price: cleanNumber(product.price),
    originalPrice: cleanNumber(product.originalPrice),
    discount: cleanNumber(product.discount),
    currency: cleanText(product.currency),
    merchant: cleanText(product.merchant),
    productUrl: cleanText(product.productUrl),
    affiliateUrl: null,
    destinationUrl: null,
    availability:
      product.availability === "unknown" ? null : product.availability,
    condition:
      product.condition === "unknown" ? null : product.condition ?? null,
    location: cleanText(product.location),
    rating:
      cleanNumber(product.rating) !== null &&
      product.rating! >= 0 &&
      product.rating! <= 5
        ? product.rating!
        : null,
    reviewCount: cleanCount(product.reviewCount),
    updatedAt: cleanText(product.updatedAt),
    sourceType: product.sourceType,
  };
}

export class ResultNormalizer {
  normalize(product: ProviderProduct, provider: ProviderMetadata): NormalizedProduct {
    return {
      ...product,
      canonical: canonicalProduct(product, provider),
      providerId: provider.id,
      providerName: provider.name,
      isAffiliate: false,
      rankScore: 0,
      priceScore: 0.5,
      availabilityScore: product.availability === "in_stock" ? 1 : 0,
      conditionScore: 0.5,
      locationScore: 0.5,
    };
  }
}