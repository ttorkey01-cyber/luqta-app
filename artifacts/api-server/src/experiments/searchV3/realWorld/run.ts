/**
 * Offline status/export entry point:
 *   pnpm --dir artifacts/api-server exec tsx src/experiments/searchV3/realWorld/run.ts
 *
 * The default run intentionally reports unavailable retrieval metrics. Real
 * paired runs are started by importing runRealWorldBenchmark() and injecting
 * V2/local-V3 adapters, an optional explicitly configured Gemini-V3 adapter,
 * and one shared candidate catalog; this command never makes network or
 * paid-provider calls.
 */
import { renderRealWorldReportJson, unavailableRealWorldReport } from "./benchmark";

process.stdout.write(renderRealWorldReportJson(unavailableRealWorldReport()));