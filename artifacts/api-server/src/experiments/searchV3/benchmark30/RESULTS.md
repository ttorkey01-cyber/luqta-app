# Search Intelligence V3 — 30-case evidence report

**Date:** 2026-09-29
**Branch:** `experiment/search-intelligence-v3`
**Status:** Pre-scoring definitions frozen; **0/30 cases evaluated**. This is a
provenance/readiness audit, **not** a three-arm search benchmark or a quality result.
The machine-readable snapshot is `referenceAudit.results.json`.

## Frozen protocol and provenance

The separate `groundTruth.ts` defines exactly 30 queries and their **pre-scoring**
judgment rules: six exact-identity, six visually similar, five hard-constraint,
four automotive, four Saudi Arabic, three ambiguous-image, and two negative
cases. It was committed before any search scoring. The canonical definition
SHA-256 in the snapshot is
`c9f354b3501f9b10b7a1dc6a41ee59fdcb5eb0b3cd4d5437dd85ba6cfc2dce6d`.
This is a digest of the case *data*, not the commit hash.

Eleven cases link to Wikimedia Commons reference photos. A bounded, sequential
GET audit returned an image response for **11/11** linked URLs. The JSON records
each URL, source page, author, Commons license and license URL, HTTP status, MIME
type, and byte count. **HTTP availability does not verify what the image shows
or establish a product match.** The other 19 cases are text-only. A first,
concurrent reference audit received one Wikimedia HTTP 429 (headphones photo);
the final sequential audit succeeded for all 11. This is a source-rate-limit
observation, not a search-system failure.

The current affiliate-feed integration does not establish permission to send
merchant product photos to Gemini. The user instructed us **not to send merchant
photos** because permission is unconfirmed. No approved merchant-image candidate
catalog, frozen catalog fingerprint, or independent full-catalog per-case
relevance judgments is available. Commons reference photos are not a real
merchant inventory. The existing `realWorld/adapters.ts` ranks a controlled
visual catalog of up to 20 candidates; it is not a V2 or full V3 discovery
adapter. Feeding it unrelated Commons images would not measure shopping search.
Using synthetic products or labeling results after looking at rankings would
also violate this protocol. Therefore none of the 30 cases was run through V2,
V3-local, or V3+Gemini. The same 30 frozen cases and equivalent inventory remain
a requirement for any future measurement.

## Side-by-side results

| Measure | Stable V2 | V3-local | V3+Gemini Embedding 2 |
| --- | --- | --- | --- |
| Cases actually searched/scored | 0/30 | 0/30 | 0/30 |
| Top-1 relevance, Top-3/Top-5 success | unavailable | unavailable | unavailable |
| Exact-product / close-match success | unavailable | unavailable | unavailable |
| Hard-constraint compliance / irrelevant rate | unavailable | unavailable | unavailable |
| False-exact / correct no-match rate | unavailable | unavailable | unavailable |
| Automotive evidence/fitment safety | unavailable | unavailable | unavailable |
| Saudi Arabic intent/constraint success | unavailable | unavailable | unavailable |
| Image-assisted ranking improvement | unavailable | unavailable | unavailable |
| First-pass success / second-pass recovery | unavailable | unavailable | unavailable |
| Search latency median / p95 | unavailable | unavailable | unavailable |

Unavailable is **not zero quality**. No success, regression, first-pass recovery,
or false-exact claim can be made without a common searched catalog and independent
relevance/constraint judgments. There are **no observed cases** where Gemini
improved, worsened, or tied V3-local: these comparisons were not run. Failure
classifications (discovery, parsing, embedding, ranking, compatibility, etc.)
are **not assessable**; the observed blocker is benchmark evidence and image
processing permission, not an observed product-search failure. The final
reference audit has 0 image-fetch failures; the earlier concurrent audit's HTTP
429 is disclosed above.

## Actual activity and cost

| Item | Observed |
| --- | ---: |
| Gemini embedding API calls | **0** |
| Query-image / candidate-image calls | **0 / 0** |
| Gemini cache hits / misses | **0 / 0** |
| Configured experimental embedding dimension | **768** (not invoked) |
| Estimated Gemini spend for this audit | **US$0** (no calls; not a billing statement) |
| Gemini quota/rate-limit/API failures | **0** (no requests attempted) |
| Brave, feed, or production search calls | **0** |
| Public Commons image GETs in final snapshot | **11** |

No search latency was recorded; the time to check Commons URLs must not be
reported as search latency. Future paid-call cost is not extrapolated from a
benchmark that never ran. The per-search limit of up to 20 Gemini candidate
comparisons is **not** an authorization to embed an entire catalog or exceed an
experiment-wide ceiling. No API-call ceiling was approached here.

## Decision gate

**C — keep stable V2, do not advance V3 to production validation on this
evidence.** This is a conservative *release decision* based on **no demonstrated
improvement**, not a claim that a completed benchmark measured V3 or Gemini
performing worse. Gemini's incremental value over V3-local remains **unknown**.
The experiment needs a rights-cleared real catalog, verified image identities,
and independent frozen candidate judgments before the same 30 cases can support
an A/B/C *quality* decision. Do not infer an A or a "promising" B from image
reachability alone.

## Reproduce and safeguards

```sh
pnpm --dir artifacts/api-server exec tsx src/experiments/searchV3/benchmark30/referenceAudit.ts
pnpm --dir artifacts/api-server exec tsx src/experiments/searchV3/benchmark30/referenceAudit.ts --check-references
```

The first command is offline; the second only performs bounded Wikimedia
image GETs and may yield different HTTP statuses later. Neither command calls
Gemini, Brave, affiliate feeds, V2, or V3. No merge, production deploy, OTA
update, APK/EAS build, billing change, stable V2 change, or sonic-logo change
was made for this audit.