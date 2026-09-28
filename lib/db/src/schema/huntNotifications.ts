import {
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { savedHunts } from "./savedHunts";

export type HuntPushPayload = {
  title: string;
  body: string;
  data: Record<string, string>;
};

export const huntNotifications = pgTable(
  "hunt_notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deviceId: uuid("device_id").notNull(),
    huntId: text("hunt_id").notNull(),
    resultKey: text("result_key").notNull(),
    payload: jsonb("payload").$type<HuntPushPayload>().notNull(),
    price: numeric("price", { precision: 12, scale: 2, mode: "number" }),
    currency: text("currency"),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    expoTicketId: text("expo_ticket_id"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.deviceId, table.huntId],
      foreignColumns: [savedHunts.deviceId, savedHunts.id],
      name: "hunt_notifications_saved_hunt_fk",
    }).onDelete("cascade"),
    uniqueIndex("hunt_notifications_dedupe_idx").on(
      table.deviceId,
      table.huntId,
      table.resultKey,
    ),
    index("hunt_notifications_pending_idx").on(table.status, table.createdAt),
  ],
);