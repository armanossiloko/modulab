import {
  DashboardDocument,
  DashboardPage,
  PageItem,
  WidgetConfigMap,
} from '../models/dashboard';

/** Matches master `layout.center` / `layout.right` order. */
export const CENTER_DEFAULT = ['stacks', 'community', 'hackerNews', 'media'];
export const RIGHT_DEFAULT = [
  'clock',
  'weather',
  'yearProgress',
  'stackUsage',
  'network',
  'nowRunning',
  'calendar',
];

/**
 * Recreate the pre-Angular shell:
 * - page-body: `1fr` main + `--rail` (~260px ≈ 3/12)
 * - main `.home-grid`: 2 columns (paired widgets)
 * - right rail: stacked status widgets
 */
const MAIN_W = 9;
const CELL_W = 5; // left cell in the 2-col main grid (right cell = MAIN_W - CELL_W = 4)
const RAIL_X = 9;
const RAIL_W = 3;

const CENTER_HEIGHTS: Record<string, number> = {
  stacks: 3,
  community: 4,
  hackerNews: 4,
  media: 2,
};

const RAIL_HEIGHTS: Record<string, number> = {
  clock: 2,
  weather: 2,
  yearProgress: 2,
  stackUsage: 2,
  network: 2,
  nowRunning: 2,
  calendar: 3,
};

function widgetEnabled(widgets: WidgetConfigMap | undefined, type: string): boolean {
  const cfg = widgets?.[type];
  if (!cfg) return true;
  return cfg.enabled !== false;
}

function makeItem(type: string, x: number, y: number, w: number, h: number): PageItem {
  return {
    id: `${type}-${x}-${y}`,
    type,
    x,
    y,
    w,
    h,
    config: {},
  };
}

/** Build a Home page from legacy layout.center / layout.right (Glance 2-col + rail). */
export function migrateLegacyLayout(doc: DashboardDocument): DashboardPage {
  const center = doc.layout?.center?.length ? doc.layout.center : CENTER_DEFAULT;
  const right = doc.layout?.right?.length ? doc.layout.right : RIGHT_DEFAULT;
  const widgets = doc.widgets;
  const items: PageItem[] = [];

  const enabledCenter = center.filter((type) => widgetEnabled(widgets, type));
  let y = 0;
  for (let i = 0; i < enabledCenter.length; i += 2) {
    const left = enabledCenter[i];
    const rightType = enabledCenter[i + 1];
    const leftH = CENTER_HEIGHTS[left] ?? 3;
    const rightH = rightType ? (CENTER_HEIGHTS[rightType] ?? 3) : leftH;
    const rowH = Math.max(leftH, rightH);

    if (rightType) {
      items.push(makeItem(left, 0, y, CELL_W, rowH));
      items.push(makeItem(rightType, CELL_W, y, MAIN_W - CELL_W, rowH));
    } else {
      // Odd last item spans the main column (like a lone grid cell growing)
      items.push(makeItem(left, 0, y, MAIN_W, rowH));
    }
    y += rowH;
  }

  y = 0;
  for (const type of right) {
    if (!widgetEnabled(widgets, type)) continue;
    const h = RAIL_HEIGHTS[type] ?? 2;
    items.push(makeItem(type, RAIL_X, y, RAIL_W, h));
    y += h;
  }

  return {
    id: 'home',
    title: 'Home',
    items,
  };
}

export function ensurePages(doc: DashboardDocument): DashboardDocument {
  if (Array.isArray(doc.pages) && doc.pages.length > 0) {
    return doc;
  }
  return {
    ...doc,
    pages: [migrateLegacyLayout(doc)],
  };
}

/** Force-rebuild Home `pages[]` from `layout` (or master defaults). */
export function resetPagesFromLayout(doc: DashboardDocument): DashboardDocument {
  return {
    ...doc,
    pages: [migrateLegacyLayout(doc)],
  };
}

export function resolveBookmarkColor(token?: string): string {
  if (!token) return 'var(--cat-other)';
  if (token.startsWith('#') || token.startsWith('rgb') || token.startsWith('hsl')) {
    return token;
  }
  const map: Record<string, string> = {
    productivity: 'var(--cat-productivity)',
    media: 'var(--cat-media)',
    tools: 'var(--cat-tools)',
    infrastructure: 'var(--cat-infrastructure)',
    other: 'var(--cat-other)',
  };
  return map[token] ?? token;
}
