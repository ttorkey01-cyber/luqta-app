import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GeminiVisualAdapter,
  GeminiEmbeddingProvider,
  GeminiEmbedding2Error,
} from "./gemini";

type FetchInput = Parameters<typeof globalThis.fetch>[0];
type FetchInit = Parameters<typeof globalThis.fetch>[1];

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const png2 = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 4, 5, 6]);
const png3 = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 8, 9]);

function mockFetch(vector = Array(768).fill(1)) {
  const requests: Array<{ url: string; init?: FetchInit }> = [];
  const fetch = (async (input: FetchInput, init?: FetchInit) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify({ embedding: { values: vector } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

test("requires explicit key and never places it in URL or provider errors", async () => {
  assert.throws(() => new GeminiEmbeddingProvider({ apiKey: "" }), GeminiEmbedding2Error);
  const secret = "test-secret-do-not-leak";
  const transport = {
    fetch: (async (input: FetchInput) => {
      assert.ok(!String(input).includes(secret));
      throw new Error(`request failed with ${secret}`);
    }) as typeof globalThis.fetch,
  };
  const provider = new GeminiEmbeddingProvider({ apiKey: secret, fetch: transport.fetch });
  await assert.rejects(provider.embedText("hello"), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes(secret));
    return true;
  });
});

test("posts official image and text payloads, validates signature, dimensions, and cosine score", async () => {
  const transport = mockFetch();
  const provider = new GeminiEmbeddingProvider({ apiKey: "key", fetch: transport.fetch });
  const imageVector = await provider.embedQueryImage({ bytes: png, mimeType: "image/jpeg" });
  const textVector = await provider.embedText("a product");
  assert.equal(transport.requests.length, 2);
  assert.equal(transport.requests[0]!.url,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent");
  const imageHeaders = new Headers(transport.requests[0]!.init?.headers);
  assert.equal(imageHeaders.get("x-goog-api-key"), "key");
  const imageBody = JSON.parse(String(transport.requests[0]!.init?.body));
  assert.equal(imageBody.model, "models/gemini-embedding-2");
  assert.equal(imageBody.output_dimensionality, 768);
  assert.equal(imageBody.content.parts[0].inline_data.mime_type, "image/png");
  assert.equal(imageBody.content.parts[0].inline_data.data, Buffer.from(png).toString("base64"));
  assert.deepEqual(JSON.parse(String(transport.requests[1]!.init?.body)).content.parts, [{ text: "a product" }]);
  assert.equal(provider.compare(imageVector, textVector), 1);
  assert.equal(provider.compare(imageVector, imageVector.map((value) => -value)), 0);

  await assert.rejects(
    async () => provider.embedImage({ bytes: Buffer.from("invalid") }),
    /signature/,
  );
  const invalidProvider = new GeminiEmbeddingProvider({
    apiKey: "key",
    fetch: mockFetch(Array(767).fill(0)).fetch,
  });
  await assert.rejects(invalidProvider.embedText("bad response"), /dimension/);
  assert.throws(() => new GeminiEmbeddingProvider({ apiKey: "key", outputDimension: 127 }), /128 to 3072/);
});

test("bounded embedding cache supports hits, misses, invalidation, and query/candidate metrics", async () => {
  const transport = mockFetch();
  const provider = new GeminiEmbeddingProvider({
    apiKey: "key",
    fetch: transport.fetch,
    cacheMaxEntries: 1,
  });
  await provider.embedQueryImage({ bytes: png });
  await provider.embedCandidateImage({ bytes: png });
  assert.equal(transport.requests.length, 1);
  assert.equal(provider.getMetrics().cacheHits, 1);
  assert.equal(provider.getMetrics().queryImageCalls, 1);
  assert.equal(provider.getMetrics().candidateImageCalls, 0);
  await provider.embedImage({ bytes: png2 });
  await provider.embedImage({ bytes: png });
  assert.equal(transport.requests.length, 3);
  assert.equal(provider.getMetrics().cacheMisses, 3);
  provider.invalidateImage({ bytes: png });
  await provider.embedImage({ bytes: png });
  assert.equal(transport.requests.length, 4);
  assert.equal(provider.getMetrics().estimatedCostUsd, 4 * 0.00012);
  provider.resetMetrics();
  assert.equal(provider.getMetrics().imageCalls, 0);
});

test("deduplicates concurrent identical images and keeps failures safe", async () => {
  let resolveResponse!: (response: Response) => void;
  let calls = 0;
  const fetch = (async () => {
    calls += 1;
    return new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
  }) as typeof globalThis.fetch;
  const provider = new GeminiEmbeddingProvider({ apiKey: "secret", fetch });
  const first = provider.embedQueryImage({ bytes: png });
  const second = provider.embedCandidateImage({ bytes: png });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  resolveResponse(new Response(JSON.stringify({ embedding: { values: Array(768).fill(0.5) } })));
  assert.deepEqual(await first, await second);
  assert.equal(provider.getMetrics().imageInFlightDeduplications, 1);
  assert.equal(provider.getMetrics().imageCalls, 1);

  const failing = new GeminiEmbeddingProvider({
    apiKey: "private",
    fetch: (async () => new Response("do not expose private", { status: 403 })) as typeof globalThis.fetch,
  });
  await assert.rejects(failing.embedText("hello"), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes("private"));
    assert.ok(!error.message.includes("do not expose"));
    return true;
  });
});

test("image size limit and request deadline are enforced", async () => {
  const oversized = new GeminiEmbeddingProvider({
    apiKey: "key",
    maxImageBytes: 8,
    fetch: mockFetch().fetch,
  });
  await assert.rejects(async () => oversized.embedImage({ bytes: png }), /byte limit/);
  const timeoutProvider = new GeminiEmbeddingProvider({
    apiKey: "key",
    timeoutMs: 5,
    fetch: (async () => new Promise<Response>(() => {})) as typeof globalThis.fetch,
  });
  await assert.rejects(timeoutProvider.embedText("deadline"), /deadline/);
});

test("search scope memoizes a fast query failure across concurrent candidates and later passes", async () => {
  let calls = 0;
  const provider = new GeminiEmbeddingProvider({
    apiKey: "private",
    fetch: (async () => {
      calls += 1;
      return new Response("safe to discard", { status: 503 });
    }) as typeof globalThis.fetch,
  });
  const visual = new GeminiVisualAdapter(provider);
  const search = visual.forSearch();
  const firstPass = await Promise.allSettled([
    search.compareImages({ bytes: png }, { bytes: png2 }),
    search.compareImages({ bytes: png }, { bytes: png3 }),
  ]);
  const secondPass = await Promise.allSettled([
    search.compareImages({ bytes: png }, { bytes: png2 }),
    search.compareImages({ bytes: png }, { bytes: png3 }),
  ]);
  assert.ok(firstPass.every((result) => result.status === "rejected"));
  assert.ok(secondPass.every((result) => result.status === "rejected"));
  assert.equal(calls, 1);
  assert.equal(provider.getMetrics().queryImageCalls, 1);
  assert.equal(provider.getMetrics().candidateImageCalls, 0);
});

test("provider search lock serializes concurrent measurement windows and recovers after rejection", async () => {
  const provider = new GeminiEmbeddingProvider({ apiKey: "key", fetch: mockFetch().fetch });
  const visual = new GeminiVisualAdapter(provider);
  const order: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const first = visual.withSearchLock(async () => {
    order.push("first-start");
    await firstGate;
    order.push("first-end");
  });
  const second = visual.withSearchLock(async () => {
    order.push("second-start");
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["first-start"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first-start", "first-end", "second-start"]);

  await assert.rejects(visual.withSearchLock(async () => {
    throw new Error("measurement failed");
  }), /measurement failed/);
  await visual.withSearchLock(() => {
    order.push("after-rejection");
  });
  assert.equal(order.at(-1), "after-rejection");
});