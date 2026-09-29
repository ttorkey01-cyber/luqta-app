import {
  interpretProductImage,
  type ImageCandidate,
  type ImageUnderstanding,
} from '@workspace/api-client-react';

export type { ImageCandidate, ImageUnderstanding };

export const MAX_JPEG_DATA_URL_LENGTH = 1_400_000;

export function jpegDataUrlFromBase64(
  base64: string | null | undefined,
  mimeType?: string | null,
): string {
  if (
    !base64 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) ||
    base64.length % 4 !== 0 ||
    (mimeType != null && !['image/jpeg', 'image/jpg'].includes(mimeType)) ||
    !base64.startsWith('/9j/')
  ) {
    throw new Error(
      'يدعم البحث بالصورة ملفات JPEG فقط حالياً. اختر صورة JPEG أو التقط صورة جديدة.',
    );
  }
  const dataUrl = `data:image/jpeg;base64,${base64}`;
  if (dataUrl.length > MAX_JPEG_DATA_URL_LENGTH) {
    throw new Error('حجم الصورة كبير. اختر صورة أصغر أو التقط صورة جديدة.');
  }
  return dataUrl;
}

export function needsImageConfirmation(
  understanding: ImageUnderstanding,
): boolean {
  return understanding.needsConfirmation || !understanding.primaryCandidate;
}

export function mergeVisualSearchQuery(
  candidate: ImageCandidate,
  userText: string,
): string {
  const text = userText.trim();
  const visualQuery = hasExplicitColor(text)
    ? removeColorWords(candidate.query)
    : candidate.query.trim();
  return [visualQuery, text].filter(Boolean).join(' ');
}

const COLOR_WORDS: Record<string, string[]> = {
  black: ['black', 'أسود', 'اسود', 'سوداء', 'سودا'],
  white: ['white', 'أبيض', 'ابيض', 'بيضاء'],
  red: ['red', 'أحمر', 'احمر', 'حمراء'],
  blue: ['blue', 'أزرق', 'ازرق', 'زرقاء'],
  green: ['green', 'أخضر', 'اخضر', 'خضراء'],
  yellow: ['yellow', 'أصفر', 'اصفر', 'صفراء'],
  pink: ['pink', 'وردي', 'وردية', 'زهري', 'زهرية'],
  brown: ['brown', 'بني', 'بنية'],
  gray: ['gray', 'grey', 'رمادي', 'رمادية'],
  orange: ['orange', 'برتقالي', 'برتقالية'],
  purple: ['purple', 'بنفسجي', 'بنفسجية'],
};

const allColorWords = Object.values(COLOR_WORDS).flat();
const arabicColorWords = allColorWords
  .filter((word) => /[\u0600-\u06ff]/.test(word))
  .join('|');
const englishColorWords = allColorWords
  .filter((word) => !/[\u0600-\u06ff]/.test(word))
  .join('|');
const arabicColorPattern = new RegExp(`(?:${arabicColorWords})`, 'u');
const arabicColorRemovalPattern = new RegExp(`(?:${arabicColorWords})`, 'gu');
const englishColorPattern = new RegExp(`\\b(?:${englishColorWords})\\b`, 'i');
const englishColorRemovalPattern = new RegExp(
  `\\b(?:${englishColorWords})\\b`,
  'gi',
);

function hasExplicitColor(text: string): boolean {
  return arabicColorPattern.test(text) || englishColorPattern.test(text);
}

function removeColorWords(text: string): string {
  return text
    .replace(arabicColorRemovalPattern, ' ')
    .replace(englishColorRemovalPattern, ' ')
    .replace(/[،,؛;:()[\]{}]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

class VisualSearchService {
  async interpret(
    imageDataUrl: string,
    userText: string,
  ): Promise<ImageUnderstanding> {
    return interpretProductImage({
      imageDataUrl,
      ...(userText.trim() ? { userText: userText.trim() } : {}),
    });
  }
}

export const visualSearchService = new VisualSearchService();