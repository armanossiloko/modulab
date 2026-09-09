/** UI-only dashboard document shapes (flexible JSON from dashboard.json). */

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

export interface DashboardPage {
  id: string;
  title: string;
  items: PageItem[];
}

export interface LegacyLayout {
  center?: string[];
  right?: string[];
}

export interface DashboardDocument {
  title?: string;
  search?: DashboardSearch;
  theme?: DashboardTheme;
  sidebar?: DashboardSidebar;
  widgets?: WidgetConfigMap;
  layout?: LegacyLayout;
  pages?: DashboardPage[];
  _comment?: string;
}
