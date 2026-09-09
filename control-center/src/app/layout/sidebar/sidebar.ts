import { Component, inject, computed } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { DashboardService } from '../../core/services/dashboard.service';
import { resolveBookmarkColor } from '../../core/services/layout-migrate';
import { DashboardNavNode } from './dashboard-nav-node';

@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, RouterLinkActive, DashboardNavNode],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.scss',
})
export class Sidebar {
  readonly dash = inject(DashboardService);
  private readonly router = inject(Router);

  readonly brand = computed(() => this.dash.document()?.title || 'Modulab');
  readonly bookmarkGroups = computed(() =>
    (this.dash.sidebar()?.bookmarks || []).filter((g) => g.enabled !== false)
  );
  readonly tree = computed(() => this.dash.dashboardTree());

  color(token?: string): string {
    return resolveBookmarkColor(token);
  }

  favicon(domain?: string, url?: string): string {
    let host = domain || '';
    if (!host && url) {
      try {
        host = new URL(url).hostname;
      } catch {
        host = '';
      }
    }
    if (!host) return '';
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`;
  }

  addRoot(): void {
    const title = window.prompt('New dashboard name', 'New dashboard');
    if (!title?.trim()) return;
    this.dash.addDashboard({ title: title.trim(), parentId: null }).subscribe({
      next: (board) => void this.router.navigate(['/d', board.id]),
      error: (e: Error) => alert(e.message),
    });
  }
}
