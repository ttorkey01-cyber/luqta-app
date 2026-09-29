import { performance } from "node:perf_hooks";
import { ProviderRegistry } from "../../../connectors/providerRegistry";
import { SearchOrchestrator } from "../../../connectors/searchOrchestrator";
import { normalizeArabicForSearch } from "../../../connectors/queryExpansion";
import type {
  ProviderProduct,
  ProviderSearchRequest,
  ProviderMetadata,
  SearchProvider,
} from "../../../connectors/types";
import { ExperimentalSearchV3 } from "../index";

const metadata: ProviderMetadata = {
  id: "offline-evaluation-catalog",
  name: "Offline evaluation catalog",
  enabled: true,
  searchEnabled: true,
  affiliateEnabled: false,
  priceMonitoringAllowed: false,
  visualSearchAllowed: false,
  country: "SA",
  currency: "SAR",
  // V2 explicitly excludes mock_local providers from its search pool.
  // This test-only feed descriptor keeps the in-memory provider eligible.
  integrationType: "affiliate_feed",
  requiresCredentials: false,
  credentialRequirements: [],
  priority: 1,
  lastSuccessfulSync: null,
  affiliateCapability: "not_applicable",
  priceMonitoringCapability: "disabled",
  integrationStatus: "ready",
};

type FixtureProduct = ProviderProduct & { searchTerms: string[]; model?: string };

function fixture(
  id: string,
  title: string,
  fields: Partial<ProviderProduct> & { model?: string } = {},
  searchTerms: string[] = [],
): FixtureProduct {
  return {
    id,
    title,
    currency: "SAR",
    merchant: "Offline catalog",
    availability: "in_stock",
    sourceType: "affiliate_feed",
    ...fields,
    searchTerms,
  };
}

/** Fixed, synthetic catalog entries; no network-backed provider is used. */
export const EVALUATION_CATALOG: FixtureProduct[] = [
  fixture("linen-shirt-men", "Men's Linen Shirt", { category: "fashion", audience: "men", color: "white", price: 149 }, ["قميص كتان رجالي"]),
  fixture("coach-tabby-black", "Coach Tabby Shoulder Bag", { brand: "Coach", model: "Tabby", category: "bags_accessories", color: "black", price: 1299 }, ["شنطة كوتش تاببي سوداء"]),
  fixture("coach-tabby-blue", "Coach Tabby Shoulder Bag", { brand: "Coach", model: "Tabby", category: "bags_accessories", color: "blue", price: 1349 }, ["شنطة كوتش تاببي زرقاء"]),
  fixture("coach-tabby-red", "Coach Tabby Shoulder Bag", { brand: "Coach", model: "Tabby", category: "bags_accessories", color: "red", price: 1329 }),
  fixture("coach-tote-black", "Coach Leather Tote Bag", { brand: "Coach", category: "bags_accessories", color: "black", price: 899 }),
  fixture("nike-air-force-white", "Nike Air Force 1 '07", { brand: "Nike", model: "Air Force 1", category: "shoes", color: "white", price: 449 }, ["حذاء نايك اير فورس ابيض"]),
  fixture("nike-dunk-low-white", "Nike Dunk Low Retro White", { brand: "Nike", model: "Dunk Low", category: "shoes", color: "white", price: 479 }),
  fixture("adidas-samba-white", "Adidas Samba OG", { brand: "Adidas", model: "Samba OG", category: "shoes", color: "white", price: 399 }),
  fixture("guess-w0999-black", "Guess W0999G1 Black Stainless Steel Watch", { brand: "Guess", model: "W0999G1", category: "watches_jewelry", color: "black", price: 575 }, ["ساعة جيس سوداء"]),
  fixture("guess-watch-gold", "Guess Gold Tone Quartz Watch", { brand: "Guess", category: "watches_jewelry", color: "gold", price: 520 }),
  fixture("dior-sauvage-100", "Dior Sauvage Eau de Parfum 100ml", { brand: "Dior", model: "Sauvage", category: "beauty_care", price: 589 }, ["عطر ديور سوفاج رجالي"]),
  fixture("lancome-idole-50", "Lancôme Idôle Eau de Parfum 50ml", { brand: "Lancôme", model: "Idôle", category: "beauty_care", price: 420 }, ["عطر لانكوم ايدول نسائي"]),
  fixture("sony-wh1000xm5", "Sony WH-1000XM5 Wireless Noise Cancelling Headphones", { brand: "Sony", model: "WH-1000XM5", category: "electronics", color: "black", price: 1299 }, ["سماعات سوني لاسلكية"]),
  fixture("sony-wh1000xm5-cheaper", "Sony WH-1000XM5 Wireless Noise Cancelling Headphones", { brand: "Sony", model: "WH-1000XM5", category: "electronics", color: "black", price: 1099, merchant: "Value Audio", productUrl: "https://offline-catalog.invalid/value-audio/sony-wh1000xm5" }),
  fixture("sony-whch720n", "Sony WH-CH720N Wireless Headphones", { brand: "Sony", model: "WH-CH720N", category: "electronics", color: "black", price: 399 }),
  fixture("toyota-camry-headlamp-2022", "Toyota Camry 2022 Right Headlamp OEM 81110-06D30", { brand: "Toyota", model: "Camry 2022", category: "automotive", price: 1150, condition: "new" }, ["شمعة امامية يمين كامري 2022 رقم قطعة 81110-06D30"]),
  fixture("toyota-camry-headlamp-used", "Used Toyota Camry 2022 Right Headlamp", { brand: "Toyota", model: "Camry 2022", category: "automotive", price: 480, condition: "used" }, ["شمعة كامري مستعملة"]),
  fixture("dyson-airwrap-complete-long", "Dyson Airwrap Complete Long Multi-Styler", { brand: "Dyson", model: "Airwrap Complete Long", category: "beauty_care", price: 2399 }, ["دايسون ايرراب كومبليت لونج"]),
  fixture("dyson-supersonic", "Dyson Supersonic Hair Dryer", { brand: "Dyson", model: "Supersonic", category: "beauty_care", price: 1799 }),
  fixture("canon-eos-r50-used", "Canon EOS R50 Mirrorless Camera Body", { brand: "Canon", model: "EOS R50", category: "electronics", color: "black", price: 2200, condition: "used", location: "Riyadh" }, ["كاميرا كانون مستعملة الرياض"]),
  fixture("canon-eos-r50-used-dammam-usd", "Used Canon EOS R50 Mirrorless Camera Body Dammam USD", { brand: "Canon", model: "EOS R50", category: "electronics", color: "black", price: 2100, currency: "USD", condition: "used", location: "Dammam", merchant: "Gulf Camera", productUrl: "https://offline-catalog.invalid/gulf-camera/canon-eos-r50-used" }),
  fixture("canon-eos-r50-new", "Canon EOS R50 Mirrorless Camera Kit", { brand: "Canon", model: "EOS R50", category: "electronics", color: "black", price: 3299, condition: "new", location: "Jeddah" }),
  fixture("iphone-15-pro-256", "Apple iPhone 15 Pro 256GB", { brand: "Apple", model: "iPhone 15 Pro", category: "electronics", color: "natural titanium", price: 3999 }, ["ايفون 15 برو 256"]),
  fixture("iphone-15-pro-128", "Apple iPhone 15 Pro 128GB", { brand: "Apple", model: "iPhone 15 Pro", category: "electronics", color: "blue titanium", price: 3599 }),
  fixture("iphone-15-case", "Clear Protective Case for iPhone 15 Pro", { category: "electronics", price: 49 }),
  fixture("black-evening-dress", "Women's Black Evening Dress", { category: "fashion", audience: "women", color: "black", price: 320 }, ["فستان سهرة اسود"]),
  fixture("blue-evening-dress", "Women's Blue Evening Dress", { category: "fashion", audience: "women", color: "blue", price: 310 }),
  fixture("breville-barista-express", "Breville Barista Express Espresso Machine", { brand: "Breville", category: "home_living", color: "stainless steel", price: 2499 }, ["ماكينة اسبريسو بريفيل"]),
  fixture("gucci-marmont-bag", "Gucci GG Marmont Small Shoulder Bag", { brand: "Gucci", model: "GG Marmont", category: "bags_accessories", color: "beige", price: 6999 }, ["شنطة غوتشي جي جي مارمونت"]),
  fixture("gucci-marmont-wallet", "Gucci GG Marmont Card Case", { brand: "Gucci", model: "GG Marmont", category: "bags_accessories", color: "black", price: 1799 }),
  fixture("puma-suede-classic", "Puma Suede Classic Sneakers", { brand: "Puma", category: "shoes", color: "black", price: 329 }),
  fixture("casio-a168", "Casio Vintage A168 Digital Watch", { brand: "Casio", model: "A168", category: "watches_jewelry", color: "silver", price: 189 }, ["ساعة كاسيو رقمية"]),
  fixture("zara-black-handbag", "Zara Black Shoulder Handbag", { brand: "Zara", category: "bags_accessories", color: "black", price: 199 }),
];

export type EvaluationCase = {
  id: string;
  scenario: string;
  query: string;
  /** V2 has no structured image-identity input; use a fixed text proxy for image-only cases. */
  v2Query?: string;
  image?: {
    identities: Array<{
      label: string;
      confidence: number;
      brand?: string;
      model?: string;
      sku?: string;
      color?: string;
    }>;
    description?: string;
    extractedText?: string;
  };
  relation?: "cheaper" | "different_color" | "similar";
  reference?: { price?: number; color?: string; brand?: string; model?: string };
  exactIds: string[];
  closeIds: string[];
  constraints?: {
    maxPrice?: number;
    minPrice?: number;
    color?: string;
    brand?: string;
    condition?: "new" | "used";
    location?: string;
    currency?: string;
  };
};

type ImageIdentity = {
  label: string;
  confidence: number;
  brand?: string;
  model?: string;
  sku?: string;
  color?: string;
};

const image = (
  label: string,
  confidence: number,
  details: Partial<ImageIdentity> = {},
) => [{ label, confidence, ...details }];

export const EVALUATION_CASES: EvaluationCase[] = [
  { id: "fashion-linen-en", scenario: "fashion; English", query: "men's linen shirt", exactIds: ["linen-shirt-men"], closeIds: [] },
  { id: "handbag-black", scenario: "handbag; color", query: "black Coach Tabby handbag", exactIds: ["coach-tabby-black"], closeIds: ["coach-tote-black"], constraints: { color: "black", brand: "Coach" } },
  { id: "shoes-brand-model", scenario: "shoes; exact brand/model", query: "Nike Air Force 1 white shoes", exactIds: ["nike-air-force-white"], closeIds: ["adidas-samba-white"] },
  { id: "watch-model", scenario: "watch; model", query: "Guess W0999G1 black watch", exactIds: ["guess-w0999-black"], closeIds: ["guess-watch-gold"] },
  { id: "beauty-arabic", scenario: "beauty; Arabic", query: "أبغى عطر ديور سوفاج", exactIds: ["dior-sauvage-100"], closeIds: ["lancome-idole-50"] },
  { id: "electronics-headphones", scenario: "electronics", query: "Sony WH-1000XM5 headphones", exactIds: ["sony-wh1000xm5", "sony-wh1000xm5-cheaper"], closeIds: ["sony-whch720n"] },
  { id: "automotive-part", scenario: "automotive; SKU/part number", query: "Toyota Camry 2022 right headlamp 81110-06D30", exactIds: ["toyota-camry-headlamp-2022"], closeIds: ["toyota-camry-headlamp-used"] },
  { id: "arabic-natural-query", scenario: "Arabic natural-language query", query: "أبي حذاء نايك اير فورس أبيض", exactIds: ["nike-air-force-white"], closeIds: ["adidas-samba-white"] },
  { id: "english-natural-query", scenario: "English natural-language query", query: "Find me a Breville espresso coffee machine", exactIds: ["breville-barista-express"], closeIds: [] },
  { id: "image-only", scenario: "image-only identity", query: "", v2Query: "Gucci GG Marmont small shoulder bag", image: { identities: image("shoulder bag", 0.96, { brand: "Gucci", model: "GG Marmont" }), description: "Small quilted luxury shoulder bag with chain strap" }, exactIds: ["gucci-marmont-bag"], closeIds: ["gucci-marmont-wallet"] },
  { id: "image-plus-text", scenario: "image + text", query: "find this in red", v2Query: "Coach Tabby red shoulder bag", image: { identities: image("handbag", 0.91, { brand: "Coach", model: "Tabby" }), description: "Structured shoulder bag with short handle" }, exactIds: [], closeIds: ["coach-tabby-red"] },
  { id: "exact-brand-model", scenario: "exact brand/model", query: "Dyson Airwrap Complete Long", exactIds: ["dyson-airwrap-complete-long"], closeIds: ["dyson-supersonic"] },
  { id: "exact-sku", scenario: "exact SKU/model number", query: "81110-06D30", exactIds: ["toyota-camry-headlamp-2022"], closeIds: ["toyota-camry-headlamp-used"] },
  { id: "maximum-price", scenario: "maximum price", query: "Sony headphones under 500 SAR", exactIds: ["sony-whch720n"], closeIds: [], constraints: { maxPrice: 500 } },
  { id: "price-range", scenario: "price range", query: "Casio watch between 100 and 250 SAR", exactIds: ["casio-a168"], closeIds: [], constraints: { minPrice: 100, maxPrice: 250 } },
  { id: "different-color", scenario: "different requested color", query: "same Coach Tabby bag but blue", relation: "different_color", reference: { brand: "Coach", model: "Tabby", color: "black" }, exactIds: ["coach-tabby-blue"], closeIds: [], constraints: { color: "blue", brand: "Coach" } },
  { id: "used-condition-location", scenario: "used condition; location", query: "used Canon EOS R50 camera in Riyadh", exactIds: ["canon-eos-r50-used"], closeIds: [], constraints: { condition: "used", location: "Riyadh", currency: "SAR" } },
  { id: "strict-location-currency", scenario: "strict location and currency", query: "used Canon EOS R50 camera in Riyadh SAR", exactIds: ["canon-eos-r50-used"], closeIds: [], constraints: { condition: "used", location: "Riyadh", currency: "SAR" } },
  { id: "new-condition", scenario: "new condition", query: "new Toyota Camry 2022 right headlamp", exactIds: ["toyota-camry-headlamp-2022"], closeIds: [], constraints: { condition: "new" } },
  { id: "complex-image-background", scenario: "complex image background", query: "black handbag", image: { identities: image("black handbag", 0.63), description: "Black leather shoulder bag partially obscured in a busy street scene" }, exactIds: ["coach-tabby-black", "coach-tote-black"], closeIds: ["zara-black-handbag"] },
  { id: "ambiguous-image", scenario: "ambiguous image", query: "", v2Query: "Guess watch Casio A168 silver", image: { identities: [...image("silver digital watch", 0.54, { brand: "Casio", model: "A168" }), ...image("gold fashion watch", 0.46, { brand: "Guess" })], description: "Wrist accessory partly covered; dial details unclear" }, exactIds: [], closeIds: ["casio-a168", "guess-watch-gold"] },
  { id: "same-product-cheaper", scenario: "same product but cheaper", query: "same Sony WH-1000XM5 headphones but cheaper than 1299 SAR", v2Query: "Sony WH-1000XM5 headphones cheaper than 1299 SAR", relation: "cheaper", reference: { brand: "Sony", model: "WH-1000XM5", price: 1299 }, image: { identities: image("wireless headphones", 0.87, { brand: "Sony", model: "WH-1000XM5" }) }, exactIds: ["sony-wh1000xm5-cheaper"], closeIds: [] },
  { id: "visually-similar-alternative", scenario: "visually similar alternative", query: "sneakers visually similar to Nike Air Force 1", relation: "similar", reference: { brand: "Nike", model: "Air Force 1", color: "white" }, image: { identities: image("white low-top sneaker", 0.8, { brand: "Nike", model: "Air Force 1", color: "white" }) }, exactIds: [], closeIds: ["nike-dunk-low-white"] },
  { id: "strict-black-color", scenario: "strict color constraint", query: "women's black evening dress", exactIds: ["black-evening-dress"], closeIds: [], constraints: { color: "black" } },
  { id: "arabic-price-condition", scenario: "Arabic; price and used condition", query: "شمعة كامري 2022 مستعملة أقل من 500 ريال", exactIds: ["toyota-camry-headlamp-used"], closeIds: [], constraints: { maxPrice: 500, condition: "used" } },
];

export type SearchRow = {
  ids: string[];
  latencyMs: number;
  diagnosticLatencyMs?: number;
  providerCalls: number;
  externalApiCalls: number;
  diagnosticProviderInvocationCount: number;
  legacyDiagnosticCallCount: number;
  constraintCompliant: boolean;
};

export type MetricSummary = {
  cases: number;
  top1: number;
  top3: number;
  top5: number;
  exactMatch: number;
  closeMatch: number;
  constraintCompliance: number;
  irrelevantResultRate: number;
  latencyMs: { mean: number; p50: number; p95: number };
  diagnosticLatencyMs: { mean: number; p50: number; p95: number } | null;
  braveCalls: number;
  apiCalls: number;
  providerCalls: number;
  diagnosticProviderInvocationCount: number;
  legacyDiagnosticCallCount: number;
};

export type EvaluationReport = {
  limitations: string[];
  v2: MetricSummary;
  v3: MetricSummary;
  cases: Array<{
    id: string;
    scenario: string;
    v2: SearchRow;
    v3: SearchRow;
  }>;
};

function searchableText(product: FixtureProduct): string {
  const fields = [
    product.id,
    product.title,
    product.description,
    product.brand,
    product.model,
    product.color,
    product.location,
    product.currency,
    ...product.searchTerms,
  ];
  return normalizeArabicForSearch(fields.filter(Boolean).join(" "));
}

function makeOfflineRegistry(): { registry: ProviderRegistry; getCalls: () => number } {
  let calls = 0;
  const catalogText = new Map(EVALUATION_CATALOG.map((item) => [item.id, searchableText(item)]));
  const provider: SearchProvider = {
    metadata,
    async search(request: ProviderSearchRequest) {
      calls += 1;
      const terms = normalizeArabicForSearch(request.query)
        .split(/\s+/u)
        .filter((term) => term.length > 1 && !/^(?:the|and|for|with|find|me|this|same|but|under|between|from|in|a|an|to|of|ريال|sar)$/u.test(term));
      if (terms.length === 0) return [];
      return EVALUATION_CATALOG
        .map((item) => ({
          item,
          overlap: terms.filter((term) => catalogText.get(item.id)?.includes(term)).length,
        }))
        .filter(({ overlap }) => overlap > 0)
        .sort((a, b) => b.overlap - a.overlap || a.item.id.localeCompare(b.item.id))
        .map(({ item }) => {
          const { searchTerms: _searchTerms, ...product } = item;
          return product;
        });
    },
  };
  return { registry: new ProviderRegistry([provider]), getCalls: () => calls };
}

function percent(successes: number, cases: number): number {
  return cases ? Number((successes / cases).toFixed(4)) : 0;
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  return Number(ordered[Math.ceil(fraction * ordered.length) - 1]!.toFixed(2));
}

function obeysConstraints(product: FixtureProduct | undefined, constraints: EvaluationCase["constraints"]): boolean {
  if (!constraints) return true;
  if (!product) return false;
  if (constraints.maxPrice !== undefined && (product.price == null || product.price > constraints.maxPrice)) return false;
  if (constraints.minPrice !== undefined && (product.price == null || product.price < constraints.minPrice)) return false;
  if (constraints.color && normalizeArabicForSearch(product.color ?? "") !== normalizeArabicForSearch(constraints.color)) return false;
  if (constraints.brand && normalizeArabicForSearch(product.brand ?? "") !== normalizeArabicForSearch(constraints.brand)) return false;
  if (constraints.condition && product.condition !== constraints.condition) return false;
  if (constraints.location && normalizeArabicForSearch(product.location ?? "") !== normalizeArabicForSearch(constraints.location)) return false;
  if (constraints.currency && normalizeArabicForSearch(product.currency ?? "") !== normalizeArabicForSearch(constraints.currency)) return false;
  return true;
}

export function evaluationResultComplies(ids: string[], constraints?: EvaluationCase["constraints"]): boolean {
  if (!constraints) return true;
  return ids.length > 0 && ids.slice(0, 5).every((id) =>
    obeysConstraints(EVALUATION_CATALOG.find((product) => product.id === id), constraints),
  );
}

function summarize(cases: EvaluationCase[], rows: SearchRow[]): MetricSummary {
  let top1 = 0;
  let top3 = 0;
  let top5 = 0;
  let exact = 0;
  let close = 0;
  let compliant = 0;
  let irrelevant = 0;
  let returned = 0;

  cases.forEach((item, index) => {
    const ids = rows[index]!.ids;
    const relevant = new Set([...item.exactIds, ...item.closeIds]);
    if (ids.slice(0, 1).some((id) => relevant.has(id))) top1 += 1;
    if (ids.slice(0, 3).some((id) => relevant.has(id))) top3 += 1;
    if (ids.slice(0, 5).some((id) => relevant.has(id))) top5 += 1;
    if (item.exactIds.length > 0 && ids[0] && item.exactIds.includes(ids[0])) exact += 1;
    if (ids.slice(0, 3).some((id) => item.closeIds.includes(id))) close += 1;
    if (rows[index]!.constraintCompliant) compliant += 1;
    for (const id of ids.slice(0, 5)) {
      returned += 1;
      if (!relevant.has(id)) irrelevant += 1;
    }
  });

  const latencies = rows.map((row) => row.latencyMs);
  const diagnosticLatencies = rows
    .map((row) => row.diagnosticLatencyMs)
    .filter((value): value is number => value !== undefined);
  const summarizeLatency = (values: number[]) => ({
    mean: Number((values.reduce((sum, value) => sum + value, 0) / (values.length || 1)).toFixed(2)),
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
  });
  return {
    cases: cases.length,
    top1: percent(top1, cases.length),
    top3: percent(top3, cases.length),
    top5: percent(top5, cases.length),
    exactMatch: percent(exact, cases.length),
    closeMatch: percent(close, cases.length),
    constraintCompliance: percent(compliant, cases.length),
    irrelevantResultRate: percent(irrelevant, returned),
    latencyMs: summarizeLatency(latencies),
    diagnosticLatencyMs: diagnosticLatencies.length ? summarizeLatency(diagnosticLatencies) : null,
    braveCalls: 0,
    apiCalls: rows.reduce((sum, row) => sum + row.externalApiCalls, 0),
    providerCalls: rows.reduce((sum, row) => sum + row.providerCalls, 0),
    diagnosticProviderInvocationCount: rows.reduce((sum, row) => sum + row.diagnosticProviderInvocationCount, 0),
    legacyDiagnosticCallCount: rows.reduce((sum, row) => sum + row.legacyDiagnosticCallCount, 0),
  };
}

export async function evaluateSearchV3(): Promise<EvaluationReport> {
  const v2Offline = makeOfflineRegistry();
  const v3Offline = makeOfflineRegistry();
  const v2 = new SearchOrchestrator(v2Offline.registry);
  const v3 = new ExperimentalSearchV3({ registry: v3Offline.registry, enabled: true });
  const pairs: EvaluationReport["cases"] = [];
  const v2Rows: SearchRow[] = [];
  const v3Rows: SearchRow[] = [];

  for (const item of EVALUATION_CASES) {
    const v2CallsBefore = v2Offline.getCalls();
    const v2Start = performance.now();
    const v2Results = await v2.search({ query: item.v2Query ?? item.query });
    const v2Elapsed = performance.now() - v2Start;
    const v2Row: SearchRow = {
      ids: v2Results.map((product) => product.id),
      latencyMs: Number(v2Elapsed.toFixed(2)),
      providerCalls: v2Offline.getCalls() - v2CallsBefore,
      externalApiCalls: 0,
      diagnosticProviderInvocationCount: 0,
      legacyDiagnosticCallCount: 0,
      constraintCompliant: evaluationResultComplies(
        v2Results.map((product) => product.id),
        item.constraints,
      ),
    };

    const callsBefore = v3Offline.getCalls();
    const v3Start = performance.now();
    const v3Result = await v3.search({
      query: item.query,
      ...(item.image ? { image: item.image } : {}),
      ...(item.relation ? { relation: item.relation } : {}),
      ...(item.reference ? { reference: item.reference } : {}),
    });
    const v3Elapsed = performance.now() - v3Start;
    const diagnostics = v3Result.diagnostics as unknown as Record<string, unknown>;
    const reportedLatency = diagnostics.totalLatencyMs;
    const actualProviderCalls = v3Offline.getCalls() - callsBefore;
    const diagnosticProviderCalls = diagnostics.providerInvocationCount;
    const legacyDiagnosticCalls = diagnostics.externalApiCallCount;
    // Older V3 diagnostics counted every provider.search invocation as an
    // "external" API call. Only trust externalApiCallCount as external when
    // the newer providerInvocationCount field distinguishes local calls.
    const externalApiCalls =
      typeof diagnosticProviderCalls === "number" &&
      typeof legacyDiagnosticCalls === "number"
        ? legacyDiagnosticCalls
        : 0;
    const ids = v3Result.products.map(({ product }) => product.id);
    const v3Row: SearchRow = {
      ids,
      latencyMs: Number(v3Elapsed.toFixed(2)),
      diagnosticLatencyMs: typeof reportedLatency === "number" ? reportedLatency : undefined,
      providerCalls: actualProviderCalls,
      externalApiCalls,
      diagnosticProviderInvocationCount:
        typeof diagnosticProviderCalls === "number"
          ? diagnosticProviderCalls
          : actualProviderCalls,
      legacyDiagnosticCallCount:
        typeof diagnosticProviderCalls !== "number" &&
        typeof legacyDiagnosticCalls === "number"
          ? legacyDiagnosticCalls
          : 0,
      constraintCompliant: evaluationResultComplies(ids, item.constraints),
    };
    v2Rows.push(v2Row);
    v3Rows.push(v3Row);
    pairs.push({ id: item.id, scenario: item.scenario, v2: v2Row, v3: v3Row });
  }

  return {
    limitations: [
      "All provider results come from the same deterministic in-memory synthetic catalog; results do not represent production feeds.",
      "No Brave or other external APIs are configured, and no paid image-embedding service is called.",
      "Image cases are interpreted text descriptions and supplied identity hypotheses, not pixel-level image-similarity tests.",
      "V2 receives a fixed text proxy for image-only cases because its search API does not accept structured image identities.",
      "Both V2 and V3 wall-clock latency use performance.now(); V3's own millisecond totalLatencyMs diagnostic is reported separately.",
      "Constraint compliance is measured over returned top-five results; unknown required values do not count as compliant.",
      "No measured visual result is based on image pixels; there is no Brave, network, or paid embedding traffic.",
      "Fixture-level score differences do not prove V3 superiority and are not production performance estimates.",
      "Legacy V3 externalApiCallCount is separately retained when providerInvocationCount is unavailable because older diagnostics counted local catalog calls as external.",
    ],
    v2: summarize(EVALUATION_CASES, v2Rows),
    v3: summarize(EVALUATION_CASES, v3Rows),
    cases: pairs,
  };
}

export function renderEvaluationMarkdown(report: EvaluationReport): string {
  const format = (metrics: MetricSummary) =>
    `| ${metrics.top1} | ${metrics.top3} | ${metrics.top5} | ${metrics.exactMatch} | ${metrics.closeMatch} | ${metrics.constraintCompliance} | ${metrics.irrelevantResultRate} | ${metrics.latencyMs.mean} | ${metrics.diagnosticLatencyMs?.mean ?? "n/a"} | ${metrics.braveCalls}/${metrics.apiCalls} | ${metrics.providerCalls} | ${metrics.diagnosticProviderInvocationCount} | ${metrics.legacyDiagnosticCallCount} |`;
  return [
    "# Search V2 vs V3 offline evaluation",
    "",
    "Rates are fractions from 0 to 1; latencies are milliseconds. Wall-clock values for both versions use performance.now().",
    "",
    "| Version | Top-1 | Top-3 | Top-5 | Exact | Close | Constraint compliance | Irrelevant result rate | Mean wall latency ms | V3 diagnostic latency ms | Brave/API calls | In-memory provider calls | Diagnostic provider invocations | Legacy V3 diagnostic count |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    `| V2 | ${format(report.v2).slice(2, -1)} |`,
    `| V3 | ${format(report.v3).slice(2, -1)} |`,
    "",
    "## Per-case result IDs",
    "",
    "| Case | Scenario | V2 top-5 IDs | V3 top-5 IDs | V2 constraints | V3 constraints | V2/V3 wall ms |",
    "| --- | --- | --- | --- | --- | --- | ---: |",
    ...report.cases.map((item) => `| ${item.id} | ${item.scenario} | ${item.v2.ids.slice(0, 5).join(", ") || "—"} | ${item.v3.ids.slice(0, 5).join(", ") || "—"} | ${item.v2.constraintCompliant} | ${item.v3.constraintCompliant} | ${item.v2.latencyMs}/${item.v3.latencyMs} |`),
    "",
    "## Limitations",
    "",
    ...report.limitations.map((limitation) => `- ${limitation}`),
    "",
  ].join("\n");
}