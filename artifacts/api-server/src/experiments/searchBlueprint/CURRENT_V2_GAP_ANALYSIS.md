# Stable V2 search: current gap analysis

**Scope:** Read-only audit of the stable V2 connector and route implementation on the local `experiment/search-blueprint` branch. This document does not change production code. Status is a qualitative code review, not a benchmark or a claim about supplier inventory. GREEN is reserved for a capability demonstrably strong end-to-end; none of the 21 capabilities meets that bar from code evidence alone.

**Evidence convention:** Paths and line ranges below cite stable local V2 code. “Inference” explicitly marks a plausible technical explanation, not an established root cause. V3 evidence is separated at the end and must not be read as V2 production behavior.

## Capability audit (21 gold capabilities)

### 1. Query understanding — YELLOW
- **Current behavior:** A deterministic parser recognizes a fixed set of product types, audience, colors and brands, plus numeric price/currency, condition and a limited vehicle/part vocabulary. It emits a normalized string and structured `QueryIntent`; the parser itself says it makes no external AI requests. [intentParser.ts:14-33,138-182,241-245,250-397](../../connectors/intentParser.ts#L14-L33)
- **Target:** Robustly extract product identity, attributes, intent and ambiguity across open-ended shopping language, then preserve uncertainty rather than silently dropping meaning.
- **User impact:** Unrecognized brands, attributes or phrasing can become generic leftover keywords; searches can miss the desired item or over-match.
- **Likely technical cause (inference):** The deterministic alias tables and regex extraction are intentionally bounded rather than broad language understanding.
- **Smallest incremental improvement:** Add test-led parser rules for the highest-impact missing intents and preserve unparsed terms as explicit uncertain intent fields.
- **Reuse existing infrastructure:** **Yes** — `QueryIntent`, parser interface, expansion and orchestrator already carry structured intent. [types.ts:120-153](../../connectors/types.ts#L120-L153) [searchOrchestrator.ts:861-916](../../connectors/searchOrchestrator.ts#L861-L916)

### 2. Arabic / Saudi dialect — YELLOW
- **Current behavior:** Arabic search normalization removes diacritics/tatweel and normalizes common letter variants; a hand-curated bilingual vocabulary covers selected products, colors, conditions and brands. [queryExpansion.ts:1-88,97-107](../../connectors/queryExpansion.ts#L1-L107)
- **Target:** Reliable recognition of common Saudi colloquialisms, spelling variation, transliteration and mixed Arabic-English queries without losing qualifiers.
- **User impact:** Equivalent local expressions not present in the vocabulary may produce weaker or irrelevant results; normalization alone does not translate dialect meaning.
- **Likely technical cause (inference):** Phrase segmentation and variant generation rely on enumerated vocabulary, not dialect-aware linguistic analysis. [queryExpansion.ts:284-320,323-339](../../connectors/queryExpansion.ts#L284-L339)
- **Smallest incremental improvement:** Build a measured dialect synonym set from reviewed examples; add each phrase with regression cases for both the parsed intent and generated variants.
- **Reuse existing infrastructure:** **Yes** — vocabulary segmentation, normalization, intent aliases and bilingual variants are already present. [queryExpansion.ts:20-88,284-339](../../connectors/queryExpansion.ts#L20-L88)

### 3. Image understanding — YELLOW
- **Current behavior:** `POST /vision/interpret` accepts a bounded JPEG, sends an image plus fixed instructions to `gpt-5-mini`, and normalizes candidate confidence, alternatives and a confirmation flag; it has admission limits and a 20-second timeout. The mobile camera flow calls that interpretation, merges the accepted generic visual query with user text, and navigates to text search; low-confidence understanding requires confirmation. This is a real image-to-text-search handoff, **not** direct candidate-image visual retrieval. [vision.ts:13-25,27-61,63-90,112-134](../../routes/vision.ts#L13-L25) [visionHelpers.ts:18-20,106-123,142-206](../../routes/visionHelpers.ts#L18-L20) [camera.tsx:83-101](../../../../luqta-mobile/app/camera.tsx#L83-L101)
- **Target:** Dependable image-to-product discovery with robust identity/attribute extraction, uncertainty handling and a verified handoff into the same retrieval and ranking path.
- **User impact:** An unclear image can fail or return candidates needing user confirmation; an image interpretation endpoint alone does not establish successful product retrieval.
- **Likely technical cause (inference):** The implemented path converts a low-detail photo to a generic text query; this audit finds no stable V2 image-embedding or candidate-visual retrieval path. [vision.ts:63-90](../../routes/vision.ts#L63-L90) [camera.tsx:92-100](../../../../luqta-mobile/app/camera.tsx#L92-L100)
- **Smallest incremental improvement:** Add end-to-end regression cases for the existing mobile interpretation→confirmation→text search handoff, then preserve explicit text constraints and per-field visual uncertainty through search.
- **Reuse existing infrastructure:** **Yes for query-image-to-text search; partial for richer visual matching** — the mobile camera flow, vision endpoint, normalizer and V2 search already exist, but no permitted candidate-image comparison is demonstrated.

### 4. Query planning — YELLOW
- **Current behavior:** Search expansion segments known terms into up to six variants; orchestrator fans variants out concurrently to each selected provider, then weights returned scores. This is parallel query expansion, not a staged plan conditioned on observed results. [queryExpansion.ts:1-3,284-320](../../connectors/queryExpansion.ts#L1-L3) [searchOrchestrator.ts:914-924,925-1013](../../connectors/searchOrchestrator.ts#L914-L924)
- **Target:** Select query/source strategies by intent and evidence, constrain expensive calls, and refine only where initial retrieval is inadequate.
- **User impact:** Broad variant fanout can spend latency/provider budget on redundant queries, while misses do not necessarily trigger a tailored plan.
- **Likely technical cause (inference):** Planning is encoded as static variants and provider-wide parallel fanout rather than a planner with retrieval feedback. [searchOrchestrator.ts:971-1016](../../connectors/searchOrchestrator.ts#L971-L1016)
- **Smallest incremental improvement:** Add a deterministic per-intent query plan that prioritizes a small first pass and conditionally expands when quality checks fail.
- **Reuse existing infrastructure:** **Partial** — intent, variant generation, quality assessment, per-stage telemetry and provider abstraction are reusable. [searchOrchestrator.ts:683-728,1211-1238](../../connectors/searchOrchestrator.ts#L683-L728)

### 5. Hybrid retrieval — RED
- **Current behavior:** Providers receive textual queries; V2 calculates lexical surface/product-term scores and combines provider-supplied match scores. No stable V2 lexical-plus-vector or other semantic retrieval mechanism is evidenced in these search connectors. [searchOrchestrator.ts:148-180,971-1003](../../connectors/searchOrchestrator.ts#L148-L180)
- **Target:** Combine lexical exactness with semantic recall, then fuse candidates while preserving source and exact-identity evidence.
- **User impact:** Synonyms, paraphrases and visually/semantically similar products may be missed when the provider index does not match query wording.
- **Likely technical cause (inference):** The current scoring path is token/string-based and has no visible embedding or vector candidate stage in the audited stable V2 implementation. [searchOrchestrator.ts:148-180,971-1003](../../connectors/searchOrchestrator.ts#L148-L180)
- **Smallest incremental improvement:** Introduce a separately measurable semantic candidate source and merge it through existing normalization, deduplication and ranking without replacing working text retrieval.
- **Reuse existing infrastructure:** **Partial** — candidate normalization, provider interface, deduplication and ranker are suitable; semantic candidate generation/fusion is absent in the audited path. [types.ts:175-232](../../connectors/types.ts#L175-L232)

### 6. Multi-source discovery — YELLOW
- **Current behavior:** The registry knows multiple adapters and V2 queries enabled providers concurrently; Brave web search is a gated fallback. Several familiar retail adapters are explicitly disabled and return empty results until an authorized implementation is supplied. [providerRegistry.ts:21-57,59-81](../../connectors/providerRegistry.ts#L21-L57) [adapters.ts:8-28,82-105,109-120](../../connectors/adapters.ts#L8-L28) [searchOrchestrator.ts:805-813,1224-1238](../../connectors/searchOrchestrator.ts#L805-L813)
- **Target:** Broad, authorized, independently health-checked source coverage, with clear completeness and source provenance.
- **User impact:** A registered provider is not proof of live inventory; disabled integrations cannot discover offers, and users can see sparse results.
- **Likely technical cause (inference):** Connector breadth is constrained by access/authorization and active feed availability; no evidence supports attributing this to a specific missing supplier or inventory quantity. [adapters.ts:82-105,241-265](../../connectors/adapters.ts#L82-L105)
- **Smallest incremental improvement:** Prioritize one authorized source integration at a time; expose enabled/disabled and last-sync state accurately and verify it with provider contract tests.
- **Reuse existing infrastructure:** **Yes** — registry, provider interface, status route and per-provider readiness/telemetry exist. [providerRegistry.ts:21-57](../../connectors/providerRegistry.ts#L21-L57) [providers.ts:7-38](../../routes/providers.ts#L7-L38)

### 7. Product identity — YELLOW
- **Current behavior:** Results are normalized into a canonical shape with provider-specific product IDs and basic title/brand/type/category/price fields. [resultNormalizer.ts:58-111,114-128](../../connectors/resultNormalizer.ts#L58-L111)
- **Target:** Resolve same-SKU/model identity across sources while distinguishing variants, bundles, refurbished/used items and misleading title matches.
- **User impact:** The same item can appear as separate source results; conversely, superficially similar titles may be treated as equivalent by later dedup.
- **Likely technical cause (inference):** Canonicalization currently cleans records but does not resolve a cross-source entity or SKU identity. [resultNormalizer.ts:58-111](../../connectors/resultNormalizer.ts#L58-L111)
- **Smallest incremental improvement:** Preserve explicit GTIN/MPN/brand-model identifiers where supplied, then use a conservative identity key with a reviewable fallback.
- **Reuse existing infrastructure:** **Partial** — canonical product schema and normalization exist; cross-source entity resolution is not evidenced. [types.ts:25-54,175-222](../../connectors/types.ts#L25-L54)

### 8. Product / offer grouping — RED
- **Current behavior:** Deduplication drops repeated exact product URLs or identical normalized title-plus-merchant keys; it does not produce a parent product with distinct source offers. [deduplicationService.ts:3-24](../../connectors/deduplicationService.ts#L3-L24)
- **Target:** Group equivalent product identities and retain each merchant/price/availability as a separate offer, with variant distinctions intact.
- **User impact:** Users may see duplicate listings and cannot compare offers in one coherent product view.
- **Likely technical cause (inference):** The implementation is a first-seen duplicate filter, not an entity/offer grouping model. [deduplicationService.ts:12-24](../../connectors/deduplicationService.ts#L12-L24)
- **Smallest incremental improvement:** Add a grouping result type keyed only by verified shared identity; retain source-specific offer records and leave uncertain matches ungrouped.
- **Reuse existing infrastructure:** **Partial** — normalized products and current dedup entry point can feed a grouping stage; grouped product/offer output is not present. [types.ts:25-54,210-222](../../connectors/types.ts#L25-L54)

### 9. Hard constraints — YELLOW
- **Current behavior:** Explicit price ranges reject missing prices, unknown/mismatched currency and out-of-range amounts; product/brand/vehicle/year/part constraints are checked against title/category/brand/description surfaces. [searchOrchestrator.ts:462-562,627-681](../../connectors/searchOrchestrator.ts#L462-L562)
- **Target:** Enforce every explicit must-have consistently, distinguish unknown data from a confirmed violation, and never silently weaken an exact constraint.
- **User impact:** Current price enforcement is a strong safeguard, but incomplete catalog attributes or text-only identity checks can hide valid matches or allow a non-price mismatch.
- **Likely technical cause (inference):** Several hard constraints are validated against surfaced text, while typed supplier attributes are sparse/optional. [types.ts:175-208](../../connectors/types.ts#L175-L208) [searchOrchestrator.ts:469-483,533-540](../../connectors/searchOrchestrator.ts#L469-L483)
- **Smallest incremental improvement:** Add typed constraint validators with explicit `matched / contradicted / unknown` states, beginning with vehicle part identity and condition; retain strict price filtering.
- **Reuse existing infrastructure:** **Partial** — structured intent and strict price filtering are reusable; the constraint evaluator needs richer typed evidence. [searchOrchestrator.ts:657-681](../../connectors/searchOrchestrator.ts#L657-L681)

### 10. Semantic relevance — YELLOW
- **Current behavior:** Search quality checks tokens, term groups and explicit intent; ranking combines exact, visual, specification, price, availability, reliability, condition and location scores using fixed weights. [searchOrchestrator.ts:565-613,683-728](../../connectors/searchOrchestrator.ts#L565-L613) [rankingService.ts:4-53](../../connectors/rankingService.ts#L4-L53)
- **Target:** Rank by judged shopping relevance and calibrated confidence, including semantic equivalence and query-specific attribute importance.
- **User impact:** A result can score well on available fields while still being a poor substitute for the requested identity or use case.
- **Likely technical cause (inference):** Fixed weighted features plus surface matching are a heuristic proxy for relevance, not a learned or semantically calibrated ranker. [rankingService.ts:23-43](../../connectors/rankingService.ts#L23-L43)
- **Smallest incremental improvement:** Build a small judged query-result set and evaluate current features; adjust weights only against labeled outcomes and track top-k relevance.
- **Reuse existing infrastructure:** **Yes** — rank features, quality evaluator and stage metrics are already available. [rankingService.ts:23-52](../../connectors/rankingService.ts#L23-L52) [searchOrchestrator.ts:1211-1223](../../connectors/searchOrchestrator.ts#L1211-L1223)

### 11. Shopping reranking — YELLOW
- **Current behavior:** V2 applies fixed weighted ranking; electronics category browse adds category-quality and data-quality weights. No query-personalized or learned shopping preference evidence is present in this ranker. [rankingService.ts:23-52](../../connectors/rankingService.ts#L23-L52)
- **Target:** Put the best relevant, available, trustworthy offers first while adapting to explicit shopping intent and measured user preferences.
- **User impact:** Useful fields such as availability, price and data completeness help, but the fixed weights may not reflect the specific query or shopper.
- **Likely technical cause (inference):** Ranking is deterministic hand-weighted feature arithmetic without feedback-derived weights. [rankingService.ts:23-43](../../connectors/rankingService.ts#L23-L43)
- **Smallest incremental improvement:** Evaluate rank order on judged shopping queries; tune a small number of weights and separately report relevance and offer quality.
- **Reuse existing infrastructure:** **Yes** — rank scores and query/intent context already flow through the ranker. [rankingService.ts:4-52](../../connectors/rankingService.ts#L4-L52)

### 12. Exact / similar — YELLOW
- **Current behavior:** Search exposes match-score fields and variant expansion, but no explicit two-lane exact-versus-similar retrieval/output contract is evidenced; normalization and dedup do not resolve item identity. [types.ts:203-207](../../connectors/types.ts#L203-L207) [searchOrchestrator.ts:971-1013](../../connectors/searchOrchestrator.ts#L971-L1013)
- **Target:** Clearly prioritize exact identity matches, then label and rank alternatives by similarity without presenting substitutes as exact.
- **User impact:** Users may not know whether a result is the exact requested model or merely related.
- **Likely technical cause (inference):** Existing `exactMatchScore` is a generic provider score consumed by one ranker, not a verified exact-identity decision. [rankingService.ts:23-32](../../connectors/rankingService.ts#L23-L32)
- **Smallest incremental improvement:** Add a conservative exact-identity predicate from structured identifiers and expose exact/alternative grouping in response metadata.
- **Reuse existing infrastructure:** **Partial** — score fields, normalized products and rank ordering exist; verified identity classes and output distinction do not. [types.ts:25-54,203-222](../../connectors/types.ts#L25-L54)

### 13. Automotive — YELLOW
- **Current behavior:** Parser handles car parts/headlights, Toyota/Camry and some years, part/OEM numbers; quality checks can require vehicle/model/year and exact part-number text. [intentParser.ts:26-34,316-396](../../connectors/intentParser.ts#L26-L34) [searchOrchestrator.ts:432-449,533-540](../../connectors/searchOrchestrator.ts#L432-L449)
- **Target:** Resolve vehicle fitment and compatible part identity from authoritative structured catalog evidence, including make/model/year/trim/engine and OEM cross-reference.
- **User impact:** A matching text title is not proof that a part fits a particular vehicle; unsupported vehicles or identifiers can yield no useful results.
- **Likely technical cause (inference):** Visible parser coverage is narrow, and the constraint check tests text surfaces rather than a fitment catalog. [intentParser.ts:316-333](../../connectors/intentParser.ts#L316-L333) [searchOrchestrator.ts:533-540](../../connectors/searchOrchestrator.ts#L533-L540)
- **Smallest incremental improvement:** Add a fitment field/provider contract and require verified fitment before labeling a result compatible; expand vehicle aliases through tests.
- **Reuse existing infrastructure:** **Partial** — vehicle intent fields, provider product contract and exact-number checks exist; fitment evidence does not. [types.ts:133-140,175-208](../../connectors/types.ts#L133-L140)

### 14. Used / local — YELLOW
- **Current behavior:** Parser recognizes used/new/refurbished, intent includes condition and location, and ranking rewards a direct condition/location equality; the Haraj adapter is explicitly disabled pending authorized access. [intentParser.ts:307-314](../../connectors/intentParser.ts#L307-L314) [rankingService.ts:12-22](../../connectors/rankingService.ts#L12-L22) [adapters.ts:241-265](../../connectors/adapters.ts#L241-L265)
- **Target:** Search authorized second-hand and local listings with structured condition, geographic radius and trustworthy freshness/availability.
- **User impact:** A used/local request may have limited eligible source coverage; a location preference is only a ranking signal, not demonstrated radius-based retrieval.
- **Likely technical cause (inference):** Condition/location exist in data contracts, but local-market source integration is disabled and location scoring is exact string equality. [rankingService.ts:18-22](../../connectors/rankingService.ts#L18-L22) [adapters.ts:241-265](../../connectors/adapters.ts#L241-L265)
- **Smallest incremental improvement:** Add an authorized local provider only after access is confirmed; normalize location and condition fields before ranking and expose their unknown state.
- **Reuse existing infrastructure:** **Partial** — typed condition/location, provider status and ranking are present; an authorized local source/radius search is not evidenced. [types.ts:133-142,175-208](../../connectors/types.ts#L133-L142)

### 15. No-confident-match — YELLOW
- **Current behavior:** Image interpretation asks for null/low-confidence candidates on ambiguity and marks candidates for confirmation below a threshold or with a close runner-up. Text search measures “strong” matches and triggers fallback on weak internal relevance, but does not expose a calibrated no-confident-match decision as the search result contract. [vision.ts:16-24](../../routes/vision.ts#L16-L24) [visionHelpers.ts:18-20,182-205](../../routes/visionHelpers.ts#L18-L20) [searchOrchestrator.ts:683-728,1339-1352](../../connectors/searchOrchestrator.ts#L683-L1352)
- **Target:** Abstain explicitly when identity/relevance confidence is insufficient; distinguish no matches from unavailable sources and offer a safe next step.
- **User impact:** A weak result set can look authoritative, while a genuinely empty result can be conflated with a failed provider.
- **Likely technical cause (inference):** Image confidence is normalized locally, whereas text search uses heuristic relevance counts and a fallback status rather than calibrated confidence. [visionHelpers.ts:182-205](../../routes/visionHelpers.ts#L182-L205) [searchOrchestrator.ts:683-728,1403-1418](../../connectors/searchOrchestrator.ts#L683-L1418)
- **Smallest incremental improvement:** Add explicit response state (`confident_match`, `needs_confirmation`, `no_confident_match`, `sources_unavailable`) based on tested thresholds; preserve candidate alternatives.
- **Reuse existing infrastructure:** **Partial** — vision confirmation, quality assessment, fallback status and inventory error response exist; unified confidence/abstention output does not. [visionHelpers.ts:11-20](../../routes/visionHelpers.ts#L11-L20) [searchOrchestrator.ts:111-124,1339-1352](../../connectors/searchOrchestrator.ts#L111-L1352)

### 16. Explanations — YELLOW
- **Current behavior:** Search response includes structured intent and selected metadata; internal logs emit named stages, scores/timings and fallback status. The route does not return a user-facing reason for a product match or omission. [searchOrchestrator.ts:111-145,1339-1388](../../connectors/searchOrchestrator.ts#L111-L145) [search.ts:45-81](../../routes/search.ts#L45-L81)
- **Target:** Give concise, evidence-based reasons such as matched model, price constraint, availability and source, without inventing product facts.
- **User impact:** Users cannot tell why a result is relevant, why an exact request returned alternatives, or whether an attribute was unknown.
- **Likely technical cause (inference):** Scores and trace details are internal pipeline metadata; no explanation object is constructed for each returned result. [searchOrchestrator.ts:1190-1223,1339-1388](../../connectors/searchOrchestrator.ts#L1190-L1223)
- **Smallest incremental improvement:** Return a short list of reason codes from the evidence already used by filters/ranker, and display only supported facts.
- **Reuse existing infrastructure:** **Partial** — intent, score fields and trace events can support reasons; user-facing per-result explanation schema is absent. [types.ts:120-142,203-222](../../connectors/types.ts#L120-L142)

### 17. Dedup — YELLOW
- **Current behavior:** Duplicate elimination keys exact product URL, or normalized title plus merchant; first occurrence wins. [deduplicationService.ts:3-24](../../connectors/deduplicationService.ts#L3-L24)
- **Target:** Merge clear cross-source duplicates without collapsing distinct variants or losing offer provenance.
- **User impact:** URL/title variation can leave duplicate items; same-title items from different merchants remain separate (appropriately distinct offers but not grouped), and first-seen selection may discard richer data.
- **Likely technical cause (inference):** Conservative exact keys do not compare normalized product identifiers or preserve a group of offer records. [deduplicationService.ts:16-23](../../connectors/deduplicationService.ts#L16-L23)
- **Smallest incremental improvement:** Add canonical identifier matching and retain the best populated product record plus all source offer records; keep uncertain candidates separate.
- **Reuse existing infrastructure:** **Partial** — centralized dedup stage and canonical fields exist; confidence-aware cross-source matching/grouping does not. [searchOrchestrator.ts:1098-1117](../../connectors/searchOrchestrator.ts#L1098-L1117) [types.ts:25-54](../../connectors/types.ts#L25-L54)

### 18. Latency — YELLOW
- **Current behavior:** Provider search has a 1.2-second stage timeout, intent parsing 300ms, Brave fallback 4.5 seconds; providers and variants run concurrently. Route and per-stage durations are logged. [searchOrchestrator.ts:43-54,73-91,925-1017](../../connectors/searchOrchestrator.ts#L43-L54) [search.ts:13-34,61-79](../../routes/search.ts#L13-L34)
- **Target:** Measured end-to-end p95/p99 budgets across cold start, provider fanout, fallback, image understanding and serialization, with cancellation and predictable partial responses.
- **User impact:** Timed-out provider calls can reduce recall; image analysis permits up to 20 seconds; concurrent expansion can magnify upstream load.
- **Likely technical cause (inference):** Timeouts bound stages but the audit does not find a single end-to-end request deadline or cancellation propagation for every raced provider operation. [searchOrchestrator.ts:73-90,971-1017](../../connectors/searchOrchestrator.ts#L73-L90)
- **Smallest incremental improvement:** Record end-to-end latency percentiles by warm/cold path and set a request budget with cancellation; first cap or prioritize fanout based on measurements.
- **Reuse existing infrastructure:** **Yes** — trace IDs, detailed stage timings, provider timeout handling and cache are present. [search.ts:13-34,61-79](../../routes/search.ts#L13-L34) [searchOrchestrator.ts:125-145](../../connectors/searchOrchestrator.ts#L125-L145)

### 19. Reliability / fallback — YELLOW
- **Current behavior:** Provider calls are isolated with timeouts/errors, readiness is checked, cold inventory can return explicit 503, Brave fallback is relevance-triggered and excluded for image, category and preferred-provider searches; failures and cache skips are traced. [searchOrchestrator.ts:50-71,805-859,1039-1097,1224-1325,1403-1442](../../connectors/searchOrchestrator.ts#L50-L71)
- **Target:** Consistent graceful degradation with bounded total time, cancellation, explicit completeness and clear distinction between empty, partial and unavailable.
- **User impact:** A user can receive partial results after provider failure; fallback is intentionally unavailable for several request classes and cannot replace an unready feed.
- **Likely technical cause (inference):** Fallback policy is a specific rule set, not a universal resilience layer; a Promise-race timeout alone does not establish cancellation of all underlying work. [searchOrchestrator.ts:73-90,1224-1238](../../connectors/searchOrchestrator.ts#L73-L90)
- **Smallest incremental improvement:** Make completeness/partial status explicit in the API and propagate cancellation/deadline to each provider; preserve current strict inventory-unready behavior.
- **Reuse existing infrastructure:** **Yes** — per-provider errors/readiness, bounded stages, metrics, fallback status and 503 behavior already exist. [searchOrchestrator.ts:100-145,1403-1442](../../connectors/searchOrchestrator.ts#L100-L145) [search.ts:82-95](../../routes/search.ts#L82-L95)

### 20. Feedback / learning — RED
- **Current behavior:** The audited stable search route is request/response with trace logging; no search impression, click, purchase, hide, correction or ranking-feedback write path is evidenced in the audited connectors/routes. Hunts persist user-defined query and discovery fields, but this is not demonstrated as a ranking-feedback loop. [search.ts:13-81](../../routes/search.ts#L13-L81) [hunts.ts:44-89](../../routes/hunts.ts#L44-L89)
- **Target:** Collect consented, privacy-aware feedback and use it in offline evaluation and controlled ranking updates.
- **User impact:** Ranking cannot learn from whether results were useful; relevance improvements remain dependent on manual changes and curated evaluation.
- **Likely technical cause (inference):** The audited search route emits operational telemetry, not outcome labels or a feedback event. [search.ts:18-34,61-79](../../routes/search.ts#L18-L34)
- **Smallest incremental improvement:** Define an opt-in feedback event with query/result/source identifiers and outcome, then use it first for offline evaluation—not automatic ranking changes.
- **Reuse existing infrastructure:** **Partial** — trace IDs, product/provider IDs and persisted hunt concepts exist; a feedback schema/event pipeline is not evidenced here. [search.ts:15-34](../../routes/search.ts#L15-L34) [types.ts:25-30](../../connectors/types.ts#L25-L30)

### 21. Hunt compatibility — YELLOW
- **Current behavior:** Authenticated device routes create, read, update and delete saved hunts; saves can parse deterministic intent and persist target price, condition, match status and discovery matches. Monitoring state reflects a recent `lastCheckedAt` and count of eligible providers. [hunts.ts:27-63,66-89,116-174,258-275](../../routes/hunts.ts#L27)
- **Target:** Saved searches should share the same intent/constraint semantics as one-shot search and have verified, policy-compliant discovery/monitoring with transparent freshness.
- **User impact:** Hunt persistence is present, but a “monitoring active” label is based on a freshness timestamp and eligible-provider count; this audit does not establish an active scheduler or successful result refresh. [hunts.ts:27-42](../../routes/hunts.ts#L27-L42)
- **Likely technical cause (inference):** The route serializes/persists hunt state while provider eligibility is a registry policy check; execution and scheduling are outside these audited route behaviors. [huntService.ts:7-24](../../connectors/huntService.ts#L7-L24) [hunts.ts:116-154](../../routes/hunts.ts#L116-L154)
- **Smallest incremental improvement:** Verify and expose actual last successful check/result freshness separately from configured eligibility; run shared V2 intent/constraint regression cases on hunt updates.
- **Reuse existing infrastructure:** **Partial** — device-authenticated CRUD, persisted structured intent and provider policy eligibility exist; end-to-end scheduled discovery is not evidenced by these routes. [hunts.ts:15-18,66-89](../../routes/hunts.ts#L15)

## Top 10 gaps by user impact and safety

This is a **gap severity list, not a build order**. The
[roadmap](IMPLEMENTATION_ROADMAP.md) puts evaluation and low-cost repairs
before optional semantic infrastructure.

1. **Automotive fitment and OEM evidence:** text-matched vehicle/year/part numbers cannot certify fitment or originality. Require structured source-backed compatibility before claiming it. [searchOrchestrator.ts:432-449,533-540](../../connectors/searchOrchestrator.ts#L432-L449)
2. **Complete hard-constraint evidence:** strict price is a useful starting point, but unknown color, size, condition, delivery or city must not pass as verified; explain excluded/unknown results. [searchOrchestrator.ts:462-562,627-681](../../connectors/searchOrchestrator.ts#L462-L562)
3. **No-confident-match and provider-error distinction:** prevent weak products or unready feeds from masquerading as verified results/no-inventory. [visionHelpers.ts:182-205](../../routes/visionHelpers.ts#L182-L205) [searchOrchestrator.ts:683-728](../../connectors/searchOrchestrator.ts#L683-L728)
4. **Saudi dialect and exact identifiers:** expand measured local phrasing and protect model/SKU/MPN strings through lexical retrieval. [queryExpansion.ts:20-88,97-107](../../connectors/queryExpansion.ts#L20-L88) [intentParser.ts:241-397](../../connectors/intentParser.ts#L241-L397)
5. **Product identity and grouped seller offers:** conservative identity resolution must preserve distinct variant and offer records instead of merely dropping duplicates. [deduplicationService.ts:12-24](../../connectors/deduplicationService.ts#L12-L24)
6. **Authorized local/used and truthful source coverage:** registry membership is not live access; add only permitted sources and disclose true readiness, condition and locality evidence. [providerRegistry.ts:59-81](../../connectors/providerRegistry.ts#L59-L81) [adapters.ts:241-265](../../connectors/adapters.ts#L241-L265)
7. **Image-to-search quality:** the mobile camera already translates image understanding to a text query; test that end-to-end ranking and explicit user-text constraints remain correct, rather than treating endpoint success as product success. [camera.tsx:83-101](../../../../luqta-mobile/app/camera.tsx#L83-L101)
8. **Relevance-first ranking and result explanations:** users need relevant exact/alternative labels and evidence, not just internal scores. Do not boost affiliate offers for commission. [rankingService.ts:23-52](../../connectors/rankingService.ts#L23-L52) [search.ts:45-81](../../routes/search.ts#L45-L81)
9. **Query budgets, freshness and evaluation loop:** bound variant fan-out, measure cold/cache performance, and collect consented outcomes for offline evaluation before learning from behavior. [searchOrchestrator.ts:914-1016](../../connectors/searchOrchestrator.ts#L914-L1016)
10. **Semantic recall only after cheaper fixes:** no stable V2 lexical+vector branch is evidenced; assess a measurable semantic source only if dialect, exact-ID and provider coverage work leaves a real gap. [searchOrchestrator.ts:148-180](../../connectors/searchOrchestrator.ts#L148-L180)

## V3 experimental evidence — separate from stable V2

The remote experimental report supplied for this review is [QUERY_IMAGE_ONLY_RESULTS.md at commit `511f71dbd3002ef0752deb15c78732f908b368fe`](https://github.com/ttorkey01-cyber/luqta-app/blob/511f71dbd3002ef0752deb15c78732f908b368fe/artifacts/api-server/src/experiments/searchV3/benchmark30/QUERY_IMAGE_ONLY_RESULTS.md). It reports **V2 top-5: 10/26** versus **V3-local: 4/26** for that experiment. Its **C image unavailable** finding followed **three failed query-image calls**. These are remote benchmark observations, not a local rerun and not proof of stable V2 production behavior or V3 production behavior. Do not infer a root cause from those counts or infer a Gemini call count beyond what the report states.

## Cautions and audit boundaries

- Code presence is not proof that an integration is authorized, enabled in a deployment, has inventory, or has a particular number/quality of offers. Disabled adapters explicitly return no results; no supplier inventory quantity or cause is asserted here. [adapters.ts:17-28](../../connectors/adapters.ts#L17-L28)
- A quality threshold or `exactMatchScore` field is not benchmarked confidence; fixed rank weights and surface checks should not be represented as learned semantic relevance. [rankingService.ts:23-52](../../connectors/rankingService.ts#L23-L52)
- Image interpretation is a separate route with its own upstream request. The V3 benchmark’s failed image-call note is not evidence about a stable V2 Gemini call count, nor evidence that V3 has shipped.
- Saved-hunt CRUD and a “monitoring” state are not, by themselves, evidence that a scheduler made a provider check or found live results. [hunts.ts:27-42,116-154](../../routes/hunts.ts#L27-L42)
- The GREEN bar is intentionally strict. Operational safeguards and useful foundations exist, but code review alone cannot establish a gold-capability outcome without labeled end-to-end evaluation.