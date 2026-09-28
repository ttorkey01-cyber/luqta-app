import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowUpLeft, Camera, Compass, ExternalLink, Image as ImageIcon, Mail, Menu, Search, ShieldCheck, Sparkles, X } from 'lucide-react';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import ProviderHealthPage from '@/pages/provider-health';
import heroImage from '../../luqta-mobile/assets/images/luqta-hero.jpg';
import bagImage from '../../luqta-mobile/assets/images/luqta-bag.jpg';
import chairImage from '../../luqta-mobile/assets/images/luqta-chair.jpg';
import watchImage from '../../luqta-mobile/assets/images/luqta-watch.jpg';
import logoImage from '../../luqta-mobile/assets/images/luqta-icon.png';

const queryClient = new QueryClient();

const navItems = [
  { href: '#about', ar: 'عن لُقطة', en: 'About' },
  { href: '#how-it-works', ar: 'كيف تعمل', en: 'How it works' },
  { href: '#categories', ar: 'المجالات', en: 'Categories' },
  { href: '#contact', ar: 'تواصل', en: 'Contact' },
];

function Seo({ title, description }: { title: string; description: string }) {
  useEffect(() => {
    document.title = title;
    const meta = document.querySelector('meta[name="description"]');
    meta?.setAttribute('content', description);
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
  }, [description, title]);
  return null;
}

function Navigation() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <header className="absolute inset-x-0 top-0 z-30">
      <div className="container-luqta flex h-[84px] items-center justify-between">
        <a href="#top" onClick={close} className="focus-ring flex items-center gap-3 rounded-xl" data-testid="link-logo">
          <img src={logoImage} alt="شعار لُقطة" width="44" height="44" className="h-11 w-11 rounded-[14px] object-cover" />
          <span className="font-arabic text-lg font-semibold tracking-tight text-[#f6f1f8]">لُقطة</span>
        </a>
        <nav className="hidden items-center gap-7 lg:flex" aria-label="التنقل الرئيسي">
          {navItems.map((item) => (
            <a key={item.href} href={item.href} className="focus-ring group rounded-lg px-1 py-2 text-right" data-testid={`link-nav-${item.en.toLowerCase().replaceAll(' ', '-')}`}>
              <span className="block font-arabic text-[.78rem] text-[#f6f1f8] transition-colors group-hover:text-[#ff72bf]">{item.ar}</span>
              <span className="block text-[.62rem] uppercase tracking-[.16em] text-[#777381]">{item.en}</span>
            </a>
          ))}
        </nav>
        <a href="#coming-soon" className="focus-ring hidden rounded-full border border-[#ff2da8]/60 bg-[#ff2da8]/10 px-5 py-2.5 text-right transition-colors hover:bg-[#ff2da8]/20 sm:flex sm:items-center sm:gap-2" data-testid="link-coming-soon-nav">
          <span className="font-arabic text-xs text-[#ffb5dc]">قريباً</span>
          <span className="text-[.65rem] uppercase tracking-widest text-[#ff72bf]">Coming soon</span>
          <ArrowLeft size={14} className="text-[#ff72bf]" aria-hidden="true" />
        </a>
        <button type="button" onClick={() => setOpen((value) => !value)} aria-label={open ? 'إغلاق القائمة' : 'فتح القائمة'} aria-expanded={open} className="focus-ring rounded-xl border border-white/10 p-2.5 text-[#f6f1f8] lg:hidden" data-testid="button-mobile-menu">
          {open ? <X size={21} /> : <Menu size={21} />}
        </button>
      </div>
      {open && (
        <div className="container-luqta lg:hidden">
          <nav className="glass rounded-2xl p-3 shadow-2xl" aria-label="التنقل للجوال">
            {navItems.map((item) => (
              <a key={item.href} href={item.href} onClick={close} className="focus-ring flex items-center justify-between rounded-xl px-4 py-3.5 text-right hover:bg-white/5" data-testid={`link-mobile-${item.en.toLowerCase().replaceAll(' ', '-')}`}>
                <span>
                  <span className="font-arabic block text-sm">{item.ar}</span>
                  <span className="text-[.65rem] uppercase tracking-widest text-[#777381]">{item.en}</span>
                </span>
                <ArrowUpLeft size={16} className="text-[#37d7f5]" aria-hidden="true" />
              </a>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}

function SectionHeading({ eyebrow, arabic, english, align = 'right' }: { eyebrow: string; arabic: string; english: string; align?: 'right' | 'center' }) {
  return (
    <div className={align === 'center' ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl text-right'}>
      <div className="eyebrow mb-4">{eyebrow}</div>
      <h2 className="font-arabic text-3xl font-semibold leading-[1.5] tracking-tight text-[#f6f1f8] sm:text-4xl lg:text-[2.7rem]">{arabic}</h2>
      <p className="mt-2 font-display text-sm uppercase tracking-[.18em] text-[#777381]">{english}</p>
    </div>
  );
}

function Home() {
  return (
    <div id="top" className="site-shell bg-[#09090d]">
      <Seo title="لُقطة | اكتشف ما تبحث عنه" description="لُقطة تساعدك على البحث واكتشاف المنتجات عبر المتاجر الإلكترونية، بالنص أو الصور، ومقارنة الخيارات ذات الصلة." />
      <Navigation />
      <main>
        <section className="hero-glow hero-grid relative isolate min-h-[760px] overflow-hidden pt-32 sm:min-h-[850px] lg:min-h-[800px]" aria-labelledby="hero-title">
          <div className="container-luqta relative z-10 grid items-center gap-14 pb-24 pt-12 lg:grid-cols-[.92fr_1.08fr] lg:gap-24 lg:pb-32 lg:pt-28">
            <div className="text-right">
              <div className="reveal mb-7 flex items-center justify-end gap-3">
                <span className="font-arabic text-xs text-[#9d9aa8]">اكتشف بوضوح، واشترِ من وجهتك</span>
                <span className="h-2 w-2 rounded-full bg-[#37d7f5] shadow-[0_0_16px_rgba(55,215,245,.8)]" aria-hidden="true" />
              </div>
              <h1 id="hero-title" className="reveal reveal-delay-1 font-arabic text-[2.65rem] font-semibold leading-[1.45] tracking-[-.045em] text-[#f6f1f8] sm:text-5xl lg:text-[4.6rem]">
                قل لي وش تبي،<br /><span className="text-gradient">وأنا أصيده لك</span>
              </h1>
              <p className="reveal reveal-delay-1 mt-3 font-display text-xs uppercase tracking-[.17em] text-[#777381]">Tell me what you want, and I’ll hunt it down.</p>
              <p className="reveal reveal-delay-2 mt-7 font-arabic text-lg leading-[2] text-[#b8b3c0] sm:text-xl">كل ما تبحث عنه .. في لُقطة واحدة</p>
              <p className="reveal reveal-delay-2 mt-1 font-display text-xs uppercase tracking-[.16em] text-[#777381]">Everything you’re looking for, in one LUQTA.</p>
              <p className="reveal reveal-delay-2 mt-4 max-w-lg mr-auto font-arabic text-sm leading-8 text-[#777381]">
                ابحث بالكلمة أو الصورة، وشوف الخيارات الأقرب لذوقك من متاجر إلكترونية متعددة. لُقطة تساعدك على الوصول، والقرار لك.
              </p>
              <div className="reveal reveal-delay-3 mt-9 flex flex-wrap items-center justify-end gap-3">
                <a href="#how-it-works" className="focus-ring group inline-flex items-center gap-3 rounded-full bg-[#ff2da8] px-6 py-3.5 font-arabic text-sm font-semibold text-white transition-transform hover:-translate-y-0.5" data-testid="link-explore-how">
                  <span>اكتشف كيف تعمل</span><ArrowLeft size={17} className="transition-transform group-hover:-translate-x-1" />
                </a>
                <a href="#affiliate-disclosure" className="focus-ring inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-3.5 font-arabic text-xs text-[#b8b3c0] transition-colors hover:border-[#37d7f5]/60 hover:text-[#f6f1f8]" data-testid="link-disclosure-hero">
                  <ShieldCheck size={16} className="text-[#37d7f5]" /> كيف نحافظ على الوضوح
                </a>
              </div>
              <div className="reveal reveal-delay-3 mt-10 flex items-center justify-end gap-5 text-right">
                <div>
                  <div className="font-display text-[.65rem] uppercase tracking-[.2em] text-[#777381]">Built for discovery</div>
                  <div className="mt-1 font-arabic text-xs text-[#9d9aa8]">تطبيق سعودي قيد التطوير</div>
                </div>
                <div className="h-9 w-px bg-white/15" />
                <Sparkles size={20} className="text-[#f7c66a]" aria-hidden="true" />
              </div>
            </div>
            <div className="relative order-first mx-auto w-full max-w-[620px] lg:order-last">
              <div className="absolute -right-8 top-10 h-28 w-28 rounded-full bg-[#ff2da8]/15 blur-3xl" aria-hidden="true" />
              <div className="absolute -bottom-10 -left-5 h-36 w-36 rounded-full bg-[#37d7f5]/10 blur-3xl" aria-hidden="true" />
              <div className="image-shimmer hero-image-frame float-slow relative aspect-[1.04] overflow-hidden rounded-[2rem] border border-white/10 bg-[#14141b]">
                <img src={heroImage} alt="كرسي أنيق في مساحة منزلية مضاءة بضوء الشمس" width="1024" height="1024" className="h-full w-full object-cover opacity-90" fetchPriority="high" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#09090d]/65 via-transparent to-[#09090d]/10" />
                <div className="absolute bottom-5 left-5 right-5 flex items-end justify-between gap-4">
                  <div className="rounded-2xl border border-white/15 bg-[#09090d]/60 px-4 py-3 text-right backdrop-blur-md">
                    <div className="font-arabic text-xs text-[#f6f1f8]">مثال على ما يمكن أن تجده</div>
                    <div className="mt-1 font-display text-[.62rem] uppercase tracking-widest text-[#37d7f5]">A considered find</div>
                  </div>
                  <div className="grid h-11 w-11 place-items-center rounded-full border border-white/20 bg-[#09090d]/50 text-[#f6f1f8] backdrop-blur-md" aria-hidden="true"><ArrowUpLeft size={18} /></div>
                </div>
              </div>
              <div className="absolute -bottom-8 -right-5 hidden w-36 rounded-2xl border border-white/15 bg-[#15151d]/95 p-3 text-right shadow-2xl sm:block">
                <div className="mb-2 flex items-center justify-between"><span className="font-display text-[.6rem] tracking-widest text-[#777381]">LUQTA FIND</span><span className="h-2 w-2 rounded-full bg-[#72e1b3]" /></div>
                <div className="font-arabic text-[.68rem] leading-6 text-[#b8b3c0]">خيارات مرتبطة، بلا ضوضاء</div>
              </div>
            </div>
          </div>
          <div className="container-luqta absolute bottom-7 left-1/2 flex -translate-x-1/2 items-center justify-between text-[#777381]">
            <span className="font-display text-[.62rem] tracking-[.2em]">01 / 04</span>
            <span className="font-arabic text-[.65rem]">مرّر لتكتشف</span>
          </div>
        </section>

        <section id="about" className="section-pad border-t border-white/[.06] bg-[#0c0c12]" aria-labelledby="about-title">
          <div className="container-luqta grid items-start gap-12 lg:grid-cols-[.7fr_1.3fr] lg:gap-28">
            <div className="lg:sticky lg:top-28">
              <SectionHeading eyebrow="01 — The idea" arabic="عن لُقطة" english="About LUQTA" />
              <div className="line-accent mt-7 mr-0" />
            </div>
            <div className="grid gap-8 text-right sm:grid-cols-2">
              <div className="sm:col-span-2">
                <p id="about-title" className="font-arabic text-xl leading-[2.1] text-[#f6f1f8] sm:text-2xl">لُقطة مساحة أهدأ للبحث عن الأشياء التي تريدها.</p>
                <p className="mt-5 max-w-2xl font-arabic text-sm leading-8 text-[#9d9aa8]">نحن نبني تطبيقاً يساعد الناس على البحث واكتشاف المنتجات عبر المتاجر الإلكترونية باستخدام النص أو الصور، ثم مقارنة الخيارات ذات الصلة والانتقال إلى المتجر لإكمال الشراء.</p>
              </div>
              {[
                { label: 'وضوح', en: 'Clarity', text: 'نوضح لك ما يخص لُقطة وما يخص المتجر، حتى تعرف خطوتك التالية.' },
                { label: 'اختيار', en: 'Choice', text: 'نعرض مسارات ونتائج تساعدك على المقارنة، ولا نقرر بدلاً عنك.' },
                { label: 'ثقة', en: 'Trust', text: 'نبدأ بصدق: التطبيق قيد التطوير، وتجربته ستتطور مع الوقت.' },
                { label: 'وصول', en: 'Discovery', text: 'من الفكرة الأولى إلى الصفحة المناسبة، في رحلة بحث أبسط.' },
              ].map((item, index) => (
                <article key={item.en} className="card-hover rounded-2xl border border-white/10 bg-[#111119] p-5 text-right" data-testid={`card-about-${index}`}>
                  <div className="mb-8 flex items-center justify-between">
                    <span className="font-display text-[.64rem] uppercase tracking-[.2em] text-[#37d7f5]">{item.en}</span>
                    <span className="font-arabic text-sm text-[#ff72bf]">{item.label}</span>
                  </div>
                  <p className="font-arabic text-xs leading-7 text-[#b8b3c0]">{item.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="section-pad relative overflow-hidden bg-[#09090d]" aria-labelledby="how-title">
          <div className="container-luqta">
            <SectionHeading eyebrow="02 — The rhythm" arabic="كيف تعمل؟" english="How it works" align="center" />
            <div className="relative mt-16 grid gap-5 md:grid-cols-3">
              {[
                { number: '01', icon: Search, title: 'ابحث بطريقتك', en: 'Search naturally', copy: 'اكتب ما يدور في بالك، من اسم منتج إلى وصف بسيط.' },
                { number: '02', icon: ImageIcon, title: 'أو شارك صورة', en: 'Use an image', copy: 'لديك صورة لشيء أعجبك؟ استخدمها كنقطة بداية للبحث.' },
                { number: '03', icon: ExternalLink, title: 'قارن ثم انتقل', en: 'Compare & continue', copy: 'استكشف الخيارات ذات الصلة، ثم انتقل إلى المتجر لإتمام الشراء.' },
              ].map((step, index) => {
                const Icon = step.icon;
                return (
                  <article key={step.number} className="card-hover relative rounded-[1.5rem] border border-white/10 bg-[#111119] p-6 text-right md:p-7" data-testid={`card-step-${index + 1}`}>
                    <div className="mb-16 flex items-start justify-between">
                      <span className="font-display text-4xl font-medium text-white/10">{step.number}</span>
                      <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#ff2da8]/10 text-[#ff72bf]"><Icon size={20} aria-hidden="true" /></span>
                    </div>
                    <h3 className="font-arabic text-base font-semibold text-[#f6f1f8]">{step.title}</h3>
                    <div className="mt-2 font-display text-[.64rem] uppercase tracking-[.18em] text-[#37d7f5]">{step.en}</div>
                    <p className="mt-4 font-arabic text-xs leading-7 text-[#9d9aa8]">{step.copy}</p>
                  </article>
                );
              })}
            </div>
            <div className="mt-10 flex items-center justify-center gap-3 text-center">
              <span className="h-px w-12 bg-[#ff2da8]/50" aria-hidden="true" />
              <p className="font-arabic text-xs text-[#777381]">لُقطة توصلك، والمتجر يكمل معك</p>
              <span className="h-px w-12 bg-[#37d7f5]/50" aria-hidden="true" />
            </div>
          </div>
        </section>

        <section id="categories" className="section-pad border-y border-white/[.06] bg-[#0c0c12]" aria-labelledby="categories-title">
          <div className="container-luqta grid gap-14 lg:grid-cols-[.78fr_1.22fr] lg:items-center lg:gap-24">
            <div className="relative order-last grid grid-cols-2 gap-3 lg:order-first">
              <div className="image-shimmer relative col-span-2 aspect-[2/1] overflow-hidden rounded-3xl border border-white/10"><img src={bagImage} alt="حقيبة جلدية بلون بني دافئ" width="1024" height="1024" loading="lazy" className="h-full w-full object-cover transition-transform duration-700 hover:scale-105" /></div>
              <div className="image-shimmer relative aspect-square overflow-hidden rounded-3xl border border-white/10"><img src={watchImage} alt="ساعة ذكية بحزام معدني" width="1024" height="1024" loading="lazy" className="h-full w-full object-cover transition-transform duration-700 hover:scale-105" /></div>
              <div className="image-shimmer relative aspect-square overflow-hidden rounded-3xl border border-white/10"><img src={chairImage} alt="كرسي أخضر أنيق بتفاصيل ذهبية" width="1024" height="1024" loading="lazy" className="h-full w-full object-cover transition-transform duration-700 hover:scale-105" /></div>
            </div>
            <div className="text-right">
              <SectionHeading eyebrow="03 — The wide lens" arabic="من الأشياء اليومية إلى القطع التي لا تُنسى" english="Categories, without the boxes" />
              <p id="categories-title" className="mt-7 font-arabic text-sm leading-8 text-[#9d9aa8]">لُقطة مصممة لترافق فضولك، مهما كان الشيء الذي تبحث عنه. ابدأ من مجال مألوف، أو دع بحثك يأخذك إلى مكان جديد.</p>
              <div className="mt-9 flex flex-wrap justify-end gap-2.5">
                {[
                  ['أزياء', 'Fashion'],
                  ['إلكترونيات', 'Electronics'],
                  ['منزل', 'Home'],
                  ['سيارات وقطع غيار', 'Automotive & parts'],
                  ['جمال وعناية', 'Beauty & care'],
                  ['مزيد من الاكتشاف', 'And more'],
                ].map(([ar, en], index) => (
                  <div key={en} className={`rounded-full border px-4 py-3 text-right transition-colors hover:border-[#ff2da8]/60 ${index === 0 ? 'border-[#ff2da8]/60 bg-[#ff2da8]/10' : 'border-white/10 bg-[#111119]'}`} data-testid={`tag-category-${index}`}>
                    <span className="font-arabic text-xs text-[#f6f1f8]">{ar}</span><span className="mr-2 text-[.58rem] uppercase tracking-wider text-[#777381]">{en}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="section-pad bg-[#09090d]" aria-labelledby="catch-title">
          <div className="container-luqta">
            <div className="relative overflow-hidden rounded-[2rem] border border-[#9e4bff]/30 bg-[linear-gradient(120deg,#15151d_0%,#171329_48%,#111d26_100%)] p-7 sm:p-12 lg:p-16">
              <div className="absolute -left-20 -top-24 h-72 w-72 rounded-full bg-[#ff2da8]/15 blur-3xl" aria-hidden="true" />
              <div className="absolute -bottom-24 right-0 h-72 w-72 rounded-full bg-[#37d7f5]/10 blur-3xl" aria-hidden="true" />
              <div className="relative grid items-center gap-10 lg:grid-cols-[1fr_auto]">
                <div className="text-right">
                  <div className="eyebrow mb-5">The one to remember</div>
                  <h2 id="catch-title" className="font-arabic text-3xl font-semibold text-[#f6f1f8] sm:text-4xl">صِدها لي</h2>
                  <p className="mt-2 font-display text-xs uppercase tracking-[.2em] text-[#37d7f5]">“Find it for me”</p>
                  <p className="mt-6 max-w-xl font-arabic text-sm leading-8 text-[#b8b3c0]">ميزة لُقطة التي تقول فيها ما تريد كما تقوله لصديق. اكتب، صف، أو شارك صورة — وسنساعدك على بدء رحلة البحث بشكل أذكى.</p>
                </div>
                <div className="flex justify-end">
                  <div className="grid h-32 w-32 place-items-center rounded-full border border-white/15 bg-[#09090d]/30">
                    <div className="grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-[#ff2da8] to-[#9e4bff] shadow-[0_12px_40px_rgba(255,45,168,.25)]">
                      <Camera size={28} className="text-white" aria-hidden="true" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="affiliate-disclosure" className="border-y border-white/[.06] bg-[#0c0c12] py-16" aria-labelledby="disclosure-title">
          <div className="container-luqta grid gap-8 lg:grid-cols-[.7fr_1.3fr] lg:items-start">
            <div className="text-right">
              <div className="eyebrow mb-4">A clear note</div>
              <h2 id="disclosure-title" className="font-arabic text-2xl font-semibold text-[#f6f1f8]">إفصاح التسويق بالعمولة</h2>
              <p className="mt-2 font-display text-xs uppercase tracking-[.18em] text-[#777381]">Affiliate disclosure</p>
            </div>
            <div className="glass rounded-2xl p-6 text-right sm:p-8">
              <p className="font-arabic text-sm leading-8 text-[#b8b3c0]">قد تتضمن بعض زيارات المتاجر عبر لُقطة روابط تابعة. إذا أتممت شراءً من متجر مشارك بعد الانتقال من لُقطة، قد نحصل على عمولة دون تكلفة إضافية عليك.</p>
              <p className="mt-4 font-arabic text-sm leading-8 text-[#b8b3c0]">لُقطة لا تدّعي وجود شراكات مع Amazon أو NEXT أو Noon أو Rakuten أو أي متجر آخر. لا نعرض شعارات المتاجر، ولا نعد بتوفر منتج أو سعر أو نتيجة شراء.</p>
              <div className="mt-6 flex items-start gap-3 border-t border-white/10 pt-5">
                <ShieldCheck size={18} className="mt-1 shrink-0 text-[#72e1b3]" aria-hidden="true" />
                <p className="font-arabic text-xs leading-7 text-[#9d9aa8]">المتجر الذي تزوره هو المسؤول عن تفاصيل المنتج، الدفع، الشحن، الإرجاع، وخدمة العملاء.</p>
              </div>
            </div>
          </div>
        </section>

        <section id="coming-soon" className="section-pad relative overflow-hidden bg-[#09090d]" aria-labelledby="coming-title">
          <div className="container-luqta max-w-4xl text-center">
            <span className="mx-auto mb-7 grid h-14 w-14 place-items-center rounded-2xl border border-[#37d7f5]/25 bg-[#37d7f5]/10 text-[#37d7f5]"><Compass size={24} aria-hidden="true" /></span>
            <div className="eyebrow">04 — In the making</div>
            <h2 id="coming-title" className="mt-4 font-arabic text-4xl font-semibold leading-[1.5] text-[#f6f1f8] sm:text-5xl">قريباً، لُقطة أقرب لك</h2>
            <p className="mt-3 font-display text-sm uppercase tracking-[.22em] text-[#777381]">Coming soon</p>
            <p className="mx-auto mt-7 max-w-xl font-arabic text-sm leading-8 text-[#9d9aa8]">التطبيق قيد التطوير. نعمل على تجربة بحث واكتشاف موثوقة وواضحة، وسنشارك تفاصيل الإطلاق عندما تصبح جاهزة.</p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <a href="#contact" className="focus-ring inline-flex items-center gap-3 rounded-full bg-[#f6f1f8] px-6 py-3.5 font-arabic text-sm font-semibold text-[#09090d] transition-transform hover:-translate-y-0.5" data-testid="link-contact-coming">تابع أخبار لُقطة <ArrowLeft size={17} /></a>
              <span className="font-arabic text-xs text-[#777381]">لا تسجيل ولا وعود مبكرة — فقط وضوح</span>
            </div>
          </div>
        </section>

        <section id="contact" className="border-t border-white/[.06] bg-[#0c0c12] py-20" aria-labelledby="contact-title">
          <div className="container-luqta grid gap-10 md:grid-cols-[1fr_auto] md:items-end">
            <div className="text-right">
              <div className="eyebrow mb-4">Contact · Stay in touch</div>
              <h2 id="contact-title" className="font-arabic text-3xl font-semibold text-[#f6f1f8]">لديك سؤال عن لُقطة؟</h2>
              <p className="mt-3 max-w-xl font-arabic text-sm leading-8 text-[#9d9aa8]">قناة التواصل الرسمية ستُعلن مع اقتراب الإطلاق. حتى ذلك الوقت، هذا المكان مخصص لاستقبال استفسارات الشراكات والمراجعة.</p>
            </div>
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#111119] px-5 py-4 text-right">
              <Mail size={20} className="text-[#37d7f5]" aria-hidden="true" />
              <div><div className="font-arabic text-xs text-[#f6f1f8]">قناة التواصل</div><div className="font-display text-[.62rem] uppercase tracking-wider text-[#777381]">Will be announced soon</div></div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/[.06] bg-[#09090d] py-9">
      <div className="container-luqta flex flex-col gap-7 sm:flex-row sm:items-center sm:justify-between">
        <a href="#top" className="focus-ring flex items-center gap-3 rounded-xl" data-testid="link-footer-logo"><img src={logoImage} alt="شعار لُقطة" width="32" height="32" className="h-8 w-8 rounded-[10px]" /><span className="font-arabic text-sm text-[#f6f1f8]">لُقطة</span></a>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-right">
          <Link href="/privacy" className="focus-ring rounded text-xs text-[#9d9aa8] hover:text-[#f6f1f8]" data-testid="link-footer-privacy">سياسة الخصوصية <span className="mr-1 text-[.6rem] text-[#777381]">Privacy</span></Link>
          <Link href="/terms" className="focus-ring rounded text-xs text-[#9d9aa8] hover:text-[#f6f1f8]" data-testid="link-footer-terms">شروط الاستخدام <span className="mr-1 text-[.6rem] text-[#777381]">Terms</span></Link>
          <Link href="/ops/providers" className="focus-ring rounded text-xs text-[#9d9aa8] hover:text-[#f6f1f8]" data-testid="link-footer-provider-health">صحة المزوّدين <span className="mr-1 text-[.6rem] text-[#777381]">Provider health</span></Link>
          <span className="font-display text-[.62rem] tracking-wider text-[#55535d]">© {new Date().getFullYear()} LUQTA</span>
        </div>
      </div>
    </footer>
  );
}

function LegalPage({ kind }: { kind: 'privacy' | 'terms' }) {
  const privacy = kind === 'privacy';
  const title = privacy ? 'سياسة الخصوصية | لُقطة' : 'شروط الاستخدام | لُقطة';
  const description = privacy ? 'سياسة الخصوصية الخاصة بموقع وتطبيق لُقطة.' : 'شروط استخدام موقع وتطبيق لُقطة.';
  return (
    <div className="site-shell min-h-screen bg-[#09090d]" dir="rtl">
      <Seo title={title} description={description} />
      <header className="border-b border-white/[.06]">
        <div className="container-luqta flex h-[84px] items-center justify-between">
          <Link href="/" className="focus-ring flex items-center gap-3 rounded-xl" data-testid="link-legal-logo"><img src={logoImage} alt="شعار لُقطة" width="44" height="44" className="h-11 w-11 rounded-[14px]" /><span className="font-arabic text-lg text-[#f6f1f8]">لُقطة</span></Link>
          <Link href="/" className="focus-ring flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 font-arabic text-xs text-[#b8b3c0] hover:border-[#37d7f5]/50 hover:text-[#f6f1f8]" data-testid="link-back-home"><ArrowRightIcon /> العودة للرئيسية</Link>
        </div>
      </header>
      <main className="container-luqta max-w-3xl py-20 sm:py-28">
        <div className="eyebrow mb-5">{privacy ? 'Privacy, plainly stated' : 'Simple terms, clear expectations'}</div>
        <h1 className="font-arabic text-3xl font-semibold leading-[1.6] text-[#f6f1f8] sm:text-5xl">{privacy ? 'سياسة الخصوصية' : 'شروط الاستخدام'}</h1>
        <p className="mt-3 font-display text-xs uppercase tracking-[.18em] text-[#777381]">{privacy ? 'Privacy policy' : 'Terms of use'} · آخر تحديث: قيد الإعداد</p>
        <div className="legal-copy mt-12 border-t border-white/10 pt-8">
          {privacy ? <PrivacyContent /> : <TermsContent />}
        </div>
      </main>
      <Footer />
    </div>
  );
}

function ArrowRightIcon() {
  return <ArrowLeft size={16} aria-hidden="true" />;
}

function PrivacyContent() {
  return <div className="font-arabic text-sm">
    <p>نحن نبني لُقطة كخدمة بحث واكتشاف للمنتجات، ونؤمن أن الوضوح جزء من التجربة. هذه الصفحة تشرح باختصار كيف نتعامل مع المعلومات عند زيارة الموقع أو استخدام التطبيق عندما يصبح متاحاً.</p>
    <h2>ما الذي تجمعه لُقطة؟</h2>
    <p>هذا الموقع العام لا يطلب إنشاء حساب ولا يعالج عمليات شراء. قد تتلقى لُقطة معلومات تقدمها طوعاً عبر قنوات التواصل الرسمية عند تفعيلها. عند إطلاق التطبيق، سنوضح أي بيانات لازمة للتجربة، وسبب استخدامها، ومدة الاحتفاظ بها قبل طلبها.</p>
    <h2>البحث والروابط الخارجية</h2>
    <p>تساعد لُقطة على اكتشاف المنتجات وقد تنقلك إلى مواقع متاجر خارجية. عند مغادرة لُقطة، تخضع زيارتك لسياسة الخصوصية وشروط الموقع الخارجي. لا تتحكم لُقطة في البيانات التي يجمعها أي متجر.</p>
    <h2>الكوكيز والتحليلات</h2>
    <p>لا نضيف حالياً أدوات تتبع تسويقية أو خدمات مدفوعة لهذا الموقع. قد تتغير هذه الممارسة مستقبلاً، وفي هذه الحالة سنحدّث هذه السياسة بوضوح قبل التغيير ذي الصلة.</p>
    <h2>تحديثات السياسة</h2>
    <p>قد نحدّث هذه السياسة مع تطور الخدمة. سيظهر تاريخ التحديث أعلى الصفحة، ونشجعك على مراجعتها عند العودة إلى الموقع.</p>
    <h2>التواصل</h2>
    <p>قناة التواصل الرسمية قيد الإعداد وستُعلن هنا عند جاهزيتها. لا تستخدم أي عنوان غير منشور على موقع لُقطة لطلب دعم أو مشاركة معلومات حساسة.</p>
  </div>;
}

function TermsContent() {
  return <div className="font-arabic text-sm">
    <p>باستخدام موقع لُقطة، تقرأ وتوافق على هذه الشروط. لُقطة حالياً موقع تعريفي عام لتطبيق سعودي قيد التطوير، وليست متجراً أو بائعاً أو جهة شحن.</p>
    <h2>ما تقدمه لُقطة</h2>
    <p>تساعد لُقطة الناس على البحث واكتشاف المنتجات عبر المتاجر الإلكترونية باستخدام النص أو الصور، ومقارنة الخيارات ذات الصلة، ثم زيارة المتجر لإكمال الشراء. النتائج والمعلومات قد تتغير، ولا تمثل ضماناً للتوفر أو الملاءمة أو السعر.</p>
    <h2>مسؤولية المتجر</h2>
    <p>المتجر الذي تختاره مسؤول عن المنتج، السعر، الدفع، الشحن، الإرجاع، الضمان، وخدمة العملاء. تتم عمليات الشراء والدفع خارج لُقطة، ولا تستلم لُقطة أموال المشتريات ولا تدير طلباتك.</p>
    <h2>العلاقات التجارية والإفصاح</h2>
    <p>قد تستخدم لُقطة روابط تابعة، وقد تحصل على عمولة دون تكلفة إضافية عليك. لا تدّعي لُقطة شراكات مع Amazon أو NEXT أو Noon أو Rakuten أو أي متجر آخر، ولا تستخدم شعاراتهم على هذا الموقع.</p>
    <h2>الاستخدام المقبول</h2>
    <p>تلتزم باستخدام الموقع لأغراض مشروعة وعدم محاولة تعطيل الخدمة أو نسخ محتواها بطريقة تضر بها أو بالمستخدمين. نحتفظ بحق تحديث المحتوى أو إيقاف أجزاء من الموقع أثناء تطوير التطبيق.</p>
    <h2>التحديثات</h2>
    <p>قد تتغير هذه الشروط مع إطلاق ميزات جديدة. استمرارك في استخدام الموقع بعد نشر تحديث يعني اطلاعك على النسخة الجديدة.</p>
  </div>;
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/privacy"><LegalPage kind="privacy" /></Route>
        <Route path="/terms"><LegalPage kind="terms" /></Route>
        <Route path="/ops/providers" component={ProviderHealthPage} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;