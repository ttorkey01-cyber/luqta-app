/**
 * Pre-search manual review of the 11 licensed Wikimedia query-image references.
 * A contact sheet of the downloaded images was inspected on 2026-09-29.
 * These are visible observations, NOT merchant-candidate relevance judgments.
 * Source, author and license are inherited from realWorld/manifest.ts.
 */
export type QueryImageReview = {
  caseId: string;
  usable: boolean;
  visibleCategory: string;
  visibleAttributes: string[];
  visibleBrand: string | null;
  visibleModel: string | null;
  uncertainty: string;
  exclusionReason?: string;
};

export const QUERY_IMAGE_REVIEWS: readonly QueryImageReview[] = [
  {
    caseId: "b30-similar-black-structured-bag",
    usable: false,
    visibleCategory: "bag",
    visibleAttributes: ["blue-and-black plush/furry surface", "soft, irregular shape"],
    visibleBrand: null,
    visibleModel: null,
    uncertainty: "No supported brand or model; exact bag construction is unclear.",
    exclusionReason: "The photograph does not depict the frozen case's black structured shoulder-bag silhouette.",
  },
  {
    caseId: "b30-similar-casual-low-top-sneaker",
    usable: true,
    visibleCategory: "casual low-top sneaker",
    visibleAttributes: ["dark upper", "white side stripe", "white sole"],
    visibleBrand: null,
    visibleModel: null,
    uncertainty: "Do not use the Commons filename as evidence of a specific brand or model.",
  },
  {
    caseId: "b30-similar-classic-wristwatch",
    usable: true,
    visibleCategory: "analog wristwatch",
    visibleAttributes: ["round dark dial", "metallic case and bracelet", "Roman numeral hour markers"],
    visibleBrand: "Montinari Milano",
    visibleModel: null,
    uncertainty: "Dial lettering appears legible; no specific model is established.",
  },
  {
    caseId: "b30-similar-over-ear-headphones",
    usable: true,
    visibleCategory: "over-ear headphones",
    visibleAttributes: ["dark color", "padded headband", "wired"],
    visibleBrand: null,
    visibleModel: null,
    uncertainty: "No legible model or brand is established.",
  },
  {
    caseId: "b30-similar-evening-dress",
    usable: true,
    visibleCategory: "long formal dress",
    visibleAttributes: ["long silhouette", "dark base", "red floral decoration"],
    visibleBrand: null,
    visibleModel: null,
    uncertainty: "Designer and era cannot be verified from the visible dress alone.",
  },
  {
    caseId: "b30-similar-home-coffee-maker",
    usable: true,
    visibleCategory: "countertop drip coffee maker",
    visibleAttributes: ["silver cylindrical body", "black trim", "countertop appliance"],
    visibleBrand: null,
    visibleModel: null,
    uncertainty: "Exact maker/model is not established by the visible photo.",
  },
  {
    caseId: "b30-auto-camry-headlamp",
    usable: false,
    visibleCategory: "vehicle headlamp assembly",
    visibleAttributes: ["headlamp installed in silver car front"],
    visibleBrand: null,
    visibleModel: null,
    uncertainty: "No Camry identity or Toyota fitment can be established from the image.",
    exclusionReason: "The frozen query requests a right-side Camry part, but this source image is titled S-Class Light and the photo cannot validate that requested fitment or side.",
  },
  {
    caseId: "b30-auto-bracket-image",
    usable: true,
    visibleCategory: "automotive mounting bracket",
    visibleAttributes: ["dark molded bracket", "separate small attached component"],
    visibleBrand: null,
    visibleModel: null,
    uncertainty: "Part number, manufacturer, function and vehicle fitment are unverified; do not claim a confirmed replacement.",
  },
  {
    caseId: "b30-ambiguous-watch-back",
    usable: true,
    visibleCategory: "watch back",
    visibleAttributes: ["round gold-toned case", "mechanical or decorative rear detail", "brown strap"],
    visibleBrand: null,
    visibleModel: null,
    uncertainty: "Brand, model and mechanism are not reliably established by the rear photo.",
  },
  {
    caseId: "b30-ambiguous-headphones-scene",
    usable: true,
    visibleCategory: "headphones",
    visibleAttributes: ["dark on-ear or over-ear cups", "visible cable", "lying on desk"],
    visibleBrand: null,
    visibleModel: null,
    uncertainty: "Cup fit and exact model are unclear.",
  },
  {
    caseId: "b30-ambiguous-multiple-shoes",
    usable: true,
    visibleCategory: "casual sneakers",
    visibleAttributes: ["dark shoes", "white side stripe", "white socks also in frame"],
    visibleBrand: null,
    visibleModel: null,
    uncertainty: "Do not infer a shoe model from the socks or the Commons filename.",
  },
];