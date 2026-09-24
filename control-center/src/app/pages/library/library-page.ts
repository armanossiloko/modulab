import { Component, HostListener, OnInit, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { CatalogItem, RecipeField } from '../../api/generated';
import { canOpenApp, ipAppUrl, openAppUrl } from '../../core/app-links';
import { formatRelease, statusLabel, statusTone } from '../../core/app-status';
import { DashboardService } from '../../core/services/dashboard.service';
import { CatalogMark } from '../../shared/catalog-mark';
import { Icon } from '../../shared/icon';

const CATEGORY_COLORS: Record<string, string> = {
  productivity: 'var(--cat-productivity)',
  media: 'var(--cat-media)',
  tools: 'var(--cat-tools)',
  infrastructure: 'var(--cat-infrastructure)',
};

type LibraryView = 'list' | 'grid';

const VIEW_KEY = 'modulab.library.view';

function readView(): LibraryView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

function libraryApps(apps: CatalogItem[]): CatalogItem[] {
  return apps.filter((app) => app.id !== 'control-center');
}

@Component({
  selector: 'app-library-page',
  imports: [FormsModule, Icon, CatalogMark],
  template: `
    <header class="page-header">
      <div class="page-header__titles">
        <h1 class="page-title">Library</h1>
        <p class="page-subtitle">
          {{ apps().length }} apps · {{ runningCount() }} running
          @if (updateCount()) {
            · <span class="accent-text">{{ updateCount() }} with updates</span>
          }
        </p>
      </div>
      <div class="page-header__actions">
        <div class="view-switch" role="group" aria-label="Library layout">
          <button
            type="button"
            class="icon-btn"
            [class.is-active]="view() === 'list'"
            [attr.aria-pressed]="view() === 'list'"
            aria-label="List view"
            title="List view"
            (click)="setView('list')"
          >
            <app-icon name="list" [size]="15" />
          </button>
          <button
            type="button"
            class="icon-btn"
            [class.is-active]="view() === 'grid'"
            [attr.aria-pressed]="view() === 'grid'"
            aria-label="Grid view"
            title="Grid view"
            (click)="setView('grid')"
          >
            <app-icon name="grid" [size]="15" />
          </button>
        </div>
        <label class="input-icon filter">
          <span class="sr-only">Filter library</span>
          <app-icon name="search" [size]="14" />
          <input
            class="input input--sm"
            type="search"
            placeholder="Filter library…"
            [ngModel]="query()"
            (ngModelChange)="query.set($event)"
          />
        </label>
      </div>
    </header>

    @if (error()) {
      <p class="empty-note">{{ error() }}</p>
    } @else {
      <ul class="library-list" [class.is-grid]="view() === 'grid'">
        @for (app of filteredApps(); track app.id; let i = $index) {
          <li class="card library-item" [style.animation-delay.ms]="i * 20">
            <app-catalog-mark
              [id]="app.id"
              [name]="app.name"
              [color]="categoryColor(app.category)"
              [size]="view() === 'grid' ? 52 : 36"
            />
            <div class="library-meta">
              <div class="library-title-row">
                <p class="library-title">{{ app.name }}</p>
                <span
                  class="badge"
                  [class.badge--positive]="tone(app.status) === 'positive'"
                  [class.badge--accent]="tone(app.status) === 'accent'"
                  [class.badge--negative]="tone(app.status) === 'negative'"
                  >{{ statusLabel(app.status) }}</span
                >
                @if (hasUpdate(app.id)) {
                  <span class="badge badge--accent badge--plain">update</span>
                }
                @if (app.core) {
                  <span class="badge badge--plain">core</span>
                }
              </div>
              @if (app.description) {
                <p class="library-desc">{{ app.description }}</p>
              }
              @if (releaseLine(app); as release) {
                <p class="library-release" title="Installed version and image build date">{{ release }}</p>
              }
            </div>
            <div class="library-actions">
              @if (hasUpdate(app.id)) {
                <button
                  type="button"
                  class="btn btn--primary"
                  [disabled]="busyId() === app.id"
                  (click)="update(app)"
                >
                  <app-icon name="download" [size]="14" />
                  {{ busyId() === app.id ? 'Updating…' : 'Update' }}
                </button>
              }
              @if (app.status === 'available' && app.installable !== false) {
                <button
                  type="button"
                  class="btn btn--primary"
                  [disabled]="setupBlocked()"
                  (click)="beginInstall(app)"
                >
                  <app-icon name="download" [size]="14" />
                  Install
                </button>
              }
              @if (app.status === 'removed' && !app.core && app.installable !== false) {
                <button
                  type="button"
                  class="btn btn--primary"
                  [disabled]="busyId() === app.id || setupBlocked()"
                  (click)="install(app)"
                >
                  <app-icon name="download" [size]="14" />
                  {{ busyId() === app.id ? 'Installing…' : 'Install' }}
                </button>
              }
              @if ((app.status === 'stopped' || app.status === 'installed') && !app.core) {
                <button
                  type="button"
                  class="btn"
                  [disabled]="busyId() === app.id"
                  (click)="start(app)"
                >
                  <app-icon name="play" [size]="12" />
                  {{ busyId() === app.id ? 'Starting…' : 'Start' }}
                </button>
              }
              @if (canOpen(app)) {
                <a class="btn" [href]="openUrl(app)" target="_blank" rel="noopener">
                  Open
                  <app-icon name="external" [size]="13" />
                </a>
                @if (ipUrl(app); as viaIp) {
                  <a class="btn" [href]="viaIp" target="_blank" rel="noopener" [title]="viaIp">
                    Open via IP
                    <app-icon name="external" [size]="13" />
                  </a>
                }
              }
              @if (
                !app.core &&
                (app.status === 'stopped' ||
                  app.status === 'installed' ||
                  app.status === 'running' ||
                  app.status === 'removed')
              ) {
                <button
                  type="button"
                  class="icon-btn icon-btn--ghost icon-btn--danger"
                  title="Uninstall"
                  [attr.aria-label]="'Uninstall ' + app.name"
                  (click)="uninstall(app)"
                >
                  <app-icon name="trash" [size]="15" />
                </button>
              }
            </div>
          </li>
        } @empty {
          <li class="empty-note">No recipes found.</li>
        }
      </ul>
    }

    @if (installing(); as app) {
      <div class="overlay" (click)="cancelInstall()"></div>
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="install-title">
        <header class="overlay-head">
          <div class="install-head">
            <app-catalog-mark
              [id]="app.id"
              [name]="app.name"
              [color]="categoryColor(app.category)"
            />
            <div>
              <h2 id="install-title" class="overlay-title">Install {{ app.name }}</h2>
              @if (app.description) {
                <p class="page-subtitle">{{ app.description }}</p>
              }
            </div>
          </div>
        </header>
        <div class="overlay-body">
          @if (app.fields.length === 0) {
            <p class="modal-note">No extra options — install with recipe defaults?</p>
          } @else {
            <div class="field-list">
              @for (field of app.fields; track field.key) {
                @if (field.type === 'boolean') {
                  <label class="switch">
                    <span class="switch__text">{{ field.label || field.key }}</span>
                    <input type="checkbox" [(ngModel)]="installDraft[field.key!]" />
                  </label>
                } @else {
                  <label class="field">
                    <span class="field__label"
                      >{{ field.label || field.key
                      }}@if (field.required) {
                        <span class="field__required" aria-hidden="true">*</span>
                      }</span
                    >
                    <input
                      class="input"
                      [type]="field.type === 'password' ? 'password' : 'text'"
                      [(ngModel)]="installDraft[field.key!]"
                      [required]="!!field.required"
                    />
                  </label>
                }
              }
            </div>
          }
        </div>
        <footer class="overlay-foot">
          <button type="button" class="btn btn--lg" (click)="cancelInstall()">Cancel</button>
          <button
            type="button"
            class="btn btn--solid btn--lg"
            [disabled]="busyId() === app.id"
            (click)="confirmInstall()"
          >
            {{ busyId() === app.id ? 'Installing…' : 'Install' }}
          </button>
        </footer>
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .accent-text {
      color: var(--accent);
    }
    .filter {
      width: min(280px, 60vw);
    }
    .library-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
    }
    .library-item {
      display: flex;
      align-items: center;
      gap: 0.9rem;
      padding: 0.75rem 0.9rem;
      animation: rise-in 0.3s var(--ease) both;
      transition: border-color 0.15s;
    }
    .library-item:hover {
      border-color: var(--border);
    }
    .library-meta {
      flex: 1;
      min-width: 0;
    }
    .library-title-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.3rem 0.5rem;
    }
    .library-title {
      margin: 0;
      font-weight: 650;
      font-size: var(--fs-lg);
      letter-spacing: -0.01em;
    }
    .library-desc {
      margin: 0.15rem 0 0;
      color: var(--text-dim);
      font-size: var(--fs-sm);
    }
    .library-release {
      margin: 0.2rem 0 0;
      font-family: var(--mono);
      font-size: 0.72rem;
      letter-spacing: 0.01em;
      color: var(--text-muted);
    }
    .library-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      align-items: center;
      gap: 0.4rem;
      flex: 0 0 auto;
    }
    .view-switch {
      display: inline-flex;
      gap: 0.25rem;
    }
    .library-list.is-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 0.65rem;
      align-items: stretch;
    }
    .library-list.is-grid .library-item {
      flex-direction: column;
      align-items: flex-start;
      align-content: flex-start;
      gap: 0.75rem;
      height: 100%;
      padding: 0.95rem;
    }
    .library-list.is-grid .library-meta {
      width: 100%;
    }
    .library-list.is-grid .library-desc {
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .library-list.is-grid .library-actions {
      width: 100%;
      margin-top: auto;
      justify-content: flex-start;
    }
    .install-head {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .modal-note {
      margin: 0;
      color: var(--text-dim);
      font-size: var(--fs-md);
    }
    .field-list {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
    @media (max-width: 640px) {
      .library-item {
        flex-wrap: wrap;
      }
      .library-actions {
        width: 100%;
        justify-content: flex-start;
      }
    }
  `,
})
export class LibraryPage implements OnInit {
  private readonly dash = inject(DashboardService);
  readonly query = signal('');
  readonly view = signal<LibraryView>(readView());
  readonly error = signal<string | null>(null);
  readonly apps = signal<CatalogItem[]>([]);
  readonly busyId = signal<string | null>(null);
  readonly installing = signal<CatalogItem | null>(null);
  installDraft: Record<string, string | boolean> = {};
  readonly setupBlocked = computed(() => this.dash.labStatus()?.needsHostIp === true);
  readonly runningCount = computed(() => this.apps().filter((a) => a.status === 'running').length);
  readonly updateCount = computed(
    () => this.dash.appsWithUpdates().filter((app) => app.id !== 'control-center').length
  );
  readonly statusLabel = statusLabel;
  readonly tone = statusTone;
  readonly canOpen = canOpenApp;

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.installing()) this.cancelInstall();
  }

  setView(next: LibraryView): void {
    this.view.set(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* preference is optional */
    }
  }

  categoryColor(category?: string): string {
    return CATEGORY_COLORS[(category || '').toLowerCase()] ?? 'var(--cat-other)';
  }

  releaseLine(app: CatalogItem): string | null {
    return formatRelease(app.version, app.releasedAt);
  }

  filteredApps(): CatalogItem[] {
    const q = this.query().trim().toLowerCase();
    let list = [...this.apps()];
    if (q) {
      list = list.filter((a) =>
        [a.name, a.id, a.description, a.category].join(' ').toLowerCase().includes(q)
      );
    }
    const order: Record<string, number> = {
      removed: 0,
      available: 1,
      stopped: 2,
      installed: 2,
      running: 3,
    };
    return list.sort(
      (a, b) =>
        Number(this.hasUpdate(b.id)) - Number(this.hasUpdate(a.id)) ||
        (order[a.status ?? ''] ?? 9) - (order[b.status ?? ''] ?? 9) ||
        a.name.localeCompare(b.name)
    );
  }

  ngOnInit(): void {
    forkJoin([this.dash.load(), this.dash.loadCatalog()]).subscribe({
      next: () => {
        this.apps.set(libraryApps(this.dash.catalog()));
        this.dash.loadUpdates(false).subscribe({ error: () => undefined });
      },
      error: (err: Error) => this.error.set(err.message),
    });
    this.dash.loadLabStatus().subscribe({ error: () => undefined });
  }

  hasUpdate(id: string): boolean {
    return this.dash.updateAvailable(id);
  }

  ipUrl(app: CatalogItem): string | null {
    const status = this.dash.labStatus();
    return ipAppUrl(app, status?.hostIp, status?.needsHostIp);
  }

  openUrl(app: CatalogItem): string {
    return openAppUrl(app);
  }

  refresh(): void {
    this.dash.loadCatalog().subscribe({
      next: (apps) => {
        this.apps.set(libraryApps(apps));
        this.dash.loadUpdates(true).subscribe({ error: () => undefined });
      },
      error: (err: Error) => this.error.set(err.message),
    });
  }

  beginInstall(app: CatalogItem): void {
    if (this.setupBlocked()) return;
    this.installDraft = {};
    for (const field of app.fields || []) {
      this.installDraft[field.key || ''] = this.defaultFieldValue(field);
    }
    this.installing.set(app);
  }

  cancelInstall(): void {
    this.installing.set(null);
    this.installDraft = {};
  }

  /** Enabled in the lab config, but no container yet — Install creates it. */
  install(app: CatalogItem): void {
    if (this.setupBlocked()) return;
    this.busyId.set(app.id);
    this.dash.installApp(app.id, {}).subscribe({
      next: () => {
        this.busyId.set(null);
        this.refresh();
      },
      error: (err: Error) => {
        this.busyId.set(null);
        alert(err.message);
        this.refresh();
      },
    });
  }

  confirmInstall(): void {
    const app = this.installing();
    if (!app) return;

    for (const field of app.fields || []) {
      if (!field.required || !field.key) continue;
      const value = this.installDraft[field.key];
      if (field.type === 'boolean') continue;
      if (value === undefined || value === null || String(value).trim() === '') {
        alert(`${field.label || field.key} is required`);
        return;
      }
    }

    this.busyId.set(app.id);
    this.dash.installApp(app.id, { ...this.installDraft }).subscribe({
      next: () => {
        this.busyId.set(null);
        this.cancelInstall();
        this.refresh();
      },
      error: (err: Error) => {
        this.busyId.set(null);
        alert(err.message);
      },
    });
  }

  private defaultFieldValue(field: RecipeField): string | boolean {
    if (field.type === 'boolean') {
      const d = field.default;
      if (typeof d === 'boolean') return d;
      if (d && typeof d === 'object' && 'valueKind' in d) return false;
      return d === true || d === 'true';
    }
    const d = field.default;
    if (d == null) return '';
    if (typeof d === 'string' || typeof d === 'number' || typeof d === 'boolean') return String(d);
    return '';
  }

  start(app: CatalogItem): void {
    this.busyId.set(app.id);
    this.dash.startApp(app.id).subscribe({
      next: () => {
        this.busyId.set(null);
        this.refresh();
      },
      error: (err: Error) => {
        this.busyId.set(null);
        alert(err.message);
      },
    });
  }

  update(app: CatalogItem): void {
    if (!confirm(`Pull and recreate ${app.name}?`)) return;
    this.busyId.set(app.id);
    this.dash.updateApp(app.id).subscribe({
      next: () => {
        this.busyId.set(null);
        this.refresh();
      },
      error: (err: Error) => {
        this.busyId.set(null);
        alert(err.message);
      },
    });
  }

  uninstall(app: CatalogItem): void {
    if (!confirm(`Uninstall ${app.name}?\n\nContainers will stop. Data volumes are kept.`)) return;
    this.dash.uninstallApp(app.id).subscribe({
      next: () => this.refresh(),
      error: (err: Error) => alert(err.message),
    });
  }
}
