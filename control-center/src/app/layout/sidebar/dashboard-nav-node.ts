import { Component, Input, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { DashboardTreeNode } from '../../core/models/dashboard';
import { DashboardService } from '../../core/services/dashboard.service';

@Component({
  selector: 'app-dashboard-nav-node',
  imports: [RouterLink, RouterLinkActive, DashboardNavNode],
  template: `
    <div class="dash-node">
      <div class="dash-row">
        <a
          class="page-tab"
          [routerLink]="['/d', node.board.id]"
          routerLinkActive="is-active"
          [style.paddingLeft.rem]="0.85 + node.depth * 0.75"
        >
          {{ node.board.title }}
        </a>
        <div class="dash-actions">
          <button type="button" class="mini" title="Add nested" (click)="addChild($event)">+</button>
          <button type="button" class="mini" title="Rename" (click)="rename($event)">✎</button>
          @if (node.board.id !== 'home') {
            <button type="button" class="mini danger" title="Delete" (click)="remove($event)">×</button>
          }
        </div>
      </div>
      @for (child of node.children; track child.board.id) {
        <app-dashboard-nav-node [node]="child" />
      }
    </div>
  `,
  styles: `
    .dash-row {
      display: flex;
      align-items: center;
      gap: 0.15rem;
    }
    .dash-row .page-tab {
      flex: 1;
      min-width: 0;
    }
    .dash-actions {
      display: none;
      flex: 0 0 auto;
      gap: 0.1rem;
    }
    .dash-row:hover .dash-actions {
      display: inline-flex;
    }
    .mini {
      width: 22px;
      height: 22px;
      padding: 0;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 0.85rem;
      line-height: 1;
    }
    .mini:hover {
      color: var(--text);
      background: var(--widget-hover);
    }
    .mini.danger:hover {
      color: var(--negative);
    }
    .page-tab {
      position: relative;
      display: block;
      width: 100%;
      padding: 0.45rem 0.65rem 0.45rem 0.85rem;
      border-radius: var(--radius-sm);
      color: var(--text-muted);
      text-decoration: none;
      font-weight: 500;
      font-size: 0.92rem;
      letter-spacing: -0.01em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .page-tab::before {
      content: '';
      position: absolute;
      left: 0;
      top: 50%;
      width: 2px;
      height: 0;
      border-radius: 1px;
      background: var(--accent);
      transform: translateY(-50%);
      transition: height 0.15s ease;
    }
    .page-tab:hover {
      color: var(--text);
      background: hsl(240, 7%, 14%);
    }
    .page-tab.is-active {
      color: var(--text);
      font-weight: 600;
    }
    .page-tab.is-active::before {
      height: 1.05rem;
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
