import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const huntMonitorRuns = pgTable("hunt_monitor_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  status: text("status").notNull(),
  activeHuntCount: integer("active_hunt_count").notNull().default(0),
  uniqueQueryCount: integer("unique_query_count").notNull().default(0),
  policySkippedCount: integer("policy_skipped_count").notNull().default(0),
  resultCount: integer("result_count").notNull().default(0),
  notificationCount: integer("notification_count").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  errorMessage: text("error_message"),
});