import { Component, OnInit, inject, computed, HostListener } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DashboardService } from '../../core/services/dashboard.service';
import { resolveBookmarkColor } from '../../core/services/layout-migrate';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, FormsModule],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell implements OnInit {
  readonly dash = inject(DashboardService);
  search = '';
  private resizing = false;

  readonly brand = computed(() => this.dash.document()?.title || 'Modulab');
  readonly bookmarkGroups = computed(() =>
    (this.dash.document()?.sidebar?.bookmarks || []).filter((g) => g.enabled !== false)
  );
  readonly foot = computed(() => 'Control Center');

  ngOnInit(): void {
    const stored = localStorage.getItem('modulab.sidebarWidth');
    if (stored) {
      document.documentElement.style.setProperty('--sidebar', `${stored}px`);
    }
    this.dash.load().subscribe();
  }

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

  onSearchKey(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    const q = this.search.trim();
    if (!q) return;
    const engine =
      this.dash.document()?.search?.engine || 'https://duckduckgo.com/?q=%s';
    window.open(engine.replace('%s', encodeURIComponent(q)), '_blank', 'noopener,noreferrer');
  }

  refresh(): void {
    this.dash.load().subscribe();
    this.dash.loadCatalog().subscribe();
  }

  startResize(event: PointerEvent): void {
    event.preventDefault();
    this.resizing = true;
    document.body.classList.add('is-resizing-sidebar');
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  @HostListener('document:pointermove', ['$event'])
  onPointerMove(event: PointerEvent): void {
    if (!this.resizing) return;
    const min = 160;
    const max = 420;
    const width = Math.min(max, Math.max(min, event.clientX));
    document.documentElement.style.setProperty('--sidebar', `${width}px`);
  }

  @HostListener('document:pointerup')
  endResize(): void {
    if (!this.resizing) return;
    this.resizing = false;
    document.body.classList.remove('is-resizing-sidebar');
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--sidebar').trim();
    const px = parseInt(raw, 10);
    if (!Number.isNaN(px)) localStorage.setItem('modulab.sidebarWidth', String(px));
  }
}
