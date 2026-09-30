# Search Gold Phase 1 benchmark report

**Run:** `phase1-controlled-fixture-2026-09-30`
**Classification:** CONTROLLED FIXTURE only; REAL/OBSERVED = 0.
**Frozen baseline:** `baseline-v2.2-expanded.json`
**Baseline JSON SHA-256:** `9cb6ad9b4e254131f511d67530e89536247df461daf8419e52300996654b06b7`

## Scope and baseline caveat

The baseline hash attests the frozen V2 **output JSON bytes only**. That file did not store the complete fixture corpus or a corpus hash, so the hash does **not** establish byte-identical fixture-corpus contents. Phase 1 was run with the same current 39-case acceptance suite, requests, fixture inputs, and independently authored gold/expected labels. Twenty-four of the 63 approved blueprint cases are unscorable in this controlled suite; their IDs are included in `scorecard.json`.

All product and offer details are synthetic. These controlled-fixture signals are not actual inventory, production quality, or production threshold claims. No real observations were made. The V2 baseline response schema also lacks per-product identity classifications and interaction states; metrics needing those fields are explicitly marked not scoreable for V2 rather than inferred.

## Overall result and case transitions

| Controlled-fixture acceptance checks | Frozen V2 | Phase 1 |
|---|---:|---:|
| PASS | 10/39 | **18/39** |
| FAIL | 29/39 | **21/39** |
| Improved vs V2 | — | **9** |
| Regressed vs V2 | — | **1** |
| Unchanged pass / unchanged fail | — | **9 / 20** |

**Improvements:** cases 1, 4, 7, 18, 22, 36, 55, 56, 63.
**Regression:** case 51.
**Unchanged passes:** 13, 33, 34, 35, 39, 40, 41, 58, 59.
**Unchanged failures:** 2, 3, 5, 6, 10, 14, 17, 19, 20, 21, 23, 37, 38, 49, 52, 53, 57, 60, 61, 62.

The improvements include exact GTIN/MPN fixture outcomes (1, 4), Arabic/product-category cases (7, 18), safer handling of an unsupported typo (22), explicit no-match for missing requested color and negative queries (36, 55, 56), and distinguishing the controlled retrieval-failure sentinel (63). The sole regression is stale/out-of-stock offer handling (51). Overall acceptance count improves by 8 checks, but this does not mean all ranking metrics improved: see the side-by-side results below.

## Metrics: Phase 1 vs frozen V2

The baseline values below were recomputed from frozen V2 case responses using the same current gold labels. A metric is compared only when the stored baseline contains the required information. Denominators can differ where V2 lacks explicit state or where metrics count displayed results.

| Metric | Phase 1 | Frozen V2 | Comparison / fixture target signal |
|---|---:|---:|---|
| Precision@1 | 13/28 = **0.464** | 28/28 = **1.000** | Phase 1 materially lower; target ≥0.70 not reached (V2 reached). |
| Precision@3 | 13/84 = **0.155** | 33/84 = **0.393** | Phase 1 lower; neither reaches ≥0.60. |
| Success@5 | 13/28 = **0.464** | 28/28 = **1.000** | Phase 1 materially lower; target ≥0.75 not reached (V2 reached). |
| Exact-product identification at rank 1 | 2/12 = **0.167** | **Not scoreable** | V2 output lacks per-product `exact` classifications; Phase 1 target ≥0.80 not reached. |
| Hard-constraint compliance, displayed-result safety | 7/7 = **1.000** | 8/10 = **0.800** | Phase 1 has fewer displayed offers; numerator only counts gold-compliant displayed products. No separate result-level target. |
| Hard-constraint compliance, query fulfillment | 9/10 = **0.900** | 7/9 = **0.778** | V2 case 58 is unscorable because its empty results have no stored interaction state; Phase 1 target ≥0.97 not reached. |
| Irrelevant-result rate (answerable top-five outputs) | 0/13 = **0.000** | 13/46 = **0.283** | Lower for Phase 1, but it returns fewer results; target ≤0.20 reached by Phase 1, not V2. Read with Success@5. |
| False-exact-match rate | 0/2 = **0.000** | **Not scoreable** | Phase 1 target ≤0.005 signal reached, but only **two** explicit exact assertions: this tiny fixture denominator is not evidence of production false-exact risk. V2 has no per-product exact classifications. |
| Correct no-match | 5/5 = **1.000** | **Not scoreable** | Phase 1 target ≥0.90 reached. V2 has no explicit interaction states. |
| Arabic intent accuracy | 12/20 = **0.600** | **Not scoreable** | Phase 1 target ≥0.82 not reached. V2 does not retain the Phase 1 intent evidence needed for this check. |
| Identifier accuracy | 2/8 = **0.250** | **Not scoreable** | Diagnostic only; no separate target. V2 lacks explicit identity classifications. |
| Provider-error / no-match distinction | 6/6 = **1.000** | **Not scoreable** | Phase 1 required signal reached. V2 response records do not contain interaction states for finite-snapshot no-match cases. |
| Fixture harness elapsed time, median / p95 | 8.84 / 516.88 ms | 5.61 / 399.59 ms | Descriptive only: V2 and Phase 1 measure different wrapper work; not production/server latency or an apples-to-apples performance claim. |

All Phase 1 numerators, denominators, target statuses, per-case ranking details, and the V2 metric calculations/caveats are machine-readable in `scorecard.json`. `phase1-results.json` contains the complete Phase 1 responses, diagnostics, and 39-case V2 status comparison. All target statuses are controlled-fixture signals, never production claims.

## Remaining failures, grouped by behavior

There are **21 failing Phase 1 checks**:

1. **Identity and product/offer retrieval (2, 3, 5, 6, 14, 19, 20, 57, 60, 62):** exact brand/model, seller-scoped SKU, one-character model distinction, Arabic brand/model or numerals, supported typo correction, affiliate-neutral relevance, and multi-merchant offer cases still miss expected results. Cases 5 and 60 specifically fail to preserve expected offers across merchants.
2. **Classification and alternatives (17, 52, 53):** the USB-C fixture is returned but not classified `exact`; the camera similar-alternative and close-only model checks still do not return the expected explicitly classified alternatives. No `PROBABLE_EXACT` was upgraded to `exact`.
3. **Budget and hard constraints (10, 37):** case 10 recognizes the approximate budget but fails to retain the over-budget alternative expected by the check. Case 37 misses the explicitly sized EU 38 shoe.
4. **Clarification and uncertainty states (21, 23, 38, 61):** ambiguous Jaguar, generic charger, missing size-system, and conflicting-evidence requests do not produce the required clarification/uncertainty state. Case 23 returns generic charger alternatives instead of asking for clarification.
5. **Safe but incomplete cheaper-offer handling (49):** Phase 1 abstains rather than asserting same identity and savings without adequate comparable reference evidence. This is a safe refusal but remains an acceptance failure.
6. **Stale offer regression (51):** this previously passing V2 check now fails; the wrapper returns no product rather than satisfying the fixture’s currently-purchasable-offer expectation.

**Materiality vs V2:** the major negative difference is answer coverage/ranking: Precision@1 falls from 1.000 to 0.464 and Success@5 from 1.000 to 0.464 on the controlled answerable cases. Phase 1 improves displayed-result relevance and explicit state handling, but has fewer returned results; the perfect displayed hard-constraint safety denominator is only seven products. The no-match, false-exact, and provider-state target signals are fixture-level results only and do not offset the lower retrieval coverage or the tiny false-exact denominator.

## Run command and integrity

From the repository root:

```sh
pnpm --dir artifacts/api-server exec tsx src/experiments/searchGoldPhase1/phase1Benchmark.ts
```

The benchmark verified the frozen baseline JSON SHA-256 above before executing all 39 cases. This final refresh changed only the generated benchmark outputs/report; no benchmark code, production code, fixtures, expected checks, manifest, or baseline was edited. No commit or push was made.