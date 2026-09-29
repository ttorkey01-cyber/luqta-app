/**
 * Frozen pre-scoring case definitions for a focused 30-query search benchmark.
 *
 * This file contains query intent and adjudication rules only: no catalog,
 * result IDs, judgments, or measurements. `manifestCaseId` links to Wikimedia
 * provenance/license metadata in realWorld/manifest.ts; it does not assert that
 * a Commons title establishes what the pixels depict. Image references remain
 * pending independent visual verification.
 */
export type Benchmark30Group =
  | "exact-product-identity"
  | "visually-similar"
  | "hard-constraints"
  | "automotive"
  | "saudi-arabic"
  | "difficult-ambiguous-image"
  | "negative-no-match";

export type Benchmark30Case = {
  id: string;
  group: Benchmark30Group;
  query: string;
  intendedProduct: string;
  category: string;
  /** Present only when the text query itself supplies identifying evidence. */
  identityEvidence?: {
    type: "user-entered-model-or-sku";
    value: string;
    limitation: "User-entered evidence only; not independently verified manufacturer identity or fitment.";
  };
  hardConstraints: string[];
  exactCriteria: string[];
  closeCriteria: string[];
  unacceptableCriteria: string[];
  expectedNoMatchBehavior: string;
  /** Source and license are inherited by looking up this id in the real-world manifest. */
  imageReference?: {
    manifestCaseId: string;
    verification: "pending-independent-verification";
    provenance: "inherit-from-realWorld-manifest";
  };
};

const pendingImage = (manifestCaseId: string): Benchmark30Case["imageReference"] => ({
  manifestCaseId,
  verification: "pending-independent-verification",
  provenance: "inherit-from-realWorld-manifest",
});

export const SEARCH_V3_BENCHMARK_30: Benchmark30Case[] = [
  // 6 exact product / identity cases
  {
    id: "b30-exact-casio-dw5600e",
    group: "exact-product-identity",
    query: "أدور على ساعة Casio G-Shock DW-5600E-1V، أبي نفس الموديل بالضبط",
    intendedProduct: "Casio G-Shock DW-5600E-1V digital watch",
    category: "watches",
    identityEvidence: {
      type: "user-entered-model-or-sku",
      value: "DW-5600E-1V",
      limitation: "User-entered evidence only; not independently verified manufacturer identity or fitment.",
    },
    hardConstraints: ["Brand Casio", "G-Shock DW-5600E-1V model", "Watch, not a strap or accessory"],
    exactCriteria: ["Listing identifies Casio G-Shock DW-5600E-1V specifically; a similar square G-Shock appearance alone is insufficient."],
    closeCriteria: ["Another DW-5600 series watch explicitly labeled with its different model designation."],
    unacceptableCriteria: ["A different G-Shock family represented as DW-5600E-1V.", "A replacement strap or other accessory.", "Inferring the model from an unverified public photo."],
    expectedNoMatchBehavior: "If the listing does not establish DW-5600E-1V identity, return no exact match rather than identifying by appearance alone.",
  },
  {
    id: "b30-exact-adidas-samba-og",
    group: "exact-product-identity",
    query: "أبغى Adidas Samba OG رجالي مقاس 42 EU، مو Samba ADV",
    intendedProduct: "Adidas Samba OG men's sneaker in EU size 42",
    category: "shoes",
    identityEvidence: {
      type: "user-entered-model-or-sku",
      value: "Adidas Samba OG",
      limitation: "User-entered evidence only; not independently verified manufacturer identity or fitment.",
    },
    hardConstraints: ["Adidas Samba OG model, not Samba ADV", "Men's sizing", "EU 42 availability"],
    exactCriteria: ["Listing identifies Samba OG and explicitly offers men's EU 42."],
    closeCriteria: ["Samba ADV or another Samba variant in EU 42, clearly labeled as a different model."],
    unacceptableCriteria: ["Gazelle, Spezial, or another Adidas silhouette represented as Samba OG.", "A listing with no evidence that EU 42 is available."],
    expectedNoMatchBehavior: "If exact model or size availability is not established, do not infer it from a public photo or generic product page; return no confirmed exact match.",
  },
  {
    id: "b30-exact-longchamp-pliage-m",
    group: "exact-product-identity",
    query: "Looking for the Longchamp Le Pliage Original M tote, the medium size.",
    intendedProduct: "Longchamp Le Pliage Original M tote bag",
    category: "handbags",
    identityEvidence: {
      type: "user-entered-model-or-sku",
      value: "Le Pliage Original M",
      limitation: "User-entered evidence only; not independently verified manufacturer identity or fitment.",
    },
    hardConstraints: ["Brand Longchamp", "Le Pliage Original line", "M/medium size", "Tote bag"],
    exactCriteria: ["Listing identifies Longchamp Le Pliage Original M; generic Le Pliage or visual resemblance alone is insufficient."],
    closeCriteria: ["Le Pliage Original in a different size, or a different Le Pliage line, clearly labeled as a variant."],
    unacceptableCriteria: ["Another brand's foldable tote represented as Longchamp.", "A pouch or accessory rather than the tote.", "Inferring authenticity or model from a public photo alone."],
    expectedNoMatchBehavior: "If the listing does not establish brand, Original line, and medium size, return no exact match and do not use image appearance as proof.",
  },
  {
    id: "b30-exact-galaxy-s24",
    group: "exact-product-identity",
    query: "Find a Samsung Galaxy S24, 256 GB, unlocked.",
    intendedProduct: "Samsung Galaxy S24 smartphone with 256 GB storage and unlocked status",
    category: "smartphones",
    identityEvidence: {
      type: "user-entered-model-or-sku",
      value: "Galaxy S24, 256 GB",
      limitation: "User-entered evidence only; not independently verified manufacturer identity or fitment.",
    },
    hardConstraints: ["Samsung Galaxy S24, not S24+ or S24 Ultra", "256 GB storage", "Unlocked"],
    exactCriteria: ["Listing identifies Galaxy S24 (base model), 256 GB, and unlocked status."],
    closeCriteria: ["Base Galaxy S24 with a different stated storage size, or lock status unspecified; label the difference."],
    unacceptableCriteria: ["S24+ or S24 Ultra presented as the requested model.", "A case or accessory.", "Inferring storage or unlocked status from a photo."],
    expectedNoMatchBehavior: "If the model variant, storage, or unlocked status is not supported by listing evidence, return no confirmed exact match.",
  },
  {
    id: "b30-exact-ordinary-niacinamide",
    group: "exact-product-identity",
    query: "أبغى The Ordinary Niacinamide 10% + Zinc 1% حجم 30 مل",
    intendedProduct: "The Ordinary Niacinamide 10% + Zinc 1% serum, 30 mL",
    category: "beauty-and-skincare",
    identityEvidence: {
      type: "user-entered-model-or-sku",
      value: "Niacinamide 10% + Zinc 1%, 30 mL",
      limitation: "User-entered evidence only; not independently verified manufacturer identity or fitment.",
    },
    hardConstraints: ["The Ordinary brand", "Niacinamide 10% + Zinc 1% formulation", "30 mL volume"],
    exactCriteria: ["Listing names the exact formulation and 30 mL size."],
    closeCriteria: ["Same formulation in 60 mL, clearly labeled as a different size; or another niacinamide serum clearly labeled as a different formulation."],
    unacceptableCriteria: ["Different active/formulation represented as the requested product.", "A 60 mL listing represented as 30 mL.", "Claims of authenticity based solely on a public product photo."],
    expectedNoMatchBehavior: "If formulation or volume is not explicitly identified, return no exact match instead of inferring identity from packaging appearance.",
  },
  {
    id: "b30-exact-levis-501-original",
    group: "exact-product-identity",
    query: "أدور جينز Levi's 501 Original Fit نسائي، مقاس 28x30",
    intendedProduct: "Levi's 501 Original Fit women's jeans in size 28x30",
    category: "fashion",
    identityEvidence: {
      type: "user-entered-model-or-sku",
      value: "501 Original Fit, 28x30",
      limitation: "User-entered evidence only; not independently verified manufacturer identity or fitment.",
    },
    hardConstraints: ["Brand Levi's", "501 Original Fit model", "Women's jeans", "Waist 28 and inseam 30"],
    exactCriteria: ["Listing identifies Levi's 501 Original Fit women's jeans and explicitly offers size 28x30."],
    closeCriteria: ["Another 501 cut or a nearby size, clearly labeled as a different cut/size."],
    unacceptableCriteria: ["A different Levi's fit represented as 501 Original Fit.", "Another brand or a listing without size availability evidence.", "Inferring cut or size from an unverified public photo."],
    expectedNoMatchBehavior: "If the named cut and size are not supported by the listing, return no confirmed exact match rather than identifying clothing from a photo.",
  },

  // 6 visually similar cases; linked image identity is intentionally unverified
  {
    id: "b30-similar-black-structured-bag",
    group: "visually-similar",
    query: "أبغى شنطة كتف سوداء قريبة من شكل الصورة، مو لازم نفس الماركة",
    intendedProduct: "Black structured shoulder handbag similar in broad shape and style to the referenced image",
    category: "handbags",
    hardConstraints: ["Black color", "Shoulder-carry handbag"],
    exactCriteria: ["A black shoulder handbag with a structured silhouette and broadly similar proportions."],
    closeCriteria: ["A black handbag with a similar structured style but a different shape, material, or detail."],
    unacceptableCriteria: ["Backpacks, wallets, or non-bag accessories.", "Claims that the reference depicts a particular brand or model based only on its Commons title."],
    expectedNoMatchBehavior: "If no reasonably similar black shoulder bag exists, return no match instead of broadening to unrelated bags.",
    imageReference: pendingImage("rw-bag-retail"),
  },
  {
    id: "b30-similar-casual-low-top-sneaker",
    group: "visually-similar",
    query: "Find a low-top casual sneaker with a similar simple side profile to this photo, any brand.",
    intendedProduct: "Casual low-top sneaker with a simple side profile, without asserting a specific model",
    category: "shoes",
    hardConstraints: ["Low-top sneaker", "Casual style"],
    exactCriteria: ["A low-top casual sneaker matching the broad silhouette and visible style once the image is independently verified."],
    closeCriteria: ["A casual sneaker with a related silhouette but visibly different paneling, sole, or color."],
    unacceptableCriteria: ["Dress shoes or boots.", "Treating the Commons filename as proof of the depicted brand/model."],
    expectedNoMatchBehavior: "If the image is not independently verified or no credible style match is available, withhold image-based claims and return no match.",
    imageReference: pendingImage("rw-shoe-vans"),
  },
  {
    id: "b30-similar-classic-wristwatch",
    group: "visually-similar",
    query: "Looking for a classic understated wristwatch with a similar overall look to the attached picture.",
    intendedProduct: "Classic understated wristwatch in a broadly similar visual style",
    category: "watches",
    hardConstraints: ["Wristwatch", "Classic understated style"],
    exactCriteria: ["A watch with a comparable overall case/dial style after independent image verification."],
    closeCriteria: ["A classic wristwatch with a different dial, case, or strap detail."],
    unacceptableCriteria: ["Smartwatches or watch straps alone.", "Naming the product from image metadata without visual verification."],
    expectedNoMatchBehavior: "Do not force a match when the reference appearance is unverified or candidates do not resemble it.",
    imageReference: pendingImage("rw-watch-montinari"),
  },
  {
    id: "b30-similar-over-ear-headphones",
    group: "visually-similar",
    query: "أبي سماعة رأس over-ear بنفس الستايل العام، ما يهم اسم الشركة",
    intendedProduct: "Over-ear headphones in a similar general style to the image",
    category: "headphones",
    hardConstraints: ["Over-ear headphones", "No brand requirement"],
    exactCriteria: ["Over-ear headphones with a similar broad form and color after independent image verification."],
    closeCriteria: ["Over-ear headphones with a related form but different color or controls."],
    unacceptableCriteria: ["Earbuds or headphone stands.", "Assuming a Sony identity from the source file title."],
    expectedNoMatchBehavior: "If no suitable over-ear option can be supported, return no match rather than substituting earbuds.",
    imageReference: pendingImage("rw-headphones-white"),
  },
  {
    id: "b30-similar-evening-dress",
    group: "visually-similar",
    query: "Find an elegant long evening dress with a similar silhouette to the photo, no need for the same designer.",
    intendedProduct: "Long elegant evening dress in a similar silhouette",
    category: "fashion",
    hardConstraints: ["Dress", "Evening/formal wear", "Long silhouette"],
    exactCriteria: ["An evening dress with a comparable silhouette after independent image verification."],
    closeCriteria: ["A formal long dress with a related silhouette but different construction or embellishment."],
    unacceptableCriteria: ["Casual day dresses or unrelated apparel.", "Attributing designer or era from the Commons title as visual truth."],
    expectedNoMatchBehavior: "If image verification is pending or no similar formal dress exists, avoid an unsupported visual match.",
    imageReference: pendingImage("rw-fashion-nina"),
  },
  {
    id: "b30-similar-home-coffee-maker",
    group: "visually-similar",
    query: "أدور ماكينة قهوة منزلية قريبة من شكل اللي بالصورة، مو شرط نفس الشركة",
    intendedProduct: "Home coffee maker with a broadly similar form to the referenced image",
    category: "coffee-makers",
    hardConstraints: ["Home coffee maker"],
    exactCriteria: ["A home coffee maker with a similar overall form once the reference is independently verified."],
    closeCriteria: ["A different home coffee maker style that performs the same broad function."],
    unacceptableCriteria: ["Coffee beans, cups, or unrelated kitchen appliances.", "Claiming a manufacturer/model based only on file metadata."],
    expectedNoMatchBehavior: "Return no match if visual verification is unavailable or only unrelated appliances can be found.",
    imageReference: pendingImage("rw-coffee-hamilton-home"),
  },

  // 5 hard-constraint cases
  {
    id: "b30-constraint-budget-ksa",
    group: "hard-constraints",
    query: "أبغى سماعة بلوتوث over-ear جديدة، حدّي 400 ريال والتوصيل للرياض",
    intendedProduct: "New over-ear Bluetooth headphones",
    category: "headphones",
    hardConstraints: ["New condition", "Over-ear form", "Bluetooth", "Price at or below 400 SAR", "Delivery available to Riyadh"],
    exactCriteria: ["All stated product, condition, price, currency, and delivery constraints are explicitly supported."],
    closeCriteria: ["Matching headphones where a single nonessential detail is unconfirmed; label the uncertainty and do not claim compliance."],
    unacceptableCriteria: ["Price above 400 SAR.", "USD price without a supported SAR conversion.", "Used/refurbished products or no Riyadh delivery evidence."],
    expectedNoMatchBehavior: "If no listing meets every hard constraint, report no compliant match rather than relaxing the budget or location.",
  },
  {
    id: "b30-constraint-used-camera-range",
    group: "hard-constraints",
    query: "Find a used mirrorless camera body between 1,500 and 2,000 SAR, shipping within Saudi Arabia.",
    intendedProduct: "Used mirrorless interchangeable-lens camera body",
    category: "cameras",
    hardConstraints: ["Used condition", "Camera body only", "Mirrorless", "Price from 1,500 through 2,000 SAR inclusive", "Ships within Saudi Arabia"],
    exactCriteria: ["Listing is for a used mirrorless body and its stated SAR price and domestic shipping satisfy the range."],
    closeCriteria: ["A used mirrorless kit including a lens within range, clearly labeled as a kit rather than body-only."],
    unacceptableCriteria: ["New-only listing.", "Price outside range or currency unsupported.", "DSLR, lens-only, or shipping outside Saudi Arabia."],
    expectedNoMatchBehavior: "No result should be called compliant when condition, price, currency, item scope, or domestic shipping is missing.",
  },
  {
    id: "b30-constraint-color-size",
    group: "hard-constraints",
    query: "أبي حذاء جري رجالي أبيض مقاس 43 EU، أقل من 500 ريال",
    intendedProduct: "Men's white running shoes in EU 43",
    category: "shoes",
    hardConstraints: ["Men's running shoe", "White", "EU size 43 available", "Price under 500 SAR"],
    exactCriteria: ["All requested shoe type, color, size availability, and sub-500 SAR price are supported by the listing."],
    closeCriteria: ["A white men's running shoe with size 43 availability unclear, explicitly flagged as unconfirmed."],
    unacceptableCriteria: ["Different size or color presented as compliant.", "Price of exactly 500 SAR or higher.", "Lifestyle sneaker not identified as a running shoe."],
    expectedNoMatchBehavior: "When stock size or current SAR price cannot be confirmed, say no confirmed compliant match rather than infer availability.",
  },
  {
    id: "b30-constraint-new-tablet",
    group: "hard-constraints",
    query: "New Android tablet, at least 128GB, under 1,200 SAR; Wi-Fi only is fine.",
    intendedProduct: "New Android tablet with at least 128 GB storage",
    category: "tablets",
    hardConstraints: ["New condition", "Android tablet", "At least 128 GB storage", "Price below 1,200 SAR"],
    exactCriteria: ["The listing confirms new condition, Android, storage of 128 GB or more, and price below the cap."],
    closeCriteria: ["Android tablet meeting the other requirements with storage explicitly unstated; mark storage unconfirmed."],
    unacceptableCriteria: ["iPad or other non-Android tablet.", "Storage below 128 GB.", "Price at or above 1,200 SAR or used condition."],
    expectedNoMatchBehavior: "Do not assume storage from a family name; return no confirmed match if no listing supports all required facts.",
  },
  {
    id: "b30-constraint-home-delivery",
    group: "hard-constraints",
    query: "Find a new 1.5-ton split AC under 2,500 SAR with delivery and installation in Jeddah.",
    intendedProduct: "New 1.5-ton split air conditioner with Jeddah delivery and installation",
    category: "air-conditioners",
    hardConstraints: ["New condition", "Split AC", "1.5 ton capacity", "Price below 2,500 SAR", "Delivery and installation in Jeddah"],
    exactCriteria: ["All technical, price, condition, delivery, and installation details are explicitly supported."],
    closeCriteria: ["A 1.5-ton split AC under budget with delivery confirmed but installation unconfirmed; clearly state the gap."],
    unacceptableCriteria: ["Window AC or different capacity.", "Price at or above cap.", "Claiming installation based on delivery alone."],
    expectedNoMatchBehavior: "If local installation cannot be confirmed, do not represent the result as fully compliant; report no confirmed match.",
  },

  // 4 automotive cases; fitment is a request, not verified evidence
  {
    id: "b30-auto-camry-headlamp",
    group: "automotive",
    query: "أحتاج شمعة أمامية يمين لتويوتا كامري 2022، تأكد من التوافق قبل ما أطلب",
    intendedProduct: "Right-side front headlamp assembly requested for a 2022 Toyota Camry",
    category: "automotive-parts",
    hardConstraints: ["Right/passenger-side headlamp", "Toyota Camry", "Model year 2022", "Fitment must be verified before claiming compatibility"],
    exactCriteria: ["A listing with explicit fitment evidence for right-side headlamp and the exact 2022 Camry configuration."],
    closeCriteria: ["A right-side Camry headlamp where year/configuration compatibility is uncertain, flagged as unverified."],
    unacceptableCriteria: ["Left-side part.", "Different model/year represented as confirmed fitment.", "Using a source image title as proof of compatibility."],
    expectedNoMatchBehavior: "If exact fitment evidence is unavailable, state that compatibility is unverified and return no confirmed fitment match.",
    imageReference: pendingImage("rw-auto-headlamp"),
  },
  {
    id: "b30-auto-civic-brake-pads",
    group: "automotive",
    query: "Front brake pads for a 2019 Honda Civic 1.5T, Saudi-spec. Don't show rear pads.",
    intendedProduct: "Front brake pads requested for a Saudi-spec 2019 Honda Civic 1.5T",
    category: "automotive-parts",
    hardConstraints: ["Front axle brake pads", "Honda Civic", "2019 model year", "1.5T engine", "Saudi-spec fitment", "Exclude rear pads"],
    exactCriteria: ["Part listing explicitly confirms front axle and fitment for the specified year, engine, and market variant."],
    closeCriteria: ["Front Civic brake pads with one requested fitment detail not verified; disclose the uncertainty."],
    unacceptableCriteria: ["Rear pads.", "Generic Civic compatibility without year/engine/market support.", "Assumed OEM equivalence."],
    expectedNoMatchBehavior: "Do not claim fitment from vehicle name alone; if exact variant is unsupported, return no confirmed match.",
  },
  {
    id: "b30-auto-filter-sku",
    group: "automotive",
    query: "Find cabin air filter Toyota part number 87139-0E040 for my 2020 RAV4; verify the part number and fitment.",
    intendedProduct: "Toyota cabin air filter with user-specified part number 87139-0E040, requested for 2020 RAV4",
    category: "automotive-parts",
    identityEvidence: {
      type: "user-entered-model-or-sku",
      value: "87139-0E040",
      limitation: "User-entered evidence only; not independently verified manufacturer identity or fitment.",
    },
    hardConstraints: ["Cabin air filter", "Requested part number 87139-0E040", "Requested vehicle: 2020 Toyota RAV4", "Verify both part number and fitment"],
    exactCriteria: ["Listing identifies the exact part number and has independent, specific 2020 RAV4 fitment evidence."],
    closeCriteria: ["Same stated part number but vehicle fitment not established, or compatible filter with a different number clearly identified."],
    unacceptableCriteria: ["Treating user-entered part number as manufacturer-verified.", "Engine air filter, wrong part number, or unsupported fitment claim."],
    expectedNoMatchBehavior: "If part-number authenticity or vehicle fitment cannot be supported, state the limitation and return no confirmed exact fitment.",
  },
  {
    id: "b30-auto-bracket-image",
    group: "automotive",
    query: "Can you identify this small headlamp-area bracket and find a replacement? Don't guess which vehicle it fits.",
    intendedProduct: "Automotive headlamp-area bracket, with part identity and fitment not established",
    category: "automotive-parts",
    hardConstraints: ["Automotive bracket/part only if identifiable", "Do not assert vehicle fitment without evidence"],
    exactCriteria: ["A replacement only if the part identity is independently established and the listing matches that identity."],
    closeCriteria: ["A visually/functionally similar bracket clearly labeled as unverified and not asserted as a direct replacement."],
    unacceptableCriteria: ["Invented make/model/fitment.", "Treating Commons metadata title as proof of the part's visual identity."],
    expectedNoMatchBehavior: "If neither part identity nor fitment can be verified, explicitly return no confirmed replacement.",
    imageReference: pendingImage("rw-auto-headlamp-bracket"),
  },

  // 4 Saudi Arabic cases
  {
    id: "b30-arabic-earbuds-riyadh",
    group: "saudi-arabic",
    query: "أبغى سماعات أذن لاسلكية عزلها كويس وتوصل للرياض، بحدود ٣٠٠ ريال",
    intendedProduct: "Wireless earbuds with good noise isolation",
    category: "earbuds",
    hardConstraints: ["Wireless earbuds", "Budget approximately 300 SAR", "Delivery to Riyadh", "Treat 'عزلها كويس' as a preference unless active noise cancellation is explicitly required"],
    exactCriteria: ["Wireless earbuds with stated price around 300 SAR and Riyadh delivery; noise-control feature is accurately described."],
    closeCriteria: ["Wireless earbuds within budget with delivery confirmed but noise-isolation details unclear."],
    unacceptableCriteria: ["Wired headphones or over-ear headphones.", "Price materially above 300 SAR presented as within budget.", "Unsupported ANC claim."],
    expectedNoMatchBehavior: "If there is no listing within the stated approximate budget that ships to Riyadh, report no compliant match.",
  },
  {
    id: "b30-arabic-used-iphone",
    group: "saudi-arabic",
    query: "أدور آيفون 13 مستعمل نظيف، بطاريته فوق 85٪، حول ١٢٠٠ ريال في جدة",
    intendedProduct: "Used iPhone 13 in good condition with battery health above 85%",
    category: "smartphones",
    hardConstraints: ["iPhone 13", "Used, good condition", "Battery health greater than 85%", "Around 1,200 SAR", "Available in Jeddah"],
    exactCriteria: ["Listing confirms model, used condition, battery health above 85%, approximate price, and Jeddah availability."],
    closeCriteria: ["Used iPhone 13 around budget in Jeddah with battery health not stated, explicitly flagged."],
    unacceptableCriteria: ["Different iPhone model.", "Battery health at or below 85% represented as compliant.", "Claimed condition or battery health inferred from a photo."],
    expectedNoMatchBehavior: "If battery health or local availability is not stated, don't guess; no confirmed match is acceptable.",
  },
  {
    id: "b30-arabic-coffee-machine",
    group: "saudi-arabic",
    query: "أبي ماكينة قهوة كبسولات صغيرة للمكتب، جديدة وسعرها أقل من ٦٠٠ ريال",
    intendedProduct: "New compact capsule coffee machine for office use",
    category: "coffee-makers",
    hardConstraints: ["Capsule coffee machine", "Compact for office use", "New condition", "Price below 600 SAR"],
    exactCriteria: ["Listing confirms capsule operation, compact form, new condition, and price under 600 SAR."],
    closeCriteria: ["New compact single-serve coffee machine with capsule compatibility unclear; label compatibility unconfirmed."],
    unacceptableCriteria: ["Manual espresso maker or drip machine.", "Used condition or price at/above 600 SAR.", "Assuming compatibility with a capsule system."],
    expectedNoMatchBehavior: "If capsule compatibility or price/condition cannot be established, report no confirmed compliant listing.",
  },
  {
    id: "b30-arabic-abaya-color",
    group: "saudi-arabic",
    query: "أبغى عباية عملية سوداء للدوام، قماشها خفيف وما تتعدى ٢٥٠ ريال",
    intendedProduct: "Practical black work abaya in lightweight fabric",
    category: "fashion",
    hardConstraints: ["Abaya", "Black", "Suitable for work", "Lightweight fabric", "Price at or below 250 SAR"],
    exactCriteria: ["Listing describes a black work-suitable abaya, lightweight fabric, and price no higher than 250 SAR."],
    closeCriteria: ["Black abaya suitable for work within budget, with fabric weight not specified; flag it."],
    unacceptableCriteria: ["Non-abaya garment.", "Different color or over-budget item represented as compliant.", "Fabric-weight claim unsupported by listing."],
    expectedNoMatchBehavior: "Do not claim lightweight fabric based on image alone; if no listing supports key details, return no confirmed match.",
  },

  // 3 difficult / ambiguous image cases
  {
    id: "b30-ambiguous-watch-back",
    group: "difficult-ambiguous-image",
    query: "What kind of watch is this? Give likely alternatives if the image can't establish a brand or exact model.",
    intendedProduct: "Watch type/style only; exact brand and model intentionally unresolved",
    category: "watches",
    hardConstraints: ["Do not assert an exact brand/model without independent evidence", "Keep plausible alternatives distinct"],
    exactCriteria: ["No exact identity unless independently corroborated beyond image metadata."],
    closeCriteria: ["A cautious watch-type/style description or clearly qualified alternatives."],
    unacceptableCriteria: ["One unsupported exact brand/model claim.", "Using the Commons filename as visual proof."],
    expectedNoMatchBehavior: "If the visible evidence is insufficient to distinguish identity, state uncertainty and return no exact product match.",
    imageReference: pendingImage("rw-watch-openback"),
  },
  {
    id: "b30-ambiguous-headphones-scene",
    group: "difficult-ambiguous-image",
    query: "في الصورة أشياء كثيرة، دور لي على سماعة الرأس فقط، وخل الموديل غير محدد إذا ما بان",
    intendedProduct: "Headphones only, exact identity unresolved",
    category: "headphones",
    hardConstraints: ["Target headphones, not unrelated scene objects", "Do not infer exact model unless legible/verified"],
    exactCriteria: ["An exact model only where independently visible and corroborated."],
    closeCriteria: ["Headphones matching only the supported broad type or style; uncertainty stated."],
    unacceptableCriteria: ["Products unrelated to headphones.", "Model/brand assertion based on contextual photo or source title alone."],
    expectedNoMatchBehavior: "If the headphones cannot be isolated or identified reliably, return no exact match rather than guessing.",
    imageReference: pendingImage("rw-headphones-desk"),
  },
  {
    id: "b30-ambiguous-multiple-shoes",
    group: "difficult-ambiguous-image",
    query: "الصورة فيها أكثر من غرض؛ أبي الحذاء بس، وإذا ما قدرت تحدد الموديل عطِني وصف عام",
    intendedProduct: "The shoe, if identifiable; otherwise a broad shoe-type description",
    category: "shoes",
    hardConstraints: ["Target a shoe only", "Distinguish the shoe from other objects", "Do not assert exact model without evidence"],
    exactCriteria: ["Exact shoe identity only if independently verified from visible evidence, not metadata."],
    closeCriteria: ["A supported broad shoe category or style, with exact identity left unresolved."],
    unacceptableCriteria: ["Socks or unrelated objects treated as the target.", "Unsupported brand/model from the file title."],
    expectedNoMatchBehavior: "If the intended shoe cannot be confidently distinguished, state that and return no exact match.",
    imageReference: pendingImage("rw-shoes-socks"),
  },

  // 2 negative / no-match cases
  {
    id: "b30-negative-nonexistent-model",
    group: "negative-no-match",
    query: "Find an Apple iPhone 17 mini 64GB (the exact model, not a similar phone).",
    intendedProduct: "No confirmed exact product expected; requested model/storage combination must be verified before any match",
    category: "smartphones",
    identityEvidence: {
      type: "user-entered-model-or-sku",
      value: "iPhone 17 mini 64GB",
      limitation: "User-entered evidence only; not independently verified manufacturer identity or fitment.",
    },
    hardConstraints: ["Exact Apple iPhone 17 mini identity", "64 GB storage", "No substitute model"],
    exactCriteria: ["Only a listing independently establishing the exact requested product and storage could count as exact."],
    closeCriteria: [],
    unacceptableCriteria: ["Any other iPhone generation or size presented as a match.", "Invented product existence or specifications."],
    expectedNoMatchBehavior: "Return no match unless an authentic, verifiable listing for this exact requested configuration is found; do not invent or substitute.",
  },
  {
    id: "b30-negative-incompatible-charger",
    group: "negative-no-match",
    query: "Need an original MagSafe 3 charger for my 2017 MacBook Pro. Exact compatibility only, no USB-C substitute.",
    intendedProduct: "No confirmed compatible match expected; request may be incompatible and must be checked rather than assumed",
    category: "laptop-accessories",
    identityEvidence: {
      type: "user-entered-model-or-sku",
      value: "2017 MacBook Pro",
      limitation: "User-entered evidence only; not independently verified manufacturer identity or fitment.",
    },
    hardConstraints: ["Exact original MagSafe 3 charger", "For user-stated 2017 MacBook Pro", "No USB-C substitute", "Compatibility must be verified"],
    exactCriteria: ["Only an original charger with independently verified exact compatibility could count."],
    closeCriteria: [],
    unacceptableCriteria: ["USB-C charger, adapter, or other substitute.", "Claiming compatibility based solely on the user's device description."],
    expectedNoMatchBehavior: "If exact compatibility cannot be verified or no such compatible listing exists, explain the incompatibility uncertainty and return no match.",
  },
];