import { Component, Input, computed, inject } from '@angular/core';
import { DashboardService } from '../core/services/dashboard.service';
import { STAT_WIDGET_STYLES } from './stat-widget-styles';

@Component({
  selector: 'app-stack-usage-widget',
  template: `
    <div class="stats">
      <div class="stat">
        <span class="stat__value">{{ installed() }}</span>
        <span class="stat__label">Installed</span>
      </div>
      <div class="stat">
        <span class="stat__value is-positive">{{ running() }}</span>
        <span class="stat__label">Running</span>
      </div>
    </div>
  `,
  styles: STAT_WIDGET_STYLES,
})
export class StackUsageWidget {
  @Input() config: Record<string, unknown> = {};
  private readonly dash = inject(DashboardService);

  readonly installed = computed(
    () =>
      this.dash.catalog().filter((a) =>
        ['running', 'stopped', 'removed', 'installed'].includes(a.status || '')
      ).length
  );
  readonly running = computed(
    () => this.dash.catalog().filter((a) => a.status === 'running').length
  );
}
