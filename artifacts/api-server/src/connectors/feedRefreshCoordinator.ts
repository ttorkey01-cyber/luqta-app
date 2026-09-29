const MAX_CONCURRENT_FEED_REFRESHES = 2;
const FEED_REFRESH_RETRY_DELAYS_MS = [250, 1_000];

function isPermanentFeedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /invalid CSV header|no valid products|exceeds the maximum allowed size|empty response|feed URL is not configured|feed returned HTTP 4\d\d/i.test(error.message);
}

let activeFeedRefreshes = 0;
const waitingForFeedRefreshSlot: Array<() => void> = [];

async function acquireFeedRefreshSlot() {
  if (activeFeedRefreshes < MAX_CONCURRENT_FEED_REFRESHES) {
    activeFeedRefreshes += 1;
    return;
  }

  await new Promise<void>((resolve) => {
    waitingForFeedRefreshSlot.push(resolve);
  });
}

function releaseFeedRefreshSlot() {
  const next = waitingForFeedRefreshSlot.shift();
  if (next) {
    next();
  } else {
    activeFeedRefreshes -= 1;
  }
}

export async function withFeedRefreshSlot<T>(
  refresh: () => Promise<T>,
): Promise<T> {
  await acquireFeedRefreshSlot();
  try {
    return await refresh();
  } finally {
    releaseFeedRefreshSlot();
  }
}

export async function retryFeedRefresh<T>(
  refresh: () => Promise<T>,
  retryDelaysMs = FEED_REFRESH_RETRY_DELAYS_MS,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await withFeedRefreshSlot(refresh);
    } catch (error) {
      const delayMs = retryDelaysMs[attempt];
      if (delayMs === undefined || isPermanentFeedError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export const FEED_REQUEST_RECOVERY_COOLDOWN_MS = 30_000;