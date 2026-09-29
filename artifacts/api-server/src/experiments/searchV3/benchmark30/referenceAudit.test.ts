import assert from "node:assert/strict";
import test from "node:test";
import { buildReferenceAudit, canonicalDefinitionsSha256 } from "./referenceAudit";

test("offline reference audit describes all 30 frozen cases and 11 linked references without scoring", async () => {
  let fetchCalls = 0;
  const report = await buildReferenceAudit({
    date: "2026-09-29",
    fetch: async () => {
      fetchCalls += 1;
      throw new Error("offline audit must not make network requests");
    },
  });

  assert.equal(fetchCalls, 0);
  assert.equal(report.caseCount, 30);
  assert.equal(report.caseIds.length, 30);
  assert.equal(new Set(report.caseIds).size, 30);
  assert.deepEqual(report.groupCounts, {
    "exact-product-identity": 6,
    "visually-similar": 6,
    "hard-constraints": 5,
    automotive: 4,
    "saudi-arabic": 4,
    "difficult-ambiguous-image": 3,
    "negative-no-match": 2,
  });
  assert.equal(report.referenceCount, 11);
  assert.equal(report.references.length, 11);
  assert.ok(report.references.every((reference) =>
    reference.source === "Wikimedia Commons"
      && reference.sourcePageUrl.startsWith("https://commons.wikimedia.org/wiki/File:")
      && reference.author.trim().length > 0
      && reference.license.trim().length > 0
      && reference.licenseUrl.startsWith("https://creativecommons.org/")
      && reference.network.status === "not-checked"
      && reference.visualIdentityVerification === "UNVERIFIED"));
  assert.equal(report.networkCheckEnabled, false);
  assert.equal(report.frozenDefinitionsSha256, canonicalDefinitionsSha256());
  assert.match(report.frozenDefinitionsSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(report.evaluation.arms.map(({ status }) => status), ["NOT RUN", "NOT RUN", "NOT RUN"]);
  assert.equal(report.evaluation.perCaseScores.length, 30);
  assert.ok(report.evaluation.perCaseScores.every(({ score }) => score === null));
  assert.deepEqual(report.evaluation.actualActivity, {
    modelCalls: 0,
     queryImageCalls: 0,
     candidateImageCalls: 0,
     cacheHits: 0,
     cacheMisses: 0,
     embeddingDimension: 768,
     estimatedCostUsd: 0,
  });
   assert.ok(report.blockers.some((blocker) => blocker.includes("approved merchant-image catalog")));
  assert.ok(report.blockers.some((blocker) => blocker.includes("independent relevance judgments")));
});

test("opt-in reference GET checks report reachability separately from visual verification", async () => {
  const requested: string[] = [];
  const report = await buildReferenceAudit({
    checkReferences: true,
    date: "2026-09-29",
    fetch: async (input, init) => {
      assert.equal(init?.method, "GET");
      assert.equal(init?.redirect, "manual");
      const url = String(input);
      requested.push(url);
      if (url.includes("Handbag_at_Nordstrom_Rack")) {
        return new Response("unavailable", { status: 503, headers: { "content-type": "text/plain" } });
      }
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    },
  });

  assert.equal(requested.length, 11);
  assert.ok(requested.every((url) => {
    const host = new URL(url).hostname;
    return host === "upload.wikimedia.org" || host === "thumb.wikimedia.org";
  }));
  assert.equal(report.networkCheckEnabled, true);
  const success = report.references.find(({ network }) => network.status === "reachable");
  const failure = report.references.find(({ network }) => network.status === "http-error");
  assert.ok(success);
  assert.equal(success.network.httpStatus, 200);
  assert.equal(success.network.contentType, "image/jpeg");
  assert.equal(success.network.bytesRead, 3);
  assert.ok(failure);
  assert.equal(failure.network.httpStatus, 503);
  assert.equal(failure.network.contentType, "text/plain");
  assert.ok(report.references.every(({ visualIdentityVerification }) => visualIdentityVerification === "UNVERIFIED"));
  assert.deepEqual(report.evaluation.arms.map(({ status }) => status), ["NOT RUN", "NOT RUN", "NOT RUN"]);
  assert.ok(report.evaluation.perCaseScores.every(({ score }) => score === null));
});

test("opt-in network failures are reported as errors and never imply visual verification", async () => {
  const report = await buildReferenceAudit({
    checkReferences: true,
    fetch: async () => {
      throw new Error("mock network failure");
    },
  });

  assert.ok(report.references.every(({ network, visualIdentityVerification }) =>
    network.status === "error"
      && network.error === "mock network failure"
      && visualIdentityVerification === "UNVERIFIED"));
});