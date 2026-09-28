import { Alert, Linking } from 'react-native';
import type { ProductResult } from '@/types/search';

function isSafeHttpUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export async function openProductUrl(
  product: Pick<ProductResult, 'affiliateUrl' | 'productUrl'>,
) {
  const destination = product.affiliateUrl ?? product.productUrl;
  if (!isSafeHttpUrl(destination)) {
    Alert.alert('الرابط غير متاح', 'لا يوجد رابط متجر صالح لهذا المنتج حالياً.');
    return false;
  }
  try {
    const supported = await Linking.canOpenURL(destination);
    if (!supported) {
      Alert.alert('تعذر فتح الرابط', 'افتح الرابط من متصفح جهازك.');
      return false;
    }
    await Linking.openURL(destination);
    return true;
  } catch {
    Alert.alert('تعذر فتح الرابط', 'حدثت مشكلة أثناء فتح صفحة المنتج.');
    return false;
  }
}