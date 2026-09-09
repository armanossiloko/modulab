import { Component, Input, computed, inject } from '@angular/core';
import { DashboardService } from '../core/services/dashboard.service';

@Component({
  selector: 'app-network-widget',
  template: `
    <div class="stats">
      <div class="stat">
        <span class="stat-value">{{ online() }}</span>
        <span class="stat-label">Online</span>
      </div>
      <div class="stat">
        <span class="stat-value">{{ installed() }}</span>
        <span class="stat-label">Installed</span>
      </div>
    </div>
  `,
  styles: `
    .stats {
      display: flex;
      gap: 0.4rem;
      align-items: stretch;
    }
    .stat {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 0.05rem;
      padding: 0.25rem 0.4rem;
      border-radius: var(--radius-sm);
      background: color-mix(in srgb, var(--bg) 55%, var(--widget));
      border: 1px solid var(--border-soft);
    }
    .stat-value {
      font-family: var(--mono);
      font-size: 1.05rem;
      font-weight: 600;
      line-height: 1.1;
    }
    .stat-label {
      font-size: 0.72rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
  `,
})
export class NetworkWidget {
  @Input() config: Record<string, unknown> = {};
  private readonly dash = inject(DashboardService);

  readonly online = computed(
    () => this.dash.catalog().filter((a) => a.status === 'running').length
  );
  readonly installed = computed(
    () =>
      this.dash.catalog().filter((a) =>
        ['running', 'stopped', 'removed', 'installed'].includes(a.status || '')
      ).length
  );
}
