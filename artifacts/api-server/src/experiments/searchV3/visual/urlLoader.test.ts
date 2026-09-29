import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createImageUrlLoader,
  ImageUrlLoaderError,
  type ImageUrlFetch,
  type HostnameResolver,
} from "./urlLoader";

const pngBytes = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  1, 2, 3, 4, 5, 6, 7, 8,
]);

function pngResponse(body: Uint8Array = pngBytes, headers: Record<string, string> = {}) {
  return new Response(Buffer.from(body), {
    headers: { "content-type": "image/png", ...headers },
  });
}

const publicResolver: HostnameResolver = async () => [
  { address: "93.184.216.34", family: 4 },
];

test("URL loader is disabled by default and blocks SSRF/private/local URLs before fetch", async () => {
  let calls = 0;
  const fetcher: ImageUrlFetch = async () => {
    calls += 1;
    return pngResponse();
  };
  const disabled = createImageUrlLoader({ allowedHosts: ["images.example"], fetch: fetcher });
  await assert.rejects(
    disabled("https://images.example/photo.png"),
    (error: unknown) => error instanceof ImageUrlLoaderError && error.code === "DISABLED",
  );

  const loader = createImageUrlLoader({
    enabled: true,
    allowedHosts: ["images.example", "127.0.0.1", "localhost", "printer.local", "storage.internal"],
    fetch: fetcher,
  });
  for (const url of [
    "http://images.example/photo.png",
    "https://127.0.0.1/photo.png",
    "https://[::1]/photo.png",
    "https://localhost/photo.png",
    "https://printer.local/photo.png",
    "https://storage.internal/photo.png",
    "https://not-allowlisted.example/photo.png",
  ]) {
    await assert.rejects(
      loader(url),
      (error: unknown) =>
        error instanceof ImageUrlLoaderError &&
        ["INVALID_URL", "HOST_NOT_ALLOWED"].includes(error.code),
    );
  }
  assert.equal(calls, 0);
});

test("rejects redirects without following their Location", async () => {
  let calls = 0;
  const fetcher: ImageUrlFetch = async (_url, init) => {
    calls += 1;
    assert.equal(init.redirect, "manual");
    return new Response(null, {
      status: 302,
      headers: { location: "http://169.254.169.254/latest/meta-data" },
    });
  };
  const loader = createImageUrlLoader({
    enabled: true,
    allowedHosts: ["images.example"],
    resolveHostname: publicResolver,
    fetch: fetcher,
  });
  await assert.rejects(
    loader("https://images.example/photo.png"),
    (error: unknown) => error instanceof ImageUrlLoaderError && error.code === "REDIRECT_REJECTED",
  );
  assert.equal(calls, 1);
});

test("rejects DNS answers containing private or local addresses before connecting", async () => {
  let calls = 0;
  const fetcher: ImageUrlFetch = async () => {
    calls += 1;
    return pngResponse();
  };
  for (const address of [
    { address: "10.12.0.8", family: 4 as const },
    { address: "169.254.169.254", family: 4 as const },
    { address: "fc00::1", family: 6 as const },
    { address: "::ffff:127.0.0.1", family: 6 as const },
  ]) {
    const resolveHostname: HostnameResolver = async () => [address];
    const loader = createImageUrlLoader({
      enabled: true,
      allowedHosts: ["images.example"],
      resolveHostname,
      fetch: fetcher,
    });
    await assert.rejects(
      loader("https://images.example/photo.png"),
      (error: unknown) =>
        error instanceof ImageUrlLoaderError && error.code === "HOST_RESOLUTION_FAILED",
    );
  }
  const mixedPublicAndPrivate: HostnameResolver = async () => [
    { address: "93.184.216.34", family: 4 },
    { address: "192.168.1.10", family: 4 },
  ];
  const mixedLoader = createImageUrlLoader({
    enabled: true,
    allowedHosts: ["images.example"],
    resolveHostname: mixedPublicAndPrivate,
    fetch: fetcher,
  });
  await assert.rejects(
    mixedLoader("https://images.example/photo.png"),
    (error: unknown) =>
      error instanceof ImageUrlLoaderError && error.code === "HOST_RESOLUTION_FAILED",
  );
  assert.equal(calls, 0);
});

test("permits public DNS answers with injected no-network fetch", async () => {
  let calls = 0;
  const resolveHostname: HostnameResolver = async (hostname) => {
    assert.equal(hostname, "images.example");
    return [{ address: "93.184.216.34", family: 4 }];
  };
  const loader = createImageUrlLoader({
    enabled: true,
    allowedHosts: ["images.example"],
    resolveHostname,
    fetch: async (url, init) => {
      calls += 1;
      assert.equal(url, "https://images.example/photo.png");
      assert.equal(init.redirect, "manual");
      return pngResponse();
    },
  });
  const image = await loader("https://images.example/photo.png");
  assert.equal(image.mimeType, "image/png");
  assert.equal(calls, 1);
});

test("rejects non-image MIME types and oversized declared or streamed bodies", async () => {
  const responses = [
    new Response("not an image", { headers: { "content-type": "text/html" } }),
    pngResponse(pngBytes, { "content-length": "100" }),
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(Uint8Array.from([...pngBytes, ...pngBytes]));
          controller.close();
        },
      }),
      { headers: { "content-type": "image/png" } },
    ),
  ];
  let responseIndex = 0;
  const loader = createImageUrlLoader({
    enabled: true,
    allowedHosts: ["images.example"],
    maxImageBytes: pngBytes.length,
    resolveHostname: publicResolver,
    fetch: async () => responses[responseIndex++]!,
  });
  await assert.rejects(
    loader("https://images.example/html"),
    (error: unknown) => error instanceof ImageUrlLoaderError && error.code === "NON_IMAGE_CONTENT",
  );
  await assert.rejects(
    loader("https://images.example/large-header"),
    (error: unknown) => error instanceof ImageUrlLoaderError && error.code === "IMAGE_TOO_LARGE",
  );
  await assert.rejects(
    loader("https://images.example/large-body"),
    (error: unknown) => error instanceof ImageUrlLoaderError && error.code === "IMAGE_TOO_LARGE",
  );
});

test("caches approved bytes, bounds cached size, and returns isolated byte copies", async () => {
  let calls = 0;
  const loader = createImageUrlLoader({
    enabled: true,
    allowedHosts: ["images.example"],
    cacheMaxBytes: pngBytes.length,
    resolveHostname: publicResolver,
    fetch: async () => {
      calls += 1;
      return pngResponse();
    },
  });
  const first = await loader("https://images.example/photo.png");
  first.bytes[8] = 99;
  const second = await loader("https://images.example/photo.png");
  assert.equal(calls, 1);
  assert.equal(second.bytes[8], 1);
  assert.equal(second.url, "https://images.example/photo.png");
  assert.equal(second.mimeType, "image/png");
});

test("enforces request timeout and concurrency limits", async () => {
  const loader = createImageUrlLoader({
    enabled: true,
    allowedHosts: ["images.example"],
    maxConcurrency: 1,
    timeoutMs: 15,
    resolveHostname: publicResolver,
    fetch: async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
  });
  const first = loader("https://images.example/slow.png");
  await assert.rejects(
    loader("https://images.example/second.png"),
    (error: unknown) => error instanceof ImageUrlLoaderError && error.code === "TOO_MANY_REQUESTS",
  );
  await assert.rejects(
    first,
    (error: unknown) => error instanceof ImageUrlLoaderError && error.code === "TIMEOUT",
  );
});