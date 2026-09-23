import { Component, OnInit, inject, HostListener, computed } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DashboardService } from '../../core/services/dashboard.service';
import { Sidebar } from '../sidebar/sidebar';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, FormsModule, Sidebar],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell implements OnInit {
  readonly dash = inject(DashboardService);
  search = '';
  private resizing = false;
  readonly needsLabSetup = computed(() => this.dash.labStatus()?.needsHostIp === true);

  ngOnInit(): void {
    const stored = localStorage.getItem('modulab.sidebarWidth');
    if (stored) {
      document.documentElement.style.setProperty('--sidebar', `${stored}px`);
    }
    this.dash.load().subscribe();
    this.dash.loadLabStatus().subscribe({ error: () => undefined });
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
    this.dash.loadUpdates(true).subscribe({ error: () => undefined });
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
    if (!Number.isNaN(px)) {
      localStorage.setItem('modulab.sidebarWidth', String(px));
    }
  }
}
