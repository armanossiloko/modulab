import { Component, Input, computed, inject } from '@angular/core';
import { DashboardService } from '../core/services/dashboard.service';

@Component({
  selector: 'app-stacks-widget',
  template: `
    <ul class="stack-list">
      @for (app of stacks(); track app.id) {
        <li class="stack-row">
          <span class="stack-name">{{ app.name }}</span>
          <span class="stack-status" [class.is-running]="app.status === 'running'">{{
            app.status || '—'
          }}</span>
        </li>
      } @empty {
        <li class="empty-note">No stacks yet. Install from Library.</li>
      }
    </ul>
  `,
  styles: `
    .stack-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      height: 100%;
      overflow: auto;
    }
    .stack-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.75rem;
      padding: 0.45rem 0.55rem;
      border-radius: var(--radius-sm);
      background: color-mix(in srgb, var(--bg) 55%, var(--widget));
      border: 1px solid var(--border-soft);
    }
    .stack-name {
      font-weight: 500;
      color: var(--text);
    }
    .stack-status {
      font-family: var(--mono);
      font-size: 0.7rem;
      letter-spacing: 0.04em;
      color: var(--text-muted);
      text-transform: uppercase;
    }
    .stack-status.is-running {
      color: var(--positive);
      background: var(--positive-soft);
      padding: 0.15rem 0.4rem;
      border-radius: 999px;
    }
  `,
})
export class StacksWidget {
  @Input() config: Record<string, unknown> = {};
  private readonly dash = inject(DashboardService);

  readonly stacks = computed(() =>
    this.dash
      .catalog()
      .filter((a) => a.status === 'running' || a.status === 'stopped' || a.status === 'removed')
      .slice(0, 12)
  );
}
