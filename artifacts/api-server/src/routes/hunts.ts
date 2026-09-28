import { and, desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateSavedHuntBody,
  CreateSavedHuntResponse,
  DeleteSavedHuntParams,
  ListSavedHuntsResponse,
  UpdateSavedHuntBody,
  UpdateSavedHuntParams,
  UpdateSavedHuntResponse,
  UpsertSavedHuntBody,
  UpsertSavedHuntParams,
  UpsertSavedHuntResponse,
} from "@workspace/api-zod";
import { db, savedHunts } from "@workspace/db";
import { deterministicIntentParser, huntService } from "../connectors";
import type { QueryIntent } from "../connectors/types";
import { requireHuntDevice } from "./huntDeviceAuth";

const router: IRouter = Router();
const MONITORING_FRESHNESS_MS = 24 * 60 * 60 * 1000;

type HuntInput = ReturnType<typeof CreateSavedHuntBody.parse>;
type HuntPatch = ReturnType<typeof UpdateSavedHuntBody.parse>;
type StoredHunt = typeof savedHunts.$inferSelect;

function getMonitoringState(
  hunt: StoredHunt,
  monitoringProviderCount: number,
  now = Date.now(),
): "active" | "inactive" | "paused" | "blocked_by_provider_policy" {
  if (hunt.status === "paused") return "paused";
  if (hunt.status !== "active") return "inactive";
  if (monitoringProviderCount === 0) return "blocked_by_provider_policy";
  if (
    hunt.lastCheckedAt &&
    now - hunt.lastCheckedAt.getTime() <= MONITORING_FRESHNESS_MS
  ) {
    return "active";
  }
  return "inactive";
}

function serializeHunt(hunt: StoredHunt, monitoringProviderCount: number) {
  return {
    id: hunt.id,
    query: hunt.query,
    originalQuery: hunt.originalQuery,
    normalizedIntent: hunt.normalizedIntent,
    structuredIntent: hunt.structuredIntent as QueryIntent,
    targetPrice: hunt.targetPrice,
    currency: hunt.currency,
    condition: hunt.condition as "any" | "new" | "used",
    createdAt: hunt.createdAt.toISOString(),
    status: hunt.status as "active" | "paused" | "completed",
    matchStatus: hunt.matchStatus ?? undefined,
    bestMatchId: hunt.bestMatchId,
    bestMatchTitle: hunt.bestMatchTitle,
    bestPrice: hunt.bestPrice,
    discoveryMatches: hunt.discoveryMatches,
    lastCheckedAt: hunt.lastCheckedAt?.toISOString() ?? null,
    monitoringState: getMonitoringState(hunt, monitoringProviderCount),
  };
}

async function saveHunt(deviceId: string, input: HuntInput) {
  const structuredIntent =
    (input.structuredIntent as QueryIntent | undefined) ??
    (await deterministicIntentParser.parse(input.originalQuery || input.query));
  const targetPrice = input.targetPrice ?? structuredIntent.maxPrice ?? null;
  const values = {
    deviceId,
    id: input.id,
    query: input.query,
    originalQuery: input.originalQuery,
    normalizedIntent: input.normalizedIntent,
    structuredIntent,
    targetPrice,
    currency: input.currency,
    condition: input.condition,
    status: input.status,
    matchStatus: input.matchStatus ?? null,
    bestMatchId: input.bestMatchId ?? null,
    bestMatchTitle: input.bestMatchTitle ?? null,
    bestPrice: input.bestPrice ?? null,
    discoveryMatches: input.discoveryMatches ?? [],
    createdAt: new Date(input.createdAt),
    updatedAt: new Date(),
  };
  const [saved] = await db
    .insert(savedHunts)
    .values(values)
    .onConflictDoUpdate({
      target: [savedHunts.deviceId, savedHunts.id],
      set: {
        query: values.query,
        originalQuery: values.originalQuery,
        normalizedIntent: values.normalizedIntent,
        structuredIntent: values.structuredIntent,
        targetPrice: values.targetPrice,
        currency: values.currency,
        condition: values.condition,
        status: values.status,
        matchStatus: values.matchStatus,
        bestMatchId: values.bestMatchId,
        bestMatchTitle: values.bestMatchTitle,
        bestPrice: values.bestPrice,
        discoveryMatches: values.discoveryMatches,
        updatedAt: values.updatedAt,
      },
    })
    .returning();
  return saved;
}

router.get("/hunts", requireHuntDevice, async (req, res, next) => {
  try {
    const device = req.huntDevice!;
    const rows = await db
      .select()
      .from(savedHunts)
      .where(eq(savedHunts.deviceId, device.id))
      .orderBy(desc(savedHunts.createdAt));
    const monitoringProviderCount = huntService.eligibleProviderIds({}).length;
    res.json(
      ListSavedHuntsResponse.parse({
        hunts: rows.map((hunt) =>
          serializeHunt(hunt, monitoringProviderCount),
        ),
        pushNotificationsEnabled: device.pushNotificationsEnabled,
        monitoringProviderCount,
      }),
    );
  } catch (error) {
    next(error);
  }
});

router.post("/hunts", requireHuntDevice, async (req, res, next) => {
  try {
    const input = CreateSavedHuntBody.parse(req.body);
    const saved = await saveHunt(req.huntDevice!.id, input);
    const monitoringProviderCount = huntService.eligibleProviderIds({}).length;
    res.status(201).json(
      CreateSavedHuntResponse.parse(
        serializeHunt(saved, monitoringProviderCount),
      ),
    );
  } catch (error) {
    next(error);
  }
});

router.put("/hunts/:huntId", requireHuntDevice, async (req, res, next) => {
  try {
    const { huntId } = UpsertSavedHuntParams.parse(req.params);
    const input = UpsertSavedHuntBody.parse(req.body);
    if (input.id !== huntId) {
      res.status(400).json({ error: "The Hunt ID does not match the URL" });
      return;
    }
    const saved = await saveHunt(req.huntDevice!.id, input as HuntInput);
    const monitoringProviderCount = huntService.eligibleProviderIds({}).length;
    res.json(
      UpsertSavedHuntResponse.parse(
        serializeHunt(saved, monitoringProviderCount),
      ),
    );
  } catch (error) {
    next(error);
  }
});

router.patch("/hunts/:huntId", requireHuntDevice, async (req, res, next) => {
  try {
    const { huntId } = UpdateSavedHuntParams.parse(req.params);
    const patch = UpdateSavedHuntBody.parse(req.body) as HuntPatch;
    const deviceId = req.huntDevice!.id;
    const [current] = await db
      .select()
      .from(savedHunts)
      .where(
        and(
          eq(savedHunts.deviceId, deviceId),
          eq(savedHunts.id, huntId),
        ),
      )
      .limit(1);
    if (!current) {
      res.status(404).json({ error: "Hunt not found" });
      return;
    }

    const queryChanged =
      patch.query !== undefined &&
      patch.query !== current.query;
    const structuredIntent =
      (patch.structuredIntent as QueryIntent | undefined) ??
      (queryChanged
        ? await deterministicIntentParser.parse(
            patch.originalQuery ?? patch.query!,
          )
        : (current.structuredIntent as QueryIntent));
    const targetPrice = Object.prototype.hasOwnProperty.call(
      patch,
      "targetPrice",
    )
      ? (patch.targetPrice ?? null)
      : queryChanged
        ? (structuredIntent.maxPrice ?? null)
        : current.targetPrice;
    const updatedValues = {
      query: patch.query ?? current.query,
      originalQuery: patch.originalQuery ?? (queryChanged ? patch.query! : current.originalQuery),
      normalizedIntent:
        patch.normalizedIntent ??
        (queryChanged
          ? structuredIntent.normalized ?? patch.query!
          : current.normalizedIntent),
      structuredIntent,
      targetPrice,
      currency: patch.currency ?? current.currency,
      condition: patch.condition ?? current.condition,
      status: patch.status ?? current.status,
      updatedAt: new Date(),
      ...(queryChanged
        ? {
            matchStatus: null,
            bestMatchId: null,
            bestMatchTitle: null,
            bestPrice: null,
            discoveryMatches: [],
            lastCheckedAt: null,
          }
        : {}),
    };
    const [saved] = await db
      .update(savedHunts)
      .set(updatedValues)
      .where(
        and(
          eq(savedHunts.deviceId, deviceId),
          eq(savedHunts.id, huntId),
        ),
      )
      .returning();
    const monitoringProviderCount = huntService.eligibleProviderIds({}).length;
    res.json(
      UpdateSavedHuntResponse.parse(
        serializeHunt(saved, monitoringProviderCount),
      ),
    );
  } catch (error) {
    next(error);
  }
});

router.delete("/hunts/:huntId", requireHuntDevice, async (req, res, next) => {
  try {
    const { huntId } = DeleteSavedHuntParams.parse(req.params);
    await db
      .delete(savedHunts)
      .where(
        and(
          eq(savedHunts.deviceId, req.huntDevice!.id),
          eq(savedHunts.id, huntId),
        ),
      );
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;