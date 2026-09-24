import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { AppTasks } from '../core/services/app-tasks';
import { DashboardService } from '../core/services/dashboard.service';
import { Icon } from '../shared/icon';

@Component({
  selector: 'app-updates-widget',
  imports: [Icon],
  template: `
    <div class="updates">
      <div class="updates-bar">
        @if (loading()) {
          <span class="badge badge--plain">Checking…</span>
        } @else if (pending().length) {
          <span class="badge badge--accent"
            >{{ pending().length }} update{{ pending().length === 1 ? '' : 's' }}</span
          >
        } @else {
          <span class="badge badge--positive">Up to date</span>
        }
        <button
          type="button"
          class="btn btn--sm"
          [class.is-spinning]="loading()"
          [disabled]="loading()"
          (click)="check(true)"
        >
          <app-icon name="refresh" [size]="12" />
          Check
        </button>
      </div>

      <div class="row">
        <div class="row__main">
          <span class="row__title">Control Center</span>
          <span class="row__meta">compose.yaml, Postgres, and Caddy</span>
        </div>
        <button
          type="button"
          class="btn btn--primary btn--sm"
          [disabled]="tasks.runningId() !== null"
          (click)="updateControlCenter()"
        >
          {{ tasks.runningId() === 'control-center' ? 'Updating…' : 'Update' }}
        </button>
      </div>

      @if (error()) {
        <p class="empty-note">{{ error() }}</p>
      } @else if (!loading() && pending().length === 0) {
        <p class="empty-note">No image updates for installed stacks.</p>
      } @else {
        <ul class="row-list update-list">
          @for (app of pending(); track app.id) {
            <li class="row">
              <div class="row__main">
                <span class="row__title">{{ app.name }}</span>
                <span class="row__meta">{{ detail(app.id) }}</span>
              </div>
              <button
                type="button"
                class="btn btn--primary btn--sm"
                [disabled]="tasks.runningId() !== null"
                (click)="apply(app.id, app.name)"
              >
                {{ tasks.runningId() === app.id ? 'Updating…' : 'Update' }}
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
      gap: 0.5rem;
      height: 100%;
      min-height: 0;
    }
    .updates-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
    }
    .is-spinning app-icon {
      animation: spin 0.8s linear infinite;
    }
    .update-list {
      overflow: auto;
      min-height: 0;
    }
  `,
})
export class UpdatesWidget implements OnInit {
  @Input() config: Record<string, unknown> = {};
  private readonly dash = inject(DashboardService);
  readonly tasks = inject(AppTasks);
  readonly error = signal<string | null>(null);

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

  updateControlCenter(): void {
    void this.tasks.updateControlCenter();
  }

  apply(id: string, name: string): void {
    if (this.tasks.runningId()) return;
    if (!confirm(`Pull and recreate ${name}?`)) return;
    void this.tasks.updateApp(id, name);
  }
}
