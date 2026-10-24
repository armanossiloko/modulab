import type { CatalogItem } from '../api/generated';
import { canOpenApp, ipAppUrl } from './app-links';
import { formatRelease, statusLabel, statusTone } from './app-status';
import { taskTitle, type AppTask } from './services/app-tasks';

function app(overrides: Partial<CatalogItem>): CatalogItem {
  return {
    id: 'jellyfin',
    name: 'Jellyfin',
    description: '',
    category: 'media',
    port: 8096,
    path: null,
    url: null,
    installable: true,
    core: false,
    dependsOn: [],
    fields: [],
    enabled: true,
    running: true,
    status: 'running',
    ...overrides,
  };
}

describe('app status helpers', () => {
  it('labels and tones', () => {
    expect(statusLabel('removed')).toBe('not installed');
    expect(statusLabel(undefined)).toBe('unknown');
    expect(statusTone('running')).toBe('positive');
    expect(statusTone('removed')).toBe('negative');
  });

  it('hides floating tags but shows pinned versions', () => {
    expect(formatRelease('latest', null)).toBeNull();
    expect(formatRelease('10.11.0', null)).toBe('10.11.0');
  });
});

describe('app links', () => {
  it('only opens running apps with somewhere to go', () => {
    expect(canOpenApp(app({}))).toBe(true);
    expect(canOpenApp(app({ status: 'stopped' }))).toBe(false);
    expect(canOpenApp(app({ id: 'control-center' }))).toBe(false);
    expect(canOpenApp(app({ port: null, url: null }))).toBe(false);
  });

  it('offers an IP link only once the host IP is set', () => {
    expect(ipAppUrl(app({}), '192.168.1.50', false)).toBe('http://192.168.1.50:8096');
    expect(ipAppUrl(app({}), '192.168.1.50', true)).toBeNull();
    expect(ipAppUrl(app({ port: null }), '192.168.1.50', false)).toBeNull();
  });
});

describe('task dock titles', () => {
  const base: AppTask = {
    id: 'jellyfin',
    name: 'Jellyfin',
    action: 'update',
    status: 'running',
    latest: '',
    lines: [],
    error: null,
    startedAt: '',
  };

  it('describes each action and state', () => {
    expect(taskTitle(base)).toBe('Updating Jellyfin');
    expect(taskTitle({ ...base, status: 'error' })).toBe("Couldn't update Jellyfin");
    expect(taskTitle({ ...base, action: 'rollback', status: 'ok' })).toBe('Jellyfin rolled back');
    expect(taskTitle({ ...base, action: 'backup' })).toBe('Backing up the lab');
    expect(taskTitle({ ...base, action: 'restore', status: 'error' })).toBe('Restore failed');
  });
});
