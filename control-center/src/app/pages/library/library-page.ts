import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { CatalogItem } from '../../api/generated';
import { DashboardService } from '../../core/services/dashboard.service';

@Component({
  selector: 'app-library-page',
  imports: [FormsModule],
  template: `
    <section class="library">
      <header class="library-head">
        <h1>Library</h1>
        <input
          class="search"
          type="search"
          placeholder="Filter library…"
          [ngModel]="query()"
          (ngModelChange)="query.set($event)"
        />
      </header>

      @if (error()) {
        <p class="empty-note">{{ error() }}</p>
      } @else {
        <ul class="library-list">
          @for (app of filteredApps(); track app.id) {
            <li class="library-item">
              <div class="library-meta">
                <p class="library-title">{{ app.name }}</p>
                <p class="library-desc">{{ app.description || '' }}</p>
                <div class="library-badges">
                  <span
                    class="library-status"
                    [class.is-running]="app.status === 'running'"
                    [class.is-available]="app.status === 'available'"
                    [class.is-removed]="app.status === 'removed'"
                    >{{ app.status }}</span
                  >
                  @if (hasUpdate(app.id)) {
                    <span class="library-status is-update">update</span>
                  }
                </div>
              </div>
              <div class="library-actions">
                @if (app.status === 'available' && app.installable !== false) {
                  <button type="button" class="btn btn--primary" (click)="install(app)">
                    Install
                  </button>
                }
                @if (app.status === 'removed') {
                  <button type="button" class="btn btn--primary" (click)="start(app)">
                    Reinstall
                  </button>
                }
                @if (app.status === 'running' && (app.url || app.port)) {
                  <a class="btn btn--primary" [href]="openUrl(app)" target="_blank" rel="noopener"
                    >Open</a
                  >
                }
                @if (app.status === 'stopped' || app.status === 'installed') {
                  <button type="button" class="btn" (click)="start(app)">Start</button>
                }
                @if (hasUpdate(app.id)) {
                  <button
                    type="button"
                    class="btn btn--primary"
                    [disabled]="busyId() === app.id"
                    (click)="update(app)"
                  >
                    {{ busyId() === app.id ? 'Updating…' : 'Update' }}
                  </button>
                }
                @if (
                  !app.core &&
                  (app.status === 'stopped' ||
                    app.status === 'installed' ||
                    app.status === 'running' ||
                    app.status === 'removed')
                ) {
                  <button type="button" class="btn btn--danger btn--sm" (click)="uninstall(app)">
                    Uninstall
                  </button>
                }
              </div>
            </li>
          } @empty {
            <li class="empty-note">No recipes found.</li>
          }
        </ul>
      }
    </section>
  `,
  styles: `
    .library-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      margin-bottom: 1rem;
    }
    .library-head h1 {
      margin: 0;
      font-size: 1.25rem;
      letter-spacing: -0.02em;
    }
    .search {
      min-width: min(280px, 100%);
      height: var(--control-h);
      padding: 0 0.85rem;
      border-radius: var(--radius);
      border: 1px solid var(--border);
      background: var(--widget);
      color: var(--text);
      font: inherit;
    }
    .search:focus {
      outline: none;
      border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
      box-shadow: 0 0 0 3px var(--accent-soft);
    }
    .library-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
    }
    .library-item {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 0.75rem 1rem;
      padding: 0.9rem 1rem;
      border-radius: var(--radius);
      background: var(--widget);
      border: 1px solid var(--border);
    }
    .library-title {
      margin: 0;
      font-weight: 600;
      letter-spacing: -0.01em;
    }
    .library-desc {
      margin: 0.25rem 0 0.45rem;
      color: var(--text-dim);
      font-size: 0.9rem;
    }
    .library-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      align-items: center;
    }
    .library-status {
      display: inline-block;
      font-family: var(--mono);
      font-size: 0.68rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--text-muted);
    }
    .library-status.is-running {
      color: var(--positive);
      background: var(--positive-soft);
      padding: 0.12rem 0.4rem;
      border-radius: 999px;
    }
    .library-status.is-available {
      color: var(--accent);
      background: var(--accent-soft);
      padding: 0.12rem 0.4rem;
      border-radius: 999px;
    }
    .library-status.is-removed {
      color: var(--negative);
    }
    .library-status.is-update {
      color: var(--accent);
      background: var(--accent-soft);
      padding: 0.12rem 0.4rem;
      border-radius: 999px;
    }
    .library-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      align-items: flex-start;
    }
  `,
})
export class LibraryPage implements OnInit {
  private readonly dash = inject(DashboardService);
  readonly query = signal('');
  readonly error = signal<string | null>(null);
  readonly apps = signal<CatalogItem[]>([]);
  readonly busyId = signal<string | null>(null);

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
        this.apps.set(this.dash.catalog());
        this.dash.loadUpdates(false).subscribe({ error: () => undefined });
      },
      error: (err: Error) => this.error.set(err.message),
    });
  }

  hasUpdate(id: string): boolean {
    return this.dash.updateAvailable(id);
  }

  openUrl(app: CatalogItem): string {
    if (app.url) return app.url;
    const path = app.path || '';
    return `http://127.0.0.1:${app.port}${path}`;
  }

  refresh(): void {
    this.dash.loadCatalog().subscribe({
      next: (apps) => {
        this.apps.set(apps);
        this.dash.loadUpdates(true).subscribe({ error: () => undefined });
      },
      error: (err: Error) => this.error.set(err.message),
    });
  }

  install(app: CatalogItem): void {
    if (!confirm(`Install ${app.name} with default options?`)) return;
    this.dash.installApp(app.id, {}).subscribe({
      next: () => this.refresh(),
      error: (err: Error) => alert(err.message),
    });
  }

  start(app: CatalogItem): void {
    this.dash.startApp(app.id).subscribe({
      next: () => this.refresh(),
      error: (err: Error) => alert(err.message),
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
