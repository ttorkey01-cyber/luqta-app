import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import colors from '@/constants/colors';
import { BottomNav, CategoryCard, Header, Screen } from '@/components/LuqtaUI';
import { categories } from '@/data/categories';
import { logMobileTiming } from '@/services/mobileDiagnostics';

export default function CategoriesScreen() {
  const router = useRouter();

  return (
    <View style={styles.root}>
      <Screen contentStyle={styles.content}>
        <Header
          title="التصنيفات"
          subtitle="كل اللي تدور عليه، في مكان واحد"
          actionIcon="arrow-right"
          onAction={() => router.back()}
        />
        <View style={styles.sectionIntro}>
          <Text style={styles.eyebrow}>LUQTA EDIT</Text>
          <Text style={styles.sectionTitle}>اختَر مساحتك</Text>
          <Text style={styles.sectionText}>تصفح بعينك، ثم خلّ لُقطة تجمع لك الخيارات المناسبة.</Text>
        </View>
        <View style={styles.grid}>
          {categories.map((category) => (
            <CategoryCard
              key={category.query}
              category={category}
              onPress={() => {
                logMobileTiming('CATEGORY_TAP', {
                  category: category.id,
                  query: category.query,
                });
                router.push({ pathname: '/results', params: { query: category.query, category: category.id } });
              }}
              testID={`category-full-${category.query}`}
            />
          ))}
        </View>
      </Screen>
      <BottomNav />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingBottom: 110 },
  sectionIntro: { marginBottom: 17, alignItems: 'flex-end' },
  eyebrow: { color: colors.cyan, fontSize: 9, fontWeight: '800', letterSpacing: 2.2 },
  sectionTitle: { color: colors.ink, fontSize: 22, fontWeight: '900', marginTop: 6, textAlign: 'right' },
  sectionText: { color: colors.inkSoft, fontSize: 12, lineHeight: 19, marginTop: 5, textAlign: 'right' },
  grid: { flexDirection: 'row-reverse', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 13 },
});