import { Component, Input, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { DashboardTreeNode } from '../../core/models/dashboard';
import { DashboardService } from '../../core/services/dashboard.service';
import { Icon } from '../../shared/icon';

@Component({
  selector: 'app-dashboard-nav-node',
  imports: [RouterLink, RouterLinkActive, DashboardNavNode, Icon],
  template: `
    <div class="dash-row">
      <a
        class="nav-item"
        [routerLink]="['/d', node.board.id]"
        routerLinkActive="is-active"
        [style.paddingLeft.rem]="0.6 + node.depth * 0.9"
      >
        <app-icon [name]="node.depth ? 'subfolder' : 'grid'" />
        <span class="nav-item__label">{{ node.board.title }}</span>
      </a>
      <div class="dash-actions">
        <button
          type="button"
          class="icon-btn icon-btn--sm icon-btn--ghost"
          title="Add nested dashboard"
          aria-label="Add nested dashboard"
          (click)="addChild($event)"
        >
          <app-icon name="plus" [size]="13" />
        </button>
        <button
          type="button"
          class="icon-btn icon-btn--sm icon-btn--ghost"
          title="Rename"
          aria-label="Rename dashboard"
          (click)="rename($event)"
        >
          <app-icon name="edit" [size]="13" />
        </button>
        @if (node.board.id !== 'home') {
          <button
            type="button"
            class="icon-btn icon-btn--sm icon-btn--ghost icon-btn--danger"
            title="Delete"
            aria-label="Delete dashboard"
            (click)="remove($event)"
          >
            <app-icon name="close" [size]="13" />
          </button>
        }
      </div>
    </div>
    @for (child of node.children; track child.board.id) {
      <app-dashboard-nav-node [node]="child" />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .dash-row {
      position: relative;
      display: flex;
      align-items: center;
    }
    .dash-actions {
      position: absolute;
      right: 4px;
      top: 50%;
      transform: translateY(-50%);
      display: inline-flex;
      gap: 1px;
      padding-left: 1.25rem;
      border-radius: 0 var(--radius-xs) var(--radius-xs) 0;
      background: linear-gradient(90deg, transparent, var(--widget) 1.1rem);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.15s;
    }
    .dash-row:hover .dash-actions,
    .dash-row:focus-within .dash-actions {
      opacity: 1;
      pointer-events: auto;
    }
    .dash-row:hover .nav-item {
      color: var(--text);
      background: var(--widget);
    }
  `,
})
export class DashboardNavNode {
  @Input({ required: true }) node!: DashboardTreeNode;
  private readonly dash = inject(DashboardService);
  private readonly router = inject(Router);

  addChild(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    const title = window.prompt(`Nested dashboard under “${this.node.board.title}”`, 'New dashboard');
    if (!title?.trim()) return;
    this.dash.addDashboard({ title: title.trim(), parentId: this.node.board.id }).subscribe({
      next: (board) => void this.router.navigate(['/d', board.id]),
      error: (e: Error) => alert(e.message),
    });
  }

  rename(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    const title = window.prompt('Rename dashboard', this.node.board.title);
    if (!title?.trim() || title.trim() === this.node.board.title) return;
    this.dash.renameDashboard(this.node.board.id, title.trim()).subscribe({
      error: (e: Error) => alert(e.message),
    });
  }

  remove(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.node.board.id === 'home') return;
    const nested = this.node.children.length ? ' (and nested dashboards)' : '';
    if (!confirm(`Delete “${this.node.board.title}”${nested}?`)) return;
    this.dash.removeDashboard(this.node.board.id).subscribe({
      next: () => void this.router.navigate(['/d', this.dash.activeDashboardId()]),
      error: (e: Error) => alert(e.message),
    });
  }
}
