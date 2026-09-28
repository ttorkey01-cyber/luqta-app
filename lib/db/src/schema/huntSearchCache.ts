import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export type CachedHuntSearchResult = Record<string, unknown>;

export const huntSearchCache = pgTable(
  "hunt_search_cache",
  {
    cacheKey: text("cache_key").primaryKey(),
    results: jsonb("results")
      .$type<CachedHuntSearchResult[]>()
      .notNull(),
    providerIds: text("provider_ids").array().notNull().default([]),
    checkedAt: timestamp("checked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("hunt_search_cache_expiry_idx").on(table.expiresAt)],
);