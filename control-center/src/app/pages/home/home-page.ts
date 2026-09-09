import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { DashboardService } from '../../core/services/dashboard.service';
import { DashboardGrid } from '../../grid/dashboard-grid';
import { AddWidgetPanel } from '../../widgets/add-widget-panel';
import { PageItem } from '../../core/models/dashboard';

@Component({
  selector: 'app-home-page',
  imports: [DashboardGrid, FormsModule, AddWidgetPanel],
  template: `
    <div class="home">
      <div class="home-toolbar">
        <label class="edit-toggle">
          <input type="checkbox" [ngModel]="dash.editMode()" (ngModelChange)="onEdit($event)" />
          Edit layout
        </label>
        @if (dash.editMode()) {
          <button type="button" class="btn btn--sm btn--primary" (click)="showAdd.set(true)">
            Add widget
          </button>
          <button type="button" class="btn btn--sm" (click)="resetLayout()">Reset to default</button>
          <span class="hint">Drag, resize, add, or remove · auto-saves</span>
        }
      </div>
      @if (error()) {
        <p class="empty-note">{{ error() }}</p>
      } @else if (!ready()) {
        <p class="empty-note">Loading dashboard…</p>
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
      flex-wrap: wrap;
      gap: 0.75rem;
      margin-bottom: 0.55rem;
      flex: 0 0 auto;
    }
    .edit-toggle {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      min-height: 34px;
      padding: 0.35rem 0.7rem;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      background: var(--widget);
      font-size: 0.82rem;
      font-weight: 500;
      color: var(--text-dim);
      cursor: pointer;
      user-select: none;
      transition: color 0.15s, border-color 0.15s, background 0.15s;
    }
    .edit-toggle:hover {
      color: var(--text);
      background: var(--widget-hover);
    }
    .edit-toggle:has(input:checked) {
      color: var(--accent);
      border-color: var(--accent-border);
      background: var(--accent-soft);
    }
    .edit-toggle input {
      accent-color: var(--accent);
      margin: 0;
    }
    .hint {
      font-size: 0.78rem;
      color: var(--text-muted);
    }
    app-dashboard-grid {
      flex: 1;
      min-height: 0;
    }
  `,
})
export class HomePage implements OnInit {
  readonly dash = inject(DashboardService);
  readonly ready = signal(false);
  readonly error = signal<string | null>(null);
  readonly showAdd = signal(false);

  ngOnInit(): void {
    forkJoin([this.dash.load(), this.dash.loadCatalog()]).subscribe({
      next: () => this.ready.set(true),
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
      error: (err: Error) => alert(err.message),
    });
  }
}
