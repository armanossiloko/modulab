import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { DashboardService } from '../../core/services/dashboard.service';
import { DashboardGrid } from '../../grid/dashboard-grid';
import { AddWidgetPanel } from '../../widgets/add-widget-panel';
import { PageItem } from '../../core/models/dashboard';

@Component({
  selector: 'app-home-page',
  imports: [DashboardGrid, AddWidgetPanel],
  template: `
    <div class="home">
      <div class="home-toolbar">
        <h1 class="board-title">{{ dash.pageTitle(dash.activeDashboard()) }}</h1>
        <div class="toolbar-actions">
          @if (dash.editMode()) {
            <span class="hint">Drag · resize · auto-saves</span>
            <button
              type="button"
              class="icon-btn"
              title="Add widget"
              aria-label="Add widget"
              (click)="showAdd.set(true)"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M12 5v14M5 12h14"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                />
              </svg>
            </button>
            @if (dash.activeDashboardId() === 'home') {
              <button
                type="button"
                class="icon-btn"
                title="Reset to default"
                aria-label="Reset to default"
                (click)="resetLayout()"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </button>
            }
          }
          <button
            type="button"
            class="icon-btn"
            [class.is-active]="dash.editMode()"
            [title]="dash.editMode() ? 'Done editing' : 'Edit layout'"
            [attr.aria-label]="dash.editMode() ? 'Done editing' : 'Edit layout'"
            [attr.aria-pressed]="dash.editMode()"
            (click)="onEdit(!dash.editMode())"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3zM13 6l3 3"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
      @if (error()) {
        <p class="empty-note">{{ error() }}</p>
      } @else if (!ready()) {
        <p class="empty-note">Loading dashboard…</p>
      } @else if (!dash.activeDashboard()) {
        <p class="empty-note">Dashboard not found.</p>
      } @else {
        <app-dashboard-grid />
      }
    </div>

    @if (showAdd()) {
      <app-add-widget-panel (added)="onAdded($event)" (closed)="showAdd.set(false)" />
    }
  `,
  styles: `
    :host,
    .home {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }
    .home-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      margin-bottom: 0.55rem;
      flex: 0 0 auto;
    }
    .board-title {
      margin: 0;
      font-size: 1.05rem;
      font-weight: 650;
      letter-spacing: -0.02em;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .toolbar-actions {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      flex: 0 0 auto;
      margin-left: auto;
    }
    .hint {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-right: 0.25rem;
    }
    .icon-btn {
      width: 34px;
      height: 34px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      background: var(--widget);
      color: var(--text-dim);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      transition: color 0.15s, background 0.15s, border-color 0.15s;
    }
    .icon-btn svg {
      width: 16px;
      height: 16px;
      display: block;
    }
    .icon-btn:hover {
      color: var(--text);
      background: var(--widget-hover);
    }
    .icon-btn.is-active {
      color: var(--accent);
      border-color: var(--accent-border);
      background: var(--accent-soft);
    }
    app-dashboard-grid {
      flex: 1;
      min-height: 0;
    }
  `,
})
export class HomePage implements OnInit {
  readonly dash = inject(DashboardService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly ready = signal(false);
  readonly error = signal<string | null>(null);
  readonly showAdd = signal(false);

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id') || 'home';
      this.dash.setActiveDashboard(id);
      this.dash.setEditMode(false);
      this.showAdd.set(false);
      const boards = this.dash.dashboards();
      if (this.ready() && boards.length && !boards.some((b) => b.id === id)) {
        void this.router.navigate(['/d', boards[0].id]);
      }
    });

    forkJoin([this.dash.load(), this.dash.loadCatalog()]).subscribe({
      next: () => {
        this.ready.set(true);
        const id = this.route.snapshot.paramMap.get('id') || 'home';
        this.dash.setActiveDashboard(id);
        if (!this.dash.dashboards().some((b) => b.id === id)) {
          void this.router.navigate(['/d', this.dash.dashboards()[0]?.id || 'home']);
        }
      },
      error: (err: Error) => this.error.set(err.message),
    });
  }

  onEdit(on: boolean): void {
    this.dash.setEditMode(on);
    if (!on) this.showAdd.set(false);
  }

  onAdded(item: PageItem): void {
    this.dash.addWidget(item);
    this.showAdd.set(false);
  }

  resetLayout(): void {
    if (!confirm('Reset Home layout to the default (2-column main + right rail)?')) return;
    this.dash.resetLayoutToDefault().subscribe({
      next: () => void this.router.navigate(['/d/home']),
      error: (err: Error) => alert(err.message),
    });
  }
}
