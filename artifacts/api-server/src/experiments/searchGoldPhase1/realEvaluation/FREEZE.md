# Real-source evaluation preregistration

Frozen **before the first live search result was inspected**, 2026-09-30 08:52 UTC.

- Frozen Phase 1B implementation GitHub commit: `b20cb956287485dd57d421fef92935c12e29269b` on `experiment/search-gold-phase1`.
- Query and judgment registration: `cases.json`, 40 cases in nine predefined groups. SHA-256: `4359419400333f3a2831cc30efe65c9be4bea90cf19732b3e4e51dceb6a895f8`.
- SHA-256 of the sorted-by-this-list `sha256sum` output for Phase 1B parser, planner, evaluator, wrapper, followed by V2 orchestrator, provider registry, intent parser, query expansion, ranking service and Brave adapter: `185c7de62040c06516983028a7d4807cfb7411efd95e8ddbbda9f62becc41450`.
- No observed shopper traffic is represented by these 40 authored queries. Actual product/offer observations, if returned, will come from the currently authorized live sources at execution time.
- Source availability, web fallback and external-call counts must be recorded during execution. No search behavior or pre-registered definitions may be changed after this point; any discovered harness flaw must be reported, not hidden.
- Frozen controlled-fixture files, production V2, GitHub main, production deployments, OTA, builds and billing remain out of scope.