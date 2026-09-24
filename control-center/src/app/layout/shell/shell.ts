import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { finalize, forkJoin } from 'rxjs';
import { AppTasks } from '../../core/services/app-tasks';
import { DashboardService } from '../../core/services/dashboard.service';
import { Icon } from '../../shared/icon';
import { CommandPalette } from '../command-palette/command-palette';
import { Sidebar } from '../sidebar/sidebar';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, Sidebar, Icon, CommandPalette],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell implements OnInit {
  readonly dash = inject(DashboardService);
  readonly tasks = inject(AppTasks);
  readonly elapsed = computed(() => {
    this.tasks.clock();
    const task = this.tasks.task();
    if (!task || task.status !== 'running') return '';
    const started = Date.parse(task.startedAt);
    if (Number.isNaN(started)) return '';
    const total = Math.max(0, Math.floor((Date.now() - started) / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  });
  private resizing = false;
  readonly paletteOpen = signal(false);
  readonly shortcutLabel = /\bmac/i.test(navigator.platform) || /\bmac/i.test(navigator.userAgent) ? '⌘K' : 'Ctrl K';
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
    void this.tasks.attach();
  }

  @HostListener('document:keydown', ['$event'])
  onGlobalKey(event: KeyboardEvent): void {
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === 'k' && !event.altKey) {
      event.preventDefault();
      this.paletteOpen.update((open) => !open);
      return;
    }
    if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
    event.preventDefault();
    this.paletteOpen.set(true);
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
