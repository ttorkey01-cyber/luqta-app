import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  FlatList,
  ListRenderItem,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import colors from '@/constants/colors';
import {
  BottomNav,
  GradientButton,
  ProductCard,
  Screen,
  SearchBar,
} from '@/components/LuqtaUI';
import {
  searchService,
  type CategoryFacet,
  type CategoryState,
  type SearchMode,
} from '@/services/searchService';
import type { ProductResult } from '@/types/search';
import type { ProductSearchRequest } from '@workspace/api-client-react';
import { logMobileTiming } from '@/services/mobileDiagnostics';

const GENERAL_FILTERS = [
  { id: 'all', label: 'الكل' },
  { id: 'rating', label: 'الأعلى تقييماً' },
  { id: 'price', label: 'الأقل سعراً' },
];

const DISCOVERY_PLACEHOLDERS: Partial<
  Record<NonNullable<ProductSearchRequest['category']>, string>
> = {
  automotive: 'مثال: شمعة كامري 2022 أصلية',
  beauty_care: 'مثال: عطر توم فورد رجالي أقل من 600',
};

type CategoryDiscoveryCardProps = {
  state: CategoryState;
  category?: NonNullable<ProductSearchRequest['category']>;
  onSubmit: (value: string) => void;
};

function CategoryDiscoveryCard({
  state,
  category,
  onSubmit,
}: CategoryDiscoveryCardProps) {
  const [value, setValue] = useState('');
  const isZero = state === 'zero';
  const placeholder =
    (category ? DISCOVERY_PLACEHOLDERS[category] : undefined) ??
    'مثال: حقيبة جلد سوداء عملية';

  return (
    <View style={styles.discoveryCard}>
      <View style={styles.discoveryIcon}>
        <Feather name="target" size={22} color={colors.ink} />
      </View>
      <Text style={styles.discoveryTitle}>
        {isZero
          ? 'ما لقينا منتجات في هذا القسم عند متاجرنا حالياً'
          : 'ما لقيت اللي في بالك؟'}
      </Text>
      <Text style={styles.discoverySubtitle}>
        {isZero
          ? 'اكتب اللي في بالك، ونصيدها لك'
          : 'اكتب لنا وش تدور عليه، ولُقطة تصيدها لك من الويب.'}
      </Text>
      {!isZero ? (
        <Text style={styles.discoveryHelper}>
          خلّ طلبك أوضح ونبحث لك في الويب.
        </Text>
      ) : null}
      <TextInput
        value={value}
        onChangeText={setValue}
        placeholder={placeholder}
        placeholderTextColor={colors.inkFaint}
        textAlign="right"
        style={styles.discoveryInput}
        returnKeyType="search"
        onSubmitEditing={() => onSubmit(value)}
      />
      <GradientButton
        label="صيّدها لي"
        icon="target"
        onPress={() => onSubmit(value)}
        disabled={!value.trim()}
      />
    </View>
  );
}

export default function ResultsScreen() {
  const params = useLocalSearchParams<{ query?: string; visual?: string; category?: string }>();
  const router = useRouter();
  const initialQuery = typeof params.query === 'string' ? params.query : '';
  const initialCategory =
    typeof params.category === 'string'
      ? (params.category as NonNullable<ProductSearchRequest['category']>)
      : undefined;
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState<
    NonNullable<ProductSearchRequest['category']> | undefined
  >(initialCategory);
  const [searchMode, setSearchMode] = useState<SearchMode>(
    initialCategory ? 'category_browse' : 'intent',
  );
  const [selectedFilter, setSelectedFilter] = useState('all');
  const [results, setResults] = useState<ProductResult[]>([]);
  const [categoryState, setCategoryState] = useState<CategoryState | undefined>(
    undefined,
  );
  const [categoryFilters, setCategoryFilters] = useState<CategoryFacet[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [paginationLoading, setPaginationLoading] = useState(false);
  const [refreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [strictPriceHasNoMatches, setStrictPriceHasNoMatches] = useState(false);
  const [requestError, setRequestError] = useState(false);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const loadingRef = useRef(false);

  useEffect(() => {
    let active = true;
    const requestController = new AbortController();
    const categoryFilterId =
      category &&
      searchMode === 'category_browse' &&
      selectedFilter !== 'all' &&
      selectedFilter !== 'rating' &&
      selectedFilter !== 'price'
        ? selectedFilter
        : undefined;
    loadingRef.current = true;
    setRequestError(false);
    if (page === 1) setDataLoading(true);
    else setPaginationLoading(true);
    void searchService
      .searchWithMetadata(
        query,
        category,
        searchMode,
        categoryFilterId,
        page,
        requestController.signal,
      )
      .then((response) => {
        if (!active) return;
        logMobileTiming('SET_PRODUCTS', {
          category,
          page,
          responseProductCount: response.products.length,
          previousProductsCount: results.length,
          productsStateCount: page === 1 ? response.products.length : results.length + response.products.length,
        });
        if (page === 1) setDataLoading(false);
        setResults((current) =>
          page === 1 ? response.products : [...current, ...response.products],
        );
        setCategoryState(response.categoryState);
        setCategoryFilters(response.categoryFilters);
        setHasMore(response.hasMore ?? false);
        setStrictPriceHasNoMatches(
          !category &&
          response.exactMatches === 0 &&
          response.constraintRelaxationAvailable === true,
        );
      })
      .catch((error: unknown) => {
        // A newer query or navigation intentionally cancels this request.
        // Its cleanup must not replace real results with an error or open LogBox.
        if (!active || requestController.signal.aborted) return;
        if (__DEV__) {
          console.error('[luqta-search-screen]', {
            query,
            category,
            page,
            name: error instanceof Error ? error.name : typeof error,
            message: error instanceof Error ? error.message : String(error),
            aborted: requestController.signal.aborted,
          });
        }
        if (page === 1) setResults([]);
        setHasMore(false);
        setCategoryState(undefined);
        setCategoryFilters([]);
        setStrictPriceHasNoMatches(false);
        setRequestError(true);
      })
      .finally(() => {
        if (!active) return;
        loadingRef.current = false;
        if (page === 1) setDataLoading(false);
        else setPaginationLoading(false);
      });
    return () => {
      active = false;
      requestController.abort();
    };
  }, [category, page, query, searchMode, selectedFilter, retryAttempt]);

  const isCategoryBrowse = Boolean(category && searchMode === 'category_browse');
  useEffect(() => {
    if (isCategoryBrowse && !dataLoading && !requestError) {
      logMobileTiming('SPINNER_HIDDEN', {
        category,
        page,
        productCount: results.length,
      });
    }
  }, [category, dataLoading, isCategoryBrowse, page, requestError, results.length]);
  const selectedCategoryFacet = categoryFilters.find(
    (filter) => filter.id === selectedFilter,
  );
  const selectedPrimaryId =
    selectedFilter === 'all'
      ? 'all'
      : selectedCategoryFacet?.parentId ?? selectedCategoryFacet?.id ?? 'all';
  const activePrimaryFilterId =
    isCategoryBrowse && categoryFilters.length > 0
      ? selectedPrimaryId
      : selectedFilter;
  const filterOptions = useMemo(
    () =>
      isCategoryBrowse && categoryFilters.length > 0
        ? [
            { id: 'all', label: 'الكل' },
            ...categoryFilters.filter((filter) => filter.level === 0),
          ]
        : GENERAL_FILTERS,
    [categoryFilters, isCategoryBrowse],
  );
  const secondaryFilterOptions = useMemo(
    () =>
      isCategoryBrowse && selectedPrimaryId !== 'all'
        ? categoryFilters.filter(
            (filter) =>
              filter.level === 1 && filter.parentId === selectedPrimaryId,
          )
        : [],
    [categoryFilters, isCategoryBrowse, selectedPrimaryId],
  );
  const filteredResults = useMemo(() => {
    if (
      isCategoryBrowse &&
      selectedFilter !== 'all' &&
      categoryFilters.some((filter) => filter.id === selectedFilter)
    ) {
      return results.filter((product) =>
        product.categoryFilterIds?.includes(selectedFilter),
      );
    }
    return results;
  }, [categoryFilters, isCategoryBrowse, results, selectedFilter]);
  const sortedProducts = useMemo(() => {
    if (isCategoryBrowse && selectedFilter === 'all') return filteredResults;
    const sorted = [...filteredResults];
    if (selectedFilter === 'rating') {
      sorted.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    } else if (selectedFilter === 'price') {
      sorted.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
    } else {
      sorted.sort((a, b) => b.matchScore - a.matchScore);
    }
    return sorted;
  }, [filteredResults, isCategoryBrowse, selectedFilter]);
  const loadMore = useCallback(() => {
    if (
      !isCategoryBrowse ||
      !hasMore ||
      loadingRef.current ||
      dataLoading ||
      paginationLoading ||
      refreshing
    ) {
      return;
    }
    setPage((current) => current + 1);
  }, [hasMore, isCategoryBrowse, dataLoading, paginationLoading, refreshing]);
  const retryRequest = useCallback(() => {
    setRetryAttempt((attempt) => attempt + 1);
  }, []);
  const selectFilter = useCallback((filterId: string) => {
    setPage(1);
    setSelectedFilter(filterId);
  }, []);
  const renderProduct: ListRenderItem<ProductResult> = useCallback(
    ({ item, index }) => (
      <ProductCard
        product={item}
        diagnosticCategory={isCategoryBrowse ? category : undefined}
        diagnosticFirstCard={isCategoryBrowse && index === 0}
      />
    ),
    [category, isCategoryBrowse],
  );
  const keyExtractor = useCallback((item: ProductResult) => item.id, []);
  const listHeader = useMemo(
    () => (
      <>
        <View style={styles.topRow}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.backButton,
              pressed && styles.pressed,
            ]}
          >
            <Feather name="arrow-right" size={19} color={colors.ink} />
          </Pressable>
          <Text style={styles.title}>نتائج البحث</Text>
          <View style={styles.resultCount}>
            <Text style={styles.resultCountText}>
              {dataLoading ? '…' : sortedProducts.length}
            </Text>
          </View>
        </View>
        <SearchBar
          value={query}
          onChangeText={(nextQuery) => {
            setQuery(nextQuery);
            setPage(1);
            if (nextQuery !== initialQuery) setCategory(undefined);
          }}
          onSubmit={() => {
            if (!query.trim()) return;
            setCategory(undefined);
            setSearchMode('intent');
            setSelectedFilter('all');
            setPage(1);
          }}
        />
        {params.visual === 'demo' ? (
          <View style={styles.demoNotice}>
            <Feather name="info" size={14} color={colors.cyan} />
            <Text style={styles.demoNoticeText}>
              نتائج تجريبية من البحث البصري المحلي
            </Text>
          </View>
        ) : null}
        <View style={styles.filters}>
          {filterOptions.map((filter) => (
            <Pressable
              key={filter.id}
              onPress={() => selectFilter(filter.id)}
              style={({ pressed }) => [
                styles.filter,
                activePrimaryFilterId === filter.id && styles.filterActive,
                pressed && styles.pressed,
              ]}
            >
              <Text
                style={[
                  styles.filterText,
                  activePrimaryFilterId === filter.id && styles.filterTextActive,
                ]}
              >
                {filter.label}
              </Text>
            </Pressable>
          ))}
        </View>
        {secondaryFilterOptions.length > 0 ? (
          <View style={styles.secondaryFilters}>
            {secondaryFilterOptions.map((filter) => (
              <Pressable
                key={filter.id}
                onPress={() => selectFilter(filter.id)}
                style={({ pressed }) => [
                  styles.secondaryFilter,
                  selectedFilter === filter.id && styles.secondaryFilterActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.filterText,
                    selectedFilter === filter.id && styles.filterTextActive,
                  ]}
                >
                  {filter.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <View style={styles.resultHeader}>
          <Text style={styles.resultSub}>
            {query ? `أفضل ما لقيناه لـ ${query}` : 'اقتراحات تناسب ذوقك'}
          </Text>
          <Feather name="sliders" size={16} color={colors.inkSoft} />
        </View>
      </>
    ),
    [
      dataLoading,
      filterOptions,
      isCategoryBrowse,
      activePrimaryFilterId,
      params.visual,
      query,
      router,
      secondaryFilterOptions,
      selectedPrimaryId,
      selectedFilter,
      sortedProducts.length,
    ],
  );
  const submitDiscovery = useCallback(
    (value: string) => {
      const nextQuery = value.trim();
      if (!nextQuery) return;
      setQuery(nextQuery);
      setSearchMode('intent');
      setPage(1);
      setSelectedFilter('all');
    },
    [],
  );
  const emptyComponent = useMemo(() => {
    if (dataLoading) {
      return (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.pink} />
        </View>
      );
    }
    if (requestError) {
      return (
        <View style={styles.errorState}>
          <Text style={styles.errorTitle}>تعذر تحميل المنتجات</Text>
          <Text style={styles.errorText}>حاول مرة ثانية</Text>
          <GradientButton
            label="إعادة المحاولة"
            icon="refresh-cw"
            onPress={retryRequest}
          />
        </View>
      );
    }
    if (isCategoryBrowse && categoryState === 'zero') {
      return (
        <CategoryDiscoveryCard
          state="zero"
          category={category}
          onSubmit={submitDiscovery}
        />
      );
    }
    if (isCategoryBrowse && categoryState === 'low') {
      return (
        <CategoryDiscoveryCard
          state="low"
          category={category}
          onSubmit={submitDiscovery}
        />
      );
    }
    if (strictPriceHasNoMatches) {
      return (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Feather name="search" size={24} color={colors.pink} />
          </View>
          <Text style={styles.emptyTitle}>ما لقينا منتجات ضمن السعر اللي طلبته</Text>
          <Text style={styles.emptyText}>تقدر تغيّر حد السعر في شريط البحث. ما عرضنا منتجات تتجاوز ميزانيتك.</Text>
        </View>
      );
    }
    return (
      <View style={styles.empty}>
        <View style={styles.emptyIcon}>
          <Feather name="search" size={24} color={colors.pink} />
        </View>
        <Text style={styles.emptyTitle}>ما لقينا نتيجة مطابقة</Text>
        <Text style={styles.emptyText}>
          جرّب وصفاً أبسط أو ابحث باسم المنتج.
        </Text>
      </View>
    );
  }, [
    category,
    categoryState,
    strictPriceHasNoMatches,
    isCategoryBrowse,
    dataLoading,
    requestError,
    retryRequest,
    submitDiscovery,
  ]);
  const paginationError = useMemo(() => {
    if (!requestError || sortedProducts.length === 0) return null;
    return (
      <View style={styles.paginationError}>
        <Text style={styles.errorTitle}>تعذر تحميل المنتجات</Text>
        <Text style={styles.errorText}>حاول مرة ثانية</Text>
        <Pressable
          onPress={retryRequest}
          style={({ pressed }) => [styles.retryLink, pressed && styles.pressed]}
        >
          <Text style={styles.retryLinkText}>إعادة المحاولة</Text>
        </Pressable>
      </View>
    );
  }, [requestError, retryRequest, sortedProducts.length]);
  const discoveryFooter = useMemo(() => {
    if (!isCategoryBrowse || categoryState !== 'low' || sortedProducts.length === 0) {
      return null;
    }
    return (
      <CategoryDiscoveryCard
        state="low"
        category={category}
        onSubmit={submitDiscovery}
      />
    );
  }, [category, categoryState, isCategoryBrowse, sortedProducts.length, submitDiscovery]);

  const gridMountedRef = useRef(false);
  useEffect(() => {
    if (!isCategoryBrowse || !results.length) return;
    logMobileTiming('PRODUCTS_STATE_COMMITTED', {
      category,
      productsStateCount: results.length,
    });
  }, [category, isCategoryBrowse, results.length]);

  useLayoutEffect(() => {
    if (!isCategoryBrowse || !sortedProducts.length) return;
    logMobileTiming('REACT_RENDER_STARTED', {
      category,
      productsStateCount: results.length,
      flatListDataCount: sortedProducts.length,
    });
  }, [category, isCategoryBrowse, results.length, sortedProducts.length]);

  return (
    <View style={styles.root}>
      <Screen scroll={false} contentStyle={styles.content}>
        <FlatList
          data={sortedProducts}
          renderItem={renderProduct}
          keyExtractor={keyExtractor}
          numColumns={2}
          columnWrapperStyle={styles.grid}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={emptyComponent}
          ListFooterComponent={
            paginationLoading ? (
              <View style={styles.loadingMore}>
                <ActivityIndicator color={colors.pink} />
              </View>
            ) : (
              paginationError ?? discoveryFooter
            )
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.6}
          onContentSizeChange={(_width, height) => {
            if (
              !gridMountedRef.current &&
              isCategoryBrowse &&
              sortedProducts.length > 0
            ) {
              gridMountedRef.current = true;
              logMobileTiming('GRID_MOUNTED', {
                category,
                productsStateCount: results.length,
                flatListDataCount: sortedProducts.length,
                contentHeight: height,
              });
            }
          }}
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          updateCellsBatchingPeriod={50}
          windowSize={7}
          removeClippedSubviews={Platform.OS === 'android'}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={styles.list}
        />
      </Screen>
      <BottomNav />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingTop: 18 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  backButton: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line },
  title: { color: colors.ink, fontSize: 20, fontWeight: '900' },
  resultCount: { width: 40, height: 40, borderRadius: 14, backgroundColor: 'rgba(255,45,168,0.13)', alignItems: 'center', justifyContent: 'center' },
  resultCountText: { color: colors.pink, fontSize: 12, fontWeight: '900' },
  demoNotice: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-end', marginTop: -9, marginBottom: 14 },
  demoNoticeText: { color: colors.cyan, fontSize: 10, fontWeight: '700' },
  filters: { flexDirection: 'row-reverse', gap: 8, marginBottom: 22 },
  secondaryFilters: { flexDirection: 'row-reverse', gap: 8, marginTop: -12, marginBottom: 22, flexWrap: 'wrap' },
  filter: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  secondaryFilter: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 11, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.line },
  secondaryFilterActive: { backgroundColor: 'rgba(55,215,245,0.18)', borderColor: colors.cyan },
  filterActive: { backgroundColor: colors.pink, borderColor: colors.pink },
  filterText: { color: colors.inkSoft, fontSize: 10, fontWeight: '700' },
  filterTextActive: { color: colors.ink },
  resultHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13 },
  resultSub: { color: colors.inkSoft, fontSize: 12, textAlign: 'right' },
  list: { flex: 1 },
  grid: { flexDirection: 'row-reverse', justifyContent: 'space-between' },
  loading: { minHeight: 220, alignItems: 'center', justifyContent: 'center' },
  loadingMore: { paddingVertical: 18, alignItems: 'center', justifyContent: 'center' },
  errorState: { marginTop: 80, alignItems: 'center', paddingHorizontal: 30 },
  errorTitle: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  errorText: { color: colors.inkSoft, fontSize: 13, textAlign: 'center', marginTop: 8, marginBottom: 16 },
  paginationError: { alignItems: 'center', paddingVertical: 18 },
  retryLink: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  retryLinkText: { color: colors.pink, fontSize: 12, fontWeight: '800' },
  empty: { marginTop: 80, alignItems: 'center', paddingHorizontal: 30 },
  emptyIcon: { width: 66, height: 66, borderRadius: 23, backgroundColor: 'rgba(255,45,168,0.12)', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  emptyText: { color: colors.inkSoft, fontSize: 12, textAlign: 'center', lineHeight: 20, marginTop: 8 },
  discoveryCard: { marginTop: 24, marginBottom: 26, padding: 18, borderRadius: 24, backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(255,45,168,0.28)', alignItems: 'stretch' },
  discoveryIcon: { width: 46, height: 46, borderRadius: 16, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-end', backgroundColor: 'rgba(255,45,168,0.18)', marginBottom: 14 },
  discoveryTitle: { color: colors.ink, fontSize: 19, fontWeight: '900', textAlign: 'right' },
  discoverySubtitle: { color: colors.ink, fontSize: 14, fontWeight: '800', textAlign: 'right', marginTop: 6 },
  discoveryHelper: { color: colors.inkSoft, fontSize: 12, lineHeight: 19, textAlign: 'right', marginTop: 8, marginBottom: 14 },
  discoveryInput: { minHeight: 50, borderRadius: 15, paddingHorizontal: 14, color: colors.ink, backgroundColor: colors.canvas, borderWidth: 1, borderColor: colors.line, fontSize: 13, marginBottom: 12 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.97 }] },
});