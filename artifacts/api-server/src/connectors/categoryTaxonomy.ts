import { normalizeArabicForSearch } from "./queryExpansion";
import type { LuqtaCategory, ProviderProduct } from "./types";

type CategoryDefinition = {
  searchTerms: readonly string[];
  keywords: readonly string[];
  categoryKeywords: readonly string[];
};

export type CategoryFilter = {
  id: string;
  label: string;
  keywords: readonly string[];
  level?: 0 | 1;
  parentId?: string;
};

export type CategoryFacet = {
  id: string;
  label: string;
  count: number;
  level: 0 | 1;
  parentId?: string;
};

export type CategoryState = "healthy" | "low" | "zero";

export const HEALTHY_CATEGORY_INVENTORY = 12;
export const MIN_CATEGORY_FACET_INVENTORY = 2;

const NON_PRODUCT_MARKERS =
  /\b(salon|news|article|blog|guide|appointment|service|cnn)\b|صالون|خبر|مقال|مدونة|دليل|حجز|خدمات/iu;
// These words occur on many kinds of listings (for example phone cases and
// fashion accessories).  They are not sufficient evidence for a feed item
// without an explicit provider category or a second, specific product term.
const AMBIGUOUS_TITLE_KEYWORDS = new Set([
  "accessory",
  "accessories",
  "case",
  "care",
  "chain",
  "home",
  "top",
  "tops",
  "خدمات",
  "اكسسوارات",
  "إكسسوارات",
  "سلسلة",
  "سلاسل",
]);
const KEYWORD_REGEX_CACHE = new Map<string, RegExp>();
const NORMALIZED_KEYWORD_CACHE = new Map<string, string>();
type CategoryEvidence = Pick<
  ProviderProduct,
  | "title"
  | "description"
  | "category"
  | "brand"
  | "productType"
  | "subcategory"
  | "audience"
>;

export type PreparedCategoryIndexEvidence = {
  categoryText: string;
  officialTypeText: string;
  officialEvidenceText: string;
  titleText: string;
  detailText: string;
  classifiedCategory: LuqtaCategory | undefined;
};

type NormalizedCategoryEvidence = Pick<
  PreparedCategoryIndexEvidence,
  "categoryText" | "officialTypeText" | "titleText" | "detailText"
>;

const CATEGORY_DEFINITIONS: Record<LuqtaCategory, CategoryDefinition> = {
  beauty_care: {
    searchTerms: [
      "beauty",
      "perfume fragrance",
      "makeup cosmetics",
      "skincare haircare",
      "shampoo conditioner",
      "عطور مكياج تجميل",
      "شعر شامبو كريم عناية",
    ],
    keywords: [
      "beauty",
      "care",
      "perfume",
      "fragrance",
      "makeup",
      "cosmetic",
      "skincare",
      "haircare",
      "hair care",
      "shampoo",
      "conditioner",
      "serum",
      "cream",
      "lotion",
      "moisturizer",
      "mascara",
      "lipstick",
      "foundation",
      "cleanser",
      "sunscreen",
      "deodorant",
      "body care",
      "body butter",
      "body cream",
      "skin cream",
      "body scrub",
      "face scrub",
      "facial scrub",
      "body lotion",
      "skin lotion",
      "shea butter",
      "face mask",
      "hair mask",
      "hair brush",
      "hairbrush",
      "hair",
      "skin",
      "nail",
      "beauty tools",
      "جمال",
      "عناية",
      "عطر",
      "عطور",
      "مكياج",
      "تجميل",
      "مستحضرات",
      "بشرة",
      "شعر",
      "شامبو",
      "بلسم",
      "سيروم",
      "كريم",
      "لوشن",
      "مرطب",
      "منظف",
      "واقي شمس",
      "مزيل عرق",
      "اظافر",
      "رموش",
      "زيوت",
      "زبدة الشيا",
      "زبدة الجسم",
      "زبدة جسم",
      "مقشر للجسم",
      "مقشرللجسم",
      "مقشر للبشرة",
      "مقشر البشرة",
      "مقشر",
      "مقشرات",
      "ماسك",
      "عناية بالجسم",
      "العناية بالجسم",
      "عناية بالبشرة",
      "عناية بالشعر",
      "فرشاة شعر",
      "فرشاة للشعر",
      "فراشي الشعر",
      "فراشي للشعر",
    ],
    categoryKeywords: [
      "beauty",
      "cosmetic",
      "skincare",
      "haircare",
      "hair care",
      "body care",
      "body butter",
      "body cream",
      "skin cream",
      "body scrub",
      "face scrub",
      "facial scrub",
      "body lotion",
      "skin lotion",
      "shea butter",
      "cream",
      "lotion",
      "serum",
      "moisturizer",
      "face mask",
      "hair mask",
      "hair brush",
      "hairbrush",
      "shampoo",
      "conditioner",
      "perfume",
      "fragrance",
      "makeup",
      "عناية",
      "تجميل",
      "مستحضرات",
      "شامبو",
      "بلسم",
      "شعر",
      "بشرة",
      "عطور",
      "مكياج",
      "رموش",
      "زيوت",
      "زبدة الشيا",
      "زبدة الجسم",
      "زبدة جسم",
      "مقشر للجسم",
      "مقشرللجسم",
      "مقشر للبشرة",
      "مقشر البشرة",
      "مقشر",
      "مقشرات",
      "ماسك",
      "عناية بالجسم",
      "العناية بالجسم",
      "عناية بالبشرة",
      "عناية بالشعر",
      "فرشاة شعر",
      "فرشاة للشعر",
      "فراشي الشعر",
      "فراشي للشعر",
    ],
  },
  fashion: {
    searchTerms: [
      "clothing",
      "dress dresses",
      "shirts tops",
      "pants jeans",
      "jackets abayas",
      "ملابس أزياء",
      "فساتين قمصان بناطيل",
    ],
    keywords: [
      "clothing",
      "apparel",
      "clothes",
      "dress",
      "shirt",
      "shirts",
      "top",
      "tops",
      "pants",
      "trousers",
      "jeans",
      "denim",
      "jacket",
      "coat",
      "blazer",
      "cardigan",
      "vest",
      "gilet",
      "outerwear",
      "sweater",
      "suit",
      "hoodie",
      "shorts",
      "abaya",
      "skirt",
      "ملابس",
      "أزياء",
      "فستان",
      "فساتين",
      "قميص",
      "تيشيرت",
      "بنطلون",
      "بناطيل",
      "جينز",
      "جاكيت",
      "عباية",
      "تنورة",
    ],
    categoryKeywords: [
      "clothing",
      "apparel",
      "clothes",
      "dress",
      "shirt",
      "shirts",
      "top",
      "tops",
      "pants",
      "trousers",
      "jeans",
      "denim",
      "jacket",
      "coat",
      "blazer",
      "cardigan",
      "vest",
      "gilet",
      "outerwear",
      "sweater",
      "suit",
      "hoodie",
      "shorts",
      "skirt",
      "abaya",
      "sweater",
      "sweaters",
      "jacket",
      "abaya",
      "ملابس",
      "أزياء",
      "فساتين",
      "قمصان",
      "بناطيل",
      "جينز",
      "جاكيت",
      "عبايات",
    ],
  },
  bags_accessories: {
    searchTerms: [
      "bags handbags",
      "backpacks wallets",
      "purses luggage",
      "belts accessories",
      "حقائب شنط",
      "محافظ اكسسوارات",
    ],
    keywords: [
      "bag",
      "bags",
      "handbag",
      "backpack",
      "wallet",
      "purse",
      "luggage",
      "belt",
      "case",
      "حقيبة",
      "حقائب",
      "شنطة",
      "شنط",
      "محفظة",
      "محافظ",
      "حزام",
    ],
    categoryKeywords: [
      "bag",
      "handbag",
      "backpack",
      "wallet",
      "purse",
      "luggage",
      "belt",
      "حقيبة",
      "حقائب",
      "شنطة",
      "شنط",
      "محفظة",
      "محافظ",
      "حزام",
    ],
  },
  watches_jewelry: {
    searchTerms: [
      "watches",
      "jewelry",
      "bracelets necklaces",
      "rings earrings",
      "ساعات",
      "مجوهرات ساعات خواتم",
    ],
    keywords: [
      "watch",
      "watches",
      "jewelry",
      "jewellery",
      "bracelet",
      "necklace",
      "ring",
      "earring",
      "wristwatch",
      "pendant",
      "bangle",
      "chain",
      "ساعة",
      "ساعات",
      "ساعة يد",
      "مجوهرات",
      "اسورة",
      "أساور",
      "سوار",
      "قلادة",
      "عقد",
      "سلسلة",
      "سلاسل",
      "خاتم",
      "خواتم",
      "اقراط",
      "أقراط",
    ],
    categoryKeywords: [
      "watch",
      "watches",
      "wristwatch",
      "jewelry",
      "jewellery",
      "bracelet",
      "necklace",
      "ring",
      "earring",
      "pendant",
      "bangle",
      "chain",
      "ساعة",
      "ساعات",
      "ساعة يد",
      "مجوهرات",
      "اسورة",
      "سوار",
      "قلادة",
      "عقد",
      "سلسلة",
      "سلاسل",
      "خاتم",
      "اقراط",
      "أقراط",
    ],
  },
  electronics: {
    searchTerms: [
      "electronics",
      "phones smartphones",
      "headphones earphones",
      "laptops computers",
      "television displays",
      "جوالات الكترونيات",
      "هواتف سماعات لابتوب",
    ],
    keywords: [
      "electronics",
      "phone",
      "smartphone",
      "mobile",
      "headphone",
      "earphone",
      "laptop",
      "computer",
      "tablet",
      "television",
      "display",
      "camera",
      "receiver",
      "charger",
      "charging",
      "motherboard",
      "circuit board",
      "sensor",
      "bluetooth",
      "usb",
      "led",
      "keyboard",
      "router",
      "projector",
      "power supply",
      "battery",
      "cooling fan",
      "جوال",
      "جوالات",
      "هاتف",
      "هواتف",
      "الكترونيات",
      "إلكترونيات",
      "سماعة",
      "سماعات",
      "لابتوب",
      "حاسوب",
      "كمبيوتر",
      "شاشة",
      "كاميرا",
    ],
    categoryKeywords: [
      "electronics",
      "phone",
      "smartphone",
      "mobile",
      "headphone",
      "laptop",
      "computer",
      "tablet",
      "television",
      "جوال",
      "هاتف",
      "الكترونيات",
      "إلكترونيات",
      "سماعات",
      "لابتوب",
      "حاسوب",
      "كمبيوتر",
      "شاشة",
      "كاميرا",
    ],
  },
  home_living: {
    searchTerms: [
      "furniture",
      "home decor",
      "kitchen cookware",
      "lighting",
      "household",
      "أثاث منزل",
      "مطبخ إضاءة ديكور",
    ],
    keywords: [
      "furniture",
      "home",
      "decor",
      "kitchen",
      "cookware",
      "lighting",
      "household",
      "chair",
      "table",
      "sofa",
      "desk",
      "سرير",
      "أثاث",
      "منزل",
      "ديكور",
      "مطبخ",
      "إضاءة",
      "أدوات منزلية",
      "كرسي",
      "طاولة",
      "كنبة",
      "أريكة",
      "مكتب",
    ],
    categoryKeywords: [
      "furniture",
      "home",
      "decor",
      "kitchen",
      "cookware",
      "lighting",
      "household",
      "chair",
      "table",
      "sofa",
      "desk",
      "أثاث",
      "منزل",
      "ديكور",
      "مطبخ",
      "إضاءة",
      "أدوات منزلية",
      "كرسي",
      "طاولة",
      "كنبة",
      "أريكة",
    ],
  },
  shoes: {
    searchTerms: [
      "shoes",
      "sneakers",
      "sandals",
      "boots",
      "heels flats",
      "أحذية",
      "جزم صنادل بوت",
    ],
    keywords: [
      "shoe",
      "shoes",
      "sneaker",
      "sandals",
      "boots",
      "heels",
      "flats",
      "footwear",
      "حذاء",
      "أحذية",
      "جزمة",
      "جزم",
      "صندل",
      "صنادل",
      "بوت",
      "أحذية رياضية",
    ],
    categoryKeywords: [
      "shoe",
      "shoes",
      "sneaker",
      "sandals",
      "boots",
      "heels",
      "flats",
      "footwear",
      "حذاء",
      "أحذية",
      "جزمة",
      "صندل",
      "صنادل",
      "بوت",
    ],
  },
  eyewear: {
    searchTerms: [
      "sunglasses",
      "eyewear",
      "glasses frames",
      "optical",
      "نظارات",
      "نظارات شمسية إطارات",
    ],
    keywords: [
      "sunglasses",
      "eyewear",
      "glasses",
      "frames",
      "optical",
      "نظارة",
      "نظارات",
      "شمسية",
      "إطارات",
      "عدسات",
    ],
    categoryKeywords: [
      "sunglasses",
      "eyewear",
      "glasses",
      "optical",
      "نظارة",
      "نظارات",
      "شمسية",
      "إطارات",
      "عدسات",
    ],
  },
  automotive: {
    searchTerms: [
      "automotive",
      "car parts",
      "headlights",
      "tires",
      "car accessories",
      "سيارات",
      "قطع غيار شمعة كفر",
    ],
    keywords: [
      "automotive",
      "automobile",
      "car",
      "vehicle",
      "auto parts",
      "spare parts",
      "headlight",
      "headlamp",
      "tire",
      "tyre",
      "سيارة",
      "سيارات",
      "سيارات",
      "قطع غيار",
      "شمعة",
      "شمعات",
      "كفر",
      "إطار",
      "اطار",
      "زينة السيارات",
    ],
    categoryKeywords: [
      "automotive",
      "automobile",
      "car",
      "vehicle",
      "auto parts",
      "spare parts",
      "headlight",
      "headlamp",
      "tire",
      "tyre",
      "سيارة",
      "سيارات",
      "قطع غيار",
      "شمعة",
      "شمعات",
      "كفر",
      "إطار",
      "اطار",
    ],
  },
  kids_baby: {
    searchTerms: [
      "baby",
      "kids children",
      "toys",
      "baby clothing",
      "nursery",
      "أطفال مواليد",
      "ألعاب ملابس أطفال",
    ],
    keywords: [
      "baby",
      "babies",
      "kids",
      "children",
      "child",
      "toy",
      "toys",
      "nursery",
      "stroller",
      "أطفال",
      "طفل",
      "مواليد",
      "رضيع",
      "رضع",
      "ألعاب",
      "لعبة",
      "عربة أطفال",
    ],
    categoryKeywords: [
      "baby",
      "babies",
      "kids",
      "children",
      "toy",
      "toys",
      "nursery",
      "أطفال",
      "مواليد",
      "رضيع",
      "ألعاب",
      "لعبة",
    ],
  },
  sports_fitness: {
    searchTerms: [
      "sports",
      "fitness",
      "gym",
      "running",
      "cycling",
      "sportswear",
      "رياضة لياقة",
      "جيم تمارين",
    ],
    keywords: [
      "sports",
      "sport",
      "fitness",
      "gym",
      "running",
      "cycling",
      "workout",
      "exercise",
      "sportswear",
      "رياضة",
      "لياقة",
      "جيم",
      "تمارين",
      "ركض",
      "دراجات",
      "تدريب",
    ],
    categoryKeywords: [
      "sports",
      "sport",
      "fitness",
      "gym",
      "running",
      "cycling",
      "workout",
      "exercise",
      "sportswear",
      "رياضة",
      "لياقة",
      "جيم",
      "تمارين",
      "ركض",
      "دراجات",
    ],
  },
  games_hobbies: {
    searchTerms: [
      "games",
      "gaming",
      "controllers",
      "hobby crafts",
      "collectibles",
      "ألعاب",
      "ألعاب فيديو هوايات",
    ],
    keywords: [
      "game",
      "games",
      "gaming",
      "controller",
      "console",
      "puzzle",
      "hobby",
      "crafts",
      "collectible",
      "ألعاب",
      "لعبة",
      "ألعاب فيديو",
      "يد تحكم",
      "هوايات",
      "أشغال يدوية",
      "مجسمات",
    ],
    categoryKeywords: [
      "game",
      "games",
      "gaming",
      "controller",
      "console",
      "puzzle",
      "hobby",
      "crafts",
      "collectible",
      "ألعاب",
      "لعبة",
      "هوايات",
      "أشغال يدوية",
      "مجسمات",
    ],
  },
};

const CATEGORY_FILTERS: Partial<Record<LuqtaCategory, readonly CategoryFilter[]>> = {
  beauty_care: [
    {
      id: "fragrance",
      label: "العطور",
      keywords: ["perfume", "fragrance", "cologne", "parfum", "عطر", "عطور"],
    },
    {
      id: "hair_care",
      label: "العناية بالشعر",
      keywords: [
        "hair",
        "haircare",
        "shampoo",
        "conditioner",
        "شعر",
        "شامبو",
        "بلسم",
      ],
    },
    {
      id: "skin_care",
      label: "العناية بالبشرة",
      keywords: [
        "skincare",
        "skin",
        "serum",
        "lotion",
        "moisturizer",
        "بشرة",
        "سيروم",
        "لوشن",
        "مرطب",
      ],
    },
    {
      id: "makeup",
      label: "المكياج",
      keywords: [
        "makeup",
        "cosmetic",
        "mascara",
        "lipstick",
        "foundation",
        "مكياج",
        "مستحضرات",
        "كحل",
        "رموش",
      ],
    },
  ],
  fashion: [
    {
      id: "dresses",
      label: "الفساتين",
      keywords: ["dress", "dresses", "فستان", "فساتين"],
    },
    {
      id: "tops",
      label: "القمصان والبلوزات",
      keywords: ["shirt", "shirts", "top", "tops", "قميص", "قمصان", "بلوزة"],
    },
    {
      id: "pants",
      label: "البناطيل",
      keywords: ["pants", "trousers", "jeans", "بنطلون", "بناطيل", "جينز"],
    },
  ],
  watches_jewelry: [
    {
      id: "watches",
      label: "الساعات",
      keywords: ["watch", "watches", "wristwatch", "ساعة", "ساعات"],
    },
    {
      id: "jewelry",
      label: "المجوهرات",
      keywords: [
        "jewelry",
        "jewellery",
        "bracelet",
        "necklace",
        "ring",
        "earring",
        "مجوهرات",
        "سوار",
        "قلادة",
        "خاتم",
        "أقراط",
      ],
    },
  ],
  automotive: [
    {
      id: "parts",
      label: "قطع الغيار",
      keywords: [
        "parts",
        "automotive",
        "headlight",
        "headlamp",
        "spare",
        "قطع غيار",
        "شمعة",
        "شمعات",
      ],
    },
    {
      id: "car_accessories",
      label: "إكسسوارات السيارات",
      keywords: ["car accessories", "vehicle accessories", "زينة السيارات"],
    },
  ],
};

const SMART_CATEGORY_FILTERS: Partial<
  Record<LuqtaCategory, readonly CategoryFilter[]>
> = {
  beauty_care: [
    {
      id: "fragrance",
      label: "العطور",
      keywords: ["perfume", "fragrance", "cologne", "parfum", "عطر", "عطور"],
    },
    {
      id: "hair_care",
      label: "الشعر",
      keywords: ["haircare", "shampoo", "conditioner", "hair", "شعر", "شامبو", "بلسم"],
    },
    {
      id: "skin_care",
      label: "البشرة",
      keywords: ["skincare", "skin", "serum", "lotion", "moisturizer", "بشرة", "سيروم", "لوشن", "مرطب"],
    },
    {
      id: "makeup",
      label: "المكياج",
      keywords: ["makeup", "cosmetic", "mascara", "lipstick", "foundation", "مكياج", "مستحضرات", "كحل", "رموش"],
    },
  ],
  fashion: [
    {
      id: "women",
      label: "نساء",
      keywords: ["women", "woman", "womens", "female", "ladies", "lady", "نسائي", "نساء", "حريمي"],
      level: 0,
    },
    {
      id: "men",
      label: "رجال",
      keywords: ["men", "man", "mens", "male", "gentlemen", "رجالي", "رجال", "رجاليه"],
      level: 0,
    },
    {
      id: "kids",
      label: "أطفال",
      keywords: ["kids", "children", "child", "boys", "girls", "boy", "girl", "أطفال", "طفل", "أولاد", "بنات"],
      level: 0,
    },
    {
      id: "dresses",
      label: "فساتين",
      keywords: ["dress", "dresses", "فستان", "فساتين"],
      level: 1,
      parentId: "women",
    },
    {
      id: "blouses",
      label: "بلوزات",
      keywords: ["blouse", "blouses", "top", "tops", "بلوزة", "بلوزات"],
      level: 1,
      parentId: "women",
    },
    {
      id: "women_pants",
      label: "بناطيل",
      keywords: ["pants", "trousers", "jeans", "بنطلون", "بناطيل", "جينز"],
      level: 1,
      parentId: "women",
    },
    {
      id: "women_jackets",
      label: "جاكيتات",
      keywords: ["jacket", "jackets", "coat", "coats", "جاكيت", "جاكيتات"],
      level: 1,
      parentId: "women",
    },
    {
      id: "women_other",
      label: "ملابس أخرى",
      keywords: ["abaya", "skirt", "shorts", "عباية", "تنورة", "شورت"],
      level: 1,
      parentId: "women",
    },
    {
      id: "men_shirts",
      label: "قمصان",
      keywords: ["shirt", "shirts", "قميص", "قمصان"],
      level: 1,
      parentId: "men",
    },
    {
      id: "men_tshirts",
      label: "تيشيرتات",
      keywords: ["t-shirt", "tshirt", "tee", "تيشيرت", "تي شيرت"],
      level: 1,
      parentId: "men",
    },
    {
      id: "men_pants",
      label: "بناطيل",
      keywords: ["pants", "trousers", "بنطلون", "بناطيل"],
      level: 1,
      parentId: "men",
    },
    {
      id: "men_jeans",
      label: "جينز",
      keywords: ["jeans", "denim", "جينز"],
      level: 1,
      parentId: "men",
    },
    {
      id: "men_jackets",
      label: "جاكيتات",
      keywords: ["jacket", "jackets", "coat", "جاكيت", "جاكيتات"],
      level: 1,
      parentId: "men",
    },
    {
      id: "men_other",
      label: "ملابس أخرى",
      keywords: ["suit", "blazer", "shorts", "بدلة", "بليزر", "شورت"],
      level: 1,
      parentId: "men",
    },
    {
      id: "boys",
      label: "أولاد",
      keywords: ["boys", "boy", "أولاد", "ولد"],
      level: 1,
      parentId: "kids",
    },
    {
      id: "girls",
      label: "بنات",
      keywords: ["girls", "girl", "بنات", "بنت"],
      level: 1,
      parentId: "kids",
    },
    {
      id: "kids_clothing",
      label: "ملابس أطفال",
      keywords: ["kids clothing", "children clothing", "ملابس أطفال"],
      level: 1,
      parentId: "kids",
    },
  ],
  watches_jewelry: [
    {
      id: "men",
      label: "رجالي",
      keywords: ["men", "mens", "male", "رجالي", "رجال"],
      level: 0,
    },
    {
      id: "women",
      label: "نسائي",
      keywords: ["women", "womens", "female", "نسائي", "نساء"],
      level: 0,
    },
    {
      id: "watches",
      label: "ساعات",
      keywords: ["watch", "watches", "wristwatch", "ساعة", "ساعات"],
      level: 0,
    },
    {
      id: "jewelry",
      label: "مجوهرات",
      keywords: ["jewelry", "jewellery", "bracelet", "necklace", "ring", "earring", "مجوهرات", "سوار", "قلادة", "خاتم", "أقراط"],
      level: 0,
    },
  ],
  bags_accessories: [
    {
      id: "women",
      label: "نسائي",
      keywords: ["women", "womens", "female", "ladies", "نسائي", "نساء"],
      level: 0,
    },
    {
      id: "men",
      label: "رجالي",
      keywords: ["men", "mens", "male", "رجالي", "رجال"],
      level: 0,
    },
    {
      id: "bags",
      label: "حقائب",
      keywords: ["bag", "bags", "handbag", "backpack", "purse", "luggage", "حقيبة", "حقائب", "شنطة", "شنط"],
      level: 0,
    },
    {
      id: "wallets",
      label: "محافظ",
      keywords: ["wallet", "wallets", "محفظة", "محافظ"],
      level: 0,
    },
    {
      id: "accessories",
      label: "إكسسوارات",
      keywords: ["accessory", "accessories", "belt", "scarf", "إكسسوارات", "اكسسوارات", "حزام", "وشاح"],
      level: 0,
    },
  ],
  shoes: [
    {
      id: "men",
      label: "رجالي",
      keywords: ["men", "mens", "male", "رجالي", "رجال"],
      level: 0,
    },
    {
      id: "women",
      label: "نسائي",
      keywords: ["women", "womens", "female", "ladies", "نسائي", "نساء"],
      level: 0,
    },
    {
      id: "kids",
      label: "أطفال",
      keywords: ["kids", "children", "child", "أطفال", "طفل"],
      level: 0,
    },
    {
      id: "sports",
      label: "رياضي",
      keywords: ["sneaker", "running", "sport", "sports", "athletic", "رياضي", "رياضة"],
      level: 0,
    },
  ],
  electronics: [
    {
      id: "phones_tablets",
      label: "جوالات وأجهزة لوحية",
      keywords: ["phone", "smartphone", "mobile", "tablet", "جوال", "هاتف", "تابلت"],
      level: 0,
    },
    {
      id: "computers",
      label: "كمبيوتر ولابتوب",
      keywords: ["laptop", "computer", "notebook", "حاسوب", "كمبيوتر", "لابتوب"],
      level: 0,
    },
    {
      id: "audio",
      label: "سماعات وصوتيات",
      keywords: ["headphone", "headphones", "earphone", "speaker", "audio", "سماعة", "سماعات", "مكبر"],
      level: 0,
    },
    {
      id: "gaming",
      label: "ألعاب إلكترونية",
      keywords: ["gaming", "console", "playstation", "xbox", "controller", "ألعاب إلكترونية", "بلايستيشن", "يد تحكم"],
      level: 0,
    },
    {
      id: "electronics_accessories",
      label: "إكسسوارات إلكترونية",
      keywords: ["charger", "cable", "case", "adapter", "شاحن", "كيبل", "غطاء", "محول"],
      level: 0,
    },
  ],
  home_living: [
    { id: "furniture", label: "الأثاث", keywords: ["furniture", "chair", "table", "sofa", "desk", "أثاث", "كرسي", "طاولة", "كنبة", "أريكة"], level: 0 },
    { id: "decor", label: "الديكور", keywords: ["decor", "decoration", "ديكور", "زينة"], level: 0 },
    { id: "kitchen", label: "المطبخ", keywords: ["kitchen", "cookware", "مطبخ", "أواني"], level: 0 },
    { id: "lighting", label: "الإضاءة", keywords: ["lighting", "lamp", "light", "إضاءة", "مصباح"], level: 0 },
  ],
  eyewear: [
    { id: "men", label: "رجالي", keywords: ["men", "mens", "male", "رجالي", "رجال"], level: 0 },
    { id: "women", label: "نسائي", keywords: ["women", "womens", "female", "نسائي", "نساء"], level: 0 },
    { id: "sunglasses", label: "نظارات شمسية", keywords: ["sunglasses", "sun glasses", "شمسية"], level: 0 },
    { id: "optical", label: "نظارات طبية", keywords: ["optical", "eyeglasses", "prescription", "طبية", "إطارات"], level: 0 },
  ],
  automotive: [
    { id: "parts", label: "قطع الغيار", keywords: ["parts", "automotive", "headlight", "headlamp", "spare", "قطع غيار", "شمعة", "شمعات"], level: 0 },
    { id: "car_accessories", label: "إكسسوارات السيارات", keywords: ["car accessories", "vehicle accessories", "car accessory", "زينة السيارات"], level: 0 },
    { id: "lighting", label: "الإنارة", keywords: ["headlight", "headlamp", "fog light", "شمعة", "إنارة"], level: 0 },
    { id: "tires", label: "الإطارات", keywords: ["tire", "tyre", "wheel", "كفر", "إطار", "إطارات"], level: 0 },
  ],
  kids_baby: [
    { id: "boys", label: "أولاد", keywords: ["boys", "boy", "أولاد", "ولد"], level: 0 },
    { id: "girls", label: "بنات", keywords: ["girls", "girl", "بنات", "بنت"], level: 0 },
    { id: "kids_clothing", label: "ملابس أطفال", keywords: ["kids clothing", "children clothing", "ملابس أطفال"], level: 0 },
    { id: "toys", label: "ألعاب", keywords: ["toy", "toys", "ألعاب", "لعبة"], level: 0 },
  ],
  sports_fitness: [
    { id: "running", label: "الجري", keywords: ["running", "run", "ركض", "جري"], level: 0 },
    { id: "gym", label: "التمارين", keywords: ["gym", "fitness", "workout", "تمارين", "لياقة", "جيم"], level: 0 },
    { id: "cycling", label: "الدراجات", keywords: ["cycling", "bike", "bicycle", "دراجات", "دراجة"], level: 0 },
  ],
  games_hobbies: [
    { id: "consoles", label: "أجهزة الألعاب", keywords: ["console", "playstation", "xbox", "أجهزة الألعاب", "بلايستيشن"], level: 0 },
    { id: "controllers", label: "أيدي التحكم", keywords: ["controller", "gamepad", "يد تحكم"], level: 0 },
    { id: "games", label: "الألعاب", keywords: ["game", "games", "لعبة", "ألعاب"], level: 0 },
    { id: "collectibles", label: "المقتنيات والهوايات", keywords: ["collectible", "hobby", "craft", "مقتنيات", "هوايات"], level: 0 },
  ],
};

function normalizedText(value: string | undefined) {
  return normalizeArabicForSearch(value ?? "");
}

function keywordMatches(text: string, keyword: string) {
  let normalizedKeyword = NORMALIZED_KEYWORD_CACHE.get(keyword);
  if (normalizedKeyword === undefined) {
    normalizedKeyword = normalizedText(keyword);
    NORMALIZED_KEYWORD_CACHE.set(keyword, normalizedKeyword);
  }
  if (!normalizedKeyword) return false;
  if (/\s/u.test(normalizedKeyword)) return text.includes(normalizedKeyword);

  const escaped = normalizedKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pluralSuffix = /[a-z]/iu.test(normalizedKeyword) ? "(?:s|es)?" : "";
  const cacheKey = `${normalizedKeyword}\u0000${pluralSuffix}`;
  let matcher = KEYWORD_REGEX_CACHE.get(cacheKey);
  if (!matcher) {
    matcher = new RegExp(
      `(^|[^\\p{L}\\p{N}])${escaped}${pluralSuffix}(?=$|[^\\p{L}\\p{N}])`,
      "iu",
    );
    KEYWORD_REGEX_CACHE.set(cacheKey, matcher);
  }
  return matcher.test(text);
}

function countKeywordMatches(text: string, keywords: readonly string[]) {
  return keywords.reduce((count, keyword) => {
    return keywordMatches(text, keyword) ? count + 1 : count;
  }, 0);
}

function categoryScores(evidence: NormalizedCategoryEvidence) {
  const { categoryText, officialTypeText, titleText, detailText } = evidence;
  return (Object.keys(CATEGORY_DEFINITIONS) as LuqtaCategory[]).map((key) => {
    const definition = CATEGORY_DEFINITIONS[key];
    return {
      key,
      categoryScore: countKeywordMatches(categoryText, definition.categoryKeywords),
      officialTypeScore: countKeywordMatches(
        officialTypeText,
        definition.categoryKeywords,
      ),
      titleScore: countKeywordMatches(titleText, definition.keywords),
      detailScore: categoryText
        ? 0
        : countKeywordMatches(detailText, definition.keywords),
    };
  });
}

function chooseCategory(evidence: NormalizedCategoryEvidence) {
  const { categoryText, titleText } = evidence;
  const scores = categoryScores(evidence);

  // Prefer an explicit provider category. If it is broad or unrecognized,
  // continue to the provider's more specific product type/subcategory.
  if (categoryText) {
    const explicit = scores
      .filter((score) => score.categoryScore > 0)
      .sort((a, b) => b.categoryScore - a.categoryScore);
    if (
      explicit.length > 0 &&
      explicit[0].categoryScore !== explicit[1]?.categoryScore
    ) {
      return explicit[0].key;
    }
  }

  const officialTypeScores = scores
    .map((score) => ({ ...score, score: score.officialTypeScore }))
    .sort((a, b) => b.score - a.score);
  const officialTypeBest = officialTypeScores[0];
  if (
    officialTypeBest &&
    officialTypeBest.score > 0 &&
    officialTypeBest.score !== officialTypeScores[1]?.score
  ) {
    return officialTypeBest.key;
  }

  const titleScores = scores
    .map((score) => ({ ...score, score: score.titleScore }))
    .sort((a, b) => b.score - a.score);
  const best = titleScores[0];
  if (!best || best.score === titleScores[1]?.score) {
    return undefined;
  }

  // A lone broad word is deliberately not enough to classify a product.
  const matchedTitleKeywords = CATEGORY_DEFINITIONS[best.key].keywords.filter((keyword) =>
    keywordMatches(titleText, keyword),
  );
  if (
    best.score === 0
  ) {
    const detailScores = scores
      .map((score) => ({ ...score, score: score.detailScore }))
      .sort((a, b) => b.score - a.score);
    const detailBest = detailScores[0];
    return detailBest && detailBest.score >= 2 &&
      detailBest.score !== detailScores[1]?.score
      ? detailBest.key
      : undefined;
  }
  if (
    best.score === 1 &&
    matchedTitleKeywords.every((keyword) =>
      AMBIGUOUS_TITLE_KEYWORDS.has(normalizedText(keyword)),
    )
  ) {
    return undefined;
  }
  return best.key;
}

export function getCategoryDefinition(category: LuqtaCategory) {
  return CATEGORY_DEFINITIONS[category];
}

export function getCategoryFilters(category: LuqtaCategory) {
  return (SMART_CATEGORY_FILTERS[category] ?? CATEGORY_FILTERS[category] ?? []).map(
    (filter) => ({
      ...filter,
      level: filter.level ?? 0,
    }),
  );
}

export function getCategoryFilterSelectionIds(
  category: LuqtaCategory,
  filterId: string,
) {
  const filter = getCategoryFilters(category).find(
    (candidate) => candidate.id === filterId,
  );
  if (!filter) return undefined;
  return [...new Set([filter.parentId, filter.id].filter(Boolean))] as string[];
}

function normalizeCategoryEvidence(product: CategoryEvidence) {
  return {
    categoryText: normalizedText(product.category),
    officialTypeText: normalizedText(
      [product.subcategory, product.productType].filter(Boolean).join(" "),
    ),
    officialEvidenceText: normalizedText(
      [
        product.category,
        product.subcategory,
        product.productType,
        product.audience,
      ]
        .filter(Boolean)
        .join(" "),
    ),
    titleText: normalizedText(product.title),
    detailText: normalizedText(
      [product.description, product.brand].filter(Boolean).join(" "),
    ),
    classifierMarkerText: normalizedText(
      [
        product.title,
        product.description,
        product.category,
        product.subcategory,
        product.productType,
        product.brand,
      ]
        .filter(Boolean)
        .join(" "),
    ),
  };
}

// "Electronics" in a description ("protects electronics") or a broad
// accessories category is not evidence that the item itself is electronic.
const NON_ELECTRONIC_CATEGORY =
  /\b(tops?|tees?|shirts?|clothing|apparel|fashion|bags?|jewell?ery|beauty|cosmetics?|fragrance|skincare|furniture)\b|ملابس|حقائب|مجوهرات|تجميل/iu;
const NON_ELECTRONIC_ITEM =
  /\b(t[- ]?shirt|shirts?|hoodie|dress|jacket|handbag|purse|wallet|charm|necklace|bracelet|strap|watchband|watch band|jewell?ery|makeup|cosmetic|perfume|skincare|bags?|pouch|case|cover|sleeve|screen protector|sticker|tent|fireworks?|solder paste|repair tool|removal tool|opening tool|opener|pry blade|disassembl|jig|stencil|spatula|silicone curing|foam pad|copper (?:plate|sheet|tube)|keyboard tray|mouse pad|drawer|holder|stand|grip|hat|shaver|trimmer|glue remover|dust cleaner|cleaning pen|blower ball|air duster|stage truss|selfie stick|baseplate|back plate|phone box|waterproof box|metal shell|pet drinker|bristle brush|cleaning brush|polarizer film|reflective film)\b|ملابس|حقيبه|حافظه|غطاء|مجوهرات|عطر/iu;
const ELECTRONIC_DEVICE =
  /\b(smartphone|mobile phone|cell phone|laptop|computer|tablet pc|ipad|smart\s?watch|digital watch|headphones?|earphones?|earbuds?|speakers?|microphone|television|tv|projector|camera|webcam|monitor|display|router|modem|drone|game console|thermometer|electronic scale)\b|هاتف|جوال|حاسوب|كمبيوتر|لابتوب|سماعات|كاميرا|شاشه|ميزان حراره|قياس الحراره|مقياس الحراره/iu;
const ELECTRONIC_COMPONENT =
  /\b(chargers?|charging|power supply|batter(?:y|ies)|motherboard|circuit board|pcb|control(?:ler)? module|sensor|receiver|transmitter|microchip|ic chip|microcontroller|cpu|gpu|ssd|hard drive|ram|graphics card|wi-?fi|bluetooth|hdmi|usb|led|lcd|cooling fan|cpu fan|heat ?sink|keyboard|wireless mouse|power adapter|audio pickup)\b|شاحن|بطارية|لوحة إلكترونية|مستشعر/iu;
const SPECIFIC_ELECTRONICS_CATEGORY =
  /\b(electronics|smartphones?|mobile phones?|computers?|laptops?|audio|cameras?|digital|electrical|computer components?|phone accessories)\b|إلكترونيات|الكترونيات|هواتف|جوالات/iu;

function electronicsQualityFromEvidence(
  evidence: Pick<NormalizedCategoryEvidence, "categoryText" | "officialTypeText" | "titleText" | "detailText">,
): number {
  const title = evidence.titleText;
  const official = `${evidence.categoryText} ${evidence.officialTypeText}`;
  if (NON_ELECTRONIC_ITEM.test(title) || NON_ELECTRONIC_CATEGORY.test(official)) return 0;
  const device = ELECTRONIC_DEVICE.test(title);
  const component = ELECTRONIC_COMPONENT.test(title);
  if (!device && !component) return 0;
  return Math.min(
    1,
    (device ? 0.76 : 0.65) +
      (SPECIFIC_ELECTRONICS_CATEGORY.test(official) ? 0.13 : 0) +
      (device && component ? 0.08 : 0) +
      (evidence.detailText.length > 30 ? 0.03 : 0),
  );
}

export function getElectronicsCategoryQuality(product: CategoryEvidence): number {
  return electronicsQualityFromEvidence(normalizeCategoryEvidence(product));
}

function classifyNormalizedCategory(
  evidence: NormalizedCategoryEvidence,
  classifierMarkerText: string,
) {
  if (NON_PRODUCT_MARKERS.test(classifierMarkerText)) return undefined;
  return chooseCategory(evidence);
}

export function prepareCategoryIndexEvidence(
  product: CategoryEvidence,
): PreparedCategoryIndexEvidence {
  const evidence = normalizeCategoryEvidence(product);
  return {
    categoryText: evidence.categoryText,
    officialTypeText: evidence.officialTypeText,
    officialEvidenceText: evidence.officialEvidenceText,
    titleText: evidence.titleText,
    detailText: evidence.detailText,
    classifiedCategory: classifyNormalizedCategory(
      evidence,
      evidence.classifierMarkerText,
    ),
  };
}

export function getCategoryIndexDataFromEvidence(
  evidence: PreparedCategoryIndexEvidence,
  category: LuqtaCategory,
  filters = getCategoryFilters(category),
) {
  const {
    categoryText,
    officialTypeText,
    officialEvidenceText,
    titleText,
    detailText,
    classifiedCategory,
  } = evidence;
  const definition = CATEGORY_DEFINITIONS[category];
  const titleMatches = countKeywordMatches(titleText, definition.keywords);
  const detailMatches = countKeywordMatches(detailText, definition.keywords);
  const officialTypeMatches = countKeywordMatches(
    officialTypeText,
    definition.categoryKeywords,
  );
  const matches =
    !NON_PRODUCT_MARKERS.test(`${titleText} ${detailText}`) &&
    (category !== "electronics" ||
      electronicsQualityFromEvidence(evidence) > 0) &&
    (categoryText
      ? classifiedCategory === category
      : classifiedCategory === category &&
        (officialTypeMatches > 0 || titleMatches > 0 || detailMatches >= 2));
  const filterIds = getCategoryEvidenceFilterIds(evidence, filters);

  return { matches, filterIds };
}

function getCategoryEvidenceFilterIds(
  evidence: PreparedCategoryIndexEvidence,
  filters: ReturnType<typeof getCategoryFilters>,
) {
  const { categoryText, officialEvidenceText, titleText, detailText } = evidence;
  return filters
    .filter((filter) => {
      if (countKeywordMatches(officialEvidenceText, filter.keywords) > 0) {
        return true;
      }
      if (countKeywordMatches(titleText, filter.keywords) > 0) return true;
      return !categoryText && countKeywordMatches(detailText, filter.keywords) >= 2;
    })
    .map((filter) => filter.id);
}

/**
 * Index builds only need facet evidence for products that actually enter the
 * category. Avoid scanning every category's filter vocabulary for each product.
 */
export function getCategoryIndexDataForIndex(
  evidence: PreparedCategoryIndexEvidence,
  category: LuqtaCategory,
  filters = getCategoryFilters(category),
) {
  if (evidence.classifiedCategory !== category) {
    return { matches: false, filterIds: [] };
  }
  const { categoryText, officialTypeText, titleText, detailText } = evidence;
  if (category === "electronics" && electronicsQualityFromEvidence(evidence) === 0) {
    return { matches: false, filterIds: [] };
  }
  if (NON_PRODUCT_MARKERS.test(`${titleText} ${detailText}`)) {
    return { matches: false, filterIds: [] };
  }
  if (!categoryText) {
    const definition = CATEGORY_DEFINITIONS[category];
    const hasCategoryEvidence =
      countKeywordMatches(officialTypeText, definition.categoryKeywords) > 0 ||
      countKeywordMatches(titleText, definition.keywords) > 0 ||
      countKeywordMatches(detailText, definition.keywords) >= 2;
    if (!hasCategoryEvidence) return { matches: false, filterIds: [] };
  }
  return {
    matches: true,
    filterIds: getCategoryEvidenceFilterIds(evidence, filters),
  };
}

export function getCategoryIndexData(
  product: CategoryEvidence,
  category: LuqtaCategory,
) {
  return getCategoryIndexDataFromEvidence(
    prepareCategoryIndexEvidence(product),
    category,
  );
}

export function getCategoryFilterIds(
  product: CategoryEvidence,
  category: LuqtaCategory,
) {
  return getCategoryIndexData(product, category).filterIds;
}

export function getCategoryFilterFacets(
  products: Array<
    Pick<
      ProviderProduct,
      | "title"
      | "description"
      | "category"
      | "brand"
      | "productType"
      | "subcategory"
      | "audience"
      | "categoryFilterIds"
    >
  >,
  category: LuqtaCategory,
): CategoryFacet[] {
  const productFilterIds = products.map((product) =>
    product.categoryFilterIds ?? getCategoryFilterIds(product, category),
  );
  return getCategoryFilters(category)
    .map((filter) => ({
      id: filter.id,
      label: filter.label,
      count: productFilterIds.filter((ids) => ids.includes(filter.id)).length,
      level: filter.level ?? 0,
      ...(filter.parentId ? { parentId: filter.parentId } : {}),
    }))
    .filter((filter) => filter.count >= MIN_CATEGORY_FACET_INVENTORY);
}

export function getCategoryState(inventoryCount: number): CategoryState {
  if (inventoryCount === 0) return "zero";
  return inventoryCount >= HEALTHY_CATEGORY_INVENTORY ? "healthy" : "low";
}

export function classifyLuqtaCategory(
  product: CategoryEvidence,
): LuqtaCategory | undefined {
  const evidence = normalizeCategoryEvidence(product);
  return classifyNormalizedCategory(evidence, evidence.classifierMarkerText);
}

export function matchesLuqtaCategory(
  product: CategoryEvidence,
  category: LuqtaCategory,
) {
  return getCategoryIndexData(product, category).matches;
}