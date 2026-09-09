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
      justify-content: flex-start;
      gap: 0.15rem;
    }
    .feat-title {
      margin: 0;
      font-weight: 600;
      font-size: 0.9rem;
      line-height: 1.15;
    }
    .feat-sub {
      margin: 0;
      font-size: 0.75rem;
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
