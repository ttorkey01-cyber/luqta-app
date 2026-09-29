import assert from "node:assert/strict";
import test from "node:test";
import { createSearchV3Experiment } from "./factory";

test("default-off factory does not construct providers or search", async () => {
  const result = await createSearchV3Experiment(false).search({ query: "black shoes" });
  assert.deepEqual(result.products, []);
  assert.equal(result.diagnostics.enabled, false);
  assert.equal(result.diagnostics.providerInvocationCount, 0);
  assert.equal(result.diagnostics.externalApiCallCount, 0);
});