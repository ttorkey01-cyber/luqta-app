import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const huntDevices = pgTable("hunt_devices", {
  id: uuid("id").defaultRandom().primaryKey(),
  accessTokenHash: text("access_token_hash").notNull().unique(),
  platform: text("platform").notNull(),
  expoPushToken: text("expo_push_token").unique(),
  pushNotificationsEnabled: boolean("push_notifications_enabled")
    .notNull()
    .default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});