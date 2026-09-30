// Process-local FIFO: a completed build hands its slot to the oldest waiter.
// Feed downloads use their own coordinator and never hold this slot.
let building = false;
const waiting: Array<() => void> = [];

export async function withCategoryBuildSlot<T>(
  build: () => Promise<T>,
): Promise<T> {
  if (building) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  } else {
    building = true;
  }

  try {
    return await build();
  } finally {
    const next = waiting.shift();
    if (next) {
      next();
    } else {
      building = false;
    }
  }
}