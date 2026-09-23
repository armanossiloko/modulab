import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { DashboardService } from '../../core/services/dashboard.service';
import { DashboardGrid } from '../../grid/dashboard-grid';
import { AddWidgetPanel } from '../../widgets/add-widget-panel';
import { PageItem } from '../../core/models/dashboard';
import { Icon } from '../../shared/icon';

@Component({
  selector: 'app-home-page',
  imports: [DashboardGrid, AddWidgetPanel, Icon],
  template: `
    <header class="page-header">
      <div class="page-header__titles">
        <h1 class="page-title">{{ dash.pageTitle(dash.activeDashboard()) }}</h1>
        @if (dash.editMode()) {
          <p class="page-subtitle edit-hint">
            <span class="badge badge--accent">Editing</span>
            Drag to move · pull the corner to resize · changes save automatically
          </p>
        }
      </div>
      <div class="page-header__actions">
        @if (dash.editMode()) {
          @if (dash.activeDashboardId() === 'home') {
            <button type="button" class="btn btn--ghost" (click)="resetLayout()">
              <app-icon name="reset" [size]="14" />
              Reset
            </button>
          }
          <button type="button" class="btn" (click)="showAdd.set(true)">
            <app-icon name="plus" [size]="14" />
            Add widget
          </button>
          <button
            type="button"
            class="btn btn--solid"
            aria-pressed="true"
            (click)="onEdit(false)"
          >
            <app-icon name="check" [size]="14" />
            Done
          </button>
        } @else {
          <button
            type="button"
            class="icon-btn"
            title="Edit layout"
            aria-label="Edit layout"
            aria-pressed="false"
            (click)="onEdit(true)"
          >
            <app-icon name="edit" />
          </button>
        }
      </div>
    </header>

    @if (error()) {
      <p class="empty-note">{{ error() }}</p>
    } @else if (!ready()) {
      <p class="empty-note">Loading dashboard…</p>
    } @else if (!dash.activeDashboard()) {
      <p class="empty-note">Dashboard not found.</p>
    } @else {
      <app-dashboard-grid />
    }

    @if (showAdd()) {
      <app-add-widget-panel (added)="onAdded($event)" (closed)="showAdd.set(false)" />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }
    .page-header {
      flex: 0 0 auto;
      margin-bottom: var(--space-2);
      min-height: var(--control-h);
    }
    .edit-hint {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      animation: rise-in 0.2s var(--ease) both;
    }
    app-dashboard-grid {
      flex: 1;
      min-height: 0;
      margin: 0 -2px;
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
