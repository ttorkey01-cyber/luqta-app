import assert from 'node:assert/strict';
import { test } from 'node:test';
import { productOutboundUrl } from '../types/outboundLink.ts';

function officialLink(productPage) {
  return `https://bywiola.com/g/official?f_id=feed-value&ulp=${encodeURIComponent(productPage)}`;
}

test('Android Deal Outlet opens each exact official feed product page, not the Play redirect', () => {
  for (const id of ['bag-1', 'shoe-2', 'watch-3', 'dress-4', 'accessory-5']) {
    const page = `https://www.thedealoutlet.com/ar-sa/products/${id}?variant=original`;
    const affiliateUrl = officialLink(page);
    const product = { source: 'deal-outlet', affiliateUrl, productUrl: affiliateUrl };
    assert.equal(productOutboundUrl(product, true), page);
    assert.equal(productOutboundUrl(product, false), affiliateUrl);
    assert.equal(product.affiliateUrl, affiliateUrl, 'the official affiliate URL remains unchanged');
  }
});

test('Android Deal Outlet never opens an unverified tracker or unrelated destination', () => {
  for (const link of [
    officialLink('https://play.google.com/store/apps/details?id=example'),
    officialLink('https://www.thedealoutlet.com.evil.test/ar-sa/products/bag'),
    officialLink('http://www.thedealoutlet.com/ar-sa/products/bag'),
    officialLink('https://user@www.thedealoutlet.com/ar-sa/products/bag'),
    officialLink('https://www.thedealoutlet.com/'),
    'https://bywiola.com/g/official?f_id=feed-value',
    'https://other-tracker.test/g/official?ulp=https%3A%2F%2Fwww.thedealoutlet.com%2Fp%2Fbag',
  ]) {
    assert.equal(
      productOutboundUrl({ source: 'deal-outlet', affiliateUrl: link, productUrl: link }, true),
      undefined,
    );
  }
});

test('all other providers preserve affiliate-first outbound behavior', () => {
  for (const source of ['aliexpress', 'nazih', 'stylewe', 'diesel', 'luxury-closet', 'huawei']) {
    const product = {
      source,
      affiliateUrl: 'https://tracking.example.test/product?click=official',
      productUrl: 'https://merchant.example.test/product',
    };
    assert.equal(productOutboundUrl(product, true), product.affiliateUrl, source);
    assert.equal(productOutboundUrl(product, false), product.affiliateUrl, source);
    assert.equal(productOutboundUrl({ ...product, affiliateUrl: null }, true), product.productUrl);
  }
  assert.equal(productOutboundUrl({ source: 'diesel', affiliateUrl: 'market://details' }, true), undefined);
});