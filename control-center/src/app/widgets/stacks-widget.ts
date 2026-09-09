import { Component, Input, OnInit, computed, inject } from '@angular/core';
import { DashboardService } from '../core/services/dashboard.service';

@Component({
  selector: 'app-stacks-widget',
  template: `
    <ul class="stack-list">
      @for (app of stacks(); track app.id) {
        <li class="stack-row">
          <span class="stack-name">
            {{ app.name }}
            @if (hasUpdate(app.id)) {
              <span class="stack-update" title="Update available">upd</span>
            }
          </span>
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
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      min-width: 0;
    }
    .stack-update {
      flex: 0 0 auto;
      font-family: var(--mono);
      font-size: 0.62rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--accent);
      background: var(--accent-soft);
      padding: 0.1rem 0.35rem;
      border-radius: 999px;
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
export class StacksWidget implements OnInit {
  @Input() config: Record<string, unknown> = {};
  private readonly dash = inject(DashboardService);

  readonly stacks = computed(() =>
    this.dash
      .catalog()
      .filter((a) => a.status === 'running' || a.status === 'stopped' || a.status === 'removed')
      .slice(0, 12)
  );

  ngOnInit(): void {
    if (this.dash.updates().length === 0 && !this.dash.updatesLoading()) {
      this.dash.loadUpdates(false).subscribe({ error: () => undefined });
    }
  }

  hasUpdate(id: string): boolean {
    return this.dash.updateAvailable(id);
  }
}
