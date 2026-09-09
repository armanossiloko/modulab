import { Injectable, signal, computed } from '@angular/core';
import { Observable, from, tap, map } from 'rxjs';
import {
  getCatalog,
  getDashboard,
  getHackerNewsFeed,
  getRedditFeed,
  getWeather,
  installApp as apiInstallApp,
  putDashboard,
  startApp as apiStartApp,
  stopApp as apiStopApp,
  uninstallApp as apiUninstallApp,
  type ApiMessage,
  type CatalogItem,
  type CatalogResponse,
  type FeedResponse,
  type WeatherResponse,
} from '../../api/generated';
import { apiErrorMessage } from '../../api/configure-lab-api';
import { ensurePages, resetPagesFromLayout } from './layout-migrate';
import { DashboardDocument, DashboardPage, PageItem } from '../models/dashboard';

async function unwrap<T>(promise: Promise<{ data?: T; error?: unknown; response?: Response }>): Promise<T> {
  const result = await promise;
  if (result.error != null || result.data === undefined) {
    if (result.response?.status === 401) {
      const key = window.prompt('Control Center API key (lab.controlCenterApiKey)');
      if (key) {
        sessionStorage.setItem('modulab.apiKey', key);
        throw new Error('Unauthorized — retry the action after setting the API key.');
      }
    }
    throw new Error(apiErrorMessage(result.error, `Request failed (${result.response?.status ?? '?'})`));
  }
  return result.data;
}

@Injectable({ providedIn: 'root' })
export class DashboardService {
  readonly document = signal<DashboardDocument | null>(null);
  readonly catalog = signal<CatalogItem[]>([]);
  readonly editMode = signal(false);
  readonly activePageId = signal('home');
  /** Bumped when layout is force-reset so the grid re-binds items. */
  readonly layoutEpoch = signal(0);

  readonly pages = computed(() => this.document()?.pages ?? []);
  readonly activePage = computed(() => {
    const pages = this.pages();
    const id = this.activePageId();
    return pages.find((p) => p.id === id) ?? pages[0] ?? null;
  });

  load(): Observable<DashboardDocument> {
    return from(unwrap(getDashboard({ throwOnError: false }))).pipe(
      map((raw) => ensurePages(raw as DashboardDocument)),
      tap((doc) => {
        this.document.set(doc);
        const accent = doc.theme?.accent;
        if (accent) {
          document.documentElement.style.setProperty('--accent', accent);
        }
        if (doc.pages?.[0] && !doc.pages.some((p) => p.id === this.activePageId())) {
          this.activePageId.set(doc.pages[0].id);
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

  save(doc: DashboardDocument): Observable<ApiMessage> {
    const normalized = ensurePages(doc);
    return from(
      unwrap(
        putDashboard({
          throwOnError: false,
          body: normalized as unknown,
        })
      )
    ).pipe(tap(() => this.document.set(normalized)));
  }

  updatePageItems(pageId: string, items: PageItem[]): void {
    const doc = this.document();
    if (!doc?.pages) return;
    const pages = doc.pages.map((p) => (p.id === pageId ? { ...p, items } : p));
    this.document.set({ ...doc, pages });
  }

  persistLayout(): Observable<ApiMessage> {
    const doc = this.document();
    if (!doc) {
      throw new Error('No dashboard loaded');
    }
    return this.save(doc);
  }

  /** Restore Home grid from layout.center / layout.right (master defaults). */
  resetLayoutToDefault(): Observable<ApiMessage> {
    const doc = this.document();
    if (!doc) {
      throw new Error('No dashboard loaded');
    }
    const next = resetPagesFromLayout(doc);
    return this.save(next).pipe(
      tap(() => {
        this.activePageId.set('home');
        this.layoutEpoch.update((n) => n + 1);
      })
    );
  }

  addWidget(item: PageItem): void {
    const page = this.activePage();
    const doc = this.document();
    if (!page || !doc?.pages) return;

    const maxY = page.items.reduce((m, i) => Math.max(m, i.y + i.h), 0);
    const placed: PageItem = { ...item, x: item.x || 0, y: maxY };
    const items = [...page.items, placed];
    this.updatePageItems(page.id, items);
    this.layoutEpoch.update((n) => n + 1);
    this.persistLayout().subscribe({ error: (e: Error) => console.error(e) });
  }

  removeWidget(itemId: string): void {
    const page = this.activePage();
    if (!page) return;
    const items = page.items.filter((i) => i.id !== itemId);
    this.updatePageItems(page.id, items);
    this.layoutEpoch.update((n) => n + 1);
    this.persistLayout().subscribe({ error: (e: Error) => console.error(e) });
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

  widgetConfig(type: string): Record<string, unknown> {
    return this.document()?.widgets?.[type] ?? {};
  }

  pageTitle(page: DashboardPage | null): string {
    return page?.title || this.document()?.title || 'Modulab';
  }
}
