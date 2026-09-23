import { Component, Input, computed, inject } from '@angular/core';
import { DashboardService } from '../core/services/dashboard.service';

@Component({
  selector: 'app-now-running-widget',
  template: `
    @if (featured(); as app) {
      <div class="feat">
        <p class="feat-title">
          <span class="feat-dot" aria-hidden="true"></span>
          <span class="feat-name">{{ app.name }}</span>
        </p>
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
      gap: 0.2rem;
      min-width: 0;
    }
    .feat-title {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      margin: 0;
      font-weight: 650;
      font-size: var(--fs-lg);
      line-height: 1.2;
      min-width: 0;
    }
    .feat-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .feat-dot {
      flex: 0 0 auto;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--positive);
      box-shadow: 0 0 8px var(--positive);
    }
    .feat-sub {
      margin: 0;
      font-size: var(--fs-sm);
      color: var(--text-dim);
    }
    @container widget (max-height: 84px) {
      .feat {
        align-items: flex-end;
      }
      .feat-title {
        font-size: var(--fs-md);
      }
      .feat-sub {
        display: none;
      }
    }
    @container widget (max-height: 84px) and (max-width: 230px) {
      .feat {
        align-items: flex-start;
      }
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
