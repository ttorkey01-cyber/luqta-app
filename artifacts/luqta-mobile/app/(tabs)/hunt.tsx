import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState, useEffect } from 'react';
import { Alert, Image, StyleSheet, Text, TextInput, View, Pressable, FlatList, ActivityIndicator, Platform } from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import colors from '@/constants/colors';
import { BottomNav, Header, GlassButton, GradientButton } from '@/components/LuqtaUI';
import { useApp } from '@/context/AppContext';
import { formatProductPrice, parseLocalizedNumber } from '@/types/search';
import { Hunt } from '@/services/huntService';
import type { HuntDiscoveryMatch } from '@/services/huntDiscovery';
import { openProductUrl } from '@/services/productUrl';
import { useRouter } from 'expo-router';
import Constants, { AppOwnership } from 'expo-constants';
import { huntService } from '@/services/huntService';

const supportsRemotePush =
  Platform.OS !== 'web' && Constants.appOwnership !== AppOwnership.Expo;

function discoveryPriceLabel(
  match: HuntDiscoveryMatch,
  targetPrice: number | undefined,
  currency: string,
) {
  if (match.priceStatus === 'unavailable') {
    return targetPrice == null
      ? 'لقينا لك هذا المنتج — السعر غير متوفر حالياً'
      : 'السعر غير متوفر حالياً — لا يمكن تأكيد أنه ضمن ميزانيتك';
  }

  const formattedPrice =
    match.price == null
      ? null
      : formatProductPrice(match.price, currency) ?? `${match.price} ${currency}`;
  if (!formattedPrice) return 'السعر غير متوفر حالياً';
  if (match.priceStatus === 'within_budget') {
    return `السعر ${formattedPrice} — ضمن الميزانية`;
  }
  if (match.priceStatus === 'above_budget') {
    return `السعر ${formattedPrice} — أعلى من الحد`;
  }
  return `السعر الموثق: ${formattedPrice}`;
}

function HuntCard({ hunt }: { hunt: Hunt }) {
  const { updateHunt, deleteHunt } = useApp();
  const router = useRouter();

  const toggleStatus = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void updateHunt(hunt.id, { status: hunt.status === 'active' ? 'paused' : 'active' });
  };

  const remove = () => {
    Alert.alert('حذف الصيدة', 'هل أنت متأكد من حذف هذا الطلب؟', [
      { text: 'إلغاء', style: 'cancel' },
      { text: 'حذف', style: 'destructive', onPress: () => void deleteHunt(hunt.id) },
    ]);
  };

  const viewMatches = () => {
    router.push({ pathname: '/results', params: { query: hunt.query } });
  };
  const targetPrice = hunt.targetPrice;

  return (
    <View style={[styles.huntCard, hunt.status === 'paused' && styles.huntCardPaused]}>
       <View style={styles.huntHeader}>
         <View style={styles.huntActions}>
           <Pressable onPress={remove} style={styles.iconBtn}><Feather name="trash-2" size={16} color={colors.inkSoft} /></Pressable>
           <Pressable onPress={toggleStatus} style={styles.iconBtn}><Feather name={hunt.status === 'active' ? "pause" : "play"} size={16} color={colors.inkSoft} /></Pressable>
         </View>
         <View style={styles.huntStatusBadge}>
           <View style={[styles.statusDot, { backgroundColor: hunt.status === 'active' ? colors.cyan : colors.inkSoft }]} />
            <Text style={styles.statusText}>{hunt.status === 'active' ? 'محفوظ' : 'موقوف'}</Text>
         </View>
       </View>

       <Text style={styles.huntQuery}>{hunt.originalQuery || hunt.query}</Text>
       <View style={styles.huntMeta}>
           {targetPrice != null ? (
             <Text style={styles.metaText}>
               الحد: {formatProductPrice(targetPrice, hunt.currency) ?? targetPrice}
             </Text>
           ) : null}
          <Text style={styles.metaText}>الحالة: {hunt.condition === 'new' ? 'جديد' : hunt.condition === 'used' ? 'مستعمل' : 'أي حالة'}</Text>
           {hunt.lastCheckedAt ? <Text style={styles.metaText}>آخر فحص: {new Date(hunt.lastCheckedAt).toLocaleString('ar-SA')}</Text> : null}
           {hunt.monitoringState ? <Text style={styles.metaText}>المتابعة: {hunt.monitoringState === 'active' ? 'غير مفعلة حالياً' : hunt.monitoringState === 'paused' ? 'موقوفة' : 'غير نشطة'}</Text> : null}
       </View>

        {hunt.discoveryMatches?.length ? (
          <View style={styles.discoveryList}>
            {hunt.discoveryMatches.map((match) => (
              <Pressable
                key={match.id}
                accessibilityRole="button"
                onPress={() => void openProductUrl(match)}
                style={styles.discoveryCard}
              >
                <View style={styles.discoveryCopy}>
                  <Text style={styles.discoveryTitle} numberOfLines={2}>
                    {match.title}
                  </Text>
                  {match.merchant ? (
                    <Text style={styles.discoveryMerchant} numberOfLines={1}>
                      {match.merchant}
                    </Text>
                  ) : null}
                  <Text
                    style={[
                      styles.discoveryPrice,
                      match.priceStatus === 'within_budget' && styles.discoveryWithin,
                      match.priceStatus === 'above_budget' && styles.discoveryAbove,
                    ]}
                  >
                    {discoveryPriceLabel(match, targetPrice, hunt.currency)}
                  </Text>
                </View>
                <Feather name="external-link" size={15} color={colors.cyan} />
              </Pressable>
            ))}
            <Pressable onPress={viewMatches} style={styles.viewBtn}>
              <Text style={styles.viewBtnText}>عرض كل النتائج</Text>
              <Feather name="chevron-left" size={14} color={colors.ink} />
            </Pressable>
          </View>
        ) : hunt.bestMatchId && hunt.bestPrice != null ? (
         <View style={styles.matchBox}>
           <View style={styles.matchCopy}>
             <Text style={styles.matchStatus}>
                {targetPrice == null
                  ? 'أفضل سعر موثق في النتائج الحالية'
                  : hunt.bestPrice <= targetPrice
                    ? 'لقينا خيار ضمن السعر اللي تبيه'
                    : 'أقل سعر موثق أعلى من الحد'}
             </Text>
             {hunt.bestMatchTitle ? <Text style={styles.matchTitle} numberOfLines={1}>{hunt.bestMatchTitle}</Text> : null}
              <Text style={styles.matchText}>
                أفضل سعر حالي: {formatProductPrice(hunt.bestPrice, hunt.currency) ?? 'غير متاح'}
              </Text>
           </View>
           <Pressable onPress={viewMatches} style={styles.viewBtn}>
             <Text style={styles.viewBtnText}>عرض النتائج</Text>
             <Feather name="chevron-left" size={14} color={colors.ink} />
           </Pressable>
         </View>
       ) : (
         <View style={styles.monitoringBox}>
           <Feather name="search" size={14} color={colors.inkSoft} />
            <Text style={styles.monitoringText}>
              {hunt.matchStatus === 'search_unavailable'
                ? 'تعذر فحص النتائج الآن. الطلب محفوظ.'
                : hunt.matchStatus === 'no_verified_price'
                  ? 'وجدنا نتائج، لكن السعر أو العملة غير موثقين.'
                  : 'لم يظهر تطابق موثوق في نتائج البحث الحالية. الطلب محفوظ.'}
            </Text>
         </View>
       )}
    </View>
  );
}

export default function HuntScreen() {
  const insets = useSafeAreaInsets();
  const { hunts, createHunt } = useApp();

  const [mode, setMode] = useState<'list' | 'create'>(hunts.length > 0 ? 'list' : 'create');
  const [description, setDescription] = useState('');
  const [targetPrice, setTargetPrice] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [condition, setCondition] = useState<'any'|'new'|'used'>('any');
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pushEnabled, setPushEnabled] = useState<boolean | null>(null);
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    void huntService.notificationStatus().then(setPushEnabled).catch(() => setPushEnabled(null));
  }, []);

  const toggleNotifications = async () => {
    setPushBusy(true);
    try {
      if (pushEnabled) {
        setPushEnabled(await huntService.disableNotifications());
        return;
      }
      if (!supportsRemotePush) {
        throw new Error('الإشعارات الفورية تتطلب نسخة تطوير، ولا تتوفر في Expo Go أو معاينة الويب.');
      }
      const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
      if (!projectId) throw new Error('معرّف مشروع Expo غير متوفر');
      const Notifications = await import('expo-notifications');
      const permission = await Notifications.getPermissionsAsync();
      const finalPermission = permission.status === 'granted'
        ? permission
        : await Notifications.requestPermissionsAsync();
      if (finalPermission.status !== 'granted') {
        throw new Error('لم يتم السماح بالإشعارات');
      }
      const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      setPushEnabled(await huntService.enableNotifications(token));
    } catch (error) {
      Alert.alert('تعذر تفعيل الإشعارات', error instanceof Error ? error.message : 'حاول مرة أخرى.');
    } finally {
      setPushBusy(false);
    }
  };

  useEffect(() => {
    if (hunts.length === 0 && mode === 'list') setMode('create');
  }, [hunts.length, mode]);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.85,
    });
    if (!result.canceled) setImageUri(result.assets[0]?.uri ?? null);
  };

  const submit = async () => {
    if (!description.trim()) {
      Alert.alert('اكتب لنا وش تبي', 'أضف وصفاً بسيطاً للمنتج اللي تدور عليه.');
      return;
    }
    setIsSubmitting(true);
    try {
      await createHunt({
        query: description.trim(),
        originalQuery: description.trim(),
        normalizedIntent: description.trim().toLocaleLowerCase(),
        imageUri: imageUri ?? undefined,
        targetPrice: parseLocalizedNumber(targetPrice),
        currency: 'SAR',
        condition,
        createdAt: new Date().toISOString(),
        status: 'active',
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSubmitted(true);
      setTimeout(() => {
        setSubmitted(false);
        setMode('list');
        setDescription('');
        setTargetPrice('');
        setImageUri(null);
        setCondition('any');
      }, 2000);
    } catch (err) {
      Alert.alert('خطأ', 'حدث خطأ أثناء حفظ الطلب.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (mode === 'list') {
    const pushUnavailable = !pushEnabled && !supportsRemotePush;
    return (
      <View style={styles.root}>
        <View style={[styles.scroll, { paddingTop: insets.top + 18, paddingBottom: insets.bottom + 97, paddingHorizontal: 18 }]}>
            <Header title="صيداتي" subtitle="طلباتك المحفوظة" actionIcon="plus" onAction={() => setMode('create')} />
             <Pressable
               onPress={toggleNotifications}
               disabled={pushBusy || pushUnavailable}
               accessibilityState={{ disabled: pushBusy || pushUnavailable }}
               style={styles.notificationsControl}
             >
               <Feather name={pushEnabled ? 'bell' : 'bell-off'} size={16} color={pushEnabled ? colors.cyan : colors.inkSoft} />
               <Text style={styles.notificationsText}>
                 {pushBusy
                   ? 'جارٍ التحديث'
                   : pushEnabled
                     ? 'إشعارات الصيدات مفعلة'
                     : supportsRemotePush
                       ? 'تفعيل إشعارات الصيدات'
                       : 'الإشعارات تتطلب نسخة تطوير'}
               </Text>
             </Pressable>
           <FlatList
             data={hunts}
             keyExtractor={h => h.id}
             renderItem={({item}) => <HuntCard hunt={item} />}
             contentContainerStyle={{ paddingBottom: 100 }}
             showsVerticalScrollIndicator={false}
           />
        </View>
        <BottomNav />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <KeyboardAwareScrollViewCompat
        style={styles.scroll}
        contentContainerStyle={{ paddingTop: insets.top + 18, paddingBottom: insets.bottom + 97, paddingHorizontal: 18 }}
        bottomOffset={80}
        keyboardShouldPersistTaps="handled"
      >
        <Header
          title="صِدها لي"
          subtitle="قل لنا وش تدور عليه، ولُقطة تبحث لك"
          actionIcon={hunts.length > 0 ? "list" : undefined}
          onAction={() => hunts.length > 0 && setMode('list')}
        />

        <LinearGradient colors={['rgba(255,45,168,0.18)', 'rgba(55,215,245,0.08)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.introCard}>
          <View style={styles.introIcon}><Feather name="target" size={26} color={colors.ink} /></View>
           <Text style={styles.introTitle}>وش تدور عليه؟</Text>
           <Text style={styles.introText}>اكتب طلبك بالتفصيل ونبحث في النتائج المتاحة الآن</Text>
        </LinearGradient>

        {submitted ? (
          <View style={styles.successCard}>
            <View style={styles.successIcon}><Feather name="check" size={23} color={colors.ink} /></View>
            <Text style={styles.successTitle}>تم حفظ الطلب</Text>
             <Text style={styles.successText}>
               حفظنا الصيدة على جهازك وعلى الخادم. فحصنا النتائج الحالية، لكن المتابعة والفحوصات المجدولة غير مفعلة في هذا الإصدار.
             </Text>
          </View>
        ) : (
          <>
            <Text style={styles.fieldLabel}>وش تدور عليه؟</Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="مثال: جينز Diesel رجالي أسود مقاس 34"
              placeholderTextColor={colors.inkFaint}
              multiline
              textAlign="right"
              style={[styles.textArea, styles.fieldInput]}
            />

            <View style={styles.rowBetween}>
              <Text style={styles.optional}>اختياري</Text>
              <Text style={styles.fieldLabel}>صورة المنتج</Text>
            </View>
            <GlassButton icon={imageUri ? 'check-circle' : 'image'} label={imageUri ? 'تمت إضافة الصورة' : 'أضف صورة'} onPress={pickImage} active={Boolean(imageUri)} />
            {imageUri ? <Image source={{ uri: imageUri }} style={styles.uploadedImage} /> : null}

            <View style={styles.rowBetween}>
              <Text style={styles.optional}>اختياري</Text>
              <Text style={styles.fieldLabel}>السعر اللي تبيه</Text>
            </View>
            <View style={styles.priceInputWrap}>
              <Text style={styles.currency}>ر.س</Text>
              <TextInput
                value={targetPrice}
                onChangeText={setTargetPrice}
                placeholder="350"
                placeholderTextColor={colors.inkFaint}
                keyboardType="number-pad"
                textAlign="right"
                style={styles.priceInput}
              />
            </View>

            <Text style={styles.fieldLabel}>حالة المنتج</Text>
            <View style={styles.conditionRow}>
              {(['any', 'new', 'used'] as const).map(c => (
                <Pressable key={c} onPress={() => setCondition(c)} style={[styles.condBtn, condition === c && styles.condBtnActive]}>
                  <Text style={[styles.condBtnText, condition === c && styles.condBtnTextActive]}>
                    {c === 'any' ? 'أي حالة' : c === 'new' ? 'جديد' : 'مستعمل'}
                  </Text>
                </Pressable>
              ))}
            </View>

            {isSubmitting ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator color={colors.pink} />
              </View>
            ) : (
              <GradientButton label="صِدها لي" icon="target" onPress={submit} />
            )}
          </>
        )}

        <Text style={styles.benefitsTitle}>وش يصير بعدين؟</Text>
        <View style={styles.benefitRow}>
           <View style={styles.benefitIcon}><Feather name="search" size={17} color={colors.cyan} /></View>
           <View style={styles.benefitCopy}><Text style={styles.benefitTitle}>ندور في كل مكان</Text><Text style={styles.benefitText}>نقارن لك الخيارات من المتاجر المختلفة</Text></View>
        </View>
        <View style={styles.benefitRow}>
           <View style={styles.benefitIcon}><Feather name="bell" size={17} color={colors.gold} /></View>
           <View style={styles.benefitCopy}><Text style={styles.benefitTitle}>نحفظ طلبك</Text><Text style={styles.benefitText}>تقدر ترجع له وتشوف أفضل نتيجة حالية في أي وقت</Text></View>
        </View>
      </KeyboardAwareScrollViewCompat>
      <BottomNav />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  scroll: { flex: 1 },
  introCard: { borderRadius: 25, padding: 20, marginBottom: 25, alignItems: 'flex-end', borderWidth: 1, borderColor: 'rgba(255,45,168,0.25)' },
  introIcon: { width: 53, height: 53, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.10)', alignItems: 'center', justifyContent: 'center', marginBottom: 17 },
  introTitle: { color: colors.ink, fontSize: 26, fontWeight: '900' },
  introText: { color: colors.inkSoft, fontSize: 13, marginTop: 6 },
  fieldLabel: { color: colors.ink, fontSize: 13, fontWeight: '800', marginBottom: 9, textAlign: 'right' },
  optional: { color: colors.inkFaint, fontSize: 10, marginBottom: 9 },
  fieldInput: { color: colors.ink, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 17, paddingHorizontal: 14, fontSize: 13 },
  textArea: { minHeight: 90, paddingTop: 15, marginBottom: 20 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 15 },
  uploadedImage: { width: 80, height: 80, borderRadius: 15, marginTop: 11, marginBottom: 17, alignSelf: 'flex-end' },
  priceInputWrap: { height: 52, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 17, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, marginBottom: 22 },
  currency: { color: colors.inkFaint, fontSize: 12, fontWeight: '800' },
  priceInput: { flex: 1, color: colors.ink, fontSize: 13, padding: 0 },

  conditionRow: { flexDirection: 'row-reverse', gap: 10, marginBottom: 24 },
  condBtn: { flex: 1, height: 44, borderRadius: 15, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  condBtnActive: { backgroundColor: 'rgba(255,45,168,0.15)', borderColor: colors.pink },
  condBtnText: { color: colors.inkSoft, fontSize: 12, fontWeight: '700' },
  condBtnTextActive: { color: colors.pink, fontWeight: '800' },

  loadingWrap: { height: 52, alignItems: 'center', justifyContent: 'center' },

  benefitsTitle: { color: colors.ink, fontSize: 16, fontWeight: '800', textAlign: 'right', marginTop: 31, marginBottom: 13 },
  benefitRow: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: 14, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, marginBottom: 9 },
  benefitIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.07)', alignItems: 'center', justifyContent: 'center' },
  benefitCopy: { flex: 1, alignItems: 'flex-end' },
  benefitTitle: { color: colors.ink, fontSize: 12, fontWeight: '800' },
  benefitText: { color: colors.inkFaint, fontSize: 10, marginTop: 4, textAlign: 'right' },
  successCard: { alignItems: 'center', padding: 28, borderRadius: 25, backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(114,225,179,0.24)' },
  successIcon: { width: 55, height: 55, borderRadius: 19, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  successTitle: { color: colors.ink, fontSize: 20, fontWeight: '900' },
  successText: { color: colors.inkSoft, fontSize: 12, textAlign: 'center', lineHeight: 20, marginTop: 8 },

  huntCard: { backgroundColor: colors.surface, borderRadius: 20, padding: 16, borderWidth: 1, borderColor: colors.line, marginBottom: 16 },
  huntCardPaused: { opacity: 0.5 },
  huntHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  huntActions: { flexDirection: 'row', gap: 10 },
  iconBtn: { width: 34, height: 34, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  huntStatusBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.4)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { color: colors.inkSoft, fontSize: 10, fontWeight: '700' },
  huntQuery: { color: colors.ink, fontSize: 18, fontWeight: '800', textAlign: 'right', marginBottom: 8 },
  huntMeta: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 12, marginBottom: 16 },
  metaText: { color: colors.inkFaint, fontSize: 11, fontWeight: '600', backgroundColor: 'rgba(255,255,255,0.04)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  matchBox: { backgroundColor: 'rgba(55,215,245,0.1)', padding: 12, borderRadius: 14, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  matchCopy: { flex: 1, alignItems: 'flex-end', marginLeft: 10 },
  matchStatus: { color: colors.ink, fontSize: 11, fontWeight: '800', textAlign: 'right' },
  matchTitle: { color: colors.inkSoft, fontSize: 10, marginTop: 4, maxWidth: '100%', textAlign: 'right' },
  matchText: { color: colors.cyan, fontSize: 12, fontWeight: '800' },
  discoveryList: { backgroundColor: colors.surface, gap: 8 },
  discoveryCard: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, padding: 12, backgroundColor: colors.surfaceRaised, borderRadius: 14, borderWidth: 1, borderColor: colors.line },
  discoveryCopy: { flex: 1, alignItems: 'flex-end' },
  discoveryTitle: { color: colors.ink, fontSize: 12, fontWeight: '800', textAlign: 'right' },
  discoveryMerchant: { color: colors.inkFaint, fontSize: 10, marginTop: 4, textAlign: 'right' },
  discoveryPrice: { color: colors.inkSoft, fontSize: 10, fontWeight: '700', marginTop: 5, textAlign: 'right' },
  discoveryWithin: { color: colors.success },
  discoveryAbove: { color: colors.gold },
  viewBtn: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.4)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  viewBtnText: { color: colors.ink, fontSize: 10, fontWeight: '700' },
  monitoringBox: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, padding: 12, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 14 },
  monitoringText: { color: colors.inkSoft, fontSize: 12, fontWeight: '600' },
  notificationsControl: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, padding: 13, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, marginBottom: 14 },
  notificationsText: { flex: 1, textAlign: 'right', color: colors.inkSoft, fontSize: 12, fontWeight: '700' },
});
