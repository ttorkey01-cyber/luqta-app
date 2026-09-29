import assert from "node:assert/strict";
import test from "node:test";
import {
  GeminiQueryImageInterpreter,
  QueryImageInterpreterError,
} from "./queryImageInterpreter";

type FetchInput = Parameters<typeof globalThis.fetch>[0];
type FetchInit = Parameters<typeof globalThis.fetch>[1];

const png = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);
const validImageResult = {
  category: "electronics",
  productType: "headphones",
  brand: "Visible Brand",
  model: null,
  color: "black",
  style: "over-ear",
  material: null,
  attributes: ["wireless"],
  extractedText: ["VISIBLE BRAND"],
  uncertainty: ["Exact model is not legible"],
  confidence: 0.78,
  description: "Black over-ear headphones with visible brand lettering.",
};

function mockFetch(payload: unknown) {
  const requests: Array<{ url: string; init?: FetchInit }> = [];
  const fetch = (async (input: FetchInput, init?: FetchInit) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

test("makes one image-only generateContent request and maps results to V3 image identities", async () => {
  const transport = mockFetch({
    candidates: [{ content: { parts: [{ text: JSON.stringify(validImageResult) }] } }],
    usageMetadata: { promptTokenCount: 103, candidatesTokenCount: 65, thoughtsTokenCount: 17 },
  });
  const interpreter = new GeminiQueryImageInterpreter();
  const input = { imageBytes: png, apiKey: "explicit-server-key", fetch: transport.fetch };

  const [first, repeated] = await Promise.all([
    interpreter.interpret(input),
    interpreter.interpret({ ...input, imageBytes: Uint8Array.from(png) }),
  ]);

  assert.deepEqual(first, repeated);
  assert.equal(first.productType, "headphones");
  assert.deepEqual(first.v3Image.identities, [{
    label: "headphones",
    confidence: 0.78,
    brand: "Visible Brand",
    color: "black",
  }]);
  assert.equal(first.v3Image.extractedText, "VISIBLE BRAND");
  assert.equal(transport.requests.length, 1);
  const request = transport.requests[0]!;
  assert.equal(request.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent");
  const headers = new Headers(request.init?.headers);
  assert.equal(headers.get("x-goog-api-key"), "explicit-server-key");
  const body = JSON.parse(String(request.init?.body));
  assert.deepEqual(Object.keys(body).sort(), ["contents", "generationConfig"]);
  assert.equal(body.contents.length, 1);
  assert.deepEqual(Object.keys(body.contents[0]).sort(), ["parts", "role"]);
  assert.equal(body.contents[0].role, "user");
  assert.deepEqual(body.contents[0].parts[1], {
    inlineData: { mimeType: "image/png", data: Buffer.from(png).toString("base64") },
  });
  assert.deepEqual(Object.keys(body.contents[0].parts[0]), ["text"]);
  assert.match(body.contents[0].parts[0].text, /only the pixels in the attached query image/i);
  assert.match(body.contents[0].parts[0].text, /Do not use or infer any user query/i);
  assert.equal(JSON.stringify(body).includes("candidateImage"), false);
  assert.equal(body.contents[0].parts.length, 2);
  assert.deepEqual(interpreter.getMetrics(), {
    queryImageCalls: 1,
    candidateImageCalls: 0,
    textCalls: 0,
    cacheHits: 1,
    cacheMisses: 1,
    failures: 0,
    inputTokens: 103,
    outputTokens: 82,
  });
});

test("does not make a request until explicitly invoked", () => {
  const interpreter = new GeminiQueryImageInterpreter();

  assert.equal(interpreter.getMetrics().queryImageCalls, 0);
  assert.equal(interpreter.getMetrics().candidateImageCalls, 0);
  assert.equal(interpreter.getMetrics().textCalls, 0);
});

test("fails closed for malformed model JSON and caches the failed unique-image call", async () => {
  const transport = mockFetch({
    candidates: [{ content: { parts: [{ text: JSON.stringify({ ...validImageResult, confidence: 2 }) }] } }],
  });
  const interpreter = new GeminiQueryImageInterpreter();
  const input = { imageBytes: png, apiKey: "key", fetch: transport.fetch };

  await assert.rejects(interpreter.interpret(input), QueryImageInterpreterError);
  await assert.rejects(interpreter.interpret(input), QueryImageInterpreterError);
  assert.equal(transport.requests.length, 1);
  assert.equal(interpreter.getMetrics().failures, 1);
});

test("enforces timeout with no retry and never exposes transport details", async () => {
  let calls = 0;
  const secret = "never-log-this-key";
  const fetch = (async (_input: FetchInput, init?: FetchInit) => {
    calls += 1;
    assert.ok(init?.signal instanceof AbortSignal);
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error(secret)), { once: true });
    });
  }) as typeof globalThis.fetch;
  const interpreter = new GeminiQueryImageInterpreter({ timeoutMs: 5 });
  const input = { imageBytes: png, apiKey: secret, fetch };

  await assert.rejects(interpreter.interpret(input), (error: unknown) => {
    assert.ok(error instanceof QueryImageInterpreterError);
    assert.match(error.message, /deadline/);
    assert.ok(!error.message.includes(secret));
    return true;
  });
  await assert.rejects(interpreter.interpret(input), /deadline/);
  assert.equal(calls, 1);
  assert.equal(interpreter.getMetrics().queryImageCalls, 1);
  assert.equal(interpreter.getMetrics().failures, 1);
});

test("rejects oversized or unsupported bytes before sending a request", async () => {
  let calls = 0;
  const fetch = (async () => {
    calls += 1;
    throw new Error("must remain unused");
  }) as typeof globalThis.fetch;
  const interpreter = new GeminiQueryImageInterpreter();

  await assert.rejects(interpreter.interpret({
    imageBytes: new Uint8Array(1_000_001),
    apiKey: "key",
    fetch,
  }), /1 MB/);
  await assert.rejects(interpreter.interpret({
    imageBytes: Uint8Array.from([1, 2, 3, 4]),
    apiKey: "key",
    fetch,
  }), /signatures/);
  assert.equal(calls, 0);
  assert.equal(interpreter.getMetrics().queryImageCalls, 0);
});