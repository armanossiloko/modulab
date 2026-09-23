import {
  DashboardBoard,
  DashboardDocument,
  DashboardTreeNode,
  PageItem,
  WidgetConfigMap,
} from '../models/dashboard';

/** Matches master `layout.center` / `layout.right` order. */
export const CENTER_DEFAULT = ['stacks', 'updates', 'hackerNews', 'community'];
export const RIGHT_DEFAULT = ['now', 'calendar'];

/** Dense grid — more columns, shorter row units. */
export const GRID_COLS = 24;

const MAIN_W = 19;
const CELL_W = 11;
const RAIL_X = 19;
const RAIL_W = 5;

const CENTER_HEIGHTS: Record<string, number> = {
  stacks: 6,
  updates: 6,
  community: 8,
  hackerNews: 8,
  media: 6,
};

/** Tall enough to show the card body, not a clipped title and a scrollbar. */
const RAIL_HEIGHTS: Record<string, number> = {
  now: 3,
  clock: 2,
  weather: 2,
  yearProgress: 2,
  stackUsage: 2,
  network: 2,
  nowRunning: 2,
  calendar: 9,
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

/** Build the default Home board from legacy layout.center / layout.right. */
export function migrateLegacyLayout(doc: DashboardDocument): DashboardBoard {
  const center = doc.layout?.center?.length ? doc.layout.center : CENTER_DEFAULT;
  const right = doc.layout?.right?.length ? doc.layout.right : RIGHT_DEFAULT;
  const widgets = doc.widgets;
  const items: PageItem[] = [];

  const enabledCenter = center.filter((type) => widgetEnabled(widgets, type));
  let y = 0;
  for (let i = 0; i < enabledCenter.length; i += 2) {
    const left = enabledCenter[i];
    const rightType = enabledCenter[i + 1];
    const leftH = CENTER_HEIGHTS[left] ?? 2;
    const rightH = rightType ? (CENTER_HEIGHTS[rightType] ?? 2) : leftH;
    const rowH = Math.max(leftH, rightH);

    if (rightType) {
      items.push(makeItem(left, 0, y, CELL_W, rowH));
      items.push(makeItem(rightType, CELL_W, y, MAIN_W - CELL_W, rowH));
    } else {
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
    parentId: null,
    items,
  };
}

/** Normalize document: pages[] → dashboards[], ensure ≥1 board, sidebar stays at root. */
export function ensureDashboards(doc: DashboardDocument): DashboardDocument {
  let dashboards = doc.dashboards;
  if ((!dashboards || dashboards.length === 0) && Array.isArray(doc.pages) && doc.pages.length > 0) {
    dashboards = doc.pages.map((p) => ({
      ...p,
      parentId: p.parentId ?? null,
    }));
  }
  if (!dashboards || dashboards.length === 0) {
    dashboards = [migrateLegacyLayout(doc)];
  }

  dashboards = dashboards.map((d) => ({
    ...d,
    parentId: d.parentId ?? null,
    items: Array.isArray(d.items) ? d.items : [],
  }));

  // Auto-fix Home if rail widgets are still on the oversized spans.
  dashboards = dashboards.map((d) => (d.id === 'home' && homeRailIsOversized(d) ? migrateLegacyLayout(doc) : d));

  const { pages: _drop, ...rest } = doc;
  return {
    ...rest,
    dashboards,
  };
}

function homeRailIsOversized(board: DashboardBoard): boolean {
  const rail = board.items.filter((i) => i.x >= 18);
  if (rail.length === 0) return false;
  // Older boards used rail tiles wider than the 5-column rail.
  return rail.some((i) => i.w > 6);
}

/** @deprecated alias */
export function ensurePages(doc: DashboardDocument): DashboardDocument {
  return ensureDashboards(doc);
}

/** Reset only the root Home board widgets from layout defaults; keep other boards. */
export function resetPagesFromLayout(doc: DashboardDocument): DashboardDocument {
  const normalized = ensureDashboards(doc);
  const home = migrateLegacyLayout(normalized);
  const others = (normalized.dashboards || []).filter((d) => d.id !== 'home');
  return {
    ...normalized,
    dashboards: [home, ...others],
  };
}

export function buildDashboardTree(boards: DashboardBoard[]): DashboardTreeNode[] {
  const byParent = new Map<string | null, DashboardBoard[]>();
  for (const board of boards) {
    const key = board.parentId ?? null;
    const list = byParent.get(key) || [];
    list.push(board);
    byParent.set(key, list);
  }

  const walk = (parentId: string | null, depth: number): DashboardTreeNode[] => {
    const kids = byParent.get(parentId) || [];
    return kids.map((board) => ({
      board,
      depth,
      children: walk(board.id, depth + 1),
    }));
  };

  return walk(null, 0);
}

export function collectDescendantIds(boards: DashboardBoard[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const b of boards) {
      if (b.parentId && ids.has(b.parentId) && !ids.has(b.id)) {
        ids.add(b.id);
        changed = true;
      }
    }
  }
  return ids;
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
