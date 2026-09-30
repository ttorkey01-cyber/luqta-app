# LUQTA Search Blueprint — executive summary

**Status:** Research and proposal only, checked 2026-09-30. Prepared on
`experiment/search-blueprint` from GitHub `main` at `8698bcc`. This is **not
Search V4 implementation**: no V2/V3 behavior, provider configuration,
production environment, billing, deployment, OTA or mobile build is changed
by these documents. Implementation and rollout require separate approval.

## Recommendation in one minute

Keep the stable V2 search foundation. Improve its evidence and safety
contracts **before** adding an expensive or fashionable new search engine.
Parse the user's explicit Saudi Arabic/text/image intent, search current
lawful feeds and Brave with bounded lexical/exact-ID variants, retain
provenance, resolve product/variant/seller-offer identity conservatively,
enforce every hard requirement as verified pass/fail/unknown, rank relevant
eligible results regardless of affiliate commission, then explain exact,
alternative, partial coverage or no verified match honestly. Add semantic
retrieval, more local/used sources and advanced visual methods only if
authorized data and paired quality tests demonstrate incremental value.
Never send merchant/candidate images to Gemini.

## What the public references actually teach

These are **public patterns, not claims about proprietary algorithms**; see
[source-by-source A–H evidence and 19 official references](REFERENCE_SYSTEMS.md).

| Reference | Useful documented/published pattern | Limit for LUQTA |
| --- | --- | --- |
| Google Shopping, Shopping Graph, Lens | Structured merchant product attributes and identifiers support discovery; organic relevance, prices and product information are distinct from labeled ads. Lens Multisearch combines a query photo with text refinement. | Graph scale, internal identity resolution, full ranking formula and complete coverage are not public or replicable. Build a small provenance-rich corpus, not a “Google clone.” |
| Amazon Shopping, Rufus → **Alexa for Shopping** (May 2026), Lens Live | Conversational shopping and comparisons with customer context; Lens Live publicly describes object detection, visual matching and a descriptive no-match caption. | Do not infer Amazon's private ranker or assume LUQTA has authorized candidate-image rights. Alexa for Shopping is a named shopping assistant, not a synonym for every Alexa voice purchase feature. |
| Perplexity Shopping | Contextual natural-language shopping answers and product cards; public claims of relevance and user-preference refinement. Later **Instant Buy** is eligible-merchant/U.S.-limited and distinct from earlier Buy with Pro. | Checkout availability is not proof of universal product coverage or accurate total-cost normalization. LUQTA should explain uncertainty rather than imitate commerce claims. |
| Algolia NeuralSearch | Documented independent keyword/vector retrieval and normalized merging, configurable blending, filters and analytics. | Hybrid retrieval is a pattern, not a mandatory service. Its NeuralSearch capability is plan-gated (current pricing places it under Elevate); no new subscription is proposed. |
| Shopify Search & Discovery | Storefront typo tolerance, predictive search, merchant-defined facets and search interaction insights. | A single merchant's configurable store search does not solve neutral multi-store product identity or permitted Saudi used-market coverage. Merchant boosts must not become affiliate relevance boosts in LUQTA. |

## Stable V2 audit and experimental caution

The [21-capability audit](CURRENT_V2_GAP_ANALYSIS.md) rates **0 GREEN, 18
YELLOW, 3 RED**. “No GREEN” means code alone cannot establish end-to-end
gold-standard quality; it does **not** mean V2 is broken or lacks useful
components. The RED items are hybrid semantic retrieval, canonical
product/offer grouping, and consent-aware feedback/learning. Existing
strengths include deterministic Arabic normalization/intent parsing,
several provider adapters, concurrent time-bounded retrieval, strict price
checks, Brave fallback, ranking, caching, a bounded user-image interpreter,
a mobile image→text-search handoff, and saved-hunt infrastructure. Their
coverage, evidence strength and quality still need measured improvement.

The separate V3-local benchmark reported top-five success **4/26** versus
**10/26** for its V2 arm; its query-image arm was unmeasured after **three
failed image calls**. These are experimental observations on a particular
benchmark, **not** measured production performance or a reason to promote
V3. Freeze one ready-provider cohort and authorized fixtures before
interpreting future comparisons.

### Ten gaps blocking the target

In impact/safety order (not an instruction to implement all ten at once):

1. Structured automotive fitment and original/OEM evidence.
2. Complete, tri-state enforcement of all explicit hard constraints.
3. Reliable no-confident-match, partial-source and provider-error states.
4. Saudi dialect and exact identifier handling without losing constraints.
5. Cross-store product identity, variant and separate seller-offer grouping.
6. Authorized local/used coverage and honest source readiness/freshness.
7. Measured image→text-search quality with explicit text precedence.
8. Relevance-first exact/alternative ranking and source-backed explanations.
9. Budgeted query planning, latency, source freshness and offline evaluation.
10. Conditional semantic recall if cheaper retrieval fixes leave a gap.

## Proposed target architecture

See [SEARCH_ARCHITECTURE.md](SEARCH_ARCHITECTURE.md) and the
[21-capability gold standard](LUQTA_GOLD_STANDARD.md):

```text
Authorized text / user image / both
  → typed intent (literal requirements, soft preferences, provenance,
                  ambiguity and user-text precedence)
  → bounded exact-ID + lexical + Arabic query plan
  → eligible official feeds + existing Brave text discovery in parallel
  → normalize source evidence; optionally fuse proven-value semantic candidates
  → conservative canonical product → variant → merchant offer grouping
  → tri-state hard-constraint and automotive-safety gate
  → user-relevance-first ranking, distinct exact/alternative labels
  → evidence-backed explanation + no-match / partial / outage decision
  → consented, offline-reviewed feedback and compatible saved hunts later
```

Unknown fields never satisfy hard constraints. Similar is never exact without
identity evidence; a model score is not proof of vehicle fitment. If a
supplier fails, LUQTA must not claim that no matching products exist.
Affiliate status must not affect organic relevance order.

## First five implementation priorities — **not authorized by this blueprint**

First freeze the [63-case acceptance specification](ACCEPTANCE_TESTS.md)
and [permanent scorecard](SEARCH_SCORECARD.md), acquire licensed images
and independent gold labels, and measure V2. **After separate approval:**

1. Evidence/provenance, strict hard-filter and automotive-safety contracts;
   exact/alternative and no-match/error states with a V2 rollback.
2. Test-led Saudi Arabic, mixed-language and exact-ID query planning on
   current feeds and Brave; bound fan-out rather than buy a vector service.
3. Cautious canonical product/variant/offer grouping and relevant, comparable
   same-product price ranking; preserve distinct seller offers.
4. Improve existing authorized user-image→text-search fusion and text
   precedence, with uncertainty/OCR tests. Never upload candidate photos.
5. Conditional lawful used/local source pilot with verified condition, city,
   delivery and fitment. Without rights or a suitable source, **do not**
   substitute scraped or invented inventory.

Each stage has impact/effort/cost/risk/dependency, preservation decisions and
exit conditions in the [incremental roadmap](IMPLEMENTATION_ROADMAP.md).

## How to tell whether a later increment is good enough

[ACCEPTANCE_TESTS.md](ACCEPTANCE_TESTS.md) defines **63 pre-implementation
cases** across exact identity, Saudi Arabic and mixed language, licensed
image-only and image+text, strict price/color/size/condition/location,
automotive fitment, used/local, same-item cheaper, alternatives, ambiguity,
misspelling, no-match and source outage. Cases use symbolic fixtures and
require a frozen authorized catalog, rights records, source timestamps and
independent labels; they do **not** assert that a listed offer exists.
“شمعة كامري 2022 أصلية” requires clarifying headlamp versus spark plug and
verifying side/engine/OEM/fitment as appropriate.

Proposed MVP **floors** on adjudicated, answerable datasets include
Precision@1 ≥0.70, Precision@3 ≥0.60, Success@5 ≥0.75, exact-product
rank-1 ≥0.80, query-level hard-constraint compliance ≥0.97, correct
no-match ≥0.90, Arabic intent ≥0.82 and evaluable image understanding
≥0.75. False-exact ≤0.5%, irrelevant top-five ≤0.20, duplicate-offer
≤5%, and **zero unsupported automotive fitment/OEM assertions** are
required. Cached p50/p95 ≤2s/≤5s; cold ≤4s/≤10s. Sustained long-term
targets and all denominators/slices are in the scorecard. **Success@5 is not
exhaustive Recall@5**; recall is scored only with complete gold inventory.
These numbers are proposed gates, not current scores or performance claims.

## Keep, change and cost boundary

**Preserve:** V2 search API/orchestrator, deterministic parser, feed/provider
registry and official adapters, configured Brave text fallback, normalizer,
dedup/ranker/cache extension points, bounded vision route and existing hunt
storage. **Improve:** quality tests, query planning, provenance, typed
constraints, identity/offer grouping, explanations and honest coverage.
**Replace only after evidence:** individual misleading title-only, fallback
or duplicate-decision heuristics; do **not** wholesale rewrite V2 or promote
weak V3-local behavior. **Add later with permission:** lawful used sources,
optional local semantics and consented feedback. **Remove:** no working
production provider by default.

No external service purchase or billing change is proposed. Existing Brave
and authorized vision usage are variable **existing** costs subject to
quotas; Gemini is optional later for authorized user-query images/text only,
not merchant/candidate images. Open/local retrieval incurs modest compute
and maintenance if justified. Hosted Algolia NeuralSearch is enterprise/
contract-dependent and **not needed now**. Used/local API access is
unknown/possibly licensed and requires separate source terms review.
Details, reasons and alternatives appear in the roadmap.

**Decision requested only after review:** approve or revise this
documentation and its fixture/rights plan before asking for any Search V4
implementation. There is no implementation authorization in this document.