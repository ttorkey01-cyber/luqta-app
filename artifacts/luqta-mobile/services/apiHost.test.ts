import assert from 'node:assert/strict';
import test from 'node:test';
import { getHomePicks, searchProducts } from '../../../lib/api-client-react/src/generated/api';
import { getBaseUrl, setBaseUrl } from '../../../lib/api-client-react/src/custom-fetch';
import {
  PRODUCTION_API_BASE_URL,
  resolveMobileApiBaseUrl,
} from './apiHost';

test('release host is absolute with or without EAS Update environment injection', () => {
  assert.equal(
    resolveMobileApiBaseUrl(false, undefined),
    PRODUCTION_API_BASE_URL,
  );
  assert.equal(
    resolveMobileApiBaseUrl(false, 'a-wrong-development-host.replit.dev'),
    PRODUCTION_API_BASE_URL,
  );
  assert.match(PRODUCTION_API_BASE_URL, /^https:\/\//);
  assert.equal(new URL(PRODUCTION_API_BASE_URL).origin, PRODUCTION_API_BASE_URL);
  assert.notEqual(resolveMobileApiBaseUrl(false), null);
});

test('development keeps its configured domain override and existing missing-domain behavior', () => {
  assert.equal(resolveMobileApiBaseUrl(true, 'dev.example.test'), 'https://dev.example.test');
  assert.equal(resolveMobileApiBaseUrl(true, undefined), null);
  assert.equal(resolveMobileApiBaseUrl(true, ''), null);
});

test('generated search, category, and Home requests use the absolute release API origin', async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  setBaseUrl(resolveMobileApiBaseUrl(false, undefined));
  globalThis.fetch = async (input) => {
    urls.push(String(input));
    return new Response(JSON.stringify({ products: [], total: 0 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    assert.equal(getBaseUrl(), PRODUCTION_API_BASE_URL);
    await searchProducts({ query: 'phone', searchMode: 'intent' });
    await searchProducts({
      query: 'الإلكترونيات',
      category: 'electronics',
      searchMode: 'category_browse',
      page: 1,
      pageSize: 24,
    });
    await getHomePicks();
    assert.deepEqual(urls, [
      `${PRODUCTION_API_BASE_URL}/api/search`,
      `${PRODUCTION_API_BASE_URL}/api/search`,
      `${PRODUCTION_API_BASE_URL}/api/home/picks`,
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    setBaseUrl(null);
  }
});