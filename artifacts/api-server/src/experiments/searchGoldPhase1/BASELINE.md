# Search Gold Phase 1 — expanded V2 baseline

Baseline: `v2.2.0-expanded-baseline-2026-09-30`
Acceptance specification: `experiment/search-blueprint:artifacts/api-server/src/experiments/searchBlueprint/ACCEPTANCE_TESTS.md`
Acceptance specification SHA-256: `eb7e77b43b8e45ff4f2e0f413e55d484fa5aec809442d5e1ef9e7914a4d49399`

## Scope and evidence

The runner calls the existing `SearchOrchestrator.searchWithMetadata` API through an isolated in-memory provider. The `SearchAdapter` accepts the same request and fixture corpus for V2 and Phase 1. Its optional `classifications`, `identityGroups`, and `interactionState` are deliberate: exact/close identity, product grouping, clarification/no-match, conflict, and retrieval-failure checks fail when a response omits those judgments; absence is never silently counted as a pass.

`MANIFEST.json` is the snapshot manifest for all 63 approved blueprint cases. The expanded runner executes 39 `CONTROLLED_FIXTURE` cases spanning exact GTIN/brand-model/SKU/MPN, Arabic and mixed-language intent, soft/strict price, color, size, condition, seller locality, exact/similar identity, no-match, duplicates, offer grouping, provider failure, conflicting evidence, and affiliate-neutral relevance.

Every product, seller, offer, identifier, attribute, price, source, and gold label is synthetic and fixture-only. They are not real listings, measurements, identity evidence, or authorization claims. No real/observed case was available or used. No network calls, feed refresh, production configuration, or production source edits are involved.

## Frozen baseline

Machine-readable request/response snapshots and per-case gold labels are in [`baseline-v2.2-expanded.json`](./baseline-v2.2-expanded.json). This V2 baseline was run and frozen before connecting any Phase 1 adapter.
Frozen JSON SHA-256: `9cb6ad9b4e254131f511d67530e89536247df461daf8419e52300996654b06b7`

| Denominator | Count |
|---|---:|
| Approved blueprint cases | 63 |
| Controlled-fixture executable cases | 39 |
| V2 controlled-fixture PASS | 10 |
| V2 controlled-fixture FAIL | 29 |
| REAL/OBSERVED cases | 0 |
| UNSCORABLE cases | 24 |

PASS/FAIL denominator is the 39 controlled fixture checks only (10/39 PASS, 29/39 FAIL). This is not a production quality metric or a scorecard estimate. `baseline-v2.2-expanded.json` contains each case's response, synthetic gold labels, elapsed harness time, and failure reason. Those per-call timings are not server latency measurements.

Current V2 passes fixture checks **13, 33, 34, 35, 39, 40, 41, 51, 58, and 59**. It fails checks **1–7, 10, 14, 17–23, 36–38, 49, 52–53, 55–57, and 60–63**. Failures include missing exact/close or irrelevant classifications, missing product identity grouping, missing clarification/no-match/conflict/retrieval-failure state, soft-budget interpretation, irrelevant result filtering, absent-color abstention, and size handling. Case 51 passes because the returned stale fixture remains explicitly `out_of_stock`; it is not treated as purchasable.

## Unscorable cases

Cases **8, 9, 11, 12, 15, 16, 24, 25–32, 42–48, 50, and 54** are `UNSCORABLE` (24). Reasons are listed individually in `MANIFEST.json`: licensed image/annotation evidence, authoritative automotive fitment/OEM evidence, contextual reference state, or delivery/total-cost evidence that the existing request/response cannot represent are not fabricated to force a score. All other blueprint cases are controlled fixtures with independent synthetic gold labels, including text-only cases that had previously been left unscored.

## Reproduction

From repository root, freeze the versioned JSON and capture the harness exit status:

```sh
set +e
pnpm --dir artifacts/api-server exec tsx src/experiments/searchGoldPhase1/runner.ts \
  > artifacts/api-server/src/experiments/searchGoldPhase1/baseline-v2.2-expanded.json
rc=$?
printf 'runner_exit=%s\n' "$rc"
```

Expected `runner_exit=1`: the executable assertions intentionally preserve the current V2 failures. The JSON is the frozen pre-Phase-1 result; do not overwrite it while implementing Phase 1. For later comparisons, keep the requests, synthetic corpus, gold labels, and checks unchanged and supply a new `SearchAdapter` implementation to the same cases. Do not report fixture outcomes as real inventory evidence or alter blueprint expectations.