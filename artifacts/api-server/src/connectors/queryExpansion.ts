const ARABIC_DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/gu;
const MAX_SEARCH_VARIANTS = 6;
const ARABIC_SCRIPT = /[\u0600-\u06ff]/u;

type VocabularyKind =
  | "product"
  | "gender"
  | "color"
  | "attribute"
  | "brand"
  | "model";

type VocabularyEntry = {
  arabic: string[];
  english: string[];
  kind: VocabularyKind;
  contextualAliases?: string[];
};

const SHOPPING_VOCABULARY: VocabularyEntry[] = [
  { arabic: ["نظارة شمسية", "نظارات شمسية"], english: ["sunglasses"], kind: "product" },
  { arabic: ["تيشيرت", "تي شيرت", "تشيرت"], english: ["t-shirt", "tshirt", "tee"], kind: "product" },
  { arabic: ["قطع غيار"], english: ["spare parts", "auto parts"], kind: "product" },
  { arabic: ["شمعة", "شمعه", "شمعات"], english: ["headlight", "headlamp"], kind: "product" },
  { arabic: ["اقل من"], english: ["under", "below", "less than"], kind: "attribute" },
  { arabic: ["جينز"], english: ["jeans", "denim", "jean"], kind: "product" },
  { arabic: ["شنطة", "شنطه", "حقيبة", "حقيبه", "شنط", "حقائب", "شنطة سفر", "حقيبة سفر"], english: ["handbag", "bag", "purse", "handbags", "bags", "suitcase", "luggage"], kind: "product" },
  { arabic: ["حذاء", "احذية", "أحذية", "جزم", "جزمة"], english: ["shoes", "shoe", "sneakers"], kind: "product" },
  { arabic: ["ساعة", "ساعه", "ساعات"], english: ["watch", "watches", "wristwatch", "wristwatches"], kind: "product" },
  { arabic: ["جاكيت", "جاكيتات"], english: ["jacket", "jackets"], kind: "product" },
  { arabic: ["فستان", "فساتين"], english: ["dress", "dresses"], kind: "product" },
  { arabic: ["قميص", "قمصان"], english: ["shirt", "shirts"], kind: "product" },
  { arabic: ["بنطلون", "بناطيل"], english: ["pants", "trousers"], kind: "product" },
  { arabic: ["عطر", "عطور"], english: ["perfume", "fragrance", "eau de toilette", "parfum", "cologne"], kind: "product" },
  { arabic: ["محفظة", "محفظه", "محافظ"], english: ["wallet"], kind: "product" },
  { arabic: ["مكياج"], english: ["makeup", "cosmetics"], kind: "product" },
  { arabic: ["كريم"], english: ["cream", "skincare"], kind: "product" },
  { arabic: ["شامبو"], english: ["shampoo"], kind: "product" },
  { arabic: ["جوال", "موبايل", "هاتف"], english: ["phone", "smartphone", "mobile"], kind: "product" },
  { arabic: ["لابتوب", "حاسوب محمول"], english: ["laptop", "notebook"], kind: "product" },
  { arabic: ["سماعات", "سماعة"], english: ["headphones", "earphones", "headset"], kind: "product" },
  { arabic: ["تلفزيون", "شاشة"], english: ["television", "tv", "display"], kind: "product" },
  { arabic: ["كرسي", "كراسي"], english: ["chair", "chairs"], kind: "product" },
  { arabic: ["طاولة", "طاوله"], english: ["table", "desk"], kind: "product" },
  { arabic: ["كنبة", "كنبه", "اريكة", "أريكة"], english: ["sofa", "couch"], kind: "product" },
  { arabic: ["سيارة", "سياره"], english: ["car", "automotive"], kind: "product" },
  { arabic: ["كفر", "اطار", "إطار"], english: ["tire", "tyre"], kind: "product" },
  { arabic: ["رجالي", "رجالية", "رجاليه", "رجال"], english: ["men", "men's", "mens", "male"], kind: "gender" },
  { arabic: ["نسائي", "نسائية", "نسائيه", "نساء", "حريمي"], english: ["women", "women's", "womens", "female"], kind: "gender" },
  { arabic: ["ولادي", "اولاد", "أولاد"], english: ["boys", "boy"], kind: "gender" },
  { arabic: ["بناتي", "بنات"], english: ["girls", "girl"], kind: "gender" },
  { arabic: ["اطفال", "أطفال"], english: ["kids", "children"], kind: "gender" },
  { arabic: ["اسود", "أسود", "سوداء", "سودا"], english: ["black"], kind: "color" },
  { arabic: ["ابيض", "أبيض", "بيضاء"], english: ["white"], kind: "color" },
  { arabic: ["كحلي"], english: ["navy", "navy blue"], kind: "color" },
  { arabic: ["بني"], english: ["brown"], kind: "color" },
  { arabic: ["احمر", "أحمر", "حمراء"], english: ["red"], kind: "color" },
  { arabic: ["ازرق", "أزرق", "زرقاء"], english: ["blue"], kind: "color" },
  { arabic: ["اخضر", "أخضر", "خضراء"], english: ["green"], kind: "color" },
  { arabic: ["جلد"], english: ["leather"], kind: "attribute" },
  { arabic: ["اصلي", "أصلي"], english: ["authentic", "original"], kind: "attribute" },
  { arabic: ["مستعمل"], english: ["used", "pre-owned"], kind: "attribute" },
  { arabic: ["جديد"], english: ["new"], kind: "attribute" },
  { arabic: ["رخيص"], english: ["affordable", "cheap", "budget"], kind: "attribute" },
  { arabic: ["اير فورس"], english: ["Air Force"], kind: "model" },
  { arabic: ["سوفاج"], english: ["Sauvage"], kind: "model" },
  {
    arabic: ["لويس فيتون", "ال في", "إل في", "الفي"],
    english: ["Louis Vuitton", "LV"],
    kind: "brand",
    contextualAliases: ["ال في", "إل في", "الفي", "LV"],
  },
  { arabic: ["شانيل"], english: ["Chanel"], kind: "brand" },
  { arabic: ["غوتشي", "جوتشي"], english: ["Gucci"], kind: "brand" },
  { arabic: ["ديور"], english: ["Dior"], kind: "brand" },
  { arabic: ["رولكس"], english: ["Rolex"], kind: "brand" },
  { arabic: ["جيس"], english: ["Guess"], kind: "brand" },
  { arabic: ["ديزل"], english: ["Diesel"], kind: "brand" },
  { arabic: ["نايك"], english: ["Nike"], kind: "brand" },
  { arabic: ["اديداس", "أديداس"], english: ["Adidas"], kind: "brand" },
  { arabic: ["شي ان", "شي إن"], english: ["SHEIN"], kind: "brand" },
  { arabic: ["تويوتا"], english: ["Toyota"], kind: "brand" },
  { arabic: ["كامري"], english: ["Camry"], kind: "brand" },
  { arabic: ["آبل", "ابل"], english: ["Apple"], kind: "brand" },
  { arabic: ["سامسونج"], english: ["Samsung"], kind: "brand" },
  { arabic: ["سوني"], english: ["Sony"], kind: "brand" },
  { arabic: ["السعودية", "السعوديه"], english: ["Saudi Arabia", "KSA"], kind: "attribute" },
];

export type SearchQueryExpansion = {
  originalQuery: string;
  normalizedQuery: string;
  variants: string[];
  productTerms: string[];
};

export function normalizeArabicForSearch(query: string) {
  return query
    .trim()
    .toLocaleLowerCase()
    .replace(ARABIC_DIACRITICS, "")
    .replace(/\u0640/gu, "")
    .replace(/[إأآٱ]/gu, "ا")
    .replace(/ى/gu, "ي")
    .replace(/ة/gu, "ه")
    .replace(/\s+/gu, " ");
}

const vocabularyByPhrase = new Map(
  SHOPPING_VOCABULARY.flatMap((entry) => {
    const contextualAliases = new Set(
      (entry.contextualAliases ?? []).map(normalizeArabicForSearch),
    );
    return [...entry.arabic, ...entry.english].map((phrase) => {
      const normalizedPhrase = normalizeArabicForSearch(phrase);
      return [
        normalizedPhrase,
        {
          entry,
          contextual: contextualAliases.has(normalizedPhrase),
        },
      ] as const;
    });
  }),
);

export function getShoppingVocabularyAliases(value: string) {
  const normalizedValue = normalizeArabicForSearch(value);
  const entry = SHOPPING_VOCABULARY.find((candidate) =>
    [...candidate.arabic, ...candidate.english].some(
      (phrase) => normalizeArabicForSearch(phrase) === normalizedValue,
    ),
  );
  return entry
    ? [...new Set([...entry.arabic, ...entry.english])]
    : [value];
}

const maxVocabularyPhraseLength = Math.max(
  ...[...vocabularyByPhrase.keys()].map((phrase) => phrase.split(" ").length),
);
const contextualVocabularyPhrases = [...vocabularyByPhrase.entries()]
  .filter(([, match]) => match.contextual)
  .map(([phrase]) => phrase);

type QuerySegment =
  | { source: string; entry: VocabularyEntry }
  | { source: string; entry?: undefined };

const LOUIS_VUITTON_CONTEXT_PRODUCTS = new Set([
  "handbag",
  "bag",
  "purse",
  "handbags",
  "bags",
  "suitcase",
  "luggage",
  "wallet",
  "shoes",
  "shoe",
  "sneakers",
  "jacket",
  "jackets",
  "dress",
  "dresses",
  "shirt",
  "shirts",
  "pants",
  "trousers",
  "sunglasses",
  "watch",
  "watches",
  "wristwatch",
  "wristwatches",
]);

const LOUIS_VUITTON_SHOPPING_INTENT = [
  "buy",
  "shop",
  "purchase",
  "want",
  "need",
  "find",
  "looking for",
  "search for",
  "ابغا",
  "ابغي",
  "ابي",
  "اريد",
  "اشتري",
  "شراء",
  "ابحث عن",
  "دورلي",
];

const LOUIS_VUITTON_SHOPPING_MODIFIERS = [
  "used",
  "pre-owned",
  "new",
  "price",
  "under",
  "below",
  "sale",
  "مستعمل",
  "مستعمله",
  "جديد",
  "جديده",
  "سعر",
  "بكم",
  "خصم",
  "اقل من",
  "ريال",
];

const SHOPPING_QUERY_FILLER_WORDS = new Set([
  "ابغا",
  "ابغي",
  "ابي",
  "اريد",
  "ابحث",
  "دورلي",
  "want",
  "need",
  "buy",
  "shop",
  "purchase",
  "looking",
  "search",
  "for",
  "please",
  "عن",
]);

function isShoppingQueryFiller(segment: QuerySegment) {
  return !segment.entry &&
    SHOPPING_QUERY_FILLER_WORDS.has(normalizeArabicForSearch(segment.source));
}

function containsNormalizedPhrase(query: string, phrase: string) {
  const normalizedPhrase = normalizeArabicForSearch(phrase);
  const escaped = normalizedPhrase.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    `(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`,
    "iu",
  ).test(query);
}

/**
 * Resolve abbreviated LV only when product and shopping signals make the
 * Louis Vuitton interpretation likely; otherwise leave the token untouched.
 */
export function hasConfidentLouisVuittonShoppingContext(query: string) {
  const normalizedQuery = normalizeArabicForSearch(query);
  const knownSegments = segmentQuery(normalizedQuery, false);
  const hasLuxuryProduct = knownSegments.some(
    (segment) =>
      segment.entry?.kind === "product" &&
      segment.entry.english.some((term) =>
        LOUIS_VUITTON_CONTEXT_PRODUCTS.has(term),
      ),
  );
  const hasExplicitShoppingIntent = LOUIS_VUITTON_SHOPPING_INTENT.some(
    (phrase) => containsNormalizedPhrase(normalizedQuery, phrase),
  );
  const hasShoppingModifier = LOUIS_VUITTON_SHOPPING_MODIFIERS.some(
    (phrase) => containsNormalizedPhrase(normalizedQuery, phrase),
  );
  const hasUnrelatedContext =
    /\b(?:stock|stocks|share|shares|voltage|circuit|electronics)\b/iu.test(
      normalizedQuery,
    );
  const isCompactQuery = normalizedQuery.split(" ").filter(Boolean).length <= 3;

  const confidence =
    (hasLuxuryProduct ? 0.6 : 0) +
    (hasExplicitShoppingIntent ? 0.6 : 0) +
    (hasShoppingModifier ? 0.2 : 0) +
    (isCompactQuery ? 0.1 : 0) -
    (hasUnrelatedContext ? 0.8 : 0);

  return confidence >= 0.7;
}

function segmentQuery(
  normalizedQuery: string,
  allowContextualAliases = true,
): QuerySegment[] {
  const tokens = normalizedQuery.split(" ").filter(Boolean);
  const segments: QuerySegment[] = [];
  const confidentShoppingContext =
    allowContextualAliases &&
    contextualVocabularyPhrases.some((phrase) =>
      containsNormalizedPhrase(normalizedQuery, phrase),
    ) &&
    hasConfidentLouisVuittonShoppingContext(normalizedQuery);

  for (let index = 0; index < tokens.length;) {
    let match: QuerySegment | undefined;
    let consumed = 1;
    for (
      let length = Math.min(maxVocabularyPhraseLength, tokens.length - index);
      length >= 1;
      length -= 1
    ) {
      const source = tokens.slice(index, index + length).join(" ");
      const vocabularyMatch = vocabularyByPhrase.get(source);
      if (
        vocabularyMatch &&
        (!vocabularyMatch.contextual || confidentShoppingContext)
      ) {
        match = { source, entry: vocabularyMatch.entry };
        consumed = length;
        break;
      }
    }
    segments.push(match ?? { source: tokens[index] });
    index += consumed;
  }

  return segments;
}

function renderEnglish(
  segments: QuerySegment[],
  replacement?: { segmentIndex: number; englishIndex: number },
) {
  return segments
    .map((segment, segmentIndex) => {
      if (!segment.entry) {
        return isShoppingQueryFiller(segment) ? undefined : segment.source;
      }
      const englishIndex =
        replacement?.segmentIndex === segmentIndex
          ? replacement.englishIndex
          : 0;
      return segment.entry.english[englishIndex] ?? segment.entry.english[0];
    })
    .filter(Boolean)
    .join(" ");
}

const FEMININE_ARABIC_PRODUCTS = new Set([
  "sunglasses",
  "handbag",
  "handbags",
  "bag",
  "bags",
  "purse",
  "wallet",
  "watch",
  "watches",
  "wristwatch",
  "wristwatches",
]);

function renderArabic(
  segments: QuerySegment[],
  options: { canonicalBrands?: boolean } = {},
) {
  const products = segments.filter((segment) => segment.entry?.kind === "product");
  const brands = segments.filter((segment) => segment.entry?.kind === "brand");
  const models = segments.filter((segment) => segment.entry?.kind === "model");
  const gender = segments.filter((segment) => segment.entry?.kind === "gender");
  const colors = segments.filter((segment) => segment.entry?.kind === "color");
  const attributes = segments.filter(
    (segment) => segment.entry?.kind === "attribute",
  );
  const unknown = segments.filter((segment) => !segment.entry);
  const feminineColor = products.some((segment) =>
    segment.entry?.english.some((term) => FEMININE_ARABIC_PRODUCTS.has(term)),
  );

  return [
    ...products.map((segment) => segment.entry?.arabic[0]),
    ...brands.map((segment) =>
      options.canonicalBrands
        ? segment.entry?.english[0]
        : segment.entry?.arabic[0],
    ),
    ...models.map((segment) => segment.entry?.arabic[0]),
    ...gender.map((segment) => segment.entry?.arabic[0]),
    ...colors.map((segment) =>
      segment.entry?.arabic[feminineColor ? 2 : 0] ??
      segment.entry?.arabic[feminineColor ? 1 : 0],
    ),
    ...attributes.map((segment) => segment.entry?.arabic[0]),
    ...unknown
      .filter((segment) => !isShoppingQueryFiller(segment))
      .map((segment) => segment.source),
  ]
    .filter(Boolean)
    .join(" ");
}

function naturalShoppingVariant(segments: QuerySegment[]) {
  const product = segments.find((segment) => segment.entry?.kind === "product");
  if (!product?.entry) return undefined;
  const gender = segments.find((segment) => segment.entry?.kind === "gender");
  const color = segments.find((segment) => segment.entry?.kind === "color");
  const models = segments.filter((segment) => segment.entry?.kind === "model");
  const attributes = segments.filter(
    (segment) => segment.entry?.kind === "attribute",
  );
  const brands = segments.filter((segment) => segment.entry?.kind === "brand");
  const genderTerm = gender?.entry?.english[1] ?? gender?.entry?.english[0];

  return [
    ...brands.map((segment) => segment.entry?.english[0]),
    ...models.map((segment) => segment.entry?.english[0]),
    genderTerm,
    color?.entry?.english[0],
    product.entry.english[0],
    ...attributes.map((segment) => segment.entry?.english[0]),
    ...segments
      .filter((segment) => !segment.entry && !isShoppingQueryFiller(segment))
      .map((segment) => segment.source),
  ]
    .filter(Boolean)
    .join(" ");
}

export type BilingualShoppingConcepts = {
  arabic: string[];
  english: string[];
};

export function getBilingualShoppingConcepts(
  query: string,
): BilingualShoppingConcepts {
  const trimmedQuery = query.trim();
  const normalizedQuery = normalizeArabicForSearch(query);
  const segments = segmentQuery(normalizedQuery);
  const containsArabic = ARABIC_SCRIPT.test(trimmedQuery);
  const containsEnglish = /[a-z]/iu.test(trimmedQuery);
  const hasVocabularyMatch = segments.some((segment) => Boolean(segment.entry));
  const hasBrand = segments.some((segment) => segment.entry?.kind === "brand");
  const arabic = new Set<string>();
  const english = new Set<string>();

  if (containsArabic && trimmedQuery) arabic.add(trimmedQuery);
  if (containsEnglish && !containsArabic && trimmedQuery) {
    english.add(trimmedQuery);
  }
  if (normalizedQuery) {
    (containsArabic ? arabic : english).add(normalizedQuery);
  }

  if (hasVocabularyMatch) {
    arabic.add(renderArabic(segments));
    if (hasBrand) {
      arabic.add(renderArabic(segments, { canonicalBrands: true }));
    }
    english.add(naturalShoppingVariant(segments) ?? renderEnglish(segments));
    english.add(renderEnglish(segments));
  }

  const unique = (values: Set<string>) => {
    const result: string[] = [];
    const keys = new Set<string>();
    for (const value of values) {
      const trimmed = value.trim();
      const key = normalizeArabicForSearch(trimmed);
      if (trimmed && !keys.has(key)) {
        keys.add(key);
        result.push(trimmed);
      }
    }
    return result;
  };

  return {
    arabic: unique(arabic),
    english: unique(english),
  };
}

export function expandShoppingQuery(query: string): SearchQueryExpansion {
  const originalQuery = query;
  const trimmedQuery = query.trim();
  const normalizedQuery = normalizeArabicForSearch(query);
  const segments = segmentQuery(normalizedQuery);
  const concepts = getBilingualShoppingConcepts(query);
  const matchedSegments = segments
    .map((segment, segmentIndex) => ({ segment, segmentIndex }))
    .filter(
      (
        item,
      ): item is { segment: QuerySegment & { entry: VocabularyEntry }; segmentIndex: number } =>
        Boolean(item.segment.entry),
    );
  const variants = new Set<string>();

  const pushVariant = (variant: string | undefined) => {
    const trimmed = variant?.trim();
    if (!trimmed) return;
    const normalized = normalizeArabicForSearch(trimmed);
    if (
      ![...variants].some(
        (existing) => normalizeArabicForSearch(existing) === normalized,
      )
    ) {
      variants.add(trimmed);
    }
  };
  const containsArabic = ARABIC_SCRIPT.test(trimmedQuery);

  if (containsArabic) {
    concepts.arabic.slice(0, 2).forEach(pushVariant);
    concepts.arabic.slice(2).forEach(pushVariant);
    concepts.english.forEach(pushVariant);
  } else {
    concepts.english.slice(0, 2).forEach(pushVariant);
    concepts.arabic.forEach(pushVariant);
    concepts.english.slice(2).forEach(pushVariant);
  }

  if (matchedSegments.length) {
    for (const { segment, segmentIndex } of matchedSegments) {
      for (
        let englishIndex = 1;
        englishIndex < segment.entry.english.length;
        englishIndex += 1
      ) {
        pushVariant(renderEnglish(segments, { segmentIndex, englishIndex }));
        if (variants.size >= MAX_SEARCH_VARIANTS) break;
      }
      if (variants.size >= MAX_SEARCH_VARIANTS) break;
    }
  }

  return {
    originalQuery,
    normalizedQuery,
    variants: [...variants].filter(Boolean).slice(0, MAX_SEARCH_VARIANTS),
    productTerms: [
      ...new Set(
        matchedSegments.flatMap(({ segment }) =>
          segment.entry.kind === "product" ? segment.entry.english : [],
        ),
      ),
    ],
  };
}