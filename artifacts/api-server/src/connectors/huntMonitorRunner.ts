import { and, eq, gt, inArray, isNotNull, or, sql } from "drizzle-orm";
import {
  db,
  huntDevices,
  huntMonitorRuns,
  huntNotifications,
  huntSearchCache,
  savedHunts,
} from "@workspace/db";
import { HuntService } from "./huntService";
import { createDefaultProviderRegistry } from "./providerRegistry";
import { ResultNormalizer } from "./resultNormalizer";
import {
  evaluateHuntResults,
  huntNotificationResultKey,
  huntSearchCacheKey,
  intentForUnboundedSearch,
  type MonitorableHunt,
} from "./huntMonitoring";
import type {
  NormalizedProduct,
  ProviderProduct,
  QueryIntent,
  SearchProvider,
} from "./types";

const CACHE_TTL_MS = 15 * 60 * 1000;
const SEARCH_GROUP_CONCURRENCY = 3;
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const providerRegistry = createDefaultProviderRegistry({
  startBackgroundRefresh: false,
});
const huntService = new HuntService(providerRegistry);
const normalizer = new ResultNormalizer();

type RunStats = {
  status: "completed" | "blocked_by_provider_policy";
  activeHuntCount: number;
  uniqueQueryCount: number;
  policySkippedCount: number;
  resultCount: number;
  notificationCount: number;
};

type SearchGroup = {
  cacheKey: string;
  hunts: Array<typeof savedHunts.$inferSelect>;
  intent: QueryIntent;
};

function deduplicateProviderResults(
  products: NormalizedProduct[],
): NormalizedProduct[] {
  const seen = new Set<string>();
  return products.filter((product) => {
    const key = `${product.providerId}:${product.providerProductId || product.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  callback: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (cursor < items.length) {
        const item = items[cursor];
        cursor += 1;
        await callback(item);
      }
    },
  );
  await Promise.all(workers);
}

function providerSupportsMonitoring(provider: SearchProvider): boolean {
  return (
    provider.metadata.enabled &&
    provider.metadata.searchEnabled &&
    provider.metadata.priceMonitoringAllowed
  );
}

async function searchEligibleProviders(
  hunt: typeof savedHunts.$inferSelect,
  providerIds: string[],
): Promise<{ products: NormalizedProduct[]; successfulProviderIds: string[] }> {
  const intent = intentForUnboundedSearch(
    hunt.structuredIntent as QueryIntent,
  );
  const products: NormalizedProduct[] = [];
  const successfulProviderIds: string[] = [];

  await Promise.all(
    providerIds.map(async (providerId) => {
      const provider = providerRegistry.get(providerId);
      if (!provider || !providerSupportsMonitoring(provider)) return;
      try {
        const refreshable = provider as SearchProvider & {
          refreshIndex?: (force?: boolean) => Promise<number>;
        };
        if (refreshable.refreshIndex) {
          await refreshable.refreshIndex(false);
        }
        const rawProducts: ProviderProduct[] = await provider.search({
          query: intent.normalized || hunt.query,
          intent,
          searchMode: "intent",
          preferredProviderIds: [providerId],
        });
        successfulProviderIds.push(providerId);
        products.push(
          ...rawProducts.map((product) =>
            normalizer.normalize(product, provider.metadata),
          ),
        );
      } catch (error) {
        console.warn(
          JSON.stringify({
            event: "hunt_provider_search_failed",
            providerId,
            errorType: error instanceof Error ? error.name : "UnknownError",
          }),
        );
      }
    }),
  );

  return {
    products: deduplicateProviderResults(products),
    successfulProviderIds,
  };
}

async function getCachedOrSearch(
  group: SearchGroup,
  providerIds: string[],
): Promise<{
  products: NormalizedProduct[];
  cacheHit: boolean;
  sourceAvailable: boolean;
}> {
  const now = new Date();
  const [cached] = await db
    .select()
    .from(huntSearchCache)
    .where(
      and(
        eq(huntSearchCache.cacheKey, group.cacheKey),
        gt(huntSearchCache.expiresAt, now),
      ),
    )
    .limit(1);

  if (cached) {
    return {
      products: cached.results as NormalizedProduct[],
      cacheHit: true,
      sourceAvailable: cached.providerIds.length > 0,
    };
  }

  const representative = group.hunts[0];
  const searched = await searchEligibleProviders(representative, providerIds);
  if (searched.successfulProviderIds.length > 0) {
    const checkedAt = new Date();
    const cacheValues = {
      cacheKey: group.cacheKey,
      results: searched.products as unknown as Record<string, unknown>[],
      providerIds: searched.successfulProviderIds,
      checkedAt,
      expiresAt: new Date(checkedAt.getTime() + CACHE_TTL_MS),
    };
    await db
      .insert(huntSearchCache)
      .values(cacheValues)
      .onConflictDoUpdate({
        target: huntSearchCache.cacheKey,
        set: {
          results: cacheValues.results,
          providerIds: cacheValues.providerIds,
          checkedAt: cacheValues.checkedAt,
          expiresAt: cacheValues.expiresAt,
        },
      });
  }
  return {
    products: searched.products,
    cacheHit: false,
    sourceAvailable: searched.successfulProviderIds.length > 0,
  };
}

async function queueNotifications(
  hunt: typeof savedHunts.$inferSelect,
  candidates: NormalizedProduct[],
  device: typeof huntDevices.$inferSelect | undefined,
) {
  if (!device?.pushNotificationsEnabled || !device.expoPushToken) return 0;

  let insertedCount = 0;
  for (const product of candidates) {
    if (
      product.price == null ||
      !Number.isFinite(product.price) ||
      product.price < 0 ||
      product.currency?.toUpperCase() !== hunt.currency.toUpperCase()
    ) {
      continue;
    }
    const data: Record<string, string> = {
      huntId: hunt.id,
      query: hunt.originalQuery,
      resultId: product.id,
    };
    const destinationUrl = product.affiliateUrl || product.productUrl;
    if (destinationUrl) data.destinationUrl = destinationUrl;

    const [inserted] = await db
      .insert(huntNotifications)
      .values({
        deviceId: hunt.deviceId,
        huntId: hunt.id,
        resultKey: huntNotificationResultKey(product),
        price: product.price,
        currency: product.currency,
        payload: {
          title: "لقطة جديدة لطلبك",
          body: `${product.title} — ${product.price} ${hunt.currency}`,
          data,
        },
      })
      .onConflictDoNothing()
      .returning({ id: huntNotifications.id });
    if (inserted) insertedCount += 1;
  }
  return insertedCount;
}

type PushTicket = {
  status?: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
};

async function sendPendingNotifications(): Promise<void> {
  const messages = await db
    .select({
      id: huntNotifications.id,
      attempts: huntNotifications.attempts,
      payload: huntNotifications.payload,
      deviceId: huntDevices.id,
      expoPushToken: huntDevices.expoPushToken,
    })
    .from(huntNotifications)
    .innerJoin(
      huntDevices,
      eq(huntDevices.id, huntNotifications.deviceId),
    )
    .where(
      and(
        inArray(huntNotifications.status, ["pending", "failed"]),
        ltAttemptsUnderLimit(),
        eq(huntDevices.pushNotificationsEnabled, true),
        isNotNull(huntDevices.expoPushToken),
      ),
    );

  for (let offset = 0; offset < messages.length; offset += 100) {
    const batch = messages.slice(offset, offset + 100);
    const sendingAt = new Date();
    await Promise.all(
      batch.map((message) =>
        db
          .update(huntNotifications)
          .set({
            status: "sending",
            attempts: message.attempts + 1,
          })
          .where(eq(huntNotifications.id, message.id)),
      ),
    );

    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          batch.map((message) => ({
            to: message.expoPushToken,
            sound: "default",
            title: message.payload.title,
            body: message.payload.body,
            data: message.payload.data,
          })),
        ),
        signal: AbortSignal.timeout(12_000),
      });
      const payload = (await response.json()) as { data?: PushTicket[] };
      if (!response.ok || !Array.isArray(payload.data)) {
        throw new Error(`Expo push returned HTTP ${response.status}`);
      }

      await Promise.all(
        batch.map(async (message, index) => {
          const ticket = payload.data![index];
          if (ticket?.status === "ok") {
            await db
              .update(huntNotifications)
              .set({
                status: "sent",
                expoTicketId: ticket.id ?? null,
                sentAt: sendingAt,
                lastError: null,
              })
              .where(eq(huntNotifications.id, message.id));
            return;
          }

          const errorCode = ticket?.details?.error ?? "ExpoPushError";
          const errorMessage = (ticket?.message ?? errorCode).slice(0, 500);
          await db
            .update(huntNotifications)
            .set({ status: "failed", lastError: errorMessage })
            .where(eq(huntNotifications.id, message.id));
          if (errorCode === "DeviceNotRegistered") {
            await db
              .update(huntDevices)
              .set({
                expoPushToken: null,
                pushNotificationsEnabled: false,
              })
              .where(eq(huntDevices.id, message.deviceId));
          }
        }),
      );
    } catch (error) {
      const errorMessage = (
        error instanceof Error ? error.message : "Expo push request failed"
      ).slice(0, 500);
      await Promise.all(
        batch.map((message) =>
          db
            .update(huntNotifications)
            .set({ status: "failed", lastError: errorMessage })
            .where(eq(huntNotifications.id, message.id)),
        ),
      );
    }
  }
}

function ltAttemptsUnderLimit() {
  return sql`${huntNotifications.attempts} < 3`;
}

export async function runHuntMonitoring(): Promise<RunStats> {
  const [run] = await db
    .insert(huntMonitorRuns)
    .values({ status: "running" })
    .returning({ id: huntMonitorRuns.id });

  try {
    const activeHunts = await db
      .select()
      .from(savedHunts)
      .where(eq(savedHunts.status, "active"))
      .orderBy(savedHunts.createdAt);
    const providerIds = huntService.eligibleProviderIds({});
    if (providerIds.length === 0) {
      const stats: RunStats = {
        status: "blocked_by_provider_policy",
        activeHuntCount: activeHunts.length,
        uniqueQueryCount: 0,
        policySkippedCount: activeHunts.length,
        resultCount: 0,
        notificationCount: 0,
      };
      await db
        .update(huntMonitorRuns)
        .set({ ...stats, completedAt: new Date() })
        .where(eq(huntMonitorRuns.id, run.id));
      return stats;
    }

    const groupsByKey = new Map<string, SearchGroup>();
    for (const hunt of activeHunts) {
      const intent = hunt.structuredIntent as QueryIntent;
      const cacheKey = huntSearchCacheKey(intent, providerIds);
      const group = groupsByKey.get(cacheKey);
      if (group) group.hunts.push(hunt);
      else groupsByKey.set(cacheKey, { cacheKey, hunts: [hunt], intent });
    }
    const groups = [...groupsByKey.values()];
    const devices = await db
      .select()
      .from(huntDevices)
      .where(
        inArray(
          huntDevices.id,
          [...new Set(activeHunts.map((hunt) => hunt.deviceId))],
        ),
      );
    const devicesById = new Map(devices.map((device) => [device.id, device]));
    let resultCount = 0;
    let notificationCount = 0;

    await mapWithConcurrency(groups, SEARCH_GROUP_CONCURRENCY, async (group) => {
      const search = await getCachedOrSearch(group, providerIds);
      if (!search.sourceAvailable) return;
      resultCount += search.products.length;
      const checkedAt = new Date();

      for (const hunt of group.hunts) {
        const monitorable: MonitorableHunt = {
          id: hunt.id,
          query: hunt.query,
          originalQuery: hunt.originalQuery,
          structuredIntent: hunt.structuredIntent as QueryIntent,
          targetPrice: hunt.targetPrice,
          currency: hunt.currency,
          condition: hunt.condition as "any" | "new" | "used",
        };
        const evaluation = evaluateHuntResults(monitorable, search.products);
        await db
          .update(savedHunts)
          .set({
            matchStatus: evaluation.matchStatus,
            bestMatchId: evaluation.bestMatch?.id ?? null,
            bestMatchTitle: evaluation.bestMatch?.title ?? null,
            bestPrice: evaluation.bestMatch?.price ?? null,
            discoveryMatches: evaluation.discoveryMatches,
            lastCheckedAt: checkedAt,
            updatedAt: checkedAt,
          })
          .where(
            and(eq(savedHunts.deviceId, hunt.deviceId), eq(savedHunts.id, hunt.id)),
          );
        notificationCount += await queueNotifications(
          hunt,
          evaluation.notificationCandidates,
          devicesById.get(hunt.deviceId),
        );
      }
    });

    await sendPendingNotifications();
    const stats: RunStats = {
      status: "completed",
      activeHuntCount: activeHunts.length,
      uniqueQueryCount: groups.length,
      policySkippedCount: 0,
      resultCount,
      notificationCount,
    };
    await db
      .update(huntMonitorRuns)
      .set({ ...stats, completedAt: new Date() })
      .where(eq(huntMonitorRuns.id, run.id));
    return stats;
  } catch (error) {
    await db
      .update(huntMonitorRuns)
      .set({
        status: "failed",
        completedAt: new Date(),
        errorMessage:
          error instanceof Error ? error.message.slice(0, 1000) : "Unknown error",
      })
      .where(eq(huntMonitorRuns.id, run.id));
    throw error;
  }
}