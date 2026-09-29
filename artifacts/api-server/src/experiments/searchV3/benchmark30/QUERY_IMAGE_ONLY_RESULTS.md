# LUQTA Search Intelligence V3 — query-image-only live benchmark

Date: 2026-09-30. Branch: `experiment/search-intelligence-v3`.
This is an experimental, **non-production** result. The earlier
`referenceAudit.results.json` is a separate historical 0-search permission audit,
not a scored benchmark.

## What actually ran

- 30 frozen cases; **28 executable**, **2 UNSCORABLE** before scoring. The
  black-structured-bag reference depicts a multicolored fuzzy bag, not the
  required shape. The Camry-headlamp reference cannot establish Camry fitment
  or the requested side; its source identifies an S-Class lamp.
- Of the 11 Commons references, 9 were visually reviewed as usable user
  **query images**. The 9 were fetched as bounded, licensed Wikimedia inputs;
  source/author/license/network details are in `referenceAudit.results.json`,
  and pre-search visible evidence is frozen in `imageReview.ts`.
- All seven configured official feeds were ready before the measured run
  (AliExpress 4,985 indexed products; Nazih 488; Diesel 2,742; StyleWe 1,679;
  Luxury Closet 5,000; Deal Outlet 5,000; Huawei 0). Prewarm took 23,009 ms
  and was excluded from arm latencies. These are bounded indexes, not a claim
  that all merchant inventory was captured.
- Stable V2 search ran through its unmodified SearchOrchestrator. For images,
  the experiment called the configured OpenAI vision integration using the
  stable route's prompt, model, normalization and candidate-query merge;
  it did **not** call the route's JPEG-only admission/rate limiter. V3-local
  received user query-image bytes but its candidate-photo loader and visual
  adapter were disabled, so it had **no local image-interpretation output**.
  V3+Gemini used the same permitted metadata-only discovery path and would
  have passed only a Gemini interpretation of the query image.
- No candidate image was loaded by V3 visual ranking, uploaded to Gemini, or
  used for blind relevance review. No invented catalog or synthetic search
  output was scored. Independent reviewers adjudicated 147 unique returned
  candidates in 191 top-five rank slots using product metadata only, without
  seeing arm or rank. They marked 44 unique candidates uncertain rather than
  asserting unsupported identities. Criteria and scoring rules were committed
  before viewing the full run in `groundTruth.ts`, `imageReview.ts` and
  `scoringProtocol.md`.

## Side-by-side results

Top-K relevance requires an independently reviewed EXACT or CLOSE result
**and affirmative evidence for every applicable hard constraint**. The
positive-case denominator excludes the two negative/no-match cases. Errors
are never treated as zero relevance.

| Metric | V2 | V3-local | V3+Gemini arm |
| --- | ---: | ---: | ---: |
| Successfully executed / 28 | 28 | 28 | 19 text-only |
| Image cases evaluated with Gemini | — | — | **0 / 9** |
| Model error / stopped image cases | — | — | 1 error / 8 not attempted |
| Positive cases scored | 26 | 26 | 17 text-only |
| Top-1 relevant | 7/26 (26.9%) | 1/26 (3.8%) | 1/17 (5.9%)* |
| Top-3 success | 10/26 (38.5%) | 3/26 (11.5%) | 1/17 (5.9%)* |
| Top-5 success | 10/26 (38.5%) | 4/26 (15.4%) | 1/17 (5.9%)* |
| Exact product in top five | 4/26 | 1/26 | 1/17* |
| Close product in top five | 6/26 | 3/26 | 0/17* |
| Hard-constraint compliance, nonempty top five | 2/19 (10.5%) | 1/15 (6.7%) | 1/8 (12.5%)* |
| Irrelevant returned positions / top-five positions | 15/84 (17.9%) | 50/71 (70.4%) | 28/36 (77.8%)* |
| Uncertain returned positions / top-five positions | 32/84 (38.1%) | 16/71 (22.5%) | 6/36 (16.7%)* |
| Correct no-match, frozen negative cases | 2/2 | 2/2 | 2/2* |
| Saudi Arabic top-three intent success | 0/4 | 0/4 | 0/4* |
| Automotive cases without unsupported displayed fitment | 2/3 | 3/3 (all empty) | 2/2 (both empty)* |
| False-exact rate | N/A | N/A | N/A |
| Median successful latency | 2,392.5 ms | 566.5 ms | 4 ms* |
| P95 successful latency | 13,010 ms | 1,309 ms | 12 ms* |

`*` **Not a Gemini-effect measurement:** these are only the 19 text-only
cases. No Gemini request occurred for them. Their entire top-five rankings
were identical to V3-local on those same 19 cases. On that **paired** subset
(17 positive cases), V2 top-1/top-3/top-5 were **3/17, 4/17, 4/17**;
V3-local and the nominal C arm were **1/17, 1/17, 1/17**. The C text-only
latency is mostly warmed/cached sequential execution, **not model speed**.
No arm labeled a returned product "exact," so false-exact has a zero
denominator rather than a fabricated 0% error rate.

Strict price/condition/location/fitment fields are often missing from web
metadata. Unknown fields were **not** treated as satisfying a hard constraint.
No-result cases have no top-five compliance denominator. The no-result
automotive scores mean only that no unsupported fitment was displayed; they
are not evidence of successful automotive discovery.

## Separate image-understanding review

Across nine verified query-image cases, V2's existing vision route completed
nine calls. Independent review against the **pre-search** visible evidence:

| Image attribute | V2 | V3-local | Gemini |
| --- | ---: | --- | --- |
| Correct broad category | 8/9 | No interpretation path | Not measured |
| Correct color where visually judgeable | 6/6 (3 N/A) | No interpretation path | Not measured |
| Correct visible brand | 0/1 (8 N/A) | No interpretation path | Not measured |
| Visible model identity | 0 applicable cases | No interpretation path | Not measured |
| Useful supported attribute mentions | 23 | No interpretation path | Not measured |
| Unsupported/over-inferred attribute mentions | 26 across 8 cases | No interpretation path | Not measured |
| Semantic interpretation failure | 1/9 (multiple shoes interpreted as socks) | N/A | 9/9 unavailable |

V2's classic-watch interpretation omitted the visibly supported dial brand;
several other outputs over-inferred material, mechanism, or product details.
The unsupported-attribute count is a review of individual claims, not a
per-image percentage.

## Gemini attempts, provenance and cost

The initially chosen `gemini-2.5-flash` returned HTTP 404: the API said the
model was no longer available to new users. The key's model list still
advertised it, so listing a model did not prove usable generation access.
`gemini-3.8-flash` then returned HTTP 503 on the first permitted query image;
a single text diagnostic returned the provider's "high demand" message.
`gemini-3.7-flash` also returned HTTP 503 on its first permitted query image.
The runner stopped further calls after each failure. There was **no valid
Gemini image interpretation**, no query embedding, and no candidate-photo
comparison. This is a service-availability blocker, not evidence that Gemini
understood any image correctly or incorrectly.

Across these bounded diagnostic/live attempts: **5 inference calls**:
**3 query-image calls**, **2 text-only diagnostic calls**, **0 candidate-image
calls**; **0 cache hits / 3 query-image misses**, **5 failed inference calls**,
**0 reported input/output usage tokens**. Three separate read-only model
metadata GETs are not included in the five inference calls. Embedding
dimension: N/A (no embedding call). Google's [published 2026 standard
pricing](https://ai.google.dev/gemini-api/docs/pricing) for Gemini 3.7/3.8
Flash is $0.75 / million input tokens and $3.75 / million output tokens through
December 2026. **Estimated successful-token cost: $0**, because the provider
returned no successful generation or usage metadata; actual charges for
failed requests cannot be independently established. This is an **estimate**,
not a billing claim. No billing setting was changed.

## Per-case outcomes and failure analysis

The following summarizes the **best hard-constraint-compliant top-five
judgment**. `—` means no independently supported match in the top five;
it does not mean a provider had no products. C's 19 text cases equal B by
design, so the C column describes only image-case execution.

| Frozen case | V2 | V3-local | Gemini image case |
| --- | --- | --- | --- |
| Casio DW-5600E | EXACT | EXACT | text-only |
| Adidas Samba OG | — | — | text-only |
| Longchamp Le Pliage M | EXACT | — | text-only |
| Galaxy S24 | — | — | text-only |
| Ordinary Niacinamide | EXACT | — | text-only |
| Levi's 501 Original | EXACT | — | text-only |
| Black structured bag | UNSCORABLE | UNSCORABLE | UNSCORABLE |
| Casual low-top sneaker | — | — | HTTP 503, no score |
| Classic wristwatch | CLOSE | — | stopped, no score |
| Over-ear headphones | CLOSE | — | stopped, no score |
| Evening dress | CLOSE | — | stopped, no score |
| Home coffee maker | CLOSE | CLOSE | stopped, no score |
| Budget KSA | — | — | text-only |
| Used camera price range | — | — | text-only |
| Color and size | — | — | text-only |
| New tablet | — | — | text-only |
| Home delivery | — | — | text-only |
| Camry headlamp | UNSCORABLE | UNSCORABLE | UNSCORABLE |
| Civic front brake pads | — | — | text-only |
| Cabin filter SKU | — | — | text-only |
| Unidentified bracket | — | — | stopped, no score |
| Arabic earbuds/Riyadh | — | — | text-only |
| Arabic used iPhone | — | — | text-only |
| Arabic coffee machine | — | — | text-only |
| Arabic abaya/color | — | — | text-only |
| Ambiguous watch back | CLOSE | — | stopped, no score |
| Ambiguous headphones scene | CLOSE | CLOSE | stopped, no score |
| Ambiguous multiple shoes | — | CLOSE | stopped, no score |
| Nonexistent model | correct no-match | correct no-match | text-only, identical |
| Incompatible charger | correct no-match | correct no-match | text-only, identical |

Among 26 positive cases, V2 had 16 with no supported top-five match
(7 returned no product); V3-local had 22 (11 returned no product).
The remainder include insufficient listing metadata, wrong/unrelated
candidates, strict constraints, and the lack of local image interpretation.
The outputs do not reliably distinguish provider inventory gaps from
discovery, identity resolution, filtering or reranking for every empty case;
do **not** assign a fabricated root cause. The Civic case returned
insufficiently evidenced fitment in V2, rather than a verified Saudi-spec
replacement. Image understanding was wrong for V2's multiple-shoes case.

Gemini ranking improvements: **none measured**. Worsenings: **none measured**.
Intent improvements without ranking change: **none measured**. A correct
Gemini interpretation blocked by inventory: **none established**. Gemini
hallucinations: **not assessable**, since no interpretation completed.
The 19 text-only C cases made no Gemini call and had no ranking changes
relative to V3-local. Do not attribute their rankings to Gemini.

## Decision gate

**C — no demonstrated benefit; keep stable V2 and rethink the approach.**
V3-local underperformed V2 on the 26 positive, independently reviewed cases
in this run, and no image case produced a usable Gemini response. A separate,
bounded availability/structured-output check would be required **before**
another C ranking comparison. This decision is about *insufficient or
negative evidence in this run*, not proof that Gemini image understanding
cannot work. Do not advance V3+Gemini to controlled production validation.

Limitations: Commons query photos are permitted but not real user uploads;
merchant photos were deliberately excluded from visual comparison. Broad
style similarity cannot be fully judged from listing metadata alone, so
uncertain candidates stayed uncertain. The experiment duplicated V2's image
endpoint prompt rather than exercising the HTTP route's admission controls.
Feed snapshots and Brave web results can vary between runs, and sequential
shared-provider/cached execution biases latency. The nominal C arm has no
measured Gemini contribution. OpenAI V2 vision calls were not costed here.

Safety/scope: **ZERO merchant, affiliate, retailer, provider-result or
candidate product images sent to Gemini**; only licensed benchmark user
query images were attempted. No merge, GitHub main modification, Production
deploy, OTA update, APK/EAS build, billing-setting change, UI/feed/provider
production edit, startup-audio edit, or stable V2 code edit occurred.