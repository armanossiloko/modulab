import { apiErrorMessage } from '../../api/configure-lab-api';

/** Generated-client result → data, or throw with the API's error message. */
export async function unwrap<T>(
  promise: Promise<{ data?: T; error?: unknown; response?: Response }>
): Promise<T> {
  const result = await promise;
  if (result.error != null || result.data === undefined) {
    throw new Error(apiErrorMessage(result.error, `Request failed (${result.response?.status ?? '?'})`));
  }
  return result.data;
}

/** Like unwrap, but for endpoints that answer 202/409 with a task snapshot either way. */
export async function unwrapAny<T>(
  promise: Promise<{ data?: T; error?: unknown; response?: Response }>
): Promise<T> {
  const result = await promise;
  const body = (result.data ?? result.error) as T | undefined;
  if (body && typeof body === 'object' && 'current' in (body as object)) return body;
  if (result.error != null || result.data === undefined) {
    throw new Error(apiErrorMessage(result.error, `Request failed (${result.response?.status ?? '?'})`));
  }
  return result.data;
}

export function formatBytes(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.round((now - t) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
