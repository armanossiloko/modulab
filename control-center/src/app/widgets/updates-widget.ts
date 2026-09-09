import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { DashboardService } from '../core/services/dashboard.service';

@Component({
  selector: 'app-updates-widget',
  template: `
    <div class="updates">
      <div class="updates-bar">
        <span class="updates-meta">
          @if (loading()) {
            Checking…
          } @else if (pending().length) {
            {{ pending().length }} update{{ pending().length === 1 ? '' : 's' }}
          } @else {
            Up to date
          }
        </span>
        <button type="button" class="btn-check" [disabled]="loading()" (click)="check(true)">
          Check
        </button>
      </div>

      @if (error()) {
        <p class="empty-note">{{ error() }}</p>
      } @else if (!loading() && pending().length === 0) {
        <p class="empty-note">No image updates for installed stacks.</p>
      } @else {
        <ul class="update-list">
          @for (app of pending(); track app.id) {
            <li class="update-row">
              <div class="update-meta">
                <span class="update-name">{{ app.name }}</span>
                <span class="update-detail">{{ detail(app.id) }}</span>
              </div>
              <button
                type="button"
                class="btn-update"
                [disabled]="busyId() === app.id"
                (click)="apply(app.id, app.name)"
              >
                {{ busyId() === app.id ? 'Updating…' : 'Update' }}
              </button>
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: `
    .updates {
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
      height: 100%;
      min-height: 0;
    }
    .updates-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
    }
    .updates-meta {
      font-family: var(--mono);
      font-size: 0.7rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--text-muted);
    }
    .btn-check,
    .btn-update {
      height: 1.7rem;
      padding: 0 0.55rem;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      background: color-mix(in srgb, var(--bg) 40%, var(--widget));
      color: var(--text);
      font: inherit;
      font-size: 0.75rem;
      cursor: pointer;
    }
    .btn-check:hover:not(:disabled),
    .btn-update:hover:not(:disabled) {
      border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
    }
    .btn-update {
      background: var(--accent-soft);
      border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
      color: var(--accent);
      font-weight: 600;
    }
    .btn-check:disabled,
    .btn-update:disabled {
      opacity: 0.55;
      cursor: default;
    }
    .update-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      overflow: auto;
      min-height: 0;
    }
    .update-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.75rem;
      padding: 0.45rem 0.55rem;
      border-radius: var(--radius-sm);
      background: color-mix(in srgb, var(--bg) 55%, var(--widget));
      border: 1px solid var(--border-soft);
    }
    .update-meta {
      display: flex;
      flex-direction: column;
      gap: 0.1rem;
      min-width: 0;
    }
    .update-name {
      font-weight: 500;
      color: var(--text);
    }
    .update-detail {
      font-size: 0.72rem;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `,
})
export class UpdatesWidget implements OnInit {
  @Input() config: Record<string, unknown> = {};
  private readonly dash = inject(DashboardService);
  readonly error = signal<string | null>(null);
  readonly busyId = signal<string | null>(null);

  readonly loading = computed(() => this.dash.updatesLoading());
  readonly pending = computed(() => this.dash.appsWithUpdates());

  ngOnInit(): void {
    if (this.dash.updates().length === 0) {
      this.check(false);
    }
  }

  detail(id: string): string {
    const app = this.dash.updates().find((a) => a.id === id);
    const images = (app?.images ?? []).filter((i) => i.updateAvailable);
    if (!images.length) return 'Update available';
    const reasons = new Set(
      images.flatMap((i) => (i.reason || '').split(',')).filter(Boolean)
    );
    if (reasons.has('newer-registry')) return 'Newer image on registry';
    if (reasons.has('container-stale')) return 'Container needs recreate';
    return images[0].image || 'Update available';
  }

  check(refresh: boolean): void {
    this.error.set(null);
    this.dash.loadUpdates(refresh).subscribe({
      error: (err: Error) => this.error.set(err.message),
    });
  }

  apply(id: string, name: string): void {
    if (!confirm(`Pull and recreate ${name}?`)) return;
    this.busyId.set(id);
    this.dash.updateApp(id).subscribe({
      next: () => {
        this.busyId.set(null);
        this.check(true);
        this.dash.loadCatalog().subscribe();
      },
      error: (err: Error) => {
        this.busyId.set(null);
        alert(err.message);
      },
    });
  }
}
