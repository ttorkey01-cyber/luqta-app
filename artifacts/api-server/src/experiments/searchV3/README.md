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
`realWorld/benchmark.ts` provides a paired V2/V3 runner that requires the same
candidate-catalog fingerprint, available reference images, and independently
reviewed relevance judgments before reporting quality metrics. For an honest
unmeasured status report:

```sh
pnpm --dir artifacts/api-server exec tsx src/experiments/searchV3/realWorld/run.ts
```

The manifest metadata and image URLs are not a labeled shopping catalog. There
are no bundled real merchant candidates, verified exact-product matches,
independent human relevance judgments, or completed paired V2/V3 runs. Its
Top-1/3/5, exact, close, constraint, visual-quality, real-world latency, and
cost metrics therefore remain **unavailable**, not zero or a claimed win.
Some requested scenarios still need verified examples. A reviewed catalog,
permissions, reference-image inspections, and paired measurements are required
before recommending a production merge.

## Optional future semantic embeddings (not activated)

Google's [`gemini-embedding-2`](https://ai.google.dev/gemini-api/docs/embeddings)
maps images and text into one embedding space. This could compare product photos
across different crops, backgrounds, and views better than local pixel hashes,
but accuracy and latency on LUQTA products have **not been measured**. It
requires Gemini API access, image-consent/privacy review, and approval before
enabling any paid use. Google's [published prices](https://ai.google.dev/gemini-api/docs/pricing#gemini-embedding-2)
are $0.00012 per input image on the standard paid tier and $0.00006 per image
for asynchronous batch processing (as checked September 29, 2026). If each
search embeds one user image and 100 *uncached* candidate images, that is
approximately $0.01212 per search in image-input charges. Pre-embed and cache
candidate vectors by image/version, then reuse them; the incremental charge
for a new image query is approximately $0.00012, plus text tokens and any
storage/network charges. Batch candidate indexing costs approximately $0.006
per 100 images and is **not** synchronous search. Google's free tier exists,
but its content-use terms differ from paid use; no service or billing was
enabled. The model accepts at most six images per request; each catalog image
needs its own vector, then a local cosine comparison or approved index.