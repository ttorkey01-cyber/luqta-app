# LUQTA Saudi Shopping Search — Proposed Architecture

**Status:** Design proposal for the local `experiment/search-blueprint` branch only. This is a docs-only artifact; it authorizes no production change, provider activation, spend, or deployment. Existing production behavior is described only where a path below has been checked. The design is an independent proposal informed by common, publicly described shopping-search patterns—not a claim about any competitor's private systems or algorithms. Research citations may be added separately.

## Scope and principles

Design one shopping discovery pipeline for text, image, and combined text+image requests, initially using existing LUQTA search components where they fit. Treat search as retrieval of evidence-backed products and offers, not as an answer generator. Preserve provenance and uncertainty end to end.

1. **User relevance before monetization.** Affiliate status, commission, and provider priority must not improve relevance rank. Commercial routing happens only after relevance ordering or in an explicitly user-visible, separate offer choice.
2. **Explicit requirements stay explicit.** Never silently relax a user's hard constraint, invent missing facts, or claim an unknown item satisfies a constraint.
3. **Identity claims require evidence.** Distinguish exact identity from close alternative and unknown; visual resemblance or a model's confidence alone is not exact-product evidence.
4. **Fail open only in a truthful way.** Partial, stale, or alternate-source results can be useful when clearly labeled. A service failure is not proof of no inventory.
5. **Minimize dependencies and data sharing.** Reuse existing infrastructure. No new paid service is enabled or presumed by this proposal.
6. **No production modification.** All stages below are gated design work; implementation requires separate authorization and review.

## Existing project anchors (verified paths)

These paths document reusable components, not approval to change them:

- `artifacts/api-server/src/connectors/searchOrchestrator.ts` — current orchestration, provider timeouts, cache key, parallel provider stage, and Brave fallback are present.
- `artifacts/api-server/src/connectors/providerRegistry.ts` and `artifacts/api-server/src/connectors/types.ts` — provider registry and shared provider/product/intent records are present.
- `artifacts/api-server/src/connectors/intentParser.ts` and `artifacts/api-server/src/connectors/queryExpansion.ts` — deterministic intent parsing and Arabic/query expansion are present.
- `artifacts/api-server/src/connectors/resultNormalizer.ts`, `deduplicationService.ts`, `rankingService.ts`, and `cacheService.ts` — normalization, deduplication, ranking, and caching components are present.
- `artifacts/api-server/src/connectors/braveWebSearchProvider.ts` — Brave web-search provider is present.
- `artifacts/api-server/src/routes/vision.ts` and `visionHelpers.ts` — a bounded image interpretation route exists; its documented configured AI integration is not a candidate-image comparison service.
- `artifacts/api-server/src/connectors/huntService.ts`, `huntMonitoring.ts`, and `huntMonitorRunner.ts` — hunt and monitoring components exist.
- `artifacts/api-server/src/experiments/searchBlueprint/SEARCH_SCORECARD.md` and `ACCEPTANCE_TESTS.md` — proposed evaluation contract and case definitions exist in this experiment directory; scorecard thresholds are proposed gates, not measured current performance.

**Source status convention below:** “Documented” means directly visible in these checked project files. “Proposed / inferred” is a design recommendation, not a claim of current implementation or measured capability.

## Request interpretation: text, image, or both

### Text only

Use deterministic normalization and intent parsing first: normalize Arabic orthographic variants and digits, preserve the original query, detect recognized product/category/brand/attribute/price/condition/automotive terms, and expand only bounded, curated synonyms/transliterations. Preserve the literal query and exact identifiers (SKU, part number, OEM number) as lexical evidence. Do not let broad synonym expansion erase an exact identifier.

Saudi dialect, code switching, spelling variation, and short queries are inherently ambiguous. Treat parser output as evidence with confidence and provenance, not ground truth. Keep raw text available for retrieval. For ambiguous price language, units, brand transliteration, or product terms, prefer a clarification or broader non-claiming retrieval over silently committing to a risky interpretation.

### Image only

Use the existing vision route only as an optional query-image interpretation path. The image supplied by the user is query evidence, subject to validation, authorization, size limits, and the route's availability. Return generic product-type/color/attribute candidates and uncertainty; do not claim a brand/model unless supported clearly. Low-confidence or ambiguous recognition should yield alternatives or a request for clarification, not a confident identity.

OCR is especially uncertain: blur, glare, low resolution, stylized marks, Arabic/Latin mixtures, and partial labels can corrupt a product name or identifier. OCR text is a candidate clue, never an authoritative SKU/OEM/brand without corroboration. Preserve the distinction between visibly read text and model inference.

### Image plus text

Parse the user's explicit text independently and give it precedence over conflicting image-derived suggestions. A stated brand, model, size, budget, condition, location, or “not this feature” must not be overridden by an image guess. Use the image to fill only missing, non-conflicting clues; mark the source for every value. If the image and text conflict in a way that changes identity or safety, ask which to prioritize instead of silently choosing.

### Image-data boundary (mandatory)

**Candidate merchant, affiliate-feed, or provider images must NEVER be sent to Gemini**, consistent with the project instruction. Do not upload, proxy, embed, or include these candidate images in a Gemini prompt, including for reranking, captioning, embeddings, or visual verification. The same prohibition applies to any unapproved external image model/service. User-uploaded query images and catalog candidate images are distinct data classes; permission to analyze a user's query photo does not authorize sending catalog imagery elsewhere.

Any future candidate-image visual comparison must be a separately authorized design using rights-cleared images and methods operating locally (for example, an approved on-device or server-local feature comparison); require documented image rights, data retention/access controls, evaluation, and explicit product/privacy/security authorization first. It is not enabled or assumed here. Until then, image search uses query-image interpretation to form text queries against catalog metadata, not candidate-image comparison.

## Intent representation and uncertainty

The proposed structured intent is richer than a flat set of parsed fields. Each field carries its value, requirement strength, confidence, provenance, and ambiguity. The request also preserves raw text and a reference to the authorized query image (not a copy passed through candidate retrieval).

**Proposed conceptual record (not implementation code):**

| Record | Minimal conceptual fields |
|---|---|
| `SearchRequest` | request ID; input mode (`text`, `image`, `text_image`); raw text; authorized query-image reference or none; locale/country; user-selected filters; request timestamp |
| `IntentField<T>` | value or null; strength (`hard`, `soft`, `context`); confidence or `unknown`; provenance (`user_text`, `user_image`, `deterministic_parser`, `ocr`, `optional_model`, `user_filter`); evidence span/reference; ambiguity flag |
| `StructuredIntent` | product/category, brand/model, identifiers, attributes, audience, price range/currency, condition, location, vehicle/part fitment, excluded terms; list of field records; clarification-needed reasons |
| `QueryPlan` | bounded lexical query variants; identifier lookups; category scope; optional semantic branch and justification; selected provider IDs; deadlines and result caps |
| `OfferEvidence` | source/provider and source record IDs; observed value and currency; source URL; source timestamp/freshness; availability/condition/location values; evidence level; rights/permission metadata for images |
| `SearchOutcome` | ordered product/offer groups; exactness label; hard-constraint assessments; explanation evidence; provider statuses; outcome state (`results`, `verified_no_match`, `partial`, `unavailable`, `clarification`) |

“Hard” is reserved for an explicit request or user-selected filter that must be honored; “soft” expresses a preference that can inform ordering; “context” may guide recall but cannot be presented as a requirement. Do not promote model-inferred or OCR-inferred fields to hard constraints. Make price currency explicit (or unknown); do not compare unlike currencies as if equal. A soft approximate budget may affect ordering but is not a strict exclusion.

Confidence is field-specific, calibrated against evaluation data where available, and may be unknown. Do not invent a universal numeric threshold. Provenance records the originating evidence, not just the component that copied it. For conflicting sources, keep both evidence records and represent the field as conflicting/unknown until a safe resolution is possible.

## Proposed retrieval and ranking pipeline

1. **Validate and admit.** Validate text/image payload, permissions, input sizes, locale and request limits. Reject invalid input explicitly. A missing image capability must not prevent a text-only fallback when text exists.
2. **Resolve request intent.** Run the deterministic parser and curated normalization first. Use bounded optional model-based *text understanding* only when deterministic parsing flags a genuine ambiguity or language gap, the feature is explicitly authorized/configured, and budget/admission policy allows it. Model output is advisory, schema-validated, provenance-tagged, time-bounded, and cannot override literal user constraints or authorize new providers. If unavailable, retain deterministic interpretation. No new paid service is enabled by this design.
3. **Construct a budgeted plan.** Prefer, in order: exact lexical lookup for SKU/part/OEM identifiers; exact product/brand/model phrases; category and typed attribute terms; bounded Arabic/English dialect, spelling, transliteration, and curated synonym variants. Keep exact and expanded branches distinguishable. Invoke optional semantic retrieval only where lexical recall is plausibly insufficient (for example, a broad natural-language description), only if an authorized existing/local capability exists and its value is justified. Semantic similarity must never bypass hard constraints or prove exact identity.
4. **Retrieve in parallel.** Fan out eligible queries to ready, enabled providers in the existing registry; retain feed/catalog retrieval and Brave fallback where policy and current semantics permit. Use per-provider deadlines, result caps, and a global request budget. Later, legal used/local marketplaces may be added only after source authorization, coverage/freshness expectations, privacy review, and provider-specific configuration. They are not enabled now.
5. **Normalize with provenance.** Convert provider records into common product and offer evidence while retaining provider/source IDs, URL, source timestamp, original currency, normalized fields, and missing/unknown values. Reject malformed records, never synthesize price/availability/location, and preserve source errors separately from empty results.
6. **Build product/offer graph.** Group records that credibly describe the same underlying product, while keeping distinct seller offers, variants, conditions, package sizes, and vehicle fitments separate when evidence does not establish equivalence. Link product identity ↔ variant ↔ merchant offer ↔ source evidence. Use stable provider IDs/GTIN/MPN/SKU where verified; title/image similarity alone is not sufficient to merge. Keep canonical identity confidence and merge provenance auditable.
7. **Apply hard-constraint safety gate.** Evaluate every explicit hard constraint using evidence states `satisfied`, `violated`, or `unknown`. Unknown is not satisfied. Exclude violated results from qualifying results; do not present unknown as compliant. If evidence cannot establish a required filter, state that limitation and ask to relax/change the request rather than silently widening it. Any user-approved relaxation must be explicit, logged as a new preference/constraint state, and shown in the UI.
8. **Deduplicate and rank.** Deduplicate repeated copies of an offer; group verified same-product offers without collapsing materially different offers. First enforce hard constraints, then order by user relevance: exact identity/identifier and category fit, requested attribute fit, evidence quality/freshness, availability, and user preferences. Keep price sorting as an explicit user choice or a relevant tie-breaker. **Affiliate/commission status, affiliate URL presence, provider priority, and commercial value must not be relevance features.** Do not demote a more relevant non-affiliate result.
9. **Label exactness and decide outcome.** Return each candidate as `exact`, `close_alternative`, or `unknown`, with the evidence basis. Never label “exact” solely from visual similarity, a model score, or title overlap. There is **no confident-match gate** that suppresses all results just because confidence is below a threshold: show useful close/unknown results with honest labels, or ask a clarifying question. Separately abstain from an exact-match claim when evidence is insufficient. Distinguish verified no-match (sufficient relevant sources completed and no qualifying item) from partial coverage and provider failure.
10. **Explain with evidence.** Give concise, user-facing reasons such as “title lists 256 GB,” “price shown as SAR 250,” “seller page lists used condition,” or “fitment not verified.” Every statement links to a source field/offer and observation time. Do not explain inferred facts as verified facts. Explain why an explicit constraint could not be confirmed.
11. **Cache safely.** Cache normalized query plans/results with locale, filters, input mode, provider set, and intent version represented in the key. Image-derived results should be keyed only by a privacy-safe query-image digest/reference and appropriate TTL; avoid retaining raw photos or sensitive OCR text longer than authorized. Respect source freshness, invalidate on index refresh, and do not cache provider outage as a verified empty inventory.
12. **Return status and observe.** Include source coverage/freshness and per-provider success/empty/timeout/error state in internal telemetry, with privacy-safe request IDs. Expose partial coverage in the result response without leaking credentials or internal stack traces. Track latency by stage, cache state, and input mode.

## Automotive fitment: safety-critical handling

Vehicle-part search requires stronger identity evidence than ordinary category matching. Keep vehicle make, model, year, trim/engine/market when supplied, part name, part number, and OEM number as separate sourced fields. Do not infer year range, trim, engine, side, or compatibility from a broad model name. Require explicit authoritative compatibility evidence from an authorized source for any “fits” claim. A matched SKU/OEM string is not alone proof of fitment or genuine/OEM status.

Ambiguous Arabic terminology (including terms that could name different parts) should trigger clarification before confident fitment claims. If catalog evidence only supports a textual candidate, describe it as a candidate and mark fitment unknown. Never state “compatible,” “original,” or “OEM” without evidence attached to that exact offer/product. Automotive safety gate: zero unsupported/incorrect fitment or OEM assertions; a single critical violation blocks release, consistent with the experiment scorecard.

## No-match, partial results, and service failures

Use distinct outcome states and UI language:

- **Verified no match:** the relevant enabled sources completed successfully and returned no hard-constraint-compliant candidate for the requested scope. Say no matching result was found in the searched sources; do not imply exhaustive global inventory.
- **Partial results:** at least one source succeeded while another timed out, errored, was unready, or was omitted by budget. Return relevant results with an explicit “some sources unavailable” qualification and source coverage.
- **Provider error / inventory unavailable:** no reliable relevant source completed, or required indexes were unready. Do not return a success-shaped empty array as “no matching product.” Report temporary unavailability and offer retry or a text-search fallback.
- **Input/interpretation uncertainty:** return safe candidates as close/unknown or ask a focused clarification; do not call this provider error or no-match.
- **No hard-constraint match, but close alternatives exist:** do not quietly present them as qualifying. Put them in a clearly separated close-alternatives section only where that is useful, label which requirement is unmet/unknown, and let the user explicitly relax the constraint.

Graceful fallback order: use completed internal/feed results when valid; where configured, use the existing Brave provider as a separately identified web source; preserve partial results if one branch fails; for image+text, retain text search if image interpretation is unavailable; for image-only, explain image search is unavailable and request text/ retry. Never convert an error into a verified no-match, and never imply Brave/web coverage is the same as feed inventory.

## Latency and resource budgets

Budgets below are **proposed service objectives**, not current measurements or commitments. Use the experiment scorecard's separate cached/cold measurement protocol and proposed floors as the initial evaluation contract: cached p50 ≤2s / p95 ≤5s; cold p50 ≤4s / p95 ≤10s. Report sample size, load profile, timeout/error rate, and input-mode slices; do not blend cached and cold percentiles.

Suggested initial stage budgets to validate on the intended deployment class:

| Stage | Proposed budget |
|---|---:|
| Validation, cache lookup, deterministic parse/plan | ≤250 ms |
| Optional bounded text understanding | ≤500 ms, skipped on budget pressure; never blocks deterministic retrieval |
| Internal/feed provider fan-out | ≤1.5 s deadline per provider, concurrent |
| Brave branch, when eligible | ≤4.5 s deadline, concurrent with eligible internal retrieval |
| Vision interpretation, when required | ≤3 s target / ≤5 s request budget; separate from search SLA and no second image call |
| Merge, hard-constraint gate, ranking, explanation assembly | ≤300 ms |
| Overall cold request | Target p50 ≤4 s / p95 ≤10 s; cancel/degrade optional branches before exhausting the request deadline |

Existing orchestrator defaults are visible in `searchOrchestrator.ts` (1.2s provider, 300ms intent-parser, and 4.5s Brave timeouts); they are **documented current defaults**, not proof of the proposed end-to-end objective. The existing `vision.ts` route has its own longer timeout; the proposed vision budget is an evaluation target requiring separate design review, not an instruction to change it. Do not enable parallel model calls or increase external spend to meet these targets.

## Hunt compatibility and feedback

Search should remain compatible with existing hunt components without changing their meaning or silently changing notification behavior. A hunt should store the user's explicit query/structured constraints, locale, selected providers, and last-seen stable product/offer identity with evidence timestamps. Re-run through the same parser, constraint gate, source provenance, and deduplication rules. Alert only on a newly observed eligible result or a user-configured change; do not alert on a transient provider outage or a result whose hard constraints are unknown/violated. A hunt may surface source freshness and “coverage incomplete” separately from “no new match.” Respect existing user consent, schedule, and provider permissions.

Feedback signals may include save/hide/click/purchase where available and authorized, plus explicit corrections (“not this brand,” “used only”). Use them to improve user-level preferences and evaluation labels only under consent and retention policy. Do not treat affiliate conversion as relevance ground truth, and do not let commercial outcomes override explicit user preferences. Keep a versioned, adjudicated offline regression set, including Arabic dialect/mixed-language, image ambiguity/OCR, hard constraints, exact-vs-close, no-match, automotive, used/local, and provider-outage cases. Do not train or tune on unreviewed interactions as verified facts.

## Gated delivery stages

All stages remain proposals; this document does not authorize implementation or production access.

### Stage 0 — Design/evaluation only

- Freeze permissions, data boundaries, threat/privacy review, provider status, and representative authorized fixtures.
- Reuse the current deterministic parser, feed/provider registry, Brave provider, normalizer, deduplication, ranking, cache, vision route, and hunt service as documented anchors; first map their actual semantics in a non-production review.
- Define provenance, tri-state constraints, result/outage distinction, exact/close/unknown labels, automotive assertions, and telemetry before proposing code changes.
- Run evaluation on authorized static snapshots only. No provider activation, paid dependency, production edits, candidate-image upload, or new bill.

### MVP — Separate approval and controlled rollout required

- Implement a bounded typed intent/provenance contract and a deterministic, budgeted lexical query planner; keep deterministic parser as baseline.
- Add tri-state hard-constraint checks and transparent exact/close/unknown labels, no-match vs error outcomes, provider-status-aware fallback, and evidence-backed explanations.
- Reuse the existing feeds/registry and eligible Brave branch; parallelize only within approved request/provider limits. Keep ranking independent of affiliate economics.
- Support image-only and image+text through authorized query-image interpretation only; enforce user-text precedence and candidate-image boundary. No catalog visual comparison, no new paid service.
- Gate on the experiment scorecard, including zero unsupported automotive assertions and demonstrated error/no-match separation. Roll out only after separate owner approval, privacy/security review, and rollback plan.

### Later — Independent authorization and evidence required per capability

- Consider legal used/local inventory, richer entity/variant/offer resolution, optional semantic retrieval, OCR assist, locally executed rights-cleared candidate visual comparison, or bounded optional model text understanding only after validating need, rights, source quality, cost, latency, safety, privacy, and evaluation.
- Any external paid provider, image service, new feed, or capability with new data transfer requires explicit approval and separate cost/security/legal review. Nothing in “later” enables or promises it.
- Add personalization only with consent, opt-out, and auditable separation from affiliate economics. Expand hunts only after notification and outage semantics are verified.

## Failure modes and required behavior

| Failure | Required safe behavior |
|---|---|
| Deterministic parser misses dialect, code-switching, or spelling | Search raw text plus bounded variants; lower/mark field confidence; ask if a hard requirement is ambiguous. |
| OCR/model misreads SKU, brand, or product | Treat as uncertain query evidence; keep original image/text; do not assert exact identity or automotive fitment. |
| Text conflicts with visual suggestion | Explicit text wins; preserve conflict; clarify if identity-critical. |
| Query image rejected, model unavailable, or vision times out | For text+image, continue text retrieval and disclose image interpretation unavailable. For image-only, offer retry/text entry; no fabricated empty-inventory result. |
| One feed/provider errors or times out | Keep successful relevant sources as partial; disclose reduced coverage; record error. Do not mark verified no-match. |
| All relevant providers fail/unready | Return unavailable/retry state, not “no products found”; do not cache as verified empty. |
| Brave unavailable or returns irrelevant/unsafe web pages | Preserve internal results; report fallback unavailable if it mattered; filter/label web evidence separately. |
| Hard-field evidence missing or currencies conflict | Constraint state is unknown; do not mark compliant. Ask to clarify or show explicitly non-qualifying alternatives. |
| Duplicate listing or mistaken product merge | Preserve offer/source IDs; conservatively split uncertain identities; monitor duplicate and false-merge rates. |
| Stale price or availability | Show source time/freshness and confirm at merchant; never imply live verification without it. |
| Automotive fitment/OEM evidence absent or contradictory | No compatibility/original claim; mark unknown or abstain from that assertion. |
| Cache contains stale data, old intent logic, or outage | Version/invalidate appropriately; expose freshness/status; never mask a current provider outage as a verified empty result. |
| Query exceeds budget | Stop optional branches first; return completed results as partial or unavailable with accurate coverage. |

## Proposed acceptance gates

Use the checked `SEARCH_SCORECARD.md` and `ACCEPTANCE_TESTS.md` rather than inventing unmeasured quality claims. Report metrics by the required Arabic, text/image, hard-constraint, no-match, used/local, and automotive slices, with denominators and confidence intervals. In particular:

- Hard constraints use three states; unknown is never counted compliant.
- Exact/close confusion and false-exact claims are separately measured.
- Verified no-match, false abstention, and provider failure are separate outcomes.
- Candidate-image evaluations use only rights-cleared fixtures; no merchant/affiliate/provider candidate image may be sent to Gemini.
- Automotive unsupported/incorrect fitment and OEM assertions remain a zero-tolerance release blocker.
- Latency is measured cached and cold separately, including failures/timeouts and the intended load profile.
- No new paid service or provider is required to satisfy this proposal.
