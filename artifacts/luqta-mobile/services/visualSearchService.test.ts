import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ImageCandidate, ImageUnderstanding } from '@workspace/api-client-react';
import {
  jpegDataUrlFromBase64,
  mergeVisualSearchQuery,
  needsImageConfirmation,
} from './visualSearchService';

const candidate: ImageCandidate = {
  name: 'حقيبة',
  query: 'حقيبة جلد',
  confidence: 0.92,
  productType: 'حقيبة',
  brand: null,
  color: null,
  attributes: ['جلد'],
};

function understanding(
  needsConfirmation: boolean,
  primaryCandidate: ImageCandidate | null = candidate,
): ImageUnderstanding {
  return {
    primaryCandidate,
    alternatives: [],
    confidence: primaryCandidate?.confidence ?? 0,
    needsConfirmation,
  };
}

test('low-confidence image results require confirmation', () => {
  assert.equal(needsImageConfirmation(understanding(true)), true);
  assert.equal(needsImageConfirmation(understanding(false, null)), true);
});

test('high-confidence image results can continue normally', () => {
  assert.equal(needsImageConfirmation(understanding(false)), false);
});

test('visual query keeps user text and its strict budget together', () => {
  assert.equal(
    mergeVisualSearchQuery(
      { ...candidate, query: 'شنطة حمراء', color: 'red' },
      'أبغى نفس هذا بس أسود وأقل من 300 ريال',
    ),
    'شنطة أبغى نفس هذا بس أسود وأقل من 300 ريال',
  );
});

test('user color removes conflicting visual color while preserving other visual facts', () => {
  assert.equal(
    mergeVisualSearchQuery(
      { ...candidate, query: 'red leather handbag', color: 'red' },
      'black under 300 SAR',
    ),
    'leather handbag black under 300 SAR',
  );
});

test('without an explicit user color, visual color remains unchanged', () => {
  assert.equal(
    mergeVisualSearchQuery(
      { ...candidate, query: 'شنطة حمراء جلد', color: 'red' },
      'أقل من 300 ريال',
    ),
    'شنطة حمراء جلد أقل من 300 ريال',
  );
});

test('visual search uses the identified object instead of a hardcoded chair', () => {
  const query = mergeVisualSearchQuery(candidate, '');
  assert.equal(query, 'حقيبة جلد');
  assert.equal(query.includes('كرسي'), false);
});

test('photo data URLs are bounded JPEG data URLs', () => {
  const jpegBase64 = '/9j/2Q==';
  assert.equal(
    jpegDataUrlFromBase64(jpegBase64, 'image/jpeg'),
    `data:image/jpeg;base64,${jpegBase64}`,
  );
  assert.throws(
    () => jpegDataUrlFromBase64('iVBORw0KGgo=', 'image/png'),
    /JPEG/,
  );
  assert.throws(
    () => jpegDataUrlFromBase64('UklGRg==', 'image/webp'),
    /JPEG/,
  );
  assert.throws(() => jpegDataUrlFromBase64(jpegBase64, 'image/png'));
  assert.throws(() => jpegDataUrlFromBase64('not base64!'));
  assert.throws(() => jpegDataUrlFromBase64('A==='));
});