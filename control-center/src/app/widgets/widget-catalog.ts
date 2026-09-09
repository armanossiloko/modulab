import { PageItem } from '../core/models/dashboard';

export type WidgetKind = 'builtin' | 'custom';

export interface WidgetDefinition {
  type: string;
  label: string;
  description: string;
  kind: WidgetKind;
  /** Default grid size when added */
  w: number;
  h: number;
  /** Optional starter config */
  defaultConfig?: Record<string, unknown>;
}

/** Built-in widgets (same types as the default home layout). */
export const BUILTIN_WIDGETS: WidgetDefinition[] = [
  { type: 'stacks', label: 'Lab stacks', description: 'Installed lab apps and status', kind: 'builtin', w: 10, h: 3 },
  {
    type: 'updates',
    label: 'Updates',
    description: 'Docker image updates for installed stacks',
    kind: 'builtin',
    w: 8,
    h: 3,
  },
  { type: 'community', label: 'Community', description: 'Reddit / Lemmy feed', kind: 'builtin', w: 8, h: 3 },
  { type: 'hackerNews', label: 'Hacker News', description: 'Top HN stories', kind: 'builtin', w: 10, h: 3 },
  { type: 'media', label: 'Media', description: 'Media stack highlights', kind: 'builtin', w: 8, h: 3 },
  { type: 'clock', label: 'Clock', description: 'Local time and date', kind: 'builtin', w: 4, h: 1 },
  { type: 'weather', label: 'Weather', description: 'Current conditions', kind: 'builtin', w: 4, h: 1 },
  { type: 'yearProgress', label: 'Year progress', description: 'Progress through the year', kind: 'builtin', w: 4, h: 1 },
  { type: 'stackUsage', label: 'Stack usage', description: 'Installed vs running counts', kind: 'builtin', w: 4, h: 1 },
  { type: 'network', label: 'Network', description: 'Online / ping summary', kind: 'builtin', w: 4, h: 1 },
  { type: 'nowRunning', label: 'Now running', description: 'Featured running app', kind: 'builtin', w: 4, h: 1 },
  { type: 'calendar', label: 'Calendar', description: 'Month calendar', kind: 'builtin', w: 4, h: 4 },
];

/** Custom widgets you configure when adding. */
export const CUSTOM_WIDGETS: WidgetDefinition[] = [
  {
    type: 'iframe',
    label: 'Embed',
    description: 'Embed any HTTPS page in an iframe',
    kind: 'custom',
    w: 12,
    h: 4,
    defaultConfig: { title: 'Embed', url: '' },
  },
  {
    type: 'note',
    label: 'Note',
    description: 'Free-text note card',
    kind: 'custom',
    w: 8,
    h: 2,
    defaultConfig: { title: 'Note', text: '' },
  },
  {
    type: 'links',
    label: 'Link list',
    description: 'A small list of titled links',
    kind: 'custom',
    w: 6,
    h: 2,
    defaultConfig: {
      title: 'Links',
      links: [{ title: 'Example', url: 'https://example.com' }],
    },
  },
];

export const ALL_WIDGET_DEFS: WidgetDefinition[] = [...BUILTIN_WIDGETS, ...CUSTOM_WIDGETS];

export function widgetDef(type: string): WidgetDefinition | undefined {
  return ALL_WIDGET_DEFS.find((d) => d.type === type);
}

export function defaultWidgetTitle(type: string, config?: Record<string, unknown>): string {
  if (typeof config?.['title'] === 'string' && config['title'].trim()) {
    return config['title'].trim();
  }
  return widgetDef(type)?.label ?? type;
}

export function createPageItem(
  type: string,
  opts?: { x?: number; y?: number; w?: number; h?: number; config?: Record<string, unknown> }
): PageItem {
  const def = widgetDef(type);
  const config = { ...(def?.defaultConfig || {}), ...(opts?.config || {}) };
  return {
    id: `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    x: opts?.x ?? 0,
    y: opts?.y ?? 0,
    w: opts?.w ?? def?.w ?? 4,
    h: opts?.h ?? def?.h ?? 2,
    config,
  };
}
