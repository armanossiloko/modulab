import {
  Component,
  ElementRef,
  HostListener,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { finalize, forkJoin } from 'rxjs';
import { DashboardService } from '../../core/services/dashboard.service';
import { Icon } from '../../shared/icon';
import { Sidebar } from '../sidebar/sidebar';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, FormsModule, Sidebar, Icon],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell implements OnInit {
  readonly dash = inject(DashboardService);
  @ViewChild('searchInput') private searchInput?: ElementRef<HTMLInputElement>;
  search = '';
  private resizing = false;
  readonly refreshing = signal(false);
  readonly needsLabSetup = computed(() => this.dash.labStatus()?.needsHostIp === true);
  readonly searchPlaceholder = computed(
    () => this.dash.document()?.search?.placeholder?.trim() || 'Search stacks or the web…'
  );

  ngOnInit(): void {
    const stored = localStorage.getItem('modulab.sidebarWidth');
    if (stored) {
      document.documentElement.style.setProperty('--sidebar', `${stored}px`);
    }
    this.dash.load().subscribe();
    this.dash.loadCatalog().subscribe({ error: () => undefined });
    this.dash.loadLabStatus().subscribe({ error: () => undefined });
  }

  @HostListener('document:keydown', ['$event'])
  onGlobalKey(event: KeyboardEvent): void {
    if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
    event.preventDefault();
    this.searchInput?.nativeElement.focus();
  }

  onSearchKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.search = '';
      (event.target as HTMLInputElement).blur();
      return;
    }
    if (event.key !== 'Enter') return;
    const q = this.search.trim();
    if (!q) return;
    const engine =
      this.dash.document()?.search?.engine || 'https://duckduckgo.com/?q=%s';
    window.open(engine.replace('%s', encodeURIComponent(q)), '_blank', 'noopener,noreferrer');
  }

  refresh(): void {
    if (this.refreshing()) return;
    this.refreshing.set(true);
    this.dash.loadUpdates(true).subscribe({ error: () => undefined });
    forkJoin([this.dash.load(), this.dash.loadCatalog()])
      .pipe(finalize(() => this.refreshing.set(false)))
      .subscribe({ error: () => undefined });
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
