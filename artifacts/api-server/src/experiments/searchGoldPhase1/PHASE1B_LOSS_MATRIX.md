# Phase 1B loss matrix (pre-change diagnosis)

The frozen V2 baseline formally passes only cases 13, 33, 34, 35, 39, 40, 41, 51, 58 and 59. Case 51 is the **only formal V2 PASS → Phase 1 FAIL**. The other rows below have a relevant V2 fixture candidate but fail at least one Phase 1 check; a V2 candidate is *not* proof of an exact identity or a formal V2 pass. These are controlled synthetic cases, not observed inventory. IDs and current states were checked against the frozen V2 and Phase 1 result JSON before editing Phase 1B.

| Case | V2 relevant offer(s) | Phase 1 displayed | Primary loss cause | Safe recovery path |
|---|---|---|---|---|
| 2 | brand-model-exact | none | Parser misses explicit brand; evaluator requires structured type even when none was requested | Accumulate bounded brand/model evidence, reject conflicting model |
| 3 | sku-scoped-match | none | Seller-scoped SKU identity and irrelevant classification | Parse merchant scope; matching labeled SKU at another seller is not the requested offer |
| 5 | shared-offer-a/b | none | Narrow model-only V2 retrieval returns no candidate | Stage lexical raw query fallback; retain two distinct merchant offers |
| 6 | one-char-exact | none | Model-only retrieval sees near code but misses exact | Retry raw brand/model query; preserve exact identifier bytes |
| 10 | soft-budget-near | soft-budget-near | Approximate Arabic budget and omitted over-budget alternative | Distinguish soft price preference from strict maximum |
| 14 | mixed-brand-model | none | Mixed-script brand missed, model remains unknown | Preserve Latin brand/model spans and combine bounded evidence |
| 17 | usb-c-fixture | usb-c-fixture | Connector matches, but classified alternative rather than expected exact | Keep Micro-USB rejected; do not call a generic charger product exact from connector alone |
| 19 | arabic-numeral-iphone15 | none | Arabic numeral and phone model not retained | Normalize digits for matching without mutating original identifier |
| 20 | brand-typo-correction | none | `Samsng` and model phrase decomposed incorrectly | Only corroborated brand spelling repair, then require model evidence |
| 21 | ambiguous-jaguar-auto/animal | none | No clarification despite genuine domain ambiguity | Explicit clarification, no guessed domain |
| 23 | generic-charger-usbc/lightning | both | Device/connector missing; alternatives shown rather than clarification | Ask which connector/device when required for compatibility |
| 37 | size-38-eu | none | Size lacks verified candidate evidence | Match explicit EU 38 variant; reject 39 |
| 38 | size-system-eu | none | Size system absent; no clarification | Ask for sizing system before exact variant assertion |
| 49 | cheaper-same-identity | none | Cheaper request short-circuits before candidate identity/comparable-offer evidence | Compare only supported same-variant offers with valid prices; otherwise abstain |
| 51 | current-available-offer | none | Exact-only display suppression hides useful current offer; stale offer is out of stock | Show current offer honestly; never mark stale offer purchasable |
| 52 | similar-camera | none | Different model demoted to irrelevant rather than useful similar alternative | Separate display relevance from exact identity |
| 53 | same-only-close | none | Conflicting model is rejected and exact-only display hides alternatives | Show explicitly labeled close alternative, never exact |
| 57 | affiliate-neutral-relevant | none | Relevant candidate is a suppressed alternative | Relevance first, no affiliate boost; keep exact identity gate |
| 60 | multi-merchant-a/b | none | Model-only retrieval finds no candidate | Stage raw query fallback; keep two offer IDs/links |
| 61 | conflict-price-source-a/b | none | Model-only retrieval finds no candidate; conflict cannot be inspected | Recover candidates, expose conflicting evidence rather than fabricate certainty |
| 62 | affiliate-neutral-exact-watch | none | Relevant bounded-model candidate suppressed; lower-quality affiliate is similar | Verify identity independently of affiliate, label weaker offer honestly |

Cross-cutting controls: never weaken strict price/color/condition/connector/size or authoritative fitment gates; no synonym or affiliate signal can establish exact identity. Execute bounded retrieval stages only until enough useful evidence is found. Preserve the frozen 39-case fixtures, checks and V2/Phase 1 outputs for side-by-side comparison.