---
name: Blind benchmark corrections
description: How to handle independently judged identity labels when their supposed identifier conflicts are invalid.
---

Do not silently replace a frozen blind benchmark's original labels or primary
score after observing engine results. If a second reviewer finds a categorical
adjudication error, preserve the original artifacts, independently re-adjudicate
the disputed evidence without showing engine output, and publish a separate
allowlisted sensitivity score alongside the primary one.

**Why:** Synthetic strings described as GTINs can be nonnumeric or fail check
digits. Treating them as authoritative conflicts makes correct rejection of
invalid identifiers appear to be a false merge or false EXACT. Retroactively
editing the label file would instead destroy the experiment's audit trail.

**How to apply:** In identity benchmarks, validate identifier format/check
digits as part of ground-truth review. When a disputed case surfaces only
after scoring, retain both scores and disclose the correction, its independent
provenance, and remaining coverage gaps. Do not interpret a perfect sensitivity
metric as validation if positive real-world examples are still missing.