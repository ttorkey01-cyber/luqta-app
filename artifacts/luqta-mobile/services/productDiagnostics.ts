import type { ProductRequestObservation } from '@workspace/api-client-react';

export type ProductRequestKind = ProductRequestObservation['type'];

export type DisplayPipeline = {
  received: number | null;
  mapped: number | null;
  filtered: number | null;
  rendered: number | null;
  timestamp: string;
};

export type ProductDiagnostic = ProductRequestObservation & {
  pipeline?: DisplayPipeline;
};

export type ProductDiagnosticSnapshot = Partial<Record<ProductRequestKind, ProductDiagnostic>>;

let snapshot: ProductDiagnosticSnapshot = {};
const listeners = new Set<() => void>();

function publish(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // Diagnostic subscribers must never affect product requests.
    }
  }
}

export function getProductDiagnostics(): ProductDiagnosticSnapshot {
  return snapshot;
}

export function subscribeProductDiagnostics(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearProductDiagnostics(): void {
  snapshot = {};
  publish();
}

export function recordProductRequest(event: ProductRequestObservation): void {
  // Retain only one bounded metadata record per request type, in JS memory.
  snapshot = { ...snapshot, [event.type]: { ...event } };
  publish();
}

export function recordCachedProductRequest(
  type: 'search' | 'category',
  category: string | null,
  productCount: number,
  total: number | null,
): void {
  recordProductRequest({
    type,
    path: '/api/search',
    category,
    source: 'cache',
    status: null,
    productCount,
    total,
    errorCode: null,
    durationMs: 0,
    timestamp: new Date().toISOString(),
  });
}

export function recordProductPipeline(
  type: 'search' | 'category',
  counts: Partial<Pick<DisplayPipeline, 'received' | 'mapped' | 'filtered' | 'rendered'>>,
): void {
  const previous = snapshot[type];
  if (!previous) return;
  snapshot = {
    ...snapshot,
    [type]: {
      ...previous,
      pipeline: {
        received: counts.received ?? previous.pipeline?.received ?? null,
        mapped: counts.mapped ?? previous.pipeline?.mapped ?? null,
        filtered: counts.filtered ?? previous.pipeline?.filtered ?? null,
        rendered: counts.rendered ?? previous.pipeline?.rendered ?? null,
        timestamp: new Date().toISOString(),
      },
    },
  };
  publish();
}