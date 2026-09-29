# Search Intelligence V3 — isolated prototype

This is **not** wired into `/api/search`, mobile screens, the production server,
or the deployed app. V2 remains the only production search. The experiment
starts disabled; only an explicit `enabled: true` or
`LUQTA_SEARCH_V3_EXPERIMENTAL=true` in a caller of `createSearchV3Experiment()`
can activate it. Setting the flag alone does not add a route or change V2.

## Architecture

`ExperimentalSearchV3.search()` accepts text and optional interpreted image
identities, visible text, and uploaded image bytes. It parses structured intent,
expands bounded bilingual/alternative queries, routes up to two passes to at most
eight enabled official feed providers, and uses the **existing** Brave web provider
only when first-pass results are insufficient. It deduplicates, applies hard
constraints, ranks, and classifies match confidence. Each provider call and visual
comparison is bounded. Brave supplies candidates, not scores. Product/affiliate
destinations from providers are preserved. No V3 route or mobile UI is installed.

`factory.ts` constructs the current official-provider registry, Brave client, and
local `PixelVisualSimilarityAdapter` **only when explicitly enabled**. Brave remains
conditional on the already configured key. Candidate-photo loading is **off by
default**; callers must supply a reviewed HTTPS hostname allowlist or inject an
image loader. The loader rejects redirects, private/reserved network destinations,
non-images, and oversized responses, and pins public DNS addresses for connections.
The visual adapter compares *decoded pixels*, using a perceptual hash, spatial
samples, and color histograms. It has bounded decoder concurrency and a bounded
in-memory feature cache; it does **not** perform semantic product recognition.
The optional `ImageEmbeddingProvider` interface can later embed images/text and
compare vectors without changing search orchestration. It is not configured.

`DeterministicMultimodalReranker` separately scores interpreted image identities,
visible text, and product metadata. Hybrid ranking combines that evidence with
the measured pixel score when both encoded images can be loaded. An exact SKU/OEM
signal outweighs a visual lookalike; a pixel match alone cannot prove an EXACT
product. Uncertain image identities remain hypotheses. User-specified color
overrides inferred photo color. Missing prices, currency, color, condition,
location, or explicit identifiers cannot satisfy corresponding hard constraints.
Same-product-cheaper requires identity evidence; similar-cheaper may use a
different model. Diagnostics distinguish skipped/unavailable visual comparisons
from measured scores, and do not contain raw image bytes or image URLs.

Diagnostics are returned only to the caller (not logged to users). They include
intent hypotheses, identifiers, selected queries, searched sources and passes,
candidate and constraint counts, component scores, visual availability, timings,
provider invocations, and measured Brave HTTP requests where its usage metrics
are available. Calls internal to other feed providers are not counted as known
external API requests. No images are sent to a paid AI service.

Photo-only discovery requires a bounded, pre-indexed candidate pool supplied by
the experimental caller; the default factory does not have one. Pixel comparison
reranks a few retrieved candidates, not an entire merchant catalog. Without a
candidate index, an independent image-embedding model, and verified product
labels, this cannot deliver Google-Lens-level image search.

## Offline evaluation

From the repository root:

```sh
pnpm --dir artifacts/api-server exec tsx --test src/experiments/searchV3/*.test.ts src/experiments/searchV3/evaluation/*.test.ts
pnpm --dir artifacts/api-server exec tsx src/experiments/searchV3/evaluation/run.ts --markdown
```

The 25 fixed cases run V2 and V3 against separate copies of the **same
synthetic, in-memory catalog**. Expected relevant product IDs and hard
constraints are fixed in `evaluation/harness.ts`. Results report top-1/3/5,
exact/close success, constraint compliance, irrelevant rate, local latency,
provider invocations, and external calls. There are **zero** Brave calls,
network requests, and paid AI calls in this harness. Its image scenarios supply
interpreted identities and descriptions, not actual photographs; V2 receives a
documented text proxy where necessary. This older harness does not measure the
new visual adapter. Offline rankings cannot establish real-world superiority or
predict production latency. Use the runner's current report, not a static score.

## Real-image benchmark status

`realWorld/manifest.ts` records public Wikimedia Commons image cases with source
pages, attribution, and license metadata; images are linked, not committed.
`realWorld/benchmark.ts` provides a paired V2/local-V3/optional-Gemini-V3 runner.
Each arm receives the same case image URL, candidate catalog object, and catalog
fingerprint. The Gemini arm is only run when a caller explicitly injects a
`version: "gemini-v3"` adapter into `runRealWorldBenchmark`; it does not look up
credentials, silently fall back to another provider, or make a Gemini import.
The adapter can be composed by a caller using `ExperimentalSearchV3` with its
existing injected dependencies (for example, a Gemini-backed `MultimodalReranker`
when an approved implementation is available), then adapted to the benchmark
interface. This leaves the adapter export/import decision with that caller and
keeps the benchmark independent of provider keys.

The runner reports top-1/3/5, exact and close match, constraint/violation
metrics, latency, provider/Brave/model calls, cache hits/misses, estimated cost,
and per-case errors. Missing instrumentation is `null`; errors are recorded and
make aggregate call/cost totals unavailable instead of being treated as zero.
Quality metrics require independent image verification, full-catalog review,
and relevance judgments. For an honest no-configuration status report:

```sh
pnpm --dir artifacts/api-server exec tsx src/experiments/searchV3/realWorld/run.ts
```

The manifest metadata and image URLs are not a labeled shopping catalog. The
manifest's Commons metadata check is not verification that each image is
currently retrievable or visually suitable. There are no bundled real merchant
candidates, verified exact-product matches, independent human relevance
judgments, or completed paired runs. Accordingly Top-1/3/5, exact, close,
constraint, visual-quality, latency, and cost metrics remain **unavailable**,
not zero or a claimed win. Some requested scenarios still need verified
examples. A reviewed catalog, permissions, reference-image inspections, and
paired measurements are required before recommending a production merge.

## Optional Gemini embedding benchmark adapter (experimental)

`realWorld/adapters.ts` now provides `createGeminiV3BenchmarkAdapter()` using
the actual `GeminiEmbeddingProvider` and existing `GeminiVisualAdapter` pixel +
embedding composition. The catalog-only visual baseline is available through
`createLocalV3BenchmarkAdapter()`. Both rank the same explicitly supplied
catalog (capped at 20 candidates) and use the caller-supplied reference/candidate
image loader. These builders measure controlled-catalog visual ranking, not the
full feed-routing, text-intent, or constraint-search pipeline; use a separately
configured existing V2 adapter when making end-to-end claims. The adapter
records per-search provider/model calls, cache hit/
miss deltas, estimated image-input cost, and latency. Gemini scores use the V3
visual composition (40% local pixel score and 60% embedding score); a failed
Gemini comparison is reported as an error rather than silently ranking local
pixel fallback results as Gemini results.

Gemini is strictly opt-in: the builder returns no adapter when `enabled` is
false, and when enabled it requires the caller to pass an explicit server-side
API key. It never reads `GEMINI_API_KEY` or falls back to another credential.
Construction performs no requests; the injected transport/provider is called
only when the caller runs the benchmark adapter. No paid request, image download,
or production route is triggered by the CLI/status report or by importing these
builders. The caller remains responsible for explicitly approved provider access,
image permissions, catalog selection, and wiring an existing V2 adapter for a
three-way run.

Accuracy and latency on LUQTA products remain **unmeasured**. Google's
[`gemini-embedding-2`](https://ai.google.dev/gemini-api/docs/embeddings)
published standard paid-tier price is $0.00012 per image input, so uncached
query-plus-candidate image embeddings are estimated and reported from actual
provider counters rather than represented as billing data. No batch pricing or
uncached-large-catalog extrapolation is included in synchronous benchmark
results.