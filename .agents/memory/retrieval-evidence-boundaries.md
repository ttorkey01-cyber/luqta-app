---
name: Retrieval evidence boundaries
description: Why query-planning improvements deliberately leave unsupported discovery offer facts unknown.
---

Retrieval query planning is not product verification. Preserve unknown discovery prices and availability rather than extracting offer facts from incidental snippet numbers or search-budget wording.

**Why:** The approved retrieval upgrade prioritizes existing relevance and hard-price safety over apparent coverage. A query containing a SAR budget is not evidence that a discovered product has that SAR price, and a focused product-page query is not evidence that a specific size is available.

**How to apply:** Keep unknown-price web candidates excluded from hard budgets and unverified for soft budgets. Any future offer extraction requires explicit source evidence and separate safety tests; do not silently add page-fetching stages or verified identity claims as part of query planning.