import { Component, ElementRef, HostListener, OnInit, ViewChild, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CatalogItem } from '../../api/generated';
import { canOpenApp, ipAppUrl, openAppUrl } from '../../core/app-links';
import { statusLabel, statusTone } from '../../core/app-status';
import { DashboardService } from '../../core/services/dashboard.service';
import { CatalogMark } from '../../shared/catalog-mark';
import { Icon } from '../../shared/icon';

const CATEGORY_COLORS: Record<string, string> = {
  productivity: 'var(--cat-productivity)',
  media: 'var(--cat-media)',
  tools: 'var(--cat-tools)',
  infrastructure: 'var(--cat-infrastructure)',
};

type PaletteRow =
  | { kind: 'app'; app: CatalogItem }
  | { kind: 'web'; query: string };

@Component({
  selector: 'app-command-palette',
  imports: [FormsModule, CatalogMark, Icon],
  template: `
    <div class="overlay" (click)="closed.emit()"></div>
    <div
      class="modal palette"
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      (keydown)="onKey($event)"
    >
      <label class="palette-search input-icon">
        <span class="sr-only">Search stacks or the web</span>
        <app-icon name="search" [size]="16" />
        <input
          #queryInput
          class="input"
          type="search"
          placeholder="Search stacks or the web…"
          [ngModel]="query()"
          (ngModelChange)="onQuery($event)"
          autocomplete="off"
          spellcheck="false"
        />
      </label>

      <ul class="palette-list" role="listbox">
        @for (row of rows(); track trackRow(row); let i = $index) {
          @if (row.kind === 'app') {
            <li class="palette-item" [class.is-active]="i === active()">
              <button
                type="button"
                class="palette-row"
                role="option"
                [disabled]="!canOpen(row.app)"
                (mouseenter)="active.set(i)"
                (click)="activate(i)"
              >
                <app-catalog-mark
                  [id]="row.app.id"
                  [name]="row.app.name"
                  [color]="categoryColor(row.app.category)"
                  [size]="32"
                />
                <span class="palette-copy">
                  <span class="palette-title">{{ row.app.name }}</span>
                  <span class="palette-meta">
                    <span
                      class="badge"
                      [class.badge--positive]="tone(row.app.status) === 'positive'"
                      [class.badge--accent]="tone(row.app.status) === 'accent'"
                      [class.badge--negative]="tone(row.app.status) === 'negative'"
                      >{{ statusLabel(row.app.status) }}</span
                    >
                    @if (row.app.description) {
                      <span class="palette-desc">{{ row.app.description }}</span>
                    }
                  </span>
                </span>
                @if (canOpen(row.app)) {
                  <span class="palette-hint">Open</span>
                }
              </button>
              @if (ipUrl(row.app); as viaIp) {
                <a class="palette-ip" [href]="viaIp" target="_blank" rel="noopener" [title]="viaIp" (click)="closed.emit()"
                  >IP</a
                >
              }
            </li>
          } @else {
            <li class="palette-item" [class.is-active]="i === active()">
              <button
                type="button"
                class="palette-row"
                role="option"
                (mouseenter)="active.set(i)"
                (click)="activate(i)"
              >
                <span class="palette-web-mark" aria-hidden="true">
                  <app-icon name="search" [size]="16" />
                </span>
                <span class="palette-copy">
                  <span class="palette-title">Search the web</span>
                  <span class="palette-desc">{{ row.query }}</span>
                </span>
                <span class="palette-hint">Web</span>
              </button>
            </li>
          }
        } @empty {
          <li class="empty-note">No matching apps.</li>
        }
      </ul>
      <p class="palette-foot">↑↓ move · Enter open · Esc close</p>
    </div>
  `,
  styles: `
    .modal.palette {
      top: 14vh;
      transform: translate(-50%, 0);
      width: min(560px, calc(100vw - 2rem));
      padding-top: 0.35rem;
      animation-name: palette-in;
    }
    .palette-search {
      padding: 0.65rem 0.85rem 0.35rem;
    }
    .palette-search .input {
      height: 42px;
      border: 0;
      background: transparent;
      box-shadow: none;
      font-size: 1rem;
    }
    .palette-search .input:focus {
      border-color: transparent;
      box-shadow: none;
    }
    .palette-list {
      list-style: none;
      margin: 0;
      padding: 0.35rem;
      max-height: min(420px, 50dvh);
      overflow: auto;
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
    }
    .palette-item {
      display: flex;
      align-items: center;
      border-radius: var(--radius-sm);
    }
    .palette-item.is-active {
      background: var(--inset);
    }
    .palette-row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      width: 100%;
      min-height: 52px;
      padding: 0.45rem 0.6rem;
      border: 0;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--text);
      text-align: left;
      cursor: pointer;
    }
    .palette-row:disabled {
      cursor: default;
      opacity: 0.72;
    }
    .palette-row.is-active {
      background: transparent;
    }
    .palette-copy {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      min-width: 0;
      flex: 1;
    }
    .palette-title {
      font-weight: 650;
      letter-spacing: -0.01em;
    }
    .palette-meta {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      min-width: 0;
    }
    .palette-desc {
      color: var(--text-muted);
      font-size: var(--fs-sm);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .palette-hint {
      flex: 0 0 auto;
      color: var(--text-dim);
      font-family: var(--mono);
      font-size: 0.68rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .palette-web-mark {
      display: inline-grid;
      place-items: center;
      width: 32px;
      height: 32px;
      border-radius: 9px;
      border: 1px solid var(--border-soft);
      background: var(--inset);
      color: var(--text-muted);
    }
    .palette-ip {
      flex: 0 0 auto;
      margin-right: 0.55rem;
      color: var(--text-muted);
      font-family: var(--mono);
      font-size: 0.68rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      text-decoration: none;
    }
    .palette-ip:hover {
      color: var(--accent);
    }
    .palette-foot {
      margin: 0;
      padding: 0.55rem 0.95rem 0.7rem;
      border-top: 1px solid var(--border-soft);
      color: var(--text-dim);
      font-size: var(--fs-xs);
    }
    @keyframes palette-in {
      from {
        opacity: 0;
        transform: translate(-50%, 8px);
      }
    }
  `,
})
export class CommandPalette implements OnInit {
  private readonly dash = inject(DashboardService);
  readonly closed = output<void>();
  readonly query = signal('');
  readonly active = signal(0);
  readonly statusLabel = statusLabel;
  readonly tone = statusTone;
  readonly canOpen = canOpenApp;

  @ViewChild('queryInput') private queryInput?: ElementRef<HTMLInputElement>;

  readonly rows = computed<PaletteRow[]>(() => {
    const q = this.query().trim().toLowerCase();
    let apps = this.dash.catalog().filter((app) => app.id !== 'control-center');
    if (q) {
      apps = apps.filter((app) =>
        [app.name, app.id, app.description, app.category].join(' ').toLowerCase().includes(q)
      );
    } else {
      apps = apps.filter((app) => app.status === 'running' || app.status === 'stopped' || app.status === 'installed');
    }
    apps.sort(
      (a, b) => Number(canOpenApp(b)) - Number(canOpenApp(a)) || a.name.localeCompare(b.name)
    );
    const rows: PaletteRow[] = apps.slice(0, 8).map((app) => ({ kind: 'app', app }));
    const typed = this.query().trim();
    if (typed) rows.push({ kind: 'web', query: typed });
    return rows;
  });

  ngOnInit(): void {
    queueMicrotask(() => this.queryInput?.nativeElement.focus());
  }

  onQuery(value: string): void {
    this.query.set(value);
    this.active.set(0);
  }

  categoryColor(category?: string | null): string {
    return CATEGORY_COLORS[(category || '').toLowerCase()] ?? 'var(--cat-other)';
  }

  ipUrl(app: CatalogItem): string | null {
    if (!canOpenApp(app)) return null;
    const status = this.dash.labStatus();
    return ipAppUrl(app, status?.hostIp, status?.needsHostIp);
  }

  trackRow(row: PaletteRow): string {
    return row.kind === 'app' ? row.app.id : `web:${row.query}`;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closed.emit();
  }

  onKey(event: KeyboardEvent): void {
    const rows = this.rows();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!rows.length) return;
      this.active.set((this.active() + 1) % rows.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!rows.length) return;
      this.active.set((this.active() - 1 + rows.length) % rows.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      this.activate(this.active());
    }
  }

  activate(index: number): void {
    const row = this.rows()[index];
    if (!row) return;
    if (row.kind === 'web') {
      const engine = this.dash.document()?.search?.engine || 'https://duckduckgo.com/?q=%s';
      window.open(engine.replace('%s', encodeURIComponent(row.query)), '_blank', 'noopener,noreferrer');
      this.closed.emit();
      return;
    }
    if (!canOpenApp(row.app)) return;
    window.open(openAppUrl(row.app), '_blank', 'noopener,noreferrer');
    this.closed.emit();
  }
}
