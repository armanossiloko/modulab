import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { CatalogItem, RecipeField } from '../../api/generated';
import { DashboardService } from '../../core/services/dashboard.service';

@Component({
  selector: 'app-library-page',
  imports: [FormsModule, RouterLink],
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

      @if (setupBlocked()) {
        <p class="setup-banner">
          Set your LAN host IP in
          <a routerLink="/settings/lab">Settings → Lab</a>
          before installing apps.
        </p>
      }

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
                    >{{ statusLabel(app.status) }}</span
                  >
                  @if (hasUpdate(app.id)) {
                    <span class="library-status is-update">update</span>
                  }
                </div>
              </div>
              <div class="library-actions">
                @if (app.status === 'available' && app.installable !== false) {
                  <button
                    type="button"
                    class="btn btn--primary"
                    [disabled]="setupBlocked()"
                    (click)="beginInstall(app)"
                  >
                    Install
                  </button>
                }
                @if (app.status === 'removed' && !app.core) {
                  <button
                    type="button"
                    class="btn btn--primary"
                    [disabled]="busyId() === app.id"
                    (click)="start(app)"
                  >
                    {{ busyId() === app.id ? 'Starting…' : 'Start' }}
                  </button>
                }
                @if (
                  (app.status === 'running' || (app.core && app.status === 'removed')) &&
                  (app.url || app.port)
                ) {
                  <a class="btn btn--primary" [href]="openUrl(app)" target="_blank" rel="noopener"
                    >Open</a
                  >
                }
                @if ((app.status === 'stopped' || app.status === 'installed') && !app.core) {
                  <button
                    type="button"
                    class="btn"
                    [disabled]="busyId() === app.id"
                    (click)="start(app)"
                  >
                    {{ busyId() === app.id ? 'Starting…' : 'Start' }}
                  </button>
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

      @if (installing()) {
        <div class="modal-backdrop" (click)="cancelInstall()"></div>
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="install-title">
          <h2 id="install-title">Install {{ installing()!.name }}</h2>
          @if ((installing()!.fields.length) === 0) {
            <p class="modal-note">No extra options — install with recipe defaults?</p>
          } @else {
            <div class="field-list">
              @for (field of installing()!.fields; track field.key) {
                <label class="field">
                  <span
                    >{{ field.label || field.key
                    }}@if (field.required) {
                      <span aria-hidden="true">*</span>
                    }</span
                  >
                  @if (field.type === 'boolean') {
                    <input type="checkbox" [(ngModel)]="installDraft[field.key!]" />
                  } @else {
                    <input
                      [type]="field.type === 'password' ? 'password' : 'text'"
                      [(ngModel)]="installDraft[field.key!]"
                      [required]="!!field.required"
                    />
                  }
                </label>
              }
            </div>
          }
          <div class="modal-actions">
            <button type="button" class="btn" (click)="cancelInstall()">Cancel</button>
            <button
              type="button"
              class="btn btn--primary"
              [disabled]="busyId() === installing()!.id"
              (click)="confirmInstall()"
            >
              {{ busyId() === installing()!.id ? 'Installing…' : 'Install' }}
            </button>
          </div>
        </div>
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
    .setup-banner {
      margin: 0 0 1rem;
      padding: 0.75rem 1rem;
      border-radius: var(--radius);
      border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--border));
      background: var(--accent-soft, color-mix(in srgb, var(--accent) 12%, transparent));
      color: var(--text);
      font-size: 0.92rem;
    }
    .setup-banner a {
      color: var(--accent);
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
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.45);
      z-index: 40;
    }
    .modal {
      position: fixed;
      z-index: 50;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      width: min(420px, calc(100vw - 2rem));
      padding: 1.1rem 1.2rem;
      border-radius: var(--radius);
      background: var(--widget);
      border: 1px solid var(--border);
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
    }
    .modal h2 {
      margin: 0 0 0.75rem;
      font-size: 1.1rem;
    }
    .modal-note {
      margin: 0 0 1rem;
      color: var(--text-dim);
      font-size: 0.92rem;
    }
    .field-list {
      display: flex;
      flex-direction: column;
      gap: 0.65rem;
      margin-bottom: 1rem;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
      font-size: 0.88rem;
    }
    .field input[type='text'],
    .field input[type='password'] {
      height: var(--control-h);
      padding: 0 0.75rem;
      border-radius: var(--radius);
      border: 1px solid var(--border);
      background: var(--bg, #111);
      color: var(--text);
      font: inherit;
    }
    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
    }
  `,
})
export class LibraryPage implements OnInit {
  private readonly dash = inject(DashboardService);
  readonly query = signal('');
  readonly error = signal<string | null>(null);
  readonly apps = signal<CatalogItem[]>([]);
  readonly busyId = signal<string | null>(null);
  readonly installing = signal<CatalogItem | null>(null);
  installDraft: Record<string, string | boolean> = {};
  readonly setupBlocked = computed(() => this.dash.labStatus()?.needsHostIp === true);

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
    this.dash.loadLabStatus().subscribe({ error: () => undefined });
  }

  hasUpdate(id: string): boolean {
    return this.dash.updateAvailable(id);
  }

  /** Prefer LAN hostname when the UI is opened remotely; keep port for direct access. */
  openUrl(app: CatalogItem): string {
    const path = app.path || '';
    const host = window.location.hostname || '127.0.0.1';
    const port = app.port;
    if (!port) return `http://${host}${path}`;

    // If Control Center is reached via home.network.lan, open peer hostnames on the same domain.
    const parts = host.split('.');
    if (parts.length >= 2 && host !== '127.0.0.1' && host !== 'localhost') {
      const domain = parts.slice(1).join('.');
      const label = this.proxyLabel(app);
      if (label && !/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
        return `http://${label}.${domain}${path}`;
      }
    }

    return `http://${host}:${port}${path}`;
  }

  private proxyLabel(app: CatalogItem): string | null {
    // Recipe proxy host usually matches dns label; fall back to id with common aliases.
    const aliases: Record<string, string> = {
      'stirling-pdf': 'stirling',
      'futo-notes': 'notes',
      'control-center': 'home',
      'it-tools': 'it-tools',
    };
    return aliases[app.id] || app.id;
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

  statusLabel(status: string): string {
    if (status === 'removed') return 'not running';
    return status;
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
