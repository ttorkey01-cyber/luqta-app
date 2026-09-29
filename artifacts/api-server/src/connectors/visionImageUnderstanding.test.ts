import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createVisionLimiter,
  isBoundedJpegDataUrl,
  normalizeImageUnderstanding,
  visionLimitResponse,
} from "../routes/visionHelpers";

test("low-confidence image understanding requires confirmation", () => {
  const result = normalizeImageUnderstanding({
    primaryCandidate: {
      name: "احتمال طاولة",
      query: "طاولة",
      confidence: 0.56,
      productType: "طاولة",
      brand: null,
      color: null,
      attributes: [],
    },
    alternatives: [],
  });

  assert.equal(result.needsConfirmation, true);
  assert.equal(result.primaryCandidate?.query, "طاولة");
});

test("high-confidence image understanding can continue without confirmation", () => {
  const result = normalizeImageUnderstanding({
    primaryCandidate: {
      name: "حقيبة",
      query: "حقيبة جلد",
      confidence: 0.94,
      productType: "حقيبة",
      brand: null,
      color: "أسود",
      attributes: ["جلد"],
    },
    alternatives: [
      {
        name: "محفظة",
        query: "محفظة",
        confidence: 0.38,
      },
    ],
  });

  assert.equal(result.needsConfirmation, false);
  assert.equal(result.primaryCandidate?.brand, null);
});

test("brand claims are omitted below the high-confidence threshold", () => {
  const result = normalizeImageUnderstanding({
    primaryCandidate: {
      name: "حقيبة Guess",
      query: "حقيبة Guess جلد",
      confidence: 0.94,
      productType: "حقيبة Guess",
      brand: "Guess",
    },
  });

  assert.equal(result.primaryCandidate?.brand, null);
  assert.equal(result.primaryCandidate?.query, "حقيبة جلد");
  assert.equal(result.primaryCandidate?.name, "حقيبة");
  assert.equal(result.primaryCandidate?.productType, "حقيبة");
});

test("ambiguous top candidates require confirmation and scores are bounded", () => {
  const result = normalizeImageUnderstanding({
    primaryCandidate: {
      name: "جهاز",
      query: "جهاز",
      confidence: 1.4,
    },
    alternatives: [{ name: "أداة", query: "أداة", confidence: 0.93 }],
  });

  assert.equal(result.primaryCandidate?.confidence, 1);
  assert.equal(result.needsConfirmation, true);
});

test("image payload accepts only bounded JPEG data URLs", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");
  assert.equal(isBoundedJpegDataUrl(`data:image/jpeg;base64,${jpeg}`), true);
  assert.equal(isBoundedJpegDataUrl("data:image/png;base64,YWJj"), false);
  assert.equal(isBoundedJpegDataUrl("file:///tmp/photo.jpg"), false);
  assert.equal(isBoundedJpegDataUrl("data:image/jpeg;base64,abc"), false);
});

test("vision limiter returns a retryable rejection after the per-client rate limit", () => {
  const limiter = createVisionLimiter({
    maxRequestsPerClientPerWindow: 1,
    maxConcurrent: 4,
    windowMs: 60_000,
  });
  const first = limiter.acquire("device-a", 1_000);
  assert.equal(first.admitted, true);
  if (!first.admitted) return;
  first.release();

  const rejected = limiter.acquire("device-a", 2_000);
  assert.deepEqual(rejected, {
    admitted: false,
    reason: "rate",
  });
  if (!rejected.admitted) {
    const response = visionLimitResponse(rejected.reason);
    assert.equal(response.status, 429);
    assert.equal(response.retryAfter, "60");
    assert.match(response.error, /الحد المؤقت/);
  }
  const nextWindow = limiter.acquire("device-a", 61_000);
  assert.equal(nextWindow.admitted, true);
  if (nextWindow.admitted) nextWindow.release();
});

test("vision limiter bounds concurrent model calls and releases slots once", () => {
  const limiter = createVisionLimiter({
    maxConcurrent: 1,
    maxRequestsPerClientPerWindow: 5,
    maxRequestsGloballyPerWindow: 5,
  });
  const first = limiter.acquire("device-a", 10_000);
  assert.equal(first.admitted, true);
  assert.deepEqual(limiter.acquire("device-b", 10_000), {
    admitted: false,
    reason: "capacity",
  });
  if (!first.admitted) return;
  first.release();
  first.release();
  const afterRelease = limiter.acquire("device-b", 10_001);
  assert.equal(afterRelease.admitted, true);
  if (afterRelease.admitted) afterRelease.release();
});