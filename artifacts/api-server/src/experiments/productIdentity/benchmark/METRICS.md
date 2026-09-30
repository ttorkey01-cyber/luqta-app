# Independent product-identity benchmark scoring

`evaluate.ts` scores the independently adjudicated blind corpus. It does not
change labels, call a live provider, tune the identity engine, or modify replay.
Run this primary benchmark and preserve its `scorecard.json` **before running
live replay**. Final primary scorecard generation must wait for the
identity-core-engine follow-up to finish.

The scorer verifies the complete UTF-8 `pairs.json` byte stream against the
SHA-256 fingerprint in `PREPARATION.md` before loading the corpus or scoring.
Any change to that file fails closed. Blind cases are joined as
`blind-map.blindId -> blind-map.originalId -> pairs.id`; the independent label
and blind pair are looked up using `blindId`. Array position/order is never a
join key. The source corpus supplies only original case metadata (category and
source class); decisions are made from the blind pair records.

From `artifacts/api-server`, generate the result with:

```sh
pnpm exec tsx src/experiments/productIdentity/benchmark/evaluate.ts
```

This writes `benchmark/scorecard.json`, including all 136 case decisions,
mismatches, engine evidence reasons, independent evidence, grouping results,
and cheaper-claim evidence. Do not edit or overwrite the independently-authored
`blind-labels.json`.

## GTIN reassessment sensitivity

`gtin-sensitivity.ts` creates a separate sensitivity scorecard using
`gtin-reassessment.json`; it never changes `blind-labels.json` or overwrites
the primary `scorecard.json`. Run it only after the primary scorecard exists:

```sh
pnpm exec tsx src/experiments/productIdentity/benchmark/gtin-sensitivity.ts
```

The sensitivity script accepts exactly the eight approved blind IDs
`PI-075`, `PI-086`, `PI-091`, `PI-103`, `PI-109`, `PI-114`, `PI-119`, and
`PI-123`. It refuses missing, duplicate, or outside-allowlist IDs; requires each
original case to be an adequately adjudicated `DIFFERENT_PRODUCT`; checks that
the reassessment maps to the corpus's exact nonnumeric, invalid GTIN strings;
and only then substitutes the independent `match` classification and its
evidence in a separate in-memory label view. All other labels remain byte-for-
byte unchanged in the scorer input. All benchmark metrics are recomputed into
`gtin-sensitivity-scorecard.json`. That file records SHA-256 fingerprints of
the original primary scorecard, original labels, and reassessment as
provenance. The script checks the primary scorecard and labels remain
unchanged during generation.

The sensitivity result is an alternate adjudication scenario, not a correction
to the immutable primary benchmark. Do not replace or combine its metrics with
the primary result without clearly identifying the scenario.

**Interpretation warning:** all eight reassessed GTINs are synthetic,
nonnumeric, and invalid. Across the corpus there are zero check-digit-valid
GTIN examples, so GTIN validation/matching performance cannot establish
behavior on real valid GTINs. The primary scorecard has low observed exact
prediction coverage: 0 of 24 `REAL_OBSERVED` cases were predicted
`SAME_PRODUCT_SAME_VARIANT` (and just one adequately adjudicated observed
same-variant label exists). Treat controlled-case findings as synthetic
evidence and do not infer production or real-GTIN performance from them.

## Metric definitions and denominators

Every numeric metric is stored as `{ numerator, denominator, value }`, where
`value` is a fraction from zero to one. An empty denominator is reported as
`NOT_SCOREABLE` with a reason; it is not converted into zero.

- **Exact identity:** `SAME_PRODUCT_SAME_VARIANT` is the only EXACT prediction.
  Precision and recall include adequately adjudicated cases only. False EXACT
  assertion rate (primary `falseExactRate`) is false EXACT predictions divided
  by all adequately adjudicated EXACT predictions. The distinct
  `nonmatchFalsePositiveRate` is false EXACT predictions divided by adequately
  adjudicated non-EXACT labels. Predictions on the 35 unadjudicated cases are
  reported separately as unsafe EXACT and non-UNKNOWN prediction rates, each
  divided by the unadjudicated count.
- **Variant classification accuracy:** exact predicted-class agreement divided
  by adequately adjudicated cases. Unadjudicated `UNKNOWN` cases are excluded.
- **False merge/split:** measured from actual pairwise `groupCandidates`
  results, not a proxy based on classifications. A false merge is one
  `DIFFERENT_PRODUCT`-labeled pair placed in one product group, divided by all
  adequately adjudicated `DIFFERENT_PRODUCT` pairs. A false split is one
  same-product-labeled pair placed in multiple product groups, divided by all
  adequately adjudicated same-product pairs (same variant, different variant,
  or probable). `PROBABLE_SAME_PRODUCT` is not itself a merge: this engine's
  grouping leaves unresolved probable records separate. Probable prediction
  errors are reported separately as a false-prediction rate among probable
  predictions and recall among probable labels.
- **Conflict detection:** classification of whether independently supplied
  `conflictingEvidence` is nonempty is reported as a confusion matrix and
  accuracy/precision/recall. A second confusion matrix measures detection of
  the independently labeled `DIFFERENT_PRODUCT` class. Both use adequately
  adjudicated cases only.
- **GTIN matching:** limited to adequately adjudicated pairs with GTIN
  identifiers and explicit independent label evidence that GTINs match or
  conflict. A match requires both check-digit-valid GTINs and equal normalized
  values. GTIN validation compares `normalizeIdentifier` status against an
  independently implemented length/check-digit verifier across every corpus
  GTIN, including deliberately synthetic invalid values. No GTIN is repaired
  or fabricated.
- **Brand/model evidence accuracy:** compares the engine's matching/conflicting
  brand/model evidence with normalized field agreement on adequately
  adjudicated cases where those fields are present. This measures evidence
  detection, not pair-level identity truth.
- **Grouping:** product-group agreement tests whether the two labeled records
  should be in one product group. Variant separation checks whether labeled
  different variants form more than one variant group; same-variant
  consolidation checks the converse. Offer separation is scored only for
  cases carrying offers, against distinct provider-scoped offer IDs. Missing
  offer keys are treated as separate offers. These grouping scores evaluate
  `groupCandidates` on the pair, not a corpus-wide transitive clustering.
- **Same-product-cheaper safety:** uses a deterministic assessment clock of
  `2026-09-30T23:59:59.999Z`; the engine's normal seven-day freshness, price,
  stock, currency, and identity safeguards remain active. A true comparable
  offer is one whose assessment evidence confirms same-product/variant and
  fresh, in-stock, same-currency offers. `trueComparableOfferCoverage` reports
  this count over adequately adjudicated same-product/same-variant pairs (the
  explicit comparable-offer denominator). The unsafe claim rate is
  `SAME_PRODUCT_CHEAPER` claims lacking an adequately adjudicated
  same-product/same-variant label divided by all such claims. The scorecard
  also reports unsafe claims over the actual true-comparable-offer denominator.
  It separately lists UNKNOWN assessments as not scoreable, including their
  evidence reasons. If no claims or no true-comparable offers exist, the
  corresponding rate is `NOT_SCOREABLE`, not zero.
- **Coverage/abstention:** classified means any prediction other than
  `UNKNOWN`; abstention is `UNKNOWN`. Counts and rates are reported overall
  and separately for `REAL_OBSERVED`, `CONTROLLED`, and `UNVERIFIABLE`.
- **Category slices:** Nike, electronics, beauty, and automotive report pair
  counts, adequately adjudicated counts, classification coverage, exact
  precision/recall, and variant-classification accuracy. Empty slices are
  `NOT_SCOREABLE`.

The scorecard records a `mismatch` only for adjudicated cases; any non-UNKNOWN
prediction on an unadjudicated case is instead called out as an unadjudicated
evidence warning, not treated as a known false label. Evidence reasons remain
available per case regardless of whether the prediction matched the label.