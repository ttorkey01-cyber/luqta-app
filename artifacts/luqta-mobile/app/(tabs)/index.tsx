import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import colors from '@/constants/colors';
import {
  BottomNav,
  BrandMark,
  CategoryCard,
  HeroCard,
  ProductCard,
  Screen,
  SearchBar,
  SectionTitle,
} from '@/components/LuqtaUI';
import { categories } from '@/data/categories';
import { logMobileTiming } from '@/services/mobileDiagnostics';
import { searchService } from '@/services/searchService';
import type { ProductResult } from '@/types/search';

export default function HomeScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [featured, setFeatured] = useState<ProductResult[]>([]);
  const [featuredCollection, setFeaturedCollection] = useState<{
    title: string;
    category: string;
  }>();

  useEffect(() => {
    let active = true;
    void searchService
      .getHomePicks()
      .then((response) => {
        if (!active) return;
        setFeatured(response.products);
        setFeaturedCollection(response.collection);
      })
      .catch(() => {
        if (!active) return;
        setFeatured([]);
        setFeaturedCollection(undefined);
      });
    return () => {
      active = false;
    };
  }, []);

  const submitSearch = () => {
    const query = search.trim();
    if (query) router.push({ pathname: '/results', params: { query } });
  };

  return (
    <View style={styles.root}>
      <Screen contentStyle={styles.content}>
        <View style={styles.homeTop}>
          <Pressable
            style={({ pressed }) => [styles.notificationButton, pressed && styles.pressed]}
            accessibilityLabel="الإشعارات"
          >
            <Feather name="bell" size={18} color={colors.inkSoft} />
            <View style={styles.notificationDot} />
          </Pressable>
          <BrandMark />
        </View>

        <SearchBar
          value={search}
          onChangeText={setSearch}
          onSubmit={submitSearch}
          onCamera={() => router.push('/camera')}
          placeholder="ابحث عن أي شيء..."
        />

        <HeroCard
          onPress={() => router.push({ pathname: '/results', params: { query: search.trim() || 'الأزياء والملابس' } })}
          onCamera={() => router.push('/camera')}
        />

        <SectionTitle
          title="تصفح حسب الفئة"
          action="عرض الكل"
          onAction={() => router.push('/categories')}
        />
        <View style={styles.categoryGrid}>
          {categories.slice(0, 4).map((category) => (
            <CategoryCard
              key={category.query}
              category={category}
              compact
              onPress={() => {
                logMobileTiming('CATEGORY_TAP', {
                  category: category.id,
                  query: category.query,
                });
                router.push({ pathname: '/results', params: { query: category.query, category: category.id } });
              }}
              testID={`category-${category.query}`}
            />
          ))}
        </View>

        <Pressable
          onPress={() => router.push('/hunt')}
          style={({ pressed }) => [styles.huntBanner, pressed && styles.pressed]}
          testID="home-hunt-promo"
        >
          <View style={styles.huntHalo} />
          <View style={styles.huntBannerIcon}>
            <Feather name="target" size={25} color={colors.ink} />
          </View>
          <View style={styles.huntBannerCopy}>
            <Text style={styles.huntEyebrow}>LUQTA HUNT</Text>
            <Text style={styles.huntBannerTitle}>ما لقيت السعر اللي تبيه؟</Text>
            <Text style={styles.huntBannerText}>خل لُقطة تصيدها لك</Text>
          </View>
          <View style={styles.huntArrow}>
            <Feather name="arrow-left" size={17} color={colors.ink} />
          </View>
        </Pressable>

        {featured.length > 0 ? (
          <View style={styles.featuredSection}>
            <SectionTitle
              title="مختارات لُقطة"
              action="عرض الكل"
              onAction={() =>
                featuredCollection
                  ? router.push({
                      pathname: '/results',
                      params: {
                        query: featuredCollection.category,
                        category: featuredCollection.category,
                      },
                    })
                  : undefined
              }
            />
            {featuredCollection?.title ? (
              <Text style={styles.featuredCollectionTitle}>
                {featuredCollection.title}
              </Text>
            ) : null}
            <View style={styles.productGrid}>
              {featured.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </View>
          </View>
        ) : null}
      </Screen>
      <BottomNav />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingTop: 10 },
  homeTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    marginBottom: 14,
    borderRadius: 22,
    backgroundColor: 'rgba(20,20,27,0.72)',
    borderWidth: 1,
    borderColor: colors.line,
  },
  notificationButton: {
    width: 42,
    height: 42,
    borderRadius: 15,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationDot: { position: 'absolute', top: 10, right: 10, width: 5, height: 5, borderRadius: 3, backgroundColor: colors.pink },
  categoryGrid: { flexDirection: 'row-reverse', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12, marginBottom: 24 },
  huntBanner: {
    minHeight: 132,
    marginBottom: 27,
    padding: 17,
    borderRadius: 25,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(255,45,168,0.35)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  huntHalo: { position: 'absolute', width: 170, height: 170, borderRadius: 85, right: -54, top: -64, backgroundColor: 'rgba(158,75,255,0.16)' },
  huntBannerIcon: { width: 57, height: 57, borderRadius: 20, backgroundColor: 'rgba(255,45,168,0.19)', borderWidth: 1, borderColor: 'rgba(255,45,168,0.42)', alignItems: 'center', justifyContent: 'center' },
  huntBannerCopy: { flex: 1, alignItems: 'flex-end' },
  huntEyebrow: { color: colors.cyan, fontSize: 8, fontWeight: '900', letterSpacing: 1.8, marginBottom: 7 },
  huntBannerTitle: { color: colors.ink, fontSize: 15, fontWeight: '900', textAlign: 'right' },
  huntBannerText: { color: colors.inkSoft, fontSize: 12, marginTop: 5, textAlign: 'right' },
  huntArrow: { width: 31, height: 31, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  featuredSection: { paddingBottom: 10 },
  featuredCollectionTitle: { color: colors.ink, fontSize: 17, fontWeight: '900', textAlign: 'right', marginBottom: 13 },
  productGrid: { flexDirection: 'row-reverse', flexWrap: 'wrap', justifyContent: 'space-between' },
  pressed: { opacity: 0.78, transform: [{ scale: 0.98 }] },
});