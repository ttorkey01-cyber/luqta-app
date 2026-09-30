# LUQTA Permanent Search Scorecard

Status: proposed permanent evaluation contract. Apply this scorecard to frozen, authorized snapshots; it does not claim current system performance.

Related case definitions and evidence protocol: [ACCEPTANCE_TESTS.md](./ACCEPTANCE_TESTS.md).

## Evaluation contract

Before implementation/evaluation, freeze and version the authorized catalog and offer snapshots, source timestamps, query set, gold labels, and image permissions. Image cases use user-licensed test photos or images with documented evaluation rights; merchant images without rights are prohibited. Record an immutable fixture manifest and preserve source provenance. Do not fabricate product facts or use unsupported fields as gold evidence. A missing/ambiguous field is labeled unknown or ambiguous.

Report each metric with numerator, denominator, sample size, and 95% confidence interval, overall and for required slices: Arabic/Saudi dialect, English/mixed-language, text-only, image-only, image+text, strict-constraint, exact-identity, close alternatives, no-match, used/local, and automotive. Report slice results even when too small for a stable threshold; mark as insufficient sample rather than hiding them. Maintain the same frozen regression set across releases and add newly adjudicated cases without replacing difficult examples.

### Metric definitions and denominators

| Metric (14 required) | Definition and denominator |
|---|---|
| 1. Precision@1 | Relevant top result / 1 for each evaluated query, averaged over all applicable queries. A missing result is non-relevant. Report exact-identity and broad relevance views separately. |
| 2. Precision@3 | Gold-relevant results among first three slots / 3, averaged across applicable queries; empty slots count non-relevant. Report exact and close relevance separately. |
| 3. Recall@5 / Success@5 | **Success@5** = answerable queries with at least one gold-relevant result in top 5 / all answerable queries; measures discovery, not completeness. **Recall@5** = unique relevant identities retrieved in top 5 / all relevant identities in that fixture, calculated only when gold inventory labels are exhaustive. Non-exhaustive cases are N/A for recall; never call Success@5 “recall.” |
| 4. Exact-product identification | Exact identity correctly identified at rank 1 / queries whose gold intent requires an exact product and for which an exact item exists. Report exact vs close classification confusion; close results must never count as exact. |
| 5. Hard-constraint compliance | **Result-level:** results presented as satisfying a hard constraint that satisfy every explicit hard constraint / all results presented as qualifying on constrained queries. **Query-level:** constrained queries whose every qualifying result satisfies all constraints / all constrained queries. Unknown evidence is not compliant. |
| 6. Irrelevant-result rate | Results judged irrelevant in top 5 / all returned results in top 5; additionally report query-level rate with at least one irrelevant top-5 item / queries with a returned result. Empty result queries are not included in result-level denominator and are separately scored for no-match/abstention. |
| 7. False-exact-match rate | Results or explanations asserting “same/exact” without matching gold identity evidence / all results or explanations asserting exact identity. Close/similar is not exact. |
| 8. Correct no-match rate | Gold no-match cases correctly abstained / all gold no-match cases. Report false-abstention separately: answerable cases incorrectly abstained / all answerable cases. Distinguish verified empty inventory from retrieval failure. |
| 9. Arabic intent accuracy | Arabic-containing queries whose structured intent exactly matches gold for requested item/category, attributes, constraints, locality, condition, and ambiguity flags / Arabic-containing queries with complete gold intent labels. Report Saudi dialect and Arabic-English mixed slices. |
| 10. Image understanding accuracy | Image cases with correct gold identity and evaluated attributes / all image-only and image+text cases with adjudicated, evaluable visual gold labels. Report identity and attribute accuracy separately, and safe abstention on genuinely ambiguous/unsupported cases separately. |
| 11. Automotive evidence safety | Unsupported or incorrect fitment/OEM/original assertions / all automotive results or explanations making such assertions. Also count critical unsupported assertions as an absolute error count; show rates by fitment, OEM status, vehicle configuration, and headlamp-vs-spark-plug ambiguity. |
| 12. Duplicate-offer rate | Duplicate returned offer records after canonical grouping / all returned offers. Distinct merchants/offers for one product are not duplicates; repeated copies of the same offer are. |
| 13. Median latency (p50) | Median end-to-end server latency from accepted request to results/abstention. Report cached and cold paths separately, plus timeout/error rate. |
| 14. p95 latency | 95th percentile of the same end-to-end measure; report cached and cold paths separately, plus timeout/error rate. |

**Exact vs close reporting:** In addition to metrics above, publish a confusion table over exact-intent cases: exact correctly labeled, close incorrectly labeled exact (false exact), close correctly labeled similar, and no exact match correctly abstained. A close result may count as relevant for broad Precision/Success only where its gold label says it is relevant; it never counts as an exact-product success.

**Latency measurement:** Record sample count and load profile. “Cached” means a documented warm-cache repeat with the same query and data snapshot; “cold” means a cleared relevant cache and a fresh request against the same snapshot. Do not mix the populations into one percentile. Measure on the intended MVP deployment class, excluding client rendering but including query interpretation, retrieval, ranking, and no-match decision. Report p50, p95, timeouts, and errors for both paths.

## Thresholds

MVP floors are minimum release quality, not promises about present performance. World-class targets are aspirational sustained goals for LUQTA’s scale, measured on representative evidence-backed fixtures. All thresholds are applied to full-set metrics and reviewed on required slices; where sample size is inadequate, report the uncertainty and do not claim attainment.

| Metric | MVP floor | World-class target |
|---|---:|---:|
| Precision@1, broad relevance | ≥0.70 | ≥0.90 |
| Precision@3, broad relevance | ≥0.60 | ≥0.82 |
| Success@5, answerable queries | ≥0.75 | ≥0.94 |
| Recall@5, exhaustive-gold subset only | ≥0.60 | ≥0.88 |
| Exact-product identification at rank 1 | ≥0.80 | ≥0.96 |
| Hard-constraint query-level compliance | ≥0.97 | ≥0.995 |
| Irrelevant-result rate in returned top 5 | ≤0.20 | ≤0.08 |
| False-exact-match rate | ≤0.5% | ≤0.1% |
| Correct no-match rate | ≥0.90 | ≥0.98 |
| Arabic intent accuracy | ≥0.82 | ≥0.95 |
| Image understanding accuracy (evaluable cases) | ≥0.75 | ≥0.91 |
| Automotive evidence safety | **0 unsupported/incorrect fitment or OEM assertions** | **0 unsupported/incorrect fitment or OEM assertions** |
| Duplicate-offer rate | ≤5% | ≤1% |
| Latency p50 / p95, cached | ≤2s / ≤5s | ≤1s / ≤2.5s |
| Latency p50 / p95, cold | ≤4s / ≤10s | ≤2.5s / ≤6s |

The latency row gives paired thresholds for the scorecard’s two latency measures (p50 and p95), each measured separately for cached and cold paths. No latency result is valid without its sample count, timeout/error rate, and load profile.

## Release gates

1. **Safety gates, all releases:** zero unsupported or incorrect automotive fitment/OEM/original assertions; zero fabricated product, price, availability, location, image, or source facts. A single critical violation blocks release regardless of aggregate score.
2. **Constraint gate:** meet the MVP hard-constraint floor, with no known systematic relaxation of explicit price, color, size, condition, location, or fitment constraints. Unknown evidence cannot be treated as compliant.
3. **Identity/no-match gate:** meet MVP false-exact and correct-no-match floors. Retrieval failures must not be mislabeled as verified no-match.
4. **Quality/performance gate:** report all 14 metrics, confidence intervals, sample sizes, and required slices. Do not declare a threshold passed where its denominator is missing or the gold labels are not fit for that metric.
5. **Image evidence gate:** only authorized images may be evaluated; unsupported visual details must trigger uncertainty/clarification, not confident claims.
6. **Cost scope:** this scorecard requires no external paid service. Use frozen authorized evaluation data and existing evaluation infrastructure; any future proposal for a paid dependency requires separate approval and is not implied here.
