import assert from 'node:assert/strict';
import test from 'node:test';
import {
  customFetch,
  setBaseUrl,
  setProductRequestObserver,
} from '../../../lib/api-client-react/src/custom-fetch';
import {
  clearProductDiagnostics,
  getProductDiagnostics,
  recordProductPipeline,
  recordProductRequest,
} from './productDiagnostics';

const originalFetch = globalThis.fetch;

test('a mocked 24-product category response passes through unchanged with full pipeline counts', async () => {
  clearProductDiagnostics();
  setBaseUrl('https://example.replit.app');
  setProductRequestObserver(recordProductRequest);
  let requestedUrl = '';
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({
      products: Array.from({ length: 24 }, (_, id) => ({ id })),
      total: 838,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const response = await customFetch<{ products: { id: number }[]; total: number }>(
      '/api/search', {
        method: 'POST',
        body: JSON.stringify({
          query: 'الأجهزة', category: 'electronics',
          searchMode: 'category_browse', page: 1, pageSize: 24,
        }),
      },
    );
    const mapped = response.products.map((product) => ({ ...product }));
    const filtered = mapped.filter(() => true);
    const passedToList = [...filtered];
    recordProductPipeline('category', {
      received: response.products.length,
      mapped: mapped.length,
      filtered: filtered.length,
      rendered: passedToList.length,
    });
    const diagnostic = getProductDiagnostics().category;
    assert.equal(requestedUrl, 'https://example.replit.app/api/search');
    assert.equal(response.products.length, 24, 'the API response is unchanged');
    assert.equal(diagnostic?.status, 200);
    assert.equal(diagnostic?.productCount, 24);
    assert.equal(diagnostic?.total, 838);
    assert.equal(diagnostic?.category, 'electronics');
    assert.deepEqual(
      [
        diagnostic?.pipeline?.received,
        diagnostic?.pipeline?.mapped,
        diagnostic?.pipeline?.filtered,
        diagnostic?.pipeline?.rendered,
      ],
      [24, 24, 24, 24],
    );
    assert.ok(!JSON.stringify(diagnostic).includes('الأجهزة'), 'query is not stored');
  } finally {
    globalThis.fetch = originalFetch;
    setProductRequestObserver(null);
    setBaseUrl(null);
  }
});

test('503 inventory unavailable and transport failures are distinct and cannot alter requests', async () => {
  clearProductDiagnostics();
  setProductRequestObserver(recordProductRequest);
  globalThis.fetch = async () => new Response(
    JSON.stringify({ code: 'INVENTORY_UNAVAILABLE', providerIds: ['feed'] }),
    { status: 503, headers: { 'content-type': 'application/json' } },
  );
  try {
    await assert.rejects(
      customFetch('/api/search', {
        method: 'POST',
        body: JSON.stringify({ query: 'private@example.com', searchMode: 'intent' }),
      }),
      (error: unknown) =>
        error instanceof Error && 'status' in error && error.status === 503,
    );
    const failed = getProductDiagnostics().search;
    assert.equal(failed?.status, 503);
    assert.equal(failed?.errorCode, 'INVENTORY_UNAVAILABLE');
    assert.equal(failed?.productCount, null);
    assert.ok(!JSON.stringify(failed).includes('private@example.com'));

    globalThis.fetch = async () => { throw new TypeError('Network failed'); };
    await assert.rejects(
      customFetch('/api/search', {
        method: 'POST',
        body: JSON.stringify({ query: 'phone', searchMode: 'intent' }),
      }),
      TypeError,
    );
    const network = getProductDiagnostics().search;
    assert.equal(network?.status, null);
    assert.equal(network?.errorCode, 'NETWORK_ERROR');
    assert.equal(network?.productCount, null);
  } finally {
    globalThis.fetch = originalFetch;
    setProductRequestObserver(null);
  }
});

test('diagnostic failures do not alter successful product responses; clear removes only diagnostics', async () => {
  clearProductDiagnostics();
  setProductRequestObserver(() => { throw new Error('observer error'); });
  globalThis.fetch = async () => new Response(
    JSON.stringify({ products: [{ id: 'unchanged' }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
  try {
    const response = await customFetch<{ products: { id: string }[] }>('/api/home/picks');
    assert.deepEqual(response.products, [{ id: 'unchanged' }]);
    setProductRequestObserver(recordProductRequest);
    await customFetch('/api/home/picks');
    assert.equal(getProductDiagnostics().home?.productCount, 1);
    clearProductDiagnostics();
    assert.deepEqual(getProductDiagnostics(), {});
    assert.deepEqual(response.products, [{ id: 'unchanged' }]);
  } finally {
    globalThis.fetch = originalFetch;
    setProductRequestObserver(null);
  }
});