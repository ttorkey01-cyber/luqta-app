---
name: Live evaluation label reuse
description: Evidence-drift boundary for reusing independent judgments across live search replays.
---

Reuse an independent candidate judgment across live runs only when both its case/opaque candidate identity **and the source-visible evidence relevant to that judgment** still match. Changed title, variant, price, currency, condition, stock/availability or freshness calls for new arm-blinded judgment. An unchanged ID does not prove unchanged offer facts.

**Why:** A live feed's indexed inventory and offer details can shift within minutes while the normalized product keeps the same opaque identity. Reusing an old hard-constraint verdict would make a later run look verified from stale evidence. Conversely, labeling a newly found inventory case as historically comparable can hide real denominator drift.

**How to apply:** Keep prior and current observations immutable, compare safe evidence before carrying judgments forward, and distinguish inventory newly found from an established historical no-match. Score each observed arm pair using its own independently supported found-inventory denominator; report cross-run drift separately.