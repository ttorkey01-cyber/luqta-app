import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import colors from '@/constants/colors';
import { FavoriteButton, GradientButton } from '@/components/LuqtaUI';
import { DieselBrandPlaceholder } from '@/components/DieselBrandPlaceholder';
import { shouldShowDieselLogo, shouldTryNazihImageProxy } from '@/types/imageFallback';
import { formatProductPrice, formatRating, imageSource, nazihImageProxyUri } from '@/types/search';
import { openProductUrl } from '@/services/productUrl';
import { searchService } from '@/services/searchService';

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const product = searchService.getProduct(id ?? '');
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [selectedImage, setSelectedImage] = useState(0);
  const [nazihProxyImages, setNazihProxyImages] = useState<Set<string>>(() => new Set());
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());

  if (!product) {
    return (
      <View style={styles.root}>
        <View style={[styles.unavailableScreen, { paddingTop: insets.top + 12 }]}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="العودة"
          >
            <Feather name="arrow-right" size={19} color={colors.ink} />
          </Pressable>
          <View style={styles.unavailableContent}>
            <Feather name="package" size={30} color={colors.inkFaint} />
            <Text style={styles.missingMainImageText}>بيانات المنتج غير متاحة حالياً</Text>
            <GradientButton label="العودة" onPress={() => router.back()} />
          </View>
        </View>
      </View>
    );
  }

  const mainImage = product.gallery[selectedImage];

  const handleProductImageError = (image: string) => {
    if (shouldTryNazihImageProxy(
      product.source, Platform.OS === 'android', image,
      nazihProxyImages, nazihImageProxyUri(image),
    )) {
      setNazihProxyImages((current) => new Set(current).add(image));
      return;
    }
    const nextFailed = new Set(failedImages).add(image);
    setFailedImages(nextFailed);
    if (mainImage === image && product.gallery.length > 1) {
      for (let offset = 1; offset < product.gallery.length; offset += 1) {
        const candidateIndex = (selectedImage + offset) % product.gallery.length;
        const candidate = product.gallery[candidateIndex];
        if (typeof candidate === 'string' && !nextFailed.has(candidate)) {
          setSelectedImage(candidateIndex);
          break;
        }
      }
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 98 }} showsVerticalScrollIndicator={false}>
        <View style={styles.gallery}>
          {mainImage &&
          !(typeof mainImage === 'string' && failedImages.has(mainImage)) ? (
            <Image
              source={imageSource(
                mainImage,
                product.source,
                typeof mainImage === 'string' && nazihProxyImages.has(mainImage),
              )}
              style={styles.mainImage}
              resizeMode="cover"
              onError={() => {
                if (typeof mainImage === 'string') handleProductImageError(mainImage);
              }}
            />
          ) : shouldShowDieselLogo(product.source, false) ? (
            <DieselBrandPlaceholder large />
          ) : (
            <View style={styles.missingMainImage}>
              <Feather name="image" size={30} color={colors.inkFaint} />
              <Text style={styles.missingMainImageText}>الصورة غير متوفرة</Text>
            </View>
          )}
          <LinearGradient colors={['rgba(9,9,13,0.38)', 'transparent']} style={StyleSheet.absoluteFill} />
          <View style={[styles.galleryTop, { paddingTop: insets.top + 10 }]}>
            <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}><Feather name="arrow-right" size={19} color={colors.ink} /></Pressable>
            <FavoriteButton productId={product.id} />
          </View>
          <View style={styles.thumbnails}>
            {product.gallery.map((image, index) => (
              <Pressable key={index} onPress={() => setSelectedImage(index)} style={[styles.thumbnail, index === selectedImage && styles.thumbnailActive]}>
                {typeof image === 'string' && failedImages.has(image) ? (
                  shouldShowDieselLogo(product.source, false) ? (
                    <DieselBrandPlaceholder compact />
                  ) : (
                    <View style={[styles.thumbnailImage, styles.missingThumbnail]}>
                      <Feather name="image" size={15} color={colors.inkFaint} />
                    </View>
                  )
                ) : (
                  <Image
                    source={imageSource(
                      image,
                      product.source,
                      typeof image === 'string' && nazihProxyImages.has(image),
                    )}
                    style={styles.thumbnailImage}
                    onError={() => {
                      if (typeof image === 'string') handleProductImageError(image);
                    }}
                  />
                )}
              </Pressable>
            ))}
          </View>
        </View>
        <View style={styles.detailBody}>
          <View style={styles.merchantRow}>
            {product.merchant ? <Text style={styles.merchant}>{product.merchant}</Text> : <View />}
            {product.reviewCount != null && product.reviewCount > 0 && product.rating != null ? (
              <View style={styles.rating}>
                <Feather name="star" size={13} color={colors.gold} fill={colors.gold} />
                <Text style={styles.ratingText}>
                  {formatRating(product.rating)} ({product.reviewCount.toLocaleString('ar-SA')})
                </Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.title}>{product.title}</Text>
          <Text style={styles.price}>{formatProductPrice(product.price, product.currency) ?? 'عرض المنتج'}</Text>
          {product.description ? <Text style={styles.description}>{product.description}</Text> : null}
          {product.color ? (
            <View style={styles.optionRow}>
              <Text style={styles.optionValue}>{product.color}</Text>
              <Text style={styles.optionLabel}>اللون</Text>
            </View>
          ) : null}
          <View style={styles.divider} />
          <DetailRow label="تفاصيل المنتج" icon="file-text" />
          <DetailRow label="خيارات أخرى" icon="layers" />
          <DetailRow label="منتجات مشابهة" icon="grid" />
        </View>
      </ScrollView>
      <View style={[styles.ctaDock, { paddingBottom: Math.max(insets.bottom, 14) }]}>
        <GradientButton label="عرض المنتج" icon="external-link" onPress={() => void openProductUrl(product)} />
      </View>
    </View>
  );
}

function DetailRow({ label, icon }: { label: string; icon: keyof typeof Feather.glyphMap }) {
  return (
    <Pressable style={({ pressed }) => [styles.detailRow, pressed && styles.pressed]}>
      <Feather name="chevron-left" size={17} color={colors.inkFaint} />
      <Text style={styles.detailRowLabel}>{label}</Text>
      <View style={styles.detailRowIcon}><Feather name={icon} size={16} color={colors.inkSoft} /></View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  gallery: { height: 390, position: 'relative', backgroundColor: colors.surfaceRaised },
  unavailableScreen: { flex: 1, paddingHorizontal: 18 },
  unavailableContent: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18 },
  mainImage: { width: '100%', height: '100%' },
  missingMainImage: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: colors.surfaceRaised },
  missingMainImageText: { color: colors.inkFaint, fontSize: 12, fontWeight: '700' },
  galleryTop: { position: 'absolute', top: 0, left: 18, right: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  roundButton: { width: 42, height: 42, borderRadius: 15, backgroundColor: 'rgba(9,9,13,0.58)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.13)' },
  thumbnails: { position: 'absolute', bottom: 15, left: 18, flexDirection: 'row', gap: 8 },
  thumbnail: { width: 48, height: 48, borderRadius: 13, overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,0.22)' },
  thumbnailActive: { borderColor: colors.pink },
  thumbnailImage: { width: '100%', height: '100%' },
  missingThumbnail: { backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  detailBody: { paddingHorizontal: 18, paddingTop: 20 },
  merchantRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  merchant: { color: colors.inkFaint, fontSize: 11, fontWeight: '700' },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  ratingText: { color: colors.inkSoft, fontSize: 11, fontWeight: '700' },
  title: { color: colors.ink, fontSize: 25, fontWeight: '900', textAlign: 'right', marginTop: 13 },
  price: { color: colors.pink, fontSize: 18, fontWeight: '900', textAlign: 'right', marginTop: 10 },
  description: { color: colors.inkSoft, fontSize: 13, lineHeight: 22, textAlign: 'right', marginTop: 15 },
  optionRow: { marginTop: 21, padding: 13, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  optionLabel: { color: colors.inkFaint, fontSize: 12 },
  optionValue: { color: colors.ink, fontSize: 12, fontWeight: '800' },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 18 },
  detailRow: { minHeight: 53, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: colors.line },
  detailRowLabel: { color: colors.ink, flex: 1, textAlign: 'right', fontSize: 13, fontWeight: '700' },
  detailRowIcon: { width: 31, height: 31, borderRadius: 10, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  similarHeader: { marginTop: 24, marginBottom: 13 },
  similarTitle: { color: colors.ink, fontSize: 17, fontWeight: '800', textAlign: 'right' },
  similarList: { flexDirection: 'row-reverse' },
  ctaDock: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(9,9,13,0.96)', paddingHorizontal: 18, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.line },
  pressed: { opacity: 0.72, transform: [{ scale: 0.97 }] },
});