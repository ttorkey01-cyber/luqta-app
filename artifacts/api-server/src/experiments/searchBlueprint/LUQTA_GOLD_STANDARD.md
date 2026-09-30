# LUQTA SEARCH GOLD STANDARD

**Status:** target specification, not implemented functionality. **Evidence
date:** 2026-09-30. This document describes what a Saudi shopping search
agent should do; it does not assert that current LUQTA or a named competitor
already does it. See [public reference evidence](REFERENCE_SYSTEMS.md),
[current V2 gaps](CURRENT_V2_GAP_ANALYSIS.md), [pipeline](SEARCH_ARCHITECTURE.md),
[acceptance cases](ACCEPTANCE_TESTS.md), and [scorecard](SEARCH_SCORECARD.md).

## Non-negotiable rules

1. **Relevance before revenue:** rank an eligible non-affiliate result above a
   less relevant affiliate offer. Commission, tracking availability and
   partner status are not relevance evidence.
2. **No fabricated certainty:** identity, size, condition, price, location,
   delivery, availability and vehicle compatibility require attributable,
   fresh-enough evidence. `unknown` is neither `true` nor a hard-constraint
   pass. Label alternatives as alternatives; never call a lookalike *the same
   product* without independent identity evidence.
3. **Explicit text controls image interpretation:** a user photo helps
   identify the object, but “black,” “under 300 SAR,” “used in Jeddah” or
   “2022 Camry” in the user's text cannot be replaced by a guessed color,
   higher price, new item, or different fitment. If text and photo disagree,
   ask a focused clarification or disclose the conflict.
4. **Image permissions:** accept licensed/user-authorized query photos. Do
   not send merchant, affiliate, provider-result, retailer or candidate
   product images to Gemini. A later candidate-visual method requires
   separately verified image rights and local/authorized processing; it is
   not part of this documentation task.
5. **Abstain safely:** distinguish “no verified match,” “no indexed offer,”
   “supplier unavailable,” and “cannot verify this constraint.” Do not turn
   an API timeout or incomplete catalog into a claim that the product does
   not exist. Never silently relax a hard filter.

## Required capabilities and observable contract

| # | Capability | Required behavior and release evidence |
| --- | --- | --- |
| 1 | Query understanding | Parse product type, brand, model/GTIN/MPN/SKU, requested action (exact/cheaper/similar), comparison target, negation, budgets, attributes, and referenced conversation item into a typed intent. Unresolved pronouns without context trigger clarification. Preserve raw text alongside normalization. |
| 2 | Arabic and Saudi dialect | Understand colloquial phrases such as “أبغى,” “أبي,” “حدود,” “نفسه,” transliterated brands, mixed Arabic/English, Arabic numerals, and market-specific part names. Preserve Latin model tokens and distinguish a soft “بحدود 250” from strict “أقل من 300.” Ambiguous “شمعة كامري” must not automatically become either a headlamp or a spark plug. |
| 3 | Image understanding | For an authorized user photo, separate visible category/color/shape, legible text/OCR, brand/model evidence and uncertainty. Never infer vehicle fitment from appearance alone. Image-only, text-only and image+text paths have distinct evaluation labels; image+text applies explicit text constraints. Ambiguous/scenic/multiple-object photos may require a question. |
| 4 | Query planning | Generate a bounded, explainable set of exact-ID, lexical, translated/synonym, category and optional semantic queries from the structured intent. Limit fan-out/cost, keep hard constraints unchanged, record which route yielded a candidate, and avoid cross-category expansion that erases the user's goal. |
| 5 | Hybrid retrieval | Retrieve exact identifier/lexical candidates even if embeddings are absent. Add locally feasible semantic retrieval only when it improves frozen Arabic/misspelling/visual-style cases; combine it with lexical matching rather than replacing exact IDs. Vector service is not a prerequisite for the first release. |
| 6 | Multi-source discovery | Parallelize eligible official feeds and existing Brave text discovery; later add lawful local/used sources only with clear terms and provenance. Measure inventory coverage, freshness, source errors and result eligibility separately. Never treat affiliate status as a relevance feature. |
| 7 | Product identity resolution | Build an evidence hierarchy: corroborated GTIN/MPN/part number and manufacturer identity; then source-backed brand+model+variant; then category/style only. Seller-specific SKU is not necessarily a global identifier. Conflicts or missing IDs remain unresolved, not exact. |
| 8 | Product and offer grouping | Keep canonical product, color/size variant, and seller offer distinct. Preserve merchant, current item/total price, currency, shipping, stock and timestamp per offer. Merge the same offer idempotently, group genuine same-product offers, and never collapse different model years or incompatible variants. |
| 9 | Hard constraints | Evaluate each explicit hard requirement as `verified_pass`, `verified_fail`, or `unknown`, with evidence and currency/units. Only all-pass products enter the compliant set. For strict “less than 300 SAR,” 300 fails; unknown price/FX, condition, size system, color, city or delivery cannot pass. Soft preferences influence ranking but cannot masquerade as filters. |
| 10 | Semantic relevance | Label query-to-product relevance independently of provider rank, popularity, price, affiliate tracking or image resemblance alone. Reject wrong categories and unsupported claims before reranking. Compare exact and reasonable alternatives under separate judgments. |
| 11 | Shopping reranking | Among eligible candidates, prioritize exact identity when requested, relevance and constraint satisfaction, then evidence quality/freshness, genuine availability, comparable total cost and user-stated preferences. Keep the score auditable; any personalization is opt-in and must not override explicit constraints. |
| 12 | Exact versus similar classification | Expose `verified_exact`, `relevant_alternative`, `uncertain`, or `not_relevant` with evidence. A high model confidence is not proof of identity. For “same but cheaper,” compare offers of the **same resolved variant** first; a similar cheaper item is shown only under an explicit alternative label. |
| 13 | Automotive search | Parse part intent, make/model/year, engine/trim, side, OEM/aftermarket, condition and location. Require catalog/fitment evidence for the precise configuration and part identity before claiming “fits,” “original” or “direct replacement.” Ambiguous “شمعة,” missing side, incompatible year or unknown VIN/engine warrants clarification or an unverified label, not a safety-critical claim. |
| 14 | Used and local search | Verify condition, seller city and delivery coverage separately; “seller in Jeddah” is not “delivers to Jeddah.” Show source/timestamp and avoid treating unknown condition or location as verified used/local. Adding marketplaces depends on lawful access, deduplication and freshness. |
| 15 | No-confident-match behavior | Withhold irrelevant candidates instead of filling slots. Say why no verified result qualifies, and offer an *explicitly labeled* broader alternative or clarifying question. Show distinct states for zero indexed candidates, strict-filter exclusion, ambiguous image, stale inventory and provider error. |
| 16 | Result explanations | Give short, source-backed reasons: matched identity, color/size, price and timestamp, locality/delivery, and unresolved limits. Avoid inventing seller guarantees, exact fitment, quality or availability from a title snippet. Prefer useful evidence over opaque model confidence. |
| 17 | Deduplication | Remove duplicate same-merchant offers while retaining distinct seller offers grouped under the same proven product. Use stable canonical URLs/merchant offer IDs when lawful and available; ambiguous titles alone do not justify collapsing identities. |
| 18 | Latency | Budget end-to-end query/image understanding, source fan-out, normalization and reranking with cancellation. Measure p50/p95 across cold and cached paths, text/image modes and failures. Proposed MVP gates: cached ≤2 s/≤5 s and cold ≤4 s/≤10 s (p50/p95); the long-term gates are in the scorecard. Never present a cache-only arm as independent model latency. |
| 19 | Reliability and fallback | Bound timeouts, response size, concurrency and search budgets. Preserve useful verified results if one provider fails, but do not label an unverified fallback exact. Differentiate an outage from no match; use a common ready-provider cohort for fair offline comparisons. No new paid dependency may silently become mandatory. |
| 20 | Future learning and feedback | Define consent-aware impressions, clicks, saves, explicit “wrong match,” purchases when legitimately observable, and outcome review. Maintain human-labeled holdout and drift checks before using behavioral signals to change rank. No unverified claim that a current click/purchase feedback loop exists. |
| 21 | “صِدها لي” compatibility | Persist structured intent, hard filters, source/identity provenance and user permission so a future hunt can re-evaluate refreshed offers. Record actual scheduler/notification state; do not promise continuous monitoring, current stock or alerts when the monitoring path is unavailable. |

## Gates, not a one-shot rewrite

- **Before any implementation:** approve case fixtures, data/image permissions,
  independent relevance/identity/fitment labels, and the [pass/fail suite](ACCEPTANCE_TESTS.md).
  Freeze a baseline from stable V2; report unavailable or unscorable cases,
  rather than silently changing denominators.
- **Safety gates at every stage:** no fabricated product facts, no unsupported
  automotive compatibility/OEM assertion, and no false exact identity. Product
  search improvements never justify relaxing these rules.
- **Initial quality gate:** meet the scorecard's explicit MVP floors for
  answerable and negative slices; inspect strict Arabic, image and automotive
  results separately. Do not average a safety regression into a good aggregate.
- **Long-term gold target:** reach [scorecard](SEARCH_SCORECARD.md) targets
  repeatedly on fresh, authorized catalogs and images without a critical
  regression, while preserving a working, inexpensive V2 fallback.