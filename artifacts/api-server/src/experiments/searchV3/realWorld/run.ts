/**
 * Offline status/export entry point:
 *   pnpm --dir artifacts/api-server exec tsx src/experiments/searchV3/realWorld/run.ts
 *
 * The default run intentionally reports unavailable retrieval metrics. Real
 * paired runs are started by importing runRealWorldBenchmark() and injecting
 * existing V2/V3 adapters plus one shared candidate catalog; this command
 * never makes network or paid-provider calls.
 */
import { renderRealWorldReportJson, unavailableRealWorldReport } from "./benchmark";

process.stdout.write(renderRealWorldReportJson(unavailableRealWorldReport()));