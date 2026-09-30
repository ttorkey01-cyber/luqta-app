# Product identity benchmark preparation

This is an independent, pre-tuning evidence corpus. It was assembled without invoking or evaluating the product-identity engine; it contains no expected classifications or ground-truth labels. A separate blind adjudicator should label it.

## Corpus summary

- Schema version: 1
- Total pairs: 136
- REAL_OBSERVED: 24 pairs, drawn from sanitized observed candidate evidence only.
- CONTROLLED: 96 synthetic pairs; identifiers in these controls are explicitly synthetic, not real product identifiers.
- UNVERIFIABLE: 16 pairs with deliberately sparse, non-attributable listing evidence.

| Category | Pair count |
|---|---:|
| observed-candidate-comparison | 24 |
| same-product-same-variant | 8 |
| same-product-different-color | 8 |
| same-product-different-size | 8 |
| same-product-different-storage | 8 |
| different-model-same-family | 8 |
| style-code-gtin-conflict | 8 |
| nike-model-and-variant | 8 |
| electronics-model-variant-and-bundle | 8 |
| beauty-volume-and-pack | 8 |
| automotive-oem-part-and-fitment | 8 |
| merchant-duplicates-and-stale-offers | 8 |
| insufficient-evidence | 8 |
| insufficient-evidence-unverifiable | 16 |

Coverage includes same-variant duplicates; color, size, storage, beauty-volume and multipack variation; sibling models in the same family; style-code/GTIN conflicts; Nike; consumer electronics; automotive OEM/fitment; merchant duplicates and stale offers; and insufficient/unverifiable evidence. REAL_OBSERVED provenance is recorded per pair using case IDs, candidate IDs, and observed title/provider evidence. URLs and imagery are excluded. No observed identifiers were inferred or added. Controlled examples and their synthetic identifiers are explicitly distinguished by sourceClass.

## Cases fingerprint

SHA-256 of the complete UTF-8 `pairs.json` file (including its final newline):

```text
41f8584c9a517f1a765127546353353fe6ff97ff31925f2d8c22287a63f475af
```
