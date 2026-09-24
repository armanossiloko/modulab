import { Injectable, signal, computed } from '@angular/core';
import { Observable, from, tap, map } from 'rxjs';
import {
  getCatalog,
  getDashboard,
  getHackerNewsFeed,
  getLabSettings,
  getLabStatus,
  getRedditFeed,
  getUpdates,
  getWeather,
  installApp as apiInstallApp,
  putDashboard,
  putLabSettings,
  startApp as apiStartApp,
  stopApp as apiStopApp,
  uninstallApp as apiUninstallApp,
  type ApiMessage,
  type AppUpdateStatus,
  type CatalogItem,
  type CatalogResponse,
  type FeedResponse,
  type LabSettingsResponse,
  type LabSettingsUpdate,
  type LabStatusResponse,
  type UpdatesResponse,
  type WeatherResponse,
} from '../../api/generated';
import { apiErrorMessage } from '../../api/configure-lab-api';
import {
  buildDashboardTree,
  collectDescendantIds,
  ensureDashboards,
  resetPagesFromLayout,
} from './layout-migrate';
import { DashboardBoard, DashboardDocument, PageItem } from '../models/dashboard';

async function unwrap<T>(promise: Promise<{ data?: T; error?: unknown; response?: Response }>): Promise<T> {
  const result = await promise;
  if (result.error != null || result.data === undefined) {
    throw new Error(apiErrorMessage(result.error, `Request failed (${result.response?.status ?? '?'})`));
  }
  return result.data;
}

function newBoardId(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
  return `${slug || 'board'}-${Date.now().toString(36)}`;
}

@Injectable({ providedIn: 'root' })
export class DashboardService {
  readonly document = signal<DashboardDocument | null>(null);
  readonly catalog = signal<CatalogItem[]>([]);
  readonly updates = signal<AppUpdateStatus[]>([]);
  readonly updatesCheckedAt = signal<string | null>(null);
  readonly updatesLoading = signal(false);
  readonly editMode = signal(false);
  readonly activeDashboardId = signal('home');
  /** Bumped when layout is force-reset so the grid re-binds items. */
  readonly layoutEpoch = signal(0);
  readonly labStatus = signal<LabStatusResponse | null>(null);

  /** @deprecated use activeDashboardId */
  readonly activePageId = this.activeDashboardId;

  readonly dashboards = computed(() => this.document()?.dashboards ?? []);
  readonly dashboardTree = computed(() => buildDashboardTree(this.dashboards()));
  readonly sidebar = computed(() => this.document()?.sidebar ?? null);

  readonly activeDashboard = computed(() => {
    const boards = this.dashboards();
    const id = this.activeDashboardId();
    return boards.find((b) => b.id === id) ?? boards[0] ?? null;
  });

  /** @deprecated use activeDashboard */
  readonly activePage = this.activeDashboard;
  /** @deprecated use dashboards */
  readonly pages = this.dashboards;

  load(): Observable<DashboardDocument> {
    return from(unwrap(getDashboard({ throwOnError: false }))).pipe(
      map((raw) => ensureDashboards(raw as DashboardDocument)),
      tap((doc) => {
        this.document.set(doc);
        const accent = doc.theme?.accent;
        if (accent) {
          document.documentElement.style.setProperty('--accent', accent);
        }
        const boards = doc.dashboards || [];
        if (boards.length && !boards.some((b) => b.id === this.activeDashboardId())) {
          this.activeDashboardId.set(boards[0].id);
        }
      })
    );
  }

  loadCatalog(): Observable<CatalogItem[]> {
    return from(unwrap(getCatalog({ throwOnError: false }))).pipe(
      map((res: CatalogResponse) => (Array.isArray(res.apps) ? res.apps : [])),
      tap((apps) => this.catalog.set(apps))
    );
  }

  loadUpdates(refresh = false): Observable<AppUpdateStatus[]> {
    this.updatesLoading.set(true);
    return from(
      unwrap(
        getUpdates({
          throwOnError: false,
          query: refresh ? { refresh: true } : undefined,
        })
      )
    ).pipe(
      map((res: UpdatesResponse) => (Array.isArray(res.apps) ? res.apps : [])),
      tap({
        next: (apps) => {
          this.updates.set(apps);
          this.updatesCheckedAt.set(new Date().toISOString());
          this.updatesLoading.set(false);
        },
        error: () => this.updatesLoading.set(false),
      })
    );
  }

  updateAvailable(id: string): boolean {
    return this.updates().some((a) => a.id === id && a.updateAvailable);
  }

  appsWithUpdates = computed(() => this.updates().filter((a) => a.updateAvailable));

  save(doc: DashboardDocument): Observable<ApiMessage> {
    const normalized = ensureDashboards(doc);
    return from(
      unwrap(
        putDashboard({
          throwOnError: false,
          body: normalized as unknown,
        })
      )
    ).pipe(tap(() => this.document.set(normalized)));
  }

  setActiveDashboard(id: string): void {
    if (this.activeDashboardId() === id) return;
    this.activeDashboardId.set(id);
    this.layoutEpoch.update((n) => n + 1);
  }

  updatePageItems(pageId: string, items: PageItem[]): void {
    const doc = this.document();
    if (!doc?.dashboards) return;
    const dashboards = doc.dashboards.map((p) => (p.id === pageId ? { ...p, items } : p));
    this.document.set({ ...doc, dashboards });
  }

  persistLayout(): Observable<ApiMessage> {
    const doc = this.document();
    if (!doc) {
      throw new Error('No dashboard loaded');
    }
    return this.save(doc);
  }

  /** Restore Home board widgets from layout defaults (keeps other boards + sidebar). */
  resetLayoutToDefault(): Observable<ApiMessage> {
    const doc = this.document();
    if (!doc) {
      throw new Error('No dashboard loaded');
    }
    const next = resetPagesFromLayout(doc);
    return this.save(next).pipe(
      tap(() => {
        this.activeDashboardId.set('home');
        this.layoutEpoch.update((n) => n + 1);
      })
    );
  }

  addWidget(item: PageItem): void {
    const board = this.activeDashboard();
    const doc = this.document();
    if (!board || !doc?.dashboards) return;

    const maxY = board.items.reduce((m, i) => Math.max(m, i.y + i.h), 0);
    const placed: PageItem = { ...item, x: item.x || 0, y: maxY };
    this.updatePageItems(board.id, [...board.items, placed]);
    this.layoutEpoch.update((n) => n + 1);
    this.persistLayout().subscribe({ error: (e: Error) => console.error(e) });
  }

  removeWidget(itemId: string): void {
    const board = this.activeDashboard();
    if (!board) return;
    this.updatePageItems(
      board.id,
      board.items.filter((i) => i.id !== itemId)
    );
    this.layoutEpoch.update((n) => n + 1);
    this.persistLayout().subscribe({ error: (e: Error) => console.error(e) });
  }

  addDashboard(opts?: { title?: string; parentId?: string | null }): Observable<DashboardBoard> {
    const doc = this.document();
    if (!doc) {
      throw new Error('No document loaded');
    }
    const title = (opts?.title || 'New dashboard').trim() || 'New dashboard';
    const parentId = opts?.parentId ?? null;
    if (parentId && !doc.dashboards?.some((b) => b.id === parentId)) {
      throw new Error('Parent dashboard not found');
    }
    const board: DashboardBoard = {
      id: newBoardId(title),
      title,
      parentId,
      items: [],
    };
    const next = ensureDashboards({
      ...doc,
      dashboards: [...(doc.dashboards || []), board],
    });
    return this.save(next).pipe(map(() => board));
  }

  renameDashboard(id: string, title: string): Observable<ApiMessage> {
    const doc = this.document();
    if (!doc?.dashboards) {
      throw new Error('No document loaded');
    }
    const name = title.trim() || 'Untitled';
    const dashboards = doc.dashboards.map((b) => (b.id === id ? { ...b, title: name } : b));
    return this.save({ ...doc, dashboards });
  }

  /** Deletes a board and all nested children. */
  removeDashboard(id: string): Observable<ApiMessage> {
    const doc = this.document();
    if (!doc?.dashboards) {
      throw new Error('No document loaded');
    }
    if (id === 'home') {
      throw new Error('Cannot delete the Home dashboard');
    }
    const drop = collectDescendantIds(doc.dashboards, id);
    const dashboards = doc.dashboards.filter((b) => !drop.has(b.id));
    if (dashboards.length === 0) {
      throw new Error('At least one dashboard is required');
    }
    return this.save({ ...doc, dashboards }).pipe(
      tap(() => {
        if (drop.has(this.activeDashboardId())) {
          this.activeDashboardId.set(dashboards[0].id);
        }
        this.layoutEpoch.update((n) => n + 1);
      })
    );
  }

  setEditMode(on: boolean): void {
    this.editMode.set(on);
  }

  weather(lat: number, lon: number, label: string): Observable<WeatherResponse> {
    return from(
      unwrap(
        getWeather({
          throwOnError: false,
          query: { lat, lon, label },
        })
      )
    );
  }

  redditFeed(sub: string, limit: number): Observable<FeedResponse> {
    return from(
      unwrap(
        getRedditFeed({
          throwOnError: false,
          query: { sub, limit },
        })
      )
    );
  }

  hnFeed(limit: number): Observable<FeedResponse> {
    return from(
      unwrap(
        getHackerNewsFeed({
          throwOnError: false,
          query: { limit },
        })
      )
    );
  }

  startApp(id: string): Observable<ApiMessage> {
    return from(unwrap(apiStartApp({ throwOnError: false, path: { id } })));
  }

  stopApp(id: string): Observable<ApiMessage> {
    return from(unwrap(apiStopApp({ throwOnError: false, path: { id } })));
  }

  uninstallApp(id: string): Observable<ApiMessage> {
    return from(unwrap(apiUninstallApp({ throwOnError: false, path: { id } })));
  }

  installApp(id: string, config: Record<string, unknown>): Observable<ApiMessage> {
    return from(
      unwrap(
        apiInstallApp({
          throwOnError: false,
          path: { id },
          body: { config },
        })
      )
    );
  }

  loadLabStatus(): Observable<LabStatusResponse> {
    return from(unwrap(getLabStatus({ throwOnError: false }))).pipe(
      tap((status) => this.labStatus.set(status))
    );
  }

  getLabSettings(): Observable<LabSettingsResponse> {
    return from(unwrap(getLabSettings({ throwOnError: false })));
  }

  saveLabSettings(body: LabSettingsUpdate): Observable<LabSettingsResponse> {
    return from(
      unwrap(
        putLabSettings({
          throwOnError: false,
          body,
        })
      )
    ).pipe(tap(() => this.loadLabStatus().subscribe()));
  }

  widgetConfig(type: string): Record<string, unknown> {
    return this.document()?.widgets?.[type] ?? {};
  }

  pageTitle(board: DashboardBoard | null): string {
    return board?.title || this.document()?.title || 'Modulab';
  }
}
