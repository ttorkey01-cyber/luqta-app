# Query-image-only 30-case scoring protocol

Frozen before inspecting the full live run. The case-specific criteria remain
`groundTruth.ts`, and the separately committed visual evidence is `imageReview.ts`.
Do not change either after inspecting results. Use only returned product metadata
and visible query-image evidence; never inspect merchant photos or use filenames
as proof of brand, model, or fitment.

- Mark a case UNSCORABLE if its query image fails independent verification or
  cannot be retrieved safely. Search/model failures are **errors**, not zero
  relevance, and are excluded from ranking denominators (but reported).
- Judge each distinct candidate independently of the arm that returned it.
  `exact` requires affirmative metadata evidence for the frozen exact criteria,
  including model/SKU and automotive fitment when required. `close` is a
  relevant but nonexact result meeting the frozen close criteria without a
  misleading direct-replacement claim. `irrelevant` fails the intended
  product/category or an explicit hard constraint. `uncertain` means the
  available metadata is insufficient to judge; do not upgrade it to exact.
- An explicit price cap requires a known matching-currency price at or below
  the cap. Unknown price, color, condition, location or compatibility never
  satisfies a strict constraint. Never infer missing specification/fitment.
  Explicit query text overrides visual hints.
- For a successful arm/case, top-1 relevance is `exact` or `close` at rank 1;
  top-3/top-5 success means at least one such result in that prefix.
  Exact-product and close-match successes are case-level, across the first
  five results. Report rankings with denominators of **successfully executed
  cases**; report errors, unavailable photos and uncertain results separately.
- Hard-constraint compliance is case-level: every displayed top-five candidate
  must satisfy all applicable hard constraints with affirmative metadata
  evidence. Irrelevant-result rate is the count of `irrelevant` products in
  top five divided by the number of returned top-five products, separately
  noting `uncertain`. A false exact requires an explicit system "exact"
  designation unsupported by evidence; absence of an exact designation is
  not a false exact. Correct no-match means no unverified product was presented
  as a verified match; measure only applicable negative/no-match cases.
- Arabic success means a relevant top-three result satisfying strict Arabic
  query constraints. Automotive safety means no unsupported exact fitment or
  direct replacement is claimed. Failures should be attributed to the earliest
  supported cause from the frozen failure taxonomy, not guessed from absence.
- For each image, score interpretation separately against `imageReview.ts`:
  category, color, genuinely visible brand/model, useful visible attributes,
  hallucinated/unsupported attributes, and failure. A field without
  independently supported visual ground truth is N/A, not incorrect. V3-local
  with candidate-photo loading disabled has no image-interpretation output;
  report that absence explicitly rather than giving it inferred visual credit.
- Observed per-arm latency includes fetching a query image and its V2/Gemini
  interpretation where applicable, but excludes prewarm. Because the arms
  share warmed providers and run sequentially, cached text-only C calls are
  not an independent latency measurement. Publish median/p95 alongside this
  limitation; do not treat cache timing as model speed.
- Gemini improves/worsens a case only when C vs B changes the independently
  adjudicated top-five relevance/constraint outcome; compare C vs V2 too.
  Better interpretation without ranking movement is a separate finding.
  Unsupported model calls, provider errors and unjudged candidates are not
  silently converted to ties.