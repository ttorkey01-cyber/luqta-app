import { Alert, Linking, Platform } from 'react-native';
import type { ProductResult } from '@/types/search';
import { productOutboundUrl } from '@/types/outboundLink';

export async function openProductUrl(
  product: Pick<ProductResult, 'affiliateUrl' | 'productUrl'> & { source?: ProductResult['source'] },
) {
  const destination = productOutboundUrl(product, Platform.OS === 'android');
  if (!destination) {
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