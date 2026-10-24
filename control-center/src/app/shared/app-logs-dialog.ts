import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  OnInit,
  Output,
  ViewChild,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { getAppLogs, type ContainerLogs } from '../api/generated';
import { unwrap } from '../core/services/api';
import { Icon } from './icon';

/** Recent container logs for one app, refreshed every few seconds while open. */
@Component({
  selector: 'app-logs-dialog',
  imports: [FormsModule, Icon],
  template: `
    <div class="overlay" (click)="closed.emit()"></div>
    <div class="modal logs" role="dialog" aria-modal="true" aria-labelledby="logs-title">
      <header class="overlay-head">
        <div>
          <h2 id="logs-title" class="overlay-title">{{ name }} logs</h2>
          <p class="page-subtitle">Last {{ tail }} lines{{ live ? ' · live' : '' }}</p>
        </div>
        <div class="logs-tools">
          @if (containers().length > 1) {
            <select class="select input--sm" [ngModel]="selected()" (ngModelChange)="selected.set($event)" aria-label="Container">
              @for (c of containers(); track c.name) {
                <option [value]="c.name">{{ c.name }}</option>
              }
            </select>
          }
          <label class="live">
            <input type="checkbox" [(ngModel)]="live" (ngModelChange)="toggleLive()" />
            Live
          </label>
          <button type="button" class="icon-btn icon-btn--ghost" aria-label="Close" (click)="closed.emit()">
            <app-icon name="close" />
          </button>
        </div>
      </header>
      <div class="overlay-body">
        @if (error()) {
          <p class="empty-note">{{ error() }}</p>
        } @else if (current(); as c) {
          <pre #scroller class="log-view">@for (line of c.lines; track $index) {<span class="log-line"><span class="log-time">{{ shortTime(line.time) }}</span>{{ line.text }}
</span>}@empty {<span class="log-time">No output yet.</span>}</pre>
        } @else if (loaded()) {
          <p class="empty-note">No containers for {{ name }}. Is it installed?</p>
        } @else {
          <p class="empty-note">Loading…</p>
        }
      </div>
    </div>
  `,
  styles: `
    .logs {
      width: min(980px, calc(100vw - 2rem));
      height: min(78dvh, 760px);
    }
    .logs-tools {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .live {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-size: var(--fs-sm);
      color: var(--text-dim);
    }
    .overlay-body {
      display: flex;
    }
    .log-view {
      flex: 1;
      margin: 0;
      padding: 0.75rem;
      overflow: auto;
      border-radius: var(--radius-sm);
      background: var(--inset);
      border: 1px solid var(--border-soft);
      font-family: var(--mono);
      font-size: 0.74rem;
      line-height: 1.5;
      color: var(--text-dim);
      white-space: pre-wrap;
      word-break: break-word;
    }
    .log-time {
      color: var(--text-muted);
      margin-right: 0.75rem;
      user-select: none;
    }
  `,
})
export class AppLogsDialog implements OnInit, OnDestroy {
  @Input({ required: true }) appId!: string;
  @Input() name = '';
  @Input() container: string | null = null;
  @Output() readonly closed = new EventEmitter<void>();
  @ViewChild('scroller') scroller?: ElementRef<HTMLElement>;

  readonly tail = 400;
  readonly containers = signal<ContainerLogs[]>([]);
  readonly selected = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly loaded = signal(false);
  live = true;
  private timer: number | null = null;

  current(): ContainerLogs | null {
    const list = this.containers();
    return list.find((c) => c.name === this.selected()) ?? list[0] ?? null;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closed.emit();
  }

  ngOnInit(): void {
    if (!this.name) this.name = this.appId;
    this.selected.set(this.container);
    void this.load();
    this.toggleLive();
  }

  ngOnDestroy(): void {
    this.stop();
  }

  toggleLive(): void {
    this.stop();
    if (this.live) this.timer = window.setInterval(() => void this.load(), 3000);
  }

  private stop(): void {
    if (this.timer != null) window.clearInterval(this.timer);
    this.timer = null;
  }

  private async load(): Promise<void> {
    const el = this.scroller?.nativeElement;
    const atBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    try {
      const res = await unwrap(getAppLogs({ throwOnError: false, path: { id: this.appId }, query: { tail: this.tail } }));
      this.containers.set(res.containers);
      this.error.set(null);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not load logs');
    }
    this.loaded.set(true);
    // Follow the tail unless the reader scrolled up.
    if (atBottom) setTimeout(() => this.scroller?.nativeElement.scrollTo({ top: 1e9 }));
  }

  shortTime(iso?: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour12: false });
  }
}
