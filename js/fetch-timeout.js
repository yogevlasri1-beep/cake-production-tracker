/** Timeouts so a dead Supabase/Auth connection cannot freeze the PWA. */

export const AUTH_FETCH_TIMEOUT_MS = 8000;
export const SYNC_FETCH_TIMEOUT_MS = 12000;

export function networkTimeoutError(message = 'timeout') {
  const err = new Error(message);
  err.name = 'AbortError';
  err.kind = 'network';
  return err;
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = SYNC_FETCH_TIMEOUT_MS) {
  const ms = Number(timeoutMs);
  const limit = Number.isFinite(ms) && ms > 0 ? ms : SYNC_FETCH_TIMEOUT_MS;
  const ctrl = new AbortController();
  const parent = options.signal;
  const onParentAbort = () => ctrl.abort();
  if (parent) {
    if (parent.aborted) throw networkTimeoutError('timeout');
    parent.addEventListener('abort', onParentAbort, { once: true });
  }
  const timer = setTimeout(() => ctrl.abort(), limit);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } catch (err) {
    if (err?.name === 'AbortError' || ctrl.signal.aborted) {
      throw networkTimeoutError('timeout');
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (parent) parent.removeEventListener('abort', onParentAbort);
  }
}
