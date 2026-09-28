import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProductResult } from '../types/search';
import { buildHuntDiscoveryMatches } from './huntDiscovery';

function product(
  id: string,
  overrides: Partial<ProductResult> = {},
): ProductResult {
  return {
    id,
    title: id,
    gallery: [],
    source: 'test',
    sourceType: 'merchant',
    availability: 'unknown',
    isAffiliate: false,
    matchScore: 1,
    priceScore: 1,
    relevanceScore: 1,
    ...overrides,
  };
}

test('classifies verified target-price results separately from unknown prices', () => {
  const matches = buildHuntDiscoveryMatches(
    [
      product('within', { price: 650, currency: 'SAR' }),
      product('above', { price: 750, currency: 'SAR' }),
      product('unknown'),
      product('unverified-currency', { price: 50, currency: 'USD' }),
    ],
    700,
    'SAR',
  );

  assert.deepEqual(
    matches.map(({ id, priceStatus, price }) => ({ id, priceStatus, price })),
    [
      { id: 'within', priceStatus: 'within_budget', price: 650 },
      { id: 'above', priceStatus: 'above_budget', price: 750 },
      { id: 'unknown', priceStatus: 'unavailable', price: null },
      {
        id: 'unverified-currency',
        priceStatus: 'unavailable',
        price: null,
      },
    ],
  );
});

test('a known price without a target is not presented as a budget match', () => {
  const [match] = buildHuntDiscoveryMatches(
    [product('watch', { price: 500, currency: 'SAR' })],
    undefined,
    'SAR',
  );

  assert.equal(match.priceStatus, 'known');
  assert.equal(match.price, 500);
});