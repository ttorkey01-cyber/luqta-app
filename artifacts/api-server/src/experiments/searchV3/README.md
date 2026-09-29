# Search Intelligence V3 — isolated prototype

This is **not** wired into `/api/search`, mobile screens, the production server,
or the deployed app. V2 remains the only production search. The experiment
starts disabled; only an explicit `enabled: true` or
`LUQTA_SEARCH_V3_EXPERIMENTAL=true` in a caller of `createSearchV3Experiment()`
can activate it. Setting the flag alone does not add a route or change V2.

## Architecture

`ExperimentalSearchV3.search()` accepts text and optional interpreted image
identities, visible text and an image URI. It parses structured intent, expands
bounded bilingual/alternative queries, routes up to two passes to at most eight
enabled official feed providers plus the **existing** Brave web provider, then
deduplicates, applies verified hard constraints, reranks, and classifies match
confidence. Each provider call has a timeout; reranking has a separate timeout.
Discovery and ranking are independent: Brave supplies candidates, not scores.
Product/affiliate destinations from providers are preserved.

`factory.ts` constructs the current official-provider registry and existing
`BraveWebSearchProvider` **only when explicitly enabled**. Brave remains
conditional on the already configured key; no new provider, account, vector
database, or paid embedding API is added. The built-in
`DeterministicMultimodalReranker` compares interpreted image identities,
visible text, and product metadata. `MultimodalReranker` receives both the user
image URI and candidates' image URLs so an approved image-capable implementation
could be substituted later. **The built-in ranker does not compare image pixels
or calculate image embeddings.** Uncertain image identities remain hypotheses,
not verified facts. Missing prices, currency, color, condition, location or
explicit identifiers cannot satisfy the corresponding strict constraint.

Diagnostics are returned only to the caller (not logged to users). They include
parsed intent, candidate counts, source and pass counts, timing, provider
invocations, and measured Brave HTTP requests where its usage metrics are
available. Calls internal to other feed providers are not counted as known
external API requests.

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
network requests, and paid AI calls in this harness. Image scenarios supply
interpreted identities and descriptions, not actual photographs or measured
pixel similarity; V2 receives a documented text proxy where necessary.
Offline rankings cannot establish real-world superiority or predict production
latency. Use the runner's current report rather than assuming any static score.

An approved image-embedding integration would require selecting a provider,
account/API access, image consent/privacy review, and pricing approval.
Without a selected model and vendor tariff, a dollar estimate would be
speculative. The uncached upper bound per search is one user-image embedding
plus up to 100 candidate-image embeddings; storing approved candidate
embeddings would reduce repeat work. Nothing of this kind is activated here.