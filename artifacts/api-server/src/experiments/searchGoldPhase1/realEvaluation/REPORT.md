# Frozen Phase 1B — observed authorized-source search gate

**Decision: do not advance Phase 1B.** The controlled-fixture gains did not generalize reliably to these preregistered live-source searches. This is a paired, authored-query evaluation of currently accessible sources, **not** a random sample of shopper traffic or a production-wide quality estimate. All percentages below carry their actual denominators; an unknown inventory state is not a verified no-match.

## 1–5. Branch, commits, execution and source availability

1. Branch: `experiment/search-gold-phase1`. GitHub main stayed at `8698bcc63819e11794a251fda6661136ee1079a8` during preregistration; verify it again after the evaluation commit.
2. Evaluation commit: see the GitHub experiment-branch head reported with delivery; this report and its evidence belong to that commit.
3. Frozen implementation: GitHub commit `b20cb956287485dd57d421fef92935c12e29269b`. The selected search implementation fingerprint was `185c7de62040c06516983028a7d4807cfb7411efd95e8ddbbda9f62becc41450` before execution. The 40 cases and judging rules were preregistered separately at GitHub commit `cc4e8c8620583d3c89f55eeb3b80440e956dfb38`, case SHA-256 `4359419400333f3a2831cc30efe65c9be4bea90cf19732b3e4e51dceb6a895f8`, **before** looking at a result.
4. Exactly 40 cases completed in both arms, September 30, 2026, 09:05–09:07 UTC. V2 and Phase 1B shared the same in-process authorized provider registry; their order alternated by case, with no per-case retries or search-behavior changes. Candidate evidence, parsed intent, stages, failure timings, and source contribution are preserved in `observations.json`; blinded candidate packets and independently authored verdicts are preserved separately. All **475 unique displayed** candidates received relevance, identity and every hard-constraint verdict before arm labels were rejoined. The arms displayed 463 and 214 candidates respectively (the same item may appear in both arms).
5. Seven enabled feed indexes warmed without errors before the first query: AliExpress 4,798 items, Nazih 482, Diesel 2,742, StyleWe 1,703, Luxury Closet 5,000, Deal Outlet 5,000, Huawei **0**. Existing Brave discovery was eligible. Readiness took 32.4 seconds. An indexed count is not a count of matches or guaranteed current stock. These are seven index-ensure invocations, **not** seven measured feed HTTP requests; exact feed-network call counts are not instrumented.

## 6–8. V2, Phase 1B and side-by-side scorecard

| Observed measure | Stable V2 | Frozen Phase 1B | Scope |
|---|---:|---:|---|
| Precision@1 | 9/14 = **64.3%** | 9/14 = **64.3%** | Only cases with independently found qualifying inventory; absent first results are misses |
| Precision@3 | 33/42 = **78.6%** | 26/42 = **61.9%** | Three fixed slots for each of those 14 cases |
| Success@5 | 14/14 = **100%** | 11/14 = **78.6%** | Same 14 independently found cases |
| Independently supported exact product at rank 1 | 6/9 = **66.7%** | 5/9 = **55.6%** | Same nine exact-required cases with found inventory, not the system's own EXACT assertion |
| Displayed-result hard-constraint evidence compliance | 134/463 = **28.9%** | 91/214 = **42.5%** | All displayed results; unverified hard requirements do **not** pass |
| Irrelevant among judged top five | 6/65 = **9.2%** | 3/50 = **6.0%** | Displayed top-five slots in the 14 found-inventory cases only |
| Irrelevant among all judged displayed | 39/221 = **17.6%** | 42/182 = **23.1%** | Displayed candidates in the 14 found-inventory cases only |
| Zero-result searches | **13/40** | **24/40** | Empty output is not proof of no inventory |
| Provider-failure searches | **0/40** | **0/40** | Observed timeout/error evidence |
| Median / p95 client-side wall latency | **1,785 / 3,165 ms** | **1,565 / 3,444 ms** | 40 sequential paired searches, not server production SLA |

Only **14/40** cases had independently found qualifying inventory in the captured union; **26/40 remain unknown**, rather than counted as no-match wins. There is no query-level hard-constraint score with independently completed query-level verdicts; the displayed-result measure is conservative and does not imply fulfillment. Counts and definitions are in `scorecard-real.json`. Phase 1B was better on judged top-five useful count in case **1**; V2 was better in **2, 3, 5, 11, 13, 14, 27**. Other differences with unknown availability are described below, not silently promoted to scored wins.

## 9. Arabic intent and retrieval audit

This table covers **all 13 Arabic-script cases**, including the two automotive cases. `?` means the returned evidence cannot establish that stage's correctness. Full parsed fields, evidence levels, hard requirements, planned and executed outer strategies are in each `observations.json` row; an outer strategy does not reveal V2's internal subquery. A price “around” is a preference, not a hard cap.

| Case | Phase 1B interpretation / hard vs preference | Retrieval and ranking observation | Primary diagnostic |
|---|---|---|---|
| 7 | Handbag, black and `<300 SAR` hard; large subjective preference; Arabic/English lexical plans | Neither arm returned a candidate; meaning beyond parsing untestable | INVENTORY? |
| 8 | Men's watch hard; ~500 SAR preference; lexical/category plans | Watch listings surfaced; price suitability weak, one useful by preregistered type/audience | RETRIEVAL/price preference |
| 9 | Audio, `<400 SAR`, original/authentic hard; lexical/category plans | Both empty; cannot verify authenticity or absence | INVENTORY? |
| 10 | White shoes, EU 42 hard; lexical/size plans | V2 collection pages lack EU 42 evidence; Phase 1B abstained | CONSTRAINT |
| 11 | Women's perfume hard; ~300 SAR preference; Arabic then English lexical plans | Both returned some relevant fragrance pages, with incomplete individual-price evidence | RETRIEVAL/price preference |
| 12 | Used phone in Jeddah hard; lexical/location plans | V2 broad used-phone pages lack seller-location evidence; Phase 1B abstained | CONSTRAINT |
| 13 | Nike, black, **EU 42** hard; attribute plan | Phase 1B parsed size as `EU` rather than `42`; V2 had a matching-size candidate, Phase 1B zero | **INTENT** |
| 14 | Used base iPhone 15 hard; brand/model/condition plan | V2 retained a qualifying candidate; Phase 1B zero after evaluation | IDENTITY/constraint gate |
| 15 | Samsung S24 and `<2500 SAR` hard; model/budget plan | Both empty; no qualifying price established | INVENTORY? |
| 16 | Men's Diesel jeans hard; bilingual/category plan | Both retained suitable feed offers and respected the intended type | No diagnosed failure |
| 17 | Huawei watch and `<700 SAR` hard; category/budget plan | Both empty; Huawei's authorized index had zero items | INVENTORY? |
| 36 | Original spark plugs with Honda Accord 2015 fitment hard; bilingual automotive plans | Both empty; no fitment/provenance evidence | INVENTORY? |
| 37 | 12V/70Ah car battery in Riyadh hard; bilingual/spec plans | V2 returned two insufficiently evidenced pages; Phase 1B abstained | CONSTRAINT |

On the **three** Arabic/mixed cases with independently found qualifying inventory, useful Success@5 was **V2 3/3, Phase 1B 1/3**. This is not an Arabic-language population accuracy statistic. For blank cases the final ranking cannot be validated; cases 13–14 demonstrate that preserved intent and useful retrieval can still be lost before display.

## 10–15. Identifiers, identity, constraints, irrelevance and no-match

10. Identifier/model-code searches were cases 23–27. Only **24 (BNE-LX1)** and **27 (CW2288-111)** had independently found qualifying inventory: both arms found an exact item in their top five (**2/2**). Cases 23, 25 and 26 lacked sufficiently corroborated exact codes in observed results; do not call those identifier successes or proven absences.
11. The system asserted **EXACT** on 18 displayed Phase 1B results: three well-supported S24 256GB listings in case 1, four independently supported exact-code/colorway Nike listings in case 27, **seven adjudicated false exact assertions** in case 27 (other explicit colorways/styles), and **four UNVERIFIED** assertions (generic series/shopping pages lacking the requested model or code). The per-assertion ID and source-text evidence is in `scorecard-real.json` under `assertedExactFalseRatePhase1b.audit`. Descriptive series pages and same-title products do not establish exact identity.
12. Hard-constraint compliance is the displayed-result evidence rate in the table: **134/463 V2**, **91/214 Phase 1B**. Unknown price, EU size, seller city, condition, authenticity, and vehicle fitment are unknown—not a verified pass. Phase 1B's abstentions avoid some unsupported matches but do not satisfy a user's positive request.
13. Irrelevance depends on the denominator: top five **6/65 V2 vs 3/50 Phase 1B**; all displayed candidates **39/221 vs 42/182**, each restricted to the 14 cases with independently found qualifying inventory. The other candidates were judged blind too, but are not in these source-available rates. Never substitute all-result totals for top-five precision.
14. Phase 1B false-exact rate among adequately identity-adjudicated assertions: **7/14 = 50%**, with **4 further UNVERIFIED**. Unsupported exact assertions are not successful exact matches. This convenience sample cannot estimate the production false-exact rate to 0.5% precision.
15. Correct no-match: **NOT ESTABLISHED (0 independently proven no-inventory cases)** for both arms. Case 32's deliberately improbable SKU produced V2 garbage and Phase 1B abstention, a useful safety contrast; without exhaustive independent inventory proof it is not a scored true negative. The three difficult cases 32–34 remain source-scoped observations, not global absence claims.

## 16–23. Improvements, regressions, inventory, provider costs, latency and failures

16. Phase 1B beat V2 on case **1**, lifting judged useful top-five results from 1 to 3 and suppressing S24 Ultra/FE/series noise. It also abstained from case 32's 100 irrelevant V2 results, although this is not independently scoreable as correct no-match.
17. V2 beat Phase 1B on judged top-five useful count in **2, 3, 5, 11, 13, 14, 27**. Additional V2-only useful evidence not included as a scored paired win due to unknown source availability: **29** and **30**. Material missing-fulfillment regressions: **3** (Air Max 270), **13** (Nike black EU42), **14** (used iPhone 15), **29** (cheaper *alternative* misunderstood/abstained), **30** (Airwrap-like styler alternatives). Case 27 also has seven false-exact colorway assertions. These are not provider outages.
18. V2 zero-result IDs: **7, 9, 15, 17–22, 33–36** (13). Phase 1B zero-result IDs: **3, 7, 9, 10, 12–15, 17–22, 25, 26, 29, 30, 32–37** (24). Details are in `observations.json`.
19. Coverage limitations: Huawei warmed to **zero** indexed products; the other seven feeds have categories/geographies that do not establish local used-phone, EU-size, authenticity or OEM-vehicle fitment. Brave supplies discovery pages, often without a current product price, size, stock or seller-location proof. No provider was added or scraped.
20. Brave network requests recorded by the existing provider metrics: **41 V2 + 35 Phase 1B = 76**; cache hits **17 + 25 = 42**. Visible web results: **141 V2, 74 Phase 1B** (not equivalent to requests). Displayed feed results: **322 V2, 140 Phase 1B**; Phase 1B's internal retrieval saw more feed candidates across multiple planned calls, so its summed per-call contribution must not be mistaken for unique displayed products. Feed HTTP request counts were not instrumented. No Gemini calls or candidate-image submissions occurred.
21. Latency: median **1,785 vs 1,565 ms**, p95 **3,165 vs 3,444 ms**, V2 then Phase 1B respectively. The 32.4-second common index warmup is excluded. Sequential paired order alternated, but shared caches and live stock changes remain confounders.
22. Each **zero-useful-top-five** query has one primary diagnostic below. `INVENTORY?` is a **tentative observed-source coverage limitation**, not an independently established no-match; all such cases have unknown inventory. V2: 20 failures = `INVENTORY?` **13** (7,9,15,17–22,33–36), `CONSTRAINT` **3** (10,12,37), `IDENTITY` **4** (23,25,26,32). Phase 1B: these same 20 plus `IDENTITY/evaluator` **2** (3,14), `INTENT` **1** (13), `QUERY_PLANNING` **1** (29), `RANKING/evaluator` **1** (30), for **25**. For 23/25/26/32, IDENTITY means *no supported matching code*, not a confirmed source-wide absence. No observed `PROVIDER_FAILURE`; no case is asserted to lack every authorized discovery source.
23. Material regressions are **3, 13, 14, 29, 30, 27**, plus reduced top-five useful depth in **2, 5, 11**. Of 39 V2-only independently useful displayed items, **at least 7 in case 3, 1 in 13, 1 in 27 and 7 in 30** are explicitly visible in Phase 1B's rejected list, demonstrating filtering rather than mere source outage. Conversely, 187 V2-only judged irrelevant displayed items are absent from Phase 1B, but absence can reflect different retrieval plans: do **not** claim all 187 were actually fetched and filtered.

## 24–27. Gold gate, generalization, priority and verification

24. Targets: Precision@1 ≥70% **not reached** (64.3%); Success@5 ≥75% **reached conditionally** on 14 found-inventory cases (78.6%), but worse than V2's 100%; independently supported exact rank-1 ≥80% **not reached** (55.6%); evidenced hard constraints ≥97% **not reached** (42.5% of displayed results); correct no-match ≥90% **not established**; adequately adjudicated false-exact ≤0.5% **not reached** (50%). These are paired sample results, not population confidence bounds.
25. The controlled-fixture improvement **did not reliably generalize**: Phase 1B removed some garbage, but did not improve P@1, lost P@3 and useful top-five coverage, and asserted false exact matches. Do not advance on the fixture score alone.
26. Next engineering priority **after separate approval**, not implemented here: fix independently supported exact-identity/colorway assertions and the loss of useful V2 candidates at the evaluator/retrieval boundary. Then revisit mixed-language EU sizing and “cheaper alternative” intent without weakening verified same-variant savings safety. Acquire stronger independent merchant identity/stock/size/fitment evidence before making stronger no-match or hard-compliance claims.
27. Verification: focused experimental/evaluation checks **82/82** initially and updated scoring-specific checks **5/5**; existing API suite **109/109**; TypeScript typecheck passed after tooling changes. Frozen controlled fixtures and their expected outputs were not edited. The finalized report files are `cases.json`, `FREEZE.md`, `observations.json`, `blind/`, `judgments/`, `independent-labels.json`, and `scorecard-real.json`.

**Scope confirmation:** Phase 1B's parser, planner, evaluator and ranking remained frozen throughout this run; GitHub main and production V2 were untouched. No Phase 2, production deployment, OTA, APK/EAS build or billing change. No merchant/candidate image was sent to Gemini. Stop here and await approval.