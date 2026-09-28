export function mobileNow() {
  return typeof performance !== 'undefined' && performance.now
    ? performance.now()
    : Date.now();
}

const responseTimesByRequest = new Map<string, number>();

export function logMobileTiming(
  event:
    | 'CATEGORY_TAP'
    | 'REQUEST_STARTED'
    | 'RESPONSE_RECEIVED'
    | 'JSON_PARSED'
    | 'SET_PRODUCTS'
    | 'SPINNER_HIDDEN'
    | 'PRODUCTS_STATE_COMMITTED'
    | 'REACT_RENDER_STARTED'
    | 'GRID_MOUNTED'
    | 'FIRST_CARD_MOUNTED'
    | 'FIRST_IMAGE_ONLOAD',
  details: Record<string, unknown> = {},
) {
  if (!__DEV__) return;
  const at = mobileNow();
  const requestKey = `${String(details.category ?? '')}:${String(details.page ?? 1)}`;
  if (event === 'RESPONSE_RECEIVED' && details.category) {
    responseTimesByRequest.set(requestKey, at);
  }
  const responseAt = responseTimesByRequest.get(requestKey);
  console.log('[luqta-category-timing]', {
    event,
    at: Number(at.toFixed(1)),
    ...(responseAt !== undefined
      ? { responseToEventMs: Number((at - responseAt).toFixed(1)) }
      : {}),
    ...details,
  });
}

export function logRawImageEvent(
  event: string,
  details: Record<string, unknown>,
) {
  if (!__DEV__ || process.env.EXPO_PUBLIC_IMAGE_DEBUG !== '1') return;
  console.log('[luqta-raw-image]', {
    event,
    at: Number(mobileNow().toFixed(1)),
    ...details,
  });
}