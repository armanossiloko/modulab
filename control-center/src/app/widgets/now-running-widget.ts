import { Component, Input, computed, inject } from '@angular/core';
import { DashboardService } from '../core/services/dashboard.service';

@Component({
  selector: 'app-now-running-widget',
  template: `
    @if (featured(); as app) {
      <div class="feat">
        <p class="feat-title">{{ app.name }}</p>
        <p class="feat-sub">{{ app.description || app.status }}</p>
      </div>
    } @else {
      <p class="empty-note">Nothing running</p>
    }
  `,
  styles: `
    .feat {
      display: flex;
      flex-direction: column;
      justify-content: center;
      height: 100%;
      gap: 0.25rem;
    }
    .feat-title {
      margin: 0;
      font-weight: 600;
    }
    .feat-sub {
      margin: 0;
      font-size: 0.82rem;
      color: var(--text-dim);
    }
  `,
})
export class NowRunningWidget {
  @Input() config: Record<string, unknown> = {};
  private readonly dash = inject(DashboardService);

  readonly featured = computed(() => {
    const running = this.dash.catalog().filter((a) => a.status === 'running');
    return (
      running.find((a) => a.id === 'jellyfin') ||
      running.find((a) => a.category === 'media') ||
      running[0] ||
      null
    );
  });
}
