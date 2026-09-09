/** Lab Control Center document shapes (flexible JSON from dashboard.json). */

export interface DashboardSearch {
  engine?: string;
  placeholder?: string;
  libraryPlaceholder?: string;
}

export interface DashboardTheme {
  accent?: string;
}

export interface BookmarkLink {
  title: string;
  url: string;
  domain?: string;
  enabled?: boolean;
}

export interface BookmarkGroup {
  title: string;
  color?: string;
  enabled?: boolean;
  links: BookmarkLink[];
}

/** Global shell sidebar — shared across every dashboard. */
export interface DashboardSidebar {
  showInstalledApps?: boolean;
  bookmarks?: BookmarkGroup[];
}

export interface WidgetConfigMap {
  [key: string]: Record<string, unknown> & { enabled?: boolean; title?: string };
}

/** Grafana-style grid item; w/h map to gridster cols/rows. */
export interface PageItem {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  config?: Record<string, unknown>;
}

/**
 * A widget board. Nested via parentId (null/omit = root).
 * Sidebar is NOT part of a board — it lives on the document root.
 */
export interface DashboardBoard {
  id: string;
  title: string;
  /** Parent board id; omit or null for a top-level dashboard. */
  parentId?: string | null;
  items: PageItem[];
}

/** @deprecated Use DashboardBoard — kept for migrate from pages[]. */
export type DashboardPage = DashboardBoard;

export interface LegacyLayout {
  center?: string[];
  right?: string[];
}

export interface DashboardDocument {
  title?: string;
  search?: DashboardSearch;
  theme?: DashboardTheme;
  /** Shell chrome — same for every dashboard. */
  sidebar?: DashboardSidebar;
  widgets?: WidgetConfigMap;
  layout?: LegacyLayout;
  /** Widget boards (supports nesting via parentId). */
  dashboards?: DashboardBoard[];
  /** @deprecated Migrated into dashboards[] on load. */
  pages?: DashboardBoard[];
  _comment?: string;
}

export interface DashboardTreeNode {
  board: DashboardBoard;
  children: DashboardTreeNode[];
  depth: number;
}
