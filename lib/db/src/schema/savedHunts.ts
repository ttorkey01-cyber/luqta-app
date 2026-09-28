import {
  index,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { huntDevices } from "./huntDevices";

export type StoredHuntIntent = Record<string, unknown>;
export type StoredHuntDiscovery = Record<string, unknown>;

export const savedHunts = pgTable(
  "saved_hunts",
  {
    id: text("id").notNull(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => huntDevices.id, { onDelete: "cascade" }),
    query: text("query").notNull(),
    originalQuery: text("original_query").notNull(),
    normalizedIntent: text("normalized_intent").notNull(),
    structuredIntent: jsonb("structured_intent")
      .$type<StoredHuntIntent>()
      .notNull(),
    targetPrice: numeric("target_price", {
      precision: 12,
      scale: 2,
      mode: "number",
    }),
    currency: text("currency").notNull().default("SAR"),
    condition: text("condition").notNull().default("any"),
    status: text("status").notNull().default("active"),
    matchStatus: text("match_status"),
    bestMatchId: text("best_match_id"),
    bestMatchTitle: text("best_match_title"),
    bestPrice: numeric("best_price", {
      precision: 12,
      scale: 2,
      mode: "number",
    }),
    discoveryMatches: jsonb("discovery_matches")
      .$type<StoredHuntDiscovery[]>()
      .notNull()
      .default([]),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.deviceId, table.id] }),
    index("saved_hunts_active_idx").on(table.status, table.updatedAt),
    index("saved_hunts_device_created_idx").on(table.deviceId, table.createdAt),
  ],
);