/**
 * Static real-image benchmark manifest. URLs point to Wikimedia Commons
 * thumbnails; no image binaries are copied into this repository.
 *
 * The Commons API metadata (file title, thumbnail URL, author and license) was
 * checked on 2026-09-29. This is a metadata check, not a claim that every pixel,
 * product identity, image condition, or visual property was independently
 * inspected. `label` is transcribed from the Commons file title and is not
 * benchmark ground truth.
 */
export type RealWorldScenario =
  | "image-only"
  | "image-plus-arabic"
  | "image-plus-english"
  | "exact-model-query"
  | "different-color-query"
  | "maximum-price-query"
  | "price-range-query"
  | "new-used-query"
  | "same-product-cheaper-query"
  | "similar-cheaper-query"
  | "complex-scene-query"
  | "ambiguous-identity-query"
  | "screen-containing-product-query"
  | "visible-detail-query"
  | "automotive-part-prompt-only"
  | "screenshot-prompt-only"
  | "multiple-objects-prompt-only";

export type RealWorldImageCase = {
  id: string;
  /** Commons file title, not an independently verified object annotation. */
  label: string;
  category: string;
  scenario: RealWorldScenario;
  query: string;
  imageUrl: string;
  sourcePageUrl: string;
  source: "Wikimedia Commons";
  author: string;
  license: string;
  licenseUrl: string;
  metadataCheckedAt: string;
  provenanceStatus: "commons-api-metadata-checked";
  scenarioIsPromptOnly: true;
  relevanceJudgments: "unavailable";
};

const checkedAt = "2026-09-29";
const unscaledApiThumbnails: Record<string, string> = {
  "rw-watch-montinari": "https://upload.wikimedia.org/wikipedia/commons/1/1b/Montinari_Milano.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail_unscaled",
  "rw-fashion-nina": "https://upload.wikimedia.org/wikipedia/commons/3/3c/1968_Nina_Ricci_evening_dress_from_the_V_and_A_fashion_gallery_-_geograph.org.uk_-_1162570.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail_unscaled",
  "rw-headphones-white": "https://upload.wikimedia.org/wikipedia/commons/6/63/Headphones_on_white_background.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail_unscaled",
};
const commons = (
  id: string,
  label: string,
  category: string,
  scenario: RealWorldScenario,
  query: string,
  filePath: string,
  author: string,
  license: string,
  licenseVersion: string,
): RealWorldImageCase => ({
  id,
  label,
  category,
  scenario,
  query,
  imageUrl: unscaledApiThumbnails[id] ?? `https://thumb.wikimedia.org/wikipedia/commons/thumb/${filePath}`,
  sourcePageUrl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(label).replace(/%20/g, "_")}`,
  source: "Wikimedia Commons",
  author,
  license: license === "CC0" ? license : `${license} ${licenseVersion}`,
  licenseUrl: license === "CC0"
    ? "https://creativecommons.org/publicdomain/zero/1.0/"
    : `https://creativecommons.org/licenses/${license.toLowerCase().replace(" ", "-")}/${licenseVersion}/`,
  metadataCheckedAt: checkedAt,
  provenanceStatus: "commons-api-metadata-checked",
  scenarioIsPromptOnly: true,
  relevanceJudgments: "unavailable",
});

/**
 * The URLs and file titles below came from Commons imageinfo metadata. The
 * `filePath` value includes the Commons thumbnail filename and size suffix.
 * Queries are challenge prompts, not claims about what each image depicts.
 */
export const REAL_WORLD_IMAGE_CASES: RealWorldImageCase[] = [
  commons("rw-bag-purse", "Purse (AM 13345-9).jpg", "handbags", "image-only", "", "9/99/Purse_%28AM_13345-9%29.jpg/960px-Purse_%28AM_13345-9%29.jpg", "LACHAUME", "CC BY", "4.0"),
  commons("rw-bag-retail", "Handbag at Nordstrom Rack - Santa Rosa - December 2022 - Sarah Stierch.jpg", "handbags", "image-plus-arabic", "أبغى شنطة مثل اللي بالصورة لكن باللون الأسود", "8/8f/Handbag_at_Nordstrom_Rack_-_Santa_Rosa_-_December_2022_-_Sarah_Stierch.jpg/960px-Handbag_at_Nordstrom_Rack_-_Santa_Rosa_-_December_2022_-_Sarah_Stierch.jpg", "Missvain", "CC BY", "4.0"),
  commons("rw-bag-material", "A handbag made with a skin of an animal.jpg", "handbags", "different-color-query", "Find a similar handbag in another color", "8/88/A_handbag_made_with_a_skin_of_an_animal.jpg/960px-A_handbag_made_with_a_skin_of_an_animal.jpg", "ALHASSAN MOHAMED NURIDEEN", "CC BY-SA", "4.0"),
  commons("rw-shoe-reebok", "Reebok Royal Glide Ripple Clip shoe.jpg", "shoes", "exact-model-query", "Identify the shoe model shown", "f/f0/Reebok_Royal_Glide_Ripple_Clip_shoe.jpg/960px-Reebok_Royal_Glide_Ripple_Clip_shoe.jpg", "Petar Milošević", "CC BY-SA", "4.0"),
  commons("rw-shoe-vans", "A Vans Sneaker On The Side.jpg", "shoes", "image-plus-english", "Find this sneaker or the closest matching model", "6/64/A_Vans_Sneaker_On_The_Side.jpg/960px-A_Vans_Sneaker_On_The_Side.jpg", "Joeltorresmejia78", "CC BY-SA", "4.0"),
  commons("rw-shoes-socks", "Vans sneakers and socks.jpg", "shoes", "multiple-objects-prompt-only", "Identify the shopping objects in this image", "f/f2/Vans_sneakers_and_socks.jpg/960px-Vans_sneakers_and_socks.jpg", "Downtowngal", "CC BY-SA", "4.0"),
  commons("rw-shoe-adidas", "2023 Adidas Yeezy 350 V2 EF2905 (1).jpg", "shoes", "same-product-cheaper-query", "Find the same shoe model cheaper", "6/69/2023_Adidas_Yeezy_350_V2_EF2905_%281%29.jpg/960px-2023_Adidas_Yeezy_350_V2_EF2905_%281%29.jpg", "Jacek Halicki", "CC BY-SA", "4.0"),
  commons("rw-shoe-avia", "Avia Shoes.jpg", "shoes", "similar-cheaper-query", "Find a visually similar, lower-priced shoe", "2/2f/Avia_Shoes.jpg/960px-Avia_Shoes.jpg", "Nave do Conhecimento", "CC0", "1.0"),
  commons("rw-watch-montinari", "Montinari Milano.jpg", "watches", "image-only", "", "1/1b/Montinari_Milano.jpg/960px-Montinari_Milano.jpg", "André Karwath aka Aka", "CC BY-SA", "2.5"),
  commons("rw-watch-junghans", "Junghans Mega.jpg", "watches", "exact-model-query", "Find this Junghans Mega watch", "c/c5/Junghans_Mega.jpg/960px-Junghans_Mega.jpg", "J. Lunau", "CC BY-SA", "3.0"),
  commons("rw-watch-openback", "Self-winding wristwatch (transparent backside).jpg", "watches", "ambiguous-identity-query", "Identify the watch type from the image; keep uncertain alternatives", "8/84/Self-winding_wristwatch_%28transparent_backside%29.jpg/960px-Self-winding_wristwatch_%28transparent_backside%29.jpg", "Petar Milošević", "CC BY-SA", "4.0"),
  commons("rw-watch-fossil", "Fossil wristwatch with white background.jpg", "watches", "maximum-price-query", "Find a similar watch under 500 SAR", "f/fd/Fossil_wristwatch_with_white_background.jpg/960px-Fossil_wristwatch_with_white_background.jpg", "Cvmontuy", "CC BY-SA", "4.0"),
  commons("rw-fashion-nina", "1968 Nina Ricci evening dress from the V and A fashion gallery - geograph.org.uk - 1162570.jpg", "fashion", "image-plus-english", "Find this style of evening dress", "3/3c/1968_Nina_Ricci_evening_dress_from_the_V_and_A_fashion_gallery_-_geograph.org.uk_-_1162570.jpg/960px-1968_Nina_Ricci_evening_dress_from_the_V_and_A_fashion_gallery_-_geograph.org.uk_-_1162570.jpg", "Zorba the Geek", "CC BY-SA", "2.0"),
  commons("rw-fashion-smart-casual", "Smart casual style, Dress code, Rostov-on-Don, Russia.jpg", "fashion", "image-plus-arabic", "أبغى ملابس بنفس الستايل وبحد أقصى 300 ريال", "9/9f/Smart_casual_style%2C_Dress_code%2C_Rostov-on-Don%2C_Russia.jpg/960px-Smart_casual_style%2C_Dress_code%2C_Rostov-on-Don%2C_Russia.jpg", "Vyacheslav Argenberg", "CC BY", "4.0"),
  commons("rw-fashion-undercover", "Jun Takahashi dress for Undercover (51492).jpg", "fashion", "price-range-query", "Find a similar dress priced between 100 and 500 SAR", "0/0e/Jun_Takahashi_dress_for_Undercover_%2851492%29.jpg/960px-Jun_Takahashi_dress_for_Undercover_%2851492%29.jpg", "Rhododendrites", "CC BY-SA", "4.0"),
  commons("rw-fashion-junon", "New Junon evening dress (51580).jpg", "fashion", "new-used-query", "Find a new dress with a similar silhouette", "1/17/New_Junon_evening_dress_%2851580%29.jpg/960px-New_Junon_evening_dress_%2851580%29.jpg", "Rhododendrites", "CC BY-SA", "4.0"),
  commons("rw-beauty-perfume", "Ivory Perfume Bottle; Deer Horn & Bone Cosmetics Box, 14th-13th C. BC (41406878370).jpg", "beauty", "image-plus-english", "Describe and find objects resembling the perfume bottle", "1/11/Ivory_Perfume_Bottle%3B_Deer_Horn_%26_Bone_Cosmetics_Box%2C_14th-13th_C._BC_%2841406878370%29.jpg/960px-Ivory_Perfume_Bottle%3B_Deer_Horn_%26_Bone_Cosmetics_Box%2C_14th-13th_C._BC_%2841406878370%29.jpg", "Gary Todd from Xinzheng, China", "CC0", "1.0"),
  commons("rw-headphones-1", "Headphones 1.jpg", "headphones", "image-only", "", "4/40/Headphones_1.jpg/960px-Headphones_1.jpg", "No machine-readable author; PJ assumed in Commons metadata", "CC BY-SA", "3.0"),
  commons("rw-headphones-white", "Headphones on white background.jpg", "headphones", "maximum-price-query", "Sony-style headphones under 500 SAR", "6/63/Headphones_on_white_background.jpg/960px-Headphones_on_white_background.jpg", "Sprinno", "CC0", "1.0"),
  commons("rw-headphones-bose", "Bose QuietComfort 25 Acoustic Noise Cancelling Headphones with Carry Case.jpg", "headphones", "exact-model-query", "Find Bose QuietComfort 25 headphones", "0/0a/Bose_QuietComfort_25_Acoustic_Noise_Cancelling_Headphones_with_Carry_Case.jpg/960px-Bose_QuietComfort_25_Acoustic_Noise_Cancelling_Headphones_with_Carry_Case.jpg", "Florian Fuchs", "CC BY-SA", "3.0"),
  commons("rw-headphones-desk", "Headphones on desk.jpg", "headphones", "complex-scene-query", "Find the headphones in this scene", "f/f6/Headphones_on_desk.jpg/960px-Headphones_on_desk.jpg", "Lirazelf", "CC BY-SA", "3.0"),
  commons("rw-headphones-passenger", "Passenger Experience Week 2024, headphones (P1180629).jpg", "headphones", "ambiguous-identity-query", "Identify headphones in a contextual photo", "2/2d/Passenger_Experience_Week_2024%2C_headphones_%28P1180629%29.jpg/960px-Passenger_Experience_Week_2024%2C_headphones_%28P1180629%29.jpg", "User:Celestinesucess", "CC BY-SA", "4.0"),
  commons("rw-phone-blackview-front", "Blackview A60 Smartphone Android mobile phone and folio case.jpg", "phones", "exact-model-query", "Find a Blackview A60 phone", "b/be/Blackview_A60_Smartphone_Android_mobile_phone_and_folio_case.jpg/960px-Blackview_A60_Smartphone_Android_mobile_phone_and_folio_case.jpg", "Acabashi", "CC BY-SA", "4.0"),
  commons("rw-phone-blackview-back", "Blackview A60 Smartphone Android mobile phone back face.jpg", "phones", "image-plus-arabic", "أبغى نفس الجوال من الخلف", "7/78/Blackview_A60_Smartphone_Android_mobile_phone_back_face.jpg/960px-Blackview_A60_Smartphone_Android_mobile_phone_back_face.jpg", "Acabashi", "CC BY-SA", "4.0"),
  commons("rw-phone-blackview-screen", "Blackview A60 Smartphone Android mobile phone front screen in standby mode.jpg", "phones", "different-color-query", "Find this phone model in another color", "c/cd/Blackview_A60_Smartphone_Android_mobile_phone_front_screen_in_standby_mode.jpg/960px-Blackview_A60_Smartphone_Android_mobile_phone_front_screen_in_standby_mode.jpg", "Acabashi", "CC BY-SA", "4.0"),
  commons("rw-phone-blackview-lock", "Blackview A60 Smartphone Android mobile phone front face lock screen.jpg", "phones", "image-plus-english", "Find this smartphone model", "1/14/Blackview_A60_Smartphone_Android_mobile_phone_front_face_lock_screen.jpg/960px-Blackview_A60_Smartphone_Android_mobile_phone_front_face_lock_screen.jpg", "Acabashi", "CC BY-SA", "4.0"),
  commons("rw-phone-blackview-logged", "Blackview A60 Smartphone Android mobile phone front face logged in screen.jpg", "phones", "screen-containing-product-query", "Identify the phone from this screen-containing image", "1/12/Blackview_A60_Smartphone_Android_mobile_phone_front_face_logged_in_screen.jpg/960px-Blackview_A60_Smartphone_Android_mobile_phone_front_face_logged_in_screen.jpg", "Acabashi", "CC BY-SA", "4.0"),
  commons("rw-coffee-delonghi", "Pictograms on electric coffee machine DeLonghi of type Nespresso.jpg", "consumer-electronics", "exact-model-query", "Find the DeLonghi Nespresso machine", "0/04/Pictograms_on_electric_coffee_machine_DeLonghi_of_type_Nespresso.jpg/960px-Pictograms_on_electric_coffee_machine_DeLonghi_of_type_Nespresso.jpg", "Pittigrilli", "CC BY-SA", "4.0"),
  commons("rw-coffee-philips", "Pictograms and buttons on Philips coffee machine (cropped).jpeg", "consumer-electronics", "visible-detail-query", "Try identifying this Philips coffee machine from the supplied image", "3/36/Pictograms_and_buttons_on_Philips_coffee_machine_%28cropped%29.jpeg/960px-Pictograms_and_buttons_on_Philips_coffee_machine_%28cropped%29.jpeg", "Pittigrilli", "CC BY-SA", "4.0"),
  commons("rw-coffee-hamilton-new", "Our new coffee maker (2006) Hamilton Beach.jpg", "consumer-electronics", "similar-cheaper-query", "Find a similar coffee maker for less", "b/b9/Our_new_coffee_maker_%282006%29_Hamilton_Beach.jpg/960px-Our_new_coffee_maker_%282006%29_Hamilton_Beach.jpg", "Joe Hall", "CC BY", "2.0"),
  commons("rw-coffee-frappe", "Coffee Machine - Today's word is Frappe.jpg", "consumer-electronics", "image-plus-arabic", "أبي ماكينة قهوة مشابهة بسعر أقل", "c/c0/Coffee_Machine_-_Today%27s_word_is_Frappe.jpg/960px-Coffee_Machine_-_Today%27s_word_is_Frappe.jpg", "Andy Rogers", "CC BY-SA", "2.0"),
  commons("rw-coffee-hamilton-home", "Hamilton Beach home coffee maker.jpg", "consumer-electronics", "same-product-cheaper-query", "Find this coffee-maker model at a lower price", "b/bb/Hamilton_Beach_home_coffee_maker.jpg/960px-Hamilton_Beach_home_coffee_maker.jpg", "Infrogmation of New Orleans", "CC BY-SA", "4.0"),
  commons("rw-auto-headlamp-bracket", "Nomination 56 - Safety - Integrated Headlamp-Hood Bump-Stop Bracket (8116070903).jpg", "automotive-parts", "automotive-part-prompt-only", "Try to identify the automotive part pictured; do not infer fitment", "c/c6/Nomination_56_-_Safety_-_Integrated_Headlamp-Hood_Bump-Stop_Bracket_%288116070903%29.jpg/960px-Nomination_56_-_Safety_-_Integrated_Headlamp-Hood_Bump-Stop_Bracket_%288116070903%29.jpg", "spe.automotive", "CC BY", "2.0"),
  commons("rw-auto-headlamp", "IAA-2005-S-Class Light.jpg", "automotive-parts", "automotive-part-prompt-only", "Describe the pictured vehicle-light component without asserting compatibility", "e/ea/IAA-2005-S-Class_Light.jpg/960px-IAA-2005-S-Class_Light.jpg", "Sjr at de.wikipedia", "CC BY-SA", "3.0"),
  commons("rw-app-screenshot", "The portal to the Universe iPad app screenshot (ann1106c).jpg", "screenshot-context", "screenshot-prompt-only", "Use this app screenshot as an image-input stress prompt", "a/a1/The_portal_to_the_Universe_iPad_app_screenshot_%28ann1106c%29.jpg/960px-The_portal_to_the_Universe_iPad_app_screenshot_%28ann1106c%29.jpg", "ESA/Victor R. Ruiz", "CC BY", "4.0"),
];

/**
 * Categories in the source brief that need more intentional capture/curation.
 * The manifest's scenario field describes a query/task prompt only. It does
 * not assert that a prompt's desired model, price, color, condition, merchant,
 * OCR text, or result exists in the image or a candidate catalog.
 *
 * New automotive-part and app-screenshot entries are prompt-only, source-title
 * representatives. Neither the asset pixels nor part identity/compatibility
 * have been independently reviewed; the app screenshot is not a shopping
 * screenshot. The phone screen photos are not screenshots. The plural shoe
 * title is a prompt-only multiple-object cue, not a visually verified scene.
 * No independently validated low-quality image, automotive OEM truth, or
 * known merchant/listing price is currently included.
 */
export const NOT_YET_REPRESENTED_SCENARIOS = [
  "automotive OEM compatibility / verified part identity",
  "genuine social-media or shopping screenshot",
  "visually validated low-quality input",
  "visually validated multiple shopping objects",
  "used/new ground truth",
  "brand/model/SKU/OCR ground truth",
  "same product cheaper / price constraints with known listings",
] as const;