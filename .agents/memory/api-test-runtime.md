---
name: API test runtime
description: Why the TypeScript API tests should use the project's tsx runner instead of native Node type stripping.
---

Run the API package's test command through `tsx`, even if the installed Node version can strip TypeScript syntax.

**Why:** Native Node type stripping does not resolve this project's extensionless ESM TypeScript imports in the test harness. `tsx` handles those imports without requiring a source or toolchain migration.

**How to apply:** Use the API package's existing test script for the full suite, or `pnpm --filter @workspace/api-server exec tsx --test <test files>` for focused local fixtures.