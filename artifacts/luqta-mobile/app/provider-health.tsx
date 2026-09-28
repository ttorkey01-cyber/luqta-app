import { Feather } from '@expo/vector-icons';
import {
  getGetProviderIntegrationStatusQueryKey,
  type ProviderImageHealthStatus,
  type ProviderStatus,
  useGetProviderIntegrationStatus,
} from '@workspace/api-client-react';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import colors from '@/constants/colors';
import { BottomNav, Header, Screen } from '@/components/LuqtaUI';

const statusCopy: Record<ProviderImageHealthStatus, { label: string; detail: string }> = {
  healthy: { label: 'سليم', detail: 'الصور التي تم فحصها قابلة للوصول' },
  degraded: { label: 'متدهور', detail: 'بعض الصور التي تم فحصها لا تستجيب' },
  unhealthy: { label: 'غير سليم', detail: 'الصور التي تم فحصها لا تستجيب' },
  not_checked: { label: 'لم يُفحص بعد', detail: 'لا توجد عينة جاهزة للفحص' },
};

const statusColors: Record<ProviderImageHealthStatus, { text: string; background: string; border: string }> = {
  healthy: { text: '#A7F0CA', background: 'rgba(114,225,179,0.10)', border: 'rgba(114,225,179,0.28)' },
  degraded: { text: '#F7D995', background: 'rgba(247,198,106,0.10)', border: 'rgba(247,198,106,0.32)' },
  unhealthy: { text: '#FF9DAF', background: 'rgba(255,94,122,0.10)', border: 'rgba(255,94,122,0.34)' },
  not_checked: { text: colors.inkSoft, background: 'rgba(255,255,255,0.04)', border: colors.line },
};

function formatCheckedAt(value: string | null) {
  if (!value) return 'لم يتم الفحص بعد';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'وقت الفحص غير متاح';
  return new Intl.DateTimeFormat('ar-SA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function Metric({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value.toLocaleString('en-US')}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricNote}>{note}</Text>
    </View>
  );
}

function ProviderCard({ provider }: { provider: ProviderStatus }) {
  const health = provider.imageHealth;
  const palette = statusColors[health.status];
  const cardBorderColor = health.status === 'unhealthy'
    ? 'rgba(255,94,122,0.34)'
    : health.status === 'degraded'
      ? 'rgba(247,198,106,0.30)'
      : colors.line;

  return (
    <View style={[styles.providerCard, { borderColor: cardBorderColor }]}>
      <View style={styles.providerHeader}>
        <View style={[styles.statusBadge, { backgroundColor: palette.background, borderColor: palette.border }]}>
          <Feather
            name={health.status === 'healthy' ? 'check-circle' : health.status === 'not_checked' ? 'clock' : 'alert-triangle'}
            size={13}
            color={palette.text}
          />
          <Text style={[styles.statusText, { color: palette.text }]}>{statusCopy[health.status].label}</Text>
        </View>
        <View style={styles.providerNameWrap}>
          <Text style={styles.providerName}>{provider.name}</Text>
          <Text style={styles.providerDetail}>{statusCopy[health.status].detail}</Text>
        </View>
      </View>

      <View style={styles.metrics}>
        <Metric label="صور مملوءة" value={health.populatedImageCount} note="في الفهرس" />
        <Metric label="تم أخذ عينة" value={health.sampledImageCount} note="ضمن آخر فحص" />
        <Metric label="قابلة للوصول" value={health.reachableImageCount} note="من العينة" />
      </View>

      <View style={styles.lastChecked}>
        <Text style={styles.lastCheckedText}>{formatCheckedAt(health.lastCheckedAt)}</Text>
        <Feather name="clock" size={13} color={colors.cyan} />
        <Text style={styles.lastCheckedLabel}>آخر فحص</Text>
      </View>
    </View>
  );
}

export default function ProviderHealthScreen() {
  const { data, isLoading, isError, isFetching, refetch } = useGetProviderIntegrationStatus({
    query: {
      queryKey: getGetProviderIntegrationStatusQueryKey(),
      refetchInterval: 30_000,
      staleTime: 15_000,
      refetchOnWindowFocus: true,
    },
  });
  const providers = data?.providers ?? [];
  const attentionCount = providers.filter(({ imageHealth }) =>
    imageHealth.status === 'degraded' || imageHealth.status === 'unhealthy',
  ).length;

  return (
    <View style={styles.root}>
      <Screen>
        <Header
          title="صحة صور المزوّدين"
          subtitle="مراقبة وصول صور المنتجات"
          actionIcon="refresh-cw"
          onAction={() => void refetch()}
        />

        <View style={styles.intro}>
          <Text style={styles.introTitle}>لوحة تشغيلية</Text>
          <Text style={styles.introText}>تابع الصور المملوءة في الفهرس مقابل العينة التي تم فحصها والصور التي أمكن الوصول إليها.</Text>
        </View>

        {isLoading ? (
          <View style={styles.messageCard}><Text style={styles.messageText}>جارٍ تحميل حالة المزوّدين…</Text></View>
        ) : isError ? (
          <View style={styles.errorCard}>
            <Feather name="wifi-off" size={20} color={colors.pink} />
            <Text style={styles.errorTitle}>تعذر تحميل حالة الصور</Text>
            <Text style={styles.errorText}>اضغط تحديث مرة أخرى للتحقق من حالة المزوّدين.</Text>
            <Pressable onPress={() => void refetch()} style={styles.retryButton}>
              <Text style={styles.retryText}>إعادة المحاولة</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={[styles.alertCard, attentionCount === 0 && styles.alertCardHealthy]}>
              <Feather name={attentionCount ? 'alert-triangle' : 'check-circle'} size={20} color={attentionCount ? colors.gold : colors.success} />
              <View style={styles.alertCopy}>
                <Text style={styles.alertTitle}>
                  {attentionCount ? `${attentionCount.toLocaleString('ar-SA')} مزوّد يحتاج إلى انتباه` : 'لا توجد تنبيهات صور حالياً'}
                </Text>
                <Text style={styles.alertText}>
                  {attentionCount ? 'راجع البطاقات المتأثرة أدناه لمعرفة فرق الصور المملوءة والقابلة للوصول.' : 'المزوّدون الذين تم فحصهم لا يظهرون صوراً متدهورة أو غير سليمة.'}
                </Text>
              </View>
            </View>
            <View style={styles.list}>
              {providers.length > 0 ? providers.map((provider) => (
                <ProviderCard key={provider.id} provider={provider} />
              )) : (
                <View style={styles.messageCard}><Text style={styles.messageText}>لا توجد مزوّدات لعرضها.</Text></View>
              )}
            </View>
          </>
        )}

        {isFetching && !isLoading ? <Text style={styles.refreshing}>جارٍ تحديث البيانات…</Text> : null}
      </Screen>
      <BottomNav />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  intro: { padding: 17, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, marginBottom: 15 },
  introTitle: { color: colors.cyan, fontSize: 11, fontWeight: '800', textAlign: 'right' },
  introText: { color: colors.inkSoft, fontSize: 12, lineHeight: 23, marginTop: 7, textAlign: 'right' },
  alertCard: { padding: 16, borderRadius: 22, backgroundColor: 'rgba(247,198,106,0.08)', borderWidth: 1, borderColor: 'rgba(247,198,106,0.28)', flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  alertCardHealthy: { backgroundColor: 'rgba(114,225,179,0.08)', borderColor: 'rgba(114,225,179,0.25)' },
  alertCopy: { flex: 1, alignItems: 'flex-end' },
  alertTitle: { color: colors.ink, fontSize: 13, fontWeight: '800', textAlign: 'right' },
  alertText: { color: colors.inkSoft, fontSize: 11, lineHeight: 20, marginTop: 5, textAlign: 'right' },
  list: { gap: 12, marginTop: 15 },
  providerCard: { padding: 16, borderRadius: 24, backgroundColor: colors.surface, borderWidth: 1 },
  providerHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  providerNameWrap: { flex: 1, alignItems: 'flex-end' },
  providerName: { color: colors.ink, fontSize: 15, fontWeight: '800', textAlign: 'right' },
  providerDetail: { color: colors.inkFaint, fontSize: 10, marginTop: 5, textAlign: 'right' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 6 },
  statusText: { fontSize: 10, fontWeight: '800' },
  metrics: { flexDirection: 'row-reverse', gap: 7, marginTop: 16 },
  metric: { flex: 1, minHeight: 77, paddingHorizontal: 6, paddingVertical: 10, borderRadius: 16, backgroundColor: colors.canvas, alignItems: 'center', justifyContent: 'center' },
  metricValue: { color: colors.ink, fontSize: 19, fontWeight: '600' },
  metricLabel: { color: colors.inkSoft, fontSize: 9, fontWeight: '700', marginTop: 3, textAlign: 'center' },
  metricNote: { color: colors.inkFaint, fontSize: 8, marginTop: 3, textAlign: 'center' },
  lastChecked: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 6, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 13, marginTop: 14 },
  lastCheckedText: { color: colors.inkFaint, fontSize: 10, flex: 1, textAlign: 'left' },
  lastCheckedLabel: { color: colors.inkSoft, fontSize: 10 },
  messageCard: { padding: 30, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: 'center', marginTop: 15 },
  messageText: { color: colors.inkSoft, fontSize: 12 },
  errorCard: { padding: 20, borderRadius: 22, backgroundColor: 'rgba(255,94,122,0.10)', borderWidth: 1, borderColor: 'rgba(255,94,122,0.30)', alignItems: 'center', marginTop: 15 },
  errorTitle: { color: '#FFB5C0', fontSize: 14, fontWeight: '800', marginTop: 10 },
  errorText: { color: '#D9A8B0', fontSize: 11, lineHeight: 20, marginTop: 6, textAlign: 'center' },
  retryButton: { marginTop: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,0.20)', borderRadius: 999, paddingHorizontal: 15, paddingVertical: 9 },
  retryText: { color: colors.ink, fontSize: 11, fontWeight: '700' },
  refreshing: { color: colors.inkFaint, fontSize: 10, textAlign: 'center', marginTop: 13 },
});