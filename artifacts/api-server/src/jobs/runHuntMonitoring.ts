import { pool } from "@workspace/db";
import { runHuntMonitoring } from "../connectors/huntMonitorRunner";

try {
  const result = await runHuntMonitoring();
  console.log(JSON.stringify({ event: "hunt_monitoring_run_complete", ...result }));
} catch (error) {
  console.error(
    JSON.stringify({
      event: "hunt_monitoring_run_failed",
      error: error instanceof Error ? error.message : "Unknown error",
    }),
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}