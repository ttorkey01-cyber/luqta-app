import assert from 'node:assert/strict';
import { test } from 'node:test';
import { luxuryClosetAndroidImageUri, nextProductImageUrl, shouldShowDieselLogo, shouldTryNazihImageProxy } from '../types/imageFallback.ts';

test('a failed official image advances to the next official image before using the logo', () => {
  const original = 'https://diesel.example.test/original.jpg';
  const alternate = 'https://diesel.example.test/alternate.jpg';
  assert.equal(nextProductImageUrl([original, alternate], new Set()), original);
  assert.equal(nextProductImageUrl([original, alternate], new Set([original])), alternate);
  assert.equal(shouldShowDieselLogo('diesel', true), false);
  assert.equal(nextProductImageUrl([original, alternate], new Set([original, alternate])), undefined);
  assert.equal(shouldShowDieselLogo('diesel', false), true);
});

test('missing or blank image URLs use the logo only for Diesel', () => {
  assert.equal(nextProductImageUrl(['', '  ', 'javascript:alert(1)', 'ftp://merchant.test/image.jpg'], new Set()), undefined);
  assert.equal(shouldShowDieselLogo('diesel', false), true);
  assert.equal(shouldShowDieselLogo('nazih', false), false);
  assert.equal(shouldShowDieselLogo('luxury-closet', false), false);
  assert.equal(shouldShowDieselLogo('brave-web', false), false);
});

test('an approved Nazih proxy is attempted only once, on Android, after its official image fails', () => {
  const image = 'https://nazih.sa/media/catalog/product/item.jpg';
  const proxy = 'https://app.example.test/api/images/nazih?url=approved';
  const attempted = new Set();
  assert.equal(shouldTryNazihImageProxy('nazih', true, image, attempted, proxy), true);
  attempted.add(image);
  assert.equal(shouldTryNazihImageProxy('nazih', true, image, attempted, proxy), false);
  assert.equal(shouldTryNazihImageProxy('nazih', true, image, new Set(), undefined), false);
  assert.equal(shouldTryNazihImageProxy('nazih', false, image, new Set(), proxy), false);
  for (const provider of ['aliexpress', 'diesel', 'stylewe', 'luxury-closet', 'deal-outlet', 'huawei']) {
    assert.equal(shouldTryNazihImageProxy(provider, true, image, new Set(), proxy), false, provider);
  }
});

test('all official feed providers exhaust failing images and render only their approved placeholder', () => {
  for (const provider of ['nazih', 'aliexpress', 'diesel', 'stylewe', 'luxury-closet', 'deal-outlet', 'huawei']) {
    const original = `https://${provider}.example.test/a.jpg`;
    const alternate = `https://${provider}.example.test/b.jpg`;
    const failed = new Set();
    assert.equal(nextProductImageUrl([original, alternate], failed), original, provider);
    failed.add(original);
    assert.equal(nextProductImageUrl([original, alternate], failed), alternate, provider);
    failed.add(alternate);
    assert.equal(nextProductImageUrl([original, alternate], failed), undefined, provider);
    assert.equal(shouldShowDieselLogo(provider, false), provider === 'diesel', provider);
  }
});

test('Luxury Closet Android loads the same official CDN image directly over HTTPS', () => {
  for (const path of [
    '/products/bag/front.jpg',
    '/products/watch/side%20view.jpg?size=large&view=2',
    '/products/shoes/back.jpg',
  ]) {
    const original = `http://cdn.theluxurycloset.com${path}`;
    assert.equal(
      luxuryClosetAndroidImageUri(original, 'luxury-closet', true),
      `https://cdn.theluxurycloset.com${path}`,
    );
    assert.equal(luxuryClosetAndroidImageUri(original, 'luxury-closet', false), original);
    assert.equal(luxuryClosetAndroidImageUri(original, 'diesel', true), original);
  }
});

test('Luxury Closet leaves other image hosts, HTTPS URLs and unsafe URLs unchanged', () => {
  for (const url of [
    'https://cdn.theluxurycloset.com/products/bag.jpg',
    'http://other.example.test/products/bag.jpg',
    'http://cdn.theluxurycloset.com.example.test/products/bag.jpg',
    'http://user@cdn.theluxurycloset.com/products/bag.jpg',
    'http://cdn.theluxurycloset.com:8080/products/bag.jpg',
    'invalid-image-url',
  ]) {
    assert.equal(luxuryClosetAndroidImageUri(url, 'luxury-closet', true), url);
  }
});