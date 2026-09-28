type FeedRecord = Record<string, string | undefined>;

const IMAGE_FIELD = /^(?:picture|image|image_link|image_url|picture_url|product_image|main_image)(?:_?\d+)?$/u;

function normalizeFieldName(value: string) {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
}

function safeImageUrl(value: string | undefined) {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  try {
    const parsed = new URL(normalized);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? normalized
      : undefined;
  } catch {
    return undefined;
  }
}

export function collectFeedImageUrls(
  record: FeedRecord,
  preferredFields: string[],
) {
  const valuesByField = new Map(
    Object.entries(record).map(([field, value]) => [
      normalizeFieldName(field),
      value,
    ]),
  );
  const additionalFields = [...valuesByField.keys()]
    .filter((field) => IMAGE_FIELD.test(field))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const fields = [
    ...preferredFields.map(normalizeFieldName),
    ...additionalFields,
  ];
  const seen = new Set<string>();
  const images: string[] = [];

  for (const field of fields) {
    const image = safeImageUrl(valuesByField.get(field));
    if (!image) continue;
    const key = image.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    images.push(image);
  }
  return images;
}