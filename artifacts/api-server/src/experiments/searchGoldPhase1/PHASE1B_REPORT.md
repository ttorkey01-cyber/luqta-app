# Search Gold Standard — Phase 1B controlled-fixture report

Branch: `experiment/search-gold-phase1`. This is an experimental wrapper, not a replacement for the production V2 route. The remote experiment commit SHA is reported with the handoff; this report is part of that commit.

## Scope and provenance

The **same 39 executable cases out of 63 approved blueprint cases** were run against the frozen V2 output, frozen Phase 1 output and Phase 1B. The other 24 are not executable controlled fixtures. No expected result, fixture, frozen baseline or frozen Phase 1 result was modified. The V2 output SHA-256 is `9cb6ad9b4e254131f511d67530e89536247df461daf8419e52300996654b06b7`; this certifies the recorded output bytes, **not** the historical fixture corpus. Phase 1 output and scorecard hashes are verified by `phase1bBenchmark.ts` before running. All inventory, prices and latencies below are synthetic fixtures; **zero cases are real/observed**.

The pre-change, 21-case lost-result matrix is in `PHASE1B_LOSS_MATRIX.md`. Case 51 was the only formal V2 PASS → Phase 1 FAIL; the other matrix rows represent useful V2 candidates or Phase 1 checks that failed, not additional formal V2 passes.

## What changed

- Saudi dialect, mixed-script and bounded brand/model parsing preserve explicit identifiers and clarify unresolved product/fitment/size ambiguity instead of inventing attributes.
- At most four staged V2 requests use exact-ID, contextual lexical and bounded fallback queries. The experimental wrapper retains existing provider/network behavior and source links, evaluates accumulated evidence, and can display labeled close/similar results without calling them exact. V2 can itself expand a query; outer-stage attribution is not subquery provenance.
- Explicit hard requirements remain enforced; soft budgets and preferred colors are not hard caps. Product/variant grouping is descriptive, with merchant offers kept separate. A lower-price claim now requires a valid matching GTIN-14 on both offers, matching variant-group details, explicit current stock, valid same-currency prices, agreeing condition/color and recent timestamps. Same-title/model-only offers do not establish a saving or get promoted to EXACT.
- Stale out-of-stock offers are excluded; source condition conflicts become a distinct uncertain state. Provider unavailability is distinguished from an actual empty result.
- The new benchmark writes `phase1b-results.json` and `phase1b-scorecard.json` only. The scorecard distinguishes independently adjudicated exact matches from exact assertions on cases with no exact-identity gold label.

## Side-by-side scorecard

| Controlled-fixture measure | Frozen V2 | Frozen Phase 1 | Phase 1B |
|---|---:|---:|---:|
| Acceptance PASS / 39 | 10 | 18 | **31** |
| Precision@1 | 28/28 (100%) | 13/28 (46.4%) | **25/28 (89.3%)** |
| Success@5 | 28/28 (100%) | 13/28 (46.4%) | **25/28 (89.3%)** |
| Exact identity at rank 1 | Not scoreable | 2/12 (16.7%) | **9/12 (75%)** |
| Identifier accuracy | Not scoreable | 2/8 (25%) | **6/8 (75%)** |
| Arabic intent | Not scoreable | 12/20 (60%) | **16/20 (80%)** |
| Hard constraints, query-level | 7/9 (77.8%); one V2 case unscorable | 9/10 (90%) | **10/10 (100%)** |
| Hard constraints, displayed results only | 8/10 (80%) | 7/7 (100%) | **10/10 (100%)** |
| Irrelevant displayed results | 13/46 (28.3%) | 0/13 | **0/28** |
| Correct no-match | Not scoreable | 5/5 | **5/5** |
| False exact, independent exact gold | Not scoreable | 0/2 | **0/11**, plus **one unadjudicated EXACT assertion** |
| Provider error versus no-match | Not scoreable | 6/6 | **6/6** |
| Fixture harness latency, median / p95 | 5.61 / 399.59 ms | 8.84 / 516.88 ms | **11.58 / 454.08 ms** |

The Phase 1B false-exact target is **NOT ESTABLISHED**: case 57's matching listing is labeled for *relevance/ranking*, not independently for exact identity. Its EXACT assertion is neither proven correct nor proven false by that gold label. Do not turn 0/11 into a production false-exact claim. The 75% exact rank-1 and 80% Arabic-intent values still miss their controlled-fixture targets (80% and 82% respectively). These latency figures cover the local wrapper plus in-memory fixture adapter, not server/network p95.

## Case transitions and remaining losses

Phase 1 FAIL → Phase 1B PASS: **2, 14, 20, 21, 23, 37, 38, 51, 52, 53, 57, 61, 62** (13). PASS → FAIL: **none**. Phase 1 `no_match` → displayed useful result: **2, 5, 6, 14, 20, 37, 51, 52, 53, 57, 60, 61, 62** (13; cases 5, 6 and 60 still fail other checks). The previously displayed ambiguous generic charger offers in case 23 are withheld pending clarification; no previously displayed EXACT offer was downgraded. Cases 2, 14 and 20 go from a previously reported SIMILAR diagnostic to EXACT after source-backed brand/model evidence; inspect the independent exact gold labels, not that prior diagnostic, when judging promotion.

Eight controlled checks remain FAIL:

| Case | Residual issue / decision |
|---|---|
| 3 | “Fixture Seller” does not identify which of two merchants owns the SKU; do not guess seller A. |
| 5, 60 | Both merchants' distinct offers are displayed/grouped, but the synthetic gold requires an opaque product-group key not present in source metadata; do not inject that key from gold. |
| 6 | The exact candidate is recovered; the V2 retrieval does not return the close alternative needed for its additional classification check. |
| 10 | Approximate budget remains soft in Phase 1B; V2's retrieved snapshot still lacks the over-budget offer required by the fixture. |
| 17 | USB-C charger is returned as a labeled alternative; connector/category alone cannot prove a generic charger is an EXACT product. Micro-USB is not asserted compatible. |
| 19 | Arabic iPhone numerals are preserved, but the fixture's structured candidate brand conflicts with the requested Apple brand; do not call it exact. |
| 49 | Two same-title Z-4 offers lack global variant identity and fresh timestamps; **no current-price saving or exact identity is asserted**. This is a deliberate safety abstention, not a successful same-product-cheaper fixture. A separate focused test covers fresh matching GTIN-14 offers with verified comparability. |

Stale/current offer regression: **case 51 PASS**, current offer displayed, stale out-of-stock offer excluded; the formal V2 → Phase 1 loss is recovered. Conflicting condition evidence is surfaced in case 61 rather than called exact.

## Verification and release boundary

Focused Phase 1 tests, the full API test suite and TypeScript typecheck are run before handoff; see the handoff for final counts. No live endpoint, production V2 route, mobile OTA, EAS/APK build, deployment, billing setting, GitHub main or Phase 2 was changed. Phase 1B has **materially better useful recall with controlled-fixture no-match and hard-constraint safety preserved**, but **does not yet establish both useful recall and full safety/readiness**: exact/Arabic targets and eight fixture checks remain unmet, one exact assertion lacks independent gold adjudication, and there are zero observed cases. Stop for approval before any real/observed evaluation.