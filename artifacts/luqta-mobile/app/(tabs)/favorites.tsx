import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import colors from '@/constants/colors';
import { BottomNav, ProductCard, Screen, Header } from '@/components/LuqtaUI';
import { useApp } from '@/context/AppContext';
import { searchService } from '@/services/searchService';

export default function FavoritesScreen() {
  const { favorites, hydrated } = useApp();
  const saved = useMemo(
    () =>
      favorites.flatMap((id) => {
        const product = searchService.getProduct(id);
        return product ? [product] : [];
      }),
    [favorites],
  );
  const router = useRouter();

  return (
    <View style={styles.root}>
      <Screen>
        <Header title="المفضلة" subtitle={`${favorites.length} عناصر محفوظة`} actionIcon="bell" />
        {!hydrated ? null : saved.length ? (
          <View style={styles.grid}>
            {saved.map((product) => <ProductCard key={product.id} product={product} />)}
          </View>
        ) : (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}><Feather name="heart" size={25} color={colors.pink} /></View>
            <Text style={styles.emptyTitle}>
              {favorites.length ? 'المنتجات المحفوظة غير متاحة الآن' : 'قائمة المفضلة فاضية'}
            </Text>
            <Text style={styles.emptyText}>
              {favorites.length
                ? 'لا تتوفر بيانات مصدر المنتج في نتائج البحث الحالية.'
                : 'احفظ الأشياء اللي تعجبك عشان تلقاها بسرعة بعدين'}
            </Text>
            <Text onPress={() => router.replace('/')} style={styles.emptyLink}>استكشف مختارات لُقطة</Text>
          </View>
        )}
      </Screen>
      <BottomNav />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  grid: { flexDirection: 'row-reverse', flexWrap: 'wrap', justifyContent: 'space-between' },
  empty: { marginTop: 105, alignItems: 'center', paddingHorizontal: 30 },
  emptyIcon: { width: 72, height: 72, borderRadius: 25, backgroundColor: 'rgba(255,45,168,0.12)', alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  emptyTitle: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  emptyText: { color: colors.inkSoft, fontSize: 13, textAlign: 'center', lineHeight: 21, marginTop: 8 },
  emptyLink: { color: colors.cyan, fontSize: 13, fontWeight: '800', marginTop: 22 },
});