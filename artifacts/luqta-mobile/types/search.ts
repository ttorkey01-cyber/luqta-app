import { Platform, type ImageSourcePropType } from 'react-native';
import type { SearchProduct } from '@workspace/api-client-react';

export type ProductImage = ImageSourcePropType | string;
export type CanonicalProduct = SearchProduct['canonical'];

export type SourceType = 'mock' | 'affiliate' | 'merchant' | 'marketplace' | 'classified';

export type ProductResult = {
  id: string;
  title: string;
  description?: string | null;
  imageUrl?: ProductImage | null;
  image?: ProductImage;
  gallery: ProductImage[];
  price?: number | null;
  currency?: string | null;
  merchant?: string | null;
  merchantLogo?: ProductImage;
  rating?: number | null;
  reviewCount?: number | null;
  productUrl?: string | null;
  affiliateUrl?: string | null;
  source: string;
  sourceType: SourceType;
  availability: 'in_stock' | 'out_of_stock' | 'unknown' | null;
  originalPrice?: number | null;
  discount?: number | null;
  shipping?: string;
  location?: string | null;
  condition?: 'new' | 'used' | 'refurbished' | 'unknown' | null;
  isAffiliate: boolean;
  matchScore: number;
  priceScore: number;
  relevanceScore: number;
  updatedAt?: string | null;
  category?: string | null;
  categoryFilterIds?: string[];
  color?: string | null;
  canonical?: CanonicalProduct;
};

export type QueryIntent = {
  raw: string;
  normalized: string;
  keywords: string[];
  category?: string;
  productType?: string;
  audience?: 'women' | 'men' | 'boys' | 'girls' | 'kids';
  brand?: string;
  color?: string;
  maxPrice?: number;
  minPrice?: number;
  condition?: ProductResult['condition'];
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleYear?: string;
  partName?: string;
  partNumber?: string;
  oemNumber?: string;
  newOrUsed?: 'new' | 'used' | 'refurbished' | 'unknown';
  location?: string;
};

export function nazihImageProxyUri(image: string): string | undefined {
  const domain = process.env.EXPO_PUBLIC_DOMAIN?.trim();
  if (!domain) return undefined;
  try {
    const parsed = new URL(image);
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "nazih.sa" ||
      !parsed.pathname.startsWith("/media/catalog/product/")
    ) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return `https://${domain}/api/images/nazih?url=${encodeURIComponent(image)}`;
}

export function imageSource(
  image: ProductImage,
  providerId?: string,
  useNazihProxy = false,
): ImageSourcePropType {
  if (typeof image !== 'string') return image;
  const uri =
    useNazihProxy && providerId === 'nazih'
      ? nazihImageProxyUri(image) ?? image
      : image;
  let referer: string | undefined;
  try {
    const parsed = new URL(image);
    referer =
      providerId === 'nazih'
        ? 'https://nazih.sa/'
        : `${parsed.origin}/`;
  } catch {
    referer = providerId === 'nazih' ? 'https://nazih.sa/' : undefined;
  }
  return {
    uri,
    ...(Platform.OS === 'android'
      ? {
          headers: {
            Accept:
              providerId === 'nazih'
                ? 'image/jpeg,image/*;q=0.8,*/*;q=0.5'
                : 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            ...(referer ? { Referer: referer } : {}),
            'User-Agent':
              'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36',
          },
        }
      : {}),
  };
}

export function formatSar(price: number) {
  return `${price.toLocaleString('ar-SA')} ر.س`;
}

export function formatProductPrice(
  price: number | null | undefined,
  currency: string | null | undefined,
) {
  if (price == null || !Number.isFinite(price) || !currency) return undefined;
  const normalizedCurrency = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalizedCurrency)) return undefined;
  try {
    return new Intl.NumberFormat('ar-SA', {
      style: 'currency',
      currency: normalizedCurrency,
      maximumFractionDigits: 2,
    }).format(price);
  } catch {
    return undefined;
  }
}

export function formatRating(rating: number) {
  return rating.toLocaleString('ar-SA', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function parseLocalizedNumber(value: string) {
  const arabicDigits = value.replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
  const normalized = arabicDigits.replace(/[٬,\s]/g, '');
  const parsed = Number(normalized.replace(/[^\d.]/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}