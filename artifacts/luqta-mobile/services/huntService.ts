import AsyncStorage from '@react-native-async-storage/async-storage';
import { searchService } from './searchService';
import type { SearchResults } from './searchService';
import { buildHuntDiscoveryMatches, type HuntDiscoveryMatch } from './huntDiscovery';
import { deleteSavedHunt, disableHuntPushToken, getHuntDevice, listSavedHunts, registerHuntPushToken, updateSavedHunt, upsertSavedHunt, type HuntPatchRequest, type HuntUpsertRequest, type SavedHunt } from '@workspace/api-client-react';
import { devicePlatform, ensureDeviceIdentity } from './deviceIdentity';

const HUNTS_KEY = '@luqta/hunts';
const QUEUE_KEY = '@luqta/hunt-sync-queue';
type QueueItem = { kind: 'upsert'; hunt: Hunt } | { kind: 'patch'; id: string; patch: Partial<Hunt> } | { kind: 'delete'; id: string };

function upsertPayload(hunt: Hunt): HuntUpsertRequest {
  const { imageUri: _imageUri, lastCheckedAt: _checked, monitoringState: _monitoring, ...payload } = hunt;
  return payload as HuntUpsertRequest;
}
function patchPayload(updates: Partial<Hunt>): HuntPatchRequest {
  const { imageUri: _imageUri, id: _id, createdAt: _created, lastCheckedAt: _checked, monitoringState: _monitoring, ...patch } = updates;
  return patch as HuntPatchRequest;
}

export type HuntStatus = 'active' | 'paused' | 'completed';
export type HuntMatchStatus =
  | 'matched'
  | 'no_reliable_match'
  | 'no_verified_price'
  | 'search_unavailable';

export type Hunt = {
  id: string;
  query: string;
  originalQuery: string;
  normalizedIntent: string;
  structuredIntent?: SearchResults['structuredIntent'];
  imageUri?: string;
  targetPrice?: number;
  currency: 'SAR';
  condition?: 'any' | 'new' | 'used';
  createdAt: string;
  status: HuntStatus;
  matchStatus?: HuntMatchStatus;
  bestMatchId?: string;
  bestMatchTitle?: string;
  bestPrice?: number;
  discoveryMatches?: HuntDiscoveryMatch[];
  lastCheckedAt?: string | null;
  monitoringState?: SavedHunt['monitoringState'];
};

export type CreateHuntInput = Omit<
  Hunt,
  'id' | 'bestMatchId' | 'bestMatchTitle' | 'bestPrice' | 'discoveryMatches'
>;

export interface HuntService {
  create(input: CreateHuntInput): Promise<Hunt>;
  list(): Promise<Hunt[]>;
  update(id: string, updates: Partial<Hunt>): Promise<Hunt>;
  remove(id: string): Promise<void>;
  checkMatches(hunt: Hunt): Promise<Hunt>;
  notificationStatus(): Promise<boolean>;
  enableNotifications(expoPushToken: string): Promise<boolean>;
  disableNotifications(): Promise<boolean>;
}

class LocalHuntService implements HuntService {
  async list(): Promise<Hunt[]> {
    const stored = await AsyncStorage.getItem(HUNTS_KEY);
    try {
      const local = stored ? JSON.parse(stored) as Hunt[] : [];
      await this.flush();
      try {
        await ensureDeviceIdentity();
        const remote = await listSavedHunts();
        const queue = await this.queue();
        const pending = new Set(queue.map(item => item.kind === 'upsert' ? item.hunt.id : item.id));
        const remoteHunts: Hunt[] = remote.hunts
          .filter(hunt => !pending.has(hunt.id))
          .map(hunt => ({
            ...hunt,
            imageUri: local.find(existing => existing.id === hunt.id)?.imageUri,
            targetPrice: hunt.targetPrice ?? undefined,
            bestMatchId: hunt.bestMatchId ?? undefined,
            bestMatchTitle: hunt.bestMatchTitle ?? undefined,
            bestPrice: hunt.bestPrice ?? undefined,
          }));
        const merged = [...local.filter(hunt => pending.has(hunt.id)), ...remoteHunts];
        await this.save(merged);
        return merged;
      } catch {
        return local;
      }
    } catch {
      return [];
    }
  }

  async create(input: CreateHuntInput): Promise<Hunt> {
    const next: Hunt = {
      ...input,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    };
    const checked = await this.checkMatches(next);
    const current = await this.list();
    await AsyncStorage.setItem(HUNTS_KEY, JSON.stringify([checked, ...current]));
    await this.enqueue({ kind: 'upsert', hunt: checked });
    return checked;
  }

  async update(id: string, updates: Partial<Hunt>): Promise<Hunt> {
    const current = await this.list();
    const index = current.findIndex(h => h.id === id);
    if (index === -1) throw new Error('Hunt not found');

    const updated = { ...current[index], ...updates };
    current[index] = updated;
    await AsyncStorage.setItem(HUNTS_KEY, JSON.stringify(current));
    await this.enqueue({ kind: 'patch', id, patch: updates });
    return updated;
  }

  async remove(id: string): Promise<void> {
    const current = await this.list();
    const filtered = current.filter(h => h.id !== id);
    await AsyncStorage.setItem(HUNTS_KEY, JSON.stringify(filtered));
    await this.enqueue({ kind: 'delete', id });
  }

  async checkMatches(hunt: Hunt): Promise<Hunt> {
    try {
      const response = await searchService.searchWithMetadata(hunt.query);
      const structuredIntent = response.structuredIntent;
      const normalizedIntent =
        structuredIntent?.normalized ?? hunt.normalizedIntent;
      const withIntent = { ...hunt, normalizedIntent, structuredIntent };
      const canUseSearchResults =
        response.strongInternalMatchCount === undefined ||
        response.strongInternalMatchCount > 0 ||
        response.fallbackStatus === 'used';
      if (response.products.length === 0 || !canUseSearchResults) {
        return { ...withIntent, matchStatus: 'no_reliable_match' };
      }

      let filtered = response.products;
      if (hunt.condition === 'new') {
        filtered = filtered.filter((result) => result.condition === 'new');
      }
      if (hunt.condition === 'used') {
        filtered = filtered.filter(
          (result) => result.condition === 'used' || result.condition === 'refurbished',
        );
      }
      const discoveryMatches = buildHuntDiscoveryMatches(
        filtered,
        hunt.targetPrice,
        hunt.currency,
      );
      const priced = filtered.filter(
        (product): product is typeof product & { price: number } =>
          product.price != null &&
          Number.isFinite(product.price) &&
          product.price >= 0 &&
          product.currency?.toUpperCase() === hunt.currency,
      );
      if (priced.length === 0) {
        return {
          ...withIntent,
          ...(discoveryMatches.length > 0 ? { discoveryMatches } : {}),
          matchStatus: filtered.length > 0 ? 'no_verified_price' : 'no_reliable_match',
        };
      }

      const priceLimit = hunt.targetPrice;
      const withinPrice =
        priceLimit != null
          ? priced.filter((product) => product.price <= priceLimit)
          : [];
      const candidates = withinPrice.length > 0 ? withinPrice : priced;
      const best = candidates.reduce(
        (min, product) => (product.price < min.price ? product : min),
        candidates[0],
      );
      return {
        ...withIntent,
        discoveryMatches,
        matchStatus: 'matched',
        bestMatchId: best.id,
        bestMatchTitle: best.title,
        bestPrice: best.price,
      };
    } catch {
      return { ...hunt, matchStatus: 'search_unavailable' };
    }
  }

  private async save(hunts: Hunt[]): Promise<void> {
    await AsyncStorage.setItem(HUNTS_KEY, JSON.stringify(hunts));
  }

  private async queue(): Promise<QueueItem[]> {
    const value = await AsyncStorage.getItem(QUEUE_KEY);
    if (!value) return [];
    try { return JSON.parse(value) as QueueItem[]; } catch { return []; }
  }

  private async enqueue(item: QueueItem): Promise<void> {
    const queue = await this.queue();
    const id = item.kind === 'upsert' ? item.hunt.id : item.id;
    const existing = queue.find(
      (entry): entry is Extract<QueueItem, { kind: 'upsert' }> =>
        entry.kind === 'upsert' && entry.hunt.id === id,
    );
    const normalized: QueueItem =
      item.kind === 'patch' && existing
        ? { kind: 'upsert', hunt: { ...existing.hunt, ...item.patch } }
        : item;
    const next = queue.filter(entry => (entry.kind === 'upsert' ? entry.hunt.id : entry.id) !== id);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([...next, normalized]));
    await this.flush();
  }

  private async flush(): Promise<void> {
    const queue = await this.queue();
    if (!queue.length) return;
    try { await ensureDeviceIdentity(); } catch { return; }
    const remaining: QueueItem[] = [];
    for (const item of queue) {
      try {
        if (item.kind === 'upsert') await upsertSavedHunt(item.hunt.id, upsertPayload(item.hunt));
        else if (item.kind === 'patch') await updateSavedHunt(item.id, patchPayload(item.patch));
        else await deleteSavedHunt(item.id);
      } catch { remaining.push(item); }
    }
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
  }

  async notificationStatus(): Promise<boolean> {
    await ensureDeviceIdentity();
    return (await getHuntDevice()).pushNotificationsEnabled;
  }

  async enableNotifications(expoPushToken: string): Promise<boolean> {
    await ensureDeviceIdentity();
    const platform = devicePlatform();
    if (platform === 'web') throw new Error('Push notifications require a native device');
    return (await registerHuntPushToken({ expoPushToken, platform })).pushNotificationsEnabled;
  }

  async disableNotifications(): Promise<boolean> {
    await ensureDeviceIdentity();
    return (await disableHuntPushToken()).pushNotificationsEnabled;
  }
}

export const huntService: HuntService = new LocalHuntService();

export interface FutureHuntMonitor {
  check(hunt: Hunt, results: unknown[]): Promise<{ matched: boolean; reason?: string }>;
}
