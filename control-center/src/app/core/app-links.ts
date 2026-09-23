import { CatalogItem } from '../api/generated';

const PROXY_ALIASES: Record<string, string> = {
  'stirling-pdf': 'stirling',
  'futo-notes': 'notes',
  'control-center': 'home',
  'it-tools': 'it-tools',
};

export function canOpenApp(app: CatalogItem): boolean {
  return (
    app.id !== 'control-center' &&
    (app.status === 'running' || (!!app.core && app.status === 'removed')) &&
    !!(app.url || app.port)
  );
}

/** Prefer a LAN hostname when Control Center was opened by name; otherwise host:port. */
export function openAppUrl(app: CatalogItem): string {
  const path = app.path || '';
  const host = window.location.hostname || '127.0.0.1';
  const port = app.port;
  if (!port) return `http://${host}${path}`;

  const parts = host.split('.');
  if (parts.length >= 2 && host !== '127.0.0.1' && host !== 'localhost') {
    const domain = parts.slice(1).join('.');
    const label = PROXY_ALIASES[app.id] || app.id;
    if (label && !/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      return `http://${label}.${domain}${path}`;
    }
  }

  return `http://${host}:${port}${path}`;
}

/** Host IP from Settings → Lab, plus this app's published port. */
export function ipAppUrl(
  app: CatalogItem,
  hostIp: string | null | undefined,
  needsHostIp: boolean | undefined
): string | null {
  const ip = hostIp?.trim();
  const port = app.port;
  if (!ip || needsHostIp || port == null || String(port).trim() === '') return null;
  const url = `http://${ip}:${port}${app.path || ''}`;
  return url === openAppUrl(app) ? null : url;
}
