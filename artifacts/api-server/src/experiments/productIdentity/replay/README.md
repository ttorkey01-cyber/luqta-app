# Product identity replay experiment

The byte-frozen `cases.json` corpus is verified against SHA-256
`4359419400333f3a2831cc30efe65c9be4bea90cf19732b3e4e51dceb6a895f8`
before the CLI dynamically imports the production connector index. It then
preflights registered search providers (excluding the mock-local provider),
waiting up to four minutes for existing `ensureSearchIndexReady` or
`refreshIndex` operations where available. Readiness failures/timeouts remain
explicit partial-coverage notes in every case; a cold index is not recorded as
a no-match. The replay is deliberately not part of routine tests and must not
be run until the independent identity benchmark has been judged.

After that prerequisite, run from `artifacts/api-server` with a **new** output
directory (the CLI refuses an existing directory and creates each output file
exclusively):

```sh
pnpm exec tsx src/experiments/productIdentity/replay/cli.ts \
  --live --independent-benchmark-judged \
  --out /path/to/new-replay-output
```

The output contains `observations.json` and a rank/arm-blinded
`blind-packet.json` for independent per-case, per-observation judgments. Both
arms come from one V2 response per case using `{ query, searchMode: "intent" }`.
Only a candidate with explicit, source-backed query identity evidence and
verified hard/variant constraints can be promoted; all other candidates retain
V2 baseline order. No candidate is filtered or deduplicated, and the harness
checks the full observation-ID multiset is preserved. IDs are SHA-256-derived
from provider plus canonical product ID, never rank.

The independent EXACT assertion requires matching explicit query brand+model,
a scoped source model/MPN/OEM or title model pattern matched to an explicit
model constraint, a scoped style code matched to the query, or a valid GTIN,
plus verified explicit constraints/variants and no family/editorial/comparison/
collection indicators. The replay-only source adapter
may extract only explicitly labeled, check-digit-valid GTIN/EAN/UPC identifiers,
scoped MPN/OEM/style/SKU labels, named brand-specific model-number patterns, and
explicit title/description variant tokens. It uses no generic title similarity;
seller SKUs stay provider-scoped and never establish global identity. Missing or
ambiguous source evidence remains unknown/`NO_EXACT`. Pairwise candidate grouping
uses only this validated, scoped source identity evidence (excluding seller SKUs
and editorial/family pages) and records per-pair source proof; it does not
establish query identity. The blind packet contains rank-free candidate text,
variant/availability and source metadata, but excludes URLs and images.

Fixture-only dry runs can call `runReplay(cases, { search: fixture })`; this
does not import or call live providers. Evaluations remain separate by arm;
historical metrics are context only and are never pooled.

Independent `CaseJudgment` records include
`inventoryAvailabilityAssessment: "found" | "none" | "unknown"`. Missing values
from legacy fixtures are treated as `unknown`; an empty replay result never
establishes that inventory was `none`. Precision@1, Success@5, and supported
EXACT rank-1 use only independently found inventory and adequately judged
candidate windows, with denominators reported. `falseExactRate` is computed only
over adjudicated candidates the arm actually asserted as EXACT. Current-source
inventory assessments describe the replay capture and can drift from historical
evidence; prior metrics are not evidence that a source was available or complete
for this run. Blind packet candidates are deterministically shuffled by
case/candidate ID so packet array order does not reveal baseline rank.

After independent review, score an existing replay directory without any
provider calls:

```sh
pnpm exec tsx src/experiments/productIdentity/replay/score-cli.ts \
  --dir /path/to/existing-replay-output
```

The scorer reads `observations.json`, the `{ judgments: [...] }` wrapper in
`judgments.json`, and the local frozen corpus to validate the exact 40-case/
462-candidate cohort and case-local label coverage; it makes no provider calls
and writes `metrics.json` exclusively. It reports
independent labeled EXACT@1 separately from supported EXACT@1; baseline asserted
EXACT false-positive rate is explicitly not measured. Unknown inventory remains
unknown and never counts as `none`; only independently found inventory enters
ranking denominators. Paired top-1/top-5 changes and regressions and current
source availability/latency distributions are included. Historical Recovery
rates remain context only and are not pooled. The all-candidate `irrelevantRate`
is retained and labeled separately from top-five irrelevant rates, which exclude
ABSTAIN/UNVERIFIABLE labels and report both all-judged and found-inventory
denominators.