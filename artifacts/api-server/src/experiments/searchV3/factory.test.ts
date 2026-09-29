import assert from "node:assert/strict";
import test from "node:test";
import { createSearchV3Experiment } from "./factory";

test("default-off factory does not construct providers or search", async () => {
  const result = await createSearchV3Experiment(false).search({
    query: "black shoes",
    image: {
      imageBytes: new Uint8Array([1, 2, 3]),
      imageUri: "https://images.example/private-upload",
      identities: [],
    },
  });
  assert.deepEqual(result.products, []);
  assert.equal(result.diagnostics.enabled, false);
  assert.equal(result.diagnostics.providerInvocationCount, 0);
  assert.equal(result.diagnostics.externalApiCallCount, 0);
  assert.equal(result.diagnostics.visual.unavailableReason, "VISUAL_ADAPTER_UNAVAILABLE");
  assert.equal(JSON.stringify(result.diagnostics).includes("private-upload"), false);
  assert.equal(JSON.stringify(result.diagnostics).includes("imageBytes"), false);
});

test("enabled factory keeps candidate image fetching disabled without an explicit host allowlist", async () => {
  const result = await createSearchV3Experiment(true).search({
    query: "",
    image: {
      identities: [],
      imageBytes: new Uint8Array([1, 2, 3]),
    },
  });

  assert.deepEqual(result.products, []);
  assert.equal(result.diagnostics.providerInvocationCount, 0);
  assert.equal(result.diagnostics.visual.unavailableReason, "IMAGE_URL_LOADER_UNAVAILABLE");
  assert.equal(result.diagnostics.visual.imageLoadCalls, 0);
  assert.equal(result.diagnostics.photoOnlyDiscovery.unavailableReason, "PHOTO_ONLY_CATALOG_UNAVAILABLE");
});