import { Component, Input, OnInit, computed, inject } from '@angular/core';
import { DashboardService } from '../core/services/dashboard.service';
import { statusLabel, statusTone } from '../core/app-status';
import { CatalogMark } from '../shared/catalog-mark';

@Component({
  selector: 'app-stacks-widget',
  imports: [CatalogMark],
  template: `
    <ul class="row-list stack-list">
      @for (app of stacks(); track app.id) {
        <li class="row">
          <span class="stack-name">
            <app-catalog-mark [id]="app.id" [name]="app.name" [size]="22" />
            <span class="row__title">{{ app.name }}</span>
          </span>
          <span class="row__end">
            @if (hasUpdate(app.id)) {
              <span class="badge badge--accent badge--plain" title="Update available">update</span>
            }
            <span
              class="badge"
              [class.badge--positive]="tone(app.status) === 'positive'"
              [class.badge--negative]="tone(app.status) === 'negative'"
              >{{ label(app.status) }}</span
            >
          </span>
        </li>
      } @empty {
        <li class="empty-note">No stacks yet. Install from Library.</li>
      }
    </ul>
  `,
  styles: `
    .stack-list {
      height: 100%;
      overflow: auto;
    }
    .stack-name {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      min-width: 0;
    }
  `,
})
export class StacksWidget implements OnInit {
  @Input() config: Record<string, unknown> = {};
  private readonly dash = inject(DashboardService);
  readonly label = statusLabel;
  readonly tone = statusTone;

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
