# Product Identity Engine — experimental handoff

This is an **experiment, not an advancement recommendation**. The first benchmark
score was recorded before the live search replay. A narrow structural correction
to the engine was scored again on the same frozen corpus before replay. The
original independent labels, the initial score, and the final primary score
remain available; a separately blinded GTIN reassessment is reported only as a
sensitivity analysis. No primary labels or frozen search cases were rewritten.
The repository commit ID is reported in the handoff accompanying this file.

1. **Branch and commit.** `experiment/product-identity-engine`, forked from
   GitHub `main` at `8698bcc63819e11794a251fda6661136ee1079a8`; see the
   final handoff for this branch's commit ID.
2. **Files changed.** New code, tests, corpus, blind adjudications, scorecards,
   and replay evidence live solely under
   `artifacts/api-server/src/experiments/productIdentity/`. No production
   imports or routes were changed. Raw replay observations are preserved locally
   and in compressed archives for reproducibility.
3. **Architecture.** `IdentityRecord` represents a product's identifiers and
   attributes, a variant its color/size/storage/etc., and an offer its merchant,
   scoped listing identity, price, currency, stock, and freshness. Conservative
   grouping retains distinct product, variant, and offer levels.
4. **Evidence.** Decisions expose classification, confidence, positive,
   conflicting, and unknown evidence, product/variant/offer identities, and an
   explanation. GTINs retain raw and normalized values and check-digit status.
   Scoped identifiers, source-backed brand/model, explicit variants, and
   conflicts are distinct from weak descriptive similarity. Replay additionally
   records query-to-listing evidence separately from pairwise catalog identity.
5. **Benchmark.** Frozen `benchmark/pairs.json` has 136 pairs, SHA-256
   `41f8584c9a517f1a765127546353353fe6ff97ff31925f2d8c22287a63f475af`.
   It was authored before scoring; a separate reviewer labeled a shuffled,
   source-class-blind packet. Exact thresholds were not fitted to its labels.
6. **Provenance.** 24 `REAL_OBSERVED` (13 adequately adjudicated), 96
   `CONTROLLED` (88 adjudicated), and 16 `UNVERIFIABLE` (none adjudicated):
   101 adjudicated, 35 unknown overall. Six observed titles were sanitized or
   truncated, not byte-identical to the source. Controlled identifiers are
   synthetic, not merchant identifiers.
7. **Exact precision.** Primary: **16/24 = 66.7%**; sensitivity after
   independent GTIN re-adjudication: **24/24 = 100%**. The latter is not a
   replacement for the pre-registered primary result.
8. **Exact recall.** Primary: **16/17 = 94.1%**; sensitivity: **24/25 = 96%**.
   There were **zero EXACT predictions among 24 real-observed pairs**.
9. **Coverage.** Non-UNKNOWN predictions: **125/136 = 91.9%**; 11 abstentions.
   On the 35 unadjudicated pairs, **29/35** received non-UNKNOWN predictions;
   all 16 explicitly unverifiable controls received non-UNKNOWN predictions.
   That is unsafe overclassification, not successful coverage.
10. **False EXACT.** Primary: **8/24 asserted EXACTs = 33.3%**;
    sensitivity: **0/24**. The primary nonmatch false-positive rate is
    separately **8/84 = 9.5%**. All eight disputed primary errors were
    controlled pairs with nonnumeric, check-digit-invalid synthetic “GTINs”
    that the original reviewer had treated as authoritative conflicts. A second
    blinded reviewer independently found identical other product/variant
    evidence; original labels and score remain immutable.
11. **False merge.** Actual pair grouping merged **8/17** adjudicated
    different-product pairs in the primary score; **0/9** in sensitivity.
    These are the same eight disputed GTIN controls. Predicted
    `PROBABLE_SAME_PRODUCT` is not counted as an actual merge.
12. **False split.** **7/71** adjudicated same-product pairs were separated
    in primary; **7/79** in sensitivity. Conservative separation can be
    preferable to an unsupported merge, but it still limits comparison.
13. **Variant accuracy.** **76/101 = 75.2%** primary;
    **84/101 = 83.2%** sensitivity. Different-variant separation was 48/48,
    but some exact/product decisions remained wrong or unsubstantiated.
14. **Conflict detection.** Against independently annotated conflict
    evidence: **86/101 = 85.1%** accuracy, **64/79 = 81.0%** recall in
    primary; **94/101 = 93.1%** accuracy in sensitivity. Both miss 95%.
15. **GTIN.** Validation correctly rejected all **16/16** synthetic
    nonnumeric GTINs in this corpus. Its pair-matching score is **8/8**, but
    those eight are negative cases: **zero independently valid GTINs** are
    represented. Unit tests cover valid checksums/cross-length equivalence;
    the frozen benchmark does not validate live positive GTIN matching.
16. **Brand/model.** Direct field-evidence agreement is **160/177 = 90.4%**
    accuracy (not product-identity accuracy). Explicit sibling codes and scoped
    models are tested, but title resemblance alone must not establish EXACT.
17. **Nike/colorway.** Nine adjudicated Nike-slice cases, **9/9** class
    agreement; no independently labeled same-variant EXACT cases in this slice,
    so exact precision/recall are not scoreable here.
18. **Electronics variants.** **16/16** class agreement in the electronics
    slice; no positive EXACT ground truth there. Storage/model conflicts and
    source extraction have focused tests; these controlled cases do not prove
    real-merchant exact precision.
19. **Beauty/pack.** **8/8** class agreement in the beauty slice; no positive
    EXACT denominator. Numeric pack quantity, size, and volume are explicit
    variant attributes rather than interchangeable product identity.
20. **Automotive.** **8/8** class agreement in the automotive slice after
    canonicalizing OEM part aliases; no positive EXACT denominator and no
    verified fitment inventory, so do not infer compatibility.
21. **Grouping.** Primary product-group agreement **86/101**; sensitivity
    **94/101**. Variant separation **48/48**, same-variant consolidation
    **16/17** primary, offer separation **13/14**. A seller's same price is
    not a shared offer ID.
22. **Cheaper-offer safety.** The frozen evidence has **zero** current,
    same-currency, in-stock, independently comparable offers and produced zero
    `SAME_PRODUCT_CHEAPER` claims. Unsafe-claim rate is **NOT_SCOREABLE**,
    not zero-risk proof. The implementation checks verified identity, variant,
    stock/freshness, and comparable positive prices; the missing positive
    benchmark remains a gap.
23. **Replay comparability.** The 40 cases are byte-frozen at SHA-256
    `4359419400333f3a2831cc30efe65c9be4bea90cf19732b3e4e51dceb6a895f8`.
    Final replay used one V2 discovery call per case and paired both arms on
    the **same 462 candidate occurrences**, with seven ready sources, zero
    provider errors/timeouts, and no partial coverage. Independent rank/arm-blind
    reviewers labeled all 462; a second blind audit reviewed 48 proposed EXACT
    labels and downgraded three. Inventory: **20 found, 20 unknown, zero
    verified none**. Thirteen cases had zero candidates. Unknown inventory
    is excluded from quality denominators. The first diagnostic replay
    (461 candidates, no top-five changes) is archived separately; the
    source-evidence adapter was added before any search labels were viewed.
24. **V2 metrics, final same-run.** Precision@1 **18/20 = 90%**,
    Success@5 **20/20 = 100%**; independent EXACT at rank 1 **6/20**.
    Stable V2's own EXACT assertions were **not captured** in this harness,
    so its assertion-level false-EXACT rate is not measured.
25. **V2 + Identity metrics.** Precision@1 **19/20 = 95%**,
    Success@5 **20/20 = 100%**; independent EXACT at rank 1 **7/20**.
    The layer made **five** query-EXACT assertions, of which **two** were
    unsupported family/category pages: false EXACT **2/5 = 40%**.
26. **Precision@1 delta.** +1/20, from 18 to 19 independently relevant
    rank-1 results. Only cases 24 and 27 changed top candidate; case 24
    improved from an irrelevant to a relevant/exact listing.
27. **Success@5 delta.** 20/20 in both arms among independently found,
    adequately judged inventory; **no observed recall loss**. Do not
    extrapolate this to the 20 unknown-inventory cases.
28. **Supported exact rank 1.** Experimentally asserted and independently
    supported: **2/20** identity-aware; V2 assertion-level baseline is
    **not measured**, not a proven zero. Independently adjudicated exact
    listings at rank 1 (without an assertion) are 6/20 V2 vs 7/20 identity.
    Older Recovery's 2/9 used a different cohort and denominator.
29. **Irrelevance.** Across all adequately judged candidate occurrences,
    **50% in either arm**. Among top-five judged listings, V2 **17/110 =
    15.5%**, identity-aware **16/110 = 14.5%**; for found-inventory cases
    alone, **9/85 = 10.6%** vs **8/85 = 9.4%**. Historical Recovery's 8%
    is context only, not a directly pooled denominator.
30. **Every observed regression.** No independently judged rank-1 or
    top-five relevance regression. The serious assertion-safety failure is
    **two unsupported EXACT assertions in case 1**: Samsung S24 family
    and S24/S24+ category pages were asserted EXACT despite the explicit
    non-product-page firewall. Product ordering changed within top five for
    cases 1, 24, and 27. Distinguish ranking gains from assertion safety.
31. **Latency.** Final shared V2 discovery call per case: median **2,266 ms**,
    p90 **3,360 ms**, max **3,704 ms**; readiness preflight median
    **16,684 ms per source**. Arms share one discovery call; incremental
    identity-ranking latency was **not isolated**, so no latency improvement
    or regression is claimed.
32. **Verification.** Full API tests **109/109** pass; focused experimental
    tests **51/51** passed before scorer additions (subsequent scorer tests
    passed separately); API TypeScript typecheck passed. Corpus fingerprints
    and `git diff --check` were verified. This is not Android or deployment
    evidence.
33. **Identity gate.** **Not reached.** Primary precision 66.7%, false
    EXACT 33.3%, conflict accuracy 85.1%; after the independently justified
    eight-label sensitivity correction, conflict accuracy remains 93.1%,
    real-source EXACT coverage is zero, and cheaper safety is unscoreable.
34. **Search gate.** Relevant rank-1 and independently exact rank-1 improved
    one case without observed Success@5 loss, but **2/5 false query-EXACT
    assertions** and missing incremental latency measurement prevent a pass.
35. **Recommendation.** Do **not advance to production or a new capability
    yet**. Seek approval for a new, separately frozen evaluation covering
    verified positive/conflicting GTINs, real model/variant identifiers,
    current comparable offers, and explicit family-page EXACT vetoes; then
    rerun the independent identity and search gates before considering the
    next Gold Standard capability.

Local and GitHub `main`, production V2/backend, V3, mobile/Expo, providers,
affiliate configuration, and the landing page are untouched by this
experimental branch. No production deployment, OTA, APK/EAS build, billing change, new
provider, or new paid service was made. No merchant/candidate images were sent
to Gemini. Historical Core Recovery outcomes remain research context only:
its 87.5% Precision@1, 15/16 Success@5, 8% irrelevant top five, 2/9 supported
exact rank 1, and 6/15 false EXACT are **not** same-run denominators.