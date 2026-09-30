# Incremental roadmap from stable V2 to the gold standard

**Design only — no implementation authorized.** Branch:
`experiment/search-blueprint`, based on GitHub `main` at `8698bcc`.
The sequencing below depends on separate product, privacy, source-rights,
cost and rollout approvals. It does **not** replace stable V2 now. Read with
the [V2 audit](CURRENT_V2_GAP_ANALYSIS.md),
[target pipeline](SEARCH_ARCHITECTURE.md),
[63 proposed acceptance cases](ACCEPTANCE_TESTS.md) and
[scorecard](SEARCH_SCORECARD.md).

## Priority order

Scores are **relative planning estimates**, not measured engineering days or
provider quotes. Impact: H/M/L; effort, cost and risk: L/M/H. A safety
improvement outranks a feature with better headline recall. No stage
silently enables a new service.

| Order | Separately approved increment and measurable exit | Impact / effort / incremental cost / risk | Prerequisite |
| --- | --- | --- | --- |
| 0 — now | Freeze source-authorized fixture snapshots, licensed **user query** images, gold identity/fitment/constraint labels and all 63 pass/fail cases. Capture stable V2's baseline by cold/warm, Arabic, image, automotive, local/used and no-match slices; record provider readiness and error versus true no-match. This is evaluation planning, not a production rollout. | H / M / L / L | Source rights, independent reviewers and stable test data |
| **1 — first code change, only after approval** | Add a provenance-bearing result/intent contract at the existing V2 boundary; distinguish hard/soft/unknown constraints and result/partial/error/no-confident-match states. Hard-filter only with verified evidence; separate safe alternatives. Require **zero unsupported automotive fitment/OEM assertions**, no false exact from mere resemblance, and explicit price/color/condition/location behavior. Keep an easy V2 rollback path. | **H / M / L / M** | 0, API compatibility and safety review |
| **2 — second** | Improve deterministic Arabic/Saudi dialect and mixed-language parsing, exact GTIN/MPN/model/SKU lexical lookup, typo/synonym query planning and provider timing/coverage visibility. Keep bounded feed and Brave fan-out and the original query; do not add a vector provider by default. Prove exact, Arabic and no-match gains on frozen paired cases without new hard-filter regressions. | **H / M / L / M** | 1; permitted indexed identifiers and provider data quality |
| **3 — third** | Normalize evidence freshness and build a cautious product→variant→seller-offer grouping boundary. Preserve separate prices, currencies, stock and delivery; dedupe duplicate offers but never merge unproven identities. Rerank **eligible** products by user relevance, not commission; support same-product cheaper comparisons with comparable current prices. | **H / M–H / L–M / M–H** | 1–2; verified identifier coverage and representative labeled offers |
| **4 — fourth** | Improve the existing user-query-image→intent→text-search path: image+explicit text fusion, optional bounded OCR of visible user-photo text, ambiguity handling, strict color/price refinement, visual claim audit and safe text fallback. No merchant/candidate image to Gemini or another unapproved external model, and no candidate-image comparison without separately documented rights. Show improvement over V2's image slice before claiming success. | **H / M / L–M existing-vision usage / M** | 1–3; licensed test images, photo admission/privacy review |
| **5 — fifth** | Pilot one **lawfully accessible**, freshness-tested used/local source and verified city, condition, delivery and automotive fitment fields. Keep seller location separate from shipping coverage. No marketplace scraping, fabricated inventory or unapproved connector. If lawful source access is unavailable, improve source coverage visibility instead and leave used/local as “not verified.” | **H / M–H / variable (approval required) / H** | 1–3; source terms, consent, provider policy, data protection |
| 6 — later, conditional | Add an optional hybrid lexical/semantic branch **only if** frozen cases show a persistent discovery gap not solved by cheap lexical/Arabic improvements. Evaluate local/open techniques first; maintain exact-ID precedence and tri-state constraints. A/B against V2 and the increment-5 baseline with the same ready source cohort; no model choice based on a text-only proxy for image improvement. | M / M–H / L local to H hosted / M–H | 0–5, measured incremental value, cost/security approval |
| 7 — later, conditional | Add consent-aware click/save/correction evaluation, price/stock freshness checks, and hunt re-evaluation using the same intent and evidence semantics. Never promise background alerts without a working scheduler or treat affiliate conversion as relevance ground truth. | M / M / L–M / M | 1–5, user consent and instrumentation |

**Release sequencing:** each code increment must be independently reviewed,
tested on held-out fixtures, and gated by the scorecard before any controlled
production exposure. A provider error is not a no-match, and a good aggregate
score cannot excuse a safety violation. Freeze expected results **before**
developing each change. Where a metric lacks enough authorized data, report
`N/A` rather than manufacture a passing percentage.

## What to preserve, improve, replace, add or remove

| Decision | Components / rationale |
| --- | --- |
| **KEEP** | Stable `routes/search.ts` API and V2 `searchOrchestrator.ts` baseline; `providerRegistry.ts` and the seven existing feed adapters; configured Brave text discovery; deterministic `intentParser.ts`, `queryExpansion.ts`; `resultNormalizer.ts`, `deduplicationService.ts`, `rankingService.ts`, `cacheService.ts` as incremental extension points; bounded `routes/vision.ts` admission and current hunt/monitoring infrastructure. Keep behavior unchanged until a separate approved implementation. |
| **IMPROVE** | Arabic intent precision, source readiness/timing, exact identifier retrieval, product/offer identity, dedup boundaries, price/stock freshness, strict filters, metadata provenance, safe no-match/error behavior, image+text query fusion, evidence-backed result explanations and ranking relevance. |
| **REPLACE, only after measured evidence** | Weak title-only identity or implicit fallback heuristics where they produce false exacts/irrelevance; replace individual decision rules with tested provenance/constraint-aware rules, **not** the whole V2 architecture. Do not promote V3-local's inferior ranking to production. |
| **ADD** | Field-level provenance/unknown states; hard-constraint gate; exact/close/uncertain labels; canonical product/variant/offer representation; source coverage/freshness telemetry; frozen authorized evaluation fixtures; optional user-authorized image OCR; later lawful used/local sources, consent-based feedback and gated semantic retrieval if they prove value. |
| **REMOVE** | No working production provider or core API by default. Eliminate only demonstrably misleading behaviors as they are replaced: unsupported exact/fitment assertions, silent constraint relaxation, affiliate bias if present, and success-shaped empty results for source failures. Do not claim such behavior exists without a reproducing test. |

## External services and cost decisions

**No purchase, billing activation, plan change or production connection is
part of this roadmap.** Costs are broad incremental categories, not vendor
quotes; verify current terms and usage before any future approval.

| Candidate service / source | Why consider it; can current LUQTA infrastructure do this? | Incremental cost category | Needed now? |
| --- | --- | --- | --- |
| Existing Brave subscription | Text discovery beyond bounded official feeds. Existing configured `BraveWebSearchProvider` can be retained; it is not a substitute for true candidate visual search or guaranteed inventory. | Existing usage / monitor quotas; no new purchase | **Reuse now**, within current approved limits |
| Existing OpenAI-compatible vision integration | User-query-photo category/OCR assistance. Existing bounded vision route can provide a baseline but needs stricter visual-evidence evaluation; do not send candidate photos. | Existing per-call usage, variable; no new purchase | **Reuse cautiously** for separately approved future image work |
| Existing Gemini access | Optional, **only licensed user query images** or permitted bounded text diagnostics if a later trial demonstrates actual availability and incremental quality. Prior V3 image requests failed 404/503; model-list availability was not generation availability. No merchant/candidate images. | Potential existing token-metered usage; no new plan enabled | **Not required now**; future gated experiment only |
| Local/open lexical or vector techniques | Optional semantic recall where deterministic Arabic and exact-ID retrieval have a proven gap. Existing API/feed indexes can do lexical work now; local vector work requires rights-cleared text, compute, maintenance and measured quality. | Low-to-medium infrastructure/operations | **Later, only if measured need** |
| Algolia NeuralSearch or another hosted semantic index | Could outsource hybrid retrieval, but existing V2 + local improvements may meet MVP goals. Public pricing lists NeuralSearch under an enterprise/custom tier, not the low-tier Grow request price; do not assume low unit prices cover it. | High/contract-dependent | **Not required**; proposal only after clear cost-benefit evidence |
| Lawfully accessible used/local marketplace or partner API | Adds Saudi used/local inventory that current official feeds may lack. Existing provider interface can adapt a source, but cannot create lawful access, verifiable condition/location, or coverage. | Unknown, possibly licensing/partner/operations | **Later, conditional** on permission and source quality |

Shopping Graph, Amazon and Perplexity are *research references*, not
proposed APIs or purchases. Shopify Search & Discovery is an example of
storefront pattern, not a promised cross-store source. No external ranking
service is necessary for the first five priorities.

## Decision checkpoints

1. **Approve facts and rights:** independent reviewers validate the frozen
   gold labels and source/image permissions; reject ambiguous examples before
   collecting performance figures.
2. **Approve one increment:** specific behavior, rollout boundary, cost
   estimate, owner and rollback plan. Documentation is not that approval.
3. **Verify paired quality:** compare against stable V2 on the same ready
   provider cohort and dataset; report errors, unavailable images, score
   denominators and cold/cached latency separately. Use a holdout to prevent
   tuning to the published examples alone.
4. **Stop on regression:** unsupported exact or automotive assertion blocks
   release; any metric regression outside agreed tolerance triggers review.
   Do not compensate with affiliate commission or a wider paid index.