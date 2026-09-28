import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  HeartPulse,
  RefreshCw,
  WifiOff,
} from 'lucide-react';
import {
  getGetProviderIntegrationStatusQueryKey,
  type ProviderImageHealthStatus,
  type ProviderStatus,
  useGetProviderIntegrationStatus,
} from '@workspace/api-client-react';
import { Link } from 'wouter';
import { Seo } from '@/components/provider-health-seo';

const statusCopy: Record<ProviderImageHealthStatus, { label: string; detail: string }> = {
  healthy: { label: 'سليم', detail: 'الصور التي تم فحصها قابلة للوصول' },
  degraded: { label: 'متدهور', detail: 'بعض الصور التي تم فحصها لا تستجيب' },
  unhealthy: { label: 'غير سليم', detail: 'الصور التي تم فحصها لا تستجيب' },
  not_checked: { label: 'لم يُفحص بعد', detail: 'لا توجد عينة جاهزة للفحص' },
};

const statusStyles: Record<ProviderImageHealthStatus, string> = {
  healthy: 'border-[#72e1b3]/25 bg-[#72e1b3]/10 text-[#a7f0ca]',
  degraded: 'border-[#f7c66a]/35 bg-[#f7c66a]/10 text-[#f7d995]',
  unhealthy: 'border-[#ff5e7a]/35 bg-[#ff5e7a]/10 text-[#ff9daf]',
  not_checked: 'border-white/10 bg-white/[.04] text-[#b8b3c0]',
};

const statusIconColor: Record<ProviderImageHealthStatus, string> = {
  healthy: 'text-[#72e1b3]',
  degraded: 'text-[#f7c66a]',
  unhealthy: 'text-[#ff5e7a]',
  not_checked: 'text-[#9d9aa8]',
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

function StatusBadge({ status }: { status: ProviderImageHealthStatus }) {
  const Icon = status === 'healthy'
    ? CheckCircle2
    : status === 'not_checked'
      ? Clock3
      : AlertTriangle;

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-arabic text-[.68rem] ${statusStyles[status]}`}>
      <Icon size={13} aria-hidden="true" />
      {statusCopy[status].label}
    </span>
  );
}

function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: number;
  note: string;
}) {
  return (
    <div className="rounded-2xl border border-white/[.08] bg-[#0c0c12] px-4 py-4 text-right">
      <div className="font-display text-2xl font-medium text-[#f6f1f8]">{value.toLocaleString('en-US')}</div>
      <div className="mt-1 font-arabic text-[.68rem] text-[#b8b3c0]">{label}</div>
      <div className="mt-1 font-arabic text-[.58rem] text-[#777381]">{note}</div>
    </div>
  );
}

function ProviderCard({ provider }: { provider: ProviderStatus }) {
  const health = provider.imageHealth;

  return (
    <article
      id={`merchant-${provider.id}`}
      className={`rounded-[1.5rem] border bg-[#111119] p-5 text-right sm:p-6 ${
        health.status === 'unhealthy'
          ? 'border-[#ff5e7a]/35'
          : health.status === 'degraded'
            ? 'border-[#f7c66a]/30'
            : 'border-white/10'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <StatusBadge status={health.status} />
        <div>
          <h2 className="font-arabic text-lg font-semibold text-[#f6f1f8]">{provider.name}</h2>
          <p className="mt-1 font-arabic text-xs text-[#777381]">{statusCopy[health.status].detail}</p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <Metric label="صور مملوءة" value={health.populatedImageCount} note="في الفهرس" />
        <Metric label="صور تم أخذ عينة منها" value={health.sampledImageCount} note="ضمن آخر فحص" />
        <Metric label="صور قابلة للوصول" value={health.reachableImageCount} note="من العينة" />
      </div>

      <div className="mt-5 flex items-center justify-end gap-2 border-t border-white/[.08] pt-4 font-arabic text-[.68rem] text-[#9d9aa8]">
        <span>{formatCheckedAt(health.lastCheckedAt)}</span>
        <Clock3 size={14} className="text-[#37d7f5]" aria-hidden="true" />
        <span>آخر فحص</span>
      </div>
    </article>
  );
}

export default function ProviderHealthPage() {
  const { data, isLoading, isError, isFetching, refetch } = useGetProviderIntegrationStatus({
    query: {
      queryKey: getGetProviderIntegrationStatusQueryKey(),
      refetchInterval: 30_000,
      staleTime: 15_000,
      refetchOnWindowFocus: true,
    },
  });
  const providers = data?.providers ?? [];
  const attentionProviders = providers.filter(({ imageHealth }) =>
    imageHealth.status === 'degraded' || imageHealth.status === 'unhealthy',
  );

  return (
    <div className="site-shell min-h-screen bg-[#09090d]" dir="rtl">
      <Seo
        title="صحة صور المزوّدين | لُقطة"
        description="لوحة تشغيلية لمتابعة وصول صور المنتجات لدى مزوّدي لُقطة."
      />
      <header className="border-b border-white/[.06]">
        <div className="container-luqta flex h-[84px] items-center justify-between">
          <Link href="/" className="focus-ring rounded-xl font-arabic text-sm text-[#f6f1f8]">
            لُقطة
          </Link>
          <div className="flex items-center gap-3">
            <span className="font-display text-[.62rem] uppercase tracking-[.18em] text-[#777381]">Operations</span>
            <HeartPulse size={18} className="text-[#37d7f5]" aria-hidden="true" />
          </div>
        </div>
      </header>

      <main className="container-luqta max-w-5xl py-16 sm:py-24">
        <div className="flex flex-col gap-6 border-b border-white/[.08] pb-10 sm:flex-row sm:items-end sm:justify-between">
          <div className="text-right">
            <div className="eyebrow mb-4">Provider health · image reachability</div>
            <h1 className="font-arabic text-3xl font-semibold leading-[1.6] text-[#f6f1f8] sm:text-5xl">صحة صور المزوّدين</h1>
            <p className="mt-3 max-w-2xl font-arabic text-sm leading-8 text-[#9d9aa8]">
              راقب الصور المملوءة في الفهرس مقابل العينة التي تم فحصها والصور التي أمكن الوصول إليها. تتحدث البيانات تلقائياً كل ٣٠ ثانية.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="focus-ring inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-white/15 px-4 py-3 font-arabic text-xs text-[#b8b3c0] transition-colors hover:border-[#37d7f5]/60 hover:text-[#f6f1f8] disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw size={15} className={isFetching ? 'animate-spin text-[#37d7f5]' : 'text-[#37d7f5]'} aria-hidden="true" />
            تحديث الآن
          </button>
        </div>

        {isLoading ? (
          <div className="mt-10 rounded-[1.5rem] border border-white/10 bg-[#111119] p-10 text-center font-arabic text-sm text-[#9d9aa8]">
            جارٍ تحميل حالة المزوّدين…
          </div>
        ) : isError ? (
          <div className="mt-10 rounded-[1.5rem] border border-[#ff5e7a]/30 bg-[#ff5e7a]/10 p-8 text-right">
            <div className="flex items-center justify-end gap-3">
              <h2 className="font-arabic text-base font-semibold text-[#ffb5c0]">تعذر تحميل حالة الصور</h2>
              <WifiOff size={19} className="text-[#ff5e7a]" aria-hidden="true" />
            </div>
            <p className="mt-3 font-arabic text-sm leading-7 text-[#d9a8b0]">حاول تحديث اللوحة مرة أخرى للتحقق من حالة المزوّدين.</p>
          </div>
        ) : (
          <>
            <section className="mt-10 rounded-[1.5rem] border border-[#f7c66a]/30 bg-[#f7c66a]/[.07] p-5 sm:p-6" aria-labelledby="attention-title">
              <div className="flex items-start justify-between gap-4">
                <div className="text-right">
                  <h2 id="attention-title" className="font-arabic text-base font-semibold text-[#f7e2a8]">
                    {attentionProviders.length
                      ? `${attentionProviders.length.toLocaleString('ar-SA')} مزوّد يحتاج إلى انتباه`
                      : 'لا توجد تنبيهات صور حالياً'}
                  </h2>
                  <p className="mt-2 font-arabic text-xs leading-7 text-[#b8b3c0]">
                    {attentionProviders.length
                      ? 'افتح المزوّد المتأثر لمراجعة الفرق بين الصور المملوءة والقابلة للوصول.'
                      : 'المزوّدون الذين تم فحصهم لا يظهرون صوراً متدهورة أو غير سليمة.'}
                  </p>
                </div>
                <AlertTriangle size={21} className={attentionProviders.length ? 'mt-0.5 shrink-0 text-[#f7c66a]' : 'mt-0.5 shrink-0 text-[#72e1b3]'} aria-hidden="true" />
              </div>
              {attentionProviders.length > 0 && (
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  {attentionProviders.map((provider) => (
                    <a
                      key={provider.id}
                      href={`#merchant-${provider.id}`}
                      className="focus-ring rounded-full border border-[#f7c66a]/35 bg-[#09090d]/30 px-3 py-2 font-arabic text-xs text-[#f7e2a8] hover:border-[#f7c66a]/70"
                    >
                      {provider.name}
                    </a>
                  ))}
                </div>
              )}
            </section>

            <section className="mt-8 space-y-4" aria-label="حالة المزوّدين">
              {providers.length > 0 ? providers.map((provider) => (
                <ProviderCard key={provider.id} provider={provider} />
              )) : (
                <div className="rounded-[1.5rem] border border-white/10 bg-[#111119] p-10 text-center font-arabic text-sm text-[#9d9aa8]">
                  لا توجد مزوّدات لعرضها.
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}