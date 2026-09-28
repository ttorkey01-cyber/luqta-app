import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { usePathname, useRouter } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Image,
  ImageBackground,
  ImageSourcePropType,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import colors from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import type { LuqtaCategory } from '@/data/categories';
import { CategoryArtwork } from '@/components/CategoryArtwork';
import { DieselBrandPlaceholder } from '@/components/DieselBrandPlaceholder';
import type { ProductResult } from '@/types/search';
import { nextProductImageUrl, shouldShowDieselLogo, shouldTryNazihImageProxy } from '@/types/imageFallback';
import {
  formatProductPrice,
  formatRating,
  imageSource,
  nazihImageProxyUri,
} from '@/types/search';
import { logMobileTiming, logRawImageEvent } from '@/services/mobileDiagnostics';

export const heroImage = require('@/assets/images/luqta-hero.jpg') as ImageSourcePropType;
export const brandImage = require('@/assets/images/luqta-icon.png') as ImageSourcePropType;
const IMAGE_DEBUG = __DEV__ && process.env.EXPO_PUBLIC_IMAGE_DEBUG === '1';

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <View style={styles.brandWrap}>
      <Image source={brandImage} style={compact ? styles.brandIconSmall : styles.brandIcon} />
      {!compact && (
        <View style={styles.brandType}>
          <Text style={styles.brandArabic}>لُقطة</Text>
          <Text style={styles.brandLatin}>LUQTA</Text>
        </View>
      )}
    </View>
  );
}

export function Screen({
  children,
  scroll = true,
  bottom = true,
  contentStyle,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  bottom?: boolean;
  contentStyle?: object;
}) {
  const insets = useSafeAreaInsets();
  const paddingTop = Platform.OS === 'web' ? Math.max(insets.top, 67) : insets.top;
  const paddingBottom = (bottom ? 86 : 20) + insets.bottom;

  if (!scroll) {
    return (
      <View style={styles.screen}>
        <View style={[styles.screenContent, { paddingTop, paddingBottom }, contentStyle]}>
          {children}
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.screenContent, { paddingTop, paddingBottom }, contentStyle]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

export function SectionTitle({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.sectionTitle}>
      <Text style={styles.sectionTitleText}>{title}</Text>
      {action ? (
        <Pressable onPress={onAction} hitSlop={10}>
          <Text style={styles.sectionAction}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function CategoryCard({
  category,
  onPress,
  compact = false,
  testID,
}: {
  category: LuqtaCategory;
  onPress: () => void;
  compact?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.categoryTile,
        compact ? styles.categoryTileCompact : styles.categoryTileFull,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.categoryVisual}>
        <CategoryArtwork kind={category.artwork} accent={category.glow} compact={compact} />
      </View>
      <View style={styles.categoryTileFooter}>
        <Text style={styles.categoryTileLabel} numberOfLines={2}>{category.label}</Text>
        <View style={styles.categoryTileArrow}>
          <Feather name="arrow-left" size={compact ? 12 : 14} color={category.glow} />
        </View>
      </View>
    </Pressable>
  );
}

export function GradientButton({
  label,
  icon = 'arrow-left',
  onPress,
  small = false,
  disabled = false,
}: {
  label: string;
  icon?: keyof typeof Feather.glyphMap;
  onPress?: () => void;
  small?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.gradientButton,
        small && styles.gradientButtonSmall,
        disabled && styles.buttonDisabled,
        pressed && styles.pressed,
      ]}
    >
      <LinearGradient
        colors={[colors.pink, colors.violet, colors.cyan]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      <Text style={styles.gradientButtonText}>{label}</Text>
      <Feather name={icon} size={small ? 15 : 18} color={colors.ink} />
    </Pressable>
  );
}

export function GlassButton({
  icon,
  label,
  onPress,
  active = false,
}: {
  icon: keyof typeof Feather.glyphMap;
  label?: string;
  onPress?: () => void;
  active?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.glassButton,
        active && styles.glassButtonActive,
        pressed && styles.pressed,
      ]}
    >
      <Feather name={icon} size={17} color={active ? colors.pink : colors.inkSoft} />
      {label ? <Text style={styles.glassButtonLabel}>{label}</Text> : null}
    </Pressable>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const navItems = [
    { label: 'الرئيسية', icon: 'home', route: '/' },
    { label: 'المفضلة', icon: 'heart', route: '/favorites' },
    { label: 'صِدها لي', icon: 'target', route: '/hunt', prominent: true },
    { label: 'حسابي', icon: 'user', route: '/account' },
  ] as const;

  return (
    <View style={[styles.bottomNav, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      {navItems.map((item) => {
        const active =
          item.route === '/'
            ? pathname === '/' || pathname === '/index'
            : pathname.startsWith(item.route);

        if ('prominent' in item && item.prominent) {
          return (
            <Pressable
              key={item.route}
              onPress={() => router.replace(item.route)}
              style={({ pressed }) => [styles.navItem, styles.prominentNavButton, pressed && styles.pressed]}
              testID={`nav-hunt`}
            >
              <LinearGradient
                colors={[colors.pink, colors.violet, colors.cyan]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.prominentNavGradient}
              >
                <Feather name={item.icon as keyof typeof Feather.glyphMap} size={22} color={colors.ink} />
              </LinearGradient>
              <Text style={styles.navLabel}>{item.label}</Text>
            </Pressable>
          );
        }

        return (
          <Pressable
            key={item.route}
            onPress={() => router.replace(item.route)}
            style={({ pressed }) => [styles.navItem, pressed && styles.pressed]}
            testID={`nav-${item.route.replace('/', '') || 'home'}`}
          >
            {active ? (
              <LinearGradient
                colors={[colors.pink, colors.violet]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.navActiveIcon}
              >
                <Feather name={item.icon as keyof typeof Feather.glyphMap} size={17} color={colors.ink} />
              </LinearGradient>
            ) : (
              <Feather name={item.icon as keyof typeof Feather.glyphMap} size={19} color={colors.inkFaint} />
            )}
            <Text style={[styles.navLabel, active && styles.navLabelActive]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function FavoriteButton({ productId }: { productId: string }) {
  const { isFavorite, toggleFavorite } = useApp();
  const active = isFavorite(productId);
  return (
    <Pressable
      onPress={() => toggleFavorite(productId)}
      style={({ pressed }) => [styles.favoriteButton, active && styles.favoriteButtonActive, pressed && styles.pressed]}
      hitSlop={6}
      testID={`favorite-${productId}`}
    >
      <Feather name="heart" size={15} color={active ? colors.ink : colors.inkSoft} fill={active ? colors.pink : 'transparent'} />
    </Pressable>
  );
}

export const ProductCard = React.memo(function ProductCard({
  product,
  horizontal = false,
  diagnosticCategory,
  diagnosticFirstCard = false,
}: {
  product: ProductResult;
  horizontal?: boolean;
  diagnosticCategory?: string;
  diagnosticFirstCard?: boolean;
}) {
  const router = useRouter();
  const animation = useRef(new Animated.Value(0)).current;
  const imageCandidates = [
    ...(typeof product.image === 'string' ? [product.image] : []),
    ...product.gallery.filter((image): image is string => typeof image === 'string'),
    ...(typeof product.imageUrl === 'string' ? [product.imageUrl] : []),
  ];
  const uniqueImageCandidates = [...new Set(imageCandidates)];
  const [failedImageUrls, setFailedImageUrls] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [proxiedImageUrls, setProxiedImageUrls] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [localImageFailed, setLocalImageFailed] = React.useState(false);
  const imageUrl = nextProductImageUrl(uniqueImageCandidates, failedImageUrls);
  const imageToRender =
    typeof product.image === 'string' ? imageUrl : (!localImageFailed ? product.image : undefined) ?? imageUrl;

  useEffect(() => {
    Animated.spring(animation, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 5 }).start();
  }, [animation]);

  useEffect(() => {
    if (IMAGE_DEBUG && diagnosticCategory && diagnosticFirstCard) {
      logMobileTiming('FIRST_CARD_MOUNTED', {
        category: diagnosticCategory,
        page: 1,
        productId: product.id,
        provider: product.source,
        productImageUrl: product.imageUrl,
        nativeImageUri: imageUrl,
        imageUriByteForByteEqual: product.imageUrl === imageUrl,
      });
    }
  }, [diagnosticCategory, diagnosticFirstCard, product.id, product.source]);

  const usingNazihProxy = Boolean(
    product.source === 'nazih' &&
      Platform.OS === 'android' &&
      imageUrl &&
      proxiedImageUrls.has(imageUrl),
  );
  const cardImageSource = imageToRender
    ? imageSource(imageToRender, product.source, usingNazihProxy)
    : undefined;
  useEffect(() => {
    if (
      !IMAGE_DEBUG ||
      Platform.OS === 'web' ||
      product.source !== 'nazih' ||
      !diagnosticCategory ||
      !diagnosticFirstCard
    ) {
      return;
    }
    const requestSource =
      cardImageSource &&
      typeof cardImageSource === 'object' &&
      !Array.isArray(cardImageSource) &&
      'uri' in cardImageSource
        ? cardImageSource
        : undefined;
    logRawImageEvent('NAZIH_NATIVE_IMAGE_REQUEST_SOURCE', {
      category: diagnosticCategory,
      productId: product.id,
      productResultImageUrl: product.imageUrl,
      nativeImageUri: requestSource?.uri,
      byteForByteEqual: requestSource?.uri === product.imageUrl,
      accept: requestSource?.headers?.Accept,
      referer: requestSource?.headers?.Referer,
      userAgentSet: Boolean(requestSource?.headers?.['User-Agent']),
    });
  }, [
    cardImageSource,
    diagnosticCategory,
    diagnosticFirstCard,
    product.id,
    product.imageUrl,
    product.source,
  ]);
  const rawProviderName =
    product.source === 'nazih'
      ? 'NAZIH'
      : product.source === 'aliexpress'
        ? 'ALIEXPRESS'
        : product.source === 'stylewe'
          ? 'STYLEWE'
          : product.source === 'luxury-closet'
            ? 'LUXURY_CLOSET'
            : product.source.toUpperCase();
  const reportImageEvent = (event: 'start' | 'load' | 'error', detail?: string) => {
    if (!IMAGE_DEBUG || !imageUrl || Platform.OS === 'web') return;
    const host = (() => {
      try {
        return new URL(imageUrl).host;
      } catch {
        return 'invalid-url';
      }
    })();
    console.log('[luqta-image]', {
      event,
      productId: product.id,
      provider: product.source,
      host,
      urlLength: imageUrl.length,
      detail,
    });
  };

  return (
    <Animated.View
      style={[
        horizontal ? styles.productCardHorizontal : styles.productCard,
        { opacity: animation, transform: [{ scale: animation.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }] },
      ]}
    >
      <Pressable
        onPress={() => router.push({ pathname: '/product/[id]', params: { id: product.id } })}
        style={({ pressed }) => [styles.productCardPressable, pressed && styles.cardPressed]}
      >
        <View
          style={styles.productImageWrap}
          onLayout={(event) => {
            if (IMAGE_DEBUG && Platform.OS !== 'web') {
              const { width, height } = event.nativeEvent.layout;
              reportImageEvent('start', `layout=${width}x${height}`);
            }
          }}
        >
          {imageToRender ? (
            <Image
              source={cardImageSource!}
              style={styles.productImage}
              resizeMode="cover"
              onLoadStart={() => reportImageEvent('start')}
              onLoad={(event) =>
                (() => {
                  const source = event.nativeEvent.source;
                  reportImageEvent(
                    'load',
                    source ? `${source.width}x${source.height}` : 'loaded',
                  );
                   if (IMAGE_DEBUG && diagnosticCategory) {
                    logRawImageEvent(`${rawProviderName}_NATIVE_IMAGE_LOAD`, {
                      category: diagnosticCategory,
                      productId: product.id,
                      provider: product.source,
                    });
                    if (diagnosticFirstCard) {
                      logMobileTiming('FIRST_IMAGE_ONLOAD', {
                        category: diagnosticCategory,
                        page: 1,
                        productId: product.id,
                        provider: product.source,
                      });
                    }
                  }
                })()
              }
              onError={(event) => {
                reportImageEvent('error', event.nativeEvent.error);
                 if (IMAGE_DEBUG && diagnosticCategory) {
                  logRawImageEvent(`${rawProviderName}_NATIVE_IMAGE_ERROR`, {
                    category: diagnosticCategory,
                    productId: product.id,
                    provider: product.source,
                    nativeEvent: event.nativeEvent,
                    usingNazihProxy,
                  });
                }
                 if (typeof imageToRender !== 'string') {
                   setLocalImageFailed(true);
                 } else if (
                   imageUrl &&
                   shouldTryNazihImageProxy(
                     product.source,
                     Platform.OS === 'android',
                     imageUrl,
                     proxiedImageUrls,
                     nazihImageProxyUri(imageUrl),
                   )
                 ) {
                   setProxiedImageUrls((current) => new Set(current).add(imageUrl));
                 } else if (imageUrl) {
                   setFailedImageUrls((current) => new Set(current).add(imageUrl));
                 }
              }}
            />
          ) : shouldShowDieselLogo(product.source, false) ? (
            <DieselBrandPlaceholder />
          ) : (
            <View style={styles.missingProductImage}>
              <Feather name="image" size={22} color={colors.inkFaint} />
              <Text style={styles.missingProductImageText}>الصورة غير متوفرة</Text>
            </View>
          )}
          <FavoriteButton productId={product.id} />
          <View style={styles.productTag}>
            <Text style={styles.productTagText}>مختار</Text>
          </View>
        </View>
        <View style={styles.productInfo}>
          <Text style={styles.productTitle} numberOfLines={1}>{product.title}</Text>
          {product.merchant ? (
            <Text style={styles.productMerchant}>{product.merchant}</Text>
          ) : null}
          <View style={styles.productMeta}>
            <Text style={styles.productPrice}>
              {formatProductPrice(product.price, product.currency) ?? 'عرض المنتج'}
            </Text>
            {product.reviewCount != null && product.reviewCount > 0 && product.rating != null ? (
              <View style={styles.rating}>
                <Feather name="star" size={11} color={colors.gold} fill={colors.gold} />
                <Text style={styles.ratingText}>{formatRating(product.rating)}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
});

export function SearchBar({
  value,
  onChangeText,
  onSubmit,
  onCamera,
  placeholder = 'ابحث عن أي منتج...',
}: {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit?: () => void;
  onCamera?: () => void;
  placeholder?: string;
}) {
  return (
    <View style={styles.searchBar}>
      <Pressable onPress={onSubmit} hitSlop={10}>
        <Feather name="search" size={19} color={colors.inkFaint} />
      </Pressable>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        placeholder={placeholder}
        placeholderTextColor={colors.inkFaint}
        style={styles.searchInput}
        textAlign="right"
        returnKeyType="search"
      />
      {onCamera ? (
        <Pressable onPress={onCamera} hitSlop={10} style={styles.cameraIconButton}>
          <LinearGradient
            colors={[colors.pink, colors.violet, colors.cyan]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.cameraIconWrap}
          >
            <Feather name="camera" size={17} color={colors.ink} />
          </LinearGradient>
        </Pressable>
      ) : (
        <Feather name="sliders" size={17} color={colors.inkSoft} />
      )}
    </View>
  );
}

export function Header({
  title,
  subtitle,
  actionIcon = 'bell',
  onAction,
}: {
  title?: string;
  subtitle?: string;
  actionIcon?: keyof typeof Feather.glyphMap;
  onAction?: () => void;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        {title ? <Text style={styles.headerTitle}>{title}</Text> : <BrandMark compact />}
        {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
      </View>
      {actionIcon ? (
        <Pressable onPress={onAction} style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}>
          <Feather name={actionIcon} size={18} color={colors.inkSoft} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function HeroCard({
  onPress,
  onCamera,
}: {
  onPress: () => void;
  onCamera: () => void;
}) {
  return (
    <View style={styles.heroCard}>
      <ImageBackground source={heroImage} style={styles.heroImage} imageStyle={styles.heroImageStyle}>
        <LinearGradient
          colors={['rgba(9,9,13,0.06)', 'rgba(9,9,13,0.4)', 'rgba(9,9,13,0.96)']}
          locations={[0.08, 0.52, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.heroDots}>
          <View style={[styles.heroDot, styles.heroDotActive]} />
          <View style={styles.heroDot} />
          <View style={styles.heroDot} />
        </View>
        <View style={styles.heroContent}>
          <View style={styles.heroBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.heroBadgeText}>اختيارات لُقطة</Text>
          </View>
          <Text style={styles.heroTitle}>منتجات مختارة{'\n'}لأسلوب حياتك</Text>
          <Text style={styles.heroSubtitle}>اكتشف خيارات مميزة من المتاجر</Text>
          <View style={styles.heroActions}>
            <GradientButton label="اكتشف الآن" icon="arrow-left" onPress={onPress} small />
            <Pressable onPress={onCamera} style={({ pressed }) => [styles.heroCameraButton, pressed && styles.pressed]} accessibilityLabel="البحث بالصورة">
              <Feather name="camera" size={18} color={colors.ink} />
            </Pressable>
          </View>
        </View>
      </ImageBackground>
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  screenContent: { flexGrow: 1, paddingHorizontal: 18 },
  brandWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandIcon: { width: 47, height: 47, borderRadius: 14 },
  brandIconSmall: { width: 39, height: 39, borderRadius: 13 },
  brandType: { alignItems: 'flex-end' },
  brandArabic: { color: colors.ink, fontSize: 21, fontWeight: '800', letterSpacing: -0.6 },
  brandLatin: { color: colors.inkFaint, fontSize: 8, fontWeight: '700', letterSpacing: 2.5 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  headerCopy: { alignItems: 'flex-end', flex: 1 },
  headerTitle: { color: colors.ink, fontSize: 25, fontWeight: '800', letterSpacing: -0.5 },
  headerSubtitle: { color: colors.inkSoft, fontSize: 13, marginTop: 5 },
  headerAction: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13 },
  sectionTitleText: { color: colors.ink, fontSize: 18, fontWeight: '800', textAlign: 'right' },
  sectionAction: { color: colors.pink, fontSize: 12, fontWeight: '700' },
  gradientButton: { minHeight: 52, borderRadius: 17, overflow: 'hidden', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 19 },
  gradientButtonSmall: { minHeight: 44, borderRadius: 15, paddingHorizontal: 16 },
  gradientButtonText: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  buttonDisabled: { opacity: 0.45 },
  glassButton: { height: 39, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: colors.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 12 },
  glassButtonActive: { backgroundColor: 'rgba(255,45,168,0.14)', borderColor: 'rgba(255,45,168,0.45)' },
  glassButtonLabel: { color: colors.inkSoft, fontSize: 12, fontWeight: '700' },
  pressed: { opacity: 0.72, transform: [{ scale: 0.97 }] },
  cardPressed: { opacity: 0.82 },
  bottomNav: { position: 'absolute', bottom: 0, left: 0, right: 0, minHeight: 78, paddingHorizontal: 13, paddingTop: 11, flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'flex-end', backgroundColor: 'rgba(12,12,18,0.98)', borderTopWidth: 1, borderTopColor: colors.line },
  navItem: { minWidth: 60, alignItems: 'center', gap: 5 },
  navLabel: { color: colors.inkFaint, fontSize: 10, fontWeight: '600' },
  navLabelActive: { color: colors.ink, fontWeight: '800' },
  navActiveIcon: { width: 30, height: 27, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  prominentNavButton: { alignItems: 'center', gap: 5, marginTop: -26 },
  prominentNavGradient: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: colors.canvas },
  favoriteButton: { position: 'absolute', top: 9, right: 9, width: 31, height: 31, borderRadius: 11, backgroundColor: 'rgba(9,9,13,0.68)', alignItems: 'center', justifyContent: 'center', zIndex: 3 },
  favoriteButtonActive: { backgroundColor: colors.pink },
  productCard: { width: '48.2%', marginBottom: 17 },
  productCardHorizontal: { width: 175, marginRight: 12 },
  productCardPressable: { overflow: 'hidden', borderRadius: 21, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  productImageWrap: { height: 158, backgroundColor: colors.surfaceRaised, overflow: 'hidden' },
  productImage: { width: '100%', height: '100%' },
  missingProductImage: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.surfaceRaised },
  missingProductImageText: { color: colors.inkFaint, fontSize: 10, fontWeight: '700' },
  productTag: { position: 'absolute', left: 9, bottom: 9, backgroundColor: 'rgba(9,9,13,0.72)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  productTagText: { color: colors.cyan, fontSize: 9, fontWeight: '800' },
  productInfo: { padding: 11, alignItems: 'flex-end' },
  productTitle: { color: colors.ink, fontSize: 13, fontWeight: '800', width: '100%', textAlign: 'right' },
  productMerchant: { color: colors.inkFaint, fontSize: 10, marginTop: 4, width: '100%', textAlign: 'right' },
  productMeta: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  productPrice: { color: colors.ink, fontSize: 12, fontWeight: '800' },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  ratingText: { color: colors.inkSoft, fontSize: 10, fontWeight: '700' },
  searchBar: { height: 62, borderRadius: 21, backgroundColor: 'rgba(20,20,27,0.92)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.13)', flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 14, marginBottom: 14 },
  searchInput: { flex: 1, color: colors.ink, fontSize: 13, paddingVertical: 0, fontWeight: '600' },
  cameraIconButton: { width: 42, height: 42, borderRadius: 15, overflow: 'hidden' },
  cameraIconWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heroCard: { height: 230, borderRadius: 29, overflow: 'hidden', marginBottom: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' },
  heroImage: { flex: 1, justifyContent: 'flex-end' },
  heroImageStyle: { borderRadius: 25 },
  heroContent: { padding: 16, alignItems: 'flex-end' },
  heroActions: { flexDirection: 'row-reverse', alignItems: 'center', gap: 9 },
  heroCameraButton: { width: 44, height: 44, borderRadius: 15, backgroundColor: 'rgba(9,9,13,0.64)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  heroBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(9,9,13,0.5)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, marginBottom: 10 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.cyan },
  heroBadgeText: { color: colors.ink, fontSize: 10, fontWeight: '700' },
  heroTitle: { color: colors.ink, fontSize: 26, lineHeight: 32, fontWeight: '900', textAlign: 'right' },
  heroSubtitle: { color: 'rgba(246,241,248,0.78)', fontSize: 11, marginTop: 5, marginBottom: 11, textAlign: 'right' },
  heroDots: { flexDirection: 'row', gap: 5, position: 'absolute', top: 20, left: 20 },
  heroDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: 'rgba(246,241,248,0.42)' },
  heroDotActive: { width: 18, backgroundColor: colors.cyan },
  categoryTile: { overflow: 'hidden', borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  categoryTileCompact: { width: '48.2%', height: 154, marginBottom: 1 },
  categoryTileFull: { width: '48.2%', height: 191 },
  categoryVisual: { flex: 1, overflow: 'hidden', justifyContent: 'center', alignItems: 'center', backgroundColor: '#121218' },
  categoryTileFooter: { minHeight: 45, paddingHorizontal: 11, paddingVertical: 4, position: 'relative', alignItems: 'center', justifyContent: 'center' },
  categoryTileLabel: { width: '100%', paddingHorizontal: 15, color: colors.ink, fontSize: 13, lineHeight: 18, fontWeight: '700', textAlign: 'center' },
  categoryTileArrow: { position: 'absolute', left: 11, top: 0, bottom: 0, justifyContent: 'center' },
});
